import { beforeEach, describe, expect, it } from "vitest";
import { UserError } from "../src/errors.js";
import { PROVIDER_META, ensureCredentials } from "../src/providers.js";

const stubStore = {
	_has: new Set<string>(),
	has(id: string) {
		return this._has.has(id);
	},
	load() {
		throw new Error("not used in these tests");
	},
	save() {
		throw new Error("not used in these tests");
	},
};

describe("PROVIDER_META", () => {
	it("includes anthropic, openai, openai-codex, google, groq, openrouter", () => {
		expect(Object.keys(PROVIDER_META).sort()).toEqual([
			"anthropic",
			"google",
			"groq",
			"openai",
			"openai-codex",
			"openrouter",
		]);
	});

	it("openrouter uses OPENROUTER_API_KEY", () => {
		expect(PROVIDER_META.openrouter.kind).toBe("api-key");
		expect((PROVIDER_META.openrouter as { envKey: string }).envKey).toBe("OPENROUTER_API_KEY");
	});

	it("openai-codex kind is oauth with oauthProviderId", () => {
		expect(PROVIDER_META["openai-codex"].kind).toBe("oauth");
		expect(PROVIDER_META["openai-codex"].oauthProviderId).toBe("openai-codex");
	});

	it("google uses GEMINI_API_KEY not GOOGLE_API_KEY", () => {
		expect(PROVIDER_META.google.envKey).toBe("GEMINI_API_KEY");
	});
});

describe("ensureCredentials", () => {
	beforeEach(() => {
		stubStore._has.clear();
	});

	it("throws UserError for unknown provider", () => {
		// biome-ignore lint/suspicious/noExplicitAny: stub cast for test
		expect(() => ensureCredentials("amazon-bedrock", "drafter", stubStore as any)).toThrow(UserError);
	});

	it("anthropic: api-key — requires $ANTHROPIC_API_KEY (OAuth removed 2026-04 per vendor ToS)", () => {
		// biome-ignore lint/performance/noDelete: test env cleanup
		delete process.env.ANTHROPIC_API_KEY;
		expect(() => ensureCredentials("anthropic", "drafter", stubStore as never)).toThrow(/ANTHROPIC_API_KEY/);
		process.env.ANTHROPIC_API_KEY = "k";
		expect(() => ensureCredentials("anthropic", "drafter", stubStore as never)).not.toThrow();
		// biome-ignore lint/performance/noDelete: test env cleanup
		delete process.env.ANTHROPIC_API_KEY;
	});

	it("anthropic: store-backed creds do NOT satisfy preflight (OAuth path gone)", () => {
		// biome-ignore lint/performance/noDelete: test env cleanup
		delete process.env.ANTHROPIC_API_KEY;
		stubStore._has.add("anthropic"); // leftover from a pre-0.1.2 install
		expect(() => ensureCredentials("anthropic", "drafter", stubStore as never)).toThrow(/ANTHROPIC_API_KEY/);
	});

	it("oauth: requires credentialStore entry", () => {
		// biome-ignore lint/suspicious/noExplicitAny: stub cast for test
		expect(() => ensureCredentials("openai-codex", "drafter", stubStore as any)).toThrow(/pi-patent login codex/);
		stubStore._has.add("openai-codex");
		// biome-ignore lint/suspicious/noExplicitAny: stub cast for test
		expect(() => ensureCredentials("openai-codex", "drafter", stubStore as any)).not.toThrow();
	});

	it("api-key: requires env key", () => {
		// biome-ignore lint/performance/noDelete: test env cleanup
		delete process.env.OPENAI_API_KEY;
		// biome-ignore lint/suspicious/noExplicitAny: stub cast for test
		expect(() => ensureCredentials("openai", "drafter", stubStore as any)).toThrow(/OPENAI_API_KEY/);
		process.env.OPENAI_API_KEY = "k";
		// biome-ignore lint/suspicious/noExplicitAny: stub cast for test
		expect(() => ensureCredentials("openai", "drafter", stubStore as any)).not.toThrow();
		// biome-ignore lint/performance/noDelete: test env cleanup
		delete process.env.OPENAI_API_KEY;
	});
});
