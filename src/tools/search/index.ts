import { UserError } from "../../errors.js";
import { TavilyProvider } from "./providers/tavily.js";
import type { SearchProvider } from "./types.js";

export const SEARCH_PROVIDERS = {
	tavily: () => new TavilyProvider(),
} as const;

export type SearchProviderName = keyof typeof SEARCH_PROVIDERS;

export function getSearchProvider(name: string): SearchProvider {
	const factory = (SEARCH_PROVIDERS as Record<string, (() => SearchProvider) | undefined>)[name];
	if (!factory) {
		throw new UserError(
			`Unknown search provider: "${name}". Available: ${Object.keys(SEARCH_PROVIDERS).join(", ")}`,
		);
	}
	return factory();
}
