// The void's Parts (docs/VOID_DECOR.md VD3, VD8, VD9): the pure half of VoidController. A run floor's plan input
// matches DecorController's (same band, one shared cache); columns run from their top past the abyss plane into the
// backdrop slab, under the wall top, centred like WorldController's slabs; layer -> colour / material / debug tint;
// the abyss motes stay under the floor and scale with the ambient emitter (none under reduced motion).
import { describe, expect, it } from "@rbxts/jest-globals";
import { STUDS_PER_TILE } from "shared/config";
import { THEMES, THEME_KEYS, TileType, buildEndlessFloor, generateDungeon, type ThemeKey } from "shared/dungeon";
import { GAME_WORLD } from "../config";
import { DECOR_FX, abyssMoteSpec, ambientEmitterSpec, ambientMaxRiseTiles, decorProfile } from "../decor";
import { floorStudsY, studsX, studsZ } from "../space";
import {
	VOID,
	VOID_VIEW,
	VoidLayer,
	planVoid,
	planVoidCached,
	voidBandOf,
	voidBiomeOf,
	voidColumnBottomTiles,
	voidColumnOf,
	voidForceBand,
	voidLayerStyle,
	voidRunInput,
	type VoidRect,
} from ".";

const S = STUDS_PER_TILE;
const HEX = "^#%x%x%x%x%x%x$";

describe("void parts: plan input", () => {
	const layout = buildEndlessFloor(4, 7, generateDungeon);

	it("an endless floor plans with its layout's seed / floor and the run's Depth, as decorInputOfLayout does", () => {
		const input = voidRunInput(layout.dungeon, layout, 3, undefined);
		expect(input.dungeon).toBe(layout.dungeon);
		expect(input.floorSeed).toBe(layout.seed);
		expect(input.floor).toBe(7);
		expect(input.depth).toBe(3);
		expect(input.forceBand).toBe(undefined);
		expect(voidBandOf(input)).toBe(decorProfile(7, 3, layout.dungeon.params.themeKey).band);
	});

	it("without a layout plans the bare dungeon (floor 1, Depth 1), like DecorController's M1 input", () => {
		const input = voidRunInput(layout.dungeon, undefined, 5, undefined);
		expect(input.floorSeed).toBe(undefined);
		expect(input.floor).toBe(undefined);
		expect(input.depth).toBe(undefined);
		expect(voidBandOf(input)).toBe(decorProfile(1, 1, layout.dungeon.params.themeKey).band);
	});

	it("KV_DecorBand forces the band when it is a number, else is ignored", () => {
		expect(voidForceBand(2)).toBe(2);
		expect(voidForceBand(0)).toBe(0);
		expect(voidForceBand(0 / 0)).toBe(undefined);
		expect(voidForceBand("2")).toBe(undefined);
		expect(voidForceBand(true)).toBe(undefined);
		expect(voidForceBand(undefined)).toBe(undefined);
		const input = voidRunInput(layout.dungeon, layout, 1, 3);
		expect(voidBandOf(input)).toBe(decorProfile(7, 1, layout.dungeon.params.themeKey, 3).band);
	});

	it("a decor-profile input of the same band hits the same cached plan (VoidController and DecorController share it)", () => {
		const input = voidRunInput(layout.dungeon, layout, 2, undefined);
		const plan = planVoidCached(input);
		const profile = decorProfile(7, 2, layout.dungeon.params.themeKey);
		expect(planVoidCached({ dungeon: layout.dungeon, floorSeed: layout.seed, profile })).toBe(plan);
	});
});

describe("void parts: columns", () => {
	it("sinks every column bottom into the backdrop slab, never out of its underside", () => {
		expect(VOID_VIEW.columnSinkTiles > 0).toBe(true);
		expect(VOID_VIEW.columnSinkTiles < GAME_WORLD.backdropThicknessTiles).toBe(true);
		expect(voidColumnBottomTiles()).toBe(-(VOID.abyssDepthTiles + VOID_VIEW.columnSinkTiles));
	});

	it("spans a rect's cells (cell (gx, gy) centred on world (gx, gy)) from its top to the column bottom", () => {
		const r: VoidRect = { x: 3, y: 10, w: 4, h: 2, layer: VoidLayer.SHOULDER, top: VOID.shoulderTopTiles };
		const c = voidColumnOf(r);
		expect(c.sizeX).toBe(4 * S);
		expect(c.sizeZ).toBe(2 * S);
		expect(c.x - c.sizeX / 2).toBeCloseTo(studsX(3 - 0.5), 9);
		expect(c.x + c.sizeX / 2).toBeCloseTo(studsX(3 + 4 - 0.5), 9);
		expect(c.z - c.sizeZ / 2).toBeCloseTo(studsZ(10 - 0.5), 9);
		expect(c.z + c.sizeZ / 2).toBeCloseTo(studsZ(10 + 2 - 0.5), 9);
		expect(c.y + c.sizeY / 2).toBeCloseTo(floorStudsY() + VOID.shoulderTopTiles * S, 9);
		expect(c.y - c.sizeY / 2).toBeCloseTo(floorStudsY() + voidColumnBottomTiles() * S, 9);
	});

	it("gives every raised rect of real floors a column under the wall top (no z-fight with the walls' tops)", () => {
		const wallTop = floorStudsY() + GAME_WORLD.wallHeightTiles * S;
		const bottom = floorStudsY() + voidColumnBottomTiles() * S;
		const problems: string[] = [];
		for (let run = 1; run <= 3; run++)
			for (const floor of [1, 4, 9]) {
				const plan = planVoid({ dungeon: buildEndlessFloor(run, floor, generateDungeon).dungeon, floor });
				for (const r of plan.rects) {
					const c = voidColumnOf(r);
					const top = c.y + c.sizeY / 2;
					if (!(c.sizeX > 0 && c.sizeY > 0 && c.sizeZ > 0) || top >= wallTop || top <= floorStudsY())
						problems.push(`run ${run} floor ${floor}: ${r.x},${r.y} top ${top}`);
					if (math.abs(c.y - c.sizeY / 2 - bottom) > 1e-9) problems.push(`run ${run} floor ${floor}: bottom`);
					if (voidLayerStyle(r.layer) === undefined)
						problems.push(`run ${run} floor ${floor}: layer ${r.layer}`);
				}
			}
		expect(problems.join("\n")).toBe("");
	});

	it("never leaves a wall or floor cell on the grid's border (where no shoulder could stand outside it)", () => {
		const problems: string[] = [];
		for (let run = 1; run <= 5; run++)
			for (const floor of [1, 2, 5, 8]) {
				const d = buildEndlessFloor(run, floor, generateDungeon).dungeon;
				for (let x = 0; x < d.W; x++)
					for (const y of [0, d.H - 1])
						if (d.grid[y * d.W + x] !== TileType.VOID)
							problems.push(`run ${run} floor ${floor}: ${x},${y}`);
				for (let y = 0; y < d.H; y++)
					for (const x of [0, d.W - 1])
						if (d.grid[y * d.W + x] !== TileType.VOID)
							problems.push(`run ${run} floor ${floor}: ${x},${y}`);
			}
		expect(problems.size()).toBe(0);
	});
});

describe("void parts: layer style", () => {
	it("shoulder: shoulder colour and material; ledge and outcrop: the ledge colour and the cliff material", () => {
		const sh = voidLayerStyle(VoidLayer.SHOULDER)!;
		expect(sh.color).toBe("shoulder");
		expect(sh.material).toBe("shoulder");
		for (const layer of [VoidLayer.LEDGE, VoidLayer.OUTCROP]) {
			const st = voidLayerStyle(layer)!;
			expect(st.color).toBe("ledge");
			expect(st.material).toBe("cliff");
		}
		expect(voidLayerStyle(VoidLayer.NONE)).toBe(undefined);
		expect(voidLayerStyle(VoidLayer.ABYSS)).toBe(undefined);
	});

	it("names each layer and tints it a distinct valid debug colour", () => {
		const names = new Set<string>();
		const tints = new Set<string>();
		for (const layer of [VoidLayer.SHOULDER, VoidLayer.LEDGE, VoidLayer.OUTCROP]) {
			const st = voidLayerStyle(layer)!;
			expect(string.match(st.debugHex, HEX)[0] !== undefined).toBe(true);
			names.add(st.name);
			tints.add(st.debugHex.lower());
		}
		expect(names.size()).toBe(3);
		expect(tints.size()).toBe(3);
	});
});

describe("void parts: abyss motes (VD8)", () => {
	it("keeps the motes' volume above the abyss plane and their highest climb under the floor", () => {
		const centre = DECOR_FX.abyssMoteLiftTiles - VOID.abyssDepthTiles;
		const half = DECOR_FX.abyssMoteVolumeHeightTiles / 2;
		expect(centre - half > -VOID.abyssDepthTiles).toBe(true);
		expect(centre + half + ambientMaxRiseTiles(DECOR_FX.abyssMoteMotion) < 0).toBe(true);
	});

	it("is a share of the ambient emitter: none when it is off or under reduced motion, never more than it", () => {
		for (const [key] of pairs(THEMES)) {
			const themeKey = key as ThemeKey;
			const normal = ambientEmitterSpec(themeKey, 1, "normal", 1);
			const motes = abyssMoteSpec(normal);
			expect(motes.live <= normal.live).toBe(true);
			expect(motes.live).toBe(math.floor(normal.live * DECOR_FX.abyssMoteShare));
			expect(motes.motion).toBe(DECOR_FX.abyssMoteMotion);
			expect(motes.live > 0 === motes.rate > 0).toBe(true);
			const still = abyssMoteSpec(ambientEmitterSpec(themeKey, 1, "high", 0));
			expect(still.live).toBe(0);
			expect(still.rate).toBe(0);
			expect(abyssMoteSpec(ambientEmitterSpec(themeKey, 1, "off", 1)).rate).toBe(0);
		}
	});
});

describe("void parts: biome", () => {
	it("every Dungeon Forge theme has a void biome; an unknown theme draws no void", () => {
		for (const key of THEME_KEYS) expect(voidBiomeOf(key)).toBeDefined();
		expect(voidBiomeOf("nowhere")).toBeUndefined();
	});
});
