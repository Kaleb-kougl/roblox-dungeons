/**
 * The client's Codex outbox (claude/codex-plan.md CX6): what CodexController sends to the server, batched and paced so
 * no call is lost to the server's rate limit (CODEX.claimRate, over-limit calls dropped silently) or refused for size
 * (CODEX.claimMaxItems / viewedMaxIds: a longer call is refused whole). Pure; the controller feeds it the tracker's
 * rises, the screen's viewed ids and every `codexStatus`, and fires what `flush` hands out.
 *
 *   before the first status     claims and views queue (the server ignores them before its join load and seed end)
 *   `loaded: true`              ready: everything queued goes out from the next flush on
 *   `loaded: false` first       unavailable: the queue is dropped and nothing queues until a loaded status (none is
 *                               expected this session; CodexTracker treats a late doc the same way)
 *   `loaded: false` once ready  ignored (the server never unloads a loaded doc)
 *
 * Claims for one entry collapse to the highest tier (its floor with it); views collapse per id. A flush sends at most
 * every CODEX_OUTBOX.flushSeconds unless hurried (run over, the screen closing), and each remote at most
 * CODEX_OUTBOX.callsPerWindow calls per windowSeconds; what does not fit waits for a later flush (still hurried).
 */
import { CODEX, CODEX_OUTBOX, type CodexOutboxTunables } from "./config";
import type { CodexClaim } from "./doc";

/** One remote call to make: `codexClaim(items)` or `codexViewed(ids)`. */
export type CodexSend =
	| { readonly kind: "claim"; readonly items: CodexClaim[] }
	| { readonly kind: "viewed"; readonly ids: string[] };

type OutboxState = "pending" | "ready" | "unavailable";

/** A sliding window of call times (os.clock seconds) for one remote. */
class CallWindow {
	private readonly times: number[] = [];

	constructor(private readonly tunables: CodexOutboxTunables) {}

	/** Calls still allowed at `now`. */
	room(now: number): number {
		const t = this.times;
		while (t.size() > 0 && t[0] <= now - this.tunables.windowSeconds) t.remove(0);
		return math.max(0, this.tunables.callsPerWindow - t.size());
	}

	add(now: number): void {
		this.times.push(now);
	}
}

export class CodexOutbox {
	private state: OutboxState = "pending";
	private readonly claimIds: string[] = [];
	private readonly claims = new Map<string, CodexClaim>();
	private readonly viewIds: string[] = [];
	private readonly views = new Set<string>();
	private lastFlush = -math.huge;
	private hurried = false;
	private readonly claimWindow: CallWindow;
	private readonly viewWindow: CallWindow;

	constructor(
		private readonly tunables: CodexOutboxTunables = CODEX_OUTBOX,
		private readonly claimMax: number = CODEX.claimMaxItems,
		private readonly viewMax: number = CODEX.viewedMaxIds,
	) {
		this.claimWindow = new CallWindow(tunables);
		this.viewWindow = new CallWindow(tunables);
	}

	/** A `codexStatus` arrived (`loaded` its flag). See the file comment. */
	receive(loaded: boolean): void {
		if (loaded) this.state = "ready";
		else if (this.state === "pending") {
			this.state = "unavailable";
			this.drop();
		}
	}

	/** Statuses so far allow sending (a loaded status arrived). */
	isReady(): boolean {
		return this.state === "ready";
	}

	/** A `loaded: false` status came first (and no loaded one since): nothing queues or sends. */
	isUnavailable(): boolean {
		return this.state === "unavailable";
	}

	/** Queues claims (a lower or equal tier than one already queued for the entry changes nothing). */
	claim(items: ReadonlyArray<CodexClaim>): void {
		if (this.state === "unavailable") return;
		for (const c of items) {
			const cur = this.claims.get(c.id);
			if (cur === undefined) this.claimIds.push(c.id);
			else if (cur.tier >= c.tier) continue;
			this.claims.set(c.id, { id: c.id, tier: c.tier, floor: c.floor });
		}
	}

	/** Queues viewed ids (each once). */
	view(ids: ReadonlyArray<string>): void {
		if (this.state === "unavailable") return;
		for (const id of ids) {
			if (this.views.has(id)) continue;
			this.views.add(id);
			this.viewIds.push(id);
		}
	}

	/** Sends the queue at the next flush, without waiting for flushSeconds (run over, the screen closing). */
	hurry(): void {
		if (this.pendingCount() > 0) this.hurried = true;
	}

	/** Queued claims and views not sent yet. */
	pendingCount(): number {
		return this.claimIds.size() + this.viewIds.size();
	}

	/** The queued claims (oldest first; copies): what a late loaded doc should show locally. */
	pendingClaims(): CodexClaim[] {
		const out: CodexClaim[] = [];
		for (const id of this.claimIds) out.push(this.claims.get(id) as CodexClaim);
		return out;
	}

	/**
	 * The calls to make at `now` (os.clock seconds), oldest queued first; empty when not ready, nothing is queued, the
	 * last flush was under flushSeconds ago (unless hurried) or both windows are full. What does not fit stays queued.
	 */
	flush(now: number): CodexSend[] {
		const out: CodexSend[] = [];
		if (this.state !== "ready" || this.pendingCount() === 0) {
			this.hurried = false;
			return out;
		}
		if (!this.hurried && now < this.lastFlush + this.tunables.flushSeconds) return out;
		let claimRoom = this.claimWindow.room(now);
		while (this.claimIds.size() > 0 && claimRoom > 0) {
			const items: CodexClaim[] = [];
			while (this.claimIds.size() > 0 && items.size() < this.claimMax) {
				const id = this.claimIds.remove(0) as string;
				items.push(this.claims.get(id) as CodexClaim);
				this.claims.delete(id);
			}
			out.push({ kind: "claim", items });
			this.claimWindow.add(now);
			claimRoom--;
		}
		let viewRoom = this.viewWindow.room(now);
		while (this.viewIds.size() > 0 && viewRoom > 0) {
			const ids: string[] = [];
			while (this.viewIds.size() > 0 && ids.size() < this.viewMax) {
				const id = this.viewIds.remove(0) as string;
				ids.push(id);
				this.views.delete(id);
			}
			out.push({ kind: "viewed", ids });
			this.viewWindow.add(now);
			viewRoom--;
		}
		if (out.size() > 0) this.lastFlush = now;
		if (this.pendingCount() === 0) this.hurried = false;
		return out;
	}

	private drop(): void {
		this.claimIds.clear();
		this.claims.clear();
		this.viewIds.clear();
		this.views.clear();
		this.hurried = false;
	}
}
