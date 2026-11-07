// Hazard art (docs/HAZARD_ART.md HA3): `bullet.enemy.strike` and `bullet.player.ember` may take a HAZARD sprite set (one
// facing, greyscale, the strike's flash / scorch and hit rim rimPx, the ember's burn loop and patch lit), held to
// hazardArtReport (folded into validateManifest); read with ThemeCore / ThemePack.hazardSprite. The placeholder pack is
// unchanged (the discs), and neither ID is ever a flying bullet or a floor sprite.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BULLET, BULLET_ART, BULLET_IDS, requiredBaseAnimations } from "./contract";
import { bulletArtReport } from "./bulletArt";
import { HAZARD_EMBER_ID, HAZARD_STRIKE_ID, hazardArtProblems, hazardArtReport, isGreyHex } from "./hazardArt";
import { ThemePack } from "./pack";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { deepClone, startsWith, type Obj } from "./util";
import { validateManifest } from "./validate";

const STRIKE = HAZARD_STRIKE_ID;
const EMBER = HAZARD_EMBER_ID;
const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const assetsOf = (m: Obj): Obj => m.assets as Obj;
const SHEET = { assetId: "rbxassetid://4202", w: 77, h: 465 };

/** A valid strike set: 77 px cells, flash cells 0-2, scorch 3-4, rim 33 px. */
function strikeSet(): Obj {
	return {
		kind: "sprites",
		frameW: 77,
		frameH: 77,
		pivot: { x: 38.5, y: 38.5 },
		pixelsPerTile: 29.6,
		resample: "Pixelated",
		facings: { count: 1, zeroDeg: 0, ccw: true },
		sheets: [{ ...SHEET }],
		animations: {
			flash: { sheet: 0, start: 0, frames: 3, fps: 30, loop: false },
			scorch: { sheet: 0, start: 3, frames: 2, fps: 1, loop: false },
		},
		meanColor: "#989898",
		rimPx: 33,
	};
}

/** A valid ember set: 17 x 31 cells (4 a row of a 77 px sheet), burn cells 52-57, patch 15 x 12. */
function emberSet(): Obj {
	return {
		kind: "sprites",
		frameW: 17,
		frameH: 31,
		pivot: { x: 8.5, y: 23.5 },
		pixelsPerTile: 29.6,
		resample: "Pixelated",
		facings: { count: 1, zeroDeg: 0, ccw: true },
		sheets: [{ ...SHEET }],
		animations: { burn: { sheet: 0, start: 52, frames: 6, fps: 12, loop: true } },
		meanColor: "#efefef",
		lit: { w: 15, h: 12 },
	};
}

/** The placeholder pack with both hazards drawn, after `edit(strike, ember)`. */
function withHazards(edit?: (strike: Obj, ember: Obj) => void): Obj {
	const m = clone();
	const s = strikeSet();
	const e = emberSet();
	if (edit !== undefined) edit(s, e);
	assetsOf(m)[STRIKE] = s;
	assetsOf(m)[EMBER] = e;
	return m;
}

function errorsAt(m: Obj, id: string): Array<string> {
	return validateManifest(m).filter((e) => startsWith(e, `assets["${id}"]`));
}

function failed(m: Obj): Array<Array<string>> {
	return hazardArtReport(m)
		.filter((e) => !e.ok)
		.map((e) => [e.id, e.check, e.against]);
}

describe("hazard sprite contract (docs/HAZARD_ART.md HA3)", () => {
	it("names the two hazards, their animations and frame cap; both are bullet IDs", () => {
		expect([...BULLET_ART.hazardSpriteIds]).toEqual(["bullet.enemy.strike", "bullet.player.ember"]);
		expect([STRIKE, EMBER]).toEqual(["bullet.enemy.strike", "bullet.player.ember"]);
		for (const id of BULLET_ART.hazardSpriteIds) expect(BULLET_IDS.includes(id as never)).toBe(true);
		expect(requiredBaseAnimations(BULLET, STRIKE)).toEqual([BULLET_ART.flash, BULLET_ART.scorch]);
		expect(requiredBaseAnimations(BULLET, EMBER)).toEqual([BULLET_ART.burn]);
		expect([BULLET_ART.flash, BULLET_ART.scorch, BULLET_ART.burn, BULLET_ART.maxHazardFrames]).toEqual([
			"flash",
			"scorch",
			"burn",
			8,
		]);
	});

	it("an art-less pack is unchanged: no entries, no problems, no hazard sprites", () => {
		expect(hazardArtReport(PLACEHOLDER_MANIFEST)).toEqual([]);
		expect(hazardArtProblems(PLACEHOLDER_MANIFEST)).toEqual([]);
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
		expect([pack.hazardSprite(STRIKE), pack.hazardSprite(EMBER)]).toEqual([undefined, undefined]);
	});

	it("valid sets pass every rule and the validator, and are neither bullets nor floor sprites", () => {
		const m = withHazards();
		expect(failed(m)).toEqual([]);
		expect(errorsAt(m, STRIKE)).toEqual([]);
		expect(errorsAt(m, EMBER)).toEqual([]);
		expect(bulletArtReport(m).filter((e) => e.id === STRIKE || e.id === EMBER)).toEqual([]);
		const warnings = new Array<string>();
		const pack = new ThemePack(m, { warn: (w) => warnings.push(w) });
		expect([pack.bullet(STRIKE), pack.bullet(EMBER), pack.floorSprite(STRIKE), pack.floorSprite(EMBER)]).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
		]);
		expect(warnings).toEqual([]);
	});

	it("isGreyHex: equal channels only", () => {
		expect([isGreyHex("#989898"), isGreyHex("#EFEFEF"), isGreyHex("#989899"), isGreyHex("grey")]).toEqual([
			true,
			true,
			false,
			false,
		]);
	});

	it("fails a non-grey mean, a long animation, two facings, a bad rim, a missing patch and a misplaced field", () => {
		expect(failed(withHazards((s) => (s.meanColor = "#ff3fa4")))).toEqual([[STRIKE, "grey", ""]]);
		expect(failed(withHazards((s) => (s.meanColor = undefined)))).toEqual([[STRIKE, "meanColor", ""]]);
		expect(
			failed(
				withHazards(
					(_, e) => ((e.animations as Obj).burn = { sheet: 0, start: 0, frames: 9, fps: 12, loop: true }),
				),
			),
		).toEqual([[EMBER, "frames", "burn"]]);
		expect(failed(withHazards((s) => (s.facings = { count: 4, zeroDeg: 0, ccw: true })))).toEqual([
			[STRIKE, "facings", ""],
		]);
		expect(failed(withHazards((s) => (s.rimPx = 39)))).toEqual([[STRIKE, "rimPx", ""]]);
		expect(failed(withHazards((s) => (s.rimPx = undefined)))).toEqual([[STRIKE, "rimPx", ""]]);
		expect(failed(withHazards((_, e) => (e.lit = undefined)))).toEqual([[EMBER, "lit", ""]]);
		expect(failed(withHazards((_, e) => (e.lit = { w: 18, h: 12 })))).toEqual([[EMBER, "lit", ""]]);
		expect(failed(withHazards((s) => (s.lit = { w: 3, h: 3 })))).toEqual([[STRIKE, "misplaced", "lit"]]);
		expect(failed(withHazards((_, e) => (e.rimPx = 3)))).toEqual([[EMBER, "misplaced", "rimPx"]]);
		// each failure is a validator message on the asset
		const bad = withHazards((s) => (s.meanColor = "#ff3fa4"));
		expect(errorsAt(bad, STRIKE)).toEqual([
			`assets["${STRIKE}"].meanColor: hazard art is greyscale (the renderer tints it with the hazard's colour role), but its meanColor #ff3fa4 is not a grey`,
		]);
	});

	it("a set missing a hazard's animation is the validator's (sprite contract)", () => {
		const m = withHazards((s) => {
			const anims = s.animations as Obj;
			anims.scorch = undefined;
		});
		expect(errorsAt(m, STRIKE)).toEqual([
			`assets["${STRIKE}"].animations: sprite contract: missing animation "scorch" (>= 1 frame)`,
		]);
	});

	it("ThemePack.hazardSprite reads the frames, rim, patch and cells; bad art warns once and draws the disc", () => {
		const pack = new ThemePack(withHazards(), { warn: () => undefined });
		const strike = pack.hazardSprite(STRIKE)!;
		const ember = pack.hazardSprite(EMBER)!;
		expect([strike.frames("flash"), strike.frames("scorch"), strike.frames("burn"), strike.rimPx]).toEqual([
			3, 2, 0, 33,
		]);
		expect([ember.frames("burn"), ember.litW, ember.litH, ember.rimPx, ember.fps("burn")]).toEqual([
			6, 15, 12, 0, 12,
		]);
		// cell 4 (scorch 1) of a 77 px wide sheet: (0, 4 x 77); wraps
		const cold = strike.frame("scorch", 1);
		expect([cold.offset.X, cold.offset.Y, cold.size.X, cold.size.Y]).toEqual([0, 308, 77, 77]);
		expect(strike.frame("scorch", 3).offset.Y).toBe(308);
		// ember cell 53: perRow 4 -> (17, 13 x 31)
		const e1 = ember.frame("burn", 1);
		expect([e1.offset.X, e1.offset.Y]).toEqual([17, 403]);
		expect(pack.hazardSprite(STRIKE)).toBe(strike);
		const warnings = new Array<string>();
		const bad = new ThemePack(
			withHazards((s) => (s.meanColor = "#ff3fa4")),
			{ warn: (w) => warnings.push(w) },
		);
		expect(bad.hazardSprite(STRIKE)).toBe(undefined);
		expect(bad.hazardSprite(STRIKE)).toBe(undefined);
		expect(warnings.size()).toBe(1);
		expect(bad.hazardSprite(EMBER) !== undefined).toBe(true);
	});
});
