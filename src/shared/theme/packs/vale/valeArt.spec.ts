// The vale pack's Lords of Pain decor art (docs/DECOR.md R5) on real endless floors (shared/view's decor plan and fit): every standing piece is drawn
// inside its DECOR_BOX at full size (the boxes were measured on this art; no wall segments are planned since 2026-11-02),
// grid pieces take the facing whose render runs along their wall, and the brazier's flame and glow fit its box.
import { describe, expect, it } from "@rbxts/jest-globals";
import { buildEndlessFloor, generateDungeon, type Dungeon, type ForgeParams } from "shared/dungeon";
import {
	DECOR_CAMERA,
	decorFacingDir,
	decorFlameMaxGrow,
	decorFxLayout,
	decorInputOfLayout,
	decorOutline,
	decorPieceLayout,
	flatLayoutReach,
	insideBy,
	planDecor,
	planVoid,
	screenX,
	screenY,
	spriteFacing,
	voidInputOfLayout,
	VOID_PIECES,
	type DecorPlan,
	type SpriteLayout,
} from "shared/view";
import { decorFxId } from "../../contract";
import { ThemeCore, type DecorArt } from "../../core";
import { sortedKeys } from "../../util";
import { VALE_WORLD_LAYOUTS } from "./layout";
import { buildValeManifest } from "./manifest";

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

/** The billboard layout of decor art (DecorController's visualLayout). */
function layoutOf(art: DecorArt): SpriteLayout {
	const a = art.art;
	if (a.kind === "image")
		return { frameW: a.rect.w, frameH: a.rect.h, pivot: a.pivot, pixelsPerTile: a.pixelsPerTile };
	return a.set;
}

function fakeIds(): Record<string, string> {
	const ids: Record<string, string> = {};
	let n = 0;
	for (const name of sortedKeys(VALE_WORLD_LAYOUTS)) {
		const l = VALE_WORLD_LAYOUTS[name];
		for (const f of l.kind === "image" ? [l.file] : l.sheets.map((s) => s.file)) {
			if (ids[f] === undefined) ids[f] = `rbxassetid://${7000 + n++}`;
		}
	}
	return ids;
}

describe("vale decor art held to DECOR_BOX (docs/DECOR.md R5)", () => {
	const core = new ThemeCore(buildValeManifest(fakeIds()), { warn: () => undefined });
	const plans: DecorPlan[] = [];
	for (const [runSeed, floor] of [
		[1, 2],
		[3, 2],
		[5, 5],
		[7, 11],
		[12, 3],
		[4, 16],
	]) {
		// planned as the game does, with the pack's variant counts (a throne's / tomb's variant is its facing / axis)
		const input = decorInputOfLayout(buildEndlessFloor(runSeed, floor, dungeonFor));
		const biome = planDecor(input).biome;
		plans.push(planDecor({ ...input, variants: (k) => core.decorVariants(biome, k).size() }));
	}
	const basis = DECOR_CAMERA;

	it("draws every standing piece the pack has art for, columns and braziers whole, walls at >= 95 %", () => {
		const drawn = new Map<string, number>();
		for (const plan of plans) {
			plan.entries.forEach((e, i) => {
				if (e.fade < 0) return;
				const list = core.decorVariants(plan.biome, e.kind);
				const art = list[e.variant] ?? list[0];
				if (art === undefined) return;
				const layout = layoutOf(art);
				const [dx, dz] = decorFacingDir(e);
				const facing = art.art.kind === "sprites" ? spriteFacing(dx, dz, art.art.set.facings, basis, 0) : 0;
				const outline = decorOutline(art, facing);
				expect([e.kind, outline !== undefined]).toEqual([e.kind, true]);
				const fitted = decorPieceLayout(plan, i, layout, outline);
				expect([e.kind, fitted !== undefined]).toEqual([e.kind, true]);
				const scale = layout.pixelsPerTile / fitted!.pixelsPerTile;
				expect([e.kind, scale >= 1 - 1e-9]).toEqual([e.kind, true]);
				// the outline really lies inside the box, as drawn
				const poly = plan.fadeBoxes[e.fade].polygon;
				const s = 1 / fitted!.pixelsPerTile;
				const x = screenX(basis, e.x, e.y, e.z);
				const y = screenY(basis, e.x, e.y, e.z);
				for (const p of outline!) {
					const px = x + (p.x - fitted!.pivot.x) * s;
					const py = y + (fitted!.pivot.y - p.y) * s;
					expect([e.kind, insideBy(poly, px, py, -1e-9)]).toEqual([e.kind, true]);
				}
				drawn.set(e.kind, (drawn.get(e.kind) ?? 0) + 1);
			});
		}
		for (const kind of ["column", "columnBroken"]) expect([kind, (drawn.get(kind) ?? 0) > 0]).toEqual([kind, true]);
		for (const kind of ["wall", "wallBroken"]) expect([kind, drawn.get(kind) ?? 0]).toEqual([kind, 0]);
		// docs/KENNEY_DECOR.md KN3: the wide cases (pairs of a run) and the narrow ones beside them, whole
		for (const kind of ["bookcase", "bookcaseWide"])
			expect([kind, (drawn.get(kind) ?? 0) > 0]).toEqual([kind, true]);
	});

	it("wall pieces take the render along their wall: segments run across their normal, torches point along it", () => {
		const wall = core.decor("decor.delve.b1.wall")!;
		const torch = core.decor("decor.delve.b1.torch")!;
		expect(wall.art.kind).toBe("sprites");
		expect(torch.art.kind).toBe("sprites");
		if (wall.art.kind !== "sprites" || torch.art.kind !== "sprites") return;
		// the plan's far-wall normals: (1, 0) lands at 320.7 degrees on screen, (0, 1) at 219.3
		expect(spriteFacing(1, 0, wall.art.set.facings, basis, -1)).toBe(3);
		expect(spriteFacing(0, 1, wall.art.set.facings, basis, -1)).toBe(2);
		expect(spriteFacing(1, 0, torch.art.set.facings, basis, -1)).toBe(3);
		expect(spriteFacing(0, 1, torch.art.set.facings, basis, -1)).toBe(2);
		// a segment along Z (normal +X) rises to the right on screen, one along X falls: its outline's slope says so
		const slope = (facing: number) => {
			const o = decorOutline(wall, facing)!;
			let left = o[0];
			let right = o[0];
			for (const p of o) {
				if (p.x < left.x || (p.x === left.x && p.y > left.y)) left = p;
				if (p.x > right.x || (p.x === right.x && p.y > right.y)) right = p;
			}
			return left.y - right.y; // > 0: the right end is higher (image y grows downward)
		};
		expect(screenY(basis, 0, 0, 1) - screenY(basis, 0, 0, 0) < 0).toBe(true); // +Z runs down-left on screen
		expect(slope(3) > 0).toBe(true);
		expect(slope(2) < 0).toBe(true);
	});

	it("void pieces (docs/VOID_DECOR.md VD6): standing art fits its box at the surface's top, flats within their reach", () => {
		const drawn = new Map<string, number>();
		for (const [runSeed, floor] of [
			[1, 2],
			[5, 5],
			[7, 11],
			[4, 16],
		]) {
			const layout = buildEndlessFloor(runSeed, floor, dungeonFor);
			const plan = planDecor({ ...decorInputOfLayout(layout), voidPlan: planVoid(voidInputOfLayout(layout)) });
			plan.entries.forEach((e, i) => {
				if (e.source !== "void") return;
				const list = core.decorVariants(plan.biome, e.kind);
				const art = list[e.variant] ?? list[0];
				if (art === undefined) return; // flagstones: only once the built atlas has them
				const own = layoutOf(art);
				if (e.layer === "flat") {
					const held = decorPieceLayout(plan, i, own)!;
					expect([e.kind, flatLayoutReach(held) <= VOID_PIECES.flatRadiusTiles + 1e-9]).toEqual([
						e.kind,
						true,
					]);
				} else {
					const [dx, dz] = decorFacingDir(e);
					const facing = art.art.kind === "sprites" ? spriteFacing(dx, dz, art.art.set.facings, basis, 0) : 0;
					const fitted = decorPieceLayout(plan, i, own, decorOutline(art, facing));
					expect([e.kind, fitted !== undefined]).toEqual([e.kind, true]);
					const scale = own.pixelsPerTile / fitted!.pixelsPerTile;
					// columns and stumps (the void's only standing pieces: no wall props, VDD10) draw whole
					expect([e.kind, e.faceX, e.faceZ, scale >= 1 - 1e-9]).toEqual([e.kind, e.faceX, e.faceZ, true]);
				}
				drawn.set(e.kind, (drawn.get(e.kind) ?? 0) + 1);
			});
		}
		for (const kind of ["column", "debris"]) expect([kind, (drawn.get(kind) ?? 0) > 0]).toEqual([kind, true]);
		for (const kind of ["wall", "wallBroken"]) expect([kind, drawn.get(kind) ?? 0]).toEqual([kind, 0]);
	});

	it("the brazier's flame and glow fit its box at their largest", () => {
		const flame = core.decor(decorFxId("flame"))!;
		const glow = core.decor(decorFxId("glow"))!;
		let checked = 0;
		for (const plan of plans) {
			plan.entries.forEach((e, i) => {
				if (e.kind !== "brazier" || e.fade < 0) return;
				const art = core.decorVariants(plan.biome, "brazier")[0];
				const piece = decorPieceLayout(plan, i, layoutOf(art), decorOutline(art, 0))!;
				expect(decorFxLayout(plan, i, piece, art.glowAt, layoutOf(flame), decorFlameMaxGrow())).toBeDefined();
				expect(decorFxLayout(plan, i, piece, art.glowAt, layoutOf(glow), 1)).toBeDefined();
				checked++;
			});
		}
		expect(checked).toBeGreaterThan(0);
	});
});
