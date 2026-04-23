import { describe, expect, it } from "vitest";
import { CUSTOM_PROVIDERS, buildCustomModel } from "../src/agents/custom-models.js";

describe("buildCustomModel", () => {
	it("returns null for unknown providers", () => {
		expect(buildCustomModel("anthropic", "claude-sonnet-4-6")).toBeNull();
		expect(buildCustomModel("bogus", "x")).toBeNull();
	});

	it("constructs an openai-completions Model for openrouter", () => {
		const m = buildCustomModel("openrouter", "meta-llama/llama-3.3-70b-instruct");
		expect(m).not.toBeNull();
		expect(m?.id).toBe("meta-llama/llama-3.3-70b-instruct");
		expect(m?.api).toBe("openai-completions");
		expect(m?.provider).toBe("openrouter");
		expect(m?.baseUrl).toBe("https://openrouter.ai/api/v1");
	});

	it("accepts any model id — OpenRouter does the routing", () => {
		expect(buildCustomModel("openrouter", "openai/gpt-4o-mini")?.id).toBe("openai/gpt-4o-mini");
		expect(buildCustomModel("openrouter", "google/gemini-2.5-pro")?.id).toBe("google/gemini-2.5-pro");
	});

	it("CUSTOM_PROVIDERS set includes openrouter", () => {
		expect(CUSTOM_PROVIDERS.has("openrouter")).toBe(true);
	});
});
