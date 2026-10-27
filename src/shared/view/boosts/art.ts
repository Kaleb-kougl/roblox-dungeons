/**
 * Boost drop art on screen (docs/BOOST_ART.md BA3): the pure half of the art layers BoostDropRenderController draws
 * when the pack has art for `boost.<kind>` (the placeholder gem keeps its own look). Plain numbers only, tested
 * headlessly (art.spec.ts); presentation only. Tunables: BOOST_VIEW (config.ts).
 *
 *   prop        an image's billboard layout: the Lords of Pain scale (artPixelsPerTile), never taller than
 *               maxHeightTiles in all
 *   stack       every layer's transparency with the drop's fade blink on top (the stack blinks together)
 *   halo        its pulse, in phase with the bob (none under reduced motion)
 *   beam        its transparency in the blink
 *   glint       the loop's frame per slot (a phase per slot; one still frame under reduced motion), its billboard over
 *               the prop's centre
 *   pickup      the flash: the glint played once (2x) and the halo's grow-and-fade, and how long it lasts
 */
import { STUDS_PER_TILE } from "shared/config";
import type { Pivot } from "shared/theme";
import { decorLoopFrame, type SpriteBillboard, type SpriteLayout } from "shared/view";
import { dropBobPhase } from "./boosts";
import { BOOST_VIEW } from "./config";

// ---------------------------------------------------------------------------------------------
// The prop

/**
 * A boost image's billboard layout (w x h px, `pivot`): at BOOST_VIEW.artPixelsPerTile (the Lords of Pain props'
 * scale), or at frameH / maxHeightTiles when that would draw it taller than maxHeightTiles in all (so the coin scatter
 * and the gem clusters read at about the same size). Stricter than breakableArtLayout (which only caps the part above
 * the pivot): a centred pivot puts half the art under the drop's point.
 */
export function boostImageLayout(wPx: number, hPx: number, pivot: Readonly<Pivot>): SpriteLayout {
	const v = BOOST_VIEW;
	const capped = hPx > 0 ? hPx / v.maxHeightTiles : 0;
	return { frameW: wPx, frameH: hPx, pivot, pixelsPerTile: math.max(v.artPixelsPerTile, capped) };
}

/** A layout's drawn size, tiles: [width, height]. */
export function layoutTiles(layout: SpriteLayout): readonly [number, number] {
	return [layout.frameW / layout.pixelsPerTile, layout.frameH / layout.pixelsPerTile];
}

/** `b` scaled about its pivot by `scale` (size and the pivot-to-centre shift; the camera-ward depth stays). */
export function scaleBillboard(b: SpriteBillboard, scale: number): SpriteBillboard {
	return {
		w: b.w * scale,
		h: b.h * scale,
		offsetX: b.offsetX * scale,
		offsetY: b.offsetY * scale,
		offsetZ: b.offsetZ,
	};
}

// ---------------------------------------------------------------------------------------------
// The stack

/**
 * A layer's transparency (`base`, 0 = opaque) under the drop's fade blink (`blink`, boostBlinkTransparency): the
 * opacities multiply, so every layer blinks with the prop and a fully blinked stack is gone.
 */
export function boostLayerTransparency(base: number, blink: number): number {
	const a = (1 - math.clamp(base, 0, 1)) * (1 - math.clamp(blink, 0, 1));
	return 1 - a;
}

/**
 * The halo's own transparency `ageSec` after landing: `base` (haloTransparency, or haloFallbackTransparency for the
 * Neon disc) + haloPulse x the bob's phase (0 on the floor, 1 at the top), so it breathes with the bob; `base` under
 * reduced motion. Within [0, 1].
 */
export function boostHaloTransparency(
	ageSec: number,
	motion: number,
	base: number = BOOST_VIEW.haloTransparency,
): number {
	return math.clamp(base + BOOST_VIEW.haloPulse * dropBobPhase(ageSec, motion), 0, 1);
}

/** The beam's transparency under the blink (beamTransparency, blinked with the stack). */
export function boostBeamTransparency(blink: number): number {
	return boostLayerTransparency(BOOST_VIEW.beamTransparency, blink);
}

// ---------------------------------------------------------------------------------------------
// The glint

/**
 * The glint loop's frame (0..frames-1) `ageSec` after the drop landed in ground slot `slot`: `fps` frames a second,
 * started glintSlotPhaseFrames x slot into the loop (drops never twinkle in step); under reduced motion (or no fps)
 * the still frame glintStillFrame.
 */
export function boostGlintFrame(ageSec: number, fps: number, frames: number, slot: number, motion: number): number {
	const n = math.max(1, math.floor(frames));
	if (!(motion > 0) || !(fps > 0)) return BOOST_VIEW.glintStillFrame % n;
	const phase = math.max(0, math.floor(slot)) * BOOST_VIEW.glintSlotPhaseFrames;
	return decorLoopFrame(math.max(0, ageSec), fps, n, phase);
}

/**
 * The glint's billboard over a prop drawn as `prop` (spriteBillboard of the prop's layout): `glint`'s size x
 * glintScale x `scale`, centred on the prop's centre (its own pivot ignored), glintDepthStuds nearer the camera.
 */
export function boostGlintBillboard(prop: SpriteBillboard, glint: SpriteLayout, scale = 1): SpriteBillboard {
	const s = (STUDS_PER_TILE / glint.pixelsPerTile) * BOOST_VIEW.glintScale * scale;
	return {
		w: glint.frameW * s,
		h: glint.frameH * s,
		offsetX: prop.offsetX,
		offsetY: prop.offsetY,
		offsetZ: prop.offsetZ + BOOST_VIEW.glintDepthStuds,
	};
}

// ---------------------------------------------------------------------------------------------
// The pickup flash (BA-P4)

/** Seconds the glint plays once (`frames` at `fps`); 0 under reduced motion or without fps. */
function glintOnceSec(fps: number, frames: number, motion: number): number {
	return motion > 0 && fps > 0 ? math.max(1, math.floor(frames)) / fps : 0;
}

/** How long a pickup flash lasts: the halo flash, or the glint's one pass when it is longer. */
export function boostPickupSeconds(fps: number, frames: number, motion: number): number {
	return math.max(BOOST_VIEW.pickupFlashSeconds, glintOnceSec(fps, frames, motion));
}

/** 0..1 through the halo flash. */
function flashT(ageSec: number): number {
	return math.clamp(ageSec / BOOST_VIEW.pickupFlashSeconds, 0, 1);
}

/** The halo flash's scale: 1 -> pickupHaloGrow over pickupFlashSeconds (ease-out), x motionScale (1 when still). */
export function boostPickupHaloScale(ageSec: number, motion: number): number {
	if (!(motion > 0)) return 1;
	const t = flashT(ageSec);
	const ease = 1 - (1 - t) * (1 - t);
	return 1 + (BOOST_VIEW.pickupHaloGrow - 1) * motion * ease;
}

/** The halo flash's transparency: pickupHaloFromTransparency -> 1 (gone) over pickupFlashSeconds. */
export function boostPickupHaloTransparency(ageSec: number): number {
	const from = BOOST_VIEW.pickupHaloFromTransparency;
	return from + (1 - from) * flashT(ageSec);
}

/** The pickup glint's frame: frame 0 onward at `fps`, holding the last; glintStillFrame under reduced motion. */
export function boostPickupGlintFrame(ageSec: number, fps: number, frames: number, motion: number): number {
	const n = math.max(1, math.floor(frames));
	if (!(motion > 0) || !(fps > 0)) return BOOST_VIEW.glintStillFrame % n;
	return math.clamp(math.floor(math.max(0, ageSec) * fps), 0, n - 1);
}

/**
 * The pickup glint's transparency: opaque through its one pass, then gone; under reduced motion (a still frame) it
 * fades with the halo flash instead.
 */
export function boostPickupGlintTransparency(ageSec: number, fps: number, frames: number, motion: number): number {
	const once = glintOnceSec(fps, frames, motion);
	if (once > 0) return ageSec < once ? 0 : 1;
	return boostPickupHaloTransparency(ageSec);
}
