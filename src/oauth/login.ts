import { type OAuthProviderId, getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import { UserError } from "../errors.js";
import { readLine, writePrompt } from "../stdin-lines.js";
import { credentialStore } from "./store.js";

// Anthropic OAuth support removed 2026-04: prohibited by Anthropic's ToS for
// programmatic access. Use $ANTHROPIC_API_KEY instead. Codex remains supported.
const SUBCMD_TO_PROVIDER: Record<"codex", OAuthProviderId> = {
	codex: "openai-codex",
};

export type LoginSubcommand = keyof typeof SUBCMD_TO_PROVIDER;

export async function handleLogin(subcmd: LoginSubcommand): Promise<void> {
	const providerId = SUBCMD_TO_PROVIDER[subcmd];
	const provider = getOAuthProvider(providerId);
	if (!provider) throw new UserError(`OAuth provider not registered: ${providerId}`);

	const creds = await provider.login({
		onAuth: (info) => {
			console.log(`\nOpen this URL in your browser to authenticate:\n  ${info.url}`);
			if (info.instructions) console.log(`\n${info.instructions}`);
		},
		onPrompt: async (p) => {
			writePrompt(`${p.message}: `);
			return readLine();
		},
		onProgress: (msg) => console.log(`• ${msg}`),
	});
	credentialStore.save(providerId, creds);
	console.log(`✓ OAuth login complete for ${providerId}`);
}
