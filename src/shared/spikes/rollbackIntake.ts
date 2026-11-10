/**
 * The rollback spike's summary intake, the pure core of the server's RollbackSpikeService (docs/ROLLBACK_SPIKE.md
 * Design 5 / 7, task R4): what the `rollbackProbe(kind, payload)` remote may cost the server. Per player, in order:
 *
 *   1. the gate: only players the capture policy allows (rollbackProbeAllowed, decided by the service);
 *   2. rate limits BEFORE anything is read or logged (ROLLBACK_PROBE_RATE: cpu / live per kind; `refused` caps the
 *      warnings a player's refused payloads may print, the rest dropped silently);
 *   3. the strict readers (readProbeSummary / readLiveSummary);
 *   4. session binding: a summary's client-made session id belongs to the first player who sent it on this server;
 *      another player's summary with it is refused (it never reaches a row: rows are keyed by the server's own writer
 *      id per player, so nobody can overwrite another tester's rows anyway);
 *   5. the row buffer: summaries wait per player and leave as ONE row (RollbackProbeRow) once the oldest is
 *      ROLLBACK_PROBE_ROWS.writeEverySeconds old (`dueRows`), at most maxPerRow of each kind (the rest counted as
 *      dropped), or at once when the player leaves / the server closes (`takeRow`, `dueRows(now, true)`);
 *   6. the analytics budget (ROLLBACK_ANALYTICS_RATE): a summary's events are logged whole or not at all.
 *
 * Generic over the player key so the specs drive it with numbers. Roblox-API-free; the clock is passed in.
 */
import type { AnalyticsEventSpec } from "shared/run";
import { SlidingWindowLimiter } from "shared/run";
import {
	ROLLBACK_ANALYTICS_RATE,
	ROLLBACK_PROBE_RATE,
	ROLLBACK_PROBE_ROWS,
	ROLLBACK_PROBE_ROW_VERSION,
	analyticsForLiveSummary,
	analyticsForProbeSummary,
	describeLiveSummary,
	describeProbeSummary,
	readLiveSummary,
	readProbeSummary,
	rollbackProbeRowKey,
	type LiveSummary,
	type ProbeSummary,
	type RollbackProbeKind,
	type RollbackProbeRow,
} from "./rollbackSpike";

/** Longest piece of a refused kind echoed in a warning. */
const MAX_ECHO_CHARS = 38;

/** What one remote call came to. */
export type RollbackIntakeOutcome =
	| {
			readonly taken: false;
			/** A warning to print (only while the player's `refused` budget lasts). */
			readonly warn?: string;
	  }
	| {
			readonly taken: true;
			readonly kind: RollbackProbeKind;
			/** The `[Rollback] CPU:` / `LIVE:` line's text. */
			readonly line: string;
			/** The AnalyticsService events to log (empty when over the analytics budget). */
			readonly analytics: AnalyticsEventSpec[];
	  };

/** A row ready to write: the store key, the row, the player it belongs to (its UserId tags the write). */
export interface RollbackDueRow<P> {
	readonly player: P;
	readonly userId: number;
	readonly key: string;
	readonly row: RollbackProbeRow;
}

/** What the intake needs from the server, per call. */
export interface RollbackIntakeContext {
	/** os.time() of a write (unix seconds). */
	readonly unixTime: number;
	readonly placeVersion: number;
}

interface RowBuffer {
	readonly writerId: string;
	readonly userId: number;
	nextIndex: number;
	cpu: ProbeSummary[];
	live: LiveSummary[];
	dropped: number;
	/** The clock when the oldest buffered summary arrived (undefined: empty). */
	since: number | undefined;
}

function limiter<P>(r: { readonly count: number; readonly windowSeconds: number }): SlidingWindowLimiter<P> {
	return new SlidingWindowLimiter<P>(r.count, r.windowSeconds);
}

/** The intake (see the file comment). One per server. */
export class RollbackProbeIntake<P> {
	private readonly rate = { cpu: limiter<P>(ROLLBACK_PROBE_RATE.cpu), live: limiter<P>(ROLLBACK_PROBE_RATE.live) };
	private readonly refused = limiter<P>(ROLLBACK_PROBE_RATE.refused);
	private readonly analytics = {
		cpu: limiter<P>(ROLLBACK_ANALYTICS_RATE.cpu),
		live: limiter<P>(ROLLBACK_ANALYTICS_RATE.live),
	};
	/** Session id -> the UserId that first sent it on this server (kept after they leave). */
	private readonly owners = new Map<string, number>();
	private readonly buffers = new Map<P, RowBuffer>();

	/** `newWriterId()` makes a player's writer id on first use (the server: HttpService:GenerateGUID(false)). */
	constructor(private readonly newWriterId: () => string) {}

	/** One remote call: `allowed` is the gate's answer for the player (rollbackProbeAllowed). */
	take(
		player: P,
		userId: number,
		allowed: boolean,
		rawKind: unknown,
		payload: unknown,
		now: number,
	): RollbackIntakeOutcome {
		if (!allowed) return this.refuse(player, now, `${userId}: not allowed (capture policy), dropped`);
		const kind: RollbackProbeKind | undefined = rawKind === "cpu" ? "cpu" : rawKind === "live" ? "live" : undefined;
		if (kind === undefined) {
			const shown = typeIs(rawKind, "string") ? rawKind.sub(1, MAX_ECHO_CHARS) : typeOf(rawKind);
			return this.refuse(player, now, `${userId}: unknown kind ${shown}`);
		}
		if (!this.rate[kind].tryAcquire(player, now)) return { taken: false };
		const buf = this.bufferOf(player, userId);
		if (kind === "cpu") {
			const s = readProbeSummary(payload);
			if (s === undefined) return this.refuse(player, now, `${userId}: a malformed cpu summary was dropped`);
			if (!this.bind(s.sessionId, userId))
				return this.refuse(player, now, this.takenWarning(userId, s.sessionId));
			this.buffer(buf, now, buf.cpu, s, ROLLBACK_PROBE_ROWS.maxPerRow.cpu);
			const specs = this.analytics.cpu.tryAcquire(player, now) ? analyticsForProbeSummary(s) : [];
			return { taken: true, kind, line: `${userId} ${describeProbeSummary(s)}`, analytics: specs };
		}
		const s = readLiveSummary(payload);
		if (s === undefined) return this.refuse(player, now, `${userId}: a malformed live summary was dropped`);
		if (!this.bind(s.sessionId, userId)) return this.refuse(player, now, this.takenWarning(userId, s.sessionId));
		this.buffer(buf, now, buf.live, s, ROLLBACK_PROBE_ROWS.maxPerRow.live);
		const specs = this.analytics.live.tryAcquire(player, now) ? analyticsForLiveSummary(s) : [];
		return { taken: true, kind, line: `${userId} ${describeLiveSummary(s)}`, analytics: specs };
	}

	/** Rows whose oldest summary is writeEverySeconds old (every non-empty one with `all`), their buffers emptied. */
	dueRows(now: number, ctx: Readonly<RollbackIntakeContext>, all = false): RollbackDueRow<P>[] {
		const out: RollbackDueRow<P>[] = [];
		for (const [player, buf] of this.buffers) {
			const since = buf.since;
			if (since === undefined) continue;
			if (!all && now - since < ROLLBACK_PROBE_ROWS.writeEverySeconds) continue;
			out.push(this.rowOf(player, buf, ctx));
		}
		return out;
	}

	/** The player left: their buffered row (if any) and their limiters forgotten. Their session ids stay bound. */
	takeRow(player: P, ctx: Readonly<RollbackIntakeContext>): RollbackDueRow<P> | undefined {
		const buf = this.buffers.get(player);
		this.rate.cpu.forget(player);
		this.rate.live.forget(player);
		this.refused.forget(player);
		this.analytics.cpu.forget(player);
		this.analytics.live.forget(player);
		if (buf === undefined || buf.since === undefined) return undefined;
		return this.rowOf(player, buf, ctx);
	}

	/** Summaries waiting in every buffer (specs, the close log). */
	buffered(): number {
		let n = 0;
		for (const [, b] of this.buffers) n += b.cpu.size() + b.live.size();
		return n;
	}

	private refuse(player: P, now: number, warning: string): RollbackIntakeOutcome {
		return this.refused.tryAcquire(player, now) ? { taken: false, warn: warning } : { taken: false };
	}

	private takenWarning(userId: number, sessionId: string): string {
		return `${userId}: session ${sessionId.sub(1, MAX_ECHO_CHARS)} belongs to another player, dropped`;
	}

	private bind(sessionId: string, userId: number): boolean {
		const owner = this.owners.get(sessionId);
		if (owner === undefined) {
			this.owners.set(sessionId, userId);
			return true;
		}
		return owner === userId;
	}

	private bufferOf(player: P, userId: number): RowBuffer {
		let buf = this.buffers.get(player);
		if (buf === undefined) {
			buf = {
				writerId: this.newWriterId(),
				userId,
				nextIndex: 0,
				cpu: [],
				live: [],
				dropped: 0,
				since: undefined,
			};
			this.buffers.set(player, buf);
		}
		return buf;
	}

	private buffer<T extends defined>(buf: RowBuffer, now: number, list: T[], summary: T, max: number): void {
		if (list.size() >= max) {
			buf.dropped++;
		} else {
			list.push(summary);
		}
		if (buf.since === undefined) buf.since = now;
	}

	private rowOf(player: P, buf: RowBuffer, ctx: Readonly<RollbackIntakeContext>): RollbackDueRow<P> {
		const row: RollbackProbeRow = {
			v: ROLLBACK_PROBE_ROW_VERSION,
			at: ctx.unixTime,
			placeVersion: ctx.placeVersion,
			cpu: buf.cpu,
			live: buf.live,
			dropped: buf.dropped,
		};
		const key = rollbackProbeRowKey(buf.writerId, buf.nextIndex);
		buf.nextIndex++;
		buf.cpu = [];
		buf.live = [];
		buf.dropped = 0;
		buf.since = undefined;
		return { player, userId: buf.userId, key, row };
	}
}
