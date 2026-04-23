import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionWriter, slugFromDisclosure } from "../src/artifacts.js";
import type { IntakeResult, ResolvedConfig, Verdict } from "../src/types.js";

const tmp = path.join(os.tmpdir(), `pi-patent-art-${Date.now()}`);
beforeEach(() => fs.mkdirSync(tmp, { recursive: true }));
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const cfg: ResolvedConfig = {
	max_iter: 5,
	thresholds: { claim_breadth: 4, claim_clarity: 4, spec_support: 4, basic_novelty: 4, layman_quality: 4 },
	out_dir: tmp,
	quiet: false,
	web_search: true,
	search_provider: "tavily",
	models: {
		intake: { provider: "anthropic", model: "claude-sonnet-4-6", thinking: "low" },
		drafter: { provider: "anthropic", model: "claude-sonnet-4-6", thinking: "medium" },
		evaluator: { provider: "anthropic", model: "claude-sonnet-4-6", thinking: "low" },
	},
};

const intake: IntakeResult = { accepted: true, scope_preference: "balanced" };

describe("slugFromDisclosure", () => {
	it("kebab-cases and truncates first line to 40 chars", () => {
		expect(
			slugFromDisclosure("A Cache Invalidation Protocol Using Bloom Filters Over Gossip\nBody...").length,
		).toBeLessThanOrEqual(40);
		expect(slugFromDisclosure("An AI Cache")).toBe("an-ai-cache");
	});
	it("falls back to 'patent' on empty", () => {
		expect(slugFromDisclosure("")).toBe("patent");
		expect(slugFromDisclosure("   \n   ")).toBe("patent");
	});
});

describe("SessionWriter", () => {
	it("creates session dir, writes initial session.json with status=running", () => {
		const sw = SessionWriter.create(tmp, "test", { intake, config: cfg });
		expect(fs.existsSync(path.join(sw.dir, "session.json"))).toBe(true);
		const sj = JSON.parse(fs.readFileSync(path.join(sw.dir, "session.json"), "utf-8"));
		expect(sj.status).toBe("running");
	});

	it("handles slug collision with -1 suffix", () => {
		const a = SessionWriter.create(tmp, "sameslug", { intake, config: cfg });
		const b = SessionWriter.create(tmp, "sameslug", { intake, config: cfg });
		expect(a.dir).not.toBe(b.dir);
		expect(b.dir.endsWith("-1") || b.dir.endsWith("-2")).toBe(true);
	});

	it("writeIteration writes three files", () => {
		const sw = SessionWriter.create(tmp, "t", { intake, config: cfg });
		const verdict: Verdict = {
			verdict: "revise",
			scores: { claim_breadth: 3, claim_clarity: 4, spec_support: 4, basic_novelty: 4, layman_quality: 4 },
			issues: [],
			summary: "",
		};
		sw.writeIteration(1, { draft: "DRAFT", layman: "LAYMAN", verdict });
		expect(fs.readFileSync(path.join(sw.dir, "iter-1-draft.md"), "utf-8")).toBe("DRAFT");
		expect(fs.readFileSync(path.join(sw.dir, "iter-1-layman.md"), "utf-8")).toBe("LAYMAN");
		expect(JSON.parse(fs.readFileSync(path.join(sw.dir, "iter-1-eval.json"), "utf-8")).verdict).toBe("revise");
	});

	it("writeAbort writes .aborted sentinel and sets status", () => {
		const sw = SessionWriter.create(tmp, "t", { intake, config: cfg });
		sw.writeAbort(2, "sigint");
		expect(fs.existsSync(path.join(sw.dir, ".aborted"))).toBe(true);
		const sj = JSON.parse(fs.readFileSync(path.join(sw.dir, "session.json"), "utf-8"));
		expect(sj.status).toBe("aborted");
		expect(sj.abort.last_completed).toBe(2);
	});

	it("writeError sets status=error and records category", () => {
		const sw = SessionWriter.create(tmp, "t", { intake, config: cfg });
		sw.writeError({ category: "llm_protocol", message: "boom", lastCompletedIteration: 1 });
		const sj = JSON.parse(fs.readFileSync(path.join(sw.dir, "session.json"), "utf-8"));
		expect(sj.status).toBe("error");
		expect(sj.error.category).toBe("llm_protocol");
		expect(sj.error.message).toBe("boom");
	});
});
