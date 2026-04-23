import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { IntakeResultSchema, VerdictSchema } from "../types.js";

export type PromptUserFn = (question: string, options?: string[]) => Promise<string>;

const AskUserParams = Type.Object({
	question: Type.String(),
	options: Type.Optional(Type.Array(Type.String())),
});

export function makeAskUserTool(promptUser: PromptUserFn): AgentTool<typeof AskUserParams> {
	return {
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the inventor a clarifying question. Use sparingly — only when you cannot draft without the info. " +
			"Prefer single clear questions over bundled ones.",
		parameters: AskUserParams,
		execute: async (_id, { question, options }) => {
			// The 6-call cap is enforced in runIntake's beforeToolCall hook (§7.2), not here.
			const answer = await promptUser(question, options);
			return {
				content: [{ type: "text", text: answer }],
				details: { question, options: options ?? null, answer },
			};
		},
	};
}

export const finalizeIntakeTool: AgentTool<typeof IntakeResultSchema> = {
	name: "finalize_intake",
	label: "Finalize Intake",
	description: "Call exactly once when assessment + context gathering is complete.",
	parameters: IntakeResultSchema,
	execute: async (_id, args) => ({
		content: [{ type: "text", text: "ok" }],
		terminate: true,
		details: args,
	}),
};

export const submitVerdictTool: AgentTool<typeof VerdictSchema> = {
	name: "submit_verdict",
	label: "Submit Verdict",
	description: "Call exactly once when evaluation is complete.",
	parameters: VerdictSchema,
	execute: async (_id, args) => ({
		content: [{ type: "text", text: "ok" }],
		terminate: true,
		details: args,
	}),
};
