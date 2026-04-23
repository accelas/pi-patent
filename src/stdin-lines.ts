/**
 * Read lines from process.stdin without Node's `readline` (which has subtle
 * EOF semantics on piped stdin, and is re-polyfilled by Bun with additional
 * bugs when compiled via `bun build --compile`).
 *
 * Usage:
 *   import { readLine, writePrompt } from "./stdin-lines.js";
 *   writePrompt("Q: pick a number\n> ");
 *   const answer = await readLine();
 *
 * Semantics:
 *   - Returns one line (without trailing \n or \r).
 *   - On EOF, returns "" (and subsequent calls also return "").
 *   - Buffers multiple lines arriving in one chunk; successive readLine() calls
 *     consume them in order.
 *   - Safe when stdin was previously fully consumed (e.g. by readDisclosure's
 *     piped-input path): readableEnded is detected at first call and subsequent
 *     reads return "" immediately.
 */

let buffer = "";
let stdinEnded = false;
let started = false;
const waiters: Array<(line: string) => void> = [];

function drain(): void {
	while (waiters.length > 0) {
		const nl = buffer.indexOf("\n");
		if (nl >= 0) {
			let line = buffer.slice(0, nl);
			buffer = buffer.slice(nl + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			const resolve = waiters.shift();
			resolve?.(line);
			continue;
		}
		if (stdinEnded) {
			// Final partial line (no trailing newline), then drain the rest as ""
			const tail = buffer;
			buffer = "";
			const resolve = waiters.shift();
			resolve?.(tail);
			continue;
		}
		return;
	}
	// No active waiters — pause stdin to apply backpressure, so a producer like
	// `yes` doesn't overflow our buffer when the CLI is between prompts (or done).
	if (!stdinEnded) {
		try {
			process.stdin.pause();
		} catch {
			/* pause unsupported (e.g. fake stdin in tests); ignore */
		}
	}
}

function start(): void {
	if (started) return;
	started = true;

	// If stdin was already ended (e.g. previous piped-input consumer fully read it),
	// flag as done and drain any future readLine calls as "".
	if (process.stdin.readableEnded) {
		stdinEnded = true;
		return;
	}

	process.stdin.setEncoding("utf-8");
	process.stdin.on("data", (chunk: string | Buffer) => {
		buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
		drain();
	});
	process.stdin.on("end", () => {
		stdinEnded = true;
		drain();
	});
	process.stdin.on("error", () => {
		stdinEnded = true;
		drain();
	});
}

export function readLine(): Promise<string> {
	start();
	if (stdinEnded && buffer.length === 0) return Promise.resolve("");
	// Resume reading now that a consumer is waiting (we pause when idle — see drain()).
	if (!stdinEnded) {
		try {
			process.stdin.resume();
		} catch {
			/* resume unsupported (e.g. fake stdin in tests); ignore */
		}
	}
	return new Promise<string>((resolve) => {
		waiters.push(resolve);
		drain();
	});
}

export function writePrompt(text: string): void {
	process.stdout.write(text);
}

/**
 * For testing: reset internal state. Not exported from package index;
 * vitest tests import directly.
 */
export function _resetForTests(): void {
	buffer = "";
	stdinEnded = false;
	started = false;
	waiters.length = 0;
}
