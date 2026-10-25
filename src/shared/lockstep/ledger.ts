/**
 * Desync detection (M4): every client reports hashState after each tick that is a multiple of `every`; the ledger
 * decides those ticks IN ORDER once every present player reported:
 *
 *   all equal      the tick is AGREED: its consensus hash is what the server's own replay must reproduce (session.ts
 *                  feeds the merged log to the SegmentedValidator with these as the claimed hashes)
 *   any differ     DESYNC at that tick (the reports by player are kept for the log). Policy: the run ends unranked.
 *   someone silent once the server is `timeout` ticks past the tick: those players are STALLED (the caller drops them
 *                  from the run, like a leaver) and the tick is decided among the rest
 *
 * A player who left never counts (reports from them are ignored). Pure.
 */
import { isStateHash } from "shared/run";

export interface HashDesync {
	readonly tick: number;
	/** Per player index: the reported hash, "" when that player was not counted. */
	readonly hashes: ReadonlyArray<string>;
	/** Players whose hash differs from the most common one (the likely divergent clients; all of them on a tie). */
	readonly outliers: ReadonlyArray<number>;
}

export interface LedgerDecision {
	/** Ticks agreed by this call, in order. */
	readonly agreed: ReadonlyArray<{ readonly tick: number; readonly hash: string }>;
	/** The first disagreement, if any (deciding stops there). */
	readonly desync?: HashDesync;
	/** Players to drop: silent past the timeout. */
	readonly stalled: ReadonlyArray<number>;
}

export type ReportProblem = "bad_tick" | "bad_hash" | "duplicate" | "already_decided";

export class HashLedger {
	private readonly reports = new Map<number, string[]>();
	private readonly agreedHashes = new Map<number, string>();
	private lastDecided = 0;
	private desynced: HashDesync | undefined;

	constructor(readonly size: number, readonly every: number, readonly timeout: number) {}

	/** Records player `i`'s hash after `tick` (a positive multiple of `every`). */
	report(i: number, tick: number, hash: string): ReportProblem | undefined {
		if (!(i >= 0 && i < this.size) || !typeIs(tick, "number") || tick <= 0 || tick % this.every !== 0) {
			return "bad_tick";
		}
		if (!isStateHash(hash)) return "bad_hash";
		if (tick <= this.lastDecided) return "already_decided";
		let row = this.reports.get(tick);
		if (row === undefined) {
			row = [];
			for (let k = 0; k < this.size; k++) row.push("");
			this.reports.set(tick, row);
		}
		if (row[i] !== "") return "duplicate";
		row[i] = hash;
		return undefined;
	}

	/** The consensus hash of an agreed tick (kept until forgetThrough). */
	consensus(tick: number): string | undefined {
		return this.agreedHashes.get(tick);
	}

	/** The last tick decided (0 before any). */
	decidedThrough(): number {
		return this.lastDecided;
	}

	/** The desync found, if any (the ledger decides nothing after it). */
	getDesync(): HashDesync | undefined {
		return this.desynced;
	}

	/**
	 * Decides every tick it can (see the file comment). `present(i)`: player i still counts. `serverTick`: ticks
	 * finalized so far (for the timeout: stall detection always runs on the real server clock). `through`: decide no
	 * tick past this one (a claimed final tick: nobody reports beyond it), default `serverTick`. Stops at the first
	 * desync, and at a tick with stalled players (the caller drops them, then calls again).
	 */
	decide(present: (i: number) => boolean, serverTick: number, through: number = serverTick): LedgerDecision {
		const agreed: Array<{ tick: number; hash: string }> = [];
		const stalled: number[] = [];
		if (this.desynced !== undefined) return { agreed, desync: this.desynced, stalled };
		const last = math.min(serverTick, through);
		for (;;) {
			const tick = this.lastDecided + this.every;
			if (tick > last) break;
			const row = this.reports.get(tick);
			const missing: number[] = [];
			let counted = 0;
			for (let i = 0; i < this.size; i++) {
				if (!present(i)) continue;
				if (row === undefined || row[i] === "") missing.push(i);
				else counted++;
			}
			if (missing.size() > 0) {
				if (serverTick >= tick + this.timeout) for (const i of missing) stalled.push(i);
				break;
			}
			if (counted === 0) break; // nobody left to report: the caller ends the run
			const hashes: string[] = [];
			for (let i = 0; i < this.size; i++) hashes.push(present(i) && row !== undefined ? row[i] : "");
			const outliers = outliersOf(hashes);
			if (outliers.size() > 0) {
				this.desynced = { tick, hashes, outliers };
				return { agreed, desync: this.desynced, stalled };
			}
			let hash = "";
			for (const h of hashes) if (h !== "") hash = h;
			this.agreedHashes.set(tick, hash);
			this.reports.delete(tick);
			this.lastDecided = tick;
			agreed.push({ tick, hash });
		}
		return { agreed, stalled };
	}

	/** Drops consensus hashes of ticks <= `tick` (already handed to the validator). */
	forgetThrough(tick: number): void {
		const old: number[] = [];
		for (const [t] of this.agreedHashes) if (t <= tick) old.push(t);
		for (const t of old) this.agreedHashes.delete(t);
	}
}

/** Players whose hash is not the most common one ("" = not counted); empty when all counted hashes agree. */
export function outliersOf(hashes: ReadonlyArray<string>): number[] {
	const counts = new Map<string, number>();
	for (const h of hashes) if (h !== "") counts.set(h, (counts.get(h) ?? 0) + 1);
	if (counts.size() <= 1) return [];
	let best = 0;
	let top = 0;
	for (const [, n] of counts) {
		if (n > best) {
			best = n;
			top = 1;
		} else if (n === best) {
			top++;
		}
	}
	const out: number[] = [];
	for (let i = 0; i < hashes.size(); i++) {
		const h = hashes[i];
		if (h === "") continue;
		if (top > 1 || counts.get(h)! < best) out.push(i);
	}
	return out;
}
