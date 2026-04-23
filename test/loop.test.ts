import { describe, expect, it, vi } from "vitest";
import { type LoopEvent, detectRegression, ralphLoop, scoreOf } from "../src/loop.js";
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

	describe("keep-best + regression tracking (v0.2)", () => {
		it("scoreOf: passing-axis count dominates sum", () => {
			// Use thresholds=3 for this test so the passing-count rank is meaningful.
			const t: ResolvedConfig["thresholds"] = {
				claim_breadth: 3,
				claim_clarity: 3,
				spec_support: 3,
				basic_novelty: 3,
				layman_quality: 3,
			};
			// Verdict A: all 5 axes at 3 (all passing threshold 3) → 5*100 + 15 = 515
			const a: Verdict = {
				verdict: "revise",
				scores: { claim_breadth: 3, claim_clarity: 3, spec_support: 3, basic_novelty: 3, layman_quality: 3 },
				issues: [],
				summary: "",
			};
			// Verdict B: one axis at 5, rest at 2 (only 1 passing) → 1*100 + 13 = 113
			const b: Verdict = {
				verdict: "revise",
				scores: { claim_breadth: 5, claim_clarity: 2, spec_support: 2, basic_novelty: 2, layman_quality: 2 },
				issues: [],
				summary: "",
			};
			expect(scoreOf(a, t)).toBeGreaterThan(scoreOf(b, t));
			expect(scoreOf(a, t)).toBe(515);
			expect(scoreOf(b, t)).toBe(113);
		});

		it("detectRegression: returns axes dropping by ≥2, ignores ≤1 (noise)", () => {
			const best: Verdict = {
				verdict: "revise",
				scores: { claim_breadth: 5, claim_clarity: 4, spec_support: 4, basic_novelty: 3, layman_quality: 5 },
				issues: [],
				summary: "",
			};
			const cur: Verdict = {
				verdict: "revise",
				scores: {
					claim_breadth: 3, // -2 → regressed
					claim_clarity: 3, // -1 → noise, ignored
					spec_support: 2, // -2 → regressed
					basic_novelty: 3, // equal
					layman_quality: 5, // equal
				},
				issues: [],
				summary: "",
			};
			const r = detectRegression(cur, best);
			expect(r).toEqual([
				{ axis: "claim_breadth", from: 5, to: 3 },
				{ axis: "spec_support", from: 4, to: 2 },
			]);
		});

		it("keep-best: on max_iter, promotes the highest-scoring iteration", async () => {
			// iter 1: 5 passing axes (all 4) — BEST
			// iter 2: 3 passing axes, 2 below — worse
			// iter 3: 4 passing axes, 1 below — middle
			// With max_iter=3, draft.md should be iter 1's.
			const verdicts: Verdict[] = [
				{
					verdict: "revise",
					scores: { claim_breadth: 4, claim_clarity: 4, spec_support: 4, basic_novelty: 4, layman_quality: 4 },
					issues: [
						{ axis: "claim_clarity", issue: "evaluator still says revise", suggestion: "x", priority: "high" },
					] as unknown as Verdict["issues"],
					summary: "iter1",
				},
				{
					verdict: "revise",
					scores: { claim_breadth: 2, claim_clarity: 2, spec_support: 4, basic_novelty: 4, layman_quality: 4 },
					issues: [],
					summary: "iter2",
				},
				{
					verdict: "revise",
					scores: { claim_breadth: 3, claim_clarity: 3, spec_support: 4, basic_novelty: 4, layman_quality: 4 },
					issues: [],
					summary: "iter3",
				},
			];
			const drafterOutputs = [
				"DRAFT-A\n---LAYMAN---\nLA-A",
				"DRAFT-B\n---LAYMAN---\nLA-B",
				"DRAFT-C\n---LAYMAN---\nLA-C",
			];
			let evalIdx = 0;

			const writeFinal = vi.fn();
			const session = {
				dir: "/tmp/fake-session",
				writeIteration: vi.fn(),
				writeFinal,
				writeAbort: vi.fn(),
				writeError: vi.fn(),
				writeMalformed: vi.fn(),
				writeInput: vi.fn(),
				updateUsage: vi.fn(),
			};

			const result = await ralphLoop({
				disclosure: "d",
				intake,
				config: { ...baseCfg, max_iter: 3 },
				makeDrafter: () => fakeDrafter(drafterOutputs),
				makeEvaluator: () => {
					const v = verdicts[evalIdx++] ?? verdicts[verdicts.length - 1];
					if (!v) throw new Error("fake evaluator ran out of verdicts");
					return fakeEvaluator(v);
				},
				// biome-ignore lint/suspicious/noExplicitAny: fake session writer
				session: session as any,
			});

			expect(result.status).toBe("max_iter");
			// Final written draft should be iter 1's (the best one), not iter 3's.
			expect(writeFinal).toHaveBeenCalledTimes(1);
			const finalCall = writeFinal.mock.calls[0]?.[0];
			expect(finalCall.draft).toBe("DRAFT-A");
			expect(finalCall.layman).toBe("LA-A");
			expect(finalCall.verdict.summary).toBe("iter1");
		});

		it("LoopEvent iter_done carries regressed flag when axes dropped ≥2 from best-so-far", async () => {
			const bestish: Verdict = {
				verdict: "revise",
				scores: { claim_breadth: 4, claim_clarity: 4, spec_support: 4, basic_novelty: 4, layman_quality: 4 },
				issues: [],
				summary: "iter1",
			};
			const worse: Verdict = {
				verdict: "revise",
				scores: { claim_breadth: 2, claim_clarity: 2, spec_support: 4, basic_novelty: 4, layman_quality: 4 },
				issues: [],
				summary: "iter2",
			};
			const events: LoopEvent[] = [];
			const verdicts = [bestish, worse];
			let evalIdx = 0;
			await ralphLoop({
				disclosure: "d",
				intake,
				config: { ...baseCfg, max_iter: 2 },
				makeDrafter: () => fakeDrafter(["D1\n---LAYMAN---\nL1", "D2\n---LAYMAN---\nL2"]),
				makeEvaluator: () => {
					const v = verdicts[evalIdx++] ?? verdicts[verdicts.length - 1];
					if (!v) throw new Error("fake evaluator ran out of verdicts");
					return fakeEvaluator(v);
				},
				// biome-ignore lint/suspicious/noExplicitAny: fake session writer
				session: fakeSession as any,
				onProgress: (ev) => events.push(ev),
			});
			const iter2Done = events.find((e) => e.type === "iter_done" && e.iteration === 2);
			expect(iter2Done).toBeDefined();
			if (iter2Done && iter2Done.type === "iter_done") {
				expect(iter2Done.regressed).toBe(true);
				expect(iter2Done.regressedAxes).toEqual([
					{ axis: "claim_breadth", from: 4, to: 2 },
					{ axis: "claim_clarity", from: 4, to: 2 },
				]);
			}
		});
	});
});
