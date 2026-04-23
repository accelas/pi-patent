import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import { UserError } from "./errors.js";
import { AXIS_NAMES, type AxisName, type ResolvedConfig, type RoleName, type ThinkingLevel } from "./types.js";

const VALID_THINKING: ReadonlySet<ThinkingLevel> = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

function validateThreshold(value: unknown, context: string): 1 | 2 | 3 | 4 | 5 {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
		throw new UserError(`Invalid threshold for ${context}: ${JSON.stringify(value)} (must be an integer 1–5).`);
	}
	return value as 1 | 2 | 3 | 4 | 5;
}

function validateThinking(value: unknown, context: string): ThinkingLevel {
	if (typeof value !== "string" || !VALID_THINKING.has(value as ThinkingLevel)) {
		throw new UserError(
			`Invalid thinking level for ${context}: ${JSON.stringify(value)} ` +
				`(must be one of: ${[...VALID_THINKING].join(", ")}).`,
		);
	}
	return value as ThinkingLevel;
}

export interface CliArgs {
	maxIter?: number;
	model?: string;
	out?: string;
	quiet?: boolean;
	web_search?: boolean;
	search_provider?: string;
}

export interface LoadConfigOpts {
	tomlSource: string | null;
	cliArgs: CliArgs;
	homeDir?: string;
}

const DEFAULT_THINKING: Record<RoleName, ThinkingLevel> = {
	intake: "low",
	drafter: "medium",
	evaluator: "low",
};

const DEFAULT_THRESHOLD = 4;

export function loadConfig(opts: LoadConfigOpts): ResolvedConfig {
	const toml = opts.tomlSource ? (parseToml(opts.tomlSource) as Record<string, unknown>) : {};
	const home = opts.homeDir ?? os.homedir();

	const topProvider = (toml.provider as string) ?? "anthropic";
	const topModel = (toml.model as string) ?? "claude-sonnet-4-6";

	const tomlModels = (toml.models as Record<string, Record<string, unknown>> | undefined) ?? {};

	const models: Record<RoleName, { provider: string; model: string; thinking: ThinkingLevel }> = {
		intake: resolveRoleModel("intake", tomlModels.intake, topProvider, topModel),
		drafter: resolveRoleModel("drafter", tomlModels.drafter, topProvider, topModel),
		evaluator: resolveRoleModel("evaluator", tomlModels.evaluator, topProvider, topModel),
	};

	if (opts.cliArgs.model) {
		models.intake.model = opts.cliArgs.model;
		models.drafter.model = opts.cliArgs.model;
		models.evaluator.model = opts.cliArgs.model;
	}

	const defaultThreshold = validateThreshold(
		toml.default_axis_threshold ?? DEFAULT_THRESHOLD,
		"default_axis_threshold",
	);
	const rubric = (toml.rubric as Partial<Record<AxisName, unknown>>) ?? {};
	const thresholds = {} as Record<AxisName, 1 | 2 | 3 | 4 | 5>;
	for (const axis of AXIS_NAMES) {
		thresholds[axis] = validateThreshold(rubric[axis] ?? defaultThreshold, `rubric.${axis}`);
	}

	const outDirRaw = (opts.cliArgs.out ?? (toml.out_dir as string) ?? "./patents") as string;
	const out_dir = outDirRaw.startsWith("~/") ? path.join(home, outDirRaw.slice(2)) : path.resolve(outDirRaw);

	return {
		max_iter: opts.cliArgs.maxIter ?? (toml.max_iter as number) ?? 5,
		thresholds,
		out_dir,
		quiet: opts.cliArgs.quiet ?? (toml.quiet as boolean) ?? false,
		web_search: opts.cliArgs.web_search ?? (toml.web_search as boolean) ?? true,
		search_provider: opts.cliArgs.search_provider ?? (toml.search_provider as string) ?? "tavily",
		models,
	};
}

function resolveRoleModel(
	role: RoleName,
	roleToml: Record<string, unknown> | undefined,
	topProvider: string,
	topModel: string,
): { provider: string; model: string; thinking: ThinkingLevel } {
	return {
		provider: (roleToml?.provider as string) ?? topProvider,
		model: (roleToml?.model as string) ?? topModel,
		thinking:
			roleToml?.thinking !== undefined
				? validateThinking(roleToml.thinking, `models.${role}.thinking`)
				: DEFAULT_THINKING[role],
	};
}

export function loadConfigFromDisk(cliArgs: CliArgs): ResolvedConfig {
	const home = os.homedir();
	const xdg = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
	const file = path.join(xdg, "pi-patent", "config.toml");
	let tomlSource: string | null = null;
	try {
		tomlSource = fs.readFileSync(file, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
	return loadConfig({ tomlSource, cliArgs });
}
