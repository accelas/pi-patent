import { UserError } from "../../../errors.js";
import {
	SearchError,
	type SearchErrorKind,
	type SearchOptions,
	type SearchProvider,
	type SearchResult,
} from "../types.js";

interface TavilyResult {
	title: string;
	url: string;
	content: string;
	score: number;
}

export class TavilyProvider implements SearchProvider {
	readonly name = "tavily";

	validate(): void {
		if (!process.env.TAVILY_API_KEY) {
			throw new UserError("TAVILY_API_KEY not set. Get a key at https://tavily.com");
		}
	}

	async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
		const body: Record<string, unknown> = {
			api_key: process.env.TAVILY_API_KEY,
			query,
			search_depth: "basic",
			include_answer: false,
			include_raw_content: false,
		};
		if (opts.maxResults !== undefined) body.max_results = opts.maxResults;

		let response: Response;
		try {
			response = await fetch("https://api.tavily.com/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		} catch (err) {
			throw new SearchError("backend", `Tavily network error: ${(err as Error).message}`);
		}

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new SearchError(mapStatus(response.status), `Tavily ${response.status}: ${text.slice(0, 200)}`);
		}

		const data = (await response.json()) as { results: TavilyResult[] };
		return data.results.map((r) => ({
			title: r.title,
			url: r.url,
			snippet: r.content,
			score: r.score,
		}));
	}
}

function mapStatus(status: number): SearchErrorKind {
	if (status >= 500) return "backend";
	if (status === 401 || status === 403) return "auth";
	if (status === 429) return "rate_limit";
	if (status >= 400 && status < 500) return "bad_request";
	return "unknown";
}
