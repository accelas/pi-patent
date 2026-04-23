import type { OAuthProviderId } from "@mariozechner/pi-ai/oauth";
import { UserError } from "./errors.js";

interface ApiKeyMeta {
	kind: "api-key";
	envKey: string;
}
interface OauthMeta {
	kind: "oauth";
	loginCmd: "codex";
	oauthProviderId: OAuthProviderId;
}
type ProviderMeta = ApiKeyMeta | OauthMeta;

export const PROVIDER_META = {
	// Anthropic: API key only. OAuth login was previously supported but is
	// prohibited by Anthropic's ToS for programmatic access (as of 2026-04).
	anthropic: { kind: "api-key", envKey: "ANTHROPIC_API_KEY" },
	openai: { kind: "api-key", envKey: "OPENAI_API_KEY" },
	"openai-codex": {
		kind: "oauth",
		loginCmd: "codex",
		oauthProviderId: "openai-codex",
	},
	google: { kind: "api-key", envKey: "GEMINI_API_KEY" },
	groq: { kind: "api-key", envKey: "GROQ_API_KEY" },
	openrouter: { kind: "api-key", envKey: "OPENROUTER_API_KEY" },
} as const satisfies Record<string, ProviderMeta>;

export type KnownProvider = keyof typeof PROVIDER_META;

export interface CredentialStoreHasMethod {
	has(providerId: OAuthProviderId): boolean;
}

export function ensureCredentials(provider: string, role: string, credentialStore: CredentialStoreHasMethod): void {
	const meta = (PROVIDER_META as Record<string, ProviderMeta>)[provider];
	if (!meta) {
		throw new UserError(
			`Unsupported provider "${provider}" (role: ${role}). ` +
				`Supported in v1: ${Object.keys(PROVIDER_META).join(", ")}.`,
		);
	}
	if (meta.kind === "oauth") {
		if (!credentialStore.has(meta.oauthProviderId)) {
			throw new UserError(
				`No OAuth credentials for ${provider} (role: ${role}). ` + `Run: pi-patent login ${meta.loginCmd}`,
			);
		}
		return;
	}
	// kind === "api-key"
	if (!process.env[meta.envKey]) {
		throw new UserError(`$${meta.envKey} not set (required by ${role} via ${provider}).`);
	}
}
