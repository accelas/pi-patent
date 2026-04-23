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
	it("includes anthropic, openai, openai-codex, google, groq", () => {
		expect(Object.keys(PROVIDER_META).sort()).toEqual(["anthropic", "google", "groq", "openai", "openai-codex"]);
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

	it("oauth-or-key: OAuth env var wins", () => {
		process.env.ANTHROPIC_OAUTH_TOKEN = "tok";
		// biome-ignore lint/performance/noDelete: test env cleanup
		delete process.env.ANTHROPIC_API_KEY;
		// biome-ignore lint/suspicious/noExplicitAny: stub cast for test
		expect(() => ensureCredentials("anthropic", "drafter", stubStore as any)).not.toThrow();
		// biome-ignore lint/performance/noDelete: test env cleanup
		delete process.env.ANTHROPIC_OAUTH_TOKEN;
	});

	it("oauth-or-key: falls back to env key", () => {
		// biome-ignore lint/performance/noDelete: test env cleanup
		delete process.env.ANTHROPIC_OAUTH_TOKEN;
		process.env.ANTHROPIC_API_KEY = "k";
		// biome-ignore lint/suspicious/noExplicitAny: stub cast for test
		expect(() => ensureCredentials("anthropic", "drafter", stubStore as any)).not.toThrow();
		// biome-ignore lint/performance/noDelete: test env cleanup
		delete process.env.ANTHROPIC_API_KEY;
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
