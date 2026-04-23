import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { OAuthCredentials, OAuthProviderId } from "@mariozechner/pi-ai/oauth";
import { UserError } from "../errors.js";

function isOAuthCredentials(v: unknown): v is OAuthCredentials {
	if (v === null || typeof v !== "object") return false;
	const obj = v as Record<string, unknown>;
	// OAuthCredentials has at minimum `access: string`; other fields are optional/provider-specific.
	return typeof obj.access === "string";
}

export interface CredentialStore {
	load(providerId: OAuthProviderId): OAuthCredentials | null;
	save(providerId: OAuthProviderId, creds: OAuthCredentials): void;
	has(providerId: OAuthProviderId): boolean;
}

export class FileCredentialStore implements CredentialStore {
	constructor(private readonly dir: string) {
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	private file(providerId: OAuthProviderId): string {
		return path.join(this.dir, `${providerId}.json`);
	}

	has(providerId: OAuthProviderId): boolean {
		return fs.existsSync(this.file(providerId));
	}

	load(providerId: OAuthProviderId): OAuthCredentials | null {
		const f = this.file(providerId);
		if (!fs.existsSync(f)) return null;
		let raw: string;
		try {
			raw = fs.readFileSync(f, "utf-8");
		} catch (err) {
			throw new UserError(
				`Cannot read OAuth credential file ${f}: ${(err as Error).message}. ` +
					`Run: pi-patent login ${providerId === "openai-codex" ? "codex" : providerId}`,
			);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new UserError(
				`OAuth credential file ${f} is corrupt (invalid JSON). ` +
					`Delete it and run: pi-patent login ${providerId === "openai-codex" ? "codex" : providerId}`,
			);
		}
		if (!isOAuthCredentials(parsed)) {
			throw new UserError(
				`OAuth credential file ${f} has unexpected shape (missing access token). ` +
					`Delete it and run: pi-patent login ${providerId === "openai-codex" ? "codex" : providerId}`,
			);
		}
		return parsed;
	}

	save(providerId: OAuthProviderId, creds: OAuthCredentials): void {
		const f = this.file(providerId);
		const tmp = `${f}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
		fs.renameSync(tmp, f);
	}
}

export function defaultStoreDir(): string {
	const xdg = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
	return path.join(xdg, "pi-patent", "oauth");
}

export const credentialStore: CredentialStore = new FileCredentialStore(defaultStoreDir());
