import { describe, expect, it } from "vitest";
import { finalizeIntakeTool, makeAskUserTool, submitVerdictTool } from "../src/tools/agent-tools.js";

describe("askUserTool", () => {
	it("execute returns answer + details with question/options/answer", async () => {
		const tool = makeAskUserTool(async () => "balanced");
		const result = await tool.execute("id", { question: "scope?" }, new AbortController().signal);
		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toBe("balanced");
		expect((result.details as { answer: string }).answer).toBe("balanced");
		expect((result.details as { question: string }).question).toBe("scope?");
	});
});

describe("finalizeIntakeTool", () => {
	it("terminate=true and details carry the parsed IntakeResult", async () => {
		const args = { accepted: true, scope_preference: "balanced" as const };
		const result = await finalizeIntakeTool.execute("id", args, new AbortController().signal);
		expect(result.terminate).toBe(true);
		expect(result.details).toEqual(args);
	});
});

describe("submitVerdictTool", () => {
	it("terminate=true and details carry the parsed Verdict", async () => {
		const args = {
			verdict: "pass" as const,
			scores: {
				claim_breadth: 4 as const,
				claim_clarity: 4 as const,
				spec_support: 4 as const,
				basic_novelty: 4 as const,
				layman_quality: 4 as const,
			},
			issues: [],
			summary: "ok",
		};
		const result = await submitVerdictTool.execute("id", args, new AbortController().signal);
		expect(result.terminate).toBe(true);
		expect(result.details).toEqual(args);
	});
});
