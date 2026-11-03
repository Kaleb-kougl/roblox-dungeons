// Roblox port (docs/VOID_DECOR.md VD1, VD7): the void's biome colours (shoulder, abyss, the derived ledge), the shoulder
// / cliff materials, the validator's void rules (voidReport: shoulder vs floor and wall, luminance order, enemy bullets
// on shoulder and ledge, the abyss vs the danger colours), the bundled packs' values, and the optional void art
// (`decor.void.b<n>.<kind>[.<v>]`) plus the void dressing decor kind (flagstones; no curb since VDD10).
import { describe, expect, it } from "@rbxts/jest-globals";
import { contrastRatio, mixRgb, parseHex, relativeLuminance, toHex } from "./color";
import {
	BIOMES,
	BIOME_MATERIAL_SURFACES,
	DECOR_BIOME_KEYS,
	DECOR_KINDS,
	DECOR_LAYERS,
	DECOR_MAX_VARIANTS,
	MIN_DECOR_FX_BULLET_DIFFERENCE,
	MIN_ENEMY_BULLET_CONTRAST,
	VOID_DECOR,
	decorId,
	parseDecorId,
	voidDecorId,
} from "./contract";
import { MISSING_COLOR, ThemeCore } from "./core";
import { ThemePack } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { deepClone, sortedKeys, type Obj } from "./util";
import { isAssetId, isGameplayKey, validateManifest } from "./validate";
import { VOID_COLORS, VOID_CONTRAST, voidColorProblems, voidLedgeColor, voidReport } from "./voidColors";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const biomeOf = (m: Obj, id: string) => (m.biomes as Obj)[id] as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;
const sink = () => {
	const messages = new Array<string>();
	return { messages, warn: (msg: string) => messages.push(msg) };
};
const PLACEHOLDER_VOID: ReadonlyArray<[string, string, string]> = [
	["biome.1", "#352f29", "#0c1018"],
	["biome.2", "#40241b", "#170a09"],
	["biome.3", "#28353f", "#081517"],
	["biome.4", "#2e2a34", "#0b130e"],
	["biome.5", "#263324", "#11150a"],
];

describe("void colours: contract", () => {
	it("has the plan's bars and the ledge mix", () => {
		expect(VOID_COLORS.ledgeMix).toBe(0.35);
		expect(VOID_CONTRAST.shoulderVsFloor).toBe(4);
		expect([...VOID_CONTRAST.bulletRoles]).toEqual(["enemyBullet"]);
		expect(VOID_CONTRAST.minBulletContrast).toBe(MIN_ENEMY_BULLET_CONTRAST);
		expect([...VOID_CONTRAST.abyssAgainst]).toEqual(["enemyBullet", "telegraph"]);
		expect(VOID_CONTRAST.minAbyssDifference).toBe(MIN_DECOR_FX_BULLET_DIFFERENCE);
	});

	it("derives the ledge as the shoulder mixed toward the abyss (mixRgb), with fallbacks for bad input", () => {
		expect(voidLedgeColor("#352f29", "#0c1018")).toBe("#272423");
		const s = parseHex("#40241b")!;
		const a = parseHex("#170a09")!;
		expect(voidLedgeColor("#40241b", "#170a09")).toBe(toHex(mixRgb(s, a, VOID_COLORS.ledgeMix)));
		expect(voidLedgeColor("#ffffff", "#ffffff")).toBe("#ffffff");
		expect(voidLedgeColor("#352f29", "nope")).toBe("#352f29");
		expect(voidLedgeColor("bad", "#0c1018")).toBe("#0c1018");
		expect(voidLedgeColor("bad", "worse")).toBe(MISSING_COLOR);
	});

	it("adds the shoulder and cliff material surfaces, none of them a gameplay key", () => {
		expect([...BIOME_MATERIAL_SURFACES]).toEqual(["floor", "wall", "pool", "shoulder", "cliff"]);
		for (const k of ["shoulder", "abyss", "cliff"]) expect([k, isGameplayKey(k)]).toEqual([k, false]);
	});

	it("the placeholder pack's shoulders are its walls darkened, its abysses near the background", () => {
		for (const [id, shoulder, abyss] of PLACEHOLDER_VOID) {
			const b = PLACEHOLDER_MANIFEST.biomes[id];
			expect([id, b.shoulder, b.abyss]).toEqual([id, shoulder, abyss]);
			const lum = (hex: string) => relativeLuminance(parseHex(hex)!);
			expect([id, lum(b.shoulder) <= lum(b.wall)]).toEqual([id, true]);
			expect([id, contrastRatio(b.abyss, PLACEHOLDER_MANIFEST.colors.background) < 1.2]).toEqual([id, true]);
		}
	});
});

describe("void colours: runtime", () => {
	it("ThemeCore / ThemePack carry shoulder, abyss and the ledge (hex and Color3) for every biome", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const pack = new ThemePack(THEME_PACKS[id], { warn: () => undefined });
			for (const b of BIOMES) {
				const def = THEME_PACKS[id].biomes[b.id];
				const t = pack.biome(b.id);
				expect([id, b.id, t.shoulder, t.abyss, t.ledge]).toEqual([
					id,
					b.id,
					def.shoulder,
					def.abyss,
					voidLedgeColor(def.shoulder, def.abyss),
				]);
				expect(t.shoulderColor.ToHex()).toBe(def.shoulder.sub(2));
				expect(t.abyssColor.ToHex()).toBe(def.abyss.sub(2));
				expect(t.ledgeColor.ToHex()).toBe(t.ledge.sub(2));
				expect(pack.core.biome(b.id).ledge).toBe(t.ledge);
			}
		}
	});

	it("an unknown biome or a malformed colour is magenta (the validator reports it)", () => {
		const m = clone();
		biomeOf(m, "biome.2").shoulder = "dark";
		biomeOf(m, "biome.3").abyss = undefined;
		const w = sink();
		const core = new ThemeCore(m, { warn: w.warn });
		expect([core.biome("biome.2").shoulder, core.biome("biome.2").ledge]).toEqual([MISSING_COLOR, MISSING_COLOR]);
		expect([core.biome("biome.3").abyss, core.biome("biome.3").ledge]).toEqual([MISSING_COLOR, MISSING_COLOR]);
		expect(core.biome("biome.3").shoulder).toBe("#28353f");
		const unknown = core.biome("biome.9");
		expect([unknown.shoulder, unknown.abyss, unknown.ledge]).toEqual([MISSING_COLOR, MISSING_COLOR, MISSING_COLOR]);
		expect([unknown.materials.shoulder, unknown.materials.cliff]).toEqual(["SmoothPlastic", "SmoothPlastic"]);
		expect(w.messages).toEqual(['[theme:placeholder] missing biome "biome.9"']);
	});
});

describe("void colours: validator", () => {
	it("the bundled packs pass every void rule (numbers printed)", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const manifest = THEME_PACKS[id];
			expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
			const report = voidReport(manifest);
			// per biome: floor, wall, 2 order, 2 bullet (shoulder, ledge), 2 abyss
			expect([id, report.size()]).toEqual([id, BIOMES.size() * 8]);
			for (const e of report) {
				expect([id, e.biome, e.check, e.subject, e.against, e.ok]).toEqual([
					id,
					e.biome,
					e.check,
					e.subject,
					e.against,
					true,
				]);
			}
			const low = (check: string) =>
				report.filter((e) => e.check === check).reduce((acc, e) => math.min(acc, e.value), math.huge);
			print(
				`[void] ${id}: shoulder vs floor >= ${"%.1f".format(low("floor"))} CIE76, bullet >= ` +
					`${"%.2f".format(low("bullet"))}:1, abyss >= ${"%.1f".format(low("abyss"))} CIE76`,
			);
		}
	});

	it("requires a hex shoulder and abyss on every biome and rejects unknown biome keys", () => {
		const m = clone();
		biomeOf(m, "biome.1").shoulder = undefined;
		biomeOf(m, "biome.4").abyss = "#12345";
		biomeOf(m, "biome.5").ledge = "#101010";
		expect(validateManifest(m)).toEqual([
			'biomes["biome.1"].shoulder: must be "#rrggbb", got undefined',
			'biomes["biome.4"].abyss: must be "#rrggbb", got "#12345"',
			'biomes["biome.5"].ledge: unknown key (allowed: name, floor, wall, shoulder, abyss, tiles, materials)',
		]);
	});

	it("fails a shoulder too close to the floor (readability rule 1)", () => {
		const m = clone();
		// ancient: the wall darkened x0.9, nearer the wall but only 3.2 from the floor
		biomeOf(m, "biome.1").shoulder = "#332d28";
		expect(validateManifest(m)).toEqual([
			'biomes["biome.1"].shoulder: colour difference: shoulder #332d28 vs floor #2b2722 is 3.2 (CIE76), needs >= ' +
				"4.0: the void's shoulder must never read as walkable floor",
		]);
	});

	it("fails a shoulder nearer the floor than the wall, however far from both", () => {
		const m = clone();
		// molten: black is 14.7 from the floor but 28.1 from the wall (the abyss black too: no order failure)
		biomeOf(m, "biome.2").shoulder = "#000000";
		biomeOf(m, "biome.2").abyss = "#000000";
		expect(validateManifest(m)).toEqual([
			'biomes["biome.2"].shoulder: colour difference: shoulder #000000 is 28.1 (CIE76) from wall #4a2a20 but 14.7 ' +
				"from the floor: the shoulder must sit nearer the wall than the floor (it reads as wall mass)",
		]);
	});

	it("fails a void that brightens toward the abyss (luminance order)", () => {
		const m = clone();
		biomeOf(m, "biome.4").abyss = "#3a3640";
		expect(validateManifest(m)).toEqual([
			'biomes["biome.4"].shoulder: luminance: ledge #322e38 (0.0292) is brighter than shoulder #2e2a34 (0.0248): ' +
				"the void must darken from shoulder to ledge to abyss",
			'biomes["biome.4"].abyss: luminance: abyss #3a3640 (0.0391) is brighter than ledge #322e38 (0.0292): the ' +
				"void must darken from shoulder to ledge to abyss",
		]);
	});

	it("fails a shoulder or ledge an enemy bullet does not read on", () => {
		const m = clone();
		biomeOf(m, "biome.3").shoulder = "#c8d0d8";
		expect(validateManifest(m)).toEqual([
			'biomes["biome.3"].shoulder: contrast: enemyBullet #ff3fa4 on shoulder #c8d0d8 is 2.07:1, needs >= 3.0:1: ' +
				"enemy bullets along a far wall are drawn over the void",
			'biomes["biome.3"].shoulder: contrast: enemyBullet #ff3fa4 on ledge #858f94 is 1.02:1, needs >= 3.0:1: ' +
				"enemy bullets along a far wall are drawn over the void",
		]);
	});

	it("checks the bullet at a band's light: the shoulder is dimmed, the self-lit bullet is not", () => {
		const m = clone();
		biomeOf(m, "biome.3").shoulder = "#ffffff";
		const at = (light: number) =>
			voidReport(m, light).filter(
				(e) => e.biome === "biome.3" && e.check === "bullet" && e.subject === "shoulder",
			);
		const full = at(1);
		expect(full.map((e) => [e.color, "%.2f".format(e.value), e.ok, e.light])).toEqual([
			["#ffffff", "3.23", true, 1],
		]);
		const dim = at(0.5);
		expect(dim.map((e) => [e.color, "%.2f".format(e.value), e.ok, e.light])).toEqual([
			["#bcbcbc", "1.70", false, 0.5],
		]);
	});

	it("fails an abyss that reads as an enemy bullet or a telegraph", () => {
		const m = clone();
		biomeOf(m, "biome.5").abyss = "#e01f84";
		const rows = voidReport(m).filter((e) => e.check === "abyss" && e.biome === "biome.5");
		expect(rows.map((e) => [e.against, "%.1f".format(e.value), e.ok])).toEqual([
			["enemyBullet", "10.7", false],
			["telegraph", "76.5", true],
		]);
		expect(voidColorProblems(m)).toContainEqual({
			path: ["biomes", "biome.5", "abyss"],
			msg:
				"colour difference: abyss #e01f84 vs enemyBullet #ff3fa4 is 10.7 (CIE76), needs >= 40.0: the void must " +
				"never read as an enemy bullet or a telegraph",
		});
	});

	it("skips what it cannot check (missing roles, non-hex colours) without failing", () => {
		const m = clone();
		colorsOf(m).telegraph = undefined;
		biomeOf(m, "biome.1").abyss = "nope";
		const rows = voidReport(m);
		expect(rows.filter((e) => e.against === "telegraph")).toEqual([]);
		// biome.1 without an abyss: floor, wall and the shoulder's bullet check only
		expect(rows.filter((e) => e.biome === "biome.1").map((e) => `${e.check}:${e.subject}`)).toEqual([
			"floor:shoulder",
			"wall:shoulder",
			"bullet:shoulder",
		]);
		expect(voidReport(undefined)).toEqual([]);
		expect(voidReport({ colors: {} })).toEqual([]);
	});
});

describe("void decor (docs/VOID_DECOR.md VD7)", () => {
	const voidImage = (layer: string): Obj => ({
		kind: "image",
		assetId: "rbxassetid://7001",
		w: 64,
		h: 96,
		pixelsPerTile: 32,
		layer,
	});
	const withAssets = (assets: Obj): Array<string> => {
		const m = clone();
		for (const id of sortedKeys(assets)) (m.assets as Obj)[id] = assets[id];
		return validateManifest(m);
	};

	it("lists every void kind once with layers from DECOR_LAYERS (tall shapes tall or low, short ones low, drift / chains flat)", () => {
		expect([...VOID_DECOR.kinds]).toEqual([
			"spire",
			"drift",
			"vent",
			"crag",
			"grave",
			"deadtree",
			"root",
			"bush",
			"statue",
			"cage",
			"chains",
		]);
		expect([...VOID_DECOR.kinds].sort()).toEqual(sortedKeys(VOID_DECOR.layers));
		for (const k of VOID_DECOR.kinds) {
			expect([k, k.lower()]).toEqual([k, k]);
			for (const l of VOID_DECOR.layers[k] as ReadonlyArray<string>) {
				expect([k, (DECOR_LAYERS as ReadonlyArray<string>).includes(l)]).toEqual([k, true]);
			}
		}
		for (const k of ["spire", "crag", "grave", "deadtree", "statue"] as const)
			expect([k, [...VOID_DECOR.layers[k]]]).toEqual([k, ["tall", "low"]]);
		for (const k of ["vent", "root", "bush", "cage"] as const)
			expect([k, [...VOID_DECOR.layers[k]]]).toEqual([k, ["low"]]);
		for (const k of ["drift", "chains"] as const) expect([k, [...VOID_DECOR.layers[k]]]).toEqual([k, ["flat"]]);
	});

	it("names void pieces decor.void.b<n>.<kind>[.<v>], round-tripping through parseDecorId", () => {
		expect(voidDecorId("biome.3", "spire")).toBe("decor.void.b3.spire");
		expect(voidDecorId("biome.4", "deadtree", 2)).toBe("decor.void.b4.deadtree.2");
		for (const b of BIOMES) {
			for (const kind of VOID_DECOR.kinds) {
				for (let v = 0; v <= DECOR_MAX_VARIANTS; v++) {
					const variant = v === 0 ? undefined : v;
					const id = voidDecorId(b.id, kind, variant);
					expect([id, isAssetId(id)]).toEqual([id, true]);
					expect([id, parseDecorId(id)]).toEqual([
						id,
						{ type: "void", biome: b.id, kind, variant, layers: VOID_DECOR.layers[kind] },
					]);
				}
			}
		}
		expect(DECOR_BIOME_KEYS.size()).toBe(BIOMES.size());
	});

	it("rejects unknown void kinds, bad biome numbers and bad variants", () => {
		for (const bad of [
			"decor.void.b0.spire",
			"decor.void.b6.spire",
			"decor.void.biome1.spire",
			"decor.void.b1.pillar", // a room decor kind, not a void kind
			"decor.void.b1.flagstones", // a decor.delve kind
			"decor.void.b1.Spire",
			"decor.void.b1.tree",
			"decor.void.b1.spire.0",
			"decor.void.b1.spire.5",
			"decor.void.b1.spire.x",
			"decor.void.b1.spire.1.2",
			"decor.void.b1",
			"decor.void.spire",
			"decor.delve.b1.spire", // a void kind under the room group
		]) {
			expect([bad, parseDecorId(bad)]).toEqual([bad, undefined]);
		}
		const errors = withAssets({ "decor.void.b7.spire": voidImage("tall"), "decor.void.b1.tree": voidImage("low") });
		expect(errors.size()).toBe(2);
		expect(errors[0].find('assets["decor.void.b1.tree"]: unknown decor ID', 1, true)[0]).toBe(1);
		expect(errors[1].find('assets["decor.void.b7.spire"]: unknown decor ID', 1, true)[0]).toBe(1);
	});

	it("accepts any void kind in any biome with a layer its kind allows, and rejects the others", () => {
		const ok: Obj = {};
		for (const b of BIOMES) {
			for (const kind of VOID_DECOR.kinds) ok[voidDecorId(b.id, kind)] = voidImage(VOID_DECOR.layers[kind][0]);
		}
		ok[voidDecorId("biome.2", "vent", 3)] = voidImage("low");
		expect(withAssets(ok)).toEqual([]);
		expect(
			withAssets({ "decor.void.b3.drift": voidImage("tall"), "decor.void.b2.vent": voidImage("wall") }),
		).toEqual([
			'assets["decor.void.b2.vent"].layer: "wall" is not allowed for "vent" (allowed: low)',
			'assets["decor.void.b3.drift"].layer: "tall" is not allowed for "drift" (allowed: flat)',
		]);
		const noLayer = voidImage("low");
		noLayer.layer = undefined;
		expect(withAssets({ "decor.void.b5.bush": noLayer })).toEqual([
			'assets["decor.void.b5.bush"].layer: missing: a decor piece needs a layer ("bush": "low")',
		]);
	});

	it("the bundled packs validate without any void art (it is optional)", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			expect([id, validateManifest(THEME_PACKS[id], { packId: id })]).toEqual([id, []]);
		}
	});

	it("looks up void art per biome and kind (base, then variants), empty and silent when absent", () => {
		const m = clone();
		const a = m.assets as Obj;
		a["decor.void.b3.spire"] = voidImage("tall");
		a["decor.void.b3.spire.2"] = voidImage("low");
		a["decor.void.b3.drift.1"] = voidImage("flat");
		a["decor.void.b4.grave"] = voidImage("wall"); // a bad layer: not drawn, warned once
		const w = sink();
		const core = new ThemeCore(m, { warn: w.warn });
		expect(core.voidDecorVariants("biome.3", "spire").map((d) => [d.id, d.layer])).toEqual([
			["decor.void.b3.spire", "tall"],
			["decor.void.b3.spire.2", "low"],
		]);
		expect(core.voidDecorVariants("biome.3", "drift").map((d) => d.id)).toEqual(["decor.void.b3.drift.1"]);
		expect(core.voidDecorVariants("biome.1", "spire")).toEqual([]);
		expect(core.voidDecorVariants("biome.4", "grave")).toEqual([]);
		expect(w.messages).toEqual([
			'[theme:placeholder] decor "decor.void.b4.grave" has layer "wall", grave allows tall | low; not drawn',
		]);
		const pack = new ThemePack(m, { warn: () => undefined });
		const pieces = pack.voidDecorVariants("biome.3", "spire");
		expect(pieces.map((p) => [p.id, p.layer, p.art.kind])).toEqual([
			["decor.void.b3.spire", "tall", "image"],
			["decor.void.b3.spire.2", "low", "image"],
		]);
		const silent = sink();
		const placeholder = new ThemePack(PLACEHOLDER_MANIFEST, { warn: silent.warn });
		for (const b of BIOMES) {
			for (const kind of VOID_DECOR.kinds) expect(placeholder.voidDecorVariants(b.id, kind)).toEqual([]);
		}
		expect(silent.messages).toEqual([]);
	});
});

describe("void dressing decor kinds (docs/VOID_DECOR.md VD7)", () => {
	it("flagstones (flat) is a standard decor kind, appended after the Forge's; curb is not one (VDD10: no wall props)", () => {
		const n = DECOR_KINDS.size();
		expect(DECOR_KINDS[n - 7]).toBe("flagstones");
		expect(DECOR_KINDS[n - 6]).toBe("chandelier"); // scattered (docs/DECOR.md "3D kits")
		expect([DECOR_KINDS[n - 5], DECOR_KINDS[n - 4]]).toEqual(["tomb", "candelabrum"]); // solid decor
		// room themes (docs/DECOR.md "Room themes"), last
		expect([DECOR_KINDS[n - 3], DECOR_KINDS[n - 2], DECOR_KINDS[n - 1]]).toEqual(["throne", "statue", "carpet"]);
		expect(DECOR_KINDS.includes("curb" as never)).toBe(false);
		expect(decorId("biome.1", "flagstones")).toBe("decor.delve.b1.flagstones");
	});

	it("validate with their layers and reject the others", () => {
		const image = (layer: string): Obj => ({
			kind: "image",
			assetId: "rbxassetid://7002",
			w: 64,
			h: 32,
			pixelsPerTile: 32,
			layer,
		});
		const m = clone();
		const a = m.assets as Obj;
		a["decor.delve.b1.flagstones"] = image("flat");
		expect(validateManifest(m)).toEqual([]);
		a["decor.delve.b1.flagstones"] = image("low");
		expect(validateManifest(m)).toEqual([
			'assets["decor.delve.b1.flagstones"].layer: "low" is not allowed for "flagstones" (allowed: flat)',
		]);
	});
});
