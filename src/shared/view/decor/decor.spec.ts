// The decor renderer's pure parts (docs/DECOR.md R3): screen helpers, decorHash, fade selection, glow points.
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessFloor, generateDungeon, type Dungeon, type ForgeParams } from "shared/dungeon";
import type { DecorArt } from "shared/theme";
import {
	DECOR_CAMERA,
	clipConvex,
	convexHull,
	decorGlowOffset,
	decorGlowPoint,
	decorGlowPoints,
	decorHash,
	decorHash01,
	decorInputOfLayout,
	groundAt,
	insideBy,
	planDecor,
	rectOverlapsPolygon,
	screenDepth,
	screenX,
	screenY,
	selectDecorFades,
	type DecorEntry,
} from ".";

describe("decor screen helpers", () => {
	it("projects with the game camera: -X / -Z is farther and higher on screen", () => {
		expect(screenDepth(DECOR_CAMERA, -1, 0, -1) > screenDepth(DECOR_CAMERA, 0, 0, 0)).toBe(true);
		expect(screenY(DECOR_CAMERA, -1, 0, -1) > 0).toBe(true);
		expect(screenX(DECOR_CAMERA, 1, 0, -1) > 0).toBe(true);
		const [x, z] = groundAt(
			DECOR_CAMERA,
			screenX(DECOR_CAMERA, 3, 0.5, -2),
			screenY(DECOR_CAMERA, 3, 0.5, -2),
			0.5,
		);
		expect(x).toBeCloseTo(3, 9);
		expect(z).toBeCloseTo(-2, 9);
	});

	it("hulls counter-clockwise, clips convex polygons and tests rectangles", () => {
		const sq = convexHull([0, 0, 2, 0, 1, 1, 2, 2, 0, 2]);
		expect(sq.size()).toBe(8); // the inner point dropped
		expect(insideBy(sq, 1, 1, 0.5)).toBe(true);
		expect(insideBy(sq, 1, 1.8, 0.5)).toBe(false);
		const tri = [1, 1, 3, 1, 1, 3];
		expect(clipConvex(tri, sq).size() / 2 >= 3).toBe(true);
		expect(clipConvex([5, 5, 6, 5, 6, 6], sq).size()).toBe(0);
		expect(rectOverlapsPolygon(sq, 1.5, 1.5, 3, 3)).toBe(true);
		expect(rectOverlapsPolygon(sq, 2.1, 0, 3, 3)).toBe(false);
		const diamond = convexHull([0, 1, 1, 0, 2, 1, 1, 2]);
		expect(rectOverlapsPolygon(diamond, 1.7, 1.7, 2, 2)).toBe(false); // bounds overlap, an edge separates
	});
});

describe("decorHash", () => {
	it("is a deterministic uint32 that changes with seed, cell and salt", () => {
		const a = decorHash(12345, 678, 9);
		expect(decorHash(12345, 678, 9)).toBe(a);
		expect(a >= 0 && a < 4294967296 && a % 1 === 0).toBe(true);
		expect(decorHash(12346, 678, 9) !== a).toBe(true);
		expect(decorHash(12345, 679, 9) !== a).toBe(true);
		expect(decorHash(12345, 678, 10) !== a).toBe(true);
		let sum = 0;
		for (let i = 0; i < 2000; i++) sum += decorHash01(7, i, 3);
		expect(math.abs(sum / 2000 - 0.5) < 0.05).toBe(true);
	});
});

const dungeons = new Map<string, Dungeon>();
function dungeonFor(params: ForgeParams): Dungeon {
	const key = `${params.seed}/${params.roomCount}`;
	let d = dungeons.get(key);
	if (d === undefined) {
		d = generateDungeon(params);
		dungeons.set(key, d);
	}
	return d;
}

describe("decor fades", () => {
	const plan = planDecor(decorInputOfLayout(buildEndlessFloor(3, 2, dungeonFor)));

	it("fades a piece with a body standing behind it, not one in front of it or far away", () => {
		expect(plan.fadeBoxes.size()).toBeGreaterThan(0);
		const box = plan.fadeBoxes[0];
		const e = plan.entries[box.entry];
		const out: boolean[] = [];
		// behind: two tiles further from the camera (-X -Z), well inside the piece's screen box
		expect(selectDecorFades(plan, [{ x: e.x - 1, z: e.z - 1, radius: 0.3, height: 1.5 }], out)).toBeGreaterThan(0);
		expect(out.size()).toBe(plan.fadeBoxes.size());
		expect(out[0]).toBe(true);
		// in front: toward the camera
		selectDecorFades(plan, [{ x: e.x + 2, z: e.z + 2, radius: 0.3, height: 1.5 }], out);
		expect(out[0]).toBe(false);
		// nobody: nothing fades, and the array is rewritten
		expect(selectDecorFades(plan, [], out)).toBe(0);
		for (const f of out) expect(f).toBe(false);
	});
});

describe("decor glow points", () => {
	const art: DecorArt = {
		id: "decor.delve.b1.torch",
		layer: "wall",
		glow: true,
		glowAt: { x: 55, y: 10 },
		emissive: false,
		art: {
			kind: "image",
			assetId: "test-torch",
			w: 111,
			h: 81,
			rect: { x: 0, y: 0, w: 111, h: 81 },
			pivot: { x: 55, y: 81 },
			pixelsPerTile: 32,
		},
	};

	it("puts the glow on the art's glowAt, in the billboard plane above the anchor", () => {
		const [r, u] = decorGlowOffset(art);
		expect(r).toBeCloseTo(0, 9);
		expect(u).toBeCloseTo(71 / 32, 9);
		const e = { x: 4, y: 0.65, z: 7 } as DecorEntry;
		const p = decorGlowPoint(e, art);
		expect(screenY(DECOR_CAMERA, p[0], p[1], p[2]) - screenY(DECOR_CAMERA, 4, 0.65, 7)).toBeCloseTo(u, 9);
		expect(screenX(DECOR_CAMERA, p[0], p[1], p[2]) - screenX(DECOR_CAMERA, 4, 0.65, 7)).toBeCloseTo(0, 9);
	});

	it("lists glow points of glowing art only, with the entry's room", () => {
		const plan = planDecor(decorInputOfLayout(buildEndlessFloor(5, 5, dungeonFor)));
		const points = decorGlowPoints(plan, (e) => (e.kind === "torch" ? art : undefined));
		const torches = plan.entries.filter((e) => e.kind === "torch").size();
		expect(points.size()).toBe(torches);
		for (const p of points) {
			expect(plan.entries[p.entry].kind).toBe("torch");
			expect(p.roomId).toBe(plan.entries[p.entry].roomId);
		}
		expect(decorGlowPoints(plan, () => ({ ...art, glow: false })).size()).toBe(0);
	});
});
