import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LlmProtocolError, UserError } from "../src/errors.js";
import { loadPromptFrom, stripFrontmatter, substitute } from "../src/prompts/load.js";

describe("stripFrontmatter", () => {
	it("removes YAML frontmatter", () => {
		const out = stripFrontmatter("---\nname: x\n---\n\nHello");
		expect(out.trim()).toBe("Hello");
	});
	it("returns input unchanged when no frontmatter", () => {
		expect(stripFrontmatter("Hello")).toBe("Hello");
	});
});

describe("substitute", () => {
	it("replaces {{var}} with string values", () => {
		expect(substitute("a {{x}} b", { x: "Y" })).toBe("a Y b");
	});
	it("throws on unresolved placeholder", () => {
		expect(() => substitute("a {{x}} b", {})).toThrow(LlmProtocolError);
	});
});

describe("loadPromptFrom", () => {
	const dir = path.join(os.tmpdir(), `pi-patent-test-${Date.now()}`);
	beforeEach(() => fs.mkdirSync(dir, { recursive: true }));
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	it("throws UserError when file not found", () => {
		expect(() => loadPromptFrom(dir, "missing", {})).toThrow(UserError);
	});

	it("loads + substitutes", () => {
		fs.writeFileSync(path.join(dir, "greet.md"), "---\nname: greet\n---\nHi {{who}}.");
		expect(loadPromptFrom(dir, "greet", { who: "Kai" })).toBe("Hi Kai.");
	});
});
