// The vale pack's boost auras (docs/BOOST_ART.md BAD3): boostAuraLayout.ts becomes the four fx.boost.aura.<kind> sets
// once boost-auras.png has an ID (absent: no aura entry, the Neon discs exactly as today), each carrying every stack
// rank; the runtime addresses the cells the pipeline wrote, and the pack validates.
import { describe, expect, it } from "@rbxts/jest-globals";
import { boostAuraArtProblems, boostAuraRankAnimation } from "../../boostAuraArt";
import { BOOST_KINDS, boostAuraFxId, boostId, type FxId } from "../../contract";
import { ThemePack } from "../../pack";
import type { SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { validateManifest } from "../../validate";
import { VALE_ASSET_IDS } from "./assetIds";
import { VALE_BOOST_AURA_LAYOUTS, VALE_BOOST_AURA_SHEET } from "./boostAuraLayout";
import { VALE_BOOST_AURA_IDS, VALE_BOOST_AURA_SOURCE, valeBoostAuraAssets } from "./boostAuras";
import { VALE_MANIFEST, buildValeManifest } from "./manifest";

const quiet = () => undefined;
/** A fake upload (test vector) for the aura sheet. */
const SHEET_ID = "rbxassetid://7500";

describe("vale boost auras (docs/BOOST_ART.md BAD3)", () => {
	it("reads the generated layout by default: one set per kind in boost-auras.png", () => {
		expect(VALE_BOOST_AURA_SOURCE.sheet).toBe(VALE_BOOST_AURA_SHEET);
		expect(VALE_BOOST_AURA_SOURCE.layouts).toBe(VALE_BOOST_AURA_LAYOUTS);
		expect(VALE_BOOST_AURA_SHEET.file).toBe("boost-auras.png");
		expect(sortedKeys(VALE_BOOST_AURA_LAYOUTS)).toEqual([...VALE_BOOST_AURA_IDS].sort());
		expect([...VALE_BOOST_AURA_IDS]).toEqual(BOOST_KINDS.map((k) => boostAuraFxId(k)));
	});

	it("without boost-auras.png's ID there is no aura entry (the discs, as the placeholder pack)", () => {
		const manifests = [buildValeManifest({})];
		if (VALE_ASSET_IDS[VALE_BOOST_AURA_SHEET.file] === undefined) manifests.push(VALE_MANIFEST);
		for (const m of manifests) {
			for (const id of VALE_BOOST_AURA_IDS) expect([id, m.assets[id]]).toEqual([id, undefined]);
			const pack = new ThemePack(m, { warn: quiet });
			for (const id of VALE_BOOST_AURA_IDS) expect([id, pack.fx(id as FxId)]).toEqual([id, undefined]);
		}
		expect(valeBoostAuraAssets({})).toEqual({});
	});

	it("with the ID: four valid one-facing fx sets, every rank's loop and ring, tinted by the kind's role", () => {
		const ids = { ...VALE_ASSET_IDS, [VALE_BOOST_AURA_SHEET.file]: SHEET_ID };
		const m = buildValeManifest(ids);
		expect(validateManifest(m, { packId: "vale" })).toEqual([]);
		expect(boostAuraArtProblems(m)).toEqual([]);
		const pack = new ThemePack(m, { warn: quiet });
		for (const kind of BOOST_KINDS) {
			const id = boostAuraFxId(kind);
			const l = VALE_BOOST_AURA_LAYOUTS[id];
			const set = m.assets[id] as SpriteSetAsset;
			expect([id, set.kind, set.facings.count, set.tint, set.additive, set.resample]).toEqual([
				id,
				"sprites",
				1,
				boostId(kind),
				true,
				"Pixelated",
			]);
			expect([id, set.ringPx]).toEqual([id, l.ringPx]);
			const animNames = new Array<string>();
			for (let r = 0; r < l.ringPx.size(); r++) animNames.push(boostAuraRankAnimation(r));
			expect([id, sortedKeys(set.animations)]).toEqual([id, [...animNames].sort()]);
			const fx = pack.fx(id);
			expect([id, fx !== undefined, fx?.ranks?.size()]).toEqual([id, true, l.ringPx.size()]);
			expect([id, fx!.color]).toEqual([id, pack.boost(kind).color]);
			const perRow = math.floor(VALE_BOOST_AURA_SHEET.w / l.frameW);
			for (let r = 0; r < l.ringPx.size(); r++) {
				const rank = fx!.ranks![r];
				expect([id, r, rank.frames, rank.fps, rank.ringPx]).toEqual([id, r, l.frames, l.fps, l.ringPx[r]]);
				for (let f = 0; f < l.frames; f++) {
					const c = l.start + r * l.frames + f;
					const frame = rank.frame(f);
					expect([id, r, f, frame.image, frame.offset.X, frame.offset.Y, frame.size.X, frame.size.Y]).toEqual(
						[
							id,
							r,
							f,
							SHEET_ID,
							(c % perRow) * l.frameW,
							math.floor(c / perRow) * l.frameH,
							l.frameW,
							l.frameH,
						],
					);
					expect([id, r, f, frame.offset.Y + l.frameH <= VALE_BOOST_AURA_SHEET.h]).toEqual([id, r, f, true]);
				}
				// loops wrap
				expect([id, r, rank.frame(l.frames).offset.X]).toEqual([id, r, rank.frame(0).offset.X]);
			}
		}
	});
});
