// The decor renderer's pure parts (docs/DECOR.md R3): screen helpers, decorHash, fade selection, glow points, and the
// drawn layouts held inside the footprint rule's boxes.
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessFloor, generateDungeon, type Dungeon, type ForgeParams } from "shared/dungeon";
import type { DecorArt } from "shared/theme";
import {
	DECOR_BOX,
	DECOR_CAMERA,
	DECOR_FX,
	DECOR_REACT,
	clipConvex,
	convexHull,
	decorFlameMaxGrow,
	decorFxLayout,
	decorPieceLayout,
	fitArtLayout,
	decorGlowOffset,
	decorGlowPoint,
	decorGlowPoints,
	decorHash,
	decorHash01,
	decorInputOfLayout,
	groundAt,
	insideBy,
	planDecor,
	rectFitScale,
	rectOverlapsPolygon,
	screenDepth,
	screenX,
	screenY,
	selectDecorFades,
	type DecorEntry,
	type DecorPlan,
	type ScreenPolygon,
	type StandingKind,
} from ".";
import type { SpriteLayout } from "shared/view";
import { floorAxes } from "shared/view/hud";

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

	it("fits a rectangle around a point inside a convex polygon", () => {
		const sq = convexHull([0, 0, 2, 0, 2, 2, 0, 2]);
		// bottom centre, nothing below: fits whole, or scaled to the top edge
		expect(rectFitScale(sq, 1, 0, 1, 1, 0, 2)).toBe(1);
		expect(rectFitScale(sq, 1, 0, 1, 1, 0, 4)).toBe(0.5);
		expect(rectFitScale(sq, 1, 0, 4, 1, 0, 1)).toBe(0.25);
		// on the bottom edge, any reach below leaves no room; outside: none
		expect(rectFitScale(sq, 1, 0, 1, 1, 0.1, 1)).toBe(0);
		expect(rectFitScale(sq, 3, 1, 0.1, 0.1, 0.1, 0.1)).toBe(0);
		// a diamond: the corners bind, not the bounds
		expect(rectFitScale(diamondOf(), 1, 1, 1, 1, 1, 1)).toBeCloseTo(0.5, 12);
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

function diamondOf(): number[] {
	return convexHull([0, 1, 1, 0, 2, 1, 1, 2]);
}

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

	it("fades a piece standing on or in front of a floor card, not one behind the card or far away", () => {
		const box = plan.fadeBoxes[0];
		const e = plan.entries[box.entry];
		const axes = floorAxes();
		const card = (x: number, z: number) => ({
			x,
			z,
			rightX: axes.rightX,
			rightZ: axes.rightZ,
			halfWidth: 2.5,
			halfDepth: 1.2,
		});
		const out: boolean[] = [];
		// the card under the piece: its far half lies behind the piece's plane, under its art
		selectDecorFades(plan, [], out, [card(e.x, e.z)]);
		expect(out[0]).toBe(true);
		// the card behind the piece (farther from the camera)
		selectDecorFades(plan, [], out, [card(e.x - 1.5, e.z - 1.5)]);
		expect(out[0]).toBe(true);
		// the card well in front of the piece: drawn below its art on screen
		selectDecorFades(plan, [], out, [card(e.x + 4, e.z + 4)]);
		expect(out[0]).toBe(false);
		// far away, or no cards: nothing for it
		selectDecorFades(plan, [], out, [card(e.x + 40, e.z - 40)]);
		expect(out[0]).toBe(false);
		selectDecorFades(plan, [], out, []);
		expect(out[0]).toBe(false);
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

/** True when `layout` drawn at `grow` with its pivot on screen (x, y) lies inside `poly` (a float hair of slack). */
function drawnInside(poly: ScreenPolygon, x: number, y: number, layout: SpriteLayout, grow: number): boolean {
	const s = grow / layout.pixelsPerTile;
	const x0 = x - layout.pivot.x * s;
	const x1 = x + (layout.frameW - layout.pivot.x) * s;
	const y0 = y - (layout.frameH - layout.pivot.y) * s;
	const y1 = y + layout.pivot.y * s;
	const slack = -1e-9;
	return (
		insideBy(poly, x0, y0, slack) &&
		insideBy(poly, x1, y0, slack) &&
		insideBy(poly, x0, y1, slack) &&
		insideBy(poly, x1, y1, slack)
	);
}

describe("decor art held to DECOR_BOX", () => {
	// Oversized art: 4 tiles wide, 8 tall at its own scale, a baked shadow hanging 8 px under the pivot.
	const huge: SpriteLayout = { frameW: 64, frameH: 128, pivot: { x: 32, y: 120 }, pixelsPerTile: 16 };
	// Small art standing on its bottom centre: fits every box as drawn.
	const small: SpriteLayout = { frameW: 4, frameH: 6, pivot: { x: 2, y: 6 }, pixelsPerTile: 16 };
	const plans: DecorPlan[] = [];
	for (const [runSeed, floor] of [
		[1, 2],
		[3, 2],
		[5, 5],
		[7, 11],
		[12, 3],
	])
		plans.push(planDecor(decorInputOfLayout(buildEndlessFloor(runSeed, floor, dungeonFor))));

	it("keeps art that already fits, and scales / lifts art that does not", () => {
		const box = convexHull([-1, 0, 1, 0, 1, 2, -1, 2]);
		expect(fitArtLayout(small, box, 0, 0)).toBe(small);
		const fit = fitArtLayout(huge, box, 0, 0)!;
		expect(fit.pivot.y).toBe(huge.frameH); // lifted: nothing may hang under the pivot
		expect(fit.pivot.x).toBe(huge.pivot.x);
		expect(fit.frameW).toBe(huge.frameW);
		expect(fit.pixelsPerTile).toBeCloseTo(64, 9); // 128 px into 2 tiles
		expect(drawnInside(box, 0, 0, fit, 1)).toBe(true);
		// room below the pivot: the authored pivot is kept and the art only scaled
		const roomy = convexHull([-1, -1, 1, -1, 1, 2, -1, 2]);
		const kept = fitArtLayout(huge, roomy, 0, 0)!;
		expect(kept.pivot).toBe(huge.pivot);
		expect(drawnInside(roomy, 0, 0, kept, 1)).toBe(true);
		expect(fitArtLayout(huge, box, 5, 5)).toBeUndefined(); // the pivot outside the box
	});

	it("holds only the outline when the art gives one: a diagonal fits a slanted box its rectangle cannot", () => {
		// a band rising at 45 degrees round the line y = x .. x + 1 (tiles), with a quarter tile to spare
		const band = convexHull([-2.5, -2.75, 2.5, 2.25, 2.5, 3.75, -2.5, -1.25]);
		// art: 64x80 px at 16 px / tile, pivot (32, 48); its pixels a diagonal from (-2, -2)..(-2, -1) to (2, 2)..(2, 3)
		const diag: SpriteLayout = { frameW: 64, frameH: 80, pivot: { x: 32, y: 48 }, pixelsPerTile: 16 };
		const outline = [
			{ x: 0, y: 80 },
			{ x: 64, y: 16 },
			{ x: 64, y: 0 },
			{ x: 0, y: 64 },
		];
		const rect = fitArtLayout(diag, band, 0, 0);
		expect(rect === undefined || diag.pixelsPerTile / rect.pixelsPerTile < 0.5).toBe(true);
		expect(fitArtLayout(diag, band, 0, 0, 1, outline)).toBe(diag); // the outline fits as drawn
		// and it is still held: in a band half a tile thick it is drawn at half size
		const thin = convexHull([-2, -2, 2, 2, 2, 2.5, -2, -1.5]);
		const held = fitArtLayout(diag, thin, 0, 0, 1, outline)!;
		expect(diag.pixelsPerTile / held.pixelsPerTile).toBeCloseTo(0.5, 9);
		expect(held.pivot).toBe(diag.pivot);
	});

	it("draws every standing piece of real floors inside its box (all points: no wall segments since 2026-11-02)", () => {
		let standing = 0;
		let segments = 0;
		for (const plan of plans) {
			plan.entries.forEach((e, i) => {
				const layout = decorPieceLayout(plan, i, huge);
				if (e.fade < 0) {
					expect(layout).toBe(huge); // flat and wall pieces are not under the footprint rule
					return;
				}
				standing++;
				if (e.cells > 1 && e.source !== "solid") segments++; // a solid tomb spans 2 cells, not a wall segment
				expect(layout).toBeDefined();
				const poly = plan.fadeBoxes[e.fade].polygon;
				const x = screenX(DECOR_CAMERA, e.x, e.y, e.z);
				const y = screenY(DECOR_CAMERA, e.x, e.y, e.z);
				expect(drawnInside(poly, x, y, layout!, 1)).toBe(true);
				if (e.cells === 1) {
					// a point piece: within the box's own pixels (w centred, h above, nothing below)
					const box = DECOR_BOX[e.kind as StandingKind];
					const s = 16 / layout!.pixelsPerTile;
					expect(layout!.frameW * s <= box.w + 1e-9).toBe(true);
					expect(layout!.pivot.y * s <= box.h + 1e-9).toBe(true);
					expect((layout!.frameH - layout!.pivot.y) * s <= box.below + 1e-9).toBe(true);
				}
				expect(decorPieceLayout(plan, i, small)).toBe(small);
			});
		}
		expect(standing).toBeGreaterThan(0);
		expect(segments).toBe(0); // wall props are not decoration (docs/DECOR.md R6)
	});

	it("holds flames at their largest growth and glows inside the piece's box", () => {
		expect(decorFlameMaxGrow()).toBeCloseTo(DECOR_REACT.engagedFlameScale * (1 + DECOR_FX.flareGrow), 12);
		// a centred flame bigger than any box, on a bowl 3 px under the top of the (huge) piece
		const flame: SpriteLayout = { frameW: 48, frameH: 64, pivot: { x: 24, y: 32 }, pixelsPerTile: 16 };
		const glowAt = { x: 32, y: 3 };
		let checked = 0;
		for (const plan of plans) {
			plan.entries.forEach((e, i) => {
				if (e.fade < 0) {
					expect(decorFxLayout(plan, i, huge, glowAt, flame, decorFlameMaxGrow())).toBe(flame);
					return;
				}
				const piece = decorPieceLayout(plan, i, huge)!;
				const poly = plan.fadeBoxes[e.fade].polygon;
				const art: DecorArt = {
					id: "decor.delve.b1.brazier",
					layer: "tall",
					glow: true,
					glowAt,
					emissive: false,
					art: {
						kind: "image",
						assetId: "test",
						w: huge.frameW,
						h: huge.frameH,
						rect: { x: 0, y: 0, w: huge.frameW, h: huge.frameH },
						pivot: huge.pivot,
						pixelsPerTile: huge.pixelsPerTile,
					},
				};
				// the glow point follows the drawn (fitted) piece, and lies inside its box
				const g = decorGlowPoint(e, art, piece);
				const gx = screenX(DECOR_CAMERA, g[0], g[1], g[2]);
				const gy = screenY(DECOR_CAMERA, g[0], g[1], g[2]);
				expect(insideBy(poly, gx, gy, -1e-9)).toBe(true);
				for (const grow of [1, decorFlameMaxGrow()]) {
					const fx = decorFxLayout(plan, i, piece, glowAt, flame, grow);
					if (fx === undefined) continue;
					expect(drawnInside(poly, gx, gy, fx, grow)).toBe(true);
					checked++;
				}
			});
		}
		expect(checked).toBeGreaterThan(0);
	});
});
