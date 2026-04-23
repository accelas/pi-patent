import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeResolveApiKey } from "../src/oauth/resolve.js";

const fakeStore = {
	_entries: new Map<string, { access: string; refresh: string; expires: number }>(),
	has(id: string) {
		return this._entries.has(id);
	},
	load(id: string) {
		return this._entries.get(id) ?? null;
	},
	save(id: string, creds: { access: string; refresh: string; expires: number }) {
		this._entries.set(id, creds);
	},
};

beforeEach(() => {
	fakeStore._entries.clear();
});
afterEach(() => {
	// biome-ignore lint/performance/noDelete: test env cleanup
	delete process.env.ANTHROPIC_OAUTH_TOKEN;
	// biome-ignore lint/performance/noDelete: test env cleanup
	delete process.env.ANTHROPIC_API_KEY;
	// biome-ignore lint/performance/noDelete: test env cleanup
	delete process.env.OPENAI_API_KEY;
});

describe("resolveApiKey", () => {
	it("anthropic: ANTHROPIC_OAUTH_TOKEN wins if set", async () => {
		process.env.ANTHROPIC_OAUTH_TOKEN = "oauth-tok";
		process.env.ANTHROPIC_API_KEY = "api-key";
		const resolve = makeResolveApiKey({ store: fakeStore as never, getOAuthApiKey: vi.fn() });
		expect(await resolve("anthropic")).toBe("oauth-tok");
	});

	it("openai-codex: uses getOAuthApiKey and persists refresh", async () => {
		fakeStore.save("openai-codex", { access: "old", refresh: "r", expires: 0 });
		const refreshed = { access: "new", refresh: "r2", expires: 9999 };
		const getOAuthApiKey = vi.fn().mockResolvedValue({ newCredentials: refreshed, apiKey: "new" });
		const resolve = makeResolveApiKey({ store: fakeStore as never, getOAuthApiKey });

		const key = await resolve("openai-codex");
		expect(key).toBe("new");
		expect(fakeStore.load("openai-codex")).toEqual(refreshed);
	});

	it("unknown provider: falls back to getEnvApiKey", async () => {
		process.env.OPENAI_API_KEY = "env-k";
		const resolve = makeResolveApiKey({
			store: fakeStore as never,
			getOAuthApiKey: vi.fn(),
			getEnvApiKey: (p: string) => (p === "openai" ? "env-k" : undefined),
		});
		expect(await resolve("openai")).toBe("env-k");
	});
});
