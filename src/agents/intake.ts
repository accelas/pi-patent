import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { resolveApiKey } from "../oauth/resolve.js";
import { loadPrompt } from "../prompts/load.js";
import { promptVarsFor } from "../prompts/render.js";
import { finalizeIntakeTool } from "../tools/agent-tools.js";
import type { ResolvedConfig } from "../types.js";
import { resolveModelOrThrow } from "./model.js";

export function makeIntakeAgent(cfg: ResolvedConfig, askUserTool: AgentTool): Agent {
	const spec = cfg.models.intake;
	const model = resolveModelOrThrow("intake", spec.provider, spec.model);

	return new Agent({
		initialState: {
			systemPrompt: loadPrompt("intake", promptVarsFor("intake", cfg)),
			model,
			thinkingLevel: spec.thinking,
			tools: [askUserTool, finalizeIntakeTool],
			messages: [],
		},
		getApiKey: resolveApiKey,
		toolExecution: "sequential",
	});
}
