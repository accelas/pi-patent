import * as fs from "node:fs";
import * as path from "node:path";
import { makeDrafterAgent } from "./agents/drafter.js";
import { makeEvaluatorAgent } from "./agents/evaluator.js";
import { resolveModelOrThrow } from "./agents/model.js";
import { SessionWriter, slugFromDisclosure } from "./artifacts.js";
import type { parseCliArgs } from "./cli.js";
import type { CliArgs } from "./config.js";
import { loadConfigFromDisk } from "./config.js";
import { AbortError, IntakeRejected, LlmProtocolError, SearchBackendError, UserError } from "./errors.js";
import { defaultIntakeDeps, runIntake } from "./intake.js";
import type { LoopEvent, RalphResult } from "./loop.js";
import { ralphLoop } from "./loop.js";
import { credentialStore } from "./oauth/store.js";
import { loadPrompt } from "./prompts/load.js";
import { promptVarsFor } from "./prompts/render.js";
import { ensureCredentials } from "./providers.js";
import { readLine, stdinExhausted, writePrompt } from "./stdin-lines.js";
import { getSearchProvider } from "./tools/search/index.js";
import type { ResolvedConfig, Verdict } from "./types.js";
import { AXIS_NAMES } from "./types.js";

// ---------- Input reading ----------

async function readDisclosure(input?: string): Promise<string> {
	if (input) return fs.readFileSync(input, "utf-8");
	if (!process.stdin.isTTY) {
		const chunks: Buffer[] = [];
		for await (const c of process.stdin) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
		return Buffer.concat(chunks).toString("utf-8");
	}
	// Interactive prompt — read lines until an empty line.
	console.log("Paste the disclosure; end with an empty line.");
	let buf = "";
	while (true) {
		const line = await readLine();
		if (line === "") break;
		buf += `${line}\n`;
	}
	return buf;
}

// ---------- Preflight ----------

function preflight(cfg: ResolvedConfig): void {
	for (const role of ["intake", "drafter", "evaluator"] as const) {
		const { provider, model } = cfg.models[role];
		// resolveModelOrThrow handles custom providers (e.g. openrouter) AND pi-ai's registry.
		// Throws UserError with role-scoped message on unknown model/provider combo.
		resolveModelOrThrow(role, provider, model);
		ensureCredentials(provider, role, credentialStore);
	}
	if (cfg.web_search) getSearchProvider(cfg.search_provider).validate();
	fs.mkdirSync(cfg.out_dir, { recursive: true });
	const probe = path.join(cfg.out_dir, `.probe-${process.pid}`);
	fs.writeFileSync(probe, "");
	fs.rmSync(probe);
	for (const name of ["intake", "drafter", "evaluator"] as const) {
		loadPrompt(name, promptVarsFor(name, cfg));
	}
}

// ---------- Interactive prompt for ask_user ----------

async function terminalPrompt(question: string, options?: string[]): Promise<string> {
	// Refuse to silently fabricate answers when there is no interactive stdin.
	// This happens if the user piped a disclosure AND the intake agent now wants
	// a clarifying answer: stdin is already at EOF. Failing loud is safer than
	// letting the CLI pick options[0] for scope/prior-art on a sensitive disclosure.
	if (stdinExhausted()) {
		throw new UserError(
			"Intake agent wants a clarifying answer but stdin is not interactive (it was consumed or closed). " +
				"Either run pi-patent in a real terminal, or use --input <file> with a disclosure rich enough that intake can finalize without questions.",
		);
	}
	if (options?.length) {
		const lines = options.map((o, i) => `  [${i + 1}] ${o}`).join("\n");
		writePrompt(`\nQ: ${question}\n${lines}\n> `);
		const answer = (await readLine()).trim();
		const n = Number(answer);
		if (!Number.isNaN(n) && n >= 1 && n <= options.length) {
			const chosen = options[n - 1];
			if (chosen !== undefined) return chosen;
		}
		if (options.includes(answer)) return answer;
		// Non-empty, non-matching answer: pass it through verbatim (the LLM may still accept it).
		if (answer) return answer;
		// Empty answer: refuse rather than defaulting silently.
		throw new UserError(
			`No answer given for intake question "${question.slice(0, 80)}…" — the CLI will not pick a default on your behalf.`,
		);
	}
	writePrompt(`\nQ: ${question}\n> `);
	const answer = (await readLine()).trim();
	if (!answer) {
		throw new UserError(
			`No answer given for intake question "${question.slice(0, 80)}…" — the CLI will not pick a default on your behalf.`,
		);
	}
	return answer;
}

// ---------- Progress display ----------

function formatScores(v: Verdict): string {
	return AXIS_NAMES.map((a) => `${a}=${v.scores[a]}`).join(" ");
}

function makeProgressReporter(cfg: ResolvedConfig): (ev: LoopEvent) => void {
	return (ev: LoopEvent) => {
		if (ev.type === "iter_start") {
			console.log(`\n[iter ${ev.iteration}/${cfg.max_iter}] drafting + evaluating...`);
		} else if (ev.type === "iter_done") {
			const v = ev.verdict;
			console.log(`[iter ${ev.iteration}] ${v.verdict.toUpperCase()} — ${formatScores(v)}`);
			if (v.verdict === "revise" && v.next_iteration_focus) {
				console.log(`  focus: ${v.next_iteration_focus}`);
			}
		}
	};
}

// ---------- Error → exit code mapping ----------

export function exitCodeFor(err: unknown): number {
	if (err instanceof AbortError) return 130;
	if (err instanceof UserError) return 2;
	if (err instanceof IntakeRejected) return 2;
	if (err instanceof LlmProtocolError) return 3;
	if (err instanceof SearchBackendError) return 4;
	return 1;
}

/**
 * Shared error handler used by both the top-level `mainCli` catch and
 * `runMain`'s internal catch. Writes a friendly message to stderr (or full
 * stack for unexpected errors) and returns the matching exit code.
 */
export function exitFromError(err: unknown): number {
	if (err instanceof AbortError) {
		console.error("\nAborted.");
		return 130;
	}
	const message = err instanceof Error ? err.message : String(err);
	if (err instanceof UserError) {
		console.error(`Error: ${message}`);
	} else if (err instanceof IntakeRejected) {
		console.error(`Intake rejected: ${message}`);
	} else if (err instanceof LlmProtocolError) {
		console.error(`LLM protocol error: ${message}`);
	} else if (err instanceof SearchBackendError) {
		console.error(`Search backend error: ${message}`);
	} else {
		console.error(err);
	}
	return exitCodeFor(err);
}

// ---------- Main ----------

export async function runMain(parsed: ReturnType<typeof parseCliArgs>): Promise<number> {
	// With exactOptionalPropertyTypes: true, conditionally spread rather than
	// assigning undefined to optional fields.
	const cliArgs: CliArgs = {
		...(parsed.maxIter !== undefined ? { maxIter: parsed.maxIter } : {}),
		...(parsed.model !== undefined ? { model: parsed.model } : {}),
		...(parsed.out !== undefined ? { out: parsed.out } : {}),
		...(parsed.quiet !== undefined ? { quiet: parsed.quiet } : {}),
		...(parsed.noWeb ? { web_search: false } : {}),
	};
	const cfg = loadConfigFromDisk(cliArgs);

	// Abort plumbing — SIGINT triggers a graceful abort.
	const abortController = new AbortController();
	const onSigint = () => {
		console.error("\nAborting (SIGINT)...");
		abortController.abort();
	};
	process.on("SIGINT", onSigint);

	let session: SessionWriter | null = null;
	let lastCompletedIteration = 0;

	try {
		// Read disclosure FIRST and validate length BEFORE preflight (spec §12.1.1).
		// Must live INSIDE the try so UserError for short input maps to exit code 2.
		const disclosure = (await readDisclosure(parsed.input)).trim();
		if (disclosure.length < 20) {
			throw new UserError(
				`Disclosure too short (${disclosure.length} chars). Provide at least 20 characters describing the invention.`,
			);
		}

		preflight(cfg);

		// Intake phase
		console.log("Running intake...");
		const { intake, transcript } = await runIntake(disclosure, cfg, defaultIntakeDeps(cfg, terminalPrompt));

		// Open session once intake is accepted.
		const slug = slugFromDisclosure(disclosure);
		session = SessionWriter.create(cfg.out_dir, slug, { intake, config: cfg });
		session.writeInput(disclosure, intake, transcript);
		console.log(`Session: ${session.dir}`);

		// Ralph loop
		const onProgress = makeProgressReporter(cfg);
		const result: RalphResult = await ralphLoop({
			disclosure,
			intake,
			config: cfg,
			makeDrafter: () => makeDrafterAgent(cfg),
			makeEvaluator: () => makeEvaluatorAgent(cfg),
			session,
			onProgress: (ev) => {
				onProgress(ev);
				if (ev.type === "iter_done") lastCompletedIteration = ev.iteration;
			},
			signal: abortController.signal,
		});

		if (result.status === "aborted") {
			session.writeAbort(result.iterations, "sigint");
			console.error(`\nAborted after ${result.iterations} iteration(s).`);
			return 130;
		}

		if (result.status === "passed") {
			console.log(`\nPASSED in ${result.iterations} iteration(s).`);
			console.log(`Draft:  ${path.join(session.dir, "draft.md")}`);
			console.log(`Layman: ${path.join(session.dir, "layman.md")}`);
			return 0;
		}

		// max_iter
		console.log(`\nMax iterations (${result.iterations}) reached without PASS. Draft saved.`);
		console.log(`Draft:  ${path.join(session.dir, "draft.md")}`);
		console.log(`Layman: ${path.join(session.dir, "layman.md")}`);
		return 0;
	} catch (err) {
		// AbortError / aborted signal branch FIRST.
		if (err instanceof AbortError || abortController.signal.aborted) {
			session?.writeAbort(lastCompletedIteration, "sigint");
			console.error("\nAborted.");
			return 130;
		}

		// Categorize and persist the error before delegating to the shared
		// stderr + exit-code handler.
		let category: "user" | "llm_protocol" | "search_backend" | "unexpected";
		if (err instanceof UserError || err instanceof IntakeRejected) category = "user";
		else if (err instanceof LlmProtocolError) category = "llm_protocol";
		else if (err instanceof SearchBackendError) category = "search_backend";
		else category = "unexpected";

		const message = err instanceof Error ? err.message : String(err);
		session?.writeError({ category, message, lastCompletedIteration });

		return exitFromError(err);
	} finally {
		process.off("SIGINT", onSigint);
	}
}
