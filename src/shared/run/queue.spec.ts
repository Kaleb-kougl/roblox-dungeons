// The server-wide replay queue (RunValidationService): at most `limit` callers run at once, the rest wait in order,
// errors are rethrown and never leak a slot. Threads are driven by hand with coroutines (task.spawn on the server).
import { describe, expect, it } from "@rbxts/jest-globals";
import { REPLAY_CONCURRENCY, RUN_PENDING_PER_PLAYER, WorkQueue } from "shared/run";

function resume(waiter: thread): void {
	coroutine.resume(waiter);
}

/** A caller that enters the queue, logs, yields once inside its work (a replay's task.wait), then logs again. */
function caller(q: WorkQueue, log: string[], name: string): thread {
	return coroutine.create(() =>
		q.run(() => {
			log.push(`${name} start`);
			coroutine.yield();
			log.push(`${name} end`);
		}),
	);
}

describe("WorkQueue", () => {
	it("runs one at a time in arrival order (limit 1)", () => {
		const q = new WorkQueue(1, resume);
		const log: string[] = [];
		const a = caller(q, log, "a");
		const b = caller(q, log, "b");
		const c = caller(q, log, "c");
		coroutine.resume(a);
		coroutine.resume(b);
		coroutine.resume(c);
		expect(log).toEqual(["a start"]);
		expect([q.size(), q.queued()]).toEqual([3, 2]);
		coroutine.resume(a); // a finishes and hands its slot to b
		expect(log).toEqual(["a start", "a end", "b start"]);
		coroutine.resume(b);
		coroutine.resume(c);
		expect(log).toEqual(["a start", "a end", "b start", "b end", "c start", "c end"]);
		expect(q.size()).toBe(0);
	});

	it("lets `limit` callers overlap", () => {
		const q = new WorkQueue(2, resume);
		const log: string[] = [];
		const a = caller(q, log, "a");
		const b = caller(q, log, "b");
		const c = caller(q, log, "c");
		coroutine.resume(a);
		coroutine.resume(b);
		coroutine.resume(c);
		expect(log).toEqual(["a start", "b start"]);
		coroutine.resume(b);
		expect(log).toEqual(["a start", "b start", "b end", "c start"]);
		coroutine.resume(a);
		coroutine.resume(c);
		expect(q.size()).toBe(0);
	});

	it("returns the work's value, rethrows its error and frees the slot either way", () => {
		const q = new WorkQueue(1, resume);
		expect(q.run(() => 42)).toBe(42);
		expect(() => q.run(() => error("boom", 0))).toThrow("boom");
		expect(q.size()).toBe(0);
		expect(q.run(() => "again")).toBe("again");
	});

	it("the service's queue and per-player budget are data (shared/run limits)", () => {
		expect(REPLAY_CONCURRENCY).toBeGreaterThanOrEqual(1);
		expect(RUN_PENDING_PER_PLAYER).toBeGreaterThanOrEqual(1);
	});
});
