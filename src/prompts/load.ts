import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { LlmProtocolError, UserError } from "../errors.js";

export type PromptName = "intake" | "drafter" | "evaluator";

export function stripFrontmatter(raw: string): string {
	if (!raw.startsWith("---\n")) return raw;
	const end = raw.indexOf("\n---\n", 4);
	if (end === -1) return raw;
	return raw.slice(end + 5);
}

export function substitute(body: string, vars: Record<string, string | number>): string {
	let out = body;
	for (const [k, v] of Object.entries(vars)) {
		out = out.replaceAll(`{{${k}}}`, String(v));
	}
	const unresolved = out.match(/\{\{[a-zA-Z0-9_]+\}\}/);
	if (unresolved) {
		throw new LlmProtocolError(`Unresolved prompt placeholder: ${unresolved[0]}`);
	}
	return out;
}

export function loadPromptFrom(
	dir: string,
	name: string,
	vars: Record<string, string | number>,
): string {
	const file = path.join(dir, `${name}.md`);
	if (!fs.existsSync(file)) {
		throw new UserError(`Prompt not found: ${file}`);
	}
	const body = stripFrontmatter(fs.readFileSync(file, "utf-8"));
	return substitute(body, vars);
}

export function resolvePromptPath(name: PromptName): string {
	const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
	const candidates: string[] = [path.join(xdg, "pi-patent", "prompts", `${name}.md`)];
	if (process.env.PI_PATENT_PROMPTS_DIR) {
		candidates.push(path.join(process.env.PI_PATENT_PROMPTS_DIR, `${name}.md`));
	}
	candidates.push(fileURLToPath(new URL(`./${name}.md`, import.meta.url)));

	for (const p of candidates) {
		if (fs.existsSync(p)) return p;
	}
	throw new UserError(
		`Prompt "${name}" not found. Searched:\n${candidates.map((p) => `  - ${p}`).join("\n")}`,
	);
}

export function loadPrompt(name: PromptName, vars: Record<string, string | number> = {}): string {
	const file = resolvePromptPath(name);
	const body = stripFrontmatter(fs.readFileSync(file, "utf-8"));
	return substitute(body, vars);
}
