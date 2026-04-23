import { Agent } from "@mariozechner/pi-agent-core";
import { resolveApiKey } from "../oauth/resolve.js";
import { loadPrompt } from "../prompts/load.js";
import { promptVarsFor } from "../prompts/render.js";
import type { ResolvedConfig } from "../types.js";
import { resolveModelOrThrow } from "./model.js";

export function makeDrafterAgent(cfg: ResolvedConfig): Agent {
	const spec = cfg.models.drafter;
	const model = resolveModelOrThrow("drafter", spec.provider, spec.model);

	return new Agent({
		initialState: {
			systemPrompt: loadPrompt("drafter", promptVarsFor("drafter", cfg)),
			model,
			thinkingLevel: spec.thinking,
			tools: [],
			messages: [],
		},
		getApiKey: resolveApiKey,
	});
}
