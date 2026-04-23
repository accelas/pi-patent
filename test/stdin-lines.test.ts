import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { _resetForTests, readLine, stdinExhausted } from "../src/stdin-lines.js";

// Replace process.stdin with a controllable EventEmitter for tests.
// The module attaches listeners at first readLine() call via start().
interface FakeStdin extends EventEmitter {
	setEncoding(_enc: string): void;
	readableEnded: boolean;
}

function installFakeStdin(): FakeStdin {
	const fake = new EventEmitter() as FakeStdin;
	fake.setEncoding = () => undefined;
	fake.readableEnded = false;
	Object.defineProperty(process, "stdin", { value: fake, configurable: true, writable: true });
	return fake;
}

afterEach(() => {
	_resetForTests();
});

describe("readLine", () => {
	it("returns one line per call when full lines arrive", async () => {
		const s = installFakeStdin();
		const p1 = readLine();
		const p2 = readLine();
		s.emit("data", "hello\nworld\n");
		expect(await p1).toBe("hello");
		expect(await p2).toBe("world");
	});

	it("strips trailing \\r (CRLF handling)", async () => {
		const s = installFakeStdin();
		const p = readLine();
		s.emit("data", "windows\r\n");
		expect(await p).toBe("windows");
	});

	it("buffers across multiple chunks", async () => {
		const s = installFakeStdin();
		const p = readLine();
		s.emit("data", "par");
		s.emit("data", "tial\n");
		expect(await p).toBe("partial");
	});

	it("returns remaining partial buffer on EOF, then '' forever", async () => {
		const s = installFakeStdin();
		const p1 = readLine();
		const p2 = readLine();
		s.emit("data", "lastline");
		s.emit("end");
		expect(await p1).toBe("lastline");
		expect(await p2).toBe("");
		expect(await readLine()).toBe("");
	});

	it("returns '' immediately when stdin is already ended", async () => {
		const s = installFakeStdin();
		s.readableEnded = true;
		expect(await readLine()).toBe("");
		expect(await readLine()).toBe("");
	});

	it("'error' on stdin ends the stream and subsequent reads return ''", async () => {
		const s = installFakeStdin();
		const p = readLine();
		s.emit("error", new Error("boom"));
		expect(await p).toBe("");
		expect(await readLine()).toBe("");
	});
});

describe("stdinExhausted", () => {
	it("is true when stdin is already ended and buffer is empty", () => {
		const s = installFakeStdin();
		s.readableEnded = true;
		expect(stdinExhausted()).toBe(true);
	});

	it("is false while data remains buffered, true after final drain", async () => {
		const s = installFakeStdin();
		// start() is lazy — call readLine() first so listeners are attached,
		// then push data + end.
		const p1 = readLine();
		s.emit("data", "line1\nleftover");
		s.emit("end");
		expect(await p1).toBe("line1");
		// buffer still has 'leftover'; not yet exhausted
		expect(stdinExhausted()).toBe(false);
		expect(await readLine()).toBe("leftover");
		// now buffer empty AND ended → exhausted
		expect(stdinExhausted()).toBe(true);
	});
});
