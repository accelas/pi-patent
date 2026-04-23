import { describe, expect, it } from "vitest";
import { exitCodeFor } from "../src/cli-run.js";
import { AbortError, IntakeRejected, LlmProtocolError, SearchBackendError, UserError } from "../src/errors.js";

describe("exitCodeFor", () => {
	it("UserError → 2", () => expect(exitCodeFor(new UserError("x"))).toBe(2));
	it("IntakeRejected → 2", () => expect(exitCodeFor(new IntakeRejected("x"))).toBe(2));
	it("LlmProtocolError → 3", () => expect(exitCodeFor(new LlmProtocolError("x"))).toBe(3));
	it("SearchBackendError → 4", () => expect(exitCodeFor(new SearchBackendError("x"))).toBe(4));
	it("AbortError → 130", () => expect(exitCodeFor(new AbortError())).toBe(130));
	it("plain Error → 1", () => expect(exitCodeFor(new Error("x"))).toBe(1));
});
