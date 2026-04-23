// src/tools/search/providers/tavily.ts — stub; full impl in Task 4.2
import type { SearchOptions, SearchProvider, SearchResult } from "../types.js";

export class TavilyProvider implements SearchProvider {
	readonly name = "tavily";
	validate(): void {
		// Full impl in task 4.2
	}
	async search(_query: string, _opts?: SearchOptions): Promise<SearchResult[]> {
		throw new Error("TavilyProvider.search not yet implemented");
	}
}
