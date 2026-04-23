import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { resolveApiKey } from "../oauth/resolve.js";
import { loadPrompt } from "../prompts/load.js";
import { promptVarsFor } from "../prompts/render.js";
import { submitVerdictTool } from "../tools/agent-tools.js";
import type { SearchProviderName } from "../tools/search/index.js";
import { makeWebSearchTool } from "../tools/web-search.js";
import type { ResolvedConfig } from "../types.js";
import { resolveModelOrThrow } from "./model.js";

export function makeEvaluatorAgent(cfg: ResolvedConfig): Agent {
	const spec = cfg.models.evaluator;
	const model = resolveModelOrThrow("evaluator", spec.provider, spec.model);

	// biome-ignore lint/suspicious/noExplicitAny: tools array mixes AgentTool<VerdictSchema> and AgentTool<WebSearchParams>.
	const tools: AgentTool<any>[] = [submitVerdictTool];
	if (cfg.web_search) tools.unshift(makeWebSearchTool(cfg.search_provider as SearchProviderName));

	return new Agent({
		initialState: {
			systemPrompt: loadPrompt("evaluator", promptVarsFor("evaluator", cfg)),
			model,
			thinkingLevel: spec.thinking,
			tools,
			messages: [],
		},
		getApiKey: resolveApiKey,
		toolExecution: "sequential",
	});
}
