/**
 * Pure helpers of the decor renderers (docs/DECOR.md R4, R9): which direction a piece faces, the bodies that fade tall
 * pieces, the fade tween, a flame's frame with its per-piece phase, a standing piece's footprint (debug), and the
 * biome's ambient emitter numbers. DecorController / DecorFxController only copy the results onto Instances.
 */
import { THEMES, type ThemeKey } from "shared/dungeon";
import { PLAYER_RADIUS, partySize, playerAt, type SimState } from "shared/sim";
import type { DecorBody } from "./decor";
import type { DecorEntry, DecorFootprint } from "./decorPlan";
import { decorLiveBoss } from "./director";
import { DECOR_FX, DECOR_VIEW, type AmbientMotion } from "./fxConfig";

const DEG = math.pi / 180;
const FULL_TURN_DEG = 360;
const HALF = 0.5;

const GRID_KINDS: ReadonlySet<string> = new Set<string>(DECOR_VIEW.gridKinds);

/**
 * The world direction (x, z) a piece's sprite faces: grid pieces (DECOR_VIEW.gridKinds) their wall's normal
 * (faceX, faceZ; +X when they have none), so their edges run along the grid; round pieces an angle by cell hash (any
 * facing reads, and neighbours differ). Feed it to spriteFacing.
 */
export function decorFacingDir(e: Pick<DecorEntry, "kind" | "faceX" | "faceZ" | "hash">): readonly [number, number] {
	if (GRID_KINDS.has(e.kind)) {
		if (e.faceX === 0 && e.faceZ === 0) return [1, 0];
		return [e.faceX, e.faceZ];
	}
	const a = (e.hash % FULL_TURN_DEG) * DEG;
	return [math.cos(a), math.sin(a)];
}

/** `current` moved toward `target` at full range per `seconds` (snaps when seconds <= 0). */
export function decorFadeStep(current: number, target: number, dt: number, seconds: number): number {
	if (seconds <= 0) return target;
	const stepSize = math.max(0, dt) / seconds;
	return current < target ? math.min(target, current + stepSize) : math.max(target, current - stepSize);
}

/**
 * The bodies tall decor must not hide this frame (selectDecorFades): every living player and the live boss, tiles,
 * written into `out` (its objects reused). Returns `out`.
 */
export function decorFadeBodies(state: Readonly<SimState>, out: DecorBody[]): DecorBody[] {
	const pool = out as MutableBody[];
	let n = 0;
	const players = partySize(state);
	for (let i = 0; i < players; i++) {
		const p = playerAt(state, i);
		if (p.dead !== 0) continue;
		putBody(pool, n, p.x, p.z, PLAYER_RADIUS, DECOR_VIEW.playerBodyHeightTiles);
		n++;
	}
	const boss = decorLiveBoss(state);
	if (boss !== undefined) {
		putBody(pool, n, boss.x, boss.z, boss.radius, DECOR_VIEW.bossBodyHeightTiles);
		n++;
	}
	for (let i = pool.size() - 1; i >= n; i--) pool.pop();
	return out;
}

type MutableBody = { x: number; z: number; radius: number; height: number };

/** Writes body `n` of `pool` (reusing its object; a new one only past the end). No closure: called every frame. */
function putBody(pool: MutableBody[], n: number, x: number, z: number, radius: number, height: number): void {
	const b = pool[n];
	if (b === undefined) pool[n] = { x, z, radius, height };
	else {
		b.x = x;
		b.z = z;
		b.radius = radius;
		b.height = height;
	}
}

/** A standing entry's footprint (its first cell, its last along the run), for footprintStencil. */
export function decorEntryFootprint(e: DecorEntry): DecorFootprint {
	const len = math.max(1, e.cells) - 1;
	return {
		x0: e.cellX,
		y0: e.cellY,
		x1: e.cellX + len * e.runX,
		y1: e.cellY + len * e.runZ,
		runX: e.runX,
		runZ: e.runZ,
	};
}

/**
 * A looping effect's frame at time `t`: `fps` frames per second over `frames`, started at a phase picked by `hash`, so
 * flames on neighbouring pieces do not pulse in step.
 */
export function decorLoopFrame(t: number, fps: number, frames: number, hash: number): number {
	const n = math.max(1, math.floor(frames));
	if (!(fps > 0)) return hash % n;
	const f = math.floor(t * fps) + (hash % n);
	return ((f % n) + n) % n;
}

/** What the biome's ambient ParticleEmitter is set to (counts and timings; look and colour come from the theme). */
export interface AmbientEmitterSpec {
	/** Live particles aimed for (<= DECOR_FX.maxParticles); 0: the emitter is off. */
	readonly live: number;
	/** ParticleEmitter.Rate = live / mean lifetime. */
	readonly rate: number;
	readonly motion: AmbientMotion;
}

/**
 * The ambient emitter for a floor of Forge theme `themeKey`: the theme's reference count (THEMES[key].particles.n) x
 * the depth band's light (`light`, DecorProfile.light) x the juice particle level's share (DECOR_FX.levelScale) x
 * `motion` (the juice motionScale: none under reduced motion), capped at DECOR_FX.maxParticles.
 */
export function ambientEmitterSpec(
	themeKey: ThemeKey,
	light: number,
	level: keyof typeof DECOR_FX.levelScale,
	motion: number,
): AmbientEmitterSpec {
	const p = THEMES[themeKey].particles;
	const kinds = DECOR_FX.ambientMotion;
	const motionDef = kinds[math.clamp(p.kind, 0, kinds.size() - 1)];
	const share = DECOR_FX.levelScale[level] ?? 0;
	const live = math.min(
		DECOR_FX.maxParticles,
		math.floor(p.n * math.clamp(light, 0, 1) * share * math.clamp(motion, 0, 1)),
	);
	const mean = (motionDef.lifetime[0] + motionDef.lifetime[1]) * HALF;
	return { live, rate: live > 0 && mean > 0 ? live / mean : 0, motion: motionDef };
}

/**
 * The abyss motes (docs/VOID_DECOR.md VD8): a second, sparser emitter deep in the void, DECOR_FX.abyssMoteShare of the
 * ambient emitter's live count (so the band's light, the juice particle level and motionScale scale it the same way,
 * and Reduced motion zeroes it) in their own slow drift (DECOR_FX.abyssMoteMotion), whatever the biome's motion.
 */
export function abyssMoteSpec(ambient: AmbientEmitterSpec): AmbientEmitterSpec {
	const m = DECOR_FX.abyssMoteMotion;
	const live = math.max(0, math.floor(ambient.live * DECOR_FX.abyssMoteShare));
	const mean = (m.lifetime[0] + m.lifetime[1]) * HALF;
	return { live, rate: live > 0 && mean > 0 ? live / mean : 0, motion: m };
}

/**
 * The most a particle of motion `m` can climb from where it is emitted, tiles (the emitter's Speed and Acceleration are
 * in tiles x STUDS_PER_TILE): its fastest speed straight up for its longest life, plus any upward acceleration. A bound,
 * not a mean: the abyss motes' volume sits low enough that even this stays under the floor (voidDecor parts.spec).
 */
export function ambientMaxRiseTiles(m: AmbientMotion): number {
	const life = m.lifetime[1];
	return m.speed[1] * life + HALF * math.max(0, m.accelY) * life * life;
}
