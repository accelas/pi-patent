import { createInterface } from "node:readline/promises";
import { type OAuthProviderId, getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import { UserError } from "../errors.js";
import { credentialStore } from "./store.js";

const SUBCMD_TO_PROVIDER: Record<"codex" | "anthropic", OAuthProviderId> = {
	codex: "openai-codex",
	anthropic: "anthropic",
};

export async function handleLogin(subcmd: "codex" | "anthropic"): Promise<void> {
	const providerId = SUBCMD_TO_PROVIDER[subcmd];
	const provider = getOAuthProvider(providerId);
	if (!provider) throw new UserError(`OAuth provider not registered: ${providerId}`);

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const creds = await provider.login({
			onAuth: (info) => {
				console.log(`\nOpen this URL in your browser to authenticate:\n  ${info.url}`);
				if (info.instructions) console.log(`\n${info.instructions}`);
			},
			onPrompt: async (p) => rl.question(`${p.message}: `),
			onProgress: (msg) => console.log(`• ${msg}`),
		});
		credentialStore.save(providerId, creds);
		console.log(`✓ OAuth login complete for ${providerId}`);
	} finally {
		rl.close();
	}
}
