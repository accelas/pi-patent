import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { type SearchProviderName, getSearchProvider } from "./search/index.js";
import { SearchError } from "./search/types.js";

const WebSearchParams = Type.Object({
	query: Type.String(),
	max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
});

export function makeWebSearchTool(providerName: SearchProviderName): AgentTool<typeof WebSearchParams> {
	const provider = getSearchProvider(providerName);
	provider.validate();

	return {
		name: "web_search",
		label: "Web Search",
		description:
			"Prior-art sanity check. Issue at most 5 targeted queries per evaluation. " +
			"Prefer technical specificity over generic phrasing.",
		parameters: WebSearchParams,
		execute: async (_id, { query, max_results }) => {
			try {
				const opts = max_results !== undefined ? { maxResults: max_results } : {};
				const results = await provider.search(query, opts);
				return {
					content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
					details: { provider: provider.name, query, count: results.length, kind: "ok" as const },
				};
			} catch (err) {
				if (err instanceof SearchError) {
					return {
						content: [
							{
								type: "text",
								text: `Search error (${err.kind}): ${err.message}. No results this query.`,
							},
						],
						details: {
							provider: provider.name,
							query,
							count: 0,
							kind: err.kind,
							error_message: err.message,
						},
					};
				}
				throw err;
			}
		},
	};
}
