import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { UserError } from "../errors.js";
import { resolveApiKey } from "../oauth/resolve.js";
import { loadPrompt } from "../prompts/load.js";
import { promptVarsFor } from "../prompts/render.js";
import { submitVerdictTool } from "../tools/agent-tools.js";
import type { SearchProviderName } from "../tools/search/index.js";
import { makeWebSearchTool } from "../tools/web-search.js";
import type { ResolvedConfig } from "../types.js";

export function makeEvaluatorAgent(cfg: ResolvedConfig): Agent {
	const spec = cfg.models.evaluator;
	// biome-ignore lint/suspicious/noExplicitAny: getModel uses strict generic literals; we validate at runtime via the undefined check below.
	const model = getModel(spec.provider as any, spec.model as any);
	if (!model) throw new UserError(`Unknown model "${spec.model}" for provider "${spec.provider}" (evaluator)`);

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
