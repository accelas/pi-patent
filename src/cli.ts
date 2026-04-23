#!/usr/bin/env node
import { parseArgs } from "node:util";
import { exitFromError } from "./cli-run.js";
import { UserError } from "./errors.js";
import { handleLogin } from "./oauth/login.js";

interface ParsedArgs {
	subcommand?: "login";
	loginTarget?: "codex";
	input?: string;
	maxIter?: number;
	model?: string;
	out?: string;
	quiet?: boolean;
	noWeb?: boolean;
	help?: boolean;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
	if (argv[0] === "login") {
		const target = argv[1];
		if (target !== "codex") {
			// Anthropic OAuth subcommand removed 2026-04 (ToS prohibits programmatic OAuth).
			// Set $ANTHROPIC_API_KEY for Anthropic access.
			throw new UserError("Usage: pi-patent login codex");
		}
		return { subcommand: "login", loginTarget: target };
	}

	const { values } = parseArgs({
		args: argv,
		options: {
			input: { type: "string" },
			"max-iter": { type: "string" },
			model: { type: "string" },
			out: { type: "string" },
			quiet: { type: "boolean" },
			"no-web": { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
		allowPositionals: false,
		strict: true,
	});

	const out: ParsedArgs = {};
	if (values.input !== undefined) out.input = values.input;
	if (values["max-iter"] !== undefined) {
		const raw = values["max-iter"];
		const n = Number(raw);
		if (!Number.isInteger(n) || n < 1) {
			throw new UserError(`--max-iter must be a positive integer (got "${raw}").`);
		}
		out.maxIter = n;
	}
	if (values.model !== undefined) out.model = values.model;
	if (values.out !== undefined) out.out = values.out;
	if (values.quiet !== undefined) out.quiet = values.quiet;
	if (values["no-web"] !== undefined) out.noWeb = values["no-web"];
	if (values.help !== undefined) out.help = values.help;
	return out;
}

export async function mainCli(argv: string[]): Promise<number> {
	let parsed: ParsedArgs;
	try {
		parsed = parseCliArgs(argv);
	} catch (err) {
		// Node's parseArgs throws errors with a `code` property; map unknown
		// options to a friendly UserError so they exit with code 2 instead of 1.
		if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
			return exitFromError(new UserError(`${err.message} (try --help)`));
		}
		return exitFromError(err);
	}

	if (parsed.help) {
		console.log(HELP_TEXT);
		return 0;
	}

	try {
		if (parsed.subcommand === "login") {
			const target = parsed.loginTarget;
			if (target !== "codex") {
				throw new UserError("Usage: pi-patent login codex");
			}
			await handleLogin(target);
			return 0;
		}

		// Main run implemented in cli-run.ts.
		const { runMain } = await import("./cli-run.js");
		return await runMain(parsed);
	} catch (err) {
		return exitFromError(err);
	}
}

const HELP_TEXT = `pi-patent — iterate a disclosure into a utility patent draft.

USAGE
  pi-patent                              interactive; reads disclosure from stdin
  pi-patent --input path/to/file.md      read disclosure from file
  cat disclosure.md | pi-patent          piped stdin

  pi-patent login codex                  ChatGPT OAuth for Codex models
                                         (Anthropic OAuth removed — use $ANTHROPIC_API_KEY)

OPTIONS
  --input <file>       disclosure file (markdown)
  --max-iter <n>       loop iteration cap (default 5)
  --model <id>         model override for all roles
  --out <dir>          output root (default ~/patents)
  --quiet              suppress streamed tokens; show score lines only
  --no-web             disable evaluator's web_search tool
  -h, --help           this message

Config file: $XDG_CONFIG_HOME/pi-patent/config.toml (optional)
Required env: $ANTHROPIC_API_KEY for Anthropic, $OPENROUTER_API_KEY for OpenRouter, etc.; $TAVILY_API_KEY if web_search enabled.
`;

// Entry point
if (import.meta.url === `file://${process.argv[1]}`) {
	mainCli(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => process.exit(exitFromError(err)),
	);
}
