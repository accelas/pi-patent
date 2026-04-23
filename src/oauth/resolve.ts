import { getEnvApiKey as realGetEnvApiKey } from "@mariozechner/pi-ai";
import { type OAuthProviderId, getOAuthApiKey as realGetOAuthApiKey } from "@mariozechner/pi-ai/oauth";
import { type CredentialStore, credentialStore as defaultStore } from "./store.js";

const OAUTH_PROVIDERS = new Set<OAuthProviderId>(["openai-codex", "anthropic"]);

export interface ResolveDeps {
	store?: CredentialStore;
	getOAuthApiKey?: typeof realGetOAuthApiKey;
	getEnvApiKey?: typeof realGetEnvApiKey;
}

export function makeResolveApiKey(deps: ResolveDeps = {}) {
	const store = deps.store ?? defaultStore;
	const getOAuthApiKey = deps.getOAuthApiKey ?? realGetOAuthApiKey;
	const getEnvApiKey = deps.getEnvApiKey ?? realGetEnvApiKey;

	return async function resolveApiKey(provider: string): Promise<string | undefined> {
		if (provider === "anthropic" && process.env.ANTHROPIC_OAUTH_TOKEN) {
			return process.env.ANTHROPIC_OAUTH_TOKEN;
		}

		if (OAUTH_PROVIDERS.has(provider as OAuthProviderId)) {
			const oauthId = provider as OAuthProviderId;
			const creds = store.load(oauthId);
			if (creds) {
				const result = await getOAuthApiKey(oauthId, { [oauthId]: creds });
				if (result) {
					if (result.newCredentials !== creds) store.save(oauthId, result.newCredentials);
					return result.apiKey;
				}
			}
		}

		return getEnvApiKey(provider);
	};
}

export const resolveApiKey = makeResolveApiKey();
