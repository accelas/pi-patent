import { describe, expect, it } from "vitest";
import { promptVarsFor, renderCritique, renderEvalInput, renderSeed } from "../src/prompts/render.js";
import type { IntakeResult, ResolvedConfig, Verdict } from "../src/types.js";

const intake: IntakeResult = {
	accepted: true,
	scope_preference: "balanced",
	technical_field: "distributed cache coherence",
	core_novelty: "uses bloom filters for invalidation",
};

describe("renderSeed", () => {
	it("includes disclosure and intake fields", () => {
		const out = renderSeed("An AI cache invalidator.", intake);
		expect(out).toContain("An AI cache invalidator.");
		expect(out).toContain("scope_preference: balanced");
		expect(out).toContain("technical_field: distributed cache coherence");
		expect(out).toContain("Emit the patent draft + layman block now.");
	});

	it("omits absent optional fields", () => {
		const bare: IntakeResult = { accepted: true, scope_preference: "broad" };
		const out = renderSeed("X", bare);
		expect(out).not.toContain("technical_field");
	});
});

describe("renderEvalInput", () => {
	it("embeds draft and layman separately", () => {
		const out = renderEvalInput("disclose", intake, "DRAFT-TEXT", "LAYMAN-TEXT");
		expect(out).toContain("DRAFT-TEXT");
		expect(out).toContain("LAYMAN-TEXT");
		expect(out).toContain("submit_verdict");
	});
});

describe("renderCritique", () => {
	const verdict = {
		verdict: "revise",
		scores: { claim_breadth: 3, claim_clarity: 4, spec_support: 5, basic_novelty: 4, layman_quality: 3 },
		issues: [
			{ axis: "claim_breadth", issue: "too narrow to Redis", suggestion: "generalize to KV store", priority: "high" },
			{ axis: "layman_quality", issue: "assumes bloom filters", suggestion: "define the term", priority: "high" },
		],
		next_iteration_focus: "Broaden claim 1 first.",
		summary: "2 axes below threshold",
	} as unknown as Verdict;

	it("puts next_iteration_focus above issue list", () => {
		const out = renderCritique(verdict, 2);
		const focusIdx = out.indexOf("Focus for this iteration");
		const issuesIdx = out.indexOf("Axes below threshold");
		expect(focusIdx).toBeGreaterThan(-1);
		expect(focusIdx).toBeLessThan(issuesIdx);
	});

	it("lists passing axes as do-not-regress", () => {
		const out = renderCritique(verdict, 2);
		expect(out).toContain("Do not regress");
		expect(out).toMatch(/claim_clarity \(4\)/);
	});
});

describe("promptVarsFor", () => {
	const cfg: Partial<ResolvedConfig> = {
		thresholds: { claim_breadth: 4, claim_clarity: 4, spec_support: 4, basic_novelty: 3, layman_quality: 4 },
	};

	it("evaluator vars include thresholds_list", () => {
		const vars = promptVarsFor("evaluator", cfg as ResolvedConfig);
		expect(vars.thresholds_list).toMatch(/basic_novelty ≥ 3/);
		expect(vars.thresholds_list).toMatch(/claim_breadth ≥ 4/);
	});

	it("intake and drafter have no vars in v1", () => {
		expect(promptVarsFor("intake", cfg as ResolvedConfig)).toEqual({});
		expect(promptVarsFor("drafter", cfg as ResolvedConfig)).toEqual({});
	});
});
