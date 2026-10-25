/**
 * A FIFO work queue: at most `limit` callers run their work at once, the others wait (their thread yields) and are
 * resumed in arrival order. RunValidationService puts every replay through one (REPLAY_CONCURRENCY), so concurrent
 * players' replays run one after another instead of stacking their CPU time on the same frames.
 *
 * Pure: waiting uses Luau's coroutine.running / coroutine.yield, and resuming is injected (`task.spawn` on the server,
 * `coroutine.resume` in the headless tests).
 */
export class WorkQueue {
	private running = 0;
	private readonly waiting: thread[] = [];

	constructor(private readonly limit: number, private readonly resume: (waiter: thread) => void) {}

	/**
	 * Runs `work` now if a slot is free, else after the callers before it. Returns what `work` returns and rethrows
	 * what it throws; the slot is handed on either way.
	 */
	run<T>(work: () => T): T {
		if (this.running < this.limit) {
			this.running++;
		} else {
			this.waiting.push(coroutine.running());
			coroutine.yield(); // resumed by release(), which hands over its slot (running is not decremented)
		}
		const [ok, result] = pcall(work);
		this.release();
		if (!ok) error(result, 0);
		return result as T;
	}

	/** Callers running or waiting. */
	size(): number {
		return this.running + this.waiting.size();
	}

	/** Callers waiting for a slot. */
	queued(): number {
		return this.waiting.size();
	}

	private release(): void {
		const first = this.waiting.shift();
		if (first !== undefined) this.resume(first);
		else this.running--;
	}
}
