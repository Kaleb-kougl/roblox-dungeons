// Boost drop art layers (docs/BOOST_ART.md BA3): the prop's size at the Lords of Pain scale under the height cap, the
// halo's place in the floor's draw order and its pulse, the beam under half the pedestal's, the stack's blink, the
// glint's per-slot phase and reduced-motion still, and the pickup flash's curve.
import { describe, expect, it } from "@rbxts/jest-globals";
import { STUDS_PER_TILE } from "shared/config";
import { BULLET_Y, SIM_HZ } from "shared/sim";
import { BULLET_VIEW, DECOR_VIEW, MARKING_VIEW, spriteBillboard, type SpriteLayout } from "shared/view";
import { FX_SPRITE_VIEW } from "shared/view/fx";
import { PROGRESSION_VIEW } from "shared/view/hud";
import {
	BOOST_VIEW,
	boostBeamTransparency,
	boostBlinkTransparency,
	boostGlintBillboard,
	boostGlintFrame,
	boostHaloTransparency,
	boostImageLayout,
	boostLayerTransparency,
	boostPickupGlintFrame,
	boostPickupGlintTransparency,
	boostPickupHaloScale,
	boostPickupHaloTransparency,
	boostPickupSeconds,
	dropBobPhase,
	dropBobStuds,
	layoutTiles,
	scaleBillboard,
} from ".";

const V = BOOST_VIEW;
const MOTION = 1;
const STILL = 0;
/** The vale glint (packs/vale/layout.ts `glint`): 26 x 21 cells, 8 frames at 12 fps, 29.6 px per tile. */
const GLINT: SpriteLayout = { frameW: 26, frameH: 21, pivot: { x: 13, y: 11 }, pixelsPerTile: 29.6 };
const GLINT_FRAMES = 8;
const GLINT_FPS = 12;
/** The vale boost images (packs/vale/layout.ts): a gem cluster and the coin scatter, centre pivots. */
const GEM = { w: 17, h: 15 };
const COINS = { w: 31, h: 25 };
const centre = (w: number, h: number) => ({ x: w / 2, y: h / 2 });
const HALF_BOB = 1 / (2 * V.bobHz);

describe("boost art: the prop", () => {
	it("draws a gem cluster at the Lords of Pain scale (~0.57 tiles wide)", () => {
		const [w, h] = layoutTiles(boostImageLayout(GEM.w, GEM.h, centre(GEM.w, GEM.h)));
		expect(w).toBeCloseTo(GEM.w / V.artPixelsPerTile, 6);
		expect(w).toBeCloseTo(0.574, 2);
		expect(h <= V.maxHeightTiles).toBe(true);
	});

	it("scales the coins down so the whole image is no taller than maxHeightTiles (aspect kept)", () => {
		const layout = boostImageLayout(COINS.w, COINS.h, centre(COINS.w, COINS.h));
		const [w, h] = layoutTiles(layout);
		expect(COINS.h / V.artPixelsPerTile > V.maxHeightTiles).toBe(true);
		expect(h).toBeCloseTo(V.maxHeightTiles, 9);
		expect(w / h).toBeCloseTo(COINS.w / COINS.h, 9);
	});

	it("uses the art's own pixelsPerTile when given (> 0), else the fallback", () => {
		const own = boostImageLayout(GEM.w, GEM.h, centre(GEM.w, GEM.h), 40);
		expect(own.pixelsPerTile).toBe(40);
		const bad = boostImageLayout(GEM.w, GEM.h, centre(GEM.w, GEM.h), 0);
		expect(bad.pixelsPerTile).toBe(V.artPixelsPerTile);
	});

	it("keeps the pivot and never draws art larger than the Lords of Pain scale", () => {
		for (const [ww, hh] of [
			[4, 4],
			[17, 14],
			[64, 64],
			[8, 200],
		]) {
			const layout = boostImageLayout(ww, hh, centre(ww, hh));
			expect(layout.pivot).toEqual(centre(ww, hh));
			expect(layout.pixelsPerTile >= V.artPixelsPerTile).toBe(true);
			expect(layoutTiles(layout)[1] <= V.maxHeightTiles + 1e-9).toBe(true);
		}
	});

	it("scales a billboard about its pivot, keeping its depth", () => {
		const b = { w: 2, h: 1, offsetX: 0.5, offsetY: -0.25, offsetZ: 1.5 };
		expect(scaleBillboard(b, 0.5)).toEqual({ w: 1, h: 0.5, offsetX: 0.25, offsetY: -0.125, offsetZ: 1.5 });
		expect(scaleBillboard(b, 1)).toEqual(b);
	});
});

describe("boost art: readability", () => {
	it("keeps the beam under half the relic pedestal's, so a relic still reads as the bigger prize", () => {
		expect(V.beamHeightTiles > 0).toBe(true);
		expect(V.beamHeightTiles < PROGRESSION_VIEW.pedestalBeamHeightTiles / 2).toBe(true);
	});

	it("lays the halo over the decor flats and floor effects, under every marking and bullet", () => {
		const top = V.haloLiftStuds;
		expect(top - V.haloThicknessStuds > 0).toBe(true);
		expect(top > DECOR_VIEW.flatLiftStuds * 2).toBe(true);
		expect(top > FX_SPRITE_VIEW.liftStuds + FX_SPRITE_VIEW.layers * FX_SPRITE_VIEW.layerStepStuds).toBe(true);
		expect(top < MARKING_VIEW.liftTiles * STUDS_PER_TILE).toBe(true);
		expect(top / STUDS_PER_TILE < BULLET_Y - BULLET_VIEW.enemyDrawRadius).toBe(true);
	});

	it("draws the halo about a tile across and translucent", () => {
		expect(V.haloTiles > 1 && V.haloTiles < 2).toBe(true);
		for (const base of [V.haloTransparency, V.haloFallbackTransparency]) {
			expect(base > 0 && base + V.haloPulse < 1).toBe(true);
		}
	});
});

describe("boost art: the stack blinks together", () => {
	it("multiplies a layer's opacity by the blink's", () => {
		expect(boostLayerTransparency(0, 0)).toBe(0);
		expect(boostLayerTransparency(0.4, 0)).toBeCloseTo(0.4, 12);
		expect(boostLayerTransparency(0, 0.75)).toBeCloseTo(0.75, 12);
		expect(boostLayerTransparency(0.5, 0.5)).toBeCloseTo(0.75, 12);
		expect(boostLayerTransparency(0.3, 1)).toBe(1);
		expect(boostLayerTransparency(1, 0)).toBe(1);
	});

	it("blinks the beam with the prop and holds it at beamTransparency otherwise", () => {
		expect(boostBeamTransparency(0)).toBeCloseTo(V.beamTransparency, 12);
		const inBlink = boostBlinkTransparency(V.blinkPeriodSec * 7.5, MOTION);
		expect(inBlink).toBe(V.blinkTransparency);
		expect(boostBeamTransparency(inBlink) > V.beamTransparency).toBe(true);
		// reduced motion: a steady dim, no flashing
		const still = boostBlinkTransparency(V.blinkSeconds / 2, STILL);
		expect(boostBeamTransparency(still)).toBeCloseTo(boostLayerTransparency(V.beamTransparency, still), 12);
	});
});

describe("boost art: the halo's pulse", () => {
	it("breathes in phase with the bob: base on the floor, base + haloPulse at the top", () => {
		expect(boostHaloTransparency(0, MOTION)).toBe(V.haloTransparency);
		expect(boostHaloTransparency(HALF_BOB, MOTION)).toBeCloseTo(V.haloTransparency + V.haloPulse, 9);
		for (const t of [0.1, 0.37, 0.9, 2.2]) {
			const phase = dropBobPhase(t, MOTION);
			expect(dropBobStuds(t, MOTION)).toBeCloseTo(V.bobStuds * phase, 12);
			expect(boostHaloTransparency(t, MOTION)).toBeCloseTo(V.haloTransparency + V.haloPulse * phase, 12);
		}
	});

	it("does not pulse under reduced motion, and takes the fallback disc's base", () => {
		for (const t of [0, 0.3, HALF_BOB, 5]) {
			expect(boostHaloTransparency(t, STILL)).toBe(V.haloTransparency);
			expect(boostHaloTransparency(t, STILL, V.haloFallbackTransparency)).toBe(V.haloFallbackTransparency);
		}
	});
});

describe("boost art: the glint", () => {
	it("loops at its fps, each slot glintSlotPhaseFrames further on", () => {
		for (let slot = 0; slot < 4; slot++) {
			for (const t of [0, 0.05, 0.4, 1.3, 7]) {
				const f = boostGlintFrame(t, GLINT_FPS, GLINT_FRAMES, slot, MOTION);
				expect(f >= 0 && f < GLINT_FRAMES).toBe(true);
				const expected = (math.floor(t * GLINT_FPS) + slot * V.glintSlotPhaseFrames) % GLINT_FRAMES;
				expect(f).toBe(expected);
			}
		}
		const atZero = [0, 1, 2, 3].map((slot) => boostGlintFrame(0, GLINT_FPS, GLINT_FRAMES, slot, MOTION));
		expect(new Set(atZero).size()).toBe(atZero.size());
	});

	it("holds one frame under reduced motion (and for still art)", () => {
		for (const t of [0, 0.3, 4]) {
			for (let slot = 0; slot < 4; slot++) {
				expect(boostGlintFrame(t, GLINT_FPS, GLINT_FRAMES, slot, STILL)).toBe(V.glintStillFrame);
			}
		}
		expect(boostGlintFrame(1, 0, GLINT_FRAMES, 2, MOTION)).toBe(V.glintStillFrame);
		expect(boostGlintFrame(1, GLINT_FPS, 1, 2, MOTION)).toBe(0);
		expect(V.glintStillFrame < GLINT_FRAMES).toBe(true);
	});

	it("centres on the prop's centre, in front of it, glintScale x its own size", () => {
		const prop = spriteBillboard(boostImageLayout(GEM.w, GEM.h, centre(GEM.w, GEM.h)));
		const g = boostGlintBillboard(prop, GLINT);
		const s = (STUDS_PER_TILE / GLINT.pixelsPerTile) * V.glintScale;
		expect(g.w).toBeCloseTo(GLINT.frameW * s, 9);
		expect(g.h).toBeCloseTo(GLINT.frameH * s, 9);
		expect(g.offsetX).toBe(prop.offsetX);
		expect(g.offsetY).toBe(prop.offsetY);
		expect(g.offsetZ).toBeCloseTo(prop.offsetZ + V.glintDepthStuds, 12);
		const big = boostGlintBillboard(prop, GLINT, V.pickupGlintScale);
		expect(big.w).toBeCloseTo(g.w * V.pickupGlintScale, 9);
	});
});

describe("boost art: the pickup flash", () => {
	const once = GLINT_FRAMES / GLINT_FPS;

	it("lasts the glint's one pass (or the halo flash when that is longer)", () => {
		expect(boostPickupSeconds(GLINT_FPS, GLINT_FRAMES, MOTION)).toBeCloseTo(
			math.max(once, V.pickupFlashSeconds),
			12,
		);
		expect(boostPickupSeconds(GLINT_FPS, GLINT_FRAMES, STILL)).toBe(V.pickupFlashSeconds);
		expect(boostPickupSeconds(0, 1, MOTION)).toBe(V.pickupFlashSeconds);
	});

	it("grows and fades the halo over pickupFlashSeconds (no growth under reduced motion)", () => {
		expect(boostPickupHaloScale(0, MOTION)).toBe(1);
		expect(boostPickupHaloScale(V.pickupFlashSeconds, MOTION)).toBeCloseTo(V.pickupHaloGrow, 12);
		expect(boostPickupHaloScale(V.pickupFlashSeconds / 2, MOTION) > 1).toBe(true);
		expect(boostPickupHaloScale(V.pickupFlashSeconds / 2, STILL)).toBe(1);
		expect(boostPickupHaloTransparency(0)).toBe(V.pickupHaloFromTransparency);
		expect(boostPickupHaloTransparency(V.pickupFlashSeconds)).toBe(1);
		expect(boostPickupHaloTransparency(V.pickupFlashSeconds * 3)).toBe(1);
		let last = -1;
		for (let tick = 0; tick <= SIM_HZ; tick++) {
			const t = boostPickupHaloTransparency(tick / SIM_HZ);
			expect(t >= last).toBe(true);
			last = t;
		}
	});

	it("plays the glint once from frame 0, then hides it", () => {
		let last = -1;
		for (let tick = 0; tick < SIM_HZ; tick++) {
			const age = tick / SIM_HZ;
			const f = boostPickupGlintFrame(age, GLINT_FPS, GLINT_FRAMES, MOTION);
			expect(f >= last && f < GLINT_FRAMES).toBe(true);
			last = f;
			expect(boostPickupGlintTransparency(age, GLINT_FPS, GLINT_FRAMES, MOTION)).toBe(age < once ? 0 : 1);
		}
		expect(boostPickupGlintFrame(0, GLINT_FPS, GLINT_FRAMES, MOTION)).toBe(0);
		expect(last).toBe(GLINT_FRAMES - 1);
	});

	it("holds the still frame and fades it with the halo under reduced motion", () => {
		for (const age of [0, 0.1, 0.3, 1]) {
			expect(boostPickupGlintFrame(age, GLINT_FPS, GLINT_FRAMES, STILL)).toBe(V.glintStillFrame);
			expect(boostPickupGlintTransparency(age, GLINT_FPS, GLINT_FRAMES, STILL)).toBe(
				boostPickupHaloTransparency(age),
			);
		}
	});
});
