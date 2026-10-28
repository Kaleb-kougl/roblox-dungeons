// Depth profile (docs/DECOR.md Phase 2 part 1, task R8): band boundaries, forced bands, the plan never goes over the
// R3 caps in any band, the band's swaps and torch share show up in the plan, and the darkest-band contrast check
// passes for every bundled pack at every band, for the enemy bullet, the enemy outline (enemy outline plan O1) and
// the player outline.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, buildEndlessFloor, generateDungeon, type Dungeon, type ForgeParams } from "shared/dungeon";
import {
	BIOMES,
	MIN_ENEMY_BULLET_CONTRAST,
	MIN_ENEMY_OUTLINE_CONTRAST,
	MIN_PLAYER_OUTLINE_CONTRAST,
	THEME_PACKS,
	contrastRatio,
	listThemePacks,
	parseHex,
	relativeLuminance,
} from "shared/theme";
import {
	DECOR_BAND_CONTRAST_CHECKS,
	DECOR_DEPTH,
	ENEMY_OUTLINE_BAND_CHECK,
	MAX_DECOR_SHARE,
	MAX_TALL_PER_ROOM,
	PLAYER_OUTLINE_BAND_CHECK,
	biomeOfTheme,
	darkestDecorBand,
	decorBandContrastReport,
	decorBandIndex,
	decorInputOfLayout,
	decorProfile,
	dimHex,
	flatKindWeight,
	planDecor,
} from ".";

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

describe("decor profile: bands", () => {
	it("goes by floor: kept 1-4, worn 5-9, ruined 10-14, abyss 15+", () => {
		const expected: Array<[number, string]> = [
			[0, "kept"],
			[1, "kept"],
			[4, "kept"],
			[5, "worn"],
			[9, "worn"],
			[10, "ruined"],
			[14, "ruined"],
			[15, "abyss"],
			[16, "abyss"],
			[99, "abyss"],
		];
		for (const [floor, name] of expected) {
			expect(DECOR_DEPTH.bands[decorBandIndex(floor)].name).toBe(name);
			expect(decorProfile(floor, 1, "ancient").bandName).toBe(name);
		}
	});

	it("puts every boss floor (every 5th) on a band's first floor until the last band", () => {
		for (let i = 1; i < DECOR_DEPTH.bands.size(); i++) expect(DECOR_DEPTH.bands[i].fromFloor % 5).toBe(0);
	});

	it("forces a band (KV_DecorBand), clamped to the table", () => {
		expect(decorProfile(1, 1, "frost", 2).bandName).toBe("ruined");
		expect(decorProfile(20, 1, "frost", 0).bandName).toBe("kept");
		expect(decorProfile(1, 1, "frost", -3).band).toBe(0);
		expect(decorProfile(1, 1, "frost", 99).band).toBe(DECOR_DEPTH.bands.size() - 1);
	});

	it("carries the table's values, its floor, depth and the theme's biome", () => {
		const p = decorProfile(12, 3, "grim");
		const b = DECOR_DEPTH.bands[2];
		expect(p.flatShare).toBe(b.flatShare);
		expect(p.columnBrokenShare).toBe(b.columnBrokenShare);
		expect(p.wallBrokenShare).toBe(b.wallBrokenShare);
		expect(p.litTorchShare).toBe(b.litTorchShare);
		expect(p.light).toBe(b.light);
		expect(p.floor).toBe(12);
		expect(p.depth).toBe(3);
		expect(p.biome).toBe(biomeOfTheme("grim"));
		expect(flatKindWeight(p, "bones")).toBe(b.clutterWeight);
		expect(flatKindWeight(p, "debris")).toBe(b.clutterWeight);
		expect(flatKindWeight(p, "moss")).toBe(1);
		for (const bd of BIOMES) expect(biomeOfTheme(bd.forgeTheme)).toBe(bd.id);
	});

	it("never asks for more flat clutter than the R3 ceiling, and gets darker and more broken with depth", () => {
		const bands = DECOR_DEPTH.bands;
		for (let i = 0; i < bands.size(); i++) {
			expect(bands[i].flatShare <= MAX_DECOR_SHARE).toBe(true);
			if (i === 0) continue;
			expect(bands[i].fromFloor > bands[i - 1].fromFloor).toBe(true);
			expect(bands[i].light <= bands[i - 1].light).toBe(true);
			expect(bands[i].columnBrokenShare >= bands[i - 1].columnBrokenShare).toBe(true);
			expect(bands[i].wallBrokenShare >= bands[i - 1].wallBrokenShare).toBe(true);
			expect(bands[i].litTorchShare <= bands[i - 1].litTorchShare).toBe(true);
		}
		expect(DECOR_DEPTH.bands[darkestDecorBand()].name).toBe("abyss");
	});
});

describe("decor profile: applied by the plan", () => {
	const floors = [1, 2, 3, 4, 5, 6].map((run) => buildEndlessFloor(run, 1 + (run % 5), dungeonFor));

	it("never goes over the R3 caps in any band", () => {
		for (let band = 0; band < DECOR_DEPTH.bands.size(); band++)
			for (const layout of floors) {
				const plan = planDecor({ ...decorInputOfLayout(layout), forceBand: band });
				expect(plan.profile.band).toBe(band);
				const d = layout.dungeon;
				const tall = new Map<number, number>();
				const flat = new Map<number, number>();
				for (const e of plan.entries) {
					if ((e.layer === "tall" || e.layer === "low") && e.source !== "pillar")
						tall.set(e.roomId, (tall.get(e.roomId) ?? 0) + 1);
					if (e.layer === "flat") flat.set(e.roomId, (flat.get(e.roomId) ?? 0) + 1);
				}
				for (const [, n] of tall) expect(n <= MAX_TALL_PER_ROOM).toBe(true);
				const tiles = new Map<number, number>();
				for (let c = 0; c < d.W * d.H; c++)
					if (d.grid[c] === TileType.FLOOR) {
						const r = d.roomId[c] >= 0 ? d.roomId[c] : -1;
						tiles.set(r, (tiles.get(r) ?? 0) + 1);
					}
				for (const [r, n] of flat)
					expect(n <= math.floor(DECOR_DEPTH.bands[band].flatShare * (tiles.get(r) ?? 0))).toBe(true);
			}
	});

	it("only swaps pieces: the same spots in every band, broken kinds and dark torches by the band's share", () => {
		const base = floors.map((l) => planDecor({ ...decorInputOfLayout(l), forceBand: 0 }));
		const deep = floors.map((l) =>
			planDecor({ ...decorInputOfLayout(l), forceBand: DECOR_DEPTH.bands.size() - 1 }),
		);
		let torches = 0;
		let lit = 0;
		let walls = 0;
		let broken = 0;
		for (let i = 0; i < floors.size(); i++) {
			const a = base[i].entries.filter((e) => e.layer !== "flat");
			const b = deep[i].entries.filter((e) => e.layer !== "flat");
			expect(b.size()).toBe(a.size());
			for (let k = 0; k < a.size(); k++) {
				expect(b[k].cellX).toBe(a[k].cellX);
				expect(b[k].cellY).toBe(a[k].cellY);
				if (a[k].kind === "wall") {
					walls++;
					expect(b[k].kind).toBe("wallBroken"); // abyss: every segment broken
				}
				if (a[k].kind === "torch") {
					expect(a[k].lit).toBe(true); // kept: every torch lit
					torches++;
					if (b[k].lit) lit++;
				}
				if (a[k].kind === "column" && b[k].kind === "columnBroken") broken++;
			}
		}
		expect(walls).toBeGreaterThan(0);
		expect(torches).toBeGreaterThan(50);
		const share = lit / torches;
		const want = DECOR_DEPTH.bands[DECOR_DEPTH.bands.size() - 1].litTorchShare;
		expect(math.abs(share - want) < 0.15).toBe(true);
		expect(broken).toBeGreaterThanOrEqual(0);
	});
});

describe("decor profile: darkest-band contrast", () => {
	it("dims a colour's luminance by the light multiplier (linear light)", () => {
		const hex = "#808080";
		const l0 = relativeLuminance(parseHex(hex)!);
		const l1 = relativeLuminance(parseHex(dimHex(hex, 0.7))!);
		expect(l1).toBeCloseTo(l0 * 0.7, 2);
		expect(dimHex(hex, 1)).toBe(hex);
	});

	it("keeps enemy bullets >= 3:1 against every biome's floor and wall in every band, for every bundled pack", () => {
		const ids = listThemePacks();
		expect(ids).toContain("vale");
		for (const id of ids) {
			const manifest = THEME_PACKS[id];
			for (let band = 0; band < DECOR_DEPTH.bands.size(); band++) {
				const rows = decorBandContrastReport(manifest, band);
				expect(rows.size()).toBe(BIOMES.size() * 2);
				for (const r of rows) {
					if (!r.ok) print(`[decor] ${id} ${r.band} ${r.biome} ${r.surface} ${r.color}: ${r.ratio}`);
					expect(r.ok).toBe(true);
					expect(r.ratio >= MIN_ENEMY_BULLET_CONTRAST).toBe(true);
					expect(r.ratio).toBe(contrastRatio(manifest.colors.enemyBullet, r.color));
				}
			}
		}
	});

	it("keeps every self-lit role (bullet, outlines) at its minimum in every band, for every bundled pack", () => {
		expect(DECOR_BAND_CONTRAST_CHECKS.map((c) => c.role)).toEqual(["enemyBullet", "enemyOutline", "playerOutline"]);
		expect(ENEMY_OUTLINE_BAND_CHECK.min).toBe(MIN_ENEMY_OUTLINE_CONTRAST);
		expect(PLAYER_OUTLINE_BAND_CHECK.min).toBe(MIN_PLAYER_OUTLINE_CONTRAST);
		for (const id of listThemePacks()) {
			const manifest = THEME_PACKS[id];
			for (const check of DECOR_BAND_CONTRAST_CHECKS) {
				for (let band = 0; band < DECOR_DEPTH.bands.size(); band++) {
					const rows = decorBandContrastReport(manifest, band, check);
					expect([id, check.role, rows.size()]).toEqual([id, check.role, BIOMES.size() * 2]);
					for (const r of rows) {
						if (!r.ok) print(`[decor] ${id} ${check.role} ${r.band} ${r.biome} ${r.surface}: ${r.ratio}`);
						expect(r.ok).toBe(true);
						expect(r.role).toBe(check.role);
						expect(r.min).toBe(check.min);
						expect(r.ratio).toBe(contrastRatio(manifest.colors[check.role], r.color));
					}
				}
			}
		}
	});

	it("fails an outline that only reads at full light (darker than the floor, which the darkest band dims to it)", () => {
		// #616161 has luminance ~0.12: black is 3.39:1 on it at full light, but the floor dims toward black.
		const manifest = {
			colors: { enemyOutline: "#000000" },
			biomes: { "biome.1": { floor: "#616161", wall: "#616161" } },
		};
		const full = decorBandContrastReport(manifest, 0, ENEMY_OUTLINE_BAND_CHECK);
		expect(DECOR_DEPTH.bands[0].light).toBe(1);
		expect(full.size()).toBe(2);
		for (const r of full) expect(r.ok).toBe(true);
		const dark = decorBandContrastReport(manifest, darkestDecorBand(), ENEMY_OUTLINE_BAND_CHECK);
		expect(dark.size()).toBe(2);
		for (const r of dark) {
			expect(r.ok).toBe(false);
			expect(r.ratio < MIN_ENEMY_OUTLINE_CONTRAST).toBe(true);
			expect(r.role).toBe("enemyOutline");
		}
		// The default check is still the enemy bullet: this manifest has none, so no rows.
		expect(decorBandContrastReport(manifest)).toEqual([]);
	});
});
