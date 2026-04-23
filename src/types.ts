import { type Static, Type } from "typebox";

// ---------- Intake ----------

export const ScopePreferenceSchema = Type.Union([
	Type.Literal("broad"),
	Type.Literal("balanced"),
	Type.Literal("narrow"),
]);
export type ScopePreference = Static<typeof ScopePreferenceSchema>;

export const IntakeResultSchema = Type.Object({
	accepted: Type.Boolean(),
	rejection_reason: Type.Optional(Type.String()),
	scope_preference: Type.Optional(ScopePreferenceSchema),
	technical_field: Type.Optional(Type.String()),
	core_novelty: Type.Optional(Type.String()),
	known_prior_art: Type.Optional(Type.String()),
	key_embodiments: Type.Optional(Type.Array(Type.String())),
});
export type IntakeResult = Static<typeof IntakeResultSchema>;

// ---------- Verdict ----------

export const AXIS_NAMES = [
	"claim_breadth",
	"claim_clarity",
	"spec_support",
	"basic_novelty",
	"layman_quality",
] as const;
export type AxisName = (typeof AXIS_NAMES)[number];

const Score = Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3), Type.Literal(4), Type.Literal(5)]);
const AxisNameSchema = Type.Union(AXIS_NAMES.map((a) => Type.Literal(a)));

export const VerdictSchema = Type.Object({
	verdict: Type.Union([Type.Literal("pass"), Type.Literal("revise")]),
	scores: Type.Object({
		claim_breadth: Score,
		claim_clarity: Score,
		spec_support: Score,
		basic_novelty: Score,
		layman_quality: Score,
	}),
	issues: Type.Array(
		Type.Object({
			axis: AxisNameSchema,
			issue: Type.String(),
			suggestion: Type.String(),
			priority: Type.Union([Type.Literal("high"), Type.Literal("med"), Type.Literal("low")]),
		}),
		{ maxItems: 5 },
	),
	prior_art_flags: Type.Optional(
		Type.Array(
			Type.Object({
				title: Type.String(),
				url: Type.Optional(Type.String()),
				overlap: Type.String(),
				overlap_level: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
			}),
		),
	),
	next_iteration_focus: Type.Optional(Type.String()),
	summary: Type.String(),
});
export type Verdict = Static<typeof VerdictSchema>;

// ---------- Config (runtime-resolved) ----------

export type RoleName = "intake" | "drafter" | "evaluator";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface RoleModelConfig {
	provider: string;
	model: string;
	thinking: ThinkingLevel;
}

export interface ResolvedConfig {
	max_iter: number;
	thresholds: Record<AxisName, 1 | 2 | 3 | 4 | 5>;
	out_dir: string;
	quiet: boolean;
	web_search: boolean;
	search_provider: string;
	models: Record<RoleName, RoleModelConfig>;
}

// ---------- Session artifacts ----------

export interface SessionJson {
	schema_version: 1;
	session_id: string;
	started_at: string;
	ended_at?: string;
	status: "running" | "passed" | "max_iter" | "aborted" | "error";
	iterations: number;
	final_verdict?: Verdict;
	usage: {
		total_input_tokens: number;
		total_output_tokens: number;
		total_cost_usd: number;
		by_role: Record<RoleName, number>;
	};
	abort?: { at: string; last_completed: number; reason: "sigint" | "signal" };
	error?: {
		at: string;
		category: "user" | "llm_protocol" | "search_backend" | "unexpected";
		message: string;
		last_completed_iteration: number;
	};
	intake: IntakeResult;
	config_snapshot: {
		thresholds: Record<AxisName, 1 | 2 | 3 | 4 | 5>;
		max_iter: number;
		web_search: boolean;
		search_provider: string;
		models: Record<RoleName, { provider: string; model: string; thinking: string }>;
	};
}
