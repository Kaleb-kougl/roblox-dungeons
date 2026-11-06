// Goo art (docs/GOO_ART.md GA2): `bullet.enemy.goo` may take a FLOOR sprite set (land / hold, one facing, a lit box
// and a meanColor read as goo), held to gooArtReport (folded into validateManifest); strike / ember still take no
// art; read with ThemeCore / ThemePack.floorSprite. The placeholder pack is unchanged (the disc).
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference } from "./color";
import { BULLET, BULLET_ART, BULLET_IDS, MAX_ENEMY_BULLET_ART_DIFFERENCE, requiredBaseAnimations } from "./contract";
import { bulletArtReport } from "./bulletArt";
import { GOO_ART_RULES, gooArtProblems, gooArtReport } from "./gooArt";
import { ThemeCore } from "./core";
import { ThemePack, hexToColor3 } from "./pack";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { deepClone, startsWith, type Obj } from "./util";
import { validateManifest } from "./validate";
import { GOO_COLOR_RULES } from "./variantColors";
import { ENEMY_GOO_ROLE, GOO_BULLET_ID } from "./variants";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const assetsOf = (m: Obj): Obj => m.assets as Obj;
const noSuffix = () => "";
const GOO = GOO_BULLET_ID;
/** A goo-coloured mean near the placeholder's enemyGoo #f000f0 (the measured vale recolour's #e824e8). */
const GOO_MEAN = "#e824e8";

/** A valid goo set: 33x19 cells in a 66x38 sheet (2 x 2 cells): land cell 0, hold cells 1-2, lit box 31x17. */
function gooSet(meanColor: string): Obj {
	return {
		kind: "sprites",
		frameW: 33,
		frameH: 19,
		pivot: { x: 16.5, y: 9.5 },
		pixelsPerTile: 29.6,
		resample: "Pixelated",
		facings: { count: 1, zeroDeg: 0, ccw: true },
		sheets: [{ assetId: "rbxassetid://4101", w: 66, h: 38 }],
		animations: {
			land: { sheet: 0, start: 0, frames: 1, fps: 1, loop: false },
			hold: { sheet: 0, start: 1, frames: 2, fps: 1, loop: false },
		},
		meanColor,
		lit: { w: 31, h: 17 },
	};
}

/** The placeholder pack with the goo = gooSet(meanColor) after `edit`. */
function withGoo(meanColor: string, edit?: (set: Obj) => void): Obj {
	const m = clone();
	const set = gooSet(meanColor);
	if (edit !== undefined) edit(set);
	assetsOf(m)[GOO] = set;
	return m;
}

/** validateManifest's messages for the goo's asset. */
function errorsAt(m: Obj): Array<string> {
	return validateManifest(m).filter((e) => startsWith(e, `assets["${GOO}"]`));
}

describe("goo floor sprite contract (docs/GOO_ART.md GA2)", () => {
	it("splits the decal ids: the goo is a floor sprite, strike and ember keep no art", () => {
		expect([...BULLET_ART.floorSpriteIds]).toEqual([GOO]);
		expect([...BULLET_ART.decalIds]).toEqual(["bullet.enemy.strike", "bullet.player.ember"]);
		expect([BULLET_ART.land, BULLET_ART.hold, BULLET_ART.landFrames]).toEqual(["land", "hold", 1]);
		for (const id of BULLET_ART.floorSpriteIds) expect(BULLET_IDS.includes(id as never)).toBe(true);
		// the BULLET slot's per-ID animations name the floor sprite ID written out
		expect(requiredBaseAnimations(BULLET, GOO)).toEqual([BULLET_ART.land, BULLET_ART.hold]);
		expect(requiredBaseAnimations(BULLET, "bullet.enemy.small")).toEqual(["fly"]);
		expect(requiredBaseAnimations(BULLET)).toEqual(["fly"]);
	});

	it("holds the art to the goo colour bars (GOO_COLOR_RULES) and the enemy bullet art distance", () => {
		expect(GOO_ART_RULES.maxGooDifference).toBe(MAX_ENEMY_BULLET_ART_DIFFERENCE);
		expect(GOO_ART_RULES.minFloorContrast).toBe(GOO_COLOR_RULES.minFloorContrast);
		expect([...GOO_ART_RULES.against]).toEqual([...GOO_COLOR_RULES.against]);
		expect(GOO_ART_RULES.minDifference).toBe(GOO_COLOR_RULES.minDifference);
	});

	it("an art-less pack is unchanged: no entries, no problems, the goo its placeholder", () => {
		expect(gooArtReport(PLACEHOLDER_MANIFEST)).toEqual([]);
		expect(gooArtProblems(PLACEHOLDER_MANIFEST, noSuffix)).toEqual([]);
		const warnings = new Array<string>();
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: (w) => warnings.push(w) });
		expect(pack.floorSprite(GOO)).toBe(undefined);
		expect(pack.bullet(GOO)).toBe(undefined);
		expect(pack.placeholder(GOO)).never.toBe(undefined);
		expect(warnings).toEqual([]);
	});

	it("accepts valid goo art with zero problems: shape checks, then enemyGoo, every floor, decor fx and boosts", () => {
		const m = withGoo(GOO_MEAN);
		expect(validateManifest(m)).toEqual([]);
		const report = gooArtReport(m);
		for (const e of report) expect([e.check, e.against, e.ok]).toEqual([e.check, e.against, true]);
		const checks = report.map((e) => e.check);
		expect([checks[0], checks[1], checks[2], checks[3], checks[4]]).toEqual([
			"facings",
			"land",
			"hold",
			"lit",
			"goo",
		]);
		expect(checks.filter((c) => c === "floor").size()).toBe(5);
		expect(checks.filter((c) => c === "difference").size()).toBe(GOO_ART_RULES.against.size());
		// a floor sprite is no flying bullet: bulletArtReport leaves it to gooArtReport
		expect(bulletArtReport(m)).toEqual([]);
	});

	it("goo art in another colour fails: the danger pink is too far from enemyGoo", () => {
		const m = withGoo("#f6449f");
		const placeholderGoo = (PLACEHOLDER_MANIFEST.colors as unknown as Obj)[ENEMY_GOO_ROLE] as string;
		expect(colorDifference("#f6449f", placeholderGoo) > MAX_ENEMY_BULLET_ART_DIFFERENCE).toBe(true);
		const bad = gooArtReport(m).filter((e) => !e.ok);
		expect(bad.map((e) => e.check)).toEqual(["goo"]);
		const errors = errorsAt(m);
		expect(errors.size()).toBe(1);
		expect(
			startsWith(errors[0], `assets["${GOO}"].meanColor: colour difference: meanColor #f6449f vs enemyGoo`),
		).toBe(true);
	});

	it("a dark goo fails on the floors as well", () => {
		const bad = gooArtReport(withGoo("#300030")).filter((e) => !e.ok);
		expect(bad.some((e) => e.check === "goo")).toBe(true);
		expect(bad.some((e) => e.check === "floor")).toBe(true);
	});

	it("rejects more than one facing, a long land, too many hold variants, a bad lit box and no meanColor", () => {
		// (four facings also run the hold cells past the sheet: the set's own cell check reports that too)
		expect(
			errorsAt(withGoo(GOO_MEAN, (s) => (s.facings = { count: 4, zeroDeg: 0, ccw: true }))).includes(
				`assets["${GOO}"].facings.count: a floor sprite is drawn in one facing (flat on the floor, screen-up, never turned): must be 1, got 4`,
			),
		).toBe(true);
		expect(
			errorsAt(
				withGoo(
					GOO_MEAN,
					(s) => ((s.animations as Obj).land = { sheet: 0, start: 0, frames: 2, fps: 1, loop: false }),
				),
			),
		).toEqual([
			`assets["${GOO}"].animations.land.frames: a floor sprite's land is 1 cell (the drop hitting the floor), got 2`,
		]);
		const big = withGoo(GOO_MEAN, (s) => {
			((s.sheets as Array<Obj>)[0] as Obj).h = 57; // 2 x 3 cells
			(s.animations as Obj).hold = { sheet: 0, start: 1, frames: 5, fps: 1, loop: false };
		});
		expect(errorsAt(big)).toEqual([
			`assets["${GOO}"].animations.hold.frames: a floor sprite's hold has at most 4 variants, got 5`,
		]);
		for (const lit of [undefined, { w: 34, h: 17 }, { w: 31, h: 0 }, { w: 30.5, h: 17 }]) {
			const errors = errorsAt(withGoo(GOO_MEAN, (s) => (s.lit = lit)));
			expect(errors.size()).toBe(1);
			expect(startsWith(errors[0], `assets["${GOO}"].lit: a floor sprite needs its hold frame's lit box`)).toBe(
				true,
			);
		}
		expect(errorsAt(withGoo(GOO_MEAN, (s) => (s.meanColor = undefined)))).toEqual([
			`assets["${GOO}"].meanColor: floor sprite art needs its meanColor ("#rrggbb", art:build writes it) for the goo colour rules, got undefined`,
		]);
	});

	it("needs land and hold, not fly", () => {
		const errors = errorsAt(
			withGoo(GOO_MEAN, (s) => (s.animations = { fly: { sheet: 0, start: 0, frames: 1, fps: 1, loop: true } })),
		);
		expect(errors).toEqual([
			`assets["${GOO}"].animations: sprite contract: missing animation "land" (>= 1 frame)`,
			`assets["${GOO}"].animations: sprite contract: missing animation "hold" (>= 1 frame)`,
		]);
	});

	it("still rejects art on the strike and ember decals", () => {
		for (const id of BULLET_ART.decalIds) {
			const m = clone();
			const set = gooSet(GOO_MEAN);
			set.animations = { fly: { sheet: 0, start: 0, frames: 1, fps: 10, loop: true } };
			set.lit = undefined;
			assetsOf(m)[id] = set;
			expect(bulletArtReport(m).map((e) => [e.id, e.check, e.ok])).toEqual([[id, "decal", false]]);
		}
	});
});

describe("ThemeCore / ThemePack.floorSprite (docs/GOO_ART.md GA2)", () => {
	it("reads a valid set: the land cell, hold variants wrapping, the lit box and mean colour", () => {
		const warnings = new Array<string>();
		const pack = new ThemePack(withGoo(GOO_MEAN), { warn: (w) => warnings.push(w) });
		const g = pack.floorSprite(GOO);
		expect(g).never.toBe(undefined);
		expect([g!.id, g!.holdFrames, g!.litW, g!.litH]).toEqual([GOO, 2, 31, 17]);
		expect(g!.meanColor).toEqual(hexToColor3(GOO_MEAN));
		expect([g!.land.image, g!.land.offset.X, g!.land.offset.Y, g!.land.size.X, g!.land.size.Y]).toEqual([
			"rbxassetid://4101",
			0,
			0,
			33,
			19,
		]);
		// cells 1 and 2 of a 2-per-row sheet
		expect([g!.hold(0).offset.X, g!.hold(0).offset.Y]).toEqual([33, 0]);
		expect([g!.hold(1).offset.X, g!.hold(1).offset.Y]).toEqual([0, 19]);
		expect(g!.hold(2).offset.X).toBe(g!.hold(0).offset.X);
		expect(pack.floorSprite(GOO)).toBe(g); // cached
		expect(pack.bullet(GOO)).toBe(undefined); // no flying bullet art, no warning
		expect(warnings).toEqual([]);
	});

	it("undefined with one warning for art it cannot draw", () => {
		const cases: Array<[string, (s: Obj) => void]> = [
			["facings", (s) => (s.facings = { count: 4, zeroDeg: 0, ccw: true })],
			["land", (s) => ((s.animations as Obj).land = { sheet: 0, start: 0, frames: 2, fps: 1, loop: false })],
			["lit", (s) => (s.lit = { w: 40, h: 17 })],
			["meanColor", (s) => (s.meanColor = "pink")],
			["no hold", (s) => (s.animations = { land: { sheet: 0, start: 0, frames: 1, fps: 1, loop: false } })],
		];
		for (const [what, edit] of cases) {
			const warnings = new Array<string>();
			const core = new ThemeCore(withGoo(GOO_MEAN, edit), { warn: (w) => warnings.push(w) });
			expect([what, core.floorSprite(GOO)]).toEqual([what, undefined]);
			core.floorSprite(GOO);
			expect([what, warnings.size()]).toEqual([what, 1]);
		}
	});

	it("only floor sprite ids are floor sprites", () => {
		const m = clone();
		assetsOf(m)["bullet.enemy.small"] = gooSet(GOO_MEAN);
		const warnings = new Array<string>();
		expect(new ThemeCore(m, { warn: (w) => warnings.push(w) }).floorSprite("bullet.enemy.small")).toBe(undefined);
		expect(warnings).toEqual([]);
	});
});
