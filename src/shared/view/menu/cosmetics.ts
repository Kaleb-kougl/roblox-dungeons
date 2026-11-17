/**
 * The Armory's Cosmetics tab and its live preview (docs/COSMETICS.md CS6, "Armory"), pure: client/ui/menu ArmoryScreen
 * and CosmeticPreview draw it; headlessly tested (cosmetics.spec.ts). Text through an injected lookup (the client's
 * `str`).
 *
 *   list      every cosmetic grouped by slot (shared/cosmetics COSMETIC_SLOTS order, a header per slot with items),
 *             catalogue order within a slot; each item the Armory's own row (armoryRow: price, tier, state, confirm)
 *             plus what the player can do with it: buy it (the Armory's hold, hold then confirm from CONFIRM_FROM_TIER),
 *             equip it, take it off, or nothing (unaffordable, the wallet not loaded)
 *   detail    the focused item: its name, `{slot} · Tier n` and `Animated` for a Prismatic dye, the price / `to go` /
 *             Owned / Equipped, and its buy or equip action
 *   preview   which character the preview draws (a dye's own character; outline / trail / spark: the picked one), the
 *             look it wears (the equipped look with the focused item TRIED ON: docs/COSMETICS.md "try-on"), the facing
 *             it turns to (every facing in turn, CHARACTER_PREVIEW_ANGLE_DEG first; reduced motion holds it)
 *   flash     the bought row's stamp (scale eased back to 1 over COSMETIC_VIEW.preview.flashSec)
 */
import type { CharacterId } from "shared/characters";
import {
	COSMETIC_SLOTS,
	LOOK_SLOTS,
	cosmeticItem,
	cosmeticLookOf,
	equippedMapOf,
	isPrismaticItem,
	type CosmeticLook,
	type CosmeticSlot,
} from "shared/cosmetics";
import { ARMORY_KEYS, COSMETIC_KEYS, cosmeticNameKey, cosmeticSlotKey, type SpriteFacings } from "shared/theme";
import { ARMORY_CATALOG, WALLET, type ArmoryItem, type WalletStatus } from "shared/wallet";
import { walletShown } from "shared/view/silver";
// By file: the cosmetics view's tunables (the shared/view barrel is heavy).
import { COSMETIC_VIEW } from "../cosmetics/config";
import { dyeCharacterOf } from "../cosmetics/looks";
import { facingIndex } from "../sprites";
import { armoryRow, dearestOwnedTier, type ArmoryBuyAction, type ArmoryRow, type ArmoryStr } from "./armory";
import { CHARACTER_PREVIEW_ANGLE_DEG } from "./character";

/** What the focused cosmetic's button does. */
export type CosmeticAction = "buy" | "equip" | "unequip" | "none";

/** A slot's header on the Cosmetics tab. */
export interface CosmeticHeaderEntry {
	readonly kind: "header";
	readonly slot: CosmeticSlot;
}

/** One cosmetic on the Cosmetics tab. */
export interface CosmeticItemEntry {
	readonly kind: "item";
	readonly slot: CosmeticSlot;
	readonly row: ArmoryRow;
	/** Owned (bought). */
	readonly owned: boolean;
	/** Worn in its slot now (WalletStatus.equipped). */
	readonly equipped: boolean;
	/** A Prismatic dye: its swatch drifts and it carries the `Animated` tag. */
	readonly animated: boolean;
	readonly action: CosmeticAction;
}

export type CosmeticListEntry = CosmeticHeaderEntry | CosmeticItemEntry;

/** The item worn in `slot` (WalletStatus.equipped), or undefined. */
export function cosmeticEquippedIn(status: Readonly<WalletStatus> | undefined, slot: string): string | undefined {
	if (status === undefined || !status.loaded) return undefined;
	return equippedMapOf(status.equipped).get(slot);
}

/** What a cosmetic's button does: owned -> equip / take off; else buy when affordable; else nothing. */
export function cosmeticAction(row: Readonly<ArmoryRow>, equipped: boolean): CosmeticAction {
	if (row.state === "unavailable") return "none";
	if (row.state === "owned" || row.state === "maxed") return equipped ? "unequip" : "equip";
	return row.state === "affordable" ? "buy" : "none";
}

/** The Cosmetics tab's list: a header per slot with items, then its items in catalogue order (see the file comment). */
export function armoryCosmeticEntries(
	status: Readonly<WalletStatus> | undefined,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): CosmeticListEntry[] {
	const dearest = dearestOwnedTier(status, catalog);
	const goals = status?.loaded === true ? status.goals ?? [] : [];
	const out: CosmeticListEntry[] = [];
	for (const slot of COSMETIC_SLOTS) {
		const worn = cosmeticEquippedIn(status, slot);
		let first = true;
		for (const it of catalog) {
			if (it.kind !== "cosmetic" || it.slot !== slot) continue;
			if (first) {
				out.push({ kind: "header", slot });
				first = false;
			}
			const row = armoryRow(it, status, dearest, goals);
			const owned = row.level >= 1;
			const equipped = owned && worn === it.id;
			out.push({
				kind: "item",
				slot,
				row,
				owned,
				equipped,
				animated: isPrismaticItem(it.id),
				action: cosmeticAction(row, equipped),
			});
		}
	}
	return out;
}

/** The item entries of a list, in order (focus, the first row). */
export function cosmeticItemEntries(entries: ReadonlyArray<CosmeticListEntry>): CosmeticItemEntry[] {
	const out: CosmeticItemEntry[] = [];
	for (const e of entries) if (e.kind === "item") out.push(e);
	return out;
}

/** The focused cosmetic's detail. */
export interface CosmeticDetail {
	readonly itemId: string;
	readonly slot: CosmeticSlot;
	/** The item's name. */
	readonly title: string;
	/** `{slot} · Tier n`. */
	readonly sub: string;
	/** `Animated` for a Prismatic dye, else undefined. */
	readonly tag: string | undefined;
	/** The price, or Equipped / Owned / Armory unavailable. */
	readonly price: string;
	/** `140 to go` (undefined when affordable or owned). */
	readonly toGo: string | undefined;
	/** The buy hold (hold, hold then confirm), or none (owned, poor, unavailable). */
	readonly buy: ArmoryBuyAction;
	/** Equip / take off once owned, else undefined. */
	readonly equip: "equip" | "unequip" | undefined;
	/** The equip button's label key (COSMETIC_KEYS.equip / unequip), when `equip` is set. */
	readonly equipKey: string | undefined;
	readonly entry: CosmeticItemEntry;
}

/** The detail of `entry` (see the file comment). */
export function cosmeticDetail(entry: Readonly<CosmeticItemEntry>, s: ArmoryStr): CosmeticDetail {
	const row = entry.row;
	const id = row.itemId;
	const tierOf = row.item.tiers[0] ?? 0;
	const sub = `${s(cosmeticSlotKey(entry.slot))}  ·  ${s(ARMORY_KEYS.tier, { tier: tierOf })}`;
	let price: string;
	if (row.state === "unavailable") price = s(ARMORY_KEYS.unavailable);
	else if (entry.equipped) price = s(COSMETIC_KEYS.equipped);
	else if (entry.owned) price = s(ARMORY_KEYS.owned);
	else price = tostring(row.price ?? 0);
	const equip = entry.action === "equip" || entry.action === "unequip" ? entry.action : undefined;
	return {
		itemId: id,
		slot: entry.slot,
		title: s(cosmeticNameKey(id)),
		sub,
		tag: entry.animated ? s(COSMETIC_KEYS.animated) : undefined,
		price,
		toGo: row.state === "poor" ? s(ARMORY_KEYS.toGo, { silver: row.toGo }) : undefined,
		buy: entry.action === "buy" ? (row.confirm ? "holdConfirm" : "hold") : "none",
		equip,
		equipKey: equip === "equip" ? COSMETIC_KEYS.equip : equip === "unequip" ? COSMETIC_KEYS.unequip : undefined,
		entry,
	};
}

/** The `walletEquip(slot, itemId)` arguments of an equip / take off (take off: WALLET.noItem). */
export function cosmeticEquipArgs(
	slot: CosmeticSlot,
	itemId: string,
	action: "equip" | "unequip",
): [slot: string, itemId: string] {
	return [slot, action === "equip" ? itemId : WALLET.noItem];
}

/** The right-hand text of a cosmetic row: Equipped / Owned / the price / `to go` / nothing (unavailable). */
export function cosmeticRowRight(entry: Readonly<CosmeticItemEntry>, s: ArmoryStr): string {
	const row = entry.row;
	if (row.state === "unavailable") return "";
	if (entry.equipped) return s(COSMETIC_KEYS.equipped);
	if (entry.owned) return s(ARMORY_KEYS.owned);
	if (row.state === "poor") return s(ARMORY_KEYS.toGo, { silver: row.toGo });
	return tostring(row.price ?? 0);
}

// --- the live preview ----------------------------------------------------------------------------

/** The character the preview draws for an item of `slot`: a dye's own character; any other slot: `picked`. */
export function cosmeticPreviewCharacter(itemId: string | undefined, picked: CharacterId): CharacterId {
	return dyeCharacterOf(itemId) ?? picked;
}

/**
 * The look the preview wears for `character`: the equipped look (cosmeticLookOf the wallet's equipped slots) with
 * `tryOn` (the focused item, owned or not) in its slot when it fits that character (another character's dye: the
 * equipped look unchanged).
 */
export function cosmeticPreviewLook(
	status: Readonly<WalletStatus> | undefined,
	character: CharacterId,
	tryOn: string | undefined,
): CosmeticLook {
	const equipped = status !== undefined && status.loaded ? equippedMapOf(status.equipped) : new Map<string, string>();
	const it = cosmeticItem(tryOn);
	if (it !== undefined) equipped.set(it.slot, it.id);
	return cosmeticLookOf(equipped, character);
}

/** The colour slot a preview's swatch chip shows for the focused item: its own slot, or undefined (a dye). */
export function cosmeticSwatchSlot(itemId: string | undefined): "outline" | "trail" | "spark" | undefined {
	const it = cosmeticItem(itemId);
	if (it === undefined) return undefined;
	if (it.slot === LOOK_SLOTS.outline) return "outline";
	if (it.slot === LOOK_SLOTS.trail) return "trail";
	if (it.slot === LOOK_SLOTS.spark) return "spark";
	return undefined;
}

/**
 * The facing row the turning preview shows `tSec` seconds after it opened: the camera-facing row first, then each
 * facing in turn (one per COSMETIC_VIEW.preview.facingSec, a full turn over the set's facings); reduced motion (or a
 * one-facing set) holds the camera-facing row.
 */
export function previewTurnFacing(tSec: number, facings: SpriteFacings, reducedMotion: boolean): number {
	const count = facings.count;
	if (reducedMotion || count <= 1 || !(tSec > 0)) return facingIndex(CHARACTER_PREVIEW_ANGLE_DEG, facings);
	const step = math.floor(tSec / COSMETIC_VIEW.preview.facingSec) % count;
	const full = 360;
	return facingIndex(CHARACTER_PREVIEW_ANGLE_DEG + (step * full) / count, facings);
}

/** The bought row's stamp scale `t` seconds after the purchase landed (1 once COSMETIC_VIEW.preview.flashSec passed). */
export function cosmeticFlashScale(t: number, reducedMotion: boolean): number {
	const p = COSMETIC_VIEW.preview;
	if (reducedMotion || !(t >= 0) || t >= p.flashSec) return 1;
	const k = 1 - t / p.flashSec;
	return 1 + (p.flashScale - 1) * k * k;
}

/** The bought row's flash transparency (0 at the purchase, 1 once flashSec passed). */
export function cosmeticFlashTransparency(t: number): number {
	const p = COSMETIC_VIEW.preview;
	if (!(t >= 0) || t >= p.flashSec) return 1;
	return t / p.flashSec;
}

/** Wallet loaded (the tab's buy / equip work). */
export function cosmeticsAvailable(status: Readonly<WalletStatus> | undefined): boolean {
	return walletShown(status) === "loaded";
}
