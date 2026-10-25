/**
 * A small, mockable persistence layer for per-player documents (settings today). Pure TypeScript: the store and the
 * wait function are injected, so headless tests drive it with an in-memory store, and the server passes a DataStore
 * adapter and `task.wait` (src/server/services/data/DataStoreKeyValue.ts).
 *
 * Semantics: load once per session (with retries), serve reads from the session cache, mark dirty on change, write on
 * save (leave, BindToClose, autosave) with retries. Last write wins (no session locking: a setting is low value and a
 * player rarely runs two servers at once). If the load failed, the stored value is never overwritten unless the
 * player changed something in this session.
 *
 * Concurrency (the store yields): concurrent loads of one key share the first one's read (later callers wait for it),
 * and a save while another save of the same key is writing waits for it and then writes only if still dirty, so the
 * leave and BindToClose paths never both write the same document.
 */

/** A key-value store. Calls may yield and may throw (DataStore errors, throttling). */
export interface KeyValueStore {
	get(key: string): unknown;
	/** `userIds`: the players whose data this is (DataStore SetAsync's userIds, for erasure requests). */
	set(key: string, value: unknown, userIds?: ReadonlyArray<number>): void;
}

export interface RetryPolicy {
	/** Total tries (>= 1). */
	readonly attempts: number;
	/** Wait before the second try; doubles after each failure. */
	readonly baseDelaySeconds: number;
}

export type RetryResult<T> =
	| { readonly ok: true; readonly value: T; readonly attempts: number }
	| { readonly ok: false; readonly error: string; readonly attempts: number };

/** Calls `fn` until it returns without throwing, at most `policy.attempts` times, waiting with exponential backoff. */
export function withRetries<T>(fn: () => T, policy: RetryPolicy, wait: (seconds: number) => void): RetryResult<T> {
	let delay = policy.baseDelaySeconds;
	let lastError = "";
	for (let attempt = 1; attempt <= policy.attempts; attempt++) {
		const [ok, result] = pcall(fn);
		if (ok) return { ok: true, value: result as T, attempts: attempt };
		lastError = tostring(result);
		if (attempt < policy.attempts) {
			wait(delay);
			delay *= 2;
		}
	}
	return { ok: false, error: lastError, attempts: policy.attempts };
}

/** How a document is read from / written to the store. */
export interface DocCodec<T> {
	/** A stored value (or undefined when the key was never written) -> document. Must not throw. */
	decode(raw: unknown): T;
	encode(doc: T): unknown;
	equals(a: T, b: T): boolean;
	/** The document of a player with nothing stored. */
	empty(): T;
}

interface Entry<T> {
	doc: T;
	dirty: boolean;
	/** The load failed: the stored value is unknown, so only an explicit change may overwrite it. */
	loadFailed: boolean;
	/** Owners passed to the store on every write (the key's UserId). */
	readonly userIds: ReadonlyArray<number> | undefined;
	/** A save of this entry is writing. */
	saving: boolean;
	/** Threads waiting for that save to finish. */
	readonly saveWaiters: thread[];
}

/** Resumes a waiting thread (the server passes task.spawn). */
export type ResumeThread = (waiter: thread) => void;

function resumeWithCoroutine(waiter: thread): void {
	coroutine.resume(waiter);
}

export type SaveOutcome = "saved" | "clean" | "failed" | "unknown";

export class PlayerDocCache<T> {
	private readonly entries = new Map<string, Entry<T>>();
	/** Keys being loaded -> threads waiting for that load. */
	private readonly loading = new Map<string, thread[]>();

	/**
	 * `wait` sleeps between retries (task.wait on the server). `resume` wakes a thread that waited for another
	 * caller's load or save (task.spawn on the server; coroutine.resume by default, for headless tests).
	 */
	constructor(
		private readonly store: KeyValueStore,
		private readonly codec: DocCodec<T>,
		private readonly policy: RetryPolicy,
		private readonly wait: (seconds: number) => void,
		private readonly resume: ResumeThread = resumeWithCoroutine,
	) {}

	/**
	 * Loads `key` into the session cache (once; later calls return the cached document). A call while the same key
	 * is loading waits for that load instead of reading the store again. `userIds` (the key's owners) are passed to
	 * the store on every later write.
	 */
	load(key: string, userIds?: ReadonlyArray<number>): T {
		const hit = this.entries.get(key);
		if (hit) return hit.doc;
		const waiters = this.loading.get(key);
		if (waiters !== undefined) {
			waiters.push(coroutine.running());
			coroutine.yield(); // resumed when the first load stored its entry
			// Released in between (the player left): read again rather than return a stale document.
			return this.entries.get(key)?.doc ?? this.load(key, userIds);
		}
		this.loading.set(key, []);
		const result = withRetries(() => this.store.get(key), this.policy, this.wait);
		const entry: Entry<T> = {
			doc: result.ok ? this.codec.decode(result.value) : this.codec.empty(),
			dirty: false,
			loadFailed: !result.ok,
			userIds,
			saving: false,
			saveWaiters: [],
		};
		this.entries.set(key, entry);
		const woken = this.loading.get(key) ?? [];
		this.loading.delete(key);
		for (const waiter of woken) this.resume(waiter);
		return entry.doc;
	}

	/** True while `key` is being read from the store. */
	isLoading(key: string): boolean {
		return this.loading.has(key);
	}

	/** The cached document, or undefined when not loaded. */
	get(key: string): T | undefined {
		return this.entries.get(key)?.doc;
	}

	/** True when the last load of `key` failed (the session runs on defaults). */
	loadFailed(key: string): boolean {
		return this.entries.get(key)?.loadFailed ?? false;
	}

	/** Replaces the cached document (marks it dirty when it changed). Returns false when `key` is not loaded. */
	set(key: string, doc: T): boolean {
		const entry = this.entries.get(key);
		if (!entry) return false;
		if (!this.codec.equals(entry.doc, doc)) {
			entry.doc = doc;
			entry.dirty = true;
		}
		return true;
	}

	isDirty(key: string): boolean {
		return this.entries.get(key)?.dirty ?? false;
	}

	/**
	 * Writes `key` if it changed since the last save. While another save of `key` is writing, waits for it first
	 * (and then writes only if the document is still dirty, e.g. that save failed or the document changed again).
	 */
	save(key: string): SaveOutcome {
		const entry = this.entries.get(key);
		if (!entry) return "unknown";
		while (entry.saving) {
			entry.saveWaiters.push(coroutine.running());
			coroutine.yield(); // resumed when that save finishes
		}
		if (!entry.dirty) return "clean";
		const doc = entry.doc;
		entry.saving = true;
		const result = withRetries(
			() => this.store.set(key, this.codec.encode(doc), entry.userIds),
			this.policy,
			this.wait,
		);
		entry.saving = false;
		if (result.ok) {
			// Stay dirty if the document changed again while the write yielded.
			if (entry.doc === doc) entry.dirty = false;
			entry.loadFailed = false;
		}
		const woken = [...entry.saveWaiters];
		entry.saveWaiters.clear();
		for (const waiter of woken) this.resume(waiter);
		return result.ok ? "saved" : "failed";
	}

	/** True while a save of `key` is writing. */
	isSaving(key: string): boolean {
		return this.entries.get(key)?.saving ?? false;
	}

	/** Saves and forgets `key` (player left). */
	release(key: string): SaveOutcome {
		const outcome = this.save(key);
		this.entries.delete(key);
		return outcome;
	}

	/** Every loaded key. */
	keys(): string[] {
		const out: string[] = [];
		for (const [k] of this.entries) out.push(k);
		return out;
	}
}
