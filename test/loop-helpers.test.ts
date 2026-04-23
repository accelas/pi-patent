import { describe, expect, it, vi } from "vitest";
import { LlmProtocolError } from "../src/errors.js";
import { lastAssistantText, parseDrafterOutput } from "../src/loop-helpers.js";

describe("lastAssistantText", () => {
	it("returns text from the last assistant message", () => {
		const fakeAgent = {
			state: {
				messages: [
					{ role: "user", content: "q" },
					{
						role: "assistant",
						content: [
							{ type: "text", text: "hello " },
							{ type: "text", text: "world" },
						],
					},
				],
			},
		};
		expect(lastAssistantText(fakeAgent as never)).toBe("hello world");
	});

	it("throws when no assistant message present", () => {
		const fakeAgent = { state: { messages: [{ role: "user", content: "q" }] } };
		expect(() => lastAssistantText(fakeAgent as never)).toThrow(LlmProtocolError);
	});
});

describe("parseDrafterOutput", () => {
	it("splits on ---LAYMAN---", () => {
		const text = "# Title\n\nBody.\n---LAYMAN---\nPlain words.";
		const r = parseDrafterOutput(text);
		expect(r.draft).toBe("# Title\n\nBody.");
		expect(r.layman).toBe("Plain words.");
	});

	it("throws LlmProtocolError when marker missing", () => {
		expect(() => parseDrafterOutput("No marker here")).toThrow(LlmProtocolError);
	});
});

describe("parseDrafterOutputWithRetry", () => {
	it("retries once on first failure, succeeds on second", async () => {
		let callCount = 0;
		const replies = ["missing marker", "Fixed.\n---LAYMAN---\nOK"];
		// biome-ignore lint/suspicious/noExplicitAny: test fake agent
		const agent: any = {
			state: { messages: [{ role: "assistant", content: [{ type: "text", text: replies[0] }] }] },
			prompt: vi.fn(async () => {
				callCount++;
				agent.state.messages = [{ role: "assistant", content: [{ type: "text", text: replies[1] }] }];
			}),
		};
		const { parseDrafterOutputWithRetry } = await import("../src/loop-helpers.js");
		const r = await parseDrafterOutputWithRetry(agent);
		expect(r.layman).toBe("OK");
		expect(callCount).toBe(1);
	});

	it("invokes onDump and throws when both attempts fail", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test fake agent
		const agent: any = {
			state: { messages: [{ role: "assistant", content: [{ type: "text", text: "still bad" }] }] },
			prompt: vi.fn(async () => {
				/* leaves state unchanged */
			}),
		};
		const { parseDrafterOutputWithRetry } = await import("../src/loop-helpers.js");
		const onDump = vi.fn();
		await expect(parseDrafterOutputWithRetry(agent, onDump)).rejects.toThrow(LlmProtocolError);
		expect(onDump).toHaveBeenCalledWith("still bad");
	});
});
