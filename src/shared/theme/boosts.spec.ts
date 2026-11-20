// Roblox port (docs/BOOSTS.md B5): the boost drops' theme contract. The BOOST slot (required world art, a placeholder
// gem), the kinds and their ID / string helpers, the colour roles and their validator rules (WCAG contrast on every
// biome floor and wall, CIE76 distance from the enemy-bullet roles: the enemy outline's), the four sounds, the optional
// effects, the placeholder pack's entries (inherited by vale) and the runtime lookups.
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio } from "./color";
import {
	BIOMES,
	BOOST,
	BOOST_COLLECT_FX_ID,
	BOOST_FX_IDS,
	BOOST_KINDS,
	BOOST_ROLES,
	BOOST_STRING_FIELDS,
	BOOST_STRING_KEYS,
	BOOST_TOAST_KEY,
	ENEMY_BULLET_ROLES,
	FX,
	FX_IDS,
	MIN_BOOST_BULLET_DIFFERENCE,
	MIN_BOOST_CONTRAST,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	SLOTS,
	WORLD_ART_SLOTS,
	boostAuraFxId,
	boostId,
	boostStringKey,
	isBoostId,
	isFxId,
	requiredBaseAnimations,
	slotFor,
} from "./contract";
import { MISSING_COLOR } from "./core";
import { ThemePack, hexToColor3 } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { VALE_ASSET_IDS } from "./packs/vale/assetIds";
import { PLACEHOLDER_VISUALS, pxToStuds } from "./placeholders";
import { runOf } from "./testing";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, startsWith, type Obj } from "./util";
import { boostColorReport, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const assetsOf = (m: Obj) => m.assets as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;
const stringsOf = (m: Obj) => m.strings as Obj;

const sink = () => {
	const messages = new Array<string>();
	return { messages, warn: (m: string) => messages.push(m) };
};

/** The placeholder pack's boost colours (docs/BOOSTS.md B5: gold, aqua, lime, lavender). */
const PLACEHOLDER_BOOST_HEX = {
	fury: "#ffc83d",
	quickstep: "#3ff0d8",
	frenzy: "#a8f03c",
	aegis: "#c3a6ff",
} as const;

describe("boosts: contract", () => {
	it("lists the kinds in the sim's Boost index order, with their ID and string helpers", () => {
		expect(BOOST_KINDS).toEqual(["fury", "quickstep", "frenzy", "aegis"]);
		expect(BOOST_KINDS.map((k) => boostId(k))).toEqual([
			"boost.fury",
			"boost.quickstep",
			"boost.frenzy",
			"boost.aegis",
		]);
		expect(BOOST_STRING_FIELDS).toEqual(["name", "desc", "icon"]);
		expect(boostStringKey("frenzy", "desc")).toBe("boost.frenzy.desc");
		expect(BOOST_TOAST_KEY).toBe("hud.toast.boost");
		expect([
			isBoostId("boost.aegis"),
			isBoostId("boost.haste"),
			isBoostId("boost"),
			isBoostId("fx.boost.collect"),
		]).toEqual([true, false, false, false]);
	});

	it("adds a required world-art slot (image, sprites with idle, or a placeholder)", () => {
		expect([BOOST.prefix, BOOST.kinds, BOOST.cell, BOOST.facings, BOOST.soundGroup]).toEqual([
			"boost.",
			["image", "sprites", "placeholder"],
			undefined,
			[],
		]);
		expect(SLOTS.includes(BOOST)).toBe(true);
		expect(WORLD_ART_SLOTS.includes(BOOST)).toBe(true);
		expect(requiredBaseAnimations(BOOST)).toEqual(["idle"]);
		for (const k of BOOST_KINDS) {
			expect([k, slotFor(boostId(k)), REQUIRED_ASSET_IDS.includes(boostId(k))]).toEqual([k, BOOST, true]);
		}
		// "boss." and "boost." never route to each other
		expect(slotFor("boss.act1")?.slot).toBe("boss");
	});

	it("requires every kind's name / desc / icon and the toast, in kind order", () => {
		const want = new Array<string>();
		for (const k of BOOST_KINDS) for (const f of BOOST_STRING_FIELDS) want.push(`boost.${k}.${f}`);
		want.push("hud.toast.boost");
		expect([...BOOST_STRING_KEYS]).toEqual(want);
		for (const key of want) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
	});

	it("appends the four boost sounds to the port's audio IDs, in order", () => {
		// after sfx.boss.taunt (docs/BOSS_DEMONLORD.md D6); later features append after them (docs/ROOM_CLEAR.md RC4, docs/COMBO.md CB3)
		const first = (PORT_AUDIO_EVENTS as ReadonlyArray<string>).indexOf("sfx.boss.taunt") + 1;
		const n = first + 4;
		expect([
			PORT_AUDIO_EVENTS[first],
			PORT_AUDIO_EVENTS[first + 1],
			PORT_AUDIO_EVENTS[first + 2],
			PORT_AUDIO_EVENTS[first + 3],
		]).toEqual(["sfx.boost.drop", "sfx.boost.collect", "sfx.boost.expire", "sfx.boost.aegisbreak"]);
		for (let i = first; i < n; i++) {
			const id = PORT_AUDIO_EVENTS[i];
			expect([id, slotFor(id)?.soundGroup, REQUIRED_ASSET_IDS.includes(id)]).toEqual([id, "sfx", true]);
		}
	});

	it("appends sfx.breakable.loot after the Daily's sounds (docs/BREAKABLE_DROPS.md BL5): required, sfx, SILENT in the placeholder, a sound in vale", () => {
		// Right after the Daily's `sfx.friend.passed`; later features' sounds follow.
		const pair = ["sfx.friend.passed", "sfx.breakable.loot"];
		expect(runOf(PORT_AUDIO_EVENTS, pair)).toEqual(pair);
		const id = "sfx.breakable.loot";
		const assets = PLACEHOLDER_MANIFEST.assets as unknown as Record<string, { kind: string }>;
		expect([slotFor(id)?.soundGroup, REQUIRED_ASSET_IDS.includes(id), assets[id].kind]).toEqual([
			"sfx",
			true,
			"silent",
		]);
		// BL7: the vale pack plays its own clip, picked on the audition checklist and uploaded 2026-11-11 (docs/FX_AUDIO.md
		// "Sourcing the remaining silent IDs")
		expect(THEME_PACKS.vale.assets[id]?.kind).toBe("sound");
	});

	it("adds one colour role per kind, held to the enemy outline's bars", () => {
		expect([...BOOST_ROLES]).toEqual(BOOST_KINDS.map((k) => boostId(k)));
		const roles = new Set<string>(COLOR_ROLES);
		for (const r of BOOST_ROLES) expect([r, roles.has(r)]).toEqual([r, true]);
		expect([MIN_BOOST_CONTRAST, MIN_BOOST_BULLET_DIFFERENCE]).toEqual([3, 40]);
	});

	it("adds optional effects under the fx rules: the pickup burst and one aura per kind", () => {
		expect([...BOOST_FX_IDS]).toEqual([
			"fx.boost.collect",
			"fx.boost.aura.fury",
			"fx.boost.aura.quickstep",
			"fx.boost.aura.frenzy",
			"fx.boost.aura.aegis",
		]);
		expect(BOOST_COLLECT_FX_ID).toBe("fx.boost.collect");
		expect(BOOST_KINDS.map((k) => boostAuraFxId(k))).toEqual([
			"fx.boost.aura.fury",
			"fx.boost.aura.quickstep",
			"fx.boost.aura.frenzy",
			"fx.boost.aura.aegis",
		]);
		for (const id of BOOST_FX_IDS) {
			expect([id, slotFor(id), isFxId(id), FX_IDS.includes(id), REQUIRED_ASSET_IDS.includes(id)]).toEqual([
				id,
				FX,
				true,
				true,
				false,
			]);
		}
	});
});

describe("boosts: placeholder pack (and every bundled pack)", () => {
	it("draws each kind as a small gem in its own colour role, smaller than a breakable", () => {
		for (const k of BOOST_KINDS) {
			const id = boostId(k);
			expect([id, PLACEHOLDER_MANIFEST.assets[id]]).toEqual([id, { kind: "placeholder" }]);
			const v = PLACEHOLDER_VISUALS[id];
			expect(v).toMatchObject({
				shape: "Diamond",
				material: "SmoothPlastic",
				color: { kind: "role", role: id },
				anchor: "base",
				faces: false,
			});
			expect(v.outline).toBe(undefined);
			expect(v.size).toEqual([pxToStuds(8), pxToStuds(10), pxToStuds(8)]);
			expect([id, v.size[1] <= PLACEHOLDER_VISUALS["breakable.barrel"].size[1]]).toEqual([id, true]);
			expect([id, v.size[0] < PLACEHOLDER_VISUALS["breakable.crate"].size[0]]).toEqual([id, true]);
		}
	});

	it("gives distinct colours, inherited by every bundled pack (vale draws its art once the file has an ID)", () => {
		for (const k of BOOST_KINDS) {
			expect([k, PLACEHOLDER_MANIFEST.colors[boostId(k)]]).toEqual([k, PLACEHOLDER_BOOST_HEX[k]]);
			for (const other of BOOST_KINDS) {
				if (other === k) continue;
				const d = colorDifference(PLACEHOLDER_BOOST_HEX[k], PLACEHOLDER_BOOST_HEX[other]);
				expect([k, other, d >= MIN_BOOST_BULLET_DIFFERENCE]).toEqual([k, other, true]);
			}
		}
		for (const id of sortedKeys(THEME_PACKS)) {
			for (const k of BOOST_KINDS) {
				expect([id, k, THEME_PACKS[id].colors[boostId(k)]]).toEqual([id, k, PLACEHOLDER_BOOST_HEX[k]]);
				// The vale pack switches a kind to its Lords of Pain image once boost-<kind>.png has an ID (BOOST_ART.md BA4);
				// every other bundled pack keeps the placeholder gem.
				const uploaded = id === "vale" && VALE_ASSET_IDS[`boost-${k}.png`] !== undefined;
				expect([id, k, THEME_PACKS[id].assets[boostId(k)]?.kind]).toEqual([
					id,
					k,
					uploaded ? "image" : "placeholder",
				]);
			}
		}
	});

	it("has the player-facing strings, short distinct icon labels and the toast", () => {
		const s = PLACEHOLDER_MANIFEST.strings;
		expect(BOOST_KINDS.map((k) => s[boostStringKey(k, "name")])).toEqual(["Fury", "Quickstep", "Frenzy", "Aegis"]);
		expect(BOOST_KINDS.map((k) => s[boostStringKey(k, "desc")])).toEqual([
			"+50% damage for 30 s",
			"+30% walk speed for 30 s",
			"30% faster attacks for 30 s",
			"+1 armor pip for 45 s or one hit",
		]);
		// icon labels: 3 characters like the boons' / relics' / curses', none of theirs reused
		const others = new Set<string>();
		for (const key of sortedKeys(s)) {
			if (key.sub(-5) === ".icon" && !startsWith(key, "boost.")) others.add(s[key]);
		}
		const icons = new Set<string>();
		for (const k of BOOST_KINDS) {
			const icon = s[boostStringKey(k, "icon")];
			expect([k, icon.size(), others.has(icon), icons.has(icon)]).toEqual([k, 3, false, false]);
			icons.add(icon);
		}
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: sink().warn });
		const fury = pack.boost("fury");
		expect(pack.str(BOOST_TOAST_KEY, { name: pack.str(fury.nameKey), desc: pack.str(fury.descKey) })).toBe(
			"Fury: +50% damage for 30 s",
		);
		// The tutorial's boost lesson is a step (docs/BOOSTS.md B9): a prompt per device, no callout any more.
		for (const d of ["keyboard", "gamepad", "touch"]) {
			expect(s[`tutorial.prompt.boost.${d}`]).toBe(
				"A boost! Walk over it before it fades: it powers you up for a few seconds.",
			);
		}
		expect(s["tutorial.callout.boost"]).toBe(undefined);
	});

	it("keeps the four boost sounds silent", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: sink().warn });
		for (const id of ["sfx.boost.drop", "sfx.boost.collect", "sfx.boost.expire", "sfx.boost.aegisbreak"]) {
			expect([id, PLACEHOLDER_MANIFEST.assets[id]]).toEqual([id, { kind: "silent" }]);
			expect(pack.sound(id)).toEqual({ assetId: undefined, volume: 0, group: "sfx", variants: [] });
		}
	});
});

describe("boosts: validator", () => {
	it("the bundled packs validate clean, every role vs every floor / wall and bullet role in the report", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			const manifest = THEME_PACKS[id];
			expect([id, validateManifest(manifest, { packId: id })]).toEqual([id, []]);
			const report = boostColorReport(manifest);
			expect([id, report.size()]).toEqual([
				id,
				BOOST_ROLES.size() * (BIOMES.size() * 2 + ENEMY_BULLET_ROLES.size()),
			]);
			for (const e of report) {
				expect([id, e.role, e.check, e.against, e.surface, e.ok]).toEqual([
					id,
					e.role,
					e.check,
					e.against,
					e.surface,
					true,
				]);
				if (e.check === "surface") {
					expect(e.value).toBe(contrastRatio(e.color, e.againstColor));
					expect(e.min).toBe(MIN_BOOST_CONTRAST);
				} else {
					expect(e.value).toBe(colorDifference(e.color, e.againstColor));
					expect(e.min).toBe(MIN_BOOST_BULLET_DIFFERENCE);
				}
			}
			const bullets = report.filter((e) => e.check === "bullet" && e.role === "boost.fury");
			expect(bullets.map((e) => e.against)).toEqual([...ENEMY_BULLET_ROLES]);
			// as measured (docs/BOOSTS.md B5): the worst case is aegis, 59.4 from enemyBullet and 5.86:1 on the placeholder
			// frost wall #2a3842; 5.72:1 on the vale frost wall texture's mean #303941 (docs/ART.md "As built: frost
			// tiles"). The rule itself is MIN_BOOST_CONTRAST (3:1); this pins the measured margin
			let minDifference = math.huge;
			let minContrast = math.huge;
			for (const e of report) {
				if (e.check === "bullet") minDifference = math.min(minDifference, e.value);
				else minContrast = math.min(minContrast, e.value);
			}
			expect([id, minDifference > 59, minContrast > 5.7]).toEqual([id, true, true]);
		}
	});

	it("rejects a boost colour too close to the enemy bullet", () => {
		const m = clone();
		colorsOf(m)["boost.aegis"] = "#ff3fa0";
		const d = colorDifference("#ff3fa0", "#ff3fa4");
		expect(d).toBeLessThan(MIN_BOOST_BULLET_DIFFERENCE);
		expect(validateManifest(m)).toEqual([
			`colors["boost.aegis"]: colour difference: boost.aegis #ff3fa0 vs enemyBullet #ff3fa4 is ${"%.1f".format(
				d,
			)} (CIE76), needs >= 40.0: a boost drop must never read as an enemy bullet`,
		]);
	});

	it("rejects a boost colour that does not read on a floor or wall, per biome surface", () => {
		const m = clone();
		const floor = PLACEHOLDER_MANIFEST.biomes["biome.1"].floor;
		colorsOf(m)["boost.fury"] = floor;
		const errors = validateManifest(m);
		expect(errors.size()).toBeGreaterThan(0);
		for (const e of errors) expect([e, startsWith(e, 'colors["boost.fury"]: ')]).toEqual([e, true]);
		expect(errors).toContain(
			`colors["boost.fury"]: contrast: boost.fury ${floor} on biome.1 (ancient) floor ${floor} is 1.00:1, needs >= 3.0:1`,
		);
		// a dim colour that passes the bullet rule still fails the 3:1 bar
		const dim = clone();
		colorsOf(dim)["boost.frenzy"] = "#3a5a1a";
		expect(colorDifference("#3a5a1a", "#ff3fa4")).toBeGreaterThan(MIN_BOOST_BULLET_DIFFERENCE);
		// (other roles held apart from the boosts may flag the planted colour too: docs/NEW_ENEMIES_2.md's dull bronze
		// guard, `colors.enemyGuard`, is 31.7 CIE76 from it, docs/NEW_ENEMIES_3.md's moss-green heal, `colors.enemyHeal`,
		// is near it too; only the boost's own errors are counted here)
		const dimErrors = validateManifest(dim).filter(
			(e) => !startsWith(e, "colors.enemyGuard") && !startsWith(e, "colors.enemyHeal"),
		);
		expect(dimErrors.size()).toBe(BIOMES.size() * 2);
		for (const e of dimErrors) expect([e, startsWith(e, 'colors["boost.frenzy"]: contrast: ')]).toEqual([e, true]);
	});

	it("requires every kind's asset, colour, strings, the toast and the sounds", () => {
		const m = clone();
		assetsOf(m)["boost.frenzy"] = undefined;
		assetsOf(m)["sfx.boost.aegisbreak"] = undefined;
		colorsOf(m)["boost.quickstep"] = undefined;
		stringsOf(m)["boost.aegis.icon"] = undefined;
		stringsOf(m)["hud.toast.boost"] = undefined;
		expect(validateManifest(m)).toEqual([
			'strings: missing required string "boost.aegis.icon"',
			'strings: missing required string "hud.toast.boost"',
			'colors: missing color role "boost.quickstep"',
			'assets: missing required asset "sfx.boost.aegisbreak" (slot sfx)',
			'assets: missing required asset "boost.frenzy" (slot boost)',
		]);
		expect(boostColorReport(m).filter((e) => e.role === "boost.quickstep")).toEqual([]);
	});

	it("rejects an unknown boost ID", () => {
		const m = clone();
		assetsOf(m)["boost.haste"] = { kind: "placeholder" };
		expect(validateManifest(m)).toEqual([
			'assets["boost.haste"]: unknown boost ID (known: boost.fury, boost.quickstep, boost.frenzy, boost.aegis)',
		]);
	});

	it("accepts world art (an image with pixelsPerTile, a sprite set with idle) and rejects decor fields", () => {
		const gem = (extra: Obj = {}): Obj => {
			const out: Obj = { kind: "image", assetId: "rbxassetid://8001", w: 64, h: 64, pixelsPerTile: 32 };
			for (const k of sortedKeys(extra)) out[k] = extra[k];
			return out;
		};
		// boost art needs the halo (docs/BOOST_ART.md BA-P2; validate.spec covers the rule)
		const halo: Obj = { kind: "image", assetId: "rbxassetid://8003", w: 72, h: 72, pixelsPerTile: 32 };
		const ok = clone();
		assetsOf(ok)["decor.fx.glow"] = halo;
		assetsOf(ok)["boost.fury"] = gem({ rect: { x: 16, y: 0, w: 16, h: 16 }, pivot: { x: 8, y: 16 } });
		assetsOf(ok)["boost.aegis"] = {
			kind: "sprites",
			frameW: 16,
			frameH: 16,
			pivot: { x: 8, y: 16 },
			pixelsPerTile: 32,
			resample: "Pixelated",
			facings: { count: 1, zeroDeg: 0, ccw: true },
			sheets: [{ assetId: "rbxassetid://8002", w: 64, h: 16 }],
			animations: { idle: { sheet: 0, start: 0, frames: 4, fps: 8, loop: true } },
		};
		expect(validateManifest(ok)).toEqual([]);
		const bad = clone();
		assetsOf(bad)["decor.fx.glow"] = halo;
		assetsOf(bad)["boost.fury"] = gem({ layer: "low", pixelsPerTile: 0 });
		expect(validateManifest(bad)).toEqual([
			'assets["boost.fury"].layer: unknown key (allowed: kind, assetId, w, h, rect, pivot, pixelsPerTile)',
			'assets["boost.fury"].pixelsPerTile: must be a number > 0 (art pixels per world tile)',
		]);
	});
});

describe("boosts: ThemeCore / ThemePack lookups", () => {
	it("draws the placeholder pack's boosts as gems in their roles, with string keys, without warnings", () => {
		const w = sink();
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: w.warn });
		for (const k of BOOST_KINDS) {
			const b = pack.boost(k);
			expect(pack.boost(k)).toBe(b);
			expect([b.kind, b.id, b.nameKey, b.descKey, b.iconKey, b.art]).toEqual([
				k,
				`boost.${k}`,
				`boost.${k}.name`,
				`boost.${k}.desc`,
				`boost.${k}.icon`,
				undefined,
			]);
			expect(b.core.role).toBe(b.id);
			expect(b.placeholder).toBe(PLACEHOLDER_VISUALS[b.id]);
			expect(b.color).toEqual(hexToColor3(PLACEHOLDER_BOOST_HEX[k]));
			for (const key of [b.nameKey, b.descKey, b.iconKey]) expect(pack.hasString(key)).toBe(true);
		}
		for (const id of BOOST_FX_IDS) expect([id, pack.fx(id)]).toEqual([id, undefined]);
		expect(w.messages).toEqual([]);
	});

	it("draws uploaded art when there is some, and warns once (magenta) when the pack lacks the ID", () => {
		const m = clone();
		assetsOf(m)["boost.fury"] = {
			kind: "image",
			assetId: "rbxassetid://8001",
			w: 64,
			h: 64,
			rect: { x: 16, y: 0, w: 16, h: 16 },
			pixelsPerTile: 32,
		};
		assetsOf(m)["boost.aegis"] = undefined;
		const w = sink();
		const pack = new ThemePack(m, { warn: w.warn });
		expect(pack.boost("fury").art).toMatchObject({
			kind: "image",
			image: "rbxassetid://8001",
			pixelsPerTile: 32,
			pivot: { x: 8, y: 16 },
		});
		const aegis = pack.boost("aegis");
		expect(aegis.art).toBe(undefined);
		expect(aegis.placeholder.color).toEqual({ kind: "missing" });
		expect(pack.visualHex(aegis.placeholder.color)).toBe(MISSING_COLOR);
		expect(w.messages).toEqual(['[theme:placeholder] missing asset "boost.aegis", using the placeholder']);
	});
});
