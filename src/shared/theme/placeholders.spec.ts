// The placeholder table (PLAN.md "Assets: placeholder now"): one primitive per visual ID, sized from the
// sprite contract cell, coloured by role.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PIXELS_PER_TILE, STUDS_PER_TILE } from "shared/config";
import { BIOMES, slotFor } from "./contract";
import { MISSING_COLOR } from "./core";
import { ThemePack } from "./pack";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import {
	PLACEHOLDER_MATERIALS,
	PLACEHOLDER_SHAPES,
	PLACEHOLDER_VISUALS,
	TELEGRAPH_VISUAL,
	placeholderVisualFor,
	pxToStuds,
	type PlaceholderVisual,
} from "./placeholders";
import { COLOR_ROLES } from "./types";
import { sortedEntries } from "./util";

const s = (px: number) => (px / PIXELS_PER_TILE) * STUDS_PER_TILE;
const ROLES = new Set<string>(COLOR_ROLES);

function visualIds(): Array<string> {
	return sortedEntries(PLACEHOLDER_MANIFEST.assets)
		.filter(([, def]) => (def as { kind: string }).kind === "placeholder")
		.map(([id]) => id);
}

function checkVisual(name: string, v: PlaceholderVisual) {
	expect([name, PLACEHOLDER_SHAPES.includes(v.shape)]).toEqual([name, true]);
	expect([name, PLACEHOLDER_MATERIALS.includes(v.material)]).toEqual([name, true]);
	if (v.color.kind === "role") {
		expect([name, ROLES.has(v.color.role)]).toEqual([name, true]);
	} else if (v.color.kind === "biome") {
		expect([name, BIOMES.some((b) => b.id === (v.color as { biome: string }).biome)]).toEqual([name, true]);
	} else {
		expect([name, "no literal or missing colours in the table"]).toEqual([name, v.color.kind]);
	}
	if (v.outline !== undefined) {
		expect([name, ROLES.has(v.outline)]).toEqual([name, true]);
	}
	for (const d of v.size) {
		expect([name, d >= 0]).toEqual([name, true]);
	}
}

describe("PLACEHOLDER_VISUALS", () => {
	it("covers every placeholder ID in the placeholder pack, and nothing else", () => {
		const ids = visualIds();
		expect(ids.size()).toBeGreaterThan(0);
		for (const id of ids) {
			expect([id, PLACEHOLDER_VISUALS[id] !== undefined]).toEqual([id, true]);
		}
		const pack = new Set(ids);
		for (const [id] of sortedEntries(PLACEHOLDER_VISUALS)) {
			expect([id, pack.has(id)]).toEqual([id, true]);
		}
	});

	it("uses known shapes, materials and colour roles only (no literal colours)", () => {
		for (const [id, v] of sortedEntries(PLACEHOLDER_VISUALS)) {
			checkVisual(id, v as PlaceholderVisual);
		}
		checkVisual("telegraph", TELEGRAPH_VISUAL);
	});

	it("is Neon for bullets and SmoothPlastic for everything else", () => {
		for (const [id, v] of sortedEntries(PLACEHOLDER_VISUALS)) {
			const want = slotFor(id)?.slot === "bullet" ? "Neon" : "SmoothPlastic";
			expect([id, (v as PlaceholderVisual).material]).toEqual([id, want]);
		}
	});

	it("derives sizes from the contract cell at 16 px per world unit", () => {
		expect(pxToStuds(PIXELS_PER_TILE)).toBe(STUDS_PER_TILE);
		for (const [id, v] of sortedEntries(PLACEHOLDER_VISUALS)) {
			const cell = slotFor(id)?.cell;
			if (cell !== undefined) {
				expect([id, (v as PlaceholderVisual).cellPx]).toEqual([id, cell]);
			}
		}
	});

	it("draws each archetype as the plan says", () => {
		const v = PLACEHOLDER_VISUALS;
		// class = tan capsule (vanguard, the M1 player; every class in its identity role)
		expect(v["class.vanguard"]).toMatchObject({
			shape: "Capsule",
			color: { kind: "role", role: "class.vanguard" },
			anchor: "base",
			faces: true,
		});
		expect(v["class.vanguard"].size).toEqual([s(12), s(24), s(12)]);
		expect(PLACEHOLDER_MANIFEST.colors["class.vanguard"]).toBe("#c9b37e"); // tan
		// swarmer = small ball
		expect(v["enemy.swarmer"].shape).toBe("Ball");
		expect(v["enemy.swarmer"].size).toEqual([s(8), s(8), s(8)]);
		// sniper = wedge pointing along its facing
		expect(v["enemy.sniper"]).toMatchObject({ shape: "Wedge", faces: true });
		expect(v["enemy.sniper"].size[2]).toBeGreaterThan(v["enemy.sniper"].size[0]);
		// bruiser = heavy block filling the cell
		expect(v["enemy.bruiser"].shape).toBe("Block");
		expect(v["enemy.bruiser"].size).toEqual([s(16), s(16), s(16)]);
		// boss = large block (48 px cell)
		for (const id of ["boss.1", "boss.act1"]) {
			expect(v[id]).toMatchObject({ shape: "Block", color: { kind: "role", role: "boss" } });
			expect(v[id].size[0]).toBe(s(48));
		}
		// enemy bullet = neon ball with a dark outline role; centred on the bullet
		expect(v["bullet.enemy.small"]).toMatchObject({
			shape: "Ball",
			material: "Neon",
			color: { kind: "role", role: "enemyBullet" },
			outline: "enemyBulletOutline",
			anchor: "center",
		});
		// player bullet = thin bolt along its velocity
		const bolt = v["bullet.player.basic"];
		expect(bolt).toMatchObject({ material: "Neon", color: { kind: "role", role: "playerBullet" }, faces: true });
		expect(bolt.size[2]).toBeGreaterThan(bolt.size[0] * 2);
		// tiles = floor slab / wall cube in the biome's floor / wall colour
		expect(v["tile.biome.3.floor"].color).toEqual({ kind: "biome", biome: "biome.3", surface: "floor" });
		expect(v["tile.biome.3.wall"].color).toEqual({ kind: "biome", biome: "biome.3", surface: "wall" });
		expect(v["tile.biome.3.wall"].size).toEqual([s(16), s(16), s(16)]);
		expect(v["tile.biome.3.floor"].size[1]).toBeLessThan(v["tile.biome.3.floor"].size[0]);
		// telegraph = dashed line in the telegraph role
		expect(TELEGRAPH_VISUAL.color).toEqual({ kind: "role", role: "telegraph" });
		expect(TELEGRAPH_VISUAL.dash).toBeDefined();
	});

	it("falls back by prefix for extra IDs under a known slot", () => {
		expect(placeholderVisualFor("bullet.enemy.wave")).toEqual(PLACEHOLDER_VISUALS["bullet.enemy.small"]);
		expect(placeholderVisualFor("bullet.player.pierce")?.color).toEqual({ kind: "role", role: "playerBullet" });
		expect(placeholderVisualFor("item.weapon.axe")?.shape).toBe("Block");
		expect(placeholderVisualFor("weapon.sword")).toBeUndefined();
	});

	it("resolves every placeholder colour in the placeholder pack without a warning", () => {
		const warnings = new Array<string>();
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: (m) => warnings.push(m) });
		for (const id of visualIds()) {
			const v = pack.placeholder(id);
			expect([id, pack.visualHex(v.color) !== MISSING_COLOR]).toEqual([id, true]);
			if (v.outline !== undefined) {
				expect([id, pack.hex(v.outline) !== MISSING_COLOR]).toEqual([id, true]);
			}
		}
		expect(pack.visualHex(TELEGRAPH_VISUAL.color)).toBe("#ff8a3d");
		expect(warnings).toEqual([]);
	});
});
