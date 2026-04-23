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

		// Cap Tavily fetch at 30s so a stuck request can't hang the evaluator.
		// Honor caller-supplied AbortSignal too (for SIGINT propagation).
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 30_000);
		const onUpstream = () => controller.abort();
		if (opts.signal) {
			if (opts.signal.aborted) controller.abort();
			else opts.signal.addEventListener("abort", onUpstream, { once: true });
		}

		let response: Response;
		try {
			response = await fetch("https://api.tavily.com/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: controller.signal,
			});
		} catch (err) {
			const msg = (err as Error).message;
			const kind = msg.toLowerCase().includes("abort") ? "backend" : "backend";
			throw new SearchError(kind, `Tavily network error: ${msg}`);
		} finally {
			clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onUpstream);
		}

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new SearchError(mapStatus(response.status), `Tavily ${response.status}: ${text.slice(0, 200)}`);
		}

		let data: unknown;
		try {
			data = await response.json();
		} catch (err) {
			throw new SearchError("unknown", `Tavily returned non-JSON body: ${(err as Error).message}`);
		}
		if (!isTavilyBody(data)) {
			throw new SearchError(
				"unknown",
				"Tavily response has unexpected shape (missing 'results' array of {title,url,content,score}).",
			);
		}
		return data.results.map((r) => ({
			title: r.title,
			url: r.url,
			snippet: r.content,
			score: r.score,
		}));
	}
}

function isTavilyBody(v: unknown): v is { results: TavilyResult[] } {
	if (v === null || typeof v !== "object") return false;
	const results = (v as { results?: unknown }).results;
	if (!Array.isArray(results)) return false;
	return results.every(
		(r) =>
			r !== null &&
			typeof r === "object" &&
			typeof (r as { title?: unknown }).title === "string" &&
			typeof (r as { url?: unknown }).url === "string" &&
			typeof (r as { content?: unknown }).content === "string" &&
			typeof (r as { score?: unknown }).score === "number",
	);
}

function mapStatus(status: number): SearchErrorKind {
	if (status >= 500) return "backend";
	if (status === 401 || status === 403) return "auth";
	if (status === 429) return "rate_limit";
	if (status >= 400 && status < 500) return "bad_request";
	return "unknown";
}
