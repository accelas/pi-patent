import { describe, expect, it } from "vitest";
import { tryParseAssistantAsSchema } from "../src/schema-fallback.js";
import { type IntakeResult, IntakeResultSchema } from "../src/types.js";

// biome-ignore lint/suspicious/noExplicitAny: test fake
function agentWithAssistantText(text: string): any {
	return {
		state: {
			messages: [
				{ role: "user", content: "prompt" },
				{ role: "assistant", content: [{ type: "text", text }] },
			],
		},
	};
}

describe("tryParseAssistantAsSchema", () => {
	const validIntake: IntakeResult = { accepted: true, scope_preference: "balanced" };

	it("parses a pure JSON assistant message", () => {
		const agent = agentWithAssistantText(JSON.stringify(validIntake));
		const r = tryParseAssistantAsSchema<IntakeResult>(agent, IntakeResultSchema);
		expect(r).toEqual(validIntake);
	});

	it("parses a message wrapped in ```json ... ``` fences", () => {
		const agent = agentWithAssistantText(`\`\`\`json\n${JSON.stringify(validIntake, null, 2)}\n\`\`\``);
		const r = tryParseAssistantAsSchema<IntakeResult>(agent, IntakeResultSchema);
		expect(r).toEqual(validIntake);
	});

	it("parses a message wrapped in ``` ... ``` fences (no language tag)", () => {
		const agent = agentWithAssistantText(`\`\`\`\n${JSON.stringify(validIntake)}\n\`\`\``);
		const r = tryParseAssistantAsSchema<IntakeResult>(agent, IntakeResultSchema);
		expect(r).toEqual(validIntake);
	});

	it("extracts first {...} block when prose wraps the JSON", () => {
		const agent = agentWithAssistantText(
			`Sure, here's the finalized intake: ${JSON.stringify(validIntake)} — let me know if you need more.`,
		);
		const r = tryParseAssistantAsSchema<IntakeResult>(agent, IntakeResultSchema);
		expect(r).toEqual(validIntake);
	});

	it("handles JSON containing strings with braces inside", () => {
		const intakeWithBraces: IntakeResult = {
			accepted: true,
			scope_preference: "balanced",
			core_novelty: "uses {key:value} shorthand for config",
		};
		const agent = agentWithAssistantText(JSON.stringify(intakeWithBraces));
		const r = tryParseAssistantAsSchema<IntakeResult>(agent, IntakeResultSchema);
		expect(r).toEqual(intakeWithBraces);
	});

	it("returns null when JSON is valid but schema doesn't match", () => {
		const agent = agentWithAssistantText(JSON.stringify({ accepted: "yes" })); // wrong type
		expect(tryParseAssistantAsSchema<IntakeResult>(agent, IntakeResultSchema)).toBeNull();
	});

	it("returns null when the message is plain prose with no JSON", () => {
		const agent = agentWithAssistantText("I'm still thinking about this one.");
		expect(tryParseAssistantAsSchema<IntakeResult>(agent, IntakeResultSchema)).toBeNull();
	});

	it("returns null when JSON is malformed", () => {
		const agent = agentWithAssistantText('{"accepted": true, "scope_preference": "balanced",}'); // trailing comma
		// The first {...} extraction will include the trailing comma and fail.
		expect(tryParseAssistantAsSchema<IntakeResult>(agent, IntakeResultSchema)).toBeNull();
	});

	it("returns null when the agent has no assistant message", () => {
		// biome-ignore lint/suspicious/noExplicitAny: test fake
		const agent: any = { state: { messages: [{ role: "user", content: "hi" }] } };
		expect(tryParseAssistantAsSchema<IntakeResult>(agent, IntakeResultSchema)).toBeNull();
	});
});
