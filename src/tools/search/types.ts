export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	score?: number;
}

export interface SearchOptions {
	maxResults?: number;
	/** Propagated from the tool's execute() signal; aborts in-flight fetches. */
	signal?: AbortSignal;
}

export interface SearchProvider {
	readonly name: string;
	validate(): void;
	search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}

export type SearchErrorKind = "backend" | "auth" | "rate_limit" | "bad_request" | "unknown";

export class SearchError extends Error {
	constructor(
		public readonly kind: SearchErrorKind,
		message: string,
		public readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "SearchError";
	}
}
