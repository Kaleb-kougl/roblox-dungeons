/**
 * A player's look (docs/COSMETICS.md "Looks"): the cosmetic item ids they wear in a run or a lobby, read from their
 * wallet's equipped slots for the character they play. Plain data, remote-friendly (a dye is ONE id: the played
 * character's), never hashed, recorded, validated or part of a world setup: presentation only.
 *
 *   server    RunSession.looks (member order), StartRunReply.look (the owner's), PartyRunStart.looks, LobbyView.looks
 *   client    the solo run's own look from WalletStatus.equipped (cosmeticLookOf(equippedMapOf(...), character))
 *
 * An unknown wallet, an item that is not a cosmetic, an item in the wrong slot or another character's dye: no entry
 * (the default look). Pure, no runtime import.
 */
import type { CharacterId } from "shared/characters";
import { LOOK_SLOTS, cosmeticItem, dyeSlotOf, type CosmeticSlot } from "./items";

/** The item ids a player wears (absent field: that slot's default). */
export interface CosmeticLook {
	/** The dye of the character being played (a `dye.<character>` item). */
	dye?: string;
	/** The rim colour (an `outline` item). */
	outline?: string;
	/** The roll afterimages' colour (a `trail` item). */
	trail?: string;
	/** Their graze / parry sparks' colour (a `spark` item). */
	spark?: string;
}

/** The default look: nothing worn. */
export const NO_LOOK: CosmeticLook = table.freeze({});

/** One equipped entry as the wallet's `wallet` payload carries it (shared/wallet WalletEquippedEntry). */
export interface CosmeticEquippedEntry {
	readonly slot: string;
	readonly itemId: string;
}

/** The equipped list of a WalletStatus (slot -> item id; undefined: none), as a map. */
export function equippedMapOf(list: ReadonlyArray<CosmeticEquippedEntry> | undefined): Map<string, string> {
	const out = new Map<string, string>();
	if (list === undefined) return out;
	for (const e of list) if (typeIs(e.slot, "string") && typeIs(e.itemId, "string")) out.set(e.slot, e.itemId);
	return out;
}

/** `itemId` is a cosmetic of exactly `slot`. */
function fits(itemId: string | undefined, slot: CosmeticSlot): itemId is string {
	return itemId !== undefined && cosmeticItem(itemId)?.slot === slot;
}

/**
 * The look of a player with `equipped` (slot -> item id; undefined: an unknown wallet) playing `character`: the
 * character's dye slot and the three shared slots, each kept only when it holds a cosmetic of that slot.
 */
export function cosmeticLookOf(
	equipped: ReadonlyMap<string, string> | undefined,
	character: CharacterId,
): CosmeticLook {
	if (equipped === undefined) return {};
	const look: CosmeticLook = {};
	const dye = equipped.get(dyeSlotOf(character));
	if (fits(dye, dyeSlotOf(character))) look.dye = dye;
	const outline = equipped.get(LOOK_SLOTS.outline);
	if (fits(outline, LOOK_SLOTS.outline)) look.outline = outline;
	const trail = equipped.get(LOOK_SLOTS.trail);
	if (fits(trail, LOOK_SLOTS.trail)) look.trail = trail;
	const spark = equipped.get(LOOK_SLOTS.spark);
	if (fits(spark, LOOK_SLOTS.spark)) look.spark = spark;
	return look;
}

/** A dye slot (`dye.<character>`). */
function isDyeSlot(slot: CosmeticSlot): boolean {
	return slot !== LOOK_SLOTS.outline && slot !== LOOK_SLOTS.trail && slot !== LOOK_SLOTS.spark;
}

/**
 * `x` as a CosmeticLook (an untrusted value: a reply on the wire): every known field kept when it names a cosmetic of
 * its slot (`dye`: any character's dye slot), anything else dropped. Not a table: the default look. Never throws.
 */
export function readCosmeticLook(x: unknown): CosmeticLook {
	if (!typeIs(x, "table")) return {};
	const t = x as { readonly [k: string]: unknown };
	const look: CosmeticLook = {};
	const dye = cosmeticItem(t.dye);
	if (dye !== undefined && isDyeSlot(dye.slot)) look.dye = dye.id;
	if (fits(cosmeticItem(t.outline)?.id, LOOK_SLOTS.outline)) look.outline = t.outline as string;
	if (fits(cosmeticItem(t.trail)?.id, LOOK_SLOTS.trail)) look.trail = t.trail as string;
	if (fits(cosmeticItem(t.spark)?.id, LOOK_SLOTS.spark)) look.spark = t.spark as string;
	return look;
}

/** Same item in every slot. */
export function sameCosmeticLook(a: Readonly<CosmeticLook>, b: Readonly<CosmeticLook>): boolean {
	return a.dye === b.dye && a.outline === b.outline && a.trail === b.trail && a.spark === b.spark;
}

/** Nothing worn. */
export function isDefaultLook(look: Readonly<CosmeticLook>): boolean {
	return look.dye === undefined && look.outline === undefined && look.trail === undefined && look.spark === undefined;
}
