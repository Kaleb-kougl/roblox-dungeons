/**
 * Breakable barrels and crates on screen (docs/DECOR.md D4, task R13): the pure half of the client's
 * BreakableRenderController. Plain numbers only, so it is tested headlessly; presentation only (nothing here reaches
 * `step()`). Tunables: BREAKABLE_VIEW (breakablesConfig.ts).
 *
 *   BreakableTracker   diffs the sim's breakables state (shared/sim state.breakables) against the last frame it saw:
 *                      which pieces were hit, which broke, which came back, or that the whole layout is new. It reads
 *                      each piece's hp / brokenTick, NOT the sim's per-tick `hitSlots` / `brokenSlots` (only the last
 *                      tick's survive a multi-tick frame), so nothing is lost when a frame runs several ticks.
 *   hit look           blink (breakableHitFlash) and the small decaying shake (breakableShakeStuds, x motionScale).
 *   placement          a piece's cell -> its base point in studs, the placeholder box and art layouts clamped to
 *                      BREAKABLE_VIEW.maxHeightTiles, the shatter one-shot's length.
 *   debris             the decor kind a broken piece leaves (brokenBarrel / brokenCrate) and its variant by cell hash,
 *                      so every client picks the same one.
 *   aim clip           clipToSolidCells: where a ray first enters an intact piece's cell (the sniper's aim line stops
 *                      where its bullet will).
 */
import { STUDS_PER_TILE } from "shared/config";
import {
	BREAKABLE_KINDS,
	TILE_SIZE,
	cellKey,
	gridToWorld,
	worldToGrid,
	type BreakableKindName,
	type SolidCells,
} from "shared/dungeon";
import { NOT_BROKEN, type BreakablesState } from "shared/sim";
import type { DecorKind } from "shared/theme";
import { BREAKABLE_VIEW } from "./breakablesConfig";
import { decorHash } from "./decor";
import { floorStudsY, studsX, studsZ } from "./space";
import type { SpriteLayout } from "./sprites";

const TAU = 2 * math.pi;

// ---------------------------------------------------------------------------------------------
// Frame diff

/**
 * The view's copy of the breakables it last drew, diffed against the live state once per rendered frame.
 *
 * `update` returns true (and every slot is in `hits` / `broken` / `restored` = empty) when the layout is new: the first
 * frame, after `reset()`, when the pieces' count, kinds or cells differ (an endless floor change), or when the sim's
 * tick went backwards (a restart, even on the same floor). Then the owner rebuilds every view from `isIntact`, without
 * effects (a piece already broken shows as broken). Otherwise each slot is classified once per frame, however many
 * ticks ran:
 *   broken    intact last frame, broken now (its hits this frame are folded in: the break wins)
 *   hits      intact both times, hp dropped
 *   restored  broken last frame and intact now, or hp went up (not a play path; a defensive silent repair)
 * No breakables state at all is an empty layout.
 */
export class BreakableTracker {
	private readonly kinds = new Array<number>();
	private readonly xs = new Array<number>();
	private readonly ys = new Array<number>();
	private readonly hps = new Array<number>();
	private readonly brokenTicks = new Array<number>();
	private primed = false;
	private lastTick = 0;
	/** This frame's slots, in slot order (cleared by every update). */
	readonly hits = new Array<number>();
	readonly broken = new Array<number>();
	readonly restored = new Array<number>();

	/** Forget the last frame: the next update reports a new layout (run start, floor change, run end). */
	reset(): void {
		this.primed = false;
	}

	/** Pieces in the layout last seen. */
	count(): number {
		return this.kinds.size();
	}

	/** Kind (BreakableKind index), cell and state of a slot as last seen. */
	kindAt(slot: number): number {
		return this.kinds[slot];
	}

	cellX(slot: number): number {
		return this.xs[slot];
	}

	cellY(slot: number): number {
		return this.ys[slot];
	}

	isIntact(slot: number): boolean {
		return this.brokenTicks[slot] === NOT_BROKEN;
	}

	/** Diffs `b` (state.breakables, undefined = none) at sim tick `tick`. True when the layout is new (rebuild). */
	update(b: Readonly<BreakablesState> | undefined, tick: number): boolean {
		this.hits.clear();
		this.broken.clear();
		this.restored.clear();
		const pieces = b?.pieces;
		const n = pieces !== undefined ? pieces.size() : 0;
		let fresh = !this.primed || tick < this.lastTick || n !== this.kinds.size();
		if (!fresh && pieces !== undefined) {
			for (let i = 0; i < n; i++) {
				const p = pieces[i];
				if (p.kind !== this.kinds[i] || p.x !== this.xs[i] || p.y !== this.ys[i]) {
					fresh = true;
					break;
				}
			}
		}
		this.primed = true;
		this.lastTick = tick;
		if (fresh) {
			this.kinds.clear();
			this.xs.clear();
			this.ys.clear();
			this.hps.clear();
			this.brokenTicks.clear();
			if (pieces !== undefined) {
				for (const p of pieces) {
					this.kinds.push(p.kind);
					this.xs.push(p.x);
					this.ys.push(p.y);
					this.hps.push(p.hp);
					this.brokenTicks.push(p.brokenTick);
				}
			}
			return true;
		}
		if (pieces === undefined) return false;
		for (let i = 0; i < n; i++) {
			const p = pieces[i];
			const wasIntact = this.brokenTicks[i] === NOT_BROKEN;
			const intact = p.brokenTick === NOT_BROKEN;
			if (wasIntact && !intact) this.broken.push(i);
			else if (!wasIntact && intact) this.restored.push(i);
			else if (intact && p.hp < this.hps[i]) this.hits.push(i);
			else if (intact && p.hp > this.hps[i]) this.restored.push(i);
			this.hps[i] = p.hp;
			this.brokenTicks[i] = p.brokenTick;
		}
		return false;
	}
}

// ---------------------------------------------------------------------------------------------
// Hit look

/** True while a hit `ageSec` ago still shows (blink or shake). */
export function breakableHitActive(ageSec: number): boolean {
	return ageSec >= 0 && ageSec < math.max(BREAKABLE_VIEW.hitBlinkSec, BREAKABLE_VIEW.shakeSec);
}

/** The hit blink: flashed (BREAKABLE_VIEW.flashRole) in the even blink periods of the first hitBlinkSec. */
export function breakableHitFlash(ageSec: number): boolean {
	if (!(ageSec >= 0) || ageSec >= BREAKABLE_VIEW.hitBlinkSec) return false;
	return math.floor(ageSec / BREAKABLE_VIEW.blinkPeriodSec) % 2 === 0;
}

/**
 * The hit shake, studs along the screen's x axis: shakeStuds x motionScale x a linear decay x sin(2 pi shakeHz t),
 * 0 outside [0, shakeSec) and under reduced motion (motionScale 0).
 */
export function breakableShakeStuds(ageSec: number, motionScale: number): number {
	const v = BREAKABLE_VIEW;
	if (!(motionScale > 0) || !(ageSec >= 0) || ageSec >= v.shakeSec) return 0;
	return v.shakeStuds * motionScale * (1 - ageSec / v.shakeSec) * math.sin(TAU * v.shakeHz * ageSec);
}

// ---------------------------------------------------------------------------------------------
// Placement

/** A piece's base point in studs: its cell centre on the floor, lifted by BREAKABLE_VIEW.liftStuds. */
export function breakableBaseStuds(cellX: number, cellY: number): readonly [number, number, number] {
	return [studsX(gridToWorld(cellX)), floorStudsY() + BREAKABLE_VIEW.liftStuds, studsZ(gridToWorld(cellY))];
}

/** A placeholder box size (studs [w, h, d]) with its height capped at maxHeightTiles; the footprint is kept. */
export function breakableBoxStuds(
	size: readonly [number, number, number],
	maxHeightTiles: number = BREAKABLE_VIEW.maxHeightTiles,
	studsPerTile: number = STUDS_PER_TILE,
): readonly [number, number, number] {
	return [size[0], math.min(size[1], maxHeightTiles * studsPerTile), size[2]];
}

/**
 * Art drawn no taller than maxHeightTiles: the layout with pixelsPerTile raised to frameH / maxHeightTiles when the
 * cell would stand taller (scaled down uniformly), else unchanged.
 */
export function breakableArtLayout(
	layout: SpriteLayout,
	maxHeightTiles: number = BREAKABLE_VIEW.maxHeightTiles,
): SpriteLayout {
	const minPixelsPerTile = layout.frameH / maxHeightTiles;
	if (!(layout.pixelsPerTile < minPixelsPerTile)) return layout;
	return { frameW: layout.frameW, frameH: layout.frameH, pivot: layout.pivot, pixelsPerTile: minPixelsPerTile };
}

/** Seconds a one-shot of `frames` at `fps` plays (0 when it cannot play). */
export function oneShotSec(frames: number, fps: number): number {
	return frames > 0 && fps > 0 ? frames / fps : 0;
}

// ---------------------------------------------------------------------------------------------
// Debris

/** The flat decal each kind leaves when it breaks (theme decor kinds; optional per pack). */
export const BREAKABLE_DEBRIS: Readonly<Record<BreakableKindName, DecorKind>> = {
	barrel: "brokenBarrel",
	crate: "brokenCrate",
};

/** A state kind index (shared/sim BreakableKind) -> its name, or undefined for an unknown index. */
export function breakableKindName(kind: number): BreakableKindName | undefined {
	return BREAKABLE_KINDS[kind];
}

/**
 * A well-mixed u32 of a cell (stable on every client): decorHash of the cell (no floor seed) with
 * BREAKABLE_VIEW.debrisSalt.
 */
export function breakableCellHash(cellX: number, cellY: number): number {
	return decorHash(0, cellKey(cellX, cellY), BREAKABLE_VIEW.debrisSalt);
}

/** Which of `count` debris variants a cell shows (cell hash), or -1 with none. */
export function debrisVariant(cellX: number, cellY: number, count: number): number {
	if (count <= 0) return -1;
	return breakableCellHash(cellX, cellY) % count;
}

// ---------------------------------------------------------------------------------------------
// Aim clip

/**
 * The segment from (x0, z0) along (dx, dz) x len (sim world units), cut where it first enters a cell of `solid` (the
 * intact pieces: shared/sim solidCells; a bullet stops when its centre enters one). Returns the kept length: `len`
 * when nothing is in the way or `solid` is undefined / empty. The start cell never clips (the shooter stands there).
 * Grid traversal over every cell the segment crosses (cell (gx, gy) spans gx +- half a tile).
 */
export function clipToSolidCells(
	solid: SolidCells | undefined,
	x0: number,
	z0: number,
	dx: number,
	dz: number,
	len: number,
): number {
	if (solid === undefined || solid.size() === 0 || !(len > 0)) return len;
	const ex = (dx * len) / TILE_SIZE;
	const ez = (dz * len) / TILE_SIZE;
	if (ex === 0 && ez === 0) return len;
	const ux = x0 / TILE_SIZE + 0.5;
	const uz = z0 / TILE_SIZE + 0.5;
	let cx = worldToGrid(x0);
	let cz = worldToGrid(z0);
	const endX = worldToGrid(x0 + ex * TILE_SIZE);
	const endZ = worldToGrid(z0 + ez * TILE_SIZE);
	const stepX = ex > 0 ? 1 : ex < 0 ? -1 : 0;
	const stepZ = ez > 0 ? 1 : ez < 0 ? -1 : 0;
	let tMaxX = stepX > 0 ? (cx + 1 - ux) / ex : stepX < 0 ? (cx - ux) / ex : math.huge;
	let tMaxZ = stepZ > 0 ? (cz + 1 - uz) / ez : stepZ < 0 ? (cz - uz) / ez : math.huge;
	const tDeltaX = stepX !== 0 ? 1 / math.abs(ex) : math.huge;
	const tDeltaZ = stepZ !== 0 ? 1 / math.abs(ez) : math.huge;
	const steps = math.abs(endX - cx) + math.abs(endZ - cz);
	for (let i = 0; i < steps; i++) {
		let t: number;
		if (tMaxX < tMaxZ) {
			cx += stepX;
			t = tMaxX;
			tMaxX += tDeltaX;
		} else {
			cz += stepZ;
			t = tMaxZ;
			tMaxZ += tDeltaZ;
		}
		if (t > 1) break;
		if (solid.has(cellKey(cx, cz))) return math.max(0, t) * len;
	}
	return len;
}
