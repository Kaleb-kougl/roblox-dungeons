/**
 * A frame's grazes and guard erases (docs/GRAZE_PARRY.md GP2). The sim's ScoreEvents (shared/sim score.ts) are per
 * TICK, cleared at the start of every tick and NOT hashed: GP1 pushes one entry per graze awarded this tick
 * (`grazeX` / `grazeZ` / `grazeVX` / `grazeVZ` / `grazePlayer`: the bullet's position and velocity at the award, the
 * grazing player) and one per enemy bullet a sword guard erased (`guardX` / `guardZ` / `guardPlayer`). A rendered frame
 * may run several ticks, so the run views (shared/play LiveRun, shared/lockstep LockstepClient) `reset` this at the
 * start of every frame and `collect` after every tick, as they do ComboEvents and RoomClearEvents. NearMissDirector
 * (nearMissRules.ts) reads it once per frame.
 *
 *   - Every record carries `tick`: state.tick at the end of the tick that produced it (the parry grouping counts guard
 *     windows in ticks).
 *   - Unscored runs (`state.score === undefined`: unscored M1) collect nothing (GPD2): no tick, no records.
 *
 * Read-only on the sim. No allocation in steady state: records come from pools that only grow when a frame holds more
 * than any frame before it. Presentation only: nothing here is hashed or written back.
 *
 * @module
 */
import type { SimState } from "shared/sim";

/** One graze: where the bullet was when it left the graze ring, its velocity then, and who grazed it. */
export interface GrazeRecord {
	readonly x: number;
	readonly z: number;
	/** Bullet velocity at the award (sim units per second; only its direction matters to the view). */
	readonly vx: number;
	readonly vz: number;
	/** The grazing player's index (solo 0; co-op the nearest living player). */
	readonly player: number;
	/** state.tick at the end of the graze's tick. */
	readonly tick: number;
}

/** One enemy bullet a sword guard erased: its position when erased, the guarding player. */
export interface GuardEraseRecord {
	readonly x: number;
	readonly z: number;
	readonly player: number;
	/** state.tick at the end of the erase's tick. */
	readonly tick: number;
}

/** What the views read once per frame (NearMissEvents satisfies it). */
export interface NearMissFrameSource {
	/** Scored ticks collected this frame. */
	readonly ticks: number;
	/** The frame's grazes, in tick order then the sim's award order. */
	readonly grazes: ReadonlyArray<GrazeRecord>;
	/** The frame's guard erases, in tick order then the sim's erase order. */
	readonly erases: ReadonlyArray<GuardEraseRecord>;
}

interface GrazeSlot {
	x: number;
	z: number;
	vx: number;
	vz: number;
	player: number;
	tick: number;
}

interface EraseSlot {
	x: number;
	z: number;
	player: number;
	tick: number;
}

/** The grazes and guard erases of every tick a frame ran. */
export class NearMissEvents implements NearMissFrameSource {
	ticks = 0;
	readonly grazes: GrazeRecord[] = [];
	readonly erases: GuardEraseRecord[] = [];

	/** Records reused frame to frame (`grazes` / `erases` hold the first size() of them). */
	private readonly grazePool: GrazeSlot[] = [];
	private readonly erasePool: EraseSlot[] = [];

	/** A new frame: forget the last one's records. */
	reset(): void {
		this.ticks = 0;
		this.grazes.clear();
		this.erases.clear();
	}

	/** After every tick. No-op without scoring. */
	collect(state: Readonly<SimState>): void {
		const s = state.score;
		if (s === undefined) return;
		const e = s.events;
		const tick = state.tick;
		this.ticks += 1;
		const ng = e.grazeX.size();
		for (let i = 0; i < ng; i++) {
			const n = this.grazes.size();
			let r = this.grazePool[n];
			if (r === undefined) {
				r = { x: 0, z: 0, vx: 0, vz: 0, player: 0, tick: 0 };
				this.grazePool.push(r);
			}
			r.x = e.grazeX[i];
			r.z = e.grazeZ[i];
			r.vx = e.grazeVX[i];
			r.vz = e.grazeVZ[i];
			r.player = e.grazePlayer[i];
			r.tick = tick;
			this.grazes.push(r);
		}
		const nc = e.guardX.size();
		for (let i = 0; i < nc; i++) {
			const n = this.erases.size();
			let r = this.erasePool[n];
			if (r === undefined) {
				r = { x: 0, z: 0, player: 0, tick: 0 };
				this.erasePool.push(r);
			}
			r.x = e.guardX[i];
			r.z = e.guardZ[i];
			r.player = e.guardPlayer[i];
			r.tick = tick;
			this.erases.push(r);
		}
	}
}

/** No grazes or erases (a run view without sim ticks or scoring, the specs' default). Frozen. */
export const NO_NEAR_MISS_EVENTS: NearMissFrameSource = table.freeze({
	ticks: 0,
	grazes: table.freeze([] as GrazeRecord[]),
	erases: table.freeze([] as GuardEraseRecord[]),
});
