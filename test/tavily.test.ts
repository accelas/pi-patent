import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserError } from "../src/errors.js";
import { TavilyProvider } from "../src/tools/search/providers/tavily.js";
import { SearchError } from "../src/tools/search/types.js";

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

beforeEach(() => {
	globalThis.fetch = mockFetch as unknown as typeof fetch;
	process.env.TAVILY_API_KEY = "test-key";
});
afterEach(() => {
	globalThis.fetch = originalFetch;
	delete process.env.TAVILY_API_KEY;
	mockFetch.mockReset();
});

describe("TavilyProvider.validate", () => {
	it("throws UserError when key absent", () => {
		delete process.env.TAVILY_API_KEY;
		expect(() => new TavilyProvider().validate()).toThrow(UserError);
	});

	it("passes with key set", () => {
		expect(() => new TavilyProvider().validate()).not.toThrow();
	});
});

describe("TavilyProvider.search", () => {
	it("normalizes Tavily results into SearchResult shape", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({
				results: [{ title: "T", url: "https://x", content: "snip", score: 0.9, extra: "ignored" }],
			}),
		});
		const p = new TavilyProvider();
		const r = await p.search("q");
		expect(r).toEqual([{ title: "T", url: "https://x", snippet: "snip", score: 0.9 }]);
	});

	it.each([
		[500, "backend"],
		[503, "backend"],
		[401, "auth"],
		[403, "auth"],
		[429, "rate_limit"],
		[400, "bad_request"],
		[418, "bad_request"],
	] as const)("status %i → kind %s", async (status, kind) => {
		mockFetch.mockResolvedValue({ ok: false, status, text: async () => "err" });
		const p = new TavilyProvider();
		try {
			await p.search("q");
			expect.fail("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(SearchError);
			expect((e as SearchError).kind).toBe(kind);
		}
	});

	it("network failure → backend", async () => {
		mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
		try {
			await new TavilyProvider().search("q");
			expect.fail("should throw");
		} catch (e) {
			expect((e as SearchError).kind).toBe("backend");
		}
	});
});
