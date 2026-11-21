/**
 * The overcap pops' bullet duck (docs/BUILDS_V2.md BV11d; Studio checklist 10, "overcap pops on a capped boss, merged,
 * never over a boss bullet"). An overcap pop is a billboard "+N" over the boss (shared/view/fx OvercapPops, the score
 * pops' construction), drawn on top of everything; a boss fight fills the screen round the boss with bullets, so the pop
 * must never sit over one. The pop's on-screen rectangle is mapped back to the floor it covers (overcapPopBox: the
 * billboard's height above the floor point projects screen-up onto the floor by height / tan(pitch), its height by
 * 1 / sin(pitch)), and while an enemy bullet is inside that floor box (grown by OVERCAP_POP_DUCK.marginTiles; the combo
 * shout's test, shoutDucked) the pop drops to OVERCAP_POP_DUCK.opacity (overcapPopOpacity). The camera is a narrow-FOV
 * perspective camera framed as the web build's orthographic one (shared/view iso.ts), so the projection is the
 * orthographic one. Pure, no allocation (the box is the caller's). Presentation only.
 *
 * @module
 */
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import { TILE_SIZE } from "shared/sim";
import { BUILDS_V2_FX, FX_VIEW, SCORE_POP_BASE_PX, SCORE_POP_GLYPH_PX, scorePopAlpha } from "shared/view/fx";
import { degToRad } from "../iso";
import { floorAxes } from "./comboDraw";
import { shoutBoxAt, shoutDucked, type ShoutBox, type ShoutBullets } from "./combo";

/** The overcap pops' duck tunables. */
export const OVERCAP_POP_DUCK = {
	/** A ducked pop's opacity factor (the combo shout's duckOpacity). */
	opacity: 0.15,
	/** The floor box grows by this on every side (a bullet's radius and a little air), tiles. */
	marginTiles: 0.3,
} as const;

/** Studs (render) -> sim floor units. */
const SIM_PER_STUD = TILE_SIZE / STUDS_PER_TILE;

/**
 * Fills `out` with the floor box an overcap pop covers on screen: the pop of `chars` characters stands over the floor
 * point (x, z) (sim units) at its billboard offset (SCORE_POP_BASE_PX + overcap.liftPx + `risePx` + half a glyph, render
 * px), at overcap.scale; pitch / yaw the camera's (defaults: the game camera's).
 */
export function overcapPopBox(
	out: ShoutBox,
	x: number,
	z: number,
	chars: number,
	risePx: number,
	pitchDeg: number = CAMERA_PITCH_DEG,
	yawDeg: number = CAMERA_YAW_DEG,
): ShoutBox {
	const o = BUILDS_V2_FX.overcap;
	const px = FX_VIEW.pxStuds * SIM_PER_STUD;
	const glyphW = SCORE_POP_GLYPH_PX.w * o.scale;
	const glyphH = SCORE_POP_GLYPH_PX.h * o.scale;
	const pitch = degToRad(pitchDeg);
	const height = (SCORE_POP_BASE_PX + o.liftPx + risePx + glyphH / 2) * px;
	const up = height / math.tan(pitch);
	const axes = floorAxes(yawDeg);
	shoutBoxAt(out, x + axes.upX * up, z + axes.upZ * up, axes.rightX, axes.rightZ);
	out.halfWidth = (math.max(chars, 1) * glyphW * px) / 2;
	out.halfDepth = (glyphH * px) / 2 / math.sin(pitch);
	return out;
}

/** A visible bullet of `bullets` (pass the ENEMY pool) is under the pop's floor box (grown by marginTiles). */
export function overcapPopDucked(box: Readonly<ShoutBox>, bullets: ShoutBullets): boolean {
	return shoutDucked(box, bullets, OVERCAP_POP_DUCK.marginTiles * TILE_SIZE);
}

/**
 * An overcap pop's opacity: scorePopAlpha(ageSec) x ownerOpacity (a teammate's at teammateOpacity) x
 * OVERCAP_POP_DUCK.opacity while `ducked`.
 */
export function overcapPopOpacity(ageSec: number, mine: boolean, ducked: boolean): number {
	const own = mine ? 1 : BUILDS_V2_FX.teammateOpacity;
	return scorePopAlpha(ageSec) * own * (ducked ? OVERCAP_POP_DUCK.opacity : 1);
}
