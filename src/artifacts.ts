import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { IntakeResult, ResolvedConfig, RoleName, SessionJson, Verdict } from "./types.js";

// Confidentiality: disclosures, drafts, transcripts may contain sensitive inventor
// material. Force 0700 on the session dir and 0600 on every artifact file so they
// are owner-readable only, regardless of the user's umask.
const SESSION_DIR_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;

function writePrivate(file: string, body: string): void {
	fs.writeFileSync(file, body, { mode: SESSION_FILE_MODE });
}

export interface SessionInitMeta {
	intake: IntakeResult;
	config: ResolvedConfig;
}

export function slugFromDisclosure(text: string): string {
	const firstLine = (text.split("\n")[0] ?? "").trim();
	if (!firstLine) return "patent";
	const slug = firstLine
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/g, "");
	return slug || "patent";
}

function timestamp(): string {
	const d = new Date();
	const p = (n: number) => n.toString().padStart(2, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class SessionWriter {
	private usage: SessionJson["usage"] = {
		total_input_tokens: 0,
		total_output_tokens: 0,
		total_cost_usd: 0,
		by_role: { intake: 0, drafter: 0, evaluator: 0 },
	};
	private data: SessionJson;

	private constructor(
		public readonly dir: string,
		init: SessionInitMeta,
	) {
		this.data = {
			schema_version: 1,
			session_id: path.basename(dir),
			started_at: new Date().toISOString(),
			status: "running",
			iterations: 0,
			usage: this.usage,
			intake: init.intake,
			config_snapshot: {
				thresholds: init.config.thresholds,
				max_iter: init.config.max_iter,
				web_search: init.config.web_search,
				search_provider: init.config.search_provider,
				models: {
					intake: init.config.models.intake,
					drafter: init.config.models.drafter,
					evaluator: init.config.models.evaluator,
				},
			},
		};
		this.flush();
	}

	static create(outDir: string, slug: string, meta: SessionInitMeta): SessionWriter {
		// Ensure the parent out_dir exists; do not force its mode (user owns it).
		fs.mkdirSync(outDir, { recursive: true });
		const base = `${slug}-${timestamp()}`;
		let dir = path.join(outDir, base);
		let n = 1;
		while (true) {
			try {
				fs.mkdirSync(dir, { recursive: false, mode: SESSION_DIR_MODE });
				break;
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
				dir = path.join(outDir, `${base}-${n++}`);
			}
		}
		// On some systems mkdirSync honors umask even when `mode` is given —
		// chmod to enforce the exact mode.
		fs.chmodSync(dir, SESSION_DIR_MODE);
		return new SessionWriter(dir, meta);
	}

	private flush(): void {
		const tmp = path.join(this.dir, "session.json.tmp");
		const final = path.join(this.dir, "session.json");
		fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: SESSION_FILE_MODE });
		fs.renameSync(tmp, final);
	}

	writeInput(disclosure: string, intakeResult: IntakeResult, transcript: AgentMessage[]): void {
		const transcriptLines = transcript
			.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
			.map((m) => `### ${m.role}\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content, null, 2)}`);
		const body = [
			"# Original disclosure",
			"",
			disclosure,
			"",
			"# Intake result",
			"```json",
			JSON.stringify(intakeResult, null, 2),
			"```",
			"",
			"# Intake transcript",
			"",
			...transcriptLines,
		].join("\n");
		writePrivate(path.join(this.dir, "input.md"), body);
	}

	writeIteration(n: number, x: { draft: string; layman: string; verdict: Verdict }): void {
		writePrivate(path.join(this.dir, `iter-${n}-draft.md`), x.draft);
		writePrivate(path.join(this.dir, `iter-${n}-layman.md`), x.layman);
		writePrivate(path.join(this.dir, `iter-${n}-eval.json`), JSON.stringify(x.verdict, null, 2));
		this.data.iterations = n;
		this.flush();
	}

	writeFinal(x: { draft: string; layman: string; verdict: Verdict; iterations: number }): void {
		writePrivate(path.join(this.dir, "draft.md"), x.draft);
		writePrivate(path.join(this.dir, "layman.md"), x.layman);
		this.data.status = x.verdict.verdict === "pass" ? "passed" : "max_iter";
		this.data.ended_at = new Date().toISOString();
		this.data.iterations = x.iterations;
		this.data.final_verdict = x.verdict;
		this.flush();
	}

	writeAbort(lastIter: number, reason: "sigint" | "signal"): void {
		this.data.status = "aborted";
		this.data.ended_at = new Date().toISOString();
		this.data.abort = { at: new Date().toISOString(), last_completed: lastIter, reason };
		this.flush();
		writePrivate(path.join(this.dir, ".aborted"), "");
	}

	writeError(x: {
		category: "user" | "llm_protocol" | "search_backend" | "unexpected";
		message: string;
		lastCompletedIteration: number;
	}): void {
		this.data.status = "error";
		this.data.ended_at = new Date().toISOString();
		this.data.error = {
			at: new Date().toISOString(),
			category: x.category,
			message: x.message,
			last_completed_iteration: x.lastCompletedIteration,
		};
		this.flush();
	}

	updateUsage(role: RoleName, inputTokens: number, outputTokens: number, costUsd: number): void {
		this.usage.total_input_tokens += inputTokens;
		this.usage.total_output_tokens += outputTokens;
		this.usage.by_role[role] = Math.round((this.usage.by_role[role] + costUsd) * 10000) / 10000;
		this.usage.total_cost_usd =
			Math.round((this.usage.by_role.intake + this.usage.by_role.drafter + this.usage.by_role.evaluator) * 100) / 100;
		this.flush();
	}
}

// NOTE — Usage wiring is a v1.1 deferred task.
// `updateUsage` is implemented above but not called from anywhere in v1. The usage fields in
// session.json will remain at 0 until a follow-up task subscribes ralphLoop's agents to
// `message_end` events and extracts AssistantMessage.usage. See spec §6.4.
// Listed in "Deferred (v2+)" in the spec as an explicit gap.
