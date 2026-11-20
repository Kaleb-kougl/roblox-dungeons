/**
 * The live Silver counter (docs/SILVER.md SV8, "Earning": "In the run"). Pure: SilverHudController steps it once per
 * rendered frame with the run's own reads (shared/silver silverRunInputOf on the view's state and config, the view's
 * kill count), so the counter shows what shared/silver runSilver would pay for the run so far: room clears tick +2
 * (OC20: on the counter, never in the room-clear tally), a far co-op clear too (the shared score record clears once for
 * the whole team), crates, floors, bosses, a vault chest, a secret room, a caught Goldling, every tenth kill. The
 * run minimum's top-up and the bonuses are the grant's (the run-over rows), never shown here.
 *
 *   SilverTracker     `update(input)` -> the run's Silver so far (`total`, runSilver's row sum) and what grew since
 *                     the last update (`gains`, row by row; the first update after a reset is the baseline: none)
 *   SilverCounterChip the counter's small `+N`: gains within mergeSec of the last add into one number; it shows for
 *                     showSec, fading over its last fadeSec
 *   silverCounterShown which runs show the counter: a paying world (shared/silver silverEligibility on the client's own
 *                     facts: unranked, debug, dev, stress) with the Silver feed; never the tutorial or a dev run
 *
 * @module
 */
import {
	SILVER_PAYING_WORLDS,
	SILVER_ROWS,
	runSilver,
	silverEligibility,
	type SilverRowId,
	type SilverRunInput,
} from "shared/silver";
import { SILVER_COUNTER } from "./config";

/** One row that grew this update. */
export interface SilverGain {
	readonly row: SilverRowId;
	readonly silver: number;
}

/** What SilverTracker.update returns (reused: valid until the next update). */
export interface SilverTrackerFrame {
	/** The run's Silver so far (runSilver's row sum: no top-up, no bonuses). */
	readonly total: number;
	/** The rows that grew since the last update, in SILVER_ROWS order (none on the first update after a reset). */
	readonly gains: ReadonlyArray<SilverGain>;
	/** The gains' sum. */
	readonly gained: number;
}

/** The live counter's reads, one per client (see the file comment). */
export class SilverTracker {
	private readonly last = new Map<SilverRowId, number>();
	private primed = false;
	private readonly gains: SilverGain[] = [];
	private readonly out: { total: number; gains: SilverGain[]; gained: number } = {
		total: 0,
		gains: this.gains,
		gained: 0,
	};

	/** A new run: the next update is the baseline. */
	reset(): void {
		this.last.clear();
		this.primed = false;
		this.gains.clear();
		this.out.total = 0;
		this.out.gained = 0;
	}

	update(input: Readonly<SilverRunInput>): SilverTrackerFrame {
		const run = runSilver(input);
		this.gains.clear();
		let gained = 0;
		for (const r of run.rows) {
			const before = this.last.get(r.row) ?? 0;
			if (this.primed && r.silver > before) {
				this.gains.push({ row: r.row, silver: r.silver - before });
				gained += r.silver - before;
			}
			this.last.set(r.row, r.silver);
		}
		this.primed = true;
		this.out.total = run.sum;
		this.out.gained = gained;
		return this.out;
	}
}

/** The chip's look at a time. */
export interface SilverChipLook {
	/** The merged `+N` (0: nothing to show). */
	readonly amount: number;
	/** Its text transparency (1: hidden). */
	readonly transparency: number;
}

/** The counter's small `+N` (see the file comment). Real time, seconds, any clock that only grows. */
export class SilverCounterChip {
	private amount = 0;
	private lastAdd: number | undefined;

	reset(): void {
		this.amount = 0;
		this.lastAdd = undefined;
	}

	/** Adds `silver` at `nowSec`: into the chip showing when within mergeSec of the last add, else a new one. */
	add(silver: number, nowSec: number): void {
		if (!(silver > 0)) return;
		const c = SILVER_COUNTER;
		const last = this.lastAdd;
		if (last === undefined || !(nowSec - last <= c.mergeSec) || this.look(nowSec).amount === 0) this.amount = 0;
		this.amount += silver;
		this.lastAdd = nowSec;
	}

	look(nowSec: number): SilverChipLook {
		const c = SILVER_COUNTER;
		const last = this.lastAdd;
		if (last === undefined || this.amount <= 0) return { amount: 0, transparency: 1 };
		const age = nowSec - last;
		if (!(age >= 0) || !(age < c.showSec)) return { amount: 0, transparency: 1 };
		const fadeFrom = c.showSec - c.fadeSec;
		const transparency = age <= fadeFrom ? 0 : math.min(1, (age - fadeFrom) / c.fadeSec);
		return { amount: this.amount, transparency };
	}
}

/** The client's facts about a run (SimController's RunContext). */
export interface SilverRunFacts {
	readonly world: string;
	readonly tutorial: boolean;
	readonly dev: boolean;
	readonly stress: number;
	/** The run was started with KV_Debug on (SimController.isDebugRun). */
	readonly debug: boolean;
	/** No server session (the unranked fallback). */
	readonly unranked: boolean;
	/** The run's state carries the Silver feed (SimConfig.silver: state.silver). */
	readonly hasSilver: boolean;
}

/**
 * Whether a run pays Silver as far as the client can tell (shared/silver silverEligibility on its own facts; Studio is
 * the server's call, so it is not asked here).
 */
export function silverRunPays(f: Readonly<SilverRunFacts>): boolean {
	if (f.tutorial || f.dev) return false;
	const why = silverEligibility(
		f.world,
		{ debug: f.debug, studio: false, dev: f.dev, stress: f.stress, unranked: f.unranked },
		SILVER_PAYING_WORLDS,
	);
	return why === undefined;
}

/** The in-run counter shows: a run that pays (silverRunPays) with the Silver feed. */
export function silverCounterShown(f: Readonly<SilverRunFacts>): boolean {
	return f.hasSilver && silverRunPays(f);
}

/** Every row the counter counts (SILVER_ROWS), for specs and the debug print. */
export const SILVER_COUNTER_ROWS: ReadonlyArray<SilverRowId> = SILVER_ROWS;
