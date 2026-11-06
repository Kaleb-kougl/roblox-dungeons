// Projectile sprites (docs/PROJECTILE_ART.md PA3): the BULLET slot takes one-facing `sprites` sets, held to the
// bullet colour rules (bulletArtReport, folded into validateManifest), and read with ThemeCore / ThemePack.bullet.
import { describe, expect, it } from "@rbxts/jest-globals";
import { colorDifference, contrastRatio } from "./color";
import {
	BULLET,
	BULLET_ART,
	BULLET_IDS,
	MAX_ENEMY_BULLET_ART_DIFFERENCE,
	MIN_ENEMY_BULLET_CONTRAST,
	MIN_FX_BULLET_DIFFERENCE,
} from "./contract";
import { bulletArtProblems, bulletArtReport } from "./bulletArt";
import { ThemeCore } from "./core";
import { ThemePack, hexToColor3 } from "./pack";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { deepClone, startsWith, type Obj } from "./util";
import { validateManifest } from "./validate";

const clone = (): Obj => deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
const assetsOf = (m: Obj): Obj => m.assets as Obj;
const noSuffix = () => "";

/** A valid bullet set: a 6x19 cell, 3 frames in a 64x64 sheet, at the world art's 29.6 px/tile. */
function bulletSet(meanColor: string): Obj {
	return {
		kind: "sprites",
		frameW: 6,
		frameH: 19,
		pivot: { x: 3, y: 9.5 },
		pixelsPerTile: 29.6,
		resample: "Pixelated",
		facings: { count: 1, zeroDeg: 0, ccw: true },
		sheets: [{ assetId: "rbxassetid://4001", w: 64, h: 64 }],
		animations: { fly: { sheet: 0, start: 10, frames: 3, fps: 10, loop: true } },
		meanColor,
	};
}

/** The placeholder pack with `id` = bulletSet(meanColor) after `edit`. */
function withBullet(id: string, meanColor: string, edit?: (set: Obj) => void): Obj {
	const m = clone();
	const set = bulletSet(meanColor);
	if (edit !== undefined) edit(set);
	assetsOf(m)[id] = set;
	return m;
}

/** validateManifest's messages for `id`'s asset. */
function errorsAt(m: Obj, id: string): Array<string> {
	return validateManifest(m).filter((e) => startsWith(e, `assets["${id}"]`));
}

describe("BULLET slot: sprites (docs/PROJECTILE_ART.md PA3)", () => {
	it("keeps the spritesheet rules and adds the sprites kind: fly, one facing, art pointing up", () => {
		expect(BULLET.kinds).toEqual(["spritesheet", "sprites", "placeholder"]);
		expect([BULLET.cell, BULLET.pivot, BULLET.animations]).toEqual([{ w: 8, h: 8 }, { x: 4, y: 4 }, { fly: 2 }]);
		expect([BULLET.heading, BULLET.perSheetCells]).toEqual(["up", undefined]);
		expect(BULLET_ART.animation).toBe("fly");
		expect(BULLET_ART.maxFrames).toBe(4);
		// docs/GOO_ART.md GA2: the goo left the decals for a floor sprite (gooArt.spec)
		expect([...BULLET_ART.decalIds]).toEqual(["bullet.enemy.strike", "bullet.player.ember"]);
		expect([...BULLET_ART.floorSpriteIds]).toEqual(["bullet.enemy.goo"]);
		expect(MAX_ENEMY_BULLET_ART_DIFFERENCE).toBe(12);
		for (const id of BULLET_ART.decalIds) expect(BULLET_IDS.includes(id as never)).toBe(true);
	});

	it("an art-less pack is unchanged: no entries, no problems, every bullet its placeholder", () => {
		expect(bulletArtReport(PLACEHOLDER_MANIFEST)).toEqual([]);
		expect(bulletArtProblems(PLACEHOLDER_MANIFEST, noSuffix)).toEqual([]);
		expect(validateManifest(PLACEHOLDER_MANIFEST)).toEqual([]);
		const warnings = new Array<string>();
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: (w) => warnings.push(w) });
		for (const id of BULLET_IDS) {
			expect([id, pack.bullet(id)]).toEqual([id, undefined]);
			expect([id, pack.placeholder(id) !== undefined]).toEqual([id, true]);
		}
		expect(warnings).toEqual([]);
	});

	it("accepts valid player art (a yellow bolt) and enemy art (bright pink) with zero problems", () => {
		const m = withBullet("bullet.player.basic", "#edc134");
		assetsOf(m)["bullet.enemy.small"] = bulletSet("#f6449f");
		expect(validateManifest(m)).toEqual([]);
		const report = bulletArtReport(m);
		for (const e of report) expect([e.id, e.check, e.against, e.ok]).toEqual([e.id, e.check, e.against, true]);
		const checks = (id: string) => report.filter((e) => e.id === id).map((e) => e.check);
		// player: facings, frames, then enemyBullet / enemyBulletOutline / telegraph
		expect(checks("bullet.player.basic")).toEqual(["facings", "frames", "player", "player", "player"]);
		// enemy: facings, frames, enemyBullet, then floor and wall of every biome
		const enemy = checks("bullet.enemy.small");
		expect(enemy.size()).toBe(3 + 2 * 5);
		expect(enemy.filter((c) => c === "surface").size()).toBe(10);
	});

	it("a pinkish player bullet fails: it would read as danger", () => {
		// the pack's own pink chevron (#c44d92) is 24.8 CIE76 from the placeholder's #ff3fa4
		const m = withBullet("bullet.player.basic", "#c44d92");
		const bad = bulletArtReport(m).filter((e) => !e.ok);
		expect(bad.map((e) => [e.check, e.against])).toEqual([["player", "enemyBullet"]]);
		expect(bad[0].value < MIN_FX_BULLET_DIFFERENCE).toBe(true);
		const errors = errorsAt(m, "bullet.player.basic");
		expect(errors.size()).toBe(1);
		expect(
			startsWith(
				errors[0],
				'assets["bullet.player.basic"].meanColor: colour difference: meanColor #c44d92 vs enemyBullet',
			),
		).toBe(true);
	});

	it("player art near the telegraph fails too (the Hyper flame's measured mean #f7cb6b)", () => {
		const m = withBullet("bullet.player.heavy", "#f7cb6b");
		const bad = bulletArtReport(m).filter((e) => !e.ok);
		expect(bad.map((e) => [e.check, e.against])).toEqual([["player", "telegraph"]]);
		expect(colorDifference("#f7cb6b", "#ff8a3d") < MIN_FX_BULLET_DIFFERENCE).toBe(true);
	});

	it("a dim enemy bullet fails: too far from the danger colour and too dark on the floors", () => {
		const m = withBullet("bullet.enemy.small", "#c0206f");
		const bad = bulletArtReport(m).filter((e) => !e.ok);
		expect(bad[0].check).toBe("enemy");
		expect(bad[0].value > MAX_ENEMY_BULLET_ART_DIFFERENCE).toBe(true);
		const surfaces = bad.filter((e) => e.check === "surface");
		expect(surfaces.size() > 0).toBe(true);
		for (const e of surfaces)
			expect(contrastRatio("#c0206f", e.againstColor) < MIN_ENEMY_BULLET_CONTRAST).toBe(true);
		const errors = errorsAt(m, "bullet.enemy.small");
		expect(errors.size()).toBe(bad.size());
		expect(
			errors.some((e) =>
				startsWith(e, 'assets["bullet.enemy.small"].meanColor: contrast: meanColor #c0206f on biome.'),
			),
		).toBe(true);
	});

	it("an enemy bullet in another colour fails even when it reads on the floor", () => {
		const m = withBullet("bullet.enemy.needle", "#ff00ff"); // magenta: 54 CIE76 from #ff3fa4, >= 3.5:1 everywhere
		const bad = bulletArtReport(m).filter((e) => !e.ok);
		expect(bad.map((e) => e.check)).toEqual(["enemy"]);
	});

	it("rejects art on the floor decals (strike, ember)", () => {
		for (const id of BULLET_ART.decalIds) {
			const m = withBullet(id, id === "bullet.player.ember" ? "#edc134" : "#f6449f");
			expect([id, errorsAt(m, id)]).toEqual([
				id,
				[
					`assets["${id}"].kind: ${id} is drawn as a floor decal (PAD3): it keeps its placeholder, give it no sprite art`,
				],
			]);
			const warnings = new Array<string>();
			expect(new ThemePack(m, { warn: (w) => warnings.push(w) }).bullet(id)).toBe(undefined);
			expect([id, warnings.size()]).toEqual([id, 1]);
		}
	});

	it("rejects a missing meanColor, more than one facing, a long loop and frames outside the sheet", () => {
		const id = "bullet.player.bolt";
		expect(
			errorsAt(
				withBullet(id, "#52df9a", (s) => (s.meanColor = undefined)),
				id,
			),
		).toEqual([
			`assets["${id}"].meanColor: bullet art needs its meanColor ("#rrggbb", art:build writes it) for the bullet colour rules, got undefined`,
		]);
		expect(errorsAt(withBullet(id, "pink"), id)).toEqual([
			`assets["${id}"].meanColor: bullet art needs its meanColor ("#rrggbb", art:build writes it) for the bullet colour rules, got "pink"`,
		]);
		expect(
			errorsAt(
				withBullet(id, "#52df9a", (s) => (s.facings = { count: 4, zeroDeg: 0, ccw: true })),
				id,
			),
		).toEqual([
			`assets["${id}"].facings.count: a bullet is drawn in one facing (its art points screen-up, turned along the velocity): must be 1, got 4`,
		]);
		expect(
			errorsAt(
				withBullet(
					id,
					"#52df9a",
					(s) => ((s.animations as Obj).fly = { sheet: 0, start: 0, frames: 5, fps: 10, loop: true }),
				),
				id,
			),
		).toEqual([`assets["${id}"].animations.fly.frames: a bullet's fly loop has at most 4 frames, got 5`]);
		// a 64x64 sheet holds 10 x 3 cells of 6x19: cell 30 is out
		expect(
			errorsAt(
				withBullet(
					id,
					"#52df9a",
					(s) => ((s.animations as Obj).fly = { sheet: 0, start: 28, frames: 3, fps: 10, loop: true }),
				),
				id,
			),
		).toEqual([
			`assets["${id}"].animations.fly: facing 0 frame 2 is cell 30, but sheet 0 (64x64) holds 30 cells of 6x19`,
		]);
		// the set needs its fly loop, and an fx field is not a bullet's
		expect(
			errorsAt(
				withBullet(id, "#52df9a", (s) => {
					s.animations = { play: { sheet: 0, start: 0, frames: 3, fps: 10, loop: true } };
					s.sizeTiles = 1;
				}),
				id,
			),
		).toEqual([
			`assets["${id}"].sizeTiles: unknown key (allowed: kind, frameW, frameH, pivot, pixelsPerTile, resample, facings, sheets, animations, meanColor, lit)`,
			`assets["${id}"].animations: sprite contract: missing animation "fly" (>= 1 frame)`,
		]);
	});
});

describe("ThemeCore / ThemePack.bullet (docs/PROJECTILE_ART.md PA3)", () => {
	it("reads a valid set: sizes from the cell and its density, the fly loop, frames wrapping", () => {
		const id = "bullet.player.basic";
		const m = withBullet(id, "#edc134");
		const warnings = new Array<string>();
		const pack = new ThemePack(m, { warn: (w) => warnings.push(w) });
		const b = pack.bullet(id);
		expect(b).never.toBe(undefined);
		expect([b!.id, b!.frames, b!.fps]).toEqual([id, 3, 10]);
		expect(b!.widthTiles).toBeCloseTo(6 / 29.6, 9);
		expect(b!.heightTiles).toBeCloseTo(19 / 29.6, 9);
		expect(b!.meanColor).toEqual(hexToColor3("#edc134"));
		expect([b!.set.facings.count, b!.set.resample]).toEqual([1, "Pixelated"]);
		// cells 10, 11, 12 of a 10-per-row sheet: row 1
		for (let f = 0; f < 3; f++) {
			const r = b!.frame(f);
			expect([f, r.image, r.offset.X, r.offset.Y, r.size.X, r.size.Y]).toEqual([
				f,
				"rbxassetid://4001",
				f * 6,
				19,
				6,
				19,
			]);
		}
		expect(b!.frame(3).offset.X).toBe(b!.frame(0).offset.X);
		expect(b!.frame(7).offset.X).toBe(b!.frame(1).offset.X);
		expect(pack.bullet(id)).toBe(b); // cached
		expect(warnings).toEqual([]);
		// the placeholder stays available (the renderer's fallback)
		expect(pack.placeholder(id)).never.toBe(undefined);
	});

	it("wraps a one-shot loop flag too: a bullet never holds its last frame", () => {
		const id = "bullet.enemy.small";
		const m = withBullet(
			id,
			"#f6449f",
			(s) => ((s.animations as Obj).fly = { sheet: 0, start: 0, frames: 2, fps: 8, loop: false }),
		);
		const b = new ThemePack(m, { warn: () => undefined }).bullet(id)!;
		expect(b.frame(2).offset.X).toBe(b.frame(0).offset.X);
	});

	it("undefined with one warning for art it cannot draw as a bullet", () => {
		const cases: Array<[string, (s: Obj) => void]> = [
			["facings", (s) => (s.facings = { count: 4, zeroDeg: 0, ccw: true })],
			["frames", (s) => ((s.animations as Obj).fly = { sheet: 0, start: 0, frames: 5, fps: 10, loop: true })],
			["meanColor", (s) => (s.meanColor = undefined)],
			["malformed", (s) => (s.frameW = 0)],
		];
		for (const [what, edit] of cases) {
			const warnings = new Array<string>();
			const core = new ThemeCore(withBullet("bullet.enemy.large", "#f6449f", edit), {
				warn: (w) => warnings.push(w),
			});
			expect([what, core.bullet("bullet.enemy.large")]).toEqual([what, undefined]);
			core.bullet("bullet.enemy.large");
			expect([what, warnings.size()]).toEqual([what, 1]);
		}
	});
});
