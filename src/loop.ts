import type { Agent } from "@mariozechner/pi-agent-core";
import type { SessionWriter } from "./artifacts.js";
import { LlmProtocolError, SearchBackendError } from "./errors.js";
import { parseDrafterOutputWithRetry, runEvaluation } from "./loop-helpers.js";
import { renderCritique, renderSeed } from "./prompts/render.js";
import type { IntakeResult, ResolvedConfig, Verdict } from "./types.js";
import { AXIS_NAMES } from "./types.js";

export type LoopEvent =
	| { type: "iter_start"; iteration: number }
	| {
			type: "iter_done";
			iteration: number;
			verdict: Verdict;
			/** True if this iteration's verdict is strictly worse than the best-so-far (post-iter-1). */
			regressed?: boolean;
			/** Axes that regressed >=2 points from best-so-far. Populated when `regressed` is true. */
			regressedAxes?: Array<{ axis: (typeof AXIS_NAMES)[number]; from: number; to: number }>;
	  };

export type RalphResult =
	| { status: "passed"; draft: string; layman: string; verdict: Verdict; iterations: number }
	| { status: "max_iter"; draft: string; layman: string; verdict: Verdict; iterations: number }
	| { status: "aborted"; draft?: string; iterations: number };

export interface RalphLoopOpts {
	disclosure: string;
	intake: IntakeResult;
	config: ResolvedConfig;
	makeDrafter: () => Agent;
	makeEvaluator: () => Agent;
	session: SessionWriter;
	onProgress?: (ev: LoopEvent) => void;
	signal?: AbortSignal;
}

function enforcePassRule(v: Verdict, cfg: ResolvedConfig): Verdict {
	let downgrade = false;
	for (const a of AXIS_NAMES) {
		if (v.scores[a] < cfg.thresholds[a]) downgrade = true;
	}
	if (v.prior_art_flags?.some((f) => f.overlap_level === "high")) downgrade = true;
	if (v.verdict === "pass" && downgrade) {
		console.warn("[loop] evaluator claimed 'pass' but scores/flags don't clear threshold; downgrading to 'revise'");
		return { ...v, verdict: "revise" };
	}
	return v;
}

/**
 * Rank a verdict for keep-best-so-far: primary key is how many axes meet
 * threshold (catching "previously-passing axis is now failing" regressions);
 * secondary key is the sum of scores (tiebreaker).
 *
 * Exported for tests. Pure function.
 */
export function scoreOf(v: Verdict, thresholds: ResolvedConfig["thresholds"]): number {
	const passing = AXIS_NAMES.filter((a) => v.scores[a] >= thresholds[a]).length;
	const sum = AXIS_NAMES.reduce((s, a) => s + v.scores[a], 0);
	return passing * 100 + sum;
}

/**
 * Per-axis regression detection. An axis is "regressed" if it dropped by
 * 2 or more points from the best-so-far (tolerates 1-point LLM scoring noise).
 * Exported for tests.
 */
export function detectRegression(
	current: Verdict,
	best: Verdict,
): Array<{ axis: (typeof AXIS_NAMES)[number]; from: number; to: number }> {
	const out: Array<{ axis: (typeof AXIS_NAMES)[number]; from: number; to: number }> = [];
	for (const a of AXIS_NAMES) {
		const delta = best.scores[a] - current.scores[a];
		if (delta >= 2) out.push({ axis: a, from: best.scores[a], to: current.scores[a] });
	}
	return out;
}

export async function ralphLoop(opts: RalphLoopOpts): Promise<RalphResult> {
	const drafter = opts.makeDrafter();
	let currentEval: Agent | null = null;
	const abortBoth = () => {
		drafter.abort();
		currentEval?.abort();
	};
	opts.signal?.addEventListener("abort", abortBoth, { once: true });

	let searchErrorStreak = 0;

	// Keep-best-so-far: track the highest-scoring iteration. On max_iter, we
	// promote this draft as the final output instead of blindly using the last.
	// (Issue #1 comment: "Keep best-so-far + re-roll" — v0.2 ships the keep-best half.)
	let best: { iter: number; draft: string; layman: string; verdict: Verdict } | null = null;

	// Route through SessionWriter so the dump file inherits 0600 (C2 — disclosure material).
	const dumpMalformed = (iter: number) => (raw: string) => opts.session.writeMalformed(iter, raw);

	try {
		await drafter.prompt(renderSeed(opts.disclosure, opts.intake));
		let { draft, layman } = await parseDrafterOutputWithRetry(drafter, dumpMalformed(1));

		for (let i = 1; i <= opts.config.max_iter; i++) {
			if (opts.signal?.aborted) return { status: "aborted", draft, iterations: i - 1 };
			opts.onProgress?.({ type: "iter_start", iteration: i });

			const evalAgent = opts.makeEvaluator();
			currentEval = evalAgent;
			const { verdict: raw, searchBackendFailed } = await runEvaluation(
				evalAgent,
				opts.disclosure,
				opts.intake,
				draft,
				layman,
			);
			currentEval = null;
			const verdict = enforcePassRule(raw, opts.config);

			opts.session.writeIteration(i, { draft, layman, verdict });

			// Relative-regression check (#4): compare against best-so-far and surface
			// axes that dropped ≥2 points. Purely informational in v0.2 — the loop
			// keeps running; keep-best selection handles the safety net.
			let regressed = false;
			let regressedAxes: ReturnType<typeof detectRegression> | undefined;
			if (best) {
				const ax = detectRegression(verdict, best.verdict);
				if (ax.length > 0) {
					regressed = true;
					regressedAxes = ax;
				}
			}

			opts.onProgress?.({
				type: "iter_done",
				iteration: i,
				verdict,
				...(regressed ? { regressed: true, ...(regressedAxes ? { regressedAxes } : {}) } : {}),
			});

			// Keep-best (#3): promote this iteration if strictly higher-scoring.
			if (!best || scoreOf(verdict, opts.config.thresholds) > scoreOf(best.verdict, opts.config.thresholds)) {
				best = { iter: i, draft, layman, verdict };
			}

			searchErrorStreak = searchBackendFailed ? searchErrorStreak + 1 : 0;
			if (searchErrorStreak >= 3) {
				throw new SearchBackendError(
					`Search provider failed on 3 consecutive iterations. Try --no-web or check ${opts.config.search_provider} status.`,
				);
			}

			if (verdict.verdict === "pass") {
				// First pass always wins immediately — no keep-best rewrite needed.
				opts.session.writeFinal({ draft, layman, verdict, iterations: i });
				return { status: "passed", draft, layman, verdict, iterations: i };
			}
			if (i === opts.config.max_iter) {
				// On max_iter, promote best-so-far (which may be an earlier iteration).
				// `best` is guaranteed non-null here (at least iter 1 was added).
				const finalPick = best ?? { iter: i, draft, layman, verdict };
				opts.session.writeFinal({
					draft: finalPick.draft,
					layman: finalPick.layman,
					verdict: finalPick.verdict,
					iterations: i,
				});
				if (finalPick.iter !== i) {
					console.log(
						`[loop] Max iterations reached; promoting iter ${finalPick.iter}'s draft (scored higher than iter ${i}).`,
					);
				}
				return {
					status: "max_iter",
					draft: finalPick.draft,
					layman: finalPick.layman,
					verdict: finalPick.verdict,
					iterations: i,
				};
			}

			await drafter.prompt(renderCritique(verdict, i));
			const next = await parseDrafterOutputWithRetry(drafter, dumpMalformed(i + 1));
			draft = next.draft;
			layman = next.layman;
		}
		throw new LlmProtocolError("unreachable: loop exited without returning");
	} finally {
		opts.signal?.removeEventListener("abort", abortBoth);
	}
}
