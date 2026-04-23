import { describe, expect, it } from "vitest";
import { AbortError, IntakeRejected, LlmProtocolError, SearchBackendError, UserError } from "../src/errors.js";

describe("error classes", () => {
	it("UserError carries a message", () => {
		const e = new UserError("bad key");
		expect(e).toBeInstanceOf(Error);
		expect(e).toBeInstanceOf(UserError);
		expect(e.message).toBe("bad key");
	});

	it("IntakeRejected carries a reason", () => {
		const e = new IntakeRejected("no technical content");
		expect(e.reason).toBe("no technical content");
		expect(e.message).toBe("no technical content");
	});

	it("LlmProtocolError, SearchBackendError, AbortError are Error subclasses", () => {
		expect(new LlmProtocolError("x")).toBeInstanceOf(Error);
		expect(new SearchBackendError("x")).toBeInstanceOf(Error);
		expect(new AbortError()).toBeInstanceOf(Error);
	});
});
