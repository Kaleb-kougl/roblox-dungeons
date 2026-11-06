// Boost aura art on screen (docs/BOOST_ART.md BAD3): the frame on the pulse's sim-time clock (reduced motion holds
// one), each rank's ring drawn exactly on its disc's radius (the generated vale layout's ring px pinned against
// BOOST_VIEW), the flat placement, the transparency (the art's base plus the discs' pulse) and the readability caps.
import { describe, expect, it } from "@rbxts/jest-globals";
import { STUDS_PER_TILE } from "shared/config";
import { BOOST_KINDS, FX_SPRITE_MAX_TILES, boostAuraFxId } from "shared/theme";
import { VALE_BOOST_AURA_LAYOUTS } from "shared/theme/packs/vale";
import {
	BOOST_VIEW,
	auraArtFrame,
	auraArtPlacement,
	auraArtStudsPerPixel,
	auraArtTransparency,
	auraDisc,
	auraTopStuds,
	auraTransparency,
} from "shared/view/boosts";

const EPS = 1e-9;

describe("boost auras: the frame", () => {
	it("plays floor(simSec x fps) mod frames on sim time; the same second gives every client the same frame", () => {
		expect(auraArtFrame(0, 10, 8, 1)).toBe(0);
		expect(auraArtFrame(0.099, 10, 8, 1)).toBe(0);
		expect(auraArtFrame(0.1, 10, 8, 1)).toBe(1);
		expect(auraArtFrame(0.75, 10, 8, 1)).toBe(7);
		expect(auraArtFrame(0.8, 10, 8, 1)).toBe(0);
		expect(auraArtFrame(12.34, 10, 8, 1)).toBe(123 % 8);
		expect(auraArtFrame(12.34, 10, 8, 1)).toBe(auraArtFrame(12.34, 10, 8, 1));
	});

	it("holds auraArtStillFrame under reduced motion (motionScale 0), wrapped into the loop", () => {
		for (const t of [0, 0.37, 5, 99.9]) expect(auraArtFrame(t, 10, 8, 0)).toBe(BOOST_VIEW.auraArtStillFrame % 8);
		expect(auraArtFrame(3, 10, 1, 1)).toBe(0);
	});
});

describe("boost auras: the size", () => {
	it("the vale layout: every kind draws every stack rank, its ring within 0.5 px of the disc's radius at the art's density", () => {
		for (const kind of BOOST_KINDS) {
			const id = boostAuraFxId(kind);
			const l = VALE_BOOST_AURA_LAYOUTS[id];
			expect([id, l !== undefined]).toEqual([id, true]);
			expect([id, l.ringPx.size()]).toEqual([id, BOOST_KINDS.size()]);
			for (let r = 0; r < l.ringPx.size(); r++) {
				const want = (BOOST_VIEW.auraRadiusTiles + r * BOOST_VIEW.auraRingStepTiles) * l.pixelsPerTile;
				expect([id, r, math.abs(l.ringPx[r] - want) <= 0.5]).toEqual([id, r, true]);
			}
			// the pivot is the cell's centre (the ring's centre at every rank)
			expect([id, l.pivot.x, l.pivot.y]).toEqual([id, l.frameW / 2, l.frameH / 2]);
		}
	});

	it("maps each rank's ring exactly onto auraDisc(rank, count).radiusTiles, and every drawn cell stays within the fx cap", () => {
		for (const kind of BOOST_KINDS) {
			const l = VALE_BOOST_AURA_LAYOUTS[boostAuraFxId(kind)];
			for (let count = 1; count <= BOOST_KINDS.size(); count++) {
				for (let r = 0; r < count; r++) {
					const d = auraDisc(r, count);
					const spp = auraArtStudsPerPixel(d.radiusTiles, l.ringPx[r]);
					expect(math.abs(l.ringPx[r] * spp - d.radiusTiles * STUDS_PER_TILE) < EPS).toBe(true);
					const p = auraArtPlacement(l.frameW, l.frameH, l.pivot.x, l.pivot.y, spp);
					expect(p.widthStuds / STUDS_PER_TILE <= FX_SPRITE_MAX_TILES).toBe(true);
					expect([p.rightStuds, p.downStuds]).toEqual([0, 0]);
				}
			}
		}
	});

	it("placement: the cell at studsPerPixel, its centre's offset from an off-centre pivot", () => {
		const p = auraArtPlacement(10, 8, 4, 3, 0.5);
		expect([p.widthStuds, p.depthStuds, p.rightStuds, p.downStuds]).toEqual([5, 4, 0.5, 0.5]);
	});

	it("the sprite's top is the disc's top, so the stack keeps its lifts and stays under auraMaxHeightTiles", () => {
		const cap = BOOST_VIEW.auraMaxHeightTiles * STUDS_PER_TILE;
		for (let n = 1; n <= BOOST_KINDS.size(); n++) {
			for (let r = 0; r < n; r++) {
				const top = auraDisc(r, n).liftStuds + BOOST_VIEW.auraThicknessStuds / 2;
				expect(top <= auraTopStuds(n) + EPS && top <= cap + EPS).toBe(true);
			}
			// inner ranks are higher (drawn on top), as with the discs
			for (let r = 1; r < n; r++) expect(auraDisc(r - 1, n).liftStuds >= auraDisc(r, n).liftStuds).toBe(true);
		}
	});
});

describe("boost auras: transparency", () => {
	it("auraArtTransparency plus the discs' pulse; steady under reduced motion; more opaque than the filled disc", () => {
		const v = BOOST_VIEW;
		expect(auraArtTransparency(1.234, 0)).toBe(v.auraArtTransparency);
		expect(v.auraArtTransparency < v.auraTransparency).toBe(true);
		for (let t = 0; t < 2; t += 0.05) {
			const a = auraArtTransparency(t, 1);
			expect(a >= math.max(0, v.auraArtTransparency - v.auraPulseAmplitude) - EPS).toBe(true);
			expect(a <= v.auraArtTransparency + v.auraPulseAmplitude + EPS).toBe(true);
			// in step with the discs (one pulse for the whole stack)
			expect(math.abs(a - v.auraArtTransparency - (auraTransparency(t, 1) - v.auraTransparency)) < EPS).toBe(
				true,
			);
		}
	});
});
