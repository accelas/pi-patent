#!/usr/bin/env node
import { parseArgs } from "node:util";
import { UserError } from "./errors.js";
import { handleLogin } from "./oauth/login.js";

interface ParsedArgs {
	subcommand?: "login";
	loginTarget?: "codex" | "anthropic";
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
		if (target !== "codex" && target !== "anthropic") {
			throw new UserError(`Usage: pi-patent login <codex|anthropic>`);
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
	if (values["max-iter"] !== undefined) out.maxIter = Number(values["max-iter"]);
	if (values.model !== undefined) out.model = values.model;
	if (values.out !== undefined) out.out = values.out;
	if (values.quiet !== undefined) out.quiet = values.quiet;
	if (values["no-web"] !== undefined) out.noWeb = values["no-web"];
	if (values.help !== undefined) out.help = values.help;
	return out;
}

export async function mainCli(argv: string[]): Promise<number> {
	const parsed = parseCliArgs(argv);

	if (parsed.help) {
		console.log(HELP_TEXT);
		return 0;
	}

	if (parsed.subcommand === "login") {
		await handleLogin(parsed.loginTarget!);
		return 0;
	}

	// Main run implemented in cli-run.ts.
	const { runMain } = await import("./cli-run.js");
	return runMain(parsed);
}

const HELP_TEXT = `pi-patent — iterate a disclosure into a utility patent draft.

USAGE
  pi-patent                              interactive; reads disclosure from stdin
  pi-patent --input path/to/file.md      read disclosure from file
  cat disclosure.md | pi-patent          piped stdin

  pi-patent login codex                  ChatGPT OAuth for Codex models
  pi-patent login anthropic              Anthropic OAuth

OPTIONS
  --input <file>       disclosure file (markdown)
  --max-iter <n>       loop iteration cap (default 5)
  --model <id>         model override for all roles
  --out <dir>          output root (default ~/patents)
  --quiet              suppress streamed tokens; show score lines only
  --no-web             disable evaluator's web_search tool
  -h, --help           this message

Config file: $XDG_CONFIG_HOME/pi-patent/config.toml (optional)
Required env: ANTHROPIC_API_KEY (or run 'pi-patent login anthropic'); TAVILY_API_KEY if web_search enabled.
`;

// Entry point
if (import.meta.url === `file://${process.argv[1]}`) {
	mainCli(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => {
			console.error(err);
			process.exit(1);
		},
	);
}
