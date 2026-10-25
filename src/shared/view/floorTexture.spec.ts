import { describe, expect, it } from "@rbxts/jest-globals";
import { GAME_WORLD, floorTextureOffsets, wrapStuds, type TopFaceUV } from "shared/view";

const P = 16;

/** Every convention a Top face could have. */
function mappings(): Array<TopFaceUV> {
	const out = new Array<TopFaceUV>();
	for (const uAxis of ["x", "z"] as const) {
		for (const uSign of [1, -1] as const) {
			for (const vSign of [1, -1] as const) {
				for (const offsetSign of [1, -1] as const) {
					out.push({ uAxis, uSign, vSign, offsetSign });
				}
			}
		}
	}
	return out;
}

/**
 * The pattern coordinate (mod P) a slab's Texture shows at world point (x, z) under `uv`: u is measured from the
 * corner the pattern starts at, then shifted by the offset.
 */
function phaseAt(
	x: number,
	z: number,
	rect: readonly [number, number, number, number],
	uv: TopFaceUV,
): readonly [number, number] {
	const [minX, minZ, maxX, maxZ] = rect;
	const [offU, offV] = floorTextureOffsets(minX, minZ, maxX, maxZ, P, uv);
	const [a, aMin, aMax, b, bMin, bMax] =
		uv.uAxis === "x" ? [x, minX, maxX, z, minZ, maxZ] : [z, minZ, maxZ, x, minX, maxX];
	const u = uv.uSign > 0 ? a - aMin : aMax - a;
	const v = uv.vSign > 0 ? b - bMin : bMax - b;
	return [wrapStuds(u + uv.offsetSign * offU, P), wrapStuds(v + uv.offsetSign * offV, P)];
}

/** Distance between two pattern coordinates on the P-periodic circle. */
const circ = (a: number, b: number) => {
	const d = wrapStuds(a - b, P);
	return math.min(d, P - d);
};

describe("floorTextureOffsets", () => {
	it("wraps into [0, period)", () => {
		expect(wrapStuds(0, P)).toBe(0);
		expect(wrapStuds(17, P)).toBe(1);
		expect(wrapStuds(-1, P)).toBe(15);
		expect(wrapStuds(-16, P)).toBe(0);
	});

	it("anchors every slab's pattern to the world, for every Top-face convention", () => {
		// Slabs as WorldController lays them: tile edges at 4-stud steps around an origin that is not a multiple of P.
		const rects: Array<[number, number, number, number]> = [
			[-2, 62, 10, 70],
			[10, 62, 38, 70],
			[-2, 70, 6, 102],
			[6, 70, 14, 74],
		];
		for (const uv of mappings()) {
			for (const rect of rects) {
				const [minX, minZ, maxX, maxZ] = rect;
				for (const [x, z] of [
					[minX, minZ],
					[maxX, maxZ],
					[(minX + maxX) / 2, minZ + 1],
				]) {
					const [pu, pv] = phaseAt(x, z, rect, uv);
					const [a, b] = uv.uAxis === "x" ? [x, z] : [z, x];
					expect(circ(pu, wrapStuds(uv.uSign * a, P))).toBeCloseTo(0, 9);
					expect(circ(pv, wrapStuds(uv.vSign * b, P))).toBeCloseTo(0, 9);
				}
			}
			// So two slabs meeting at x = 10 show the same pattern on the join.
			const left = phaseAt(10, 66, rects[0], uv);
			const right = phaseAt(10, 66, rects[1], uv);
			expect(circ(left[0], right[0])).toBeCloseTo(0, 9);
			expect(circ(left[1], right[1])).toBeCloseTo(0, 9);
		}
	});

	it("is exact for the assumed convention (U = +X, V = +Z, offset added): the min corner mod P", () => {
		expect(GAME_WORLD.floorTextureUV).toEqual({ uAxis: "x", uSign: 1, vSign: 1, offsetSign: 1 });
		expect(floorTextureOffsets(-2, 62, 10, 70, P, GAME_WORLD.floorTextureUV)).toEqual([14, 14]);
		expect(floorTextureOffsets(10, 62, 38, 70, P, GAME_WORLD.floorTextureUV)).toEqual([10, 14]);
		expect(floorTextureOffsets(0, 0, 4, 4, 0, GAME_WORLD.floorTextureUV)).toEqual([0, 0]);
	});
});
