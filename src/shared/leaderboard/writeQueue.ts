/**
 * The server's queue of personal-best writes (LeaderboardService drains it): DataStore budgets are per server and
 * shared, so writes go out at most `rate.count` per `rate.windowSeconds`, a failed write is retried later with
 * exponential backoff (never blocking the others), and several posts for the same player and board collapse into the
 * best one (only the best can become the personal best anyway).
 *
 * Pure: time is passed in; the service runs `take` / `failed` / `succeeded` from its loop.
 *
 * @module
 */
import { SlidingWindowLimiter } from "shared/run";
import { LEADERBOARD_WRITE_RATE, LEADERBOARD_WRITE_RETRY } from "./config";
import type { PostJob } from "./posting";

/**
 * One personal-best write waiting in the queue (or taken from it and in flight), with its retry state. `take` hands it
 * out and `failed` reads it back to count the attempt.
 */
export interface QueuedPost {
	readonly job: PostJob;
	/** Failed attempts so far. */
	readonly attempts: number;
	/** Not before this time (backoff), seconds. */
	readonly notBefore: number;
}

/**
 * How a failed write is retried: `attempts` is the total number of tries before the write is dropped; the wait before a
 * retry starts at `baseDelaySeconds`, doubles with each further failure and never exceeds `maxDelaySeconds`. The live
 * values are `LEADERBOARD_WRITE_RETRY`.
 */
export interface WriteRetryPolicy {
	readonly attempts: number;
	readonly baseDelaySeconds: number;
	readonly maxDelaySeconds: number;
}

/**
 * What queueing a write did: `queued` took a new slot; `replaced` means a lower value already queued for the same
 * player, board and scope gave way to this one; `kept` means the queued value was equal or higher and this write was
 * discarded.
 */
export type EnqueueOutcome = "queued" | "replaced" | "kept";

const RATE_KEY = "writes";

/** One queue slot per player, board and scope (`solo:alltime:7`, `solo:d303_r1:7`). */
export function postJobKey(job: Pick<PostJob, "board" | "scope" | "userId">): string {
	return `${job.board}:${job.scope}:${job.userId}`;
}

/**
 * The server's queue of personal-best writes described in the file comment, one slot per player, board and scope
 * (`postJobKey`), served oldest slot first. The rate defaults to `LEADERBOARD_WRITE_RATE` and the retry policy to
 * `LEADERBOARD_WRITE_RETRY`; a write still in backoff is skipped, not waited for. A failed write whose slot was
 * meanwhile filled by an equal or better post is dropped, since the queued one covers it.
 */
export class LeaderboardWriteQueue {
	private readonly byKey = new Map<string, QueuedPost>();
	private readonly order: string[] = [];
	private readonly limiter: SlidingWindowLimiter<string>;

	constructor(
		rate: { readonly count: number; readonly windowSeconds: number } = LEADERBOARD_WRITE_RATE,
		private readonly retry: WriteRetryPolicy = LEADERBOARD_WRITE_RETRY,
	) {
		this.limiter = new SlidingWindowLimiter<string>(rate.count, rate.windowSeconds);
	}

	/** Queues a write; a queued write for the same player, board and scope keeps only the higher value. */
	enqueue(job: PostJob, now: number): EnqueueOutcome {
		return this.put({ job, attempts: 0, notBefore: now });
	}

	/**
	 * The next write that may run at `now` (its backoff passed and the rate allows one), removed from the queue;
	 * undefined when none may. Report its outcome with succeeded / failed.
	 */
	take(now: number): QueuedPost | undefined {
		for (let i = 0; i < this.order.size(); i++) {
			const key = this.order[i];
			const q = this.byKey.get(key)!;
			if (q.notBefore > now) continue;
			if (!this.limiter.tryAcquire(RATE_KEY, now)) return undefined;
			this.order.remove(i);
			this.byKey.delete(key);
			return q;
		}
		return undefined;
	}

	/** A taken write failed: requeued with backoff, or dropped after `retry.attempts` tries. */
	failed(q: QueuedPost, now: number): "retry" | "dropped" {
		const attempts = q.attempts + 1;
		if (attempts >= this.retry.attempts) return "dropped";
		let delay = this.retry.baseDelaySeconds;
		for (let i = 1; i < attempts; i++) delay *= 2;
		delay = math.min(delay, this.retry.maxDelaySeconds);
		const outcome = this.put({ job: q.job, attempts, notBefore: now + delay });
		return outcome === "kept" ? "dropped" : "retry";
	}

	/** Every queued write, removed (the shutdown flush ignores rate and backoff). */
	takeAll(): QueuedPost[] {
		const out: QueuedPost[] = [];
		for (const key of this.order) out.push(this.byKey.get(key)!);
		this.order.clear();
		this.byKey.clear();
		return out;
	}

	size(): number {
		return this.order.size();
	}

	private put(q: QueuedPost): EnqueueOutcome {
		const key = postJobKey(q.job);
		const existing = this.byKey.get(key);
		if (existing !== undefined) {
			if (existing.job.value >= q.job.value) return "kept";
			this.byKey.set(key, { job: q.job, attempts: q.attempts, notBefore: q.notBefore });
			return "replaced";
		}
		this.byKey.set(key, q);
		this.order.push(key);
		return "queued";
	}
}
