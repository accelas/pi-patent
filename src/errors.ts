export class UserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UserError";
	}
}

export class IntakeRejected extends Error {
	constructor(public readonly reason: string) {
		super(reason);
		this.name = "IntakeRejected";
	}
}

export class LlmProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LlmProtocolError";
	}
}

export class SearchBackendError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SearchBackendError";
	}
}

export class AbortError extends Error {
	constructor(message = "aborted") {
		super(message);
		this.name = "AbortError";
	}
}
