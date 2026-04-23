import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
	it("returns defaults when no TOML + no overrides", () => {
		const cfg = loadConfig({ tomlSource: null, cliArgs: {} });
		expect(cfg.max_iter).toBe(5);
		expect(cfg.thresholds).toEqual({
			claim_breadth: 4,
			claim_clarity: 4,
			spec_support: 4,
			basic_novelty: 4,
			layman_quality: 4,
		});
		expect(cfg.models.drafter.thinking).toBe("medium");
		expect(cfg.models.intake.thinking).toBe("low");
		expect(cfg.models.evaluator.thinking).toBe("low");
		expect(cfg.models.drafter.provider).toBe("anthropic");
		expect(cfg.models.drafter.model).toBe("claude-sonnet-4-6");
	});

	it("merges [rubric] axis overrides onto default_axis_threshold", () => {
		const toml = `
default_axis_threshold = 4
[rubric]
basic_novelty = 3
`;
		const cfg = loadConfig({ tomlSource: toml, cliArgs: {} });
		expect(cfg.thresholds.basic_novelty).toBe(3);
		expect(cfg.thresholds.claim_breadth).toBe(4);
	});

	it("CLI max_iter overrides TOML", () => {
		const cfg = loadConfig({ tomlSource: "max_iter = 5", cliArgs: { maxIter: 2 } });
		expect(cfg.max_iter).toBe(2);
	});

	it("CLI --no-web sets web_search false", () => {
		const cfg = loadConfig({ tomlSource: "web_search = true", cliArgs: { web_search: false } });
		expect(cfg.web_search).toBe(false);
	});

	it("[models.drafter] overrides role-specific model", () => {
		const toml = `
provider = "anthropic"
model = "claude-sonnet-4-6"

[models.drafter]
provider = "openai-codex"
model = "gpt-5.3-codex"
`;
		const cfg = loadConfig({ tomlSource: toml, cliArgs: {} });
		expect(cfg.models.drafter.provider).toBe("openai-codex");
		expect(cfg.models.drafter.model).toBe("gpt-5.3-codex");
		expect(cfg.models.evaluator.provider).toBe("anthropic");
	});

	it("expands ~ in out_dir", () => {
		const cfg = loadConfig({ tomlSource: `out_dir = "~/patents"`, cliArgs: {}, homeDir: "/home/t" });
		expect(cfg.out_dir).toBe("/home/t/patents");
	});
});
