import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileCredentialStore } from "../src/oauth/store.js";

const tmpDir = path.join(os.tmpdir(), `pi-patent-store-${Date.now()}`);
let store: FileCredentialStore;

beforeEach(() => {
	fs.mkdirSync(tmpDir, { recursive: true });
	store = new FileCredentialStore(tmpDir);
});
afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("FileCredentialStore", () => {
	it("has() is false initially", () => {
		expect(store.has("openai-codex")).toBe(false);
	});

	it("save then load round-trips OAuthCredentials", () => {
		const creds = { access: "a", refresh: "r", expires: 123 };
		store.save("openai-codex", creds as never);
		expect(store.has("openai-codex")).toBe(true);
		expect(store.load("openai-codex")).toEqual(creds);
	});

	it("load returns null when absent", () => {
		expect(store.load("anthropic")).toBeNull();
	});

	it("file is mode 0600", () => {
		store.save("anthropic", { access: "x" } as never);
		const stat = fs.statSync(path.join(tmpDir, "anthropic.json"));
		expect(stat.mode & 0o777).toBe(0o600);
	});

	it("load throws UserError with recovery hint on invalid JSON", () => {
		fs.writeFileSync(path.join(tmpDir, "anthropic.json"), "not-json{{{");
		expect(() => store.load("anthropic")).toThrow(/corrupt.*pi-patent login anthropic/);
	});

	it("load throws UserError when JSON is wrong shape (missing access)", () => {
		fs.writeFileSync(path.join(tmpDir, "anthropic.json"), JSON.stringify({ refresh: "r" }));
		expect(() => store.load("anthropic")).toThrow(/unexpected shape.*pi-patent login anthropic/);
	});
});
