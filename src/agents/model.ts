import { getModel } from "@mariozechner/pi-ai";
import { UserError } from "../errors.js";
import type { RoleName } from "../types.js";
import { buildCustomModel } from "./custom-models.js";

/**
 * Resolve a model by provider + id for a specific role, throwing UserError
 * if the combination is unknown.
 *
 * Checks custom providers (e.g. openrouter) first; falls back to pi-ai's registry.
 * `getModel` uses strict generic literals which clash with the runtime strings
 * we carry in ResolvedConfig. This helper is the single place that handles the
 * cast + runtime validation; factories should delegate to it.
 */
// biome-ignore lint/suspicious/noExplicitAny: getModel uses strict generic literals; we validate at runtime below.
export function resolveModelOrThrow(role: RoleName, provider: string, modelId: string): any {
	const custom = buildCustomModel(provider, modelId);
	if (custom) return custom;

	// biome-ignore lint/suspicious/noExplicitAny: see comment above.
	const model = getModel(provider as any, modelId as any);
	if (!model) throw new UserError(`Unknown model "${modelId}" for provider "${provider}" (${role})`);
	return model;
}
