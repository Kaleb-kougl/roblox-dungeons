// Roblox port (docs/FX_AUDIO.md F1): the sprite-effect slot (fx.*). Contract, the validator's shape, size and colour
// rules, and the runtime lookups (ThemeCore.fx, ThemePack.fx).
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference } from "./color";
import {
	ENEMY_BULLET_ROLES,
	FX,
	FX_ANIMATION,
	FX_IDS,
	FX_ROLES,
	FX_SPRITE_MAX_TILES,
	MIN_DECOR_FX_BULLET_DIFFERENCE,
	MIN_FX_BULLET_DIFFERENCE,
	REQUIRED_ASSET_IDS,
	SLOTS,
	isFxId,
	requiredBaseAnimations,
	slotFor,
	type FxId,
} from "./contract";
import { ThemeCore } from "./core";
import { ThemePack, hexToColor3 } from "./pack";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { COLOR_ROLES } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";
import { fxColorReport, isGameplayKey, validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const assetsOf = (m: Obj) => m.assets as Obj;
const colorsOf = (m: Obj) => m.colors as Obj;

/** The placeholder pack plus `assets`. */
function manifestWith(assets: Obj): Obj {
	const m = clone();
	for (const id of sortedKeys(assets)) {
		assetsOf(m)[id] = assets[id];
	}
	return m;
}
const withAssets = (assets: Obj) => validateManifest(manifestWith(assets));

/** `out` with `overrides` applied and the `omit` keys removed. */
function edited(out: Obj, overrides: Obj, omit: ReadonlyArray<string>): Obj {
	for (const k of sortedKeys(overrides)) {
		out[k] = overrides[k];
	}
	for (const k of omit) {
		out[k] = undefined;
	}
	return out;
}

/** A valid effect: a 4-frame hit mark in 32x32 cells (one 128x32 strip), one tile, tinted, additive. */
function hitMark(overrides: Obj = {}, ...omit: Array<string>): Obj {
	const out: Obj = {
		kind: "sprites",
		frameW: 32,
		frameH: 32,
		pivot: { x: 16, y: 16 },
		pixelsPerTile: 32,
		resample: "Pixelated",
		facings: { count: 1, zeroDeg: 0, ccw: true },
		sheets: [{ assetId: "rbxassetid://7001", w: 128, h: 32 }],
		animations: { play: { sheet: 0, start: 0, frames: 4, fps: 12, loop: false } },
		sizeTiles: 0.75,
		tint: "damageNumber",
		additive: true,
	};
	return edited(out, overrides, omit);
}

const sink = () => {
	const messages = new Array<string>();
	return { messages, warn: (m: string) => messages.push(m) };
};

const SET_KEYS = "kind, frameW, frameH, pivot, pixelsPerTile, resample, facings, sheets, animations";

describe("fx contract", () => {
	it("adds an optional sprites-only slot whose sets play one animation", () => {
		expect([FX.prefix, FX.kinds, FX.cell, FX.facings, FX.soundGroup]).toEqual(["fx.", ["sprites"], undefined, []]);
		expect(SLOTS.includes(FX)).toBe(true);
		expect(FX_ANIMATION).toBe("play");
		expect(requiredBaseAnimations(FX)).toEqual(["play"]);
		for (const id of REQUIRED_ASSET_IDS) {
			expect([id, slotFor(id) === FX]).toEqual([id, false]);
		}
	});

	it("lists every effect ID once, each in the slot", () => {
		expect(FX_IDS).toEqual([
			"fx.hit.light",
			"fx.hit.heavy",
			"fx.swing.1",
			"fx.swing.2",
			"fx.swing.3",
			"fx.death.puff",
			"fx.roll.dust",
			"fx.guard.shield",
			"fx.ember.ring",
			"fx.flask",
			"fx.boss.phase",
			"fx.boss.slam",
			"fx.boss.death",
			"fx.relic.take",
			"fx.shrine.use",
			"fx.stairwell",
			"fx.breakable.splinter",
			"fx.boost.collect",
			"fx.boost.aura.fury",
			"fx.boost.aura.quickstep",
			"fx.boost.aura.frenzy",
			"fx.boost.aura.aegis",
		]);
		expect(new Set<string>(FX_IDS).size()).toBe(FX_IDS.size());
		for (const id of FX_IDS) {
			expect([id, slotFor(id), isFxId(id)]).toEqual([id, FX, true]);
		}
		expect([isFxId("fx.swing.4"), isFxId("fx.hit"), isFxId("fx.settings.title")]).toEqual([false, false, false]);
	});

	it("adds the heal and curse roles, held to the decor fx colour rule", () => {
		expect(FX_ROLES).toEqual(["fx.heal", "fx.curse"]);
		const roles = new Set<string>(COLOR_ROLES);
		for (const r of FX_ROLES) {
			expect([r, roles.has(r)]).toEqual([r, true]);
		}
		expect(MIN_FX_BULLET_DIFFERENCE).toBe(MIN_DECOR_FX_BULLET_DIFFERENCE);
		expect(FX_SPRITE_MAX_TILES).toBe(3);
	});

	it("keeps the fx fields out of the gameplay-key scan", () => {
		for (const k of ["sizeTiles", "tint", "additive", "meanColor"]) {
			expect([k, isGameplayKey(k)]).toEqual([k, false]);
		}
	});
});

describe("validateManifest: fx entries", () => {
	it("every bundled pack ships no effects, keeps the fx roles far from enemy bullets and validates clean", () => {
		for (const id of sortedKeys(THEME_PACKS)) {
			for (const asset of sortedKeys(THEME_PACKS[id].assets)) {
				expect([id, asset, slotFor(asset) === FX]).toEqual([id, asset, false]);
			}
			const report = fxColorReport(THEME_PACKS[id]);
			expect([id, report.size()]).toEqual([id, FX_ROLES.size() * ENEMY_BULLET_ROLES.size()]);
			for (const e of report) {
				expect([id, e.source, e.subject, e.against, e.ok]).toEqual([id, "role", e.subject, e.against, true]);
				expect(e.difference).toBe(colorDifference(e.color, e.againstColor));
			}
			expect([id, validateManifest(THEME_PACKS[id], { packId: id })]).toEqual([id, []]);
		}
	});

	it("accepts a full entry, one sized by its cell, an untinted one with a mean colour, and a loop", () => {
		expect(
			withAssets({
				"fx.hit.light": hitMark(),
				"fx.roll.dust": hitMark({}, "sizeTiles", "additive"),
				"fx.boss.slam": hitMark({ meanColor: "#7a5a3a", sizeTiles: FX_SPRITE_MAX_TILES }, "tint"),
				"fx.stairwell": hitMark({
					tint: "decor.fx.zone",
					animations: { play: { sheet: 0, start: 0, frames: 4, fps: 8, loop: true } },
				}),
			}),
		).toEqual([]);
	});

	it("rejects IDs outside FX_IDS and kinds other than sprites", () => {
		const known = FX_IDS.join(", ");
		expect(
			withAssets({
				"fx.swing.4": hitMark(),
				"fx.hit.medium": hitMark(),
				"fx.flask": { kind: "image", assetId: "rbxassetid://7002", w: 32, h: 32 },
				"fx.ember.ring": { kind: "placeholder" },
			}),
		).toEqual([
			'assets["fx.ember.ring"].kind: slot "fx" accepts kind "sprites", got "placeholder"',
			'assets["fx.flask"].kind: slot "fx" accepts kind "sprites", got "image"',
			`assets["fx.hit.medium"]: unknown fx ID (known: ${known})`,
			`assets["fx.swing.4"]: unknown fx ID (known: ${known})`,
		]);
	});

	it("draws in one facing and needs the play animation", () => {
		expect(
			withAssets({
				"fx.flask": hitMark({
					facings: { count: 4, zeroDeg: 0, ccw: true },
					sheets: [{ assetId: "rbxassetid://7001", w: 512, h: 32 }],
				}),
			}),
		).toEqual(['assets["fx.flask"].facings.count: an effect is drawn in one facing: must be 1, got 4']);
		expect(
			withAssets({
				"fx.flask": hitMark({ animations: { idle: { sheet: 0, start: 0, frames: 4, fps: 12, loop: false } } }),
			}),
		).toEqual(['assets["fx.flask"].animations: sprite contract: missing animation "play" (>= 1 frame)']);
	});

	it("caps the drawn size at FX_SPRITE_MAX_TILES, declared or derived from the cell", () => {
		const range = `must be a number in (0, ${FX_SPRITE_MAX_TILES}] (tiles: effects stay small)`;
		expect(withAssets({ "fx.flask": hitMark({ sizeTiles: 3.5 }) })).toEqual([
			`assets["fx.flask"].sizeTiles: ${range}, got 3.5`,
		]);
		expect(withAssets({ "fx.flask": hitMark({ sizeTiles: 0 }) })).toEqual([
			`assets["fx.flask"].sizeTiles: ${range}, got 0`,
		]);
		expect(withAssets({ "fx.flask": hitMark({ sizeTiles: "1" }) })).toEqual([
			`assets["fx.flask"].sizeTiles: ${range}, got "1"`,
		]);
		// 32 px cells at 8 px per tile would be drawn 4 tiles across.
		expect(withAssets({ "fx.flask": hitMark({ pixelsPerTile: 8 }, "sizeTiles") })).toEqual([
			'assets["fx.flask"]: drawn 4.00 tiles (cell 32 px / pixelsPerTile 8), more than 3: set sizeTiles or raise pixelsPerTile',
		]);
		// sizeTiles overrides the cell's own size
		expect(withAssets({ "fx.flask": hitMark({ pixelsPerTile: 8, sizeTiles: 1 }) })).toEqual([]);
	});

	it("checks tint, additive and meanColor", () => {
		expect(
			withAssets({ "fx.flask": hitMark({ tint: "heal", additive: "yes", meanColor: "green" }, "sizeTiles") }),
		).toEqual([
			'assets["fx.flask"].tint: must be a colour role (COLOR_ROLES), got "heal"',
			'assets["fx.flask"].additive: must be true or false',
			'assets["fx.flask"].meanColor: must be "#rrggbb", got "green"',
		]);
	});

	it("needs a meanColor on an untinted entry (else the enemy-bullet rule would check nothing)", () => {
		const msg =
			"an untinted effect needs its sheet's meanColor (art:build writes it) for the enemy-bullet colour rule; or set a tint";
		expect(withAssets({ "fx.boss.slam": hitMark({}, "tint") })).toEqual([`assets["fx.boss.slam"]: ${msg}`]);
		expect(withAssets({ "fx.roll.dust": hitMark({}, "sizeTiles", "tint", "additive") })).toEqual([
			`assets["fx.roll.dust"]: ${msg}`,
		]);
		// a malformed meanColor is its own error, once
		expect(withAssets({ "fx.boss.slam": hitMark({ meanColor: "brown" }, "tint") })).toEqual([
			'assets["fx.boss.slam"].meanColor: must be "#rrggbb", got "brown"',
		]);
		expect(withAssets({ "fx.boss.slam": hitMark({ meanColor: "#7a5a3a" }, "tint") })).toEqual([]);
	});

	it("rejects the fx fields on other sprite sets", () => {
		const errors = withAssets({ "decor.fx.glow": hitMark({}, "sizeTiles") });
		const unknown = (k: string) =>
			`assets["decor.fx.glow"].${k}: unknown key (allowed: ${SET_KEYS}, glow, glowAt, emissive)`;
		expect([errors.includes(unknown("tint")), errors.includes(unknown("additive"))]).toEqual([true, true]);
	});

	it("keeps every tint, untinted mean colour and fx role away from the enemy-bullet colours", () => {
		const m = manifestWith({
			"fx.hit.light": hitMark({ tint: "enemyBullet" }),
			"fx.boss.slam": hitMark({ meanColor: "#ff40a0" }, "tint"),
			// tinted: its mean colour is not what is drawn, so it is not checked
			"fx.boss.death": hitMark({ meanColor: "#ff40a0" }),
		});
		colorsOf(m)["fx.curse"] = "#e03090";
		const dBullet = (c: string) => "%.1f".format(colorDifference(c, "#ff3fa4"));
		const tail = "needs >= 40.0: effects must never read as an enemy bullet";
		expect(validateManifest(m)).toEqual([
			`colors["fx.curse"]: colour difference: fx.curse #e03090 vs enemyBullet #ff3fa4 is ${dBullet(
				"#e03090",
			)} (CIE76), ${tail}`,
			`assets["fx.boss.slam"].meanColor: colour difference: meanColor #ff40a0 vs enemyBullet #ff3fa4 is ${dBullet(
				"#ff40a0",
			)} (CIE76), ${tail}`,
			`assets["fx.hit.light"].tint: colour difference: tint enemyBullet #ff3fa4 vs enemyBullet #ff3fa4 is 0.0 (CIE76), ${tail}`,
		]);
		const report = fxColorReport(m);
		const subjects = report.filter((e) => !e.ok).map((e) => `${e.source}:${e.subject}:${e.against}`);
		expect(subjects).toEqual([
			"role:fx.curse:enemyBullet",
			"meanColor:fx.boss.slam:enemyBullet",
			"tint:fx.hit.light:enemyBullet",
		]);
	});
});

describe("ThemeCore / ThemePack: fx lookups", () => {
	it("the placeholder pack draws no effect and never warns about it", () => {
		const w = sink();
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: w.warn });
		for (const id of FX_IDS) {
			expect([id, pack.fx(id)]).toEqual([id, undefined]);
			expect([id, pack.core.fx(id)]).toEqual([id, undefined]);
		}
		for (const r of FX_ROLES) {
			pack.color(r);
		}
		expect(w.messages).toEqual([]);
	});

	it("resolves an effect's flipbook, size, tint and blend, cached", () => {
		const m = manifestWith({
			"fx.hit.light": hitMark(),
			"fx.roll.dust": hitMark(
				{ frameW: 64, sheets: [{ assetId: "rbxassetid://7003", w: 256, h: 32 }] },
				"sizeTiles",
				"tint",
				"additive",
			),
			"fx.boss.slam": hitMark({ pixelsPerTile: 8, sizeTiles: 2.5 }),
		});
		const w = sink();
		const core = new ThemeCore(m, { warn: w.warn });
		const hit = core.fx("fx.hit.light")!;
		expect([hit.id, hit.frames, hit.fps, hit.loop, hit.sizeTiles, hit.widthTiles, hit.heightTiles]).toEqual([
			"fx.hit.light",
			4,
			12,
			false,
			0.75,
			0.75,
			0.75,
		]);
		expect([hit.tint, hit.additive, hit.set.facings.count]).toEqual(["damageNumber", true, 1]);
		expect(core.fx("fx.hit.light")).toBe(hit);
		// sized by the cell: 64 x 32 px at 32 px per tile = 2 x 1 tiles, untinted
		const dust = core.fx("fx.roll.dust")!;
		expect([dust.sizeTiles, dust.widthTiles, dust.heightTiles, dust.additive]).toEqual([2, 2, 1, false]);
		expect(dust.tint).toBe(undefined);
		expect(core.fx("fx.boss.slam")!.sizeTiles).toBe(2.5);
		expect(w.messages).toEqual([]);
	});

	it("clamps an oversized effect and drops a bad tint; does not draw a set it cannot (warned once)", () => {
		const m = manifestWith({
			"fx.flask": hitMark({ pixelsPerTile: 4, tint: "heal" }, "sizeTiles"),
			"fx.ember.ring": hitMark({
				facings: { count: 4, zeroDeg: 0, ccw: true },
				sheets: [{ assetId: "rbxassetid://7001", w: 512, h: 32 }],
			}),
			"fx.relic.take": { kind: "image", assetId: "rbxassetid://7004", w: 32, h: 32 },
			"fx.shrine.use": hitMark({ animations: { idle: { sheet: 0, start: 0, frames: 1, fps: 1, loop: true } } }),
		});
		const w = sink();
		const core = new ThemeCore(m, { warn: w.warn });
		const flask = core.fx("fx.flask")!;
		expect([flask.sizeTiles, flask.tint]).toEqual([FX_SPRITE_MAX_TILES, undefined]);
		for (const id of ["fx.ember.ring", "fx.relic.take", "fx.shrine.use"] as Array<FxId>) {
			expect([id, core.fx(id)]).toEqual([id, undefined]);
			core.fx(id);
		}
		expect(w.messages).toEqual([
			'[theme:placeholder] effect "fx.flask" has tint "heal", drawing it untinted',
			'[theme:placeholder] effect "fx.ember.ring" has 4 facings, effects have 1; not drawn',
			'[theme:placeholder] effect "fx.relic.take" is a image, not sprites; not drawn',
			'[theme:placeholder] sprite set "fx.shrine.use" is malformed (missing animation "play"), using the placeholder',
		]);
	});

	it("ThemePack wraps an effect with Roblox types: a SpriteSet, the tint as a Color3, frames", () => {
		const m = manifestWith({
			"fx.hit.light": hitMark(),
			"fx.boss.slam": hitMark({}, "tint"),
		});
		const pack = new ThemePack(m, { warn: sink().warn });
		const hit = pack.fx("fx.hit.light")!;
		expect(pack.fx("fx.hit.light")).toBe(hit);
		expect(hit.set).toBe(pack.sprites("fx.hit.light"));
		expect(hit.color).toEqual(hexToColor3(PLACEHOLDER_MANIFEST.colors.damageNumber));
		const f = hit.frame(2);
		expect([f.image, f.offset.X, f.offset.Y, f.size.X, f.size.Y]).toEqual(["rbxassetid://7001", 64, 0, 32, 32]);
		// a one-shot holds its last frame
		expect(hit.frame(9).offset.X).toBe(96);
		expect(pack.fx("fx.boss.slam")!.color).toEqual(new Color3(1, 1, 1));
	});
});
