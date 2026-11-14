/**
 * The Armory's price ladder and catalogue (docs/SILVER.md "The price ladder", "Catalogue v1", SVD22 / SVD23). Pure data
 * plus lookups.
 *
 * One exponential ladder of eight tiers (ARMORY_TIERS: each about twice the last); an item names a TIER per level,
 * never a raw price, and the price is always read here on the server (the client never sends one). Within an item
 * every level sits at least one tier above the last. Nothing with a sim lever sits above POWER_TIER_CAP (SVD23: tiers
 * 6-8 hold only unlocks and cosmetics).
 *
 * ARMORY_CATALOG is APPEND-ONLY (catalog.spec pins its order): wallets store item ids, and telemetry SKUs are the ids.
 */
import { DEFAULT_CHARACTER, type CharacterId } from "shared/characters";

/** The eight tiers' prices, tier 1 first (index tier - 1). */
export const ARMORY_TIERS: ReadonlyArray<number> = table.freeze([40, 80, 150, 300, 600, 1200, 2500, 5000]);

/** The highest tier an item with a sim lever may sit on (SVD23). */
export const POWER_TIER_CAP = 5;

/** The tier from which a purchase asks to confirm (docs/SILVER.md "The Armory": tiers 6-8). */
export const CONFIRM_FROM_TIER = 6;

export type ArmoryItemKind = "upgrade" | "unlock" | "cosmetic";

export interface ArmoryItem {
	/** Stored in the wallet's `own`; the economy events' SKU. */
	readonly id: string;
	readonly kind: ArmoryItemKind;
	/** Each level's tier (1-based, 1..ARMORY_TIERS.size()): level k costs ARMORY_TIERS[tiers[k - 1] - 1]. */
	readonly tiers: ReadonlyArray<number>;
	/** The item changes the sim (a PlayerTraits lever): never above POWER_TIER_CAP. */
	readonly simLever: boolean;
	/** An unlock's character. */
	readonly character?: CharacterId;
	/** A cosmetic's slot (`walletEquip`): one item per slot. */
	readonly slot?: string;
	/** Another item at a level that must be owned first. */
	readonly requires?: { readonly itemId: string; readonly level: number };
}

/** The item id of a character unlock (the Knight needs none). */
export function characterUnlockId(id: CharacterId): string {
	return `character.${id}`;
}

/** The upgrade tracks with a sim lever (shared/characters UpgradeLevels). */
export const UPGRADE_ITEM = table.freeze({
	vigor: "vigor",
	deepFlask: "deepFlask",
	plating: "plating",
	prospector: "prospector",
});

function item(i: ArmoryItem): ArmoryItem {
	return table.freeze(i);
}

/** Catalogue v1 (docs/SILVER.md): power and the Archer, tiers 1-5. Append only. */
export const ARMORY_CATALOG: ReadonlyArray<ArmoryItem> = table.freeze([
	item({ id: UPGRADE_ITEM.vigor, kind: "upgrade", tiers: [1, 3], simLever: true }),
	item({ id: UPGRADE_ITEM.deepFlask, kind: "upgrade", tiers: [3, 5], simLever: true }),
	item({ id: UPGRADE_ITEM.plating, kind: "upgrade", tiers: [5], simLever: true }),
	item({ id: UPGRADE_ITEM.prospector, kind: "upgrade", tiers: [2, 3, 4, 5], simLever: false }),
	item({ id: characterUnlockId("archer"), kind: "unlock", tiers: [4], simLever: false, character: "archer" }),
]);

/** The catalogue item `id`, or undefined. */
export function armoryItem(id: string, catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG): ArmoryItem | undefined {
	for (const i of catalog) if (i.id === id) return i;
	return undefined;
}

/** A tier's price (undefined outside 1..ARMORY_TIERS.size()). */
export function tierPrice(tier: number): number | undefined {
	if (tier < 1 || tier > ARMORY_TIERS.size() || math.floor(tier) !== tier) return undefined;
	return ARMORY_TIERS[tier - 1];
}

/** The tier of `item`'s level `level` (1-based), or undefined when the item has no such level. */
export function itemTier(it: Readonly<ArmoryItem>, level: number): number | undefined {
	if (level < 1 || level > it.tiers.size() || math.floor(level) !== level) return undefined;
	return it.tiers[level - 1];
}

/** The price of buying level `level` (1-based) of item `id`, or undefined (unknown item, no such level). */
export function itemPrice(
	id: string,
	level: number,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): number | undefined {
	const it = armoryItem(id, catalog);
	if (it === undefined) return undefined;
	const tier = itemTier(it, level);
	return tier !== undefined ? tierPrice(tier) : undefined;
}

/** The unlock item of character `id` (undefined for the Knight, who is always owned, and unknown ids). */
export function characterUnlock(
	id: CharacterId,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): ArmoryItem | undefined {
	if (id === DEFAULT_CHARACTER) return undefined;
	for (const i of catalog) if (i.kind === "unlock" && i.character === id) return i;
	return undefined;
}
