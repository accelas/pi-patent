# pi-patent

CLI that iterates a short inventor disclosure into a full utility patent draft plus a layman explanation, via an interactive intake and a ralph loop (drafter ↔ fresh-context evaluator).

Built on [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai) and [`@mariozechner/pi-agent-core`](https://www.npmjs.com/package/@mariozechner/pi-agent-core).

## Install (dev)

```bash
git clone <your repo> && cd pi-patent
npm install
npm run build
```

## Install (AppImage — Linux)

Download the latest `pi-patent-x86_64.AppImage` from the internal artifact store, then:

```bash
chmod +x pi-patent-x86_64.AppImage
./pi-patent-x86_64.AppImage --help
```

## Usage

```bash
# Interactive — prompts for disclosure on stdin
pi-patent

# Read disclosure from file
pi-patent --input disclosure.md

# Piped stdin
cat disclosure.md | pi-patent

# Options
pi-patent --max-iter 3 --quiet
pi-patent --out ./my-patents/
pi-patent --no-web
pi-patent --model claude-sonnet-4-6
```

## Authentication

```bash
export ANTHROPIC_API_KEY=sk-...
export TAVILY_API_KEY=tvly-...             # optional, only if web_search enabled

# OR use OAuth
pi-patent login codex                       # GPT-5 Codex models (ChatGPT OAuth)
# (Anthropic OAuth removed — Anthropic's ToS prohibits programmatic OAuth.
#  Use $ANTHROPIC_API_KEY.)
```

OAuth tokens are cached at `${XDG_DATA_HOME:-~/.local/share}/pi-patent/oauth/`.

## Config (optional)

Copy this to `${XDG_CONFIG_HOME:-~/.config}/pi-patent/config.toml`:

```toml
provider = "anthropic"
model    = "claude-sonnet-4-6"

max_iter = 5
default_axis_threshold = 4
out_dir  = "~/patents"
web_search = true
search_provider = "tavily"

[rubric]
basic_novelty = 3

[models.drafter]
provider = "anthropic"
model    = "claude-sonnet-4-6"
thinking = "medium"
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | User error (bad config, missing key, intake rejected, empty disclosure) |
| 3 | LLM protocol error (malformed tool output) |
| 4 | External service failure (Tavily or LLM persistent 5xx) |
| 130 | Ctrl-C |
| 1 | Unexpected |

## Development

See `docs/specs/2026-04-23-patent-draft-cli-design.md` for architecture and `docs/plans/2026-04-23-patent-draft-cli.md` for the implementation plan.

```bash
npm run check    # biome + tsc --noEmit
npm test         # vitest
npm run build:appimage   # full Linux AppImage
```
