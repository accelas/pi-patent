import type { Agent } from "@mariozechner/pi-agent-core";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { lastAssistantText } from "./loop-helpers.js";

/**
 * Fallback parser for the failure mode described in issue #3.2:
 *
 * Some models (notably GPT-5 Codex variants) sometimes satisfy a structured
 * output contract by emitting a JSON object directly in the assistant message
 * instead of invoking the designated terminal tool call (`finalize_intake` /
 * `submit_verdict`). Our code paths that require the tool call would otherwise
 * throw `LlmProtocolError` and abort the run.
 *
 * This helper attempts the fallback in three steps, each stricter if earlier ones fail:
 *  1. Strip common markdown code-fence wrappers (```json ... ``` or ``` ... ```)
 *     and try `JSON.parse` on the whole message.
 *  2. Extract the first `{ ... }` span and try parsing that (handles prose-wrapped JSON).
 *  3. Validate the parsed value against the provided typebox schema via `Value.Check`.
 *
 * Returns the typed object on success, `null` on ANY failure so the caller can
 * fall back to throwing `LlmProtocolError` with the original semantics.
 *
 * @param agent the pi-agent-core Agent whose last assistant message to parse
 * @param schema the typebox schema to validate against
 */
export function tryParseAssistantAsSchema<T>(agent: Agent, schema: TSchema): T | null {
	let text: string;
	try {
		text = lastAssistantText(agent);
	} catch {
		return null;
	}

	// Step 1: strip code fences, try whole-message parse.
	const fenced = stripCodeFences(text);
	const direct = tryJsonParse(fenced);
	if (direct !== null && Value.Check(schema, direct)) return direct as T;

	// Step 2: extract the first balanced {...} span (handles prose wrappers).
	const span = extractFirstJsonObject(fenced);
	if (span !== null) {
		const extracted = tryJsonParse(span);
		if (extracted !== null && Value.Check(schema, extracted)) return extracted as T;
	}

	return null;
}

function stripCodeFences(text: string): string {
	const t = text.trim();
	// ```json\n...\n``` or ```\n...\n```
	const fenced = t.match(/^```(?:json|JSON)?\s*\n([\s\S]*?)\n```\s*$/);
	if (fenced?.[1]) return fenced[1].trim();
	return t;
}

function tryJsonParse(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

/**
 * Extract the first balanced JSON object from the text. Handles prose like:
 *   "Sure, here's the result: { ... } — hope that helps."
 * Returns null if no balanced object is found.
 *
 * Does NOT handle string-escapedd braces inside JSON strings perfectly — a close
 * brace inside a string would fool the depth counter. In practice, the result
 * still fails `JSON.parse` downstream when that happens, so the caller gets null.
 */
function extractFirstJsonObject(text: string): string | null {
	const start = text.indexOf("{");
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}
	return null;
}
