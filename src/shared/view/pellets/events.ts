/**
 * A frame's pellet events (docs/PELLETS.md PL7). The sim's PelletEvents (shared/sim pellets.ts) are per TICK and cleared
 * at the start of every tick, and a rendered frame may run several ticks, so the run views (shared/play LiveRun,
 * shared/lockstep LockstepClient) `collect` them after every tick into one PelletFrameEvents and `reset` it at the start
 * of every frame, as they do BoostFrameEvents. The pellet renderer (pop-in, shrink, the power fly-in), the score pops and
 * the audio cue mapper read it once per frame. Presentation only: plain numbers, read-only on the sim, tested headlessly.
 *
 * The power pellet (docs/PELLETS.md PL4) is not an `eaten` pellet: the sim pushes no eaten event for it and pays it no
 * pellet points, only `events.power` (the picker, each erased bullet's position, the bullets' points) and taken = 1. Its
 * erases are counted in SimEvents.bulletsDeleted like a guard's, so every view that reads bulletsDeleted as "a player
 * deflected bullets" (the deflect sound, the guard shield's re-flash, the guard fan's flash) takes them out through
 * deflectedBullets / tickDeflectedBullets. A leaf (types only from shared/sim): shared/view/fx imports it by file.
 */
import type { PelletEaten, SimState } from "shared/sim";

/** A room record whose pellets went live or gone on `tick` (state.tick at the end of that tick). */
export interface PelletRoomEvent {
	readonly rec: number;
	readonly tick: number;
}

/**
 * The power pellet's conversion on one tick: the picker, the power pellet's own spot (`px` / `pz`, read from the state on
 * that tick), each erased bullet's position and the points paid.
 */
export interface PelletPowerTaken {
	readonly player: number;
	readonly px: number;
	readonly pz: number;
	readonly x: ReadonlyArray<number>;
	readonly z: ReadonlyArray<number>;
	readonly points: number;
	readonly tick: number;
}

/** A pellet a Snatcher ate on `tick` (docs/NEW_ENEMIES_2.md NX7: the gulp at its cell). */
export interface PelletStolenAt {
	readonly index: number;
	readonly x: number;
	readonly z: number;
	readonly tick: number;
}

/** A stolen pellet put back on `tick` at a Snatcher's death: it flies from (fromX, fromZ), the corpse, to its cell. */
export interface PelletReturnedAt {
	readonly index: number;
	readonly fromX: number;
	readonly fromZ: number;
	readonly tick: number;
}

/** A Snatcher's swallow on `tick`: where it stood and each digested pellet's index and cell (the fizzles). */
export interface PelletSwallowedAt {
	readonly x: number;
	readonly z: number;
	readonly indices: ReadonlyArray<number>;
	readonly cellX: ReadonlyArray<number>;
	readonly cellZ: ReadonlyArray<number>;
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
	/**
	 * Snatchers (docs/NEW_ENEMIES_2.md NX4 / NX7): pellets eaten, put back at a death, and swallows. Pellets a Snatcher
	 * killed last credits to its killer (NXD18) are `eaten` like any pickup (the ordinary chomp and pop).
	 */
	readonly stolen: ReadonlyArray<PelletStolenAt>;
	readonly returned: ReadonlyArray<PelletReturnedAt>;
	readonly swallowed: ReadonlyArray<PelletSwallowedAt>;
}

/** The pellet events of every tick a frame ran, in tick order. */
export class PelletFrameEvents implements PelletFrameSource {
	readonly eaten: PelletEaten[] = [];
	readonly live: PelletRoomEvent[] = [];
	readonly gone: PelletRoomEvent[] = [];
	readonly swept: number[] = [];
	readonly power: PelletPowerTaken[] = [];
	readonly stolen: PelletStolenAt[] = [];
	readonly returned: PelletReturnedAt[] = [];
	readonly swallowed: PelletSwallowedAt[] = [];

	/** A new frame: forget the last one's events. */
	reset(): void {
		this.eaten.clear();
		this.live.clear();
		this.gone.clear();
		this.swept.clear();
		this.power.clear();
		this.stolen.clear();
		this.returned.clear();
		this.swallowed.clear();
	}

	/** Every event of this frame (0: nothing happened). */
	count(): number {
		return (
			this.eaten.size() +
			this.live.size() +
			this.gone.size() +
			this.swept.size() +
			this.power.size() +
			this.stolen.size() +
			this.returned.size() +
			this.swallowed.size()
		);
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
			const at = p.power;
			const px = at >= 0 && at < p.x.size() ? p.x[at] : 0;
			const pz = at >= 0 && at < p.z.size() ? p.z[at] : 0;
			this.power.push({
				player: power.player,
				px,
				pz,
				x: [...power.x],
				z: [...power.z],
				points: power.points,
				tick,
			});
		}
		for (const e of ev.stolen) this.stolen.push({ index: e.index, x: e.x, z: e.z, tick });
		for (const e of ev.returned) this.returned.push({ index: e.index, fromX: e.fromX, fromZ: e.fromZ, tick });
		for (const w of ev.swallowed) {
			const cellX: number[] = [];
			const cellZ: number[] = [];
			for (const i of w.indices) {
				cellX.push(p.x[i] ?? w.x);
				cellZ.push(p.z[i] ?? w.z);
			}
			this.swallowed.push({ x: w.x, z: w.z, indices: [...w.indices], cellX, cellZ, tick });
		}
	}
}

/** Enemy bullets the power pellet erased during the frame's ticks (they are in the frame's SimEvents.bulletsDeleted). */
export function pelletPowerErased(pellets: PelletFrameSource): number {
	let n = 0;
	for (const p of pellets.power) n += p.x.size();
	return n;
}

/**
 * The frame's summed SimEvents.bulletsDeleted without the power pellet's erases: the bullets a player's guard or swing
 * (or a build's sweep) deleted, which the deflect sound and the guard effects stand for. Never below 0.
 */
export function deflectedBullets(bulletsDeleted: number, pellets: PelletFrameSource): number {
	return math.max(0, bulletsDeleted - pelletPowerErased(pellets));
}

/** One tick's version (the state's own SimEvents and pellet events, as the guard fan reads them). */
export function tickDeflectedBullets(state: Readonly<SimState>): number {
	const power = state.pellets?.events.power;
	const erased = power !== undefined ? power.x.size() : 0;
	return math.max(0, state.events.bulletsDeleted - erased);
}

/** No events (a run view without pellets, the specs' default). */
export const NO_PELLET_EVENTS: PelletFrameSource = new PelletFrameEvents();
