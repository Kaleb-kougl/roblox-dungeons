// The vale pack's sprite effects and ambient particle textures (docs/FX_AUDIO.md F2, F6): the generated fxLayout.ts
// must satisfy the validator once uploaded (fx fields, the enemy-bullet colour rule, flipbook textures), the runtime must
// address the cells the pipeline wrote, and nothing may switch on before its PNG has an ID.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BIOMES, FX_ANIMATION, FX_IDS, FX_SPRITE_MAX_TILES, decorAmbientId, type FxId } from "../../contract";
import { ThemePack } from "../../pack";
import type { SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { fxColorReport, validateManifest } from "../../validate";
import { VALE_AMBIENT_EMISSIVE, VALE_FX } from "./fx";
import { VALE_AMBIENT_LAYOUTS, VALE_FX_LAYOUTS, VALE_FX_SHEET } from "./fxLayout";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_WORLD_LAYOUTS } from "./layout";
import { VALE_MANIFEST, buildValeManifest } from "./manifest";

const quiet = () => undefined;

/** Fake uploaded IDs (test vectors; src/shared/theme is exempt from check-asset-ids) for the effect files. */
function fxIds(...skip: Array<string>): Record<string, string> {
	const files = [VALE_FX_SHEET.file];
	for (const id of sortedKeys(VALE_AMBIENT_LAYOUTS)) files.push(VALE_AMBIENT_LAYOUTS[id].file);
	const ids: Record<string, string> = {};
	files.forEach((file, i) => {
		if (!skip.includes(file)) ids[file] = `rbxassetid://${7100 + i}`;
	});
	return ids;
}

function isFxOrAmbient(id: string): boolean {
	return id.sub(1, 3) === "fx." || id.sub(1, 17) === "decor.fx.ambient.";
}

describe("vale effects (fx.*)", () => {
	it("maps every fx ID to a generated sheet and a look within the size cap", () => {
		for (const id of FX_IDS) {
			const l = VALE_FX_LAYOUTS[id];
			const look = VALE_FX[id];
			expect([id, l !== undefined, look !== undefined]).toEqual([id, true, true]);
			expect([id, look.sizeTiles > 0 && look.sizeTiles <= FX_SPRITE_MAX_TILES]).toEqual([id, true]);
			// a greyed sheet is tinted; an untinted one keeps its colours and carries its mean colour
			expect([id, l.grey, look.tint !== undefined]).toEqual([id, look.tint !== undefined, l.grey]);
			expect([id, l.grey || l.meanColor !== undefined]).toEqual([id, true]);
		}
		expect(sortedKeys(VALE_FX_LAYOUTS)).toEqual([...FX_IDS].sort());
	});

	it("as bundled (no effect PNG uploaded) has no fx or ambient entry: nothing changes on screen", () => {
		expect(VALE_ASSET_IDS[VALE_FX_SHEET.file]).toBe(undefined);
		for (const id of sortedKeys(VALE_MANIFEST.assets)) expect([id, isFxOrAmbient(id)]).toEqual([id, false]);
		const pack = new ThemePack(VALE_MANIFEST, { warn: quiet });
		for (const id of FX_IDS) expect([id, pack.fx(id)]).toEqual([id, undefined]);
		for (const b of BIOMES) expect([b.id, pack.ambient(b.id)]).toEqual([b.id, undefined]);
	});

	it("with the atlas uploaded validates with zero problems and draws every effect", () => {
		const ids = fxIds();
		const m = buildValeManifest(ids);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const pack = new ThemePack(m, { warn: quiet });
		for (const id of FX_IDS) {
			const fx = pack.fx(id);
			const l = VALE_FX_LAYOUTS[id];
			const look = VALE_FX[id];
			expect([id, fx !== undefined]).toEqual([id, true]);
			expect([id, fx!.frames, fx!.fps, fx!.loop]).toEqual([id, l.frames, l.fps, l.loop]);
			expect([id, fx!.sizeTiles, fx!.tint, fx!.additive]).toEqual([id, look.sizeTiles, look.tint, look.additive]);
			expect([id, fx!.set.resample]).toEqual([id, "Pixelated"]);
			if (look.tint !== undefined) expect([id, fx!.color]).toEqual([id, pack.color(look.tint)]);
			// every frame is the pipeline's cell: start + f in rows of floor(sheet w / frameW)
			const perRow = math.floor(VALE_FX_SHEET.w / l.frameW);
			for (let f = 0; f < l.frames; f++) {
				const r = fx!.frame(f);
				const c = l.start + f;
				expect([id, f, r.image, r.offset.X, r.offset.Y, r.size.X, r.size.Y]).toEqual([
					id,
					f,
					ids[VALE_FX_SHEET.file],
					(c % perRow) * l.frameW,
					math.floor(c / perRow) * l.frameH,
					l.frameW,
					l.frameH,
				]);
				expect([id, f, r.offset.Y + l.frameH <= VALE_FX_SHEET.h]).toEqual([id, f, true]);
			}
			// one-shots hold their last frame, loops wrap
			const last = fx!.frame(l.frames - 1);
			const past = fx!.frame(l.frames);
			expect([id, past.offset.X, past.offset.Y]).toEqual(
				l.loop ? [id, fx!.frame(0).offset.X, fx!.frame(0).offset.Y] : [id, last.offset.X, last.offset.Y],
			);
		}
		// hand-computed: swing.3 is the tallest band, at the atlas origin
		const s3 = pack.fx("fx.swing.3")!.frame(0);
		expect([s3.offset.X, s3.offset.Y]).toEqual([0, 0]);
	});

	it("every effect colour (tints and the untinted sheets' mean colours) passes the enemy-bullet rule", () => {
		const m = buildValeManifest(fxIds());
		const report = fxColorReport(m);
		const subjects = new Set<string>();
		for (const e of report) {
			subjects.add(e.subject);
			expect([e.subject, e.source, e.against, e.ok]).toEqual([e.subject, e.source, e.against, true]);
		}
		for (const id of FX_IDS) expect([id, subjects.has(id)]).toEqual([id, true]);
		const slam = m.assets["fx.boss.slam"] as SpriteSetAsset;
		expect(slam.tint).toBe(undefined);
		expect(slam.meanColor).toBe(VALE_FX_LAYOUTS["fx.boss.slam"].meanColor);
	});

	it("a set's play animation is the contract's", () => {
		const m = buildValeManifest(fxIds());
		for (const id of FX_IDS) {
			const set = m.assets[id] as SpriteSetAsset;
			expect([id, sortedKeys(set.animations)]).toEqual([id, [FX_ANIMATION]]);
			expect([id, set.facings.count]).toEqual([id, 1]);
		}
	});

	it("without the atlas no effect switches on; the ambient textures still do", () => {
		const m = buildValeManifest(fxIds(VALE_FX_SHEET.file));
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		const pack = new ThemePack(m, { warn: quiet });
		for (const id of FX_IDS) expect([id, pack.fx(id as FxId)]).toEqual([id, undefined]);
		expect(pack.ambient("biome.3")).never.toBe(undefined);
	});
});

describe("vale ambient particle textures (decor.fx.ambient.b<n>)", () => {
	it("are square flipbooks (or one frame) and reach the renderer with their flipbook", () => {
		const ids = fxIds();
		const pack = new ThemePack(buildValeManifest(ids), { warn: quiet });
		for (const b of BIOMES) {
			const id = decorAmbientId(b.id);
			const l = VALE_AMBIENT_LAYOUTS[id];
			const a = pack.ambient(b.id);
			if (l === undefined) {
				// grim (b4): no match in the pack, no texture
				expect([id, a]).toEqual([id, undefined]);
				continue;
			}
			expect([id, l.w === l.h, a !== undefined]).toEqual([id, true, true]);
			expect(a!.assetId).toBe(ids[l.file]);
			expect(a!.emissive).toBe(VALE_AMBIENT_EMISSIVE.includes(id));
			if (l.grid > 1) {
				expect([id, a!.flipbook]).toEqual([id, { grid: l.grid, fps: l.fps, mode: l.mode }]);
				expect([id, l.w % l.grid]).toEqual([id, 0]);
			} else expect([id, a!.flipbook]).toEqual([id, undefined]);
		}
		expect(VALE_AMBIENT_LAYOUTS["decor.fx.ambient.b4"]).toBe(undefined);
	});

	it("each switches on only with its own file", () => {
		const b3 = VALE_AMBIENT_LAYOUTS["decor.fx.ambient.b3"].file;
		const m = buildValeManifest(fxIds(b3));
		expect(m.assets["decor.fx.ambient.b3"]).toBe(undefined);
		expect(m.assets["decor.fx.ambient.b2"]).never.toBe(undefined);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
	});

	it("give way to the R5 mote (decor-mote.png) once it is uploaded, in every biome", () => {
		const mote = VALE_WORLD_LAYOUTS["mote"];
		expect(mote.kind).toBe("image");
		const moteFile = mote.kind === "image" ? mote.file : "";
		const ids = fxIds();
		ids[moteFile] = "rbxassetid://7199";
		const m = buildValeManifest(ids);
		for (const b of BIOMES) {
			const a = m.assets[decorAmbientId(b.id)] as unknown as { assetId: string; particle?: object };
			expect([b.id, a.assetId, a.particle]).toEqual([b.id, "rbxassetid://7199", undefined]);
		}
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
	});

	it("the validator rejects a non-square flipbook and a bad grid or mode", () => {
		const m = buildValeManifest(fxIds());
		const tex = m.assets["decor.fx.ambient.b2"] as unknown as { w: number; particle: { flipbook: object } };
		tex.w = tex.w / 2;
		tex.particle.flipbook = { grid: 3, fps: 12, mode: "Sideways" };
		const errors = validateManifest(m, { packId: "vale" });
		expect(errors.size()).toBe(3);
	});
});
