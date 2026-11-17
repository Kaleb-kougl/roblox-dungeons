// Cosmetics on screen (docs/COSMETICS.md CS5 / CS10's view half): a player's look by index, colours in whole channels
// on the view's clock (a Prismatic dye drifts and holds its first stop under reduced motion), the change key, the dye x
// tint, a dye's character and set, never another set's dye, and the stage manifest's dye sheets (only for a worn dye of
// that character, after the sets, never for a pack without dye ids).
import { describe, expect, it } from "@rbxts/jest-globals";
import { COSMETIC_ITEMS, NO_LOOK, cosmeticItemsOf, isPrismaticItem, type CosmeticLook } from "shared/cosmetics";
import {
	COSMETIC_DYE_SETS,
	PLACEHOLDER_MANIFEST,
	PRISMATIC,
	ThemePack,
	cosmeticHex,
	parseHex,
	prismaticStopsOf,
	type ContentRef,
	type RobloxAssetId,
} from "shared/theme";
import {
	NO_STAGE_FEATURES,
	STAGE_DYE_PREFIX,
	stageAssetGroups,
	stageContentRefs,
	stageAssets,
	stageDyeGroup,
	stageIsLogicalId,
	type PreloadSource,
	type StageAssetInput,
} from "shared/view";
import {
	cosmeticClockSec,
	cosmeticRgb8,
	dyeCharacterOf,
	dyeForVisual,
	dyeSetOf,
	lookAnimated,
	lookAt,
	rgb8Key,
	stageDyeSets,
	tintedDye,
} from "./looks";

const quiet = () => undefined;
const placeholder = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });

const KNIGHT_DYES = cosmeticItemsOf("dye.knight");
const ARCHER_DYES = cosmeticItemsOf("dye.archer");
const solidKnightDye = KNIGHT_DYES.find((d) => !isPrismaticItem(d.id))!;
const prismaticKnightDye = KNIGHT_DYES.find((d) => isPrismaticItem(d.id))!;
const archerDye = ARCHER_DYES[0];
const anOutline = cosmeticItemsOf("outline")[0];

describe("cosmetics view: looks (docs/COSMETICS.md CS5)", () => {
	it("lookAt: a player's look by index, the default look beyond the list or without one", () => {
		const looks: CosmeticLook[] = [{ outline: anOutline.id }, {}];
		expect(lookAt(looks, 0)).toBe(looks[0]);
		expect(lookAt(looks, 5)).toBe(NO_LOOK);
		expect(lookAt(undefined, 0)).toBe(NO_LOOK);
	});

	it("every item's colour is whole channels; a one-colour item is its hex at any time", () => {
		for (const it of COSMETIC_ITEMS) {
			const c = cosmeticRgb8(it.id, 3.3)!;
			expect(c).toBeDefined();
			for (const v of [c.r, c.g, c.b]) {
				expect(v).toBe(math.floor(v));
				expect(v >= 0 && v <= 255).toBe(true);
			}
			const hex = cosmeticHex(it.id);
			if (hex !== undefined) {
				const want = parseHex(hex)!;
				expect([c.r, c.g, c.b]).toEqual([want.r, want.g, want.b]);
			}
		}
		expect(cosmeticRgb8(undefined)).toBeUndefined();
		expect(cosmeticRgb8("not.an.item")).toBeUndefined();
	});

	it("a Prismatic dye drifts on the clock and holds its first stop under reduced motion (CSD7)", () => {
		const id = prismaticKnightDye.id;
		const first = parseHex(prismaticStopsOf(id)![0])!;
		const held = cosmeticRgb8(id, cosmeticClockSec(PRISMATIC.periodSec / 3, true))!;
		expect([held.r, held.g, held.b]).toEqual([first.r, first.g, first.b]);
		const moving = cosmeticRgb8(id, cosmeticClockSec(PRISMATIC.periodSec / 3, false))!;
		expect(rgb8Key(moving)).never.toBe(rgb8Key(held));
		expect(lookAnimated({ dye: id })).toBe(true);
		expect(lookAnimated({ dye: solidKnightDye.id, outline: anOutline.id })).toBe(false);
	});

	it("rgb8Key: one number per whole colour, -1 for none", () => {
		expect(rgb8Key(undefined)).toBe(-1);
		expect(rgb8Key({ r: 0, g: 0, b: 0 })).toBe(0);
		expect(rgb8Key({ r: 1, g: 2, b: 3 })).never.toBe(rgb8Key({ r: 3, g: 2, b: 1 }));
		expect(rgb8Key({ r: 255, g: 255, b: 255 })).toBe(256 * 256 * 256 - 1);
	});

	it("tintedDye multiplies per channel (white tint: the dye itself)", () => {
		const d = tintedDye({ r: 255, g: 102, b: 0 }, { r: 1, g: 1, b: 1 });
		expect([d.r, d.g, d.b]).toEqual([1, 0.4, 0]);
		const t = tintedDye({ r: 255, g: 255, b: 255 }, { r: 0.5, g: 0.25, b: 1 });
		expect([t.r, t.g, t.b]).toEqual([0.5, 0.25, 1]);
	});

	it("a dye names its character and sprite set; other slots none", () => {
		expect(dyeCharacterOf(solidKnightDye.id)).toBe("knight");
		expect(dyeSetOf(solidKnightDye.id)).toBe(COSMETIC_DYE_SETS.knight);
		if (archerDye !== undefined) {
			expect(dyeCharacterOf(archerDye.id)).toBe("archer");
			expect(dyeSetOf(archerDye.id)).toBe(COSMETIC_DYE_SETS.archer);
		}
		expect(dyeCharacterOf(anOutline.id)).toBeUndefined();
		expect(dyeSetOf(undefined)).toBeUndefined();
	});

	it("dyeForVisual: only a dye of that set (never tints one character with another's colour)", () => {
		const look: CosmeticLook = { dye: solidKnightDye.id };
		expect(dyeForVisual(look, COSMETIC_DYE_SETS.knight)).toBe(solidKnightDye.id);
		expect(dyeForVisual(look, COSMETIC_DYE_SETS.archer)).toBeUndefined();
		expect(dyeForVisual(NO_LOOK, COSMETIC_DYE_SETS.knight)).toBeUndefined();
	});

	it("stageDyeSets: each worn dye's set once, in player order; nobody dyed: none", () => {
		expect(stageDyeSets(undefined)).toEqual([]);
		expect(stageDyeSets([{}, { outline: anOutline.id }])).toEqual([]);
		const looks: CosmeticLook[] = [{ dye: solidKnightDye.id }, { dye: prismaticKnightDye.id }];
		if (archerDye !== undefined) looks.unshift({ dye: archerDye.id });
		const want =
			archerDye !== undefined ? [COSMETIC_DYE_SETS.archer, COSMETIC_DYE_SETS.knight] : [COSMETIC_DYE_SETS.knight];
		expect(stageDyeSets(looks)).toEqual(want);
	});
});

/** A source with one sprite set and its dye sheets (the placeholder and today's vale pack have no dye ids). */
const ref = (n: number): ContentRef => ({ contentId: `test://${n}` as unknown as RobloxAssetId, media: "image" });
function dyedSource(): PreloadSource {
	const knight = COSMETIC_DYE_SETS.knight;
	return {
		assetIdList() {
			return [knight];
		},
		contentIds(id) {
			return id === knight ? [ref(1), ref(2)] : [];
		},
		biomeKeys() {
			return [];
		},
		biomeContentIds() {
			return [];
		},
		dyeContentIds(id) {
			return id === knight ? [ref(11), ref(12)] : [];
		},
	};
}

function input(over: Partial<StageAssetInput> = {}): StageAssetInput {
	return {
		world: "endless",
		floor: 1,
		biome: 0,
		characters: [COSMETIC_DYE_SETS.knight],
		actorKinds: [],
		features: NO_STAGE_FEATURES,
		runStart: false,
		...over,
	};
}

describe("cosmetics view: the stage manifest's dye sheets (docs/COSMETICS.md CS5)", () => {
	it("a worn dye's sheets join the characters group after the sets; nobody dyed: none", () => {
		const src = dyedSource();
		const plain = stageAssetGroups(src, input());
		expect(plain[0].ids).toEqual([COSMETIC_DYE_SETS.knight]);
		const dyed = stageAssetGroups(src, input({ dyed: [COSMETIC_DYE_SETS.knight] }));
		expect(dyed[0].group).toBe("characters");
		expect(dyed[0].ids).toEqual([COSMETIC_DYE_SETS.knight, `${STAGE_DYE_PREFIX}${COSMETIC_DYE_SETS.knight}`]);
		const refs = stageContentRefs(src, stageAssets(src, input({ dyed: [COSMETIC_DYE_SETS.knight] })));
		expect(refs.must.map((r) => r.contentId as string)).toEqual(["test://1", "test://2", "test://11", "test://12"]);
		expect(stageContentRefs(src, stageAssets(src, input())).must.size()).toBe(2);
	});

	it("a set without dye sheets, or a source / pack without dye ids, adds nothing", () => {
		const src = dyedSource();
		expect(stageDyeGroup(src, [COSMETIC_DYE_SETS.archer])).toEqual([]);
		expect(stageDyeGroup(src, undefined)).toEqual([]);
		expect(stageDyeGroup(placeholder, [COSMETIC_DYE_SETS.knight])).toEqual([]);
		const noDyes: PreloadSource = { ...src, dyeContentIds: undefined };
		expect(stageDyeGroup(noDyes, [COSMETIC_DYE_SETS.knight])).toEqual([]);
	});

	it("dye entries are not logical ids (no readiness of their own)", () => {
		expect(stageIsLogicalId(`${STAGE_DYE_PREFIX}${COSMETIC_DYE_SETS.knight}`)).toBe(false);
		expect(stageIsLogicalId("biome:biome.1")).toBe(false);
		expect(stageIsLogicalId(COSMETIC_DYE_SETS.knight)).toBe(true);
	});
});
