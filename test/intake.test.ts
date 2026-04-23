import { describe, expect, it, vi } from "vitest";
import { IntakeRejected, LlmProtocolError } from "../src/errors.js";
import { runIntake } from "../src/intake.js";
import type { IntakeResult, ResolvedConfig } from "../src/types.js";

// biome-ignore lint/suspicious/noExplicitAny: test fake agent
function fakeIntakeAgent(finalize: IntakeResult | null, askUserCalls = 0): any {
	return {
		state: { messages: [] },
		prompt: vi.fn(async () => undefined),
		// biome-ignore lint/suspicious/noExplicitAny: test event callback
		subscribe: vi.fn((cb: any) => {
			for (let i = 0; i < askUserCalls; i++) {
				cb({
					type: "tool_execution_end",
					toolName: "ask_user",
					isError: false,
					result: { details: { answer: "x" } },
				});
			}
			if (finalize) {
				cb({
					type: "tool_execution_end",
					toolName: "finalize_intake",
					isError: false,
					result: { details: finalize },
				});
			}
			return () => undefined;
		}),
		beforeToolCall: undefined,
	};
}

const cfg = {} as unknown as ResolvedConfig;

describe("runIntake", () => {
	it("returns intake + transcript on success", async () => {
		const accepted: IntakeResult = { accepted: true, scope_preference: "balanced" };
		const r = await runIntake("disclosure text here long enough", cfg, {
			makeAgent: () => fakeIntakeAgent(accepted),
			promptUser: async () => "whatever",
		});
		expect(r.intake).toEqual(accepted);
		expect(Array.isArray(r.transcript)).toBe(true);
	});

	it("throws IntakeRejected when accepted=false", async () => {
		const rejected: IntakeResult = { accepted: false, rejection_reason: "not novel" };
		await expect(
			runIntake("short", cfg, {
				makeAgent: () => fakeIntakeAgent(rejected),
				promptUser: async () => "whatever",
			}),
		).rejects.toThrow(IntakeRejected);
	});

	it("throws LlmProtocolError when finalize_intake never fires", async () => {
		await expect(
			runIntake("disclosure", cfg, {
				makeAgent: () => fakeIntakeAgent(null),
				promptUser: async () => "whatever",
			}),
		).rejects.toThrow(LlmProtocolError);
	});
});
