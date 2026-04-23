import type { Api, Model } from "@mariozechner/pi-ai";

/**
 * Build a Model object for providers pi-ai's registry does not know about.
 * Returns null when the provider is NOT a pi-patent custom provider — caller
 * should fall back to pi-ai's getModel().
 *
 * Supported custom providers:
 *   - openrouter: OpenAI-compatible proxy (https://openrouter.ai). Accepts any
 *     model id; OpenRouter routes it. Uses `openai-completions` wire protocol
 *     and `OPENROUTER_API_KEY` for auth (via src/oauth/resolve.ts).
 */
export function buildCustomModel(provider: string, modelId: string): Model<Api> | null {
	if (provider === "openrouter") {
		// OpenRouter optionally attributes traffic via HTTP-Referer + X-Title headers.
		// These are rankings metadata only (not required). We set X-Title to a stable
		// identifier; HTTP-Referer is left to the user via PI_PATENT_HTTP_REFERER so we
		// don't ship a placeholder in production.
		const headers: Record<string, string> = { "X-Title": "pi-patent" };
		if (process.env.PI_PATENT_HTTP_REFERER) headers["HTTP-Referer"] = process.env.PI_PATENT_HTTP_REFERER;

		return {
			id: modelId,
			name: modelId,
			api: "openai-completions",
			provider: "openrouter" as unknown as Model<Api>["provider"],
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
			headers,
		} as unknown as Model<Api>;
	}
	return null;
}

/** Set of provider names handled by buildCustomModel. */
export const CUSTOM_PROVIDERS = new Set(["openrouter"]);
