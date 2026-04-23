import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { UserError } from "../errors.js";
import { resolveApiKey } from "../oauth/resolve.js";
import { loadPrompt } from "../prompts/load.js";
import { promptVarsFor } from "../prompts/render.js";
import { finalizeIntakeTool } from "../tools/agent-tools.js";
import type { ResolvedConfig } from "../types.js";

export function makeIntakeAgent(cfg: ResolvedConfig, askUserTool: AgentTool): Agent {
	const spec = cfg.models.intake;
	// biome-ignore lint/suspicious/noExplicitAny: getModel uses strict generic literals; we validate at runtime via the undefined check below.
	const model = getModel(spec.provider as any, spec.model as any);
	if (!model) throw new UserError(`Unknown model "${spec.model}" for provider "${spec.provider}" (intake)`);

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
