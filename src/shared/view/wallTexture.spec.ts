import { describe, expect, it } from "@rbxts/jest-globals";
import {
	GAME_WORLD,
	WALL_SIDE_FACES,
	floorTextureOffsets,
	wallTextureOffsets,
	wrapStuds,
	type SideFaceUV,
	type WallTextureUV,
} from "shared/view";

const P = 16;
/** One wall tile tall (GAME_WORLD.wallHeightTiles at 4 studs per tile): a quarter of a 4-tile period. */
const H = 4;

/** Every convention a side face could have. */
function sideMappings(): Array<SideFaceUV> {
	const out = new Array<SideFaceUV>();
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

/** A WallTextureUV with `side` on every side face (the Top face is the configured one). */
function allSides(side: SideFaceUV): WallTextureUV {
	return { top: GAME_WORLD.wallTextureUV.top, sides: { Front: side, Back: side, Left: side, Right: side } };
}

/**
 * The pattern coordinate (mod P) a side face's Texture shows at horizontal world coordinate `a` (along U's axis) and
 * depth `d` below the wall's top: u / v measured from the edges the pattern starts at, then shifted by the offset.
 */
function sidePhaseAt(
	a: number,
	d: number,
	rect: readonly [number, number, number, number],
	side: SideFaceUV,
): readonly [number, number] {
	const [minX, minZ, maxX, maxZ] = rect;
	const [offU, offV] = wallTextureOffsets("Front", minX, minZ, maxX, maxZ, H, P, allSides(side));
	const [aMin, aMax] = side.uAxis === "x" ? [minX, maxX] : [minZ, maxZ];
	const u = side.uSign > 0 ? a - aMin : aMax - a;
	const v = side.vSign > 0 ? d : H - d;
	return [wrapStuds(u + side.offsetSign * offU, P), wrapStuds(v + side.offsetSign * offV, P)];
}

/** Distance between two pattern coordinates on the P-periodic circle. */
const circ = (a: number, b: number) => {
	const w = wrapStuds(a - b, P);
	return math.min(w, P - w);
};

/** Wall Parts as WorldController lays them: tile edges at 4-stud steps around an origin not a multiple of P. */
const RECTS: ReadonlyArray<[number, number, number, number]> = [
	[-2, 62, 10, 66],
	[10, 62, 38, 66],
	[-2, 66, 2, 102],
	[2, 98, 14, 102],
];

describe("wallTextureOffsets", () => {
	it("anchors every side face's pattern to the world, for every side-face convention", () => {
		for (const side of sideMappings()) {
			for (const rect of RECTS) {
				const [minX, minZ, maxX, maxZ] = rect;
				const [aMin, aMax] = side.uAxis === "x" ? [minX, maxX] : [minZ, maxZ];
				for (const a of [aMin, aMax, (aMin + aMax) / 2 + 1]) {
					for (const d of [0, H / 2, H]) {
						const [pu, pv] = sidePhaseAt(a, d, rect, side);
						expect(circ(pu, wrapStuds(side.uSign * a, P))).toBeCloseTo(0, 9);
						// the image's top row (phase 0) lies on the wall's top edge, whichever way V runs
						expect(circ(pv, wrapStuds(side.vSign * d, P))).toBeCloseTo(0, 9);
					}
				}
			}
			// So two wall Parts meeting along a face (at x = 10, a Front / Back face) show the same pattern on the join.
			if (side.uAxis === "x") {
				const left = sidePhaseAt(10, 1, RECTS[0], side);
				const right = sidePhaseAt(10, 1, RECTS[1], side);
				expect(circ(left[0], right[0])).toBeCloseTo(0, 9);
				expect(circ(left[1], right[1])).toBeCloseTo(0, 9);
			}
		}
	});

	it("draws the Top face exactly as a floor slab", () => {
		const uv = GAME_WORLD.wallTextureUV;
		for (const [minX, minZ, maxX, maxZ] of RECTS) {
			expect(wallTextureOffsets("Top", minX, minZ, maxX, maxZ, H, P, uv)).toEqual(
				floorTextureOffsets(minX, minZ, maxX, maxZ, P, GAME_WORLD.floorTextureUV),
			);
		}
	});

	it("is exact for the configured side faces: U from the viewer's left edge mod P, V = 0 at the top edge", () => {
		const uv = GAME_WORLD.wallTextureUV;
		// Back (+X): the min x corner; Front (-X): the negated max x corner; Left (+Z) / Right (-Z) likewise on z.
		expect(wallTextureOffsets("Back", -2, 62, 10, 66, H, P, uv)).toEqual([14, 0]);
		expect(wallTextureOffsets("Front", -2, 62, 10, 66, H, P, uv)).toEqual([6, 0]);
		expect(wallTextureOffsets("Left", -2, 62, 10, 66, H, P, uv)).toEqual([14, 0]);
		expect(wallTextureOffsets("Right", -2, 62, 10, 66, H, P, uv)).toEqual([14, 0]);
		expect(wallTextureOffsets("Right", -2, 66, 2, 102, H, P, uv)).toEqual([10, 0]);
		expect(wallTextureOffsets("Front", 0, 0, 4, 4, H, 0, uv)).toEqual([0, 0]);
	});

	it("configures every side face, opposite faces running opposite ways, V down from the top", () => {
		const sides = GAME_WORLD.wallTextureUV.sides;
		for (const face of WALL_SIDE_FACES) expect(sides[face].vSign).toBe(1);
		expect(sides.Front.uAxis).toBe("x");
		expect(sides.Back.uAxis).toBe("x");
		expect(sides.Left.uAxis).toBe("z");
		expect(sides.Right.uAxis).toBe("z");
		expect(sides.Front.uSign).toBe(-sides.Back.uSign);
		expect(sides.Left.uSign).toBe(-sides.Right.uSign);
	});

	it("textures the Top and four side faces, never the Bottom", () => {
		const faces = GAME_WORLD.wallTextureFaces;
		expect(faces.size()).toBe(1 + WALL_SIDE_FACES.size());
		expect(faces.includes("Top")).toBe(true);
		for (const face of WALL_SIDE_FACES) expect(faces.includes(face)).toBe(true);
	});
});
