/**
 * Health bar state per actor slot (port of project-kaleb-vale src/fx/bars/barState.ts and simClock.ts @ 42897e2):
 * chip trail, hit flash / shake and visibility. Pure, preallocated arrays indexed by actor pool slot (0-based) and
 * keyed by ActorState.id. Times are SimClock seconds (sim time: everything freezes with pause / hitstop).
 *
 * Chip trail: on a hit the fill drops to the new hp at once; the chip (the light "recent damage" segment) keeps the old
 * value for CHIP_HOLD, then drains linearly to the fill over CHIP_DRAIN. A hit while the chip is still up keeps the
 * chip where it is (it never jumps down) and restarts the hold.
 *
 * @module
 */
import type { HealthBarsMode } from "shared/settings";
import { SIM_HZ } from "shared/sim";

/** Chip holds the lost portion this long after the last hit (s). */
export const CHIP_HOLD = 0.15;
/** Then drains to the fill over this long (s). */
export const CHIP_DRAIN = 0.3;
/** The bar (fill / filled pips) flashes white this long after a hit: 2 frames at 60 fps (s). */
export const FLASH_TIME = 2 / 60;
/** 'onDamage': fully visible this long after the last hit (s) ... */
export const SHOW_TIME = 2;
/** ... then fades out over this long (s). */
export const FADE_TIME = 0.4;
/** Hit shake: 1 px horizontal offsets, one per 60 Hz frame after a hit (none under reducedMotion). */
export const SHAKE_PATTERN: ReadonlyArray<number> = [1, -1, 1, -1];
const SHAKE_STEP = 1 / 60;
/** Float slack on time comparisons ((tick + alpha) / 60 sums are not exact). */
const EPS = 1e-6;

function filled(n: number, v: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(v);
	return out;
}

export class HealthBarSlots {
	readonly capacity: number;
	/** ActorState.id tracked in the slot, 0 = none. */
	readonly id: number[];
	readonly hp: number[];
	readonly hpMax: number[];
	/** 1 alive, 0 dead (the bar only lives on while its chip drains). */
	readonly alive: number[];
	readonly elite: number[];
	/** Chip value while holding; drains from it to hp starting at holdEnd. */
	readonly chipFrom: number[];
	readonly holdEnd: number[];
	/** Time of the last hit (-math.huge: never hit). */
	readonly lastHit: number[];
	/** Last known feet position, sim units (kept while a freed corpse's chip drains). */
	readonly x: number[];
	readonly z: number[];

	constructor(capacity: number) {
		this.capacity = capacity;
		this.id = filled(capacity, 0);
		this.hp = filled(capacity, 0);
		this.hpMax = filled(capacity, 0);
		this.alive = filled(capacity, 0);
		this.elite = filled(capacity, 0);
		this.chipFrom = filled(capacity, 0);
		this.holdEnd = filled(capacity, 0);
		this.lastHit = filled(capacity, -math.huge);
		this.x = filled(capacity, 0);
		this.z = filled(capacity, 0);
	}

	/** Forget every slot (run reset). */
	clear(): void {
		for (let i = 0; i < this.capacity; i++) this.id[i] = 0;
	}

	/** Forget one slot (a new actor arrives there: 'spawned', slot reuse). */
	release(i: number): void {
		this.id[i] = 0;
	}

	/** Start tracking actor `id` in slot i, full chip = hp, never hit. */
	adopt(i: number, id: number, hp: number, hpMax: number, alive: boolean, elite: boolean): void {
		this.id[i] = id;
		this.hp[i] = hp;
		this.hpMax[i] = hpMax;
		this.alive[i] = alive ? 1 : 0;
		this.elite[i] = elite ? 1 : 0;
		this.chipFrom[i] = hp;
		this.holdEnd[i] = -math.huge;
		this.lastHit[i] = -math.huge;
	}

	/** Chip value of slot i at `now` (>= hp). */
	chip(i: number, now: number): number {
		const hp = this.hp[i];
		const from = this.chipFrom[i];
		if (from <= hp) return hp;
		const t = now - this.holdEnd[i];
		if (t <= 0) return from;
		if (t >= CHIP_DRAIN - EPS) return hp;
		return from + (hp - from) * (t / CHIP_DRAIN);
	}

	/**
	 * A 'hit' on actor `id` in slot i: `damage` came off, leaving `hpAfter`. Adopts the actor first if the slot didn't
	 * track it yet (hp before = hpAfter + damage).
	 */
	hit(i: number, id: number, damage: number, hpAfter: number, hpMax: number, now: number, elite: boolean): void {
		const before = hpAfter + damage;
		if (this.id[i] !== id) this.adopt(i, id, before, hpMax, true, elite);
		const chipNow = this.chip(i, now);
		this.chipFrom[i] = math.max(chipNow, before, this.hp[i]);
		this.hp[i] = hpAfter;
		this.hpMax[i] = hpMax;
		this.holdEnd[i] = now + CHIP_HOLD;
		this.lastHit[i] = now;
		if (elite) this.elite[i] = 1;
	}

	/** The actor in slot i died (its killing hit came first): the bar stays only while the chip drains to 0. */
	kill(i: number, id: number): void {
		if (this.id[i] !== id) return;
		this.alive[i] = 0;
		this.hp[i] = 0;
	}

	/** hp went up without a hit event (heal): fill and chip follow at once. */
	heal(i: number, hp: number): void {
		this.hp[i] = hp;
		if (this.chipFrom[i] < hp) this.chipFrom[i] = hp;
	}

	/** True while slot i's dead actor still has chip to drain at `now`. */
	draining(i: number, now: number): boolean {
		return this.chip(i, now) > this.hp[i];
	}

	/** White flash on? (FLASH_TIME after a hit) */
	flashing(i: number, now: number): boolean {
		const t = now - this.lastHit[i];
		return t >= 0 && t < FLASH_TIME - EPS;
	}

	/** Horizontal shake offset (px) at `now`, scaled by motionScale (0 under reducedMotion). */
	shake(i: number, now: number, motion: number): number {
		if (motion === 0) return 0;
		const t = now - this.lastHit[i];
		if (!(t >= 0)) return 0;
		const k = math.floor(t / SHAKE_STEP + EPS);
		return k < SHAKE_PATTERN.size() ? SHAKE_PATTERN[k] * motion : 0;
	}

	/**
	 * Opacity of slot i's bar at `now` (0 = hidden) for the health bar setting. The caller skips bosses.
	 *   off       never
	 *   always    alive actors always; dead ones while their chip drains
	 *   onDamage  from the first hit, SHOW_TIME after the last hit, then a FADE_TIME fade; dead ones while draining
	 */
	visibility(i: number, mode: HealthBarsMode, now: number): number {
		if (mode === "off" || this.id[i] === 0) return 0;
		if (this.alive[i] === 0) return this.draining(i, now) ? 1 : 0;
		if (mode === "always") return 1;
		return onDamageAlpha(now - this.lastHit[i]);
	}
}

/** 'onDamage' opacity `age` seconds after the last hit (infinite / NaN: never hit -> 0). */
export function onDamageAlpha(age: number): number {
	if (!(age >= 0) || age === math.huge) return 0;
	if (age < SHOW_TIME) return 1;
	const f = 1 - (age - SHOW_TIME) / FADE_TIME;
	return f > EPS ? f : 0;
}

/**
 * Presentation clock for the juice views: seconds of SIM time, interpolated, (tick + alpha) / SIM_HZ. Bars and numbers
 * age by it, so they freeze with the game (pause, the hitstop freeze frame) and stay smooth between ticks. Monotonic
 * within a run (alpha can drop back a little when a pause clears the accumulator); a tick going backwards (new run)
 * restarts it. Pure; read-only on the sim.
 */
export class SimClock {
	private t = 0;
	private lastTick = -1;

	/** Advance to this frame's (tick, alpha) and return the time in seconds. Idempotent within a frame. */
	update(tick: number, alpha: number): number {
		const v = (tick + alpha) / SIM_HZ;
		if (tick < this.lastTick || v > this.t) this.t = v;
		this.lastTick = tick;
		return this.t;
	}

	/** Current time (seconds) as of the last update. */
	now(): number {
		return this.t;
	}

	reset(): void {
		this.t = 0;
		this.lastTick = -1;
	}
}
