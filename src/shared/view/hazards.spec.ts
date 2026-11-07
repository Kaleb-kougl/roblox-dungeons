// The floor hazards' sprite looks (docs/HAZARD_ART.md HA4): the strike flash over its life, the scorch it leaves (only
// when a strike ends or its slot is reused, never on a floor change or a new run; hot then cold; the fade; the cap),
// the ember's loop phase per slot and its fade, and the strike's flat size mapping the art's rim onto the hit radius.
import { describe, expect, it } from "@rbxts/jest-globals";
import { STRIKE_BULLET_RADIUS } from "shared/sim";
import { BUILD_BULLET_VIEW } from "./buildBulletsConfig";
import {
	ScorchTracker,
	emberSpriteLook,
	flatCellPlacement,
	newHazardCellLook,
	scorchLook,
	strikeFlashLook,
	strikeTilesPerPixel,
} from "./hazards";
import { HAZARD_ART_VIEW } from "./hazardsConfig";

const S = HAZARD_ART_VIEW.scorch;
const LIFE = 0.1;

describe("strike flash", () => {
	it("plays its cells over the strike's life and holds the last", () => {
		const out = newHazardCellLook();
		const cells = [0, 0.02, 0.034, 0.05, 0.07, 0.09, 0.1, 0.2].map(
			(age) => strikeFlashLook(LIFE - age, LIFE, 0, 3, out).cell,
		);
		expect(cells).toEqual([0, 0, 1, 1, 2, 2, 2, 2]);
		expect(strikeFlashLook(LIFE, LIFE, 0, 3, out).transparency).toBe(0);
	});

	it("flips by the slot's two low bits: all four looks over slots 0..3", () => {
		const out = newHazardCellLook();
		const looks = [0, 1, 2, 3].map((slot) => {
			strikeFlashLook(LIFE, LIFE, slot, 3, out);
			return [out.flipX, out.flipY];
		});
		expect(looks).toEqual([
			[false, false],
			[true, false],
			[false, true],
			[true, true],
		]);
	});
});

describe("scorch", () => {
	it("hot then cold, startTransparency until its fade, gone at lifeSec", () => {
		const out = newHazardCellLook();
		expect(scorchLook(0, 0, 2, out).cell).toBe(0);
		expect(scorchLook(S.hotSec - 0.01, 0, 2, out).cell).toBe(0);
		expect(scorchLook(S.hotSec, 0, 2, out).cell).toBe(1);
		expect(scorchLook(S.hotSec, 0, 1, out).cell).toBe(0);
		expect(scorchLook(0.1, 0, 2, out).transparency).toBe(S.startTransparency);
		const mid = scorchLook(S.lifeSec - S.fadeSec / 2, 0, 2, out).transparency;
		expect(mid).toBeCloseTo(S.startTransparency + (1 - S.startTransparency) / 2, 6);
		expect(scorchLook(S.lifeSec, 0, 2, out).transparency).toBe(1);
		expect(scorchLook(S.lifeSec + 1, 0, 2, out).transparency).toBe(1);
	});

	it("takes its flips from the seed shifted (not its flash's)", () => {
		const out = newHazardCellLook();
		scorchLook(0, 1, 2, out);
		expect([out.flipX, out.flipY]).toEqual([false, false]);
		scorchLook(0, 2, 2, out);
		expect([out.flipX, out.flipY]).toEqual([true, false]);
		scorchLook(0, 4, 2, out);
		expect([out.flipX, out.flipY]).toEqual([false, true]);
	});
});

describe("ScorchTracker", () => {
	/** One frame: strikes as [slot, x, z]. */
	function frame(t: ScorchTracker, floor: number, now: number, strikes: Array<[number, number, number]>): void {
		t.begin(floor, now);
		for (const [slot, x, z] of strikes) t.seen(slot, x, z);
		t.finish(now);
	}
	const livePlaces = (t: ScorchTracker, now: number) => {
		const out = new Array<[number, number, number]>();
		for (let k = 0; k < t.capacity; k++) if (t.live(k, now)) out.push([t.seed[k], t.x[k], t.z[k]]);
		return out;
	};

	it("leaves a scorch where a strike was once it is gone, seeded by its slot", () => {
		const t = new ScorchTracker();
		frame(t, 1, 0, [[3, 5, 6]]);
		frame(t, 1, 0.016, [[3, 5, 6]]);
		expect(t.liveCount(0.016)).toBe(0);
		frame(t, 1, 0.033, []);
		expect(livePlaces(t, 0.033)).toEqual([[3, 5, 6]]);
		expect(t.start.filter((_, k) => t.active[k])).toEqual([0.033]);
		// it expires after lifeSec
		frame(t, 1, 0.033 + S.lifeSec, []);
		expect(t.liveCount(0.033 + S.lifeSec)).toBe(0);
	});

	it("a slot reused at another spot between two frames leaves the old strike's scorch", () => {
		const t = new ScorchTracker();
		frame(t, 1, 0, [[0, 1, 1]]);
		frame(t, 1, 0.016, [[0, 9, 9]]);
		expect(livePlaces(t, 0.016)).toEqual([[0, 1, 1]]);
	});

	it("a floor change or a reset drops scorches and leaves none for the cleared strikes", () => {
		const t = new ScorchTracker();
		frame(t, 1, 0, [[0, 1, 1]]);
		frame(t, 1, 0.016, [[1, 2, 2]]); // slot 0 ended: a scorch
		expect(t.liveCount(0.016)).toBe(1);
		frame(t, 2, 0.033, []); // the floor changed: slot 1 cleared with the floor, no scorch, the old one dropped
		expect(t.liveCount(0.033)).toBe(0);
		frame(t, 2, 0.05, [[4, 3, 3]]);
		t.reset();
		frame(t, 2, 0.066, []);
		expect(t.liveCount(0.066)).toBe(0);
	});

	it("a full ring reuses its oldest scorch", () => {
		const t = new ScorchTracker(2);
		frame(t, 1, 0, [
			[0, 1, 0],
			[1, 2, 0],
			[2, 3, 0],
		]);
		frame(t, 1, 0.01, [
			[1, 2, 0],
			[2, 3, 0],
		]); // slot 0 ends
		frame(t, 1, 0.02, [[2, 3, 0]]); // slot 1 ends
		frame(t, 1, 0.03, []); // slot 2 ends: replaces slot 0's (the oldest)
		expect(
			livePlaces(t, 0.03)
				.map(([seed]) => seed)
				.sort(),
		).toEqual([1, 2]);
	});
});

describe("ember burn", () => {
	it("loops at its fps, offset per slot, held on the offset without motion; mirrored by slot bit 0", () => {
		const out = newHazardCellLook();
		const cells = [0, 1 / 12, 2 / 12, 5 / 12, 6 / 12].map((t) => emberSpriteLook(1, 0, t, 6, 12, true, out).cell);
		expect(cells).toEqual([0, 1, 2, 5, 0]);
		expect(emberSpriteLook(1, 1, 0, 6, 12, true, out).cell).toBe(HAZARD_ART_VIEW.ember.phaseStep % 6);
		expect(emberSpriteLook(1, 1, 3.3, 6, 12, false, out).cell).toBe(HAZARD_ART_VIEW.ember.phaseStep % 6);
		expect([
			emberSpriteLook(1, 0, 0, 6, 12, true, out).flipX,
			emberSpriteLook(1, 1, 0, 6, 12, true, out).flipX,
		]).toEqual([false, true]);
		expect(out.flipY).toBe(false);
	});

	it("fades like the disc over its last fadeSec", () => {
		const out = newHazardCellLook();
		const fade = BUILD_BULLET_VIEW.ember.fadeSec;
		expect(emberSpriteLook(1, 0, 0, 6, 12, true, out).transparency).toBe(0);
		expect(emberSpriteLook(fade / 2, 0, 0, 6, 12, true, out).transparency).toBeCloseTo(0.5, 6);
		expect(emberSpriteLook(0, 0, 0, 6, 12, true, out).transparency).toBe(1);
	});
});

describe("strike size", () => {
	it("maps the art's rim exactly onto the hit radius; the centred pivot needs no offset, flipped or not", () => {
		const s = strikeTilesPerPixel(33);
		expect(33 * s).toBeCloseTo(STRIKE_BULLET_RADIUS, 12);
		const p = flatCellPlacement(77, 77, 38.5, 38.5, s, true, true);
		expect(p.widthTiles).toBeCloseTo(77 * s, 12);
		expect(p.depthTiles).toBeCloseTo(77 * s, 12);
		expect([math.abs(p.rightTiles) < 1e-12, math.abs(p.downTiles) < 1e-12]).toEqual([true, true]);
		const q = flatCellPlacement(10, 20, 2, 5, 0.5, false, false);
		expect([q.rightTiles, q.downTiles]).toEqual([1.5, 2.5]);
		const r = flatCellPlacement(10, 20, 2, 5, 0.5, true, true);
		expect([r.rightTiles, r.downTiles]).toEqual([-1.5, -2.5]);
		expect(strikeTilesPerPixel(0)).toBe(0);
	});
});
