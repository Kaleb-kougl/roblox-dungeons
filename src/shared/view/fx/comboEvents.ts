/**
 * A frame's combo events (docs/COMBO.md CB1). The sim's ScoreEvents (shared/sim score.ts) are per TICK, cleared at the
 * start of every tick (frozen boon-draft ticks included) and NOT hashed: `comboStart` is the combo when the tick began,
 * `comboFed` 1 once a kill or graze fed it, `kills` / `grazes` the feeds (stepCombat, before stepScore), `comboCut` the
 * landed hits that cut it (stepScore, after the feeds), `comboBroken` 1 when the timer ran out and reset a combo above
 * x1.0 (stepScore, only on a tick without a feed). A rendered frame may run several ticks, so the run views (shared/play
 * LiveRun, shared/lockstep LockstepClient) `reset` this at the start of every frame and `collect` after every tick, as
 * they do BoostFrameEvents and RoomClearEvents. The combo display (docs/COMBO.md CB2 / CB7) and the audio cue mapper
 * (CB4) read it once per frame.
 *
 *   - startCombo: the first collected tick's `comboStart` (with no tick this frame: the last combo seen, so start, end
 *     and peak are equal and nothing moved). endCombo: `score.combo` after the frame's last tick. peak: the highest
 *     combo at the end of any of the frame's ticks (never below startCombo).
 *   - cuts: one per tick with `comboCut > 0` (several hits on one tick make one cut): before = that tick's comboStart,
 *     after = the combo at its end (a kill earlier in the same tick is inside the cut).
 *   - ended: the timer reset a combo above x1.0 (comboBroken). `lost` = that tick's comboStart, `peak` = the highest
 *     combo since the previous streak end (or since this collector was created), which spans frames, so it is tracked
 *     here and never reset per frame; `fight` = fightOn(state) at the reset tick (break vs lapse, CD3). The streak
 *     peak includes a value only reached inside a tick (fed, then cut on the same tick: comboStart + its feeds, capped).
 *     A streak that ends silently (cut down to x1.0, then the timer runs out: no comboBroken) forgets its peak too.
 *   - An open boon draft freezes the world: stepScore does not run, the timer does not count down, so a frozen tick
 *     collects as a tick where nothing happened and never ends a streak.
 *   - Unscored runs (`state.score === undefined`) collect nothing: no tick, start / end / peak stay COMBO_MIN.
 *
 * Read-only on the sim. No allocation per tick: cuts reuse a pool of records (a hit is rare, but a frame of them
 * should not churn); one ComboReset per streak end (a few per floor). Presentation only: nothing here is hashed or
 * written back.
 */
import { COMBO_MAX, COMBO_MIN, COMBO_STEP, type SimState } from "shared/sim";
import { fightOn } from "../roomEdgeState";

/** One tick's hit cut, tenths. */
export interface ComboCut {
	readonly before: number;
	readonly after: number;
}

/** The streak ended: the combo timer reset a combo above x1.0 (ScoreEvents.comboBroken). */
export interface ComboReset {
	/** Tenths the combo had at the start of the reset tick (> COMBO_MIN). */
	readonly lost: number;
	/** Highest combo of the streak that ended (tenths, >= lost). */
	readonly peak: number;
	/** fightOn(state) at the reset tick: a break (a fight is on) or a lapse (none). */
	readonly fight: boolean;
}

/** What the views read once per frame (ComboEvents satisfies it). */
export interface ComboFrameSource {
	/** Ticks collected this frame. */
	readonly ticks: number;
	/** Combo before the frame's first tick (tenths; COMBO_MIN when unscored). */
	readonly startCombo: number;
	/** Combo after the frame's last tick. */
	readonly endCombo: number;
	/** Highest combo at the end of any of the frame's ticks (>= startCombo, endCombo). */
	readonly peak: number;
	/** ScoreEvents.kills summed over the frame. */
	readonly kills: number;
	/** ScoreEvents.grazes summed over the frame. */
	readonly grazes: number;
	/** Ticks with comboCut > 0, in order (before = comboStart, after = combo at tick end). */
	readonly cuts: ReadonlyArray<ComboCut>;
	/** The frame's last streak end (at most one per window in practice). */
	readonly ended: ComboReset | undefined;
}

/** A pooled cut record (only ever handed out as a read-only ComboCut). */
interface CutRecord {
	before: number;
	after: number;
}

/** The combo events of every tick a frame ran. */
export class ComboEvents implements ComboFrameSource {
	ticks = 0;
	startCombo = COMBO_MIN;
	endCombo = COMBO_MIN;
	peak = COMBO_MIN;
	kills = 0;
	grazes = 0;
	readonly cuts: ComboCut[] = [];
	ended: ComboReset | undefined = undefined;

	/** The combo after the last collected tick (COMBO_MIN before any). */
	private lastCombo = COMBO_MIN;
	/** Highest combo since the last streak end (or creation); spans frames. */
	private streakPeak = COMBO_MIN;
	/** Cut records, reused frame to frame (`cuts` holds the first cuts.size() of them). */
	private readonly cutPool: CutRecord[] = [];

	/** A new frame: forget the last one's events (the streak peak carries on). */
	reset(): void {
		this.ticks = 0;
		this.startCombo = this.lastCombo;
		this.endCombo = this.lastCombo;
		this.peak = this.lastCombo;
		this.kills = 0;
		this.grazes = 0;
		this.cuts.clear();
		this.ended = undefined;
	}

	/** After every tick. No-op without scoring. */
	collect(state: Readonly<SimState>): void {
		const s = state.score;
		if (s === undefined) return;
		const e = s.events;
		const combo = s.combo;
		if (this.ticks === 0) {
			this.startCombo = e.comboStart;
			this.peak = e.comboStart;
		}
		this.ticks += 1;
		this.endCombo = combo;
		if (combo > this.peak) this.peak = combo;
		this.kills += e.kills;
		this.grazes += e.grazes;
		if (e.comboCut > 0) this.pushCut(e.comboStart, combo);

		// The streak's high: the feeds come before the cuts and the timer inside a tick (stepCombat, then stepScore).
		const fed = e.comboStart + COMBO_STEP * (e.kills + e.grazes);
		const reached = fed > COMBO_MAX ? COMBO_MAX : fed;
		if (reached > this.streakPeak) this.streakPeak = reached;
		if (combo > this.streakPeak) this.streakPeak = combo;
		if (e.comboBroken !== 0) {
			const lost = e.comboStart;
			this.ended = { lost, peak: this.streakPeak > lost ? this.streakPeak : lost, fight: fightOn(state) };
		}
		// Timer idle: the streak is over (broken, or a silent run-out at x1.0); the next one starts from scratch.
		if (s.comboTimer === 0) this.streakPeak = combo;
		this.lastCombo = combo;
	}

	private pushCut(before: number, after: number): void {
		const i = this.cuts.size();
		let rec = this.cutPool[i];
		if (rec === undefined) {
			rec = { before, after };
			this.cutPool.push(rec);
		} else {
			rec.before = before;
			rec.after = after;
		}
		this.cuts.push(rec);
	}
}

/** No combo events (a run view without sim ticks or scoring, the specs' default). Frozen. */
export const NO_COMBO_EVENTS: ComboFrameSource = table.freeze({
	ticks: 0,
	startCombo: COMBO_MIN,
	endCombo: COMBO_MIN,
	peak: COMBO_MIN,
	kills: 0,
	grazes: 0,
	cuts: table.freeze([] as ComboCut[]),
	ended: undefined,
});
