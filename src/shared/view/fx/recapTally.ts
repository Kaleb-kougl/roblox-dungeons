/**
 * The run-over recap's run-long tally (docs/RUN_RECAP.md RR1): parries and grazes per player over the whole run, for the
 * recap's highlights (shared/view/hud recap.ts: `Parries 14`, co-op `You` rows). The sim's ScoreEvents (shared/sim
 * score.ts) are per TICK and NOT hashed: one `guardPlayer` entry per enemy bullet a sword guard erased this tick, one
 * `grazePlayer` entry per graze awarded. The run views (shared/play LiveRun, shared/lockstep LockstepClient) `collect`
 * after every tick, as they do RoomClearEvents; unlike the per-frame collectors this one is NOT reset per frame: it
 * lives as long as its run view (a new run is a new view), and `reset()` starts it over by hand.
 *
 *   - Parries: one per GROUP, grouped exactly as the NearMissDirector groups them (nearMissRules.ts
 *     `parryStartsGroup`: a player's erases within SWORD_DATA.guardTicks of the group's first erase tick are one
 *     guard). Unlike the director it has no `quiet` gate: the tally counts what the sim did, the stage cover or run over
 *     never splits a guard. A guard erasing 5 bullets is 1 parry.
 *   - Grazes: one per graze, per grazing player (solo: counts[GRAZES] exactly).
 *   - Records of a player outside the party (index < 0 or >= partySize) are ignored, like the director's.
 *   - Unscored runs (`state.score === undefined`) collect nothing.
 *
 * Read-only on the sim. No allocation per tick: the per-player counters grow once per new player index. Presentation
 * only: nothing here is hashed or written back.
 */
import { partySize, type SimState } from "shared/sim";
import { parryStartsGroup } from "./nearMissRules";

/** What the recap reads (RecapTally satisfies it). Index = player index; a player never seen reads 0. */
export interface RecapTallySource {
	/** Parries (guard groups) per player. */
	readonly parries: ReadonlyArray<number>;
	/** Grazes per player. */
	readonly grazes: ReadonlyArray<number>;
}

export class RecapTally implements RecapTallySource {
	readonly parries: number[] = [];
	readonly grazes: number[] = [];

	/** Per player: a guard group seen, and its first erase tick (the parry grouping's state). */
	private readonly hasGroup: boolean[] = [];
	private readonly groupFirstTick: number[] = [];

	/** Starts over (a new run on the same view; a new view starts empty). */
	reset(): void {
		this.parries.clear();
		this.grazes.clear();
		this.hasGroup.clear();
		this.groupFirstTick.clear();
	}

	/** After every tick. No-op without scoring. */
	collect(state: Readonly<SimState>): void {
		const s = state.score;
		if (s === undefined) return;
		const e = s.events;
		const n = partySize(state);
		const tick = state.tick;
		const ng = e.grazePlayer.size();
		for (let i = 0; i < ng; i++) {
			const p = e.grazePlayer[i];
			if (p < 0 || p >= n) continue;
			this.grow(p);
			this.grazes[p] += 1;
		}
		const nc = e.guardPlayer.size();
		for (let i = 0; i < nc; i++) {
			const p = e.guardPlayer[i];
			if (p < 0 || p >= n) continue;
			this.grow(p);
			if (parryStartsGroup(this.hasGroup[p], this.groupFirstTick[p], tick)) {
				this.hasGroup[p] = true;
				this.groupFirstTick[p] = tick;
				this.parries[p] += 1;
			}
		}
	}

	/** Player `p`'s parries (0 when never seen). */
	parriesOf(p: number): number {
		return this.parries[p] ?? 0;
	}

	/** Player `p`'s grazes (0 when never seen). */
	grazesOf(p: number): number {
		return this.grazes[p] ?? 0;
	}

	private grow(p: number): void {
		while (this.parries.size() <= p) {
			this.parries.push(0);
			this.grazes.push(0);
			this.hasGroup.push(false);
			this.groupFirstTick.push(0);
		}
	}
}

/** No parries or grazes (a run view without scoring, the specs' default). Frozen. */
export const NO_RECAP_TALLY: RecapTallySource = table.freeze({
	parries: table.freeze([] as number[]),
	grazes: table.freeze([] as number[]),
});
