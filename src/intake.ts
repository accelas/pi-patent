import type { Agent, AgentMessage, BeforeToolCallContext, BeforeToolCallResult } from "@mariozechner/pi-agent-core";
import { makeIntakeAgent } from "./agents/intake.js";
import { IntakeRejected, LlmProtocolError } from "./errors.js";
import { type PromptUserFn, makeAskUserTool } from "./tools/agent-tools.js";
import type { IntakeResult, ResolvedConfig } from "./types.js";

const ASK_USER_CAP = 6;

export interface RunIntakeDeps {
	makeAgent: () => Agent;
	promptUser: PromptUserFn;
}

/**
 * Build default deps that wire a real intake agent with the ask_user tool.
 */
export function defaultIntakeDeps(cfg: ResolvedConfig, promptUser: PromptUserFn): RunIntakeDeps {
	return {
		promptUser,
		makeAgent: () => makeIntakeAgent(cfg, makeAskUserTool(promptUser)),
	};
}

/**
 * Run the intake phase. Returns the finalized IntakeResult + transcript.
 *
 * Enforces the 6-call `ask_user` cap + blocks all tool calls after
 * `finalize_intake` fires via the agent's `beforeToolCall` hook (spec §7.2).
 *
 * Throws `IntakeRejected` when the intake agent finalizes with `accepted: false`,
 * and `LlmProtocolError` when `finalize_intake` is never called.
 */
export async function runIntake(
	disclosure: string,
	_cfg: ResolvedConfig,
	deps: RunIntakeDeps,
): Promise<{ intake: IntakeResult; transcript: AgentMessage[] }> {
	const agent = deps.makeAgent();

	let askUserCount = 0;
	let terminalCalled = false;

	agent.beforeToolCall = async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
		if (terminalCalled) {
			return { block: true, reason: "Intake already finalized; no further tool calls allowed." };
		}
		if (ctx.toolCall.name === "ask_user") {
			if (askUserCount >= ASK_USER_CAP) {
				return {
					block: true,
					reason: `ask_user cap (${ASK_USER_CAP}) reached. Call finalize_intake with your best assessment now.`,
				};
			}
			askUserCount++;
		}
		if (ctx.toolCall.name === "finalize_intake") {
			terminalCalled = true;
		}
		return undefined;
	};

	let intakeResult: IntakeResult | null = null;

	const unsubscribe = agent.subscribe((event) => {
		if (event.type === "tool_execution_end" && event.toolName === "finalize_intake" && !event.isError) {
			intakeResult = event.result.details as IntakeResult;
		}
	});

	try {
		await agent.prompt(disclosure);
	} finally {
		unsubscribe();
	}

	if (!intakeResult) {
		throw new LlmProtocolError("Intake agent did not call finalize_intake.");
	}

	const finalized: IntakeResult = intakeResult;
	if (!finalized.accepted) {
		throw new IntakeRejected(finalized.rejection_reason ?? "Disclosure rejected by intake agent.");
	}

	return { intake: finalized, transcript: agent.state.messages };
}
