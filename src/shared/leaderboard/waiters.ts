/**
 * Waits on personal-best writes (the daily verdict, docs/DAILY.md DS5): a daily run's verdict says whether each
 * member's entry went up and what it was before, so it waits for their writes, which go through the server's write
 * queue (LeaderboardWriteQueue: coalesced per player, board and scope, rate limited, retried).
 *
 * Waits are keyed by the queue slot (postJobKey) and carry the value they posted. A write resolves every wait on its
 * slot whose value it covers (value <= the written one: a coalesced better job of the same player covers a worse
 * one; an older write that was already in flight when a better run was queued does not); a dropped write (out of
 * retries) resolves the waits it covers as not posted. Each wait judges `improved` on its own value against what the
 * write found (`previous`), so a run whose better twin was written still reads as improved over the old entry.
 *
 * Pure: the service polls `done`.
 */
import { isBetterValue } from "./posting";

export interface PostWaitOutcome {
	/** The entry write completed: the board holds this run's value or a better one of the player's. */
	readonly posted: boolean;
	/** This run's value raised the entry (higher than what the write found). */
	readonly improved: boolean;
	/** The valid entry the write found (undefined: none). */
	readonly previous?: number;
	/** The entry after the write (undefined when not posted). */
	readonly entry?: number;
}

export interface PostWait {
	readonly key: string;
	readonly value: number;
	done: boolean;
	outcome?: PostWaitOutcome;
}

export class PostWaiters {
	private readonly byKey = new Map<string, PostWait[]>();

	/** A wait for the write of `value` on queue slot `key`. */
	add(key: string, value: number): PostWait {
		const wait: PostWait = { key, value, done: false };
		const list = this.byKey.get(key);
		if (list === undefined) this.byKey.set(key, [wait]);
		else list.push(wait);
		return wait;
	}

	/** A write of `value` on `key` completed; `improved` / `previous` from its transform (postPersonalBest). */
	written(key: string, value: number, improved: boolean, previous: number | undefined): void {
		const entry = improved ? value : previous;
		this.settle(key, value, (w) => ({
			posted: true,
			improved: isBetterValue(w.value, previous),
			previous,
			entry,
		}));
	}

	/** A write of `value` on `key` was given up (out of retries, or cut off at shutdown). */
	dropped(key: string, value: number): void {
		this.settle(key, value, () => ({ posted: false, improved: false }));
	}

	/** Stops waiting (the verdict's deadline passed). */
	cancel(wait: PostWait): void {
		const list = this.byKey.get(wait.key);
		if (list === undefined) return;
		const i = list.indexOf(wait);
		if (i >= 0) list.remove(i);
		if (list.size() === 0) this.byKey.delete(wait.key);
	}

	/** Waits not yet resolved (for leak checks). */
	size(): number {
		let n = 0;
		for (const [, list] of this.byKey) n += list.size();
		return n;
	}

	private settle(key: string, value: number, outcomeOf: (w: PostWait) => PostWaitOutcome): void {
		const list = this.byKey.get(key);
		if (list === undefined) return;
		const keep: PostWait[] = [];
		for (const w of list) {
			if (w.value > value) {
				keep.push(w);
				continue;
			}
			w.outcome = outcomeOf(w);
			w.done = true;
		}
		if (keep.size() === 0) this.byKey.delete(key);
		else this.byKey.set(key, keep);
	}
}
