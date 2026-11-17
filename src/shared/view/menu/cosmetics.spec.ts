// The Armory's Cosmetics tab and its live preview (docs/COSMETICS.md CS6): every cosmetic under its slot's header in
// slot then catalogue order, each item's action (buy / equip / take off / none) and detail, the equip remote's
// arguments, the preview's character and try-on look, its turning facing (held under reduced motion) and the bought
// row's stamp. Counts and ids are read from COSMETIC_ITEMS (the palette may change).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	COSMETIC_ITEMS,
	COSMETIC_SLOTS,
	LOOK_SLOTS,
	cosmeticItemsOf,
	isPrismaticItem,
	type CosmeticItemDef,
} from "shared/cosmetics";
import {
	PLACEHOLDER_MANIFEST,
	ThemePack,
	cosmeticNameKey,
	cosmeticSlotKey,
	type SpriteFacings,
	type StringVars,
} from "shared/theme";
import {
	CONFIRM_FROM_TIER,
	WALLET,
	emptyWalletDoc,
	parseFakeWallet,
	walletStatusOf,
	type WalletStatus,
} from "shared/wallet";
import { CHARACTER_PREVIEW_ANGLE_DEG } from "./character";
import {
	armoryCosmeticEntries,
	cosmeticDetail,
	cosmeticEquipArgs,
	cosmeticFlashScale,
	cosmeticItemEntries,
	cosmeticPreviewCharacter,
	cosmeticPreviewLook,
	cosmeticRowRight,
	previewTurnFacing,
	type CosmeticItemEntry,
} from "./cosmetics";
import { COSMETIC_VIEW } from "../cosmetics/config";
import { facingIndex } from "../sprites";

const quiet = () => {};
const PACK = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
const s = (key: string, vars?: StringVars) => PACK.str(key, vars);
const DAY = 100;

function fake(text: string): WalletStatus {
	const f = parseFakeWallet(text, DAY);
	if (f === undefined || !f.loaded) return { loaded: false };
	return walletStatusOf(f.doc, true, DAY);
}

function entryOf(status: WalletStatus, id: string): CosmeticItemEntry {
	return cosmeticItemEntries(armoryCosmeticEntries(status)).find((e) => e.row.itemId === id)!;
}

const outline = cosmeticItemsOf(LOOK_SLOTS.outline)[0];
const outline2 = cosmeticItemsOf(LOOK_SLOTS.outline)[1];
const knightDye = cosmeticItemsOf("dye.knight")[0];
const archerDye = cosmeticItemsOf("dye.archer")[0];
const dearItem = COSMETIC_ITEMS.find((it) => it.tier >= CONFIRM_FROM_TIER) as CosmeticItemDef | undefined;
const cheapItem = COSMETIC_ITEMS.find((it) => it.tier < CONFIRM_FROM_TIER) as CosmeticItemDef | undefined;

describe("armory cosmetics: the list (docs/COSMETICS.md CS6)", () => {
	it("every cosmetic once, under its slot's header, slots in COSMETIC_SLOTS order, catalogue order within", () => {
		const entries = armoryCosmeticEntries(walletStatusOf(emptyWalletDoc(), true, DAY));
		const items = cosmeticItemEntries(entries);
		expect(items.size()).toBe(COSMETIC_ITEMS.size());
		const headers = entries.filter((e) => e.kind === "header").map((e) => e.slot);
		expect(headers).toEqual(COSMETIC_SLOTS.filter((slot) => cosmeticItemsOf(slot).size() > 0));
		let slot = "";
		for (const e of entries) {
			if (e.kind === "header") slot = e.slot;
			else expect(e.slot).toBe(slot);
		}
		for (const sl of COSMETIC_SLOTS) {
			expect(items.filter((e) => e.slot === sl).map((e) => e.row.itemId)).toEqual(
				cosmeticItemsOf(sl).map((it) => it.id),
			);
		}
		for (const e of items) expect(e.animated).toBe(isPrismaticItem(e.row.itemId));
	});

	it("actions: poor -> none, affordable -> buy (confirm from CONFIRM_FROM_TIER), owned -> equip / take off", () => {
		const poor = entryOf(fake("0"), outline.id);
		expect([poor.action, poor.row.state]).toEqual(["none", "poor"]);
		expect(cosmeticRowRight(poor, s)).toBe(s("armory.toGo", { silver: poor.row.toGo }));
		const rich = fake("100000");
		if (cheapItem !== undefined) {
			const e = entryOf(rich, cheapItem.id);
			expect(e.action).toBe("buy");
			expect(cosmeticDetail(e, s).buy).toBe("hold");
		}
		if (dearItem !== undefined) expect(cosmeticDetail(entryOf(rich, dearItem.id), s).buy).toBe("holdConfirm");
		const worn = fake(`6000;${outline.id}:1*,${outline2.id}:1`);
		const on = entryOf(worn, outline.id);
		expect([on.owned, on.equipped, on.action]).toEqual([true, true, "unequip"]);
		const off = entryOf(worn, outline2.id);
		expect([off.owned, off.equipped, off.action]).toEqual([true, false, "equip"]);
		expect(cosmeticRowRight(on, s)).toBe(s("cosmetic.equipped"));
		expect(cosmeticRowRight(off, s)).toBe(s("armory.owned"));
		const unknown = entryOf({ loaded: false }, outline.id);
		expect([unknown.action, cosmeticRowRight(unknown, s)]).toEqual(["none", ""]);
	});

	it("the detail: name, slot and tier, Animated for a Prismatic dye, the equip button's label", () => {
		const worn = fake(`6000;${outline.id}:1*,${outline2.id}:1`);
		const d = cosmeticDetail(entryOf(worn, outline.id), s);
		expect(d.title).toBe(s(cosmeticNameKey(outline.id)));
		expect(d.sub).toBe(`${s(cosmeticSlotKey(outline.slot))}  ·  ${s("armory.tier", { tier: outline.tier })}`);
		expect([d.equip, d.equipKey, d.price, d.buy]).toEqual([
			"unequip",
			"cosmetic.unequip",
			s("cosmetic.equipped"),
			"none",
		]);
		expect(cosmeticDetail(entryOf(worn, outline2.id), s).equipKey).toBe("cosmetic.equip");
		const prismatic = COSMETIC_ITEMS.find((it) => isPrismaticItem(it.id));
		if (prismatic !== undefined) {
			expect(cosmeticDetail(entryOf(worn, prismatic.id), s).tag).toBe(s("cosmetic.animated"));
		}
		expect(d.tag).toBeUndefined();
	});

	it("equip sends the item; take off sends WALLET.noItem", () => {
		expect(cosmeticEquipArgs(outline.slot, outline.id, "equip")).toEqual([outline.slot, outline.id]);
		expect(cosmeticEquipArgs(outline.slot, outline.id, "unequip")).toEqual([outline.slot, WALLET.noItem]);
	});
});

describe("armory cosmetics: the live preview (docs/COSMETICS.md CS6)", () => {
	it("draws a dye's own character, else the picked one", () => {
		expect(cosmeticPreviewCharacter(knightDye.id, "archer")).toBe("knight");
		if (archerDye !== undefined) expect(cosmeticPreviewCharacter(archerDye.id, "knight")).toBe("archer");
		expect(cosmeticPreviewCharacter(outline.id, "archer")).toBe("archer");
		expect(cosmeticPreviewCharacter(undefined, "knight")).toBe("knight");
	});

	it("tries the focused item on over the equipped look (never another character's dye)", () => {
		const worn = fake(`6000;${outline.id}:1*,${knightDye.id}:1*`);
		expect(cosmeticPreviewLook(worn, "knight", undefined)).toEqual({ dye: knightDye.id, outline: outline.id });
		expect(cosmeticPreviewLook(worn, "knight", outline2.id)).toEqual({ dye: knightDye.id, outline: outline2.id });
		expect(cosmeticPreviewLook(worn, "archer", knightDye.id)).toEqual({ outline: outline.id });
		expect(cosmeticPreviewLook({ loaded: false }, "knight", outline2.id)).toEqual({ outline: outline2.id });
	});

	it("turns through every facing from the camera-facing one; reduced motion holds it", () => {
		const facings: SpriteFacings = { count: 8, zeroDeg: 0, ccw: true };
		const front = facingIndex(CHARACTER_PREVIEW_ANGLE_DEG, facings);
		const step = COSMETIC_VIEW.preview.facingSec;
		expect(previewTurnFacing(0, facings, false)).toBe(front);
		expect(previewTurnFacing(5 * step, facings, true)).toBe(front);
		const seen = new Set<number>();
		for (let k = 0; k < facings.count; k++) seen.add(previewTurnFacing((k + 0.5) * step, facings, false));
		expect(seen.size()).toBe(facings.count);
		expect(previewTurnFacing(facings.count * step + step / 2, facings, false)).toBe(front);
		expect(previewTurnFacing(3 * step, { count: 1, zeroDeg: 0, ccw: true }, false)).toBe(0);
	});

	it("the bought row's stamp eases from flashScale back to 1 (none under reduced motion)", () => {
		const p = COSMETIC_VIEW.preview;
		expect(cosmeticFlashScale(0, false)).toBe(p.flashScale);
		expect(cosmeticFlashScale(p.flashSec / 2, false) < p.flashScale).toBe(true);
		expect(cosmeticFlashScale(p.flashSec, false)).toBe(1);
		expect(cosmeticFlashScale(0, true)).toBe(1);
	});
});
