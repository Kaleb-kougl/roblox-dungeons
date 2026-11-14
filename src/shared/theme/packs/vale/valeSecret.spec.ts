// The secret rooms' art in the vale pack (docs/SECRET_ROOMS.md SR11): original greyscale pixel art in a sheet of its own
// (secretLayout.ts, generated from art/atlases.json `secret`). The crack overlay (three variants as its `idle` frames)
// and the rubble are one-facing world sprite sets two cells wide; the dust trickle a tinted one-shot fx flipbook. None
// switches on before secret.png has an ID (not uploaded yet: the view's fallback), and with an ID the manifest validates
// and the pack hands the renderers what they expect.
import { describe, expect, it } from "@rbxts/jest-globals";
import { FX_ANIMATION, FX_SPRITE_MAX_TILES } from "../../contract";
import { ThemePack } from "../../pack";
import { SECRET_ART_IDS, SECRET_CRACK_ID, SECRET_DUST_FX_ID, SECRET_DUST_ROLE, SECRET_RUBBLE_ID } from "../../secrets";
import type { SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { validateManifest } from "../../validate";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_FX, VALE_FX_PENDING, valeFxSourceOf } from "./fx";
import { VALE_MANIFEST, buildValeManifest } from "./manifest";
import { VALE_SECRET_ART_LAYOUTS, VALE_SECRET_FX_LAYOUTS, VALE_SECRET_SHEET } from "./secretLayout";

const quiet = () => undefined;
const FILE = VALE_SECRET_SHEET.file;
/** A fake uploaded ID (a test vector) for the sheet. */
const IDS: Record<string, string> = { [FILE]: "rbxassetid://7601" };
/** The crack's variants (gen-secret-art.js CRACK_VARIANTS: split, impact, mortar). */
const CRACK_VARIANTS = 3;

describe("vale secret-room art (secret.crack, secret.rubble, fx.secret.dust)", () => {
	it("the crack and the rubble: one facing, Pixelated, 2 x 1 tiles, centred, in secret.png; the crack's idle its variants", () => {
		expect(FILE).toBe("secret.png");
		expect([...SECRET_ART_IDS].sort()).toEqual(sortedKeys(VALE_SECRET_ART_LAYOUTS));
		for (const id of SECRET_ART_IDS) {
			const l = VALE_SECRET_ART_LAYOUTS[id];
			expect([id, l.kind, l.facings.count, l.resample]).toEqual([id, "sprites", 1, "Pixelated"]);
			expect([id, l.frameW / l.pixelsPerTile, l.frameH / l.pixelsPerTile]).toEqual([id, 2, 1]);
			expect([id, l.pivot.x, l.pivot.y]).toEqual([id, l.frameW / 2, l.frameH / 2]);
			expect([id, l.sheets.size(), l.sheets[0].file, l.sheets[0].w, l.sheets[0].h]).toEqual([
				id,
				1,
				FILE,
				VALE_SECRET_SHEET.w,
				VALE_SECRET_SHEET.h,
			]);
			// the cells lie inside the sheet (the SpriteSetAsset formula)
			const a = l.animations.idle;
			const perRow = math.floor(VALE_SECRET_SHEET.w / l.frameW);
			const last = a.start + a.frames - 1;
			expect([id, (math.floor(last / perRow) + 1) * l.frameH <= VALE_SECRET_SHEET.h]).toEqual([id, true]);
		}
		expect(VALE_SECRET_ART_LAYOUTS[SECRET_CRACK_ID].animations.idle.frames).toBe(CRACK_VARIANTS);
		expect(VALE_SECRET_ART_LAYOUTS[SECRET_RUBBLE_ID].animations.idle.frames).toBe(1);
	});

	it("the dust: a grey one-shot flipbook in the same sheet, its pivot on the joint at the top, tinted secret.dust", () => {
		const l = VALE_SECRET_FX_LAYOUTS[SECRET_DUST_FX_ID];
		expect([l.loop, l.grey, l.frames, l.fps > 0]).toEqual([false, true, 6, true]);
		expect([l.pivot.x, l.pivot.y < l.frameH / 4]).toEqual([l.frameW / 2, true]);
		expect(valeFxSourceOf(SECRET_DUST_FX_ID)?.sheet).toBe(VALE_SECRET_SHEET);
		expect(VALE_FX_PENDING.includes(SECRET_DUST_FX_ID)).toBe(false);
		const look = VALE_FX[SECRET_DUST_FX_ID];
		expect([look.tint, look.additive]).toEqual([SECRET_DUST_ROLE, false]);
		expect(look.sizeTiles > 0 && look.sizeTiles <= FX_SPRITE_MAX_TILES).toBe(true);
	});

	it("as bundled (secret.png uploaded 2026-11-13) draws all three; without IDs none (the view's fallback)", () => {
		expect(VALE_ASSET_IDS[FILE] !== undefined).toBe(true);
		for (const id of [...SECRET_ART_IDS, SECRET_DUST_FX_ID])
			expect([id, VALE_MANIFEST.assets[id] !== undefined]).toEqual([id, true]);
		const bundled = new ThemePack(VALE_MANIFEST, { warn: quiet });
		expect([bundled.sprites(SECRET_CRACK_ID) !== undefined, bundled.fx(SECRET_DUST_FX_ID) !== undefined]).toEqual([
			true,
			true,
		]);
		const bare = buildValeManifest({});
		for (const id of [...SECRET_ART_IDS, SECRET_DUST_FX_ID]) expect([id, bare.assets[id]]).toEqual([id, undefined]);
		const pack = new ThemePack(bare, { warn: quiet });
		expect([pack.sprites(SECRET_CRACK_ID), pack.fx(SECRET_DUST_FX_ID)]).toEqual([undefined, undefined]);
	});

	it("with secret.png uploaded validates with zero problems and draws all three", () => {
		const m = buildValeManifest(IDS);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		for (const id of SECRET_ART_IDS) {
			const a = m.assets[id] as SpriteSetAsset;
			expect([id, a.kind, a.sheets[0].assetId, a.facings.count]).toEqual([id, "sprites", IDS[FILE], 1]);
		}
		const pack = new ThemePack(m, { warn: quiet });
		const crack = pack.sprites(SECRET_CRACK_ID);
		expect(crack !== undefined).toBe(true);
		if (crack !== undefined) {
			const l = VALE_SECRET_ART_LAYOUTS[SECRET_CRACK_ID];
			const perRow = math.floor(VALE_SECRET_SHEET.w / l.frameW);
			for (let v = 0; v < CRACK_VARIANTS; v++) {
				const f = crack.frame("idle", 0, v);
				const c = l.animations.idle.start + v;
				expect([v, f.image, f.offset.X, f.offset.Y, f.size.X, f.size.Y]).toEqual([
					v,
					IDS[FILE],
					(c % perRow) * l.frameW,
					math.floor(c / perRow) * l.frameH,
					l.frameW,
					l.frameH,
				]);
			}
		}
		const fx = pack.fx(SECRET_DUST_FX_ID);
		expect(fx !== undefined).toBe(true);
		if (fx === undefined) return;
		const l = VALE_SECRET_FX_LAYOUTS[SECRET_DUST_FX_ID];
		expect([fx.frames, fx.fps, fx.loop, fx.tint]).toEqual([l.frames, l.fps, false, SECRET_DUST_ROLE]);
		expect(fx.set.animationNames.includes(FX_ANIMATION)).toBe(true);
	});
});
