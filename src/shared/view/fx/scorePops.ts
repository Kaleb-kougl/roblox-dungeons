/**
 * Floating score pops (M2 scoring, presentation only): "+points" over the spot an enemy died, rising and fading.
 * A fixed pool (the oldest pop is replaced when it is full) aged on sim time (SimClock), so pops hold still during
 * pause and the freeze frame. Pure; the client's ScorePopController draws it. Nothing here reaches the sim.
 */

/** Pops on screen at once. */
export const SCORE_POP_POOL_SIZE = 24;
/** Seconds a pop lives. */
export const SCORE_POP_LIFE = 1.1;
/** It fades out over the last this many seconds. */
export const SCORE_POP_FADE = 0.35;
/** Render px it rises (ease-out) over SCORE_POP_RISE_TIME; 0 under reduced motion. */
export const SCORE_POP_RISE_PX = 18;
export const SCORE_POP_RISE_TIME = 0.8;
/** Start height above the floor, render px (above a regular enemy's health bar and damage numbers). */
export const SCORE_POP_BASE_PX = 30;
/** Glyph box at scale 1, render px (the HUD font drawn as text, like the damage numbers). */
export const SCORE_POP_GLYPH_PX = { w: 5, h: 8 } as const;
/** Folder name under Workspace. */
export const SCORE_POP_FOLDER = "KV_ScorePops";

/** Opacity at `age`: 1, then a linear fade over the last SCORE_POP_FADE seconds, 0 after SCORE_POP_LIFE. */
export function scorePopAlpha(age: number): number {
	if (!(age >= 0) || age >= SCORE_POP_LIFE) return 0;
	const left = SCORE_POP_LIFE - age;
	return left >= SCORE_POP_FADE ? 1 : left / SCORE_POP_FADE;
}

/** Whole px risen at `age` (quadratic ease-out); 0 under reduced motion (motion 0). */
export function scorePopRise(age: number, motion: number): number {
	if (motion <= 0 || !(age > 0)) return 0;
	const t = age >= SCORE_POP_RISE_TIME ? 1 : age / SCORE_POP_RISE_TIME;
	return math.round(SCORE_POP_RISE_PX * motion * (1 - (1 - t) * (1 - t)));
}

/** A pop's colour (ScorePopPool.tone): a kill pop, or a kill Gold Rush raised (docs/BUILDS.md BU6, its own colour). */
export const ScorePopTone = { KILL: 0, GOLD_RUSH: 1 } as const;
export type ScorePopTone = (typeof ScorePopTone)[keyof typeof ScorePopTone];

/** A kill's score pop (the run views' scorePops). */
export interface ScorePopPoint {
	readonly x: number;
	readonly z: number;
	readonly points: number;
}

/** A Gold Rush kill (the run views' builds.goldRush: amount = the kill's points). */
export interface GoldRushPoint {
	readonly x: number;
	readonly z: number;
	readonly amount: number;
}

const goldRushTaken: boolean[] = [];

/**
 * Fills `out` (cleared) with each kill pop's tone: GOLD_RUSH when a Gold Rush record of the frame has exactly its x, z
 * and points (the sim pushes both from the same kill, with the same numbers), each record marking one pop, the first
 * unmarked match in order; KILL otherwise. Returns `out`. No allocation in steady state.
 */
export function scorePopTones(
	pops: ReadonlyArray<ScorePopPoint>,
	goldRush: ReadonlyArray<GoldRushPoint>,
	out: ScorePopTone[],
): ScorePopTone[] {
	out.clear();
	const taken = goldRushTaken;
	taken.clear();
	for (let k = 0; k < goldRush.size(); k++) taken.push(false);
	for (const p of pops) {
		let tone: ScorePopTone = ScorePopTone.KILL;
		for (let k = 0; k < goldRush.size(); k++) {
			const g = goldRush[k];
			if (taken[k] || g.x !== p.x || g.z !== p.z || g.amount !== p.points) continue;
			taken[k] = true;
			tone = ScorePopTone.GOLD_RUSH;
			break;
		}
		out.push(tone);
	}
	return out;
}

/** The pool: parallel arrays by slot. `live[i]` is 1 while slot i shows a pop. */
export class ScorePopPool {
	readonly capacity: number;
	readonly live: number[] = [];
	readonly x: number[] = [];
	readonly z: number[] = [];
	readonly points: number[] = [];
	readonly born: number[] = [];
	/** ScorePopTone per slot. */
	readonly tone: ScorePopTone[] = [];
	private nextSlot = 0;

	constructor(capacity = SCORE_POP_POOL_SIZE) {
		this.capacity = capacity;
		for (let i = 0; i < capacity; i++) {
			this.live.push(0);
			this.x.push(0);
			this.z.push(0);
			this.points.push(0);
			this.born.push(0);
			this.tone.push(ScorePopTone.KILL);
		}
	}

	/** Adds a pop at sim (x, z), born `now`; reuses slots round-robin (the oldest goes first). Returns its slot. */
	add(x: number, z: number, points: number, now: number, tone: ScorePopTone = ScorePopTone.KILL): number {
		const i = this.nextSlot;
		this.nextSlot = (i + 1) % this.capacity;
		this.live[i] = 1;
		this.x[i] = x;
		this.z[i] = z;
		this.points[i] = points;
		this.born[i] = now;
		this.tone[i] = tone;
		return i;
	}

	/** Frees pops older than SCORE_POP_LIFE. */
	expire(now: number): void {
		for (let i = 0; i < this.capacity; i++) {
			if (this.live[i] !== 0 && now - this.born[i] >= SCORE_POP_LIFE) this.live[i] = 0;
		}
	}

	clear(): void {
		for (let i = 0; i < this.capacity; i++) this.live[i] = 0;
		this.nextSlot = 0;
	}

	liveCount(): number {
		let n = 0;
		for (const v of this.live) n += v;
		return n;
	}
}
