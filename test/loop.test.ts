import { describe, expect, it, vi } from "vitest";
import { ralphLoop } from "../src/loop.js";
import type { IntakeResult, ResolvedConfig, Verdict } from "../src/types.js";

// --- fakes ---

// biome-ignore lint/suspicious/noExplicitAny: test fake agent
function fakeDrafter(outputs: string[]): any {
	let i = 0;
	// biome-ignore lint/suspicious/noExplicitAny: test fake message
	const messages: any[] = [];
	return {
		state: { messages },
		prompt: vi.fn(async (_: string) => {
			messages.push({ role: "user", content: _ });
			const text = outputs[i++] ?? outputs[outputs.length - 1];
			messages.push({ role: "assistant", content: [{ type: "text", text }] });
		}),
		abort: vi.fn(),
		subscribe: vi.fn(() => () => undefined),
	};
}

// biome-ignore lint/suspicious/noExplicitAny: test fake agent
function fakeEvaluator(verdict: Verdict, searchBackendFailed = false): any {
	return {
		state: { messages: [] },
		prompt: vi.fn(async () => undefined),
		abort: vi.fn(),
		// biome-ignore lint/suspicious/noExplicitAny: test event callback
		subscribe: vi.fn((cb: any) => {
			// immediately emit submit_verdict + optionally a failed web_search
			if (searchBackendFailed) {
				cb({
					type: "tool_execution_end",
					toolName: "web_search",
					isError: false,
					result: { details: { kind: "backend" } },
				});
			}
			cb({
				type: "tool_execution_end",
				toolName: "submit_verdict",
				isError: false,
				result: { details: verdict },
			});
			return () => undefined;
		}),
	};
}

const intake: IntakeResult = { accepted: true, scope_preference: "balanced" };
const baseCfg: ResolvedConfig = {
	max_iter: 5,
	thresholds: { claim_breadth: 4, claim_clarity: 4, spec_support: 4, basic_novelty: 4, layman_quality: 4 },
	out_dir: "/tmp",
	quiet: false,
	web_search: true,
	search_provider: "tavily",
	models: {
		intake: { provider: "anthropic", model: "m", thinking: "low" },
		drafter: { provider: "anthropic", model: "m", thinking: "medium" },
		evaluator: { provider: "anthropic", model: "m", thinking: "low" },
	},
};

const passingVerdict: Verdict = {
	verdict: "pass",
	scores: { claim_breadth: 4, claim_clarity: 4, spec_support: 4, basic_novelty: 4, layman_quality: 4 },
	issues: [],
	summary: "ok",
};
const revisingVerdict = {
	verdict: "revise",
	scores: { claim_breadth: 3, claim_clarity: 4, spec_support: 4, basic_novelty: 4, layman_quality: 4 },
	issues: [{ axis: "claim_breadth", issue: "narrow", suggestion: "broaden", priority: "high" }],
	summary: "revise",
} as unknown as Verdict;

const okOutput = "DRAFT\n---LAYMAN---\nLAYMAN";

const fakeSession = {
	writeIteration: vi.fn(),
	writeFinal: vi.fn(),
	writeAbort: vi.fn(),
	writeError: vi.fn(),
	writeInput: vi.fn(),
	updateUsage: vi.fn(),
	dir: "/tmp/x",
};

describe("ralphLoop", () => {
	it("exits 'passed' on iter-1 pass", async () => {
		const result = await ralphLoop({
			disclosure: "d",
			intake,
			config: baseCfg,
			makeDrafter: () => fakeDrafter([okOutput]),
			makeEvaluator: () => fakeEvaluator(passingVerdict),
			// biome-ignore lint/suspicious/noExplicitAny: fake session writer
			session: fakeSession as any,
		});
		expect(result.status).toBe("passed");
		if (result.status === "passed") expect(result.iterations).toBe(1);
	});

	it("exits 'passed' on iter-3 after two revises", async () => {
		const evals = [revisingVerdict, revisingVerdict, passingVerdict];
		let i = 0;
		const result = await ralphLoop({
			disclosure: "d",
			intake,
			config: baseCfg,
			makeDrafter: () => fakeDrafter([okOutput, okOutput, okOutput]),
			makeEvaluator: () => fakeEvaluator(evals[i++] ?? passingVerdict),
			// biome-ignore lint/suspicious/noExplicitAny: fake session writer
			session: fakeSession as any,
		});
		expect(result.status).toBe("passed");
		if (result.status === "passed") expect(result.iterations).toBe(3);
	});

	it("exits 'max_iter' when never passes", async () => {
		const result = await ralphLoop({
			disclosure: "d",
			intake,
			config: { ...baseCfg, max_iter: 2 },
			makeDrafter: () => fakeDrafter([okOutput, okOutput]),
			makeEvaluator: () => fakeEvaluator(revisingVerdict),
			// biome-ignore lint/suspicious/noExplicitAny: fake session writer
			session: fakeSession as any,
		});
		expect(result.status).toBe("max_iter");
	});

	it("throws SearchBackendError after 3 consecutive backend failures", async () => {
		await expect(
			ralphLoop({
				disclosure: "d",
				intake,
				config: baseCfg,
				makeDrafter: () => fakeDrafter([okOutput, okOutput, okOutput]),
				makeEvaluator: () => fakeEvaluator(revisingVerdict, true),
				// biome-ignore lint/suspicious/noExplicitAny: fake session writer
				session: fakeSession as any,
			}),
		).rejects.toThrow(/consecutive iterations/);
	});

	it("downgrades 'pass' to 'revise' when evaluator lies about scores", async () => {
		const lyingVerdict: Verdict = {
			verdict: "pass",
			scores: { ...passingVerdict.scores, claim_breadth: 2 },
			issues: [],
			summary: "lied",
		};
		const result = await ralphLoop({
			disclosure: "d",
			intake,
			config: { ...baseCfg, max_iter: 1 },
			makeDrafter: () => fakeDrafter([okOutput]),
			makeEvaluator: () => fakeEvaluator(lyingVerdict),
			// biome-ignore lint/suspicious/noExplicitAny: fake session writer
			session: fakeSession as any,
		});
		expect(result.status).toBe("max_iter"); // downgraded → not pass
	});

	it("downgrades 'pass' to 'revise' on high-overlap prior-art flag", async () => {
		const flaggedVerdict: Verdict = {
			...passingVerdict,
			prior_art_flags: [{ title: "US 10,000,000", overlap: "reads on claim 1", overlap_level: "high" }],
		};
		const result = await ralphLoop({
			disclosure: "d",
			intake,
			config: { ...baseCfg, max_iter: 1 },
			makeDrafter: () => fakeDrafter([okOutput]),
			makeEvaluator: () => fakeEvaluator(flaggedVerdict),
			// biome-ignore lint/suspicious/noExplicitAny: fake session writer
			session: fakeSession as any,
		});
		expect(result.status).toBe("max_iter"); // downgraded — high overlap blocks pass
	});

	it("boundary: score equal to threshold passes (>=, not >)", async () => {
		const boundaryVerdict: Verdict = {
			verdict: "pass",
			scores: { claim_breadth: 4, claim_clarity: 4, spec_support: 4, basic_novelty: 4, layman_quality: 4 },
			issues: [],
			summary: "at threshold",
		};
		const result = await ralphLoop({
			disclosure: "d",
			intake,
			config: baseCfg,
			makeDrafter: () => fakeDrafter([okOutput]),
			makeEvaluator: () => fakeEvaluator(boundaryVerdict),
			// biome-ignore lint/suspicious/noExplicitAny: fake session writer
			session: fakeSession as any,
		});
		expect(result.status).toBe("passed");
	});
});
