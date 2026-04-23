import * as fs from "node:fs";
import * as path from "node:path";
import type { Agent } from "@mariozechner/pi-agent-core";
import type { SessionWriter } from "./artifacts.js";
import { LlmProtocolError, SearchBackendError } from "./errors.js";
import { parseDrafterOutputWithRetry, runEvaluation } from "./loop-helpers.js";
import { renderCritique, renderSeed } from "./prompts/render.js";
import type { IntakeResult, ResolvedConfig, Verdict } from "./types.js";
import { AXIS_NAMES } from "./types.js";

export type LoopEvent =
	| { type: "iter_start"; iteration: number }
	| { type: "iter_done"; iteration: number; verdict: Verdict };

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

export async function ralphLoop(opts: RalphLoopOpts): Promise<RalphResult> {
	const drafter = opts.makeDrafter();
	let currentEval: Agent | null = null;
	const abortBoth = () => {
		drafter.abort();
		currentEval?.abort();
	};
	opts.signal?.addEventListener("abort", abortBoth, { once: true });

	let searchErrorStreak = 0;

	const dumpMalformed = (iter: number) => (raw: string) => {
		fs.writeFileSync(path.join(opts.session.dir, `malformed-iter-${iter}.txt`), raw);
	};

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
			opts.onProgress?.({ type: "iter_done", iteration: i, verdict });

			searchErrorStreak = searchBackendFailed ? searchErrorStreak + 1 : 0;
			if (searchErrorStreak >= 3) {
				throw new SearchBackendError(
					`Search provider failed on 3 consecutive iterations. Try --no-web or check ${opts.config.search_provider} status.`,
				);
			}

			if (verdict.verdict === "pass") {
				opts.session.writeFinal({ draft, layman, verdict, iterations: i });
				return { status: "passed", draft, layman, verdict, iterations: i };
			}
			if (i === opts.config.max_iter) {
				opts.session.writeFinal({ draft, layman, verdict, iterations: i });
				return { status: "max_iter", draft, layman, verdict, iterations: i };
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
