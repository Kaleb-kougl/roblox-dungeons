/**
 * Boosts from breakables on screen (docs/BREAKABLE_DROPS.md BL6): the pure half of the client's glint on loaded pieces
 * (BreakableRenderController), the hop of a released boost (BoostDropRenderController) and the KV_LootDebug label.
 * Plain numbers only, tested headlessly (breakableLoot.spec.ts); presentation only (nothing here reaches `step()`).
 * Tunables: BREAKABLE_LOOT_VIEW (breakableLootConfig.ts).
 *
 *   glint     a loaded intact piece (shared/sim breakableLootAt) shows `decor.fx.glint` once every glintEverySeconds of
 *             sim time, phased by its cell hash (deterministic: every client sees the same sparkle at the same tick);
 *             a still frame under reduced motion; its billboard on the piece's top as drawn (art or placeholder box);
 *             hidden while an enemy bullet is near (never over a bullet). The Goldling's hiding place glints exactly
 *             the same way while it hides (docs/GOLDLING_RUMOURS.md RD14, GR4: shared/sim goldenPieceAt): pieceGlints
 *             is the one test, glintSlotCount the slots to scan
 *   hop       a released boost's height over the floor: the piece's top -> the floor in an arc over hopSeconds, then
 *             the drop's ordinary bob counted from the landing
 *   debug     the label text of a loaded piece (developer text, English)
 */
import { CAMERA_PITCH_DEG, STUDS_PER_TILE } from "shared/config";
import { TILE_SIZE, cellKey } from "shared/dungeon";
import { NO_BOOST, breakableLootAt, goldenPieceAt, type SimState } from "shared/sim";
import { BOOST_KINDS } from "shared/theme";
import { BREAKABLE_LOOT_VIEW } from "./breakableLootConfig";
import { degToRad } from "./iso";
import { decorHash } from "./decor";
import { spriteBillboard, type SpriteBillboard, type SpriteLayout } from "./sprites";
import { isGooPayload } from "./variants";

/** lootGlintFrame: the glint is hidden this frame. */
export const LOOT_GLINT_HIDDEN = -1;

// ---------------------------------------------------------------------------------------------
// The glint

/**
 * Breakables slot `slot` glints (the caller also checks the piece is drawn and intact): it holds a boost
 * (breakableLootAt) or it is the Goldling's piece while the Goldling hides in it (goldenPieceAt, docs/GOLDLING_RUMOURS.md
 * RD14). Both glint with the same art, tint, cadence and per-cell phase (lootGlintPhaseSec), so nobody can tell a
 * Goldling's crate from a loaded one until it breaks. Read-only.
 */
export function pieceGlints(state: Readonly<SimState>, slot: number): boolean {
	return breakableLootAt(state, slot) !== NO_BOOST || goldenPieceAt(state, slot);
}

/**
 * How many breakables slots the glint scans from 0: the loot table's size, or one past the Goldling's piece while it
 * hides there (its piece is the floor's last piece, past every loot slot). 0: nothing can glint.
 */
export function glintSlotCount(state: Readonly<SimState>): number {
	const loot = state.drops?.pieceLoot.size() ?? 0;
	const g = state.golden;
	const piece = g !== undefined && g.piece >= 0 && goldenPieceAt(state, g.piece) ? g.piece + 1 : 0;
	return math.max(loot, piece);
}

/**
 * A loaded piece's glint phase, sim seconds into the glint cycle, from its cell (cellX, cellY) alone: one of
 * glintPhaseSlots evenly spaced phases in [0, glintEverySeconds), by a decorHash of the cell (same on every client, no
 * floor seed: the cell already differs piece to piece).
 */
export function lootGlintPhaseSec(cellX: number, cellY: number): number {
	const v = BREAKABLE_LOOT_VIEW;
	const slot = decorHash(0, cellKey(cellX, cellY), v.glintPhaseSalt) % v.glintPhaseSlots;
	return (slot / v.glintPhaseSlots) * v.glintEverySeconds;
}

/** Seconds one glint pass shows: its `frames` at `fps`, or glintFlashSeconds for art without frames (image, no fps). */
export function lootGlintPassSec(fps: number, frames: number): number {
	return fps > 0 ? math.max(1, math.floor(frames)) / fps : BREAKABLE_LOOT_VIEW.glintFlashSeconds;
}

/**
 * The glint's frame (0..frames-1) at sim second `simSec` for a piece phased `phaseSec` (lootGlintPhaseSec), or
 * LOOT_GLINT_HIDDEN between passes. One pass (lootGlintPassSec) at the start of every glintEverySeconds cycle; a pass
 * longer than the cycle loops. Under reduced motion (motionScale 0) the still frame glintStillFrame, always shown.
 */
export function lootGlintFrame(simSec: number, phaseSec: number, fps: number, frames: number, motion: number): number {
	const v = BREAKABLE_LOOT_VIEW;
	const n = math.max(1, math.floor(frames));
	if (!(motion > 0)) return v.glintStillFrame % n;
	const pass = lootGlintPassSec(fps, frames);
	const cycle = math.max(pass, v.glintEverySeconds);
	const t = (math.max(0, simSec) + math.max(0, phaseSec)) % cycle;
	if (!(t < pass)) return LOOT_GLINT_HIDDEN;
	return fps > 0 ? math.min(n - 1, math.floor(t * fps)) : 0;
}

/** The glint's ImageTransparency while shown: glintTransparency, or reducedTransparency for the still sparkle. */
export function lootGlintTransparency(motion: number): number {
	return motion > 0 ? BREAKABLE_LOOT_VIEW.glintTransparency : BREAKABLE_LOOT_VIEW.reducedTransparency;
}

/** Where the glint sits on a piece, relative to the piece's base anchor: camera-space studs (SpriteBillboard axes). */
export interface PieceTop {
	/** The drawn top, studs up the camera's up axis from the base. */
	readonly upStuds: number;
	/** The piece's front, studs toward the camera from the base (the glint goes glintDepthStuds nearer). */
	readonly frontStuds: number;
}

/**
 * The top of a piece drawn as billboard art laid out as `layout` (BreakableRenderController's capped layout): the cell's
 * height above its pivot (clamped to the frame), and the billboard's own camera-ward shift (spriteBillboard offsetZ).
 */
export function artPieceTop(layout: SpriteLayout, studsPerTile: number = STUDS_PER_TILE): PieceTop {
	const s = studsPerTile / layout.pixelsPerTile;
	return {
		upStuds: math.min(layout.frameH, math.max(0, layout.pivot.y)) * s,
		frontStuds: spriteBillboard(layout, studsPerTile).offsetZ,
	};
}

/**
 * The top of a placeholder box `size` studs ([w, h, d], its base at the anchor): the top face's centre is h * cos(pitch)
 * up the camera's up axis and h * sin(pitch) toward the camera; its front is half the larger footprint side nearer.
 */
export function boxPieceTop(size: readonly [number, number, number], pitchDeg: number = CAMERA_PITCH_DEG): PieceTop {
	const p = degToRad(pitchDeg);
	const h = math.max(0, size[1]);
	return { upStuds: h * math.cos(p), frontStuds: h * math.sin(p) + math.max(size[0], size[2]) / 2 };
}

/**
 * The glint's billboard on a piece whose top is `top`: the glint art `glint`'s own size x glintScale, centred
 * glintTopFraction of the way up the drawn piece, glintDepthStuds in front of it.
 */
export function lootGlintBillboard(
	top: Readonly<PieceTop>,
	glint: SpriteLayout,
	studsPerTile: number = STUDS_PER_TILE,
): SpriteBillboard {
	const v = BREAKABLE_LOOT_VIEW;
	const s = (studsPerTile / glint.pixelsPerTile) * v.glintScale;
	return {
		w: glint.frameW * s,
		h: glint.frameH * s,
		offsetX: 0,
		offsetY: top.upStuds * v.glintTopFraction,
		offsetZ: top.frontStuds + v.glintDepthStuds,
	};
}

/** The enemy bullets lootGlintDucked reads (shared/sim BulletSimulation satisfies it). */
export interface LootGlintBullets {
	highWater(): number;
	isVisible(i: number): boolean;
	positionAt(i: number): Readonly<{ x: number; z: number }>;
	payloadAt(i: number): number;
}

/**
 * True when a visible bullet of `bullets` (pass the ENEMY pool) has its centre within `radius` (sim floor units,
 * default duckTiles) of the piece's cell centre (x, z) on both floor axes: the glint hides. Stops at the first hit.
 * Ooze goo is skipped: a stationary floor decal drawn under the glint, renewed while a slime lingers, it would hide the
 * hint for as long as the trail lies there.
 */
export function lootGlintDucked(
	x: number,
	z: number,
	bullets: LootGlintBullets,
	radius: number = BREAKABLE_LOOT_VIEW.duckTiles * TILE_SIZE,
): boolean {
	const n = bullets.highWater();
	for (let i = 0; i < n; i++) {
		if (!bullets.isVisible(i) || isGooPayload(bullets.payloadAt(i))) continue;
		const p = bullets.positionAt(i);
		if (math.abs(p.x - x) <= radius && math.abs(p.z - z) <= radius) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------------------------
// The hop

/**
 * A released boost's height above its rest point, studs, `ageSec` after it landed (sim time): from the piece's top
 * (hopFromTiles) down to 0 over hopSeconds along a parabola rising hopTiles above the straight line at its middle,
 * (1 - t) from + 4 t (1 - t) rise; 0 after the hop and under reduced motion (motionScale 0).
 */
export function lootHopStuds(ageSec: number, motion: number, studsPerTile: number = STUDS_PER_TILE): number {
	const v = BREAKABLE_LOOT_VIEW;
	if (!(motion > 0) || !(ageSec >= 0) || !(ageSec < v.hopSeconds)) return 0;
	const t = ageSec / v.hopSeconds;
	return ((1 - t) * v.hopFromTiles + 4 * t * (1 - t) * v.hopTiles) * studsPerTile;
}

/**
 * The age the drop's ordinary look (bob, halo pulse) reads for a drop `ageSec` old: the age itself for a kill drop,
 * the time since it touched down for a piece's (`hopped`), so its bob starts on the floor where the hop ends.
 */
export function lootSettledAgeSec(ageSec: number, hopped: boolean): number {
	return hopped ? math.max(0, ageSec - BREAKABLE_LOOT_VIEW.hopSeconds) : ageSec;
}

// ---------------------------------------------------------------------------------------------
// KV_LootDebug

/** The debug label of a piece holding Boost `kind` (developer text, English): `loot: <kind>`. */
export function lootDebugText(kind: number): string {
	return `loot: ${BOOST_KINDS[kind] ?? tostring(kind)}`;
}
