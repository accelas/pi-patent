import type { AxisName, IntakeResult, ResolvedConfig, RoleName, Verdict } from "../types.js";
import { AXIS_NAMES } from "../types.js";

export function renderSeed(disclosure: string, intake: IntakeResult): string {
	const lines: (string | false | undefined)[] = [
		"## Disclosure",
		disclosure,
		"",
		"## Intake context",
		`- scope_preference: ${intake.scope_preference ?? "balanced"}`,
		intake.technical_field && `- technical_field: ${intake.technical_field}`,
		intake.core_novelty && `- core_novelty: ${intake.core_novelty}`,
		intake.known_prior_art && `- known_prior_art: ${intake.known_prior_art}`,
		intake.key_embodiments?.length
			? `- key_embodiments:\n${intake.key_embodiments.map((e) => `  - ${e}`).join("\n")}`
			: undefined,
		"",
		"Emit the patent draft + layman block now.",
	];
	return lines.filter(Boolean).join("\n");
}

export function renderEvalInput(disclosure: string, intake: IntakeResult, draft: string, layman: string): string {
	return [
		"## Disclosure",
		disclosure,
		"",
		"## Intake context",
		"```json",
		JSON.stringify(intake, null, 2),
		"```",
		"",
		"## Draft",
		draft,
		"",
		"## Layman explanation",
		layman,
		"",
		"Run your rubric, perform at most 5 web_search calls for the basic_novelty axis, then call submit_verdict.",
	].join("\n");
}

export function renderCritique(v: Verdict, iter: number): string {
	const high = v.issues.filter((i) => i.priority === "high");
	const rest = v.issues.filter((i) => i.priority !== "high");
	const passing = AXIS_NAMES.map((a): [AxisName, number] => [a, v.scores[a]]).filter(([, s]) => s >= 4);

	const parts: (string | false | undefined)[] = [
		`## Reviewer feedback (iteration ${iter})`,
		"",
		v.next_iteration_focus ? `### Focus for this iteration\n${v.next_iteration_focus}\n` : undefined,

		high.length
			? [
					"### Axes below threshold — fix these:",
					...high.map((i) => `- **${i.axis}** (${v.scores[i.axis]}/5): ${i.issue}\n    → ${i.suggestion}`),
				].join("\n")
			: "### Axes below threshold: none",
		"",

		rest.length
			? ["### Secondary notes:", ...rest.map((i) => `- ${i.axis}: ${i.issue}\n    → ${i.suggestion}`)].join("\n")
			: undefined,

		passing.length ? `### Do not regress: ${passing.map(([a, s]) => `${a} (${s})`).join(", ")}` : undefined,

		v.prior_art_flags?.length
			? [
					"### Prior-art flags:",
					...v.prior_art_flags.map((f) => `- [${f.overlap_level}] "${f.title}" (${f.url ?? "no url"}) — ${f.overlap}`),
				].join("\n")
			: "### Prior-art flags: none",
		"",
		`### Evaluator summary: ${v.summary}`,
		"",
		"Revise and re-emit the full patent draft + layman block in the same two-block format.",
	];
	return parts.filter(Boolean).join("\n");
}

export function promptVarsFor(role: RoleName, cfg: ResolvedConfig): Record<string, string> {
	if (role === "evaluator") {
		const list = AXIS_NAMES.map((a) => `${a} ≥ ${cfg.thresholds[a]}`).join(" · ");
		return { thresholds_list: list };
	}
	return {};
}
