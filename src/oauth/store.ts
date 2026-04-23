import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { OAuthCredentials, OAuthProviderId } from "@mariozechner/pi-ai/oauth";

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
		return JSON.parse(fs.readFileSync(f, "utf-8")) as OAuthCredentials;
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
