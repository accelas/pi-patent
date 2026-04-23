import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { IntakeResultSchema, VerdictSchema } from "../src/types.js";

describe("schemas", () => {
	it("IntakeResultSchema validates a minimal accepted intake", () => {
		const ok = { accepted: true, scope_preference: "balanced" };
		expect(Value.Check(IntakeResultSchema, ok)).toBe(true);
	});

	it("IntakeResultSchema validates a rejection", () => {
		const ok = { accepted: false, rejection_reason: "no technical content" };
		expect(Value.Check(IntakeResultSchema, ok)).toBe(true);
	});

	it("VerdictSchema requires scores 1..5 on every axis", () => {
		const ok = {
			verdict: "pass",
			scores: { claim_breadth: 4, claim_clarity: 4, spec_support: 5, basic_novelty: 4, layman_quality: 4 },
			issues: [],
			summary: "looks good",
		};
		expect(Value.Check(VerdictSchema, ok)).toBe(true);

		const bad = { ...ok, scores: { ...ok.scores, claim_breadth: 6 } };
		expect(Value.Check(VerdictSchema, bad)).toBe(false);
	});

	it("VerdictSchema requires overlap_level on prior_art_flags", () => {
		const base = {
			verdict: "revise" as const,
			scores: { claim_breadth: 3, claim_clarity: 4, spec_support: 4, basic_novelty: 2, layman_quality: 4 },
			issues: [],
			summary: "needs work",
		};
		const missingLevel = { ...base, prior_art_flags: [{ title: "X", overlap: "similar" }] };
		expect(Value.Check(VerdictSchema, missingLevel)).toBe(false);

		const withLevel = { ...base, prior_art_flags: [{ title: "X", overlap: "similar", overlap_level: "high" }] };
		expect(Value.Check(VerdictSchema, withLevel)).toBe(true);
	});
});
