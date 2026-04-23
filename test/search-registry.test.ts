import { describe, expect, it } from "vitest";
import { UserError } from "../src/errors.js";
import { SearchError } from "../src/tools/search/types.js";
import { getSearchProvider } from "../src/tools/search/index.js";

describe("SearchError", () => {
	it("carries kind and message", () => {
		const e = new SearchError("backend", "oops");
		expect(e.kind).toBe("backend");
		expect(e.message).toBe("oops");
	});
});

describe("getSearchProvider", () => {
	it("returns tavily", () => {
		const p = getSearchProvider("tavily");
		expect(p.name).toBe("tavily");
	});

	it("throws UserError for unknown provider with list", () => {
		expect(() => getSearchProvider("bogus")).toThrow(UserError);
		try {
			getSearchProvider("bogus");
		} catch (e) {
			expect((e as Error).message).toContain("tavily");
		}
	});
});
