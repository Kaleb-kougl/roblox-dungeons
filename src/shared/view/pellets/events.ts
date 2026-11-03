/**
 * A frame's pellet events (docs/PELLETS.md PL7). The sim's PelletEvents (shared/sim pellets.ts) are per TICK and cleared
 * at the start of every tick, and a rendered frame may run several ticks, so the run views (shared/play LiveRun,
 * shared/lockstep LockstepClient) `collect` them after every tick into one PelletFrameEvents and `reset` it at the start
 * of every frame, as they do BoostFrameEvents. The pellet renderer (pop-in, shrink, the power fly-in), the score pops and
 * the audio cue mapper read it once per frame. Presentation only: plain numbers, read-only on the sim, tested headlessly.
 */
import type { PelletEaten, SimState } from "shared/sim";

/** A room record whose pellets went live or gone on `tick` (state.tick at the end of that tick). */
export interface PelletRoomEvent {
	readonly rec: number;
	readonly tick: number;
}

/** The power pellet's conversion on one tick: the picker, each erased bullet's position and the points paid. */
export interface PelletPowerTaken {
	readonly player: number;
	readonly x: ReadonlyArray<number>;
	readonly z: ReadonlyArray<number>;
	readonly points: number;
	readonly tick: number;
}

/** What the views read (PelletFrameEvents satisfies it). */
export interface PelletFrameSource {
	/** Pellets taken during the frame's ticks, in tick order. */
	readonly eaten: ReadonlyArray<PelletEaten>;
	/** Score records whose pellets went live / gone, and whose Sweep paid. */
	readonly live: ReadonlyArray<PelletRoomEvent>;
	readonly gone: ReadonlyArray<PelletRoomEvent>;
	readonly swept: ReadonlyArray<number>;
	/** The power pellet taken (at most one per floor, so rarely more than one entry). */
	readonly power: ReadonlyArray<PelletPowerTaken>;
}

/** The pellet events of every tick a frame ran, in tick order. */
export class PelletFrameEvents implements PelletFrameSource {
	readonly eaten: PelletEaten[] = [];
	readonly live: PelletRoomEvent[] = [];
	readonly gone: PelletRoomEvent[] = [];
	readonly swept: number[] = [];
	readonly power: PelletPowerTaken[] = [];

	/** A new frame: forget the last one's events. */
	reset(): void {
		this.eaten.clear();
		this.live.clear();
		this.gone.clear();
		this.swept.clear();
		this.power.clear();
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return this.eaten.size() + this.live.size() + this.gone.size() + this.swept.size() + this.power.size();
	}

	/** After every tick: appends that tick's events (no-op without pellets). Copies: the sim reuses its arrays. */
	collect(state: Readonly<SimState>): void {
		const p = state.pellets;
		if (p === undefined) return;
		const ev = p.events;
		const tick = state.tick;
		for (const e of ev.eaten)
			this.eaten.push({ index: e.index, x: e.x, z: e.z, player: e.player, points: e.points });
		for (const rec of ev.live) this.live.push({ rec, tick });
		for (const rec of ev.gone) this.gone.push({ rec, tick });
		for (const rec of ev.swept) this.swept.push(rec);
		const power = ev.power;
		if (power !== undefined) {
			this.power.push({ player: power.player, x: [...power.x], z: [...power.z], points: power.points, tick });
		}
	}
}

/** No events (a run view without pellets, the specs' default). */
export const NO_PELLET_EVENTS: PelletFrameSource = new PelletFrameEvents();
