// The vale pack's projectile sprites (docs/PROJECTILE_ART.md PA6): every bulletLayout.ts entry becomes a one-facing
// `sprites` bullet once bullets.png has an ID (absent: the placeholder exactly as today), the runtime addresses the cells
// the pipeline wrote, and the art passes the bullet colour rules (bulletArtReport).
import { describe, expect, it } from "@rbxts/jest-globals";
import { BULLET_ART, BULLET_IDS, ENEMY_BULLET_ROLES, MIN_FX_BULLET_DIFFERENCE } from "../../contract";
import { bulletArtReport } from "../../bulletArt";
import { ThemePack, hexToColor3 } from "../../pack";
import { PLACEHOLDER_MANIFEST } from "../placeholder";
import type { SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { fxColorReport, validateManifest } from "../../validate";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_BULLET_SOURCE, valeBulletAssets, type ValeBulletSource } from "./bullets";
import {
	VALE_BULLET_FX_LAYOUTS,
	VALE_BULLET_LAYOUTS,
	VALE_BULLET_OWN_SHEETS,
	VALE_BULLET_SHEET,
	type ValeBulletLayout,
} from "./bulletLayout";
import { VALE_FX } from "./fx";
import { VALE_GOO_SHEET } from "./gooLayout";
import { VALE_HAZARD_SHEET } from "./hazardLayout";
import { VALE_MANIFEST, buildValeManifest } from "./manifest";

const quiet = () => undefined;
/** A fake upload (test vector) for the bullet atlas. */
const SHEET_ID = "rbxassetid://7300";
/** A fake upload (test vector) for a bullet sheet of its own (docs/NEW_ENEMIES_2.md NX8). */
const OWN_ID = "rbxassetid://7301";
const PPT = 29.6;

const layout = (
	frameW: number,
	frameH: number,
	start: number,
	frames: number,
	meanColor: ValeBulletLayout["meanColor"],
): ValeBulletLayout => ({
	frameW,
	frameH,
	pivot: { x: frameW / 2, y: frameH / 2 },
	start,
	frames,
	fps: 10,
	meanColor,
	pixelsPerTile: PPT,
});

/**
 * A synthetic atlas in bulletLayout.ts's shape (64 x 64, PA2's mapping and measured means; enemy means as the danger
 * ramp leaves them): cells `start + f`, floor(64 / frameW) per row.
 */
const FAKE: ValeBulletSource = {
	sheet: { file: VALE_BULLET_SHEET.file, w: 64, h: 64 },
	layouts: {
		"bullet.player.basic": layout(6, 19, 0, 3, "#edc134"), // Yellow_Thinier
		"bullet.player.bolt": layout(6, 21, 10, 3, "#52df9a"), // Thinier_BermudaGreen
		"bullet.player.burst": layout(6, 21, 13, 3, "#4cd69b"), // BermudaGreen
		"bullet.player.shard": layout(6, 17, 6, 3, "#61e3b1"), // stand-in mint: the yellow #eebc36 is 36.4 from telegraph
		"bullet.player.heavy": layout(16, 32, 2, 2, "#52df9a"), // stand-in: the flame's #f7cb6b is 37.8 from telegraph
		"bullet.enemy.small": layout(13, 15, 12, 1, "#f6449f"),
		"bullet.enemy.medium": layout(8, 16, 25, 1, "#f23b9b"),
		"bullet.enemy.large": layout(8, 16, 26, 1, "#ff4fb0"),
		"bullet.enemy.needle": layout(6, 19, 26, 2, "#f6449f"),
	},
};

function isBullet(id: string): boolean {
	return id.sub(1, 7) === "bullet.";
}

describe("vale bullets (docs/PROJECTILE_ART.md PA6)", () => {
	it("maps only flying bullets: every layout key is a bullet ID that is not a floor hazard", () => {
		for (const source of [VALE_BULLET_SOURCE, FAKE]) {
			for (const id of sortedKeys(source.layouts)) {
				expect([id, (BULLET_IDS as ReadonlyArray<string>).includes(id)]).toEqual([id, true]);
				expect([id, BULLET_ART.hazardSpriteIds.includes(id)]).toEqual([id, false]);
			}
		}
		expect(VALE_BULLET_SOURCE.layouts).toBe(VALE_BULLET_LAYOUTS);
		expect(VALE_BULLET_SOURCE.sheet).toBe(VALE_BULLET_SHEET);
	});

	it("without the atlas's ID every bullet is the placeholder, exactly as the placeholder pack", () => {
		const bundled = VALE_ASSET_IDS[VALE_BULLET_SHEET.file] === undefined;
		const manifests = [buildValeManifest({}), buildValeManifest({}, { bullets: FAKE })];
		if (bundled) manifests.push(VALE_MANIFEST);
		for (const m of manifests) {
			for (const id of BULLET_IDS) {
				expect([id, m.assets[id]]).toEqual([id, PLACEHOLDER_MANIFEST.assets[id]]);
			}
			expect(bulletArtReport(m)).toEqual([]);
			const pack = new ThemePack(m, { warn: quiet });
			for (const id of BULLET_IDS) expect([id, pack.bullet(id)]).toEqual([id, undefined]);
		}
		expect(valeBulletAssets({})).toEqual({});
		expect(valeBulletAssets({}, FAKE)).toEqual({});
	});

	it("with the atlas's ID each mapped bullet is a one-facing sprites set over it; the decals stay placeholders", () => {
		const ids = { [FAKE.sheet.file]: SHEET_ID };
		const m = buildValeManifest(ids, { bullets: FAKE });
		for (const id of BULLET_IDS) {
			const l = FAKE.layouts[id];
			const a = m.assets[id];
			if (l === undefined) {
				expect([id, a]).toEqual([id, PLACEHOLDER_MANIFEST.assets[id]]);
				continue;
			}
			const set = a as SpriteSetAsset;
			expect([id, set.kind, set.facings.count, set.resample]).toEqual([id, "sprites", 1, "Pixelated"]);
			expect([id, set.frameW, set.frameH, set.pixelsPerTile, set.meanColor]).toEqual([
				id,
				l.frameW,
				l.frameH,
				l.pixelsPerTile,
				l.meanColor,
			]);
			expect([id, set.sheets]).toEqual([id, [{ assetId: SHEET_ID, w: 64, h: 64 }]]);
			expect([id, sortedKeys(set.animations)]).toEqual([id, [BULLET_ART.animation]]);
		}
		for (const id of BULLET_ART.hazardSpriteIds)
			expect([id, m.assets[id]]).toEqual([id, PLACEHOLDER_MANIFEST.assets[id]]);
		// a source without `fx` carries no bullet impact (it follows the bullet source, not the generated one)
		expect(m.assets[BULLET_ART.hitFx]).toBe(undefined);
	});

	it("validates with zero problems, every mapped ID passing bulletArtReport", () => {
		const m = buildValeManifest({ [FAKE.sheet.file]: SHEET_ID }, { bullets: FAKE });
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const report = bulletArtReport(m);
		const seen = new Set<string>();
		for (const e of report) {
			seen.add(e.id);
			expect([e.id, e.check, e.against, e.surface, e.ok]).toEqual([e.id, e.check, e.against, e.surface, true]);
		}
		expect(sortedKeys(FAKE.layouts).filter((id) => !seen.has(id))).toEqual([]);
	});

	it("pack.bullet gives each mapped ID its sizes, loop and the pipeline's cells", () => {
		const m = buildValeManifest({ [FAKE.sheet.file]: SHEET_ID }, { bullets: FAKE });
		const warnings = new Array<string>();
		const pack = new ThemePack(m, { warn: (w) => warnings.push(w) });
		for (const id of BULLET_IDS) {
			const l = FAKE.layouts[id];
			const b = pack.bullet(id);
			if (l === undefined) {
				expect([id, b]).toEqual([id, undefined]);
				continue;
			}
			expect([id, b !== undefined]).toEqual([id, true]);
			expect([id, b!.frames, b!.fps]).toEqual([id, l.frames, l.fps]);
			expect([id, b!.widthTiles, b!.heightTiles]).toEqual([
				id,
				l.frameW / l.pixelsPerTile,
				l.frameH / l.pixelsPerTile,
			]);
			expect([id, b!.meanColor]).toEqual([id, hexToColor3(l.meanColor)]);
			const perRow = math.floor(FAKE.sheet.w / l.frameW);
			for (let f = 0; f < l.frames; f++) {
				const r = b!.frame(f);
				const c = l.start + f;
				expect([id, f, r.image, r.offset.X, r.offset.Y, r.size.X, r.size.Y]).toEqual([
					id,
					f,
					SHEET_ID,
					(c % perRow) * l.frameW,
					math.floor(c / perRow) * l.frameH,
					l.frameW,
					l.frameH,
				]);
				expect([id, f, r.offset.Y + l.frameH <= FAKE.sheet.h]).toEqual([id, f, true]);
			}
			// the loop wraps
			expect([id, b!.frame(l.frames).offset.X, b!.frame(l.frames).offset.Y]).toEqual([
				id,
				b!.frame(0).offset.X,
				b!.frame(0).offset.Y,
			]);
		}
		// hand-computed: the thin bolt's 2nd frame is cell 11 of 10 per row (6 x 21): (6, 21)
		const bolt = pack.bullet("bullet.player.bolt")!.frame(1);
		expect([bolt.offset.X, bolt.offset.Y]).toEqual([6, 21]);
		const basic = pack.bullet("bullet.player.basic")!;
		expect(basic.widthTiles).toBeCloseTo(0.2027, 3);
		expect(basic.heightTiles).toBeCloseTo(0.6419, 3);
		expect(warnings).toEqual([]);
	});

	it("the generated layouts, once uploaded, pass the validator and draw (empty until PA2 generates them)", () => {
		const own: Record<string, string> = {};
		for (const file of sortedKeys(VALE_BULLET_OWN_SHEETS)) own[file] = OWN_ID;
		const m = buildValeManifest({ ...VALE_ASSET_IDS, [VALE_BULLET_SHEET.file]: SHEET_ID, ...own });
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		// the real art's colours: every mapped bullet passes bulletArtReport
		const seen = new Set<string>();
		for (const e of bulletArtReport(m)) {
			seen.add(e.id);
			expect([e.id, e.check, e.against, e.surface, e.ok]).toEqual([e.id, e.check, e.against, e.surface, true]);
		}
		expect(sortedKeys(VALE_BULLET_LAYOUTS).filter((id) => !seen.has(id))).toEqual([]);
		const pack = new ThemePack(m, { warn: quiet });
		for (const id of sortedKeys(VALE_BULLET_LAYOUTS))
			expect([id, pack.bullet(id) !== undefined]).toEqual([id, true]);
		for (const id of sortedKeys(m.assets)) {
			if (!isBullet(id)) continue;
			// the goo puddle draws its own sheet (docs/GOO_ART.md) once goo.png has an ID
			const floorSprite =
				BULLET_ART.floorSpriteIds.includes(id) && VALE_ASSET_IDS[VALE_GOO_SHEET.file] !== undefined;
			// likewise the floor hazards (docs/HAZARD_ART.md) once hazards.png has one
			const hazard =
				BULLET_ART.hazardSpriteIds.includes(id) && VALE_ASSET_IDS[VALE_HAZARD_SHEET.file] !== undefined;
			const drawn = VALE_BULLET_LAYOUTS[id] !== undefined || floorSprite || hazard;
			expect([id, m.assets[id].kind === "sprites"]).toEqual([id, drawn]);
		}
	});

	it("the generated bullet impact (fx.bullet.hit, PA7) rides in bullets.png: it draws once that has an ID, untinted, under the fx rule", () => {
		const hit = BULLET_ART.hitFx;
		const l = VALE_BULLET_FX_LAYOUTS[hit];
		expect(l).never.toBe(undefined);
		// absent until bullets.png has an ID (the bundled pack, before PA8)
		const without: Record<string, string> = {};
		for (const file of sortedKeys(VALE_ASSET_IDS)) {
			if (file !== VALE_BULLET_SHEET.file) without[file] = VALE_ASSET_IDS[file];
		}
		expect(buildValeManifest(without).assets[hit]).toBe(undefined);
		const m = buildValeManifest({ ...VALE_ASSET_IDS, [VALE_BULLET_SHEET.file]: SHEET_ID });
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const set = m.assets[hit] as SpriteSetAsset;
		expect([set.kind, set.facings.count, set.tint, set.meanColor, set.additive, set.sizeTiles]).toEqual([
			"sprites",
			1,
			undefined,
			l.meanColor,
			true,
			VALE_FX[hit].sizeTiles,
		]);
		expect(set.sheets).toEqual([{ assetId: SHEET_ID, w: VALE_BULLET_SHEET.w, h: VALE_BULLET_SHEET.h }]);
		// its mean colour, against each enemy-bullet role, >= MIN_FX_BULLET_DIFFERENCE (the fx rule)
		const rows = fxColorReport(m).filter((e) => e.subject === hit);
		expect(rows.map((e) => [e.source, e.against])).toEqual(ENEMY_BULLET_ROLES.map((r) => ["meanColor", r]));
		for (const e of rows)
			expect([e.against, e.difference >= MIN_FX_BULLET_DIFFERENCE, e.ok]).toEqual([e.against, true, true]);
		// the runtime: a one-shot over the sheet's cells (start + f, floor(w / frameW) per row)
		const fx = new ThemePack(m, { warn: quiet }).fx(hit)!;
		expect([fx.frames, fx.fps, fx.loop, fx.sizeTiles, fx.additive]).toEqual([l.frames, l.fps, false, 0.5, true]);
		const perRow = math.floor(VALE_BULLET_SHEET.w / l.frameW);
		for (let f = 0; f < l.frames; f++) {
			const r = fx.frame(f);
			const c = l.start + f;
			expect([f, r.image, r.offset.X, r.offset.Y]).toEqual([
				f,
				SHEET_ID,
				(c % perRow) * l.frameW,
				math.floor(c / perRow) * l.frameH,
			]);
		}
	});
	it("a layout with `sheet` draws over its own sheet once that has an ID, independently of bullets.png (NX8)", () => {
		// the generated flame and hook (docs/NEW_ENEMIES_2.md NX8) sit in bullets-2.png, so bullets.png never repacked
		const ownIds = ["bullet.enemy.flame", "bullet.enemy.hook"];
		for (const id of ownIds) {
			const l = VALE_BULLET_LAYOUTS[id];
			expect([id, l !== undefined && l.sheet !== undefined]).toEqual([id, true]);
			expect([id, VALE_BULLET_OWN_SHEETS[l.sheet!] !== undefined]).toEqual([id, true]);
		}
		for (const id of sortedKeys(VALE_BULLET_LAYOUTS)) {
			if (!ownIds.includes(id)) expect([id, VALE_BULLET_LAYOUTS[id].sheet]).toEqual([id, undefined]);
		}
		const file = VALE_BULLET_LAYOUTS["bullet.enemy.flame"].sheet!;
		const sheet = VALE_BULLET_OWN_SHEETS[file];
		// bullets.png alone (the uploaded bullets-2.png left out): the two stay placeholders, every other mapped bullet draws
		const withoutOwn: Record<string, string> = {};
		for (const f of sortedKeys(VALE_ASSET_IDS)) {
			if (f !== file) withoutOwn[f] = VALE_ASSET_IDS[f];
		}
		const main = buildValeManifest({ ...withoutOwn, [VALE_BULLET_SHEET.file]: SHEET_ID });
		for (const id of ownIds) expect([id, main.assets[id]]).toEqual([id, PLACEHOLDER_MANIFEST.assets[id]]);
		// the own sheet alone: only the two draw, over it
		const without: Record<string, string> = {};
		for (const f of sortedKeys(VALE_ASSET_IDS)) {
			if (f !== VALE_BULLET_SHEET.file) without[f] = VALE_ASSET_IDS[f];
		}
		const m = buildValeManifest({ ...without, [file]: OWN_ID });
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		for (const id of BULLET_IDS) {
			const drawn = ownIds.includes(id);
			if (!drawn && VALE_BULLET_LAYOUTS[id] !== undefined)
				expect([id, m.assets[id]]).toEqual([id, PLACEHOLDER_MANIFEST.assets[id]]);
		}
		for (const e of bulletArtReport(m)) {
			expect([e.id, e.check, e.against, e.surface, e.ok]).toEqual([e.id, e.check, e.against, e.surface, true]);
		}
		const pack = new ThemePack(m, { warn: quiet });
		for (const id of ownIds) {
			const l = VALE_BULLET_LAYOUTS[id];
			const set = m.assets[id] as SpriteSetAsset;
			expect([id, set.kind, set.sheets]).toEqual([id, "sprites", [{ assetId: OWN_ID, w: sheet.w, h: sheet.h }]]);
			const b = pack.bullet(id)!;
			const perRow = math.floor(sheet.w / l.frameW);
			for (let f = 0; f < l.frames; f++) {
				const r = b.frame(f);
				const c = l.start + f;
				expect([id, f, r.image, r.offset.X, r.offset.Y]).toEqual([
					id,
					f,
					OWN_ID,
					(c % perRow) * l.frameW,
					math.floor(c / perRow) * l.frameH,
				]);
				expect([id, f, r.offset.Y + l.frameH <= sheet.h]).toEqual([id, f, true]);
			}
		}
	});
});
