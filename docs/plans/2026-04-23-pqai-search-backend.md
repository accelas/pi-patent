# PQAI Patent-Search Backend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PQAI (projectpq.ai) as a swap-in `SearchProvider` alongside the existing Tavily provider, so users can point pi-patent's `basic_novelty` axis at a free, semantic, patent-specific prior-art backend instead of a general web search.

**Architecture:** One new class `PQAIProvider implements SearchProvider` in `src/tools/search/providers/pqai.ts`, mirroring the existing `TavilyProvider` pattern. Registered in `src/tools/search/index.ts`'s `SEARCH_PROVIDERS` table. Everything downstream (`makeWebSearchTool`, evaluator prompt, ralph loop) is unchanged because the `SearchProvider` interface already normalizes results.

**Tech Stack:** TypeScript 5.7+, Node ≥20.6, vitest for tests, native `fetch` + `AbortController` (same pattern as Tavily provider). No new runtime deps.

**Spec reference:** GitHub issue [#2](https://github.com/accelas/pi-patent/issues/2) (phase 1 — "Add PQAI as swap-in provider"). Related: issue #1 comment on external feedback that surfaced this work.

**Working directory:** `/home/kai/repo/pi-patent/`. Stay in this directory.

---

## File Structure

| Path | Purpose |
|------|---------|
| `src/tools/search/providers/pqai.ts` | **NEW** — `PQAIProvider implements SearchProvider`. POSTs to PQAI's search endpoint; normalizes response to `SearchResult[]`. ~80 lines. |
| `test/pqai.test.ts` | **NEW** — unit tests against mocked `fetch` (same pattern as `test/tavily.test.ts`). ~120 lines. |
| `src/tools/search/index.ts` | **MODIFY** — add `pqai: () => new PQAIProvider()` to `SEARCH_PROVIDERS` registry. 2-line change. |
| `test/search-registry.test.ts` | **MODIFY** — extend the registry test to confirm `pqai` resolves. 3-line change. |
| `README.md` | **MODIFY** — add PQAI to the Config section's search-provider options + note its free/semantic/patent-specific properties. |
| `config.toml` | **NOT MODIFIED** — gitignored; user adjusts their own. Document the `search_provider = "pqai"` toggle only in README. |

---

## Preconditions

Before starting, confirm the following in your working directory (read-only checks):

```bash
cd /home/kai/repo/pi-patent
git status              # should be clean; current HEAD at v0.2.1 (04a775e) or later
npm test                # 123/123 pass
npm run check           # biome + tsc clean
```

If any of the above fails, stop and surface the gap rather than building on an unstable base.

---

## Chunk 1: PQAI Provider

### Task 1: Verify PQAI endpoint is live + characterize real response shape

**Why this task first:** PQAI is a community-maintained open-source project. Its API shape may have drifted since this plan was written. We do a one-time live probe to lock in the actual request/response shape BEFORE writing tests, so test fixtures match reality rather than drift.

- [ ] **Step 1: Probe the health endpoint (no body read, just check reachability)**

```bash
curl -sS -o /dev/null -w "status=%{http_code} time=%{time_total}s\n" \
  "https://api.projectpq.ai/search/102?q=test&n=1&type=patent"
```

Expected: `status=200 time=<3s` (or whatever the live endpoint returns). If status is 404 or the hostname fails to resolve, stop and surface — PQAI may have moved; check https://projectpq.ai/ or GitHub org for the current endpoint, then adjust this plan before proceeding.

- [ ] **Step 2: Characterize a real response to a representative query**

```bash
curl -sS "https://api.projectpq.ai/search/102?q=distributed+cache+invalidation+bloom+filter&n=3&type=patent" \
  | python3 -m json.tool | head -60
```

Record, for the plan's implementer reference:
- The top-level JSON key holding the result array (e.g., `results`, `hits`, `data`)
- The per-hit fields actually present (e.g., `id`, `title`, `abstract`, `score`, `url`, `publication_number`, `date`)
- The URL format — does PQAI return a clickable URL, or do we need to synthesize one from a patent id? (If synthesize: `https://patents.google.com/patent/<id>` is the conventional fallback.)

The fields we need to emit as `SearchResult`:
- `title` → use PQAI's title field
- `url` → use PQAI's URL field if present; else synthesize from id
- `snippet` → use abstract
- `score` → use similarity/relevance score

If PQAI's field names differ from what the implementation below assumes, **adjust the implementation in Task 3 to match reality.** Tests in Task 2 will pin the assumed shape; update them together.

**If PQAI ALWAYS returns a URL** (no hit lacks it): the URL-fallback branch in `normalizeHit` and its "falls back to synthesized URL when PQAI response omits url" test in Task 3 are dead code — delete both, don't ship them. If PQAI SOMETIMES returns no URL: keep both. This is a probe finding, not a guess.

After Task 1 is complete, **record the observed response shape as a comment block at the top of `src/tools/search/providers/pqai.ts`** (in Task 2) so future maintainers don't have to re-probe. Example comment:

```typescript
/**
 * Probed 2026-04-23 against api.projectpq.ai/search/102:
 *   POST body: { q: string, n: number, type: "patent" }
 *   Response: { results: [{ id, title, abstract, url, score }] }
 *   URL: always present for published patents (synthesize fallback needed for X)
 */
```

- [ ] **Step 3: If endpoint probe failed or shape diverges, stop and report**

Do NOT proceed to writing code against a stale API shape. Report BLOCKED with what you found.

### Task 2: Stub `PQAIProvider` + registry entry

**Files:**
- Create: `src/tools/search/providers/pqai.ts`
- Test: `test/pqai.test.ts`
- Modify: `src/tools/search/index.ts`
- Modify: `test/search-registry.test.ts`

- [ ] **Step 1: Write failing test for stub (exists + name + registry lookup)**

Add to `test/search-registry.test.ts` (append inside the existing `describe("getSearchProvider", ...)` block):

```typescript
	it("returns pqai", () => {
		const p = getSearchProvider("pqai");
		expect(p.name).toBe("pqai");
	});
```

Create `test/pqai.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { PQAIProvider } from "../src/tools/search/providers/pqai.js";

describe("PQAIProvider", () => {
	it("exposes readonly name 'pqai'", () => {
		expect(new PQAIProvider().name).toBe("pqai");
	});

	it("validate() is a no-op (PQAI free tier needs no auth)", () => {
		expect(() => new PQAIProvider().validate()).not.toThrow();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest --run test/pqai.test.ts test/search-registry.test.ts
```

Expected: FAIL — cannot find module `../src/tools/search/providers/pqai.js`; `pqai` is not in SEARCH_PROVIDERS.

- [ ] **Step 3: Create stub `src/tools/search/providers/pqai.ts`**

```typescript
import type { SearchOptions, SearchProvider, SearchResult } from "../types.js";

/**
 * PQAI (projectpq.ai) — free, open-source semantic patent-search API.
 *
 * No API key required on the free tier; rate limiting is IP-based (undocumented,
 * loose). If a future version introduces auth, add a PQAI_API_KEY env-var check
 * in validate() and include it as a header or query param in search().
 *
 * Endpoint + response shape were characterized on 2026-04-23; verify before
 * changing either.
 */
export class PQAIProvider implements SearchProvider {
	readonly name = "pqai";

	validate(): void {
		// No auth required; nothing to check at startup.
	}

	async search(_query: string, _opts: SearchOptions = {}): Promise<SearchResult[]> {
		throw new Error("PQAIProvider.search not yet implemented");
	}
}
```

- [ ] **Step 4: Register in `src/tools/search/index.ts`**

Modify the `SEARCH_PROVIDERS` object:

```typescript
import { UserError } from "../../errors.js";
import { PQAIProvider } from "./providers/pqai.js";
import { TavilyProvider } from "./providers/tavily.js";
import type { SearchProvider } from "./types.js";

export const SEARCH_PROVIDERS = {
	tavily: () => new TavilyProvider(),
	pqai: () => new PQAIProvider(),
} as const;
```

Rest of the file unchanged.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest --run test/pqai.test.ts test/search-registry.test.ts
```

Expected: all green. The "PQAIProvider.search not yet implemented" branch is not exercised yet.

- [ ] **Step 6: Run full suite + check to confirm no regression**

```bash
npm run check && npm test
```

Expected: clean; test count is 123 (previous baseline) + 3 new = 126.

- [ ] **Step 7: Commit**

```bash
git add src/tools/search/providers/pqai.ts test/pqai.test.ts src/tools/search/index.ts test/search-registry.test.ts
git commit -m "feat(search): PQAI provider stub + registry entry

First phase of issue #2 (free patent-search backends). Scaffolds the
PQAIProvider class with name + no-op validate(), and registers it in
SEARCH_PROVIDERS so getSearchProvider(\"pqai\") resolves. search()
throws — actual request shape + normalization land in the next commit."
```

### Task 3: Implement `search()` — request shape + response normalization

**Files:**
- Modify: `src/tools/search/providers/pqai.ts`
- Modify: `test/pqai.test.ts`

- [ ] **Step 1: Write failing test for the happy path**

Append to `test/pqai.test.ts`:

```typescript
import { afterEach, beforeEach, vi } from "vitest";
import { SearchError } from "../src/tools/search/types.js";

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

beforeEach(() => {
	globalThis.fetch = mockFetch as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
	mockFetch.mockReset();
});

describe("PQAIProvider.search (happy path)", () => {
	it("POSTs the query and normalizes results to SearchResult shape", async () => {
		// Response shape locked by Task 1 probe. Adjust per real PQAI schema.
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				results: [
					{
						id: "US10000000",
						title: "Distributed cache invalidation",
						abstract: "Methods and systems for invalidating cache entries.",
						url: "https://patents.google.com/patent/US10000000",
						score: 0.87,
						extra_field: "ignored",
					},
				],
			}),
		});

		const results = await new PQAIProvider().search("bloom filter cache invalidation", { maxResults: 5 });

		expect(results).toEqual([
			{
				title: "Distributed cache invalidation",
				url: "https://patents.google.com/patent/US10000000",
				snippet: "Methods and systems for invalidating cache entries.",
				score: 0.87,
			},
		]);

		// Verify the request was shaped correctly.
		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, init] = mockFetch.mock.calls[0]!;
		expect(url).toBe("https://api.projectpq.ai/search/102");
		expect(init.method).toBe("POST");
		expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
		const body = JSON.parse(init.body as string);
		expect(body).toMatchObject({ q: "bloom filter cache invalidation", n: 5, type: "patent" });
	});

	it("falls back to synthesized URL when PQAI response omits url", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				results: [{ id: "US9876543", title: "Thing", abstract: "Abstract.", score: 0.6 }],
			}),
		});
		const results = await new PQAIProvider().search("q");
		expect(results[0]!.url).toBe("https://patents.google.com/patent/US9876543");
	});

	it("defaults n to 10 when opts.maxResults is undefined", async () => {
		mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) });
		await new PQAIProvider().search("q");
		const [, init] = mockFetch.mock.calls[0]!;
		const body = JSON.parse(init.body as string);
		expect(body.n).toBe(10);
	});
});
```

> **IMPORTANT:** If Task 1's probe revealed a different request/response shape (different endpoint path, different keys), adjust BOTH the test expectations AND the implementation below to match. Do not ship tests that assume a shape you haven't verified.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest --run test/pqai.test.ts
```

Expected: FAIL — `PQAIProvider.search not yet implemented`.

- [ ] **Step 3: Implement `search()` (adjust per Task 1 findings)**

Replace `src/tools/search/providers/pqai.ts` with:

```typescript
import {
	SearchError,
	type SearchErrorKind,
	type SearchOptions,
	type SearchProvider,
	type SearchResult,
} from "../types.js";

interface PQAIHit {
	id?: string;
	title: string;
	abstract: string;
	url?: string;
	score: number;
}

interface PQAIBody {
	results: PQAIHit[];
}

const PQAI_ENDPOINT = "https://api.projectpq.ai/search/102";
const DEFAULT_N = 10;
const TIMEOUT_MS = 30_000;

/**
 * PQAI (projectpq.ai) — free, open-source semantic patent-search API.
 * No auth on the free tier. Rate limiting is IP-based and loose.
 */
export class PQAIProvider implements SearchProvider {
	readonly name = "pqai";

	validate(): void {
		// No startup check — no credentials required.
	}

	async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
		const n = opts.maxResults ?? DEFAULT_N;

		// 30s cap on the whole round-trip. Also honor caller's AbortSignal so
		// SIGINT propagates to in-flight requests (mirrors TavilyProvider).
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
		const onUpstream = () => controller.abort();
		if (opts.signal) {
			if (opts.signal.aborted) controller.abort();
			else opts.signal.addEventListener("abort", onUpstream, { once: true });
		}

		try {
			let response: Response;
			try {
				response = await fetch(PQAI_ENDPOINT, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ q: query, n, type: "patent" }),
					signal: controller.signal,
				});
			} catch (err) {
				throw new SearchError("backend", `PQAI network error: ${(err as Error).message}`);
			}

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new SearchError(
					mapStatus(response.status),
					`PQAI ${response.status}: ${text.slice(0, 200)}`,
				);
			}

			let data: unknown;
			try {
				data = await response.json();
			} catch (err) {
				const msg = (err as Error).message;
				if (isAbortError(err)) throw new SearchError("backend", "PQAI body read aborted.");
				throw new SearchError("unknown", `PQAI returned non-JSON body: ${msg}`);
			}

			if (!isPQAIBody(data)) {
				throw new SearchError(
					"unknown",
					"PQAI response has unexpected shape (missing 'results' array of {title,abstract,score,...}).",
				);
			}

			return data.results.map(normalizeHit);
		} finally {
			clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onUpstream);
		}
	}
}

function normalizeHit(h: PQAIHit): SearchResult {
	return {
		title: h.title,
		url: h.url ?? (h.id ? `https://patents.google.com/patent/${h.id}` : ""),
		snippet: h.abstract,
		score: h.score,
	};
}

function isPQAIBody(v: unknown): v is PQAIBody {
	if (v === null || typeof v !== "object") return false;
	const results = (v as { results?: unknown }).results;
	if (!Array.isArray(results)) return false;
	return results.every(
		(r) =>
			r !== null &&
			typeof r === "object" &&
			typeof (r as { title?: unknown }).title === "string" &&
			typeof (r as { abstract?: unknown }).abstract === "string" &&
			typeof (r as { score?: unknown }).score === "number",
	);
}

function isAbortError(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	const name = (err as { name?: string }).name;
	return name === "AbortError";
}

function mapStatus(status: number): SearchErrorKind {
	if (status >= 500) return "backend";
	if (status === 401 || status === 403) return "auth";
	if (status === 429) return "rate_limit";
	if (status >= 400 && status < 500) return "bad_request";
	return "unknown";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest --run test/pqai.test.ts
```

Expected: all happy-path tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/search/providers/pqai.ts test/pqai.test.ts
git commit -m "feat(search): PQAI search() implementation

POSTs {q, n, type:'patent'} to api.projectpq.ai/search/102; normalizes
response to SearchResult[] (title from title, url from response or
synthesized from id, snippet from abstract, score pass-through).
Includes 30s round-trip timeout and AbortSignal plumbing, matching
TavilyProvider's behavior."
```

### Task 4: Error handling — status mapping + malformed body

**Files:**
- Modify: `test/pqai.test.ts`

- [ ] **Step 1: Write failing tests for error paths**

Append to `test/pqai.test.ts`:

```typescript
describe("PQAIProvider.search (errors)", () => {
	it.each([
		[500, "backend"],
		[503, "backend"],
		[401, "auth"],
		[403, "auth"],
		[429, "rate_limit"],
		[400, "bad_request"],
		[418, "bad_request"],
	] as const)("status %i → kind %s", async (status, kind) => {
		mockFetch.mockResolvedValue({ ok: false, status, text: async () => "err body" });
		try {
			await new PQAIProvider().search("q");
			expect.fail("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(SearchError);
			expect((e as SearchError).kind).toBe(kind);
		}
	});

	it("network failure → kind=backend", async () => {
		mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
		try {
			await new PQAIProvider().search("q");
			expect.fail("should throw");
		} catch (e) {
			expect((e as SearchError).kind).toBe("backend");
		}
	});

	it("non-JSON 200 body → kind=unknown with 'non-JSON' message", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => {
				throw new Error("Unexpected token");
			},
		});
		try {
			await new PQAIProvider().search("q");
			expect.fail("should throw");
		} catch (e) {
			expect(e).toBeInstanceOf(SearchError);
			expect((e as SearchError).kind).toBe("unknown");
			expect((e as SearchError).message).toMatch(/non-JSON/);
		}
	});

	it("JSON body missing 'results' array → kind=unknown with 'unexpected shape'", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ hits: [] }),
		});
		try {
			await new PQAIProvider().search("q");
			expect.fail("should throw");
		} catch (e) {
			expect(e).toBeInstanceOf(SearchError);
			expect((e as SearchError).kind).toBe("unknown");
			expect((e as SearchError).message).toMatch(/unexpected shape/);
		}
	});

	it("aborted body read → kind=backend", async () => {
		const abortErr = Object.assign(new Error("AbortError"), { name: "AbortError" });
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => {
				throw abortErr;
			},
		});
		try {
			await new PQAIProvider().search("q");
			expect.fail("should throw");
		} catch (e) {
			expect((e as SearchError).kind).toBe("backend");
			expect((e as SearchError).message).toMatch(/aborted/i);
		}
	});
});
```

- [ ] **Step 2: Run tests to verify they pass**

All error paths should already work because the implementation in Task 3 already includes the error mapping. This task is primarily to LOCK the behavior with tests.

```bash
npx vitest --run test/pqai.test.ts
```

Expected: all green, including the 7 parametrized status cases + network failure + body-read errors.

- [ ] **Step 3: Run full suite + check**

```bash
npm run check && npm test
```

Expected: clean; test count is 126 (from Task 2) + ~12 new = ~138.

- [ ] **Step 4: Commit**

```bash
git add test/pqai.test.ts
git commit -m "test(search/pqai): lock error-path behavior (status mapping, malformed body, abort)"
```

### Task 5: Verify caller AbortSignal propagation

**Files:**
- Modify: `test/pqai.test.ts`

- [ ] **Step 1: Write failing test for caller-signal abort**

Append to the "errors" describe block:

```typescript
	it("caller-supplied AbortSignal aborts the in-flight fetch", async () => {
		const controller = new AbortController();
		// Simulate fetch that never resolves but rejects on abort.
		mockFetch.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
			return new Promise((_resolve, reject) => {
				init.signal.addEventListener(
					"abort",
					() => {
						const e = new Error("AbortError");
						(e as { name?: string }).name = "AbortError";
						reject(e);
					},
					{ once: true },
				);
			});
		});

		const promise = new PQAIProvider().search("q", { signal: controller.signal });
		// Abort after a microtask to give the fetch call time to install its listener.
		queueMicrotask(() => controller.abort());

		try {
			await promise;
			expect.fail("should throw");
		} catch (e) {
			expect(e).toBeInstanceOf(SearchError);
			expect((e as SearchError).kind).toBe("backend");
			expect((e as SearchError).message).toMatch(/network error/);
		}
	});
```

- [ ] **Step 2: Run test to verify it passes**

Implementation in Task 3 already plumbs the signal. This test locks the behavior.

```bash
npx vitest --run test/pqai.test.ts
```

Expected: new test passes.

- [ ] **Step 3: Commit**

```bash
git add test/pqai.test.ts
git commit -m "test(search/pqai): verify caller AbortSignal aborts in-flight fetch"
```

### Task 6: Documentation — README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Find the search-provider documentation block**

```bash
grep -n 'search_provider' /home/kai/repo/pi-patent/README.md
```

Locate the TOML example that mentions `search_provider = "tavily"` — typically in the "Config (optional)" section.

- [ ] **Step 2: Replace the search-provider line + add a short note**

Find:

```toml
search_provider = "tavily"
```

Replace with:

```toml
search_provider = "tavily"      # or "pqai" — see note below
```

And add, below the config TOML block (before the next top-level heading):

```markdown
### Search providers

| Provider | Auth | Covers | Style |
|---|---|---|---|
| `tavily` (default) | `$TAVILY_API_KEY` (paid after free tier) | general web | keyword SERP |
| `pqai` | none — free | patents (USPTO + EPO + WIPO via projectpq.ai) | semantic |

`pqai` is purpose-built for AI-driven prior-art search. No API key required; the
provider is community-maintained at [projectpq.ai](https://projectpq.ai). If the
endpoint is unreachable, pi-patent will surface a `SearchError(kind="backend")`
via the `basic_novelty` axis — the loop continues, it just scores that axis
conservatively (see spec §10.3.1 for the success-on-error pattern).
```

- [ ] **Step 3: Visually confirm the edit rendered correctly**

```bash
grep -A 15 '### Search providers' /home/kai/repo/pi-patent/README.md
```

Expected: the new section shows up with the table + the paragraph.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document PQAI as an alternative search_provider

Adds a comparison table + usage note to the README's Config section.
Closes phase 1 of issue #2."
```

### Task 7: End-to-end smoke — OPTIONAL real-API verification

**Files:** no source changes. This is a manual sanity check; do not commit anything.

**Preconditions — skip this task entirely if any is not met:**
- External network reachable (PQAI + OpenRouter/OpenAI both need to be callable).
- A valid API key for whichever `--model` you pass. `openai/gpt-5.4` routes through OpenRouter in our default config; requires `$OPENROUTER_API_KEY` in `.env`.
- `bun` on `PATH` for `build:binary` (or skip the binary step and run via `node dist/cli.js`).
- `$TAVILY_API_KEY` is NOT needed for this task because you're switching `search_provider` to `pqai`.

- [ ] **Step 1: Rebuild binary + AppImage**

```bash
cd /home/kai/repo/pi-patent
npm run build:binary     # requires bun on PATH; skip if unavailable
```

- [ ] **Step 2: Run pi-patent end-to-end with PQAI instead of Tavily**

Edit `~/.config/pi-patent/config.toml` (symlinked to repo-root `config.toml` if following README setup):

```toml
search_provider = "pqai"
```

Then:

```bash
yes 2 | timeout 600 node --env-file=.env dist/cli.js \
  --input /tmp/test-disclosure.md \
  --max-iter 1 \
  --model "openai/gpt-5.4" \
  --out /tmp/pp-pqai-smoke
```

(`--model openai/gpt-5.4` picks a capable model known to converge in one iter, minimizing cost.)

- [ ] **Step 3: Inspect the session artifacts**

```bash
SESS=$(ls -td /tmp/pp-pqai-smoke/*/ | head -1)
jq '{verdict: .final_verdict.verdict, scores: .final_verdict.scores, prior_art: [.final_verdict.prior_art_flags // [] | .[] | {title, overlap_level}]}' "$SESS/session.json"
```

Sanity checks (no assertion required, just eyeball):
- The `prior_art` list should contain patent-ish titles (PQAI's wheelhouse), not general web pages (Tavily's).
- `basic_novelty` score should reflect the evaluator's read of real prior art, not a "web checks unavailable" fallback.

If PQAI returned unusable results (empty, wrong shape, hard failure), capture the output and surface as a follow-up issue linked to #2; do NOT patch the provider to swallow the problem silently.

- [ ] **Step 4: Revert config to Tavily (optional cleanup)**

Only if you changed the shared config; skip if you used a throwaway.

---

## Post-implementation: release decision

This plan does NOT include a release tag. After all tasks pass, decide with the human whether to:

1. Bump `package.json` to `0.2.2` + tag `v0.2.2` + push (the CI workflow will build and publish the AppImage).
2. Hold this as uncommitted local work pending additional phase-2 work (USPTO PatentsView) for a combined `v0.3.0` release.

Either path is safe — the change is additive (new provider added, existing providers unchanged), so it's not a breaking change regardless of how it's released.

---

## Definition of done

- [ ] `src/tools/search/providers/pqai.ts` exists and implements `SearchProvider`
- [ ] `test/pqai.test.ts` covers: happy path (normalize + URL fallback + default n), status mapping (7 codes), network failure, non-JSON body, wrong-shape body, aborted body read, caller signal
- [ ] `SEARCH_PROVIDERS` registry includes `pqai`
- [ ] `test/search-registry.test.ts` resolves `"pqai"`
- [ ] `README.md` documents the new provider with a comparison table
- [ ] `npm run check && npm test` both clean
- [ ] Test count increased from 123 → ~139 (approximate; count depends on how `it.each` cases are enumerated in vitest's output)
- [ ] 5+ atomic commits following TDD rhythm
- [ ] Optional: Task 7 smoke confirms live PQAI endpoint returns patent-relevant results
