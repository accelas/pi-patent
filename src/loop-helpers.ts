import type { Agent } from "@mariozechner/pi-agent-core";
import { LlmProtocolError } from "./errors.js";
import { renderEvalInput } from "./prompts/render.js";
import type { IntakeResult, Verdict } from "./types.js";

export function lastAssistantText(agent: Agent): string {
	for (let i = agent.state.messages.length - 1; i >= 0; i--) {
		const m = agent.state.messages[i];
		if (m?.role === "assistant") {
			if (typeof m.content === "string") return m.content;
			return m.content
				.filter((b): b is { type: "text"; text: string } => b.type === "text")
				.map((b) => b.text)
				.join("");
		}
	}
	throw new LlmProtocolError("No assistant message found in agent state.");
}

export function parseDrafterOutput(text: string): { draft: string; layman: string } {
	const marker = "\n---LAYMAN---\n";
	const idx = text.indexOf(marker);
	if (idx < 0) {
		// Try without leading newline (e.g., model emitted ---LAYMAN--- at start of line)
		const altIdx = text.indexOf("---LAYMAN---");
		if (altIdx < 0) throw new LlmProtocolError("Drafter output missing ---LAYMAN--- marker.");
		return {
			draft: text.slice(0, altIdx).trim(),
			layman: text.slice(altIdx + "---LAYMAN---".length).trim(),
		};
	}
	return { draft: text.slice(0, idx).trim(), layman: text.slice(idx + marker.length).trim() };
}

/**
 * Parse the drafter's last output; on missing `---LAYMAN---` marker, send a
 * format-reminder user message and try one more time. Second failure throws.
 * Per spec §12.3.
 *
 * The `onDump` callback is invoked with the offending raw text when BOTH attempts fail,
 * so the caller can write it to <session>/malformed-iter-N.txt before the throw propagates.
 */
export async function parseDrafterOutputWithRetry(
	agent: Agent,
	onDump?: (raw: string) => void,
): Promise<{ draft: string; layman: string }> {
	const first = lastAssistantText(agent);
	try {
		return parseDrafterOutput(first);
	} catch {
		await agent.prompt(
			"Your previous reply was missing the required `---LAYMAN---` separator on its own line. " +
				"Re-emit the full utility patent draft + layman explanation in the required two-block format.",
		);
		const second = lastAssistantText(agent);
		try {
			return parseDrafterOutput(second);
		} catch (err) {
			onDump?.(second);
			throw err;
		}
	}
}

export async function runEvaluation(
	agent: Agent,
	disclosure: string,
	intake: IntakeResult,
	draft: string,
	layman: string,
): Promise<{ verdict: Verdict; searchBackendFailed: boolean }> {
	let verdict: Verdict | null = null;
	let searchBackendFailed = false;

	const unsubscribe = agent.subscribe((event) => {
		if (event.type === "tool_execution_end" && event.toolName === "web_search") {
			// success-on-SearchError pattern (spec §10.3.1): kind survives in result.details
			const kind = (event.result.details as { kind?: string } | undefined)?.kind;
			if (kind === "backend" || kind === "auth" || kind === "rate_limit") {
				searchBackendFailed = true;
			}
		}
		if (event.type === "tool_execution_end" && event.toolName === "submit_verdict" && !event.isError) {
			verdict = event.result.details as Verdict;
		}
	});

	try {
		await agent.prompt(renderEvalInput(disclosure, intake, draft, layman));
	} finally {
		unsubscribe();
	}

	if (!verdict) throw new LlmProtocolError("Evaluator did not call submit_verdict.");
	return { verdict, searchBackendFailed };
}
