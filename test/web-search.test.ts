import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWebSearchTool } from "../src/tools/web-search.js";

beforeEach(() => {
	process.env.TAVILY_API_KEY = "k";
});
afterEach(() => {
	// biome-ignore lint/performance/noDelete: test env cleanup
	delete process.env.TAVILY_API_KEY;
	vi.restoreAllMocks();
});

describe("makeWebSearchTool", () => {
	it("returns success with details.kind='ok' on successful search", async () => {
		const tool = makeWebSearchTool("tavily");
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ results: [{ title: "T", url: "u", content: "c", score: 0.5 }] }),
		}) as unknown as typeof fetch;

		const result = await tool.execute("id", { query: "x" }, new AbortController().signal);
		expect((result.details as { kind: string }).kind).toBe("ok");
		expect((result.details as { count: number }).count).toBe(1);
	});

	it("on SearchError: returns success result with details.kind set, content says 'Search error'", async () => {
		const tool = makeWebSearchTool("tavily");
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => "boom",
		}) as unknown as typeof fetch;

		const result = await tool.execute("id", { query: "x" }, new AbortController().signal);
		expect((result.details as { kind: string }).kind).toBe("backend");
		const text = result.content[0] as { type: "text"; text: string };
		expect(text.text).toMatch(/Search error \(backend\)/);
	});
});
