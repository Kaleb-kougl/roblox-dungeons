/**
 * Robux-only cosmetics (docs/COSMETICS.md CSD13, owner 2026-11-19): every animated cosmetic (catalog.ts `robux`, the
 * Prismatic dyes) is sold for Robux only, one Roblox GAME PASS per item: a one-time purchase Roblox itself never sells
 * twice, so a player can never pay again for something they own. Ownership still lives in the wallet's `own` (equip,
 * looks, lobbies and runs read it as before): the server grants it (transforms.ts applyPassGrant) when Roblox says the
 * player owns the pass, at every join and after a purchase. Pure.
 *
 *   COSMETIC_PASSES           per universe (game.GameId): item id -> game pass id. A Robux-only item with no pass in
 *                             this universe is off sale here (a Silver-bought one stays owned). Filled by the owner
 *                             after creating the passes in Creator Hub (the Robux price is Roblox's, never code's)
 *   cosmeticPassesFor / cosmeticPassIdOf / cosmeticPassItemOf   lookups
 *   parseFakePasses           the Studio fake KV_FakePasses (`off`, or one price for every Robux-only item)
 *   cosmeticPassStatusFields  what the `wallet` push says (WalletStatus.robuxItems): each Robux-only item on sale here,
 *                             with its pass id, or Studio's fake price
 *
 * @module
 */
import { ARMORY_CATALOG, isRobuxItem, type ArmoryItem } from "./catalog";
import { COSMETIC_PASS_FAKE_KEYWORDS } from "./config";
import { ROBLOX_DUNGEONS_GAME_ID } from "./shop";

/** Per universe (game.GameId): Robux-only item id -> game pass id. */
export type CosmeticPassTable = ReadonlyMap<number, ReadonlyMap<string, number>>;

/**
 * The game passes of each universe (Creator Hub > Monetization > Passes; the Robux price is Roblox's, never here). An
 * item with no pass in a universe is off sale there. Roblox Dungeons: Prismatic Plate and Prismatic Leathers (created
 * 2026-11-19).
 */
export const COSMETIC_PASSES: CosmeticPassTable = new Map<number, ReadonlyMap<string, number>>([
	[
		ROBLOX_DUNGEONS_GAME_ID,
		new Map<string, number>([
			["dye.knight.prismatic", 2092456672],
			["dye.archer.prismatic", 2093746633],
		]),
	],
]);

/** This universe's item -> pass id map (undefined: no passes here). */
export function cosmeticPassesFor(
	gameId: number,
	passes: CosmeticPassTable = COSMETIC_PASSES,
): ReadonlyMap<string, number> | undefined {
	const m = passes.get(gameId);
	return m !== undefined && m.size() > 0 ? m : undefined;
}

/** The game pass selling item `itemId` here, or undefined. */
export function cosmeticPassIdOf(
	gameId: number,
	itemId: string,
	passes: CosmeticPassTable = COSMETIC_PASSES,
): number | undefined {
	return cosmeticPassesFor(gameId, passes)?.get(itemId);
}

/** The item game pass `passId` sells here, or undefined (not one of ours). */
export function cosmeticPassItemOf(
	gameId: number,
	passId: number,
	passes: CosmeticPassTable = COSMETIC_PASSES,
): string | undefined {
	const m = cosmeticPassesFor(gameId, passes);
	if (m === undefined) return undefined;
	for (const [itemId, id] of m) if (id === passId) return itemId;
	return undefined;
}

/** The Robux-only items of `catalog`, in its order. */
export function robuxItemIds(catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG): string[] {
	const out: string[] = [];
	for (const it of catalog) if (isRobuxItem(it)) out.push(it.id);
	return out;
}

/** The Studio fake (COSMETIC_PASS_FAKE_ATTRIBUTE). */
export type FakePasses = { readonly on: false } | { readonly on: true; readonly robux: number };

/** `off`, or one whole Robux price (`299`); anything else: no fake. */
export function parseFakePasses(value: unknown): FakePasses | undefined {
	if (!typeIs(value, "string")) return undefined;
	const [inner] = string.match(value, "^%s*(.-)%s*$");
	const s = typeIs(inner, "string") ? inner : value;
	if (s.lower() === COSMETIC_PASS_FAKE_KEYWORDS.off) return { on: false };
	const [digits] = string.match(s, "^(%d+)$");
	const n = digits !== undefined ? tonumber(digits) : undefined;
	if (n === undefined || n <= 0) return undefined;
	return { on: true, robux: n };
}

/** One Robux-only item on sale here (WalletStatus.robuxItems). Plain data: it rides the `wallet` push. */
export interface WalletRobuxItem {
	itemId: string;
	/** Its game pass (live); the client reads Roblox's price for it and prompts it. */
	passId?: number;
	/** Studio's fake price (KV_FakePasses): shown instead of Roblox's, a press fake-buys. */
	fakeRobux?: number;
}

/**
 * The Robux-only items on sale here, in catalogue order. `fake` is the Studio fake in force (undefined: none, or a live
 * server): `off` sells none; a price sells every one at it; without a fake, the items with a pass in this universe.
 */
export function cosmeticPassStatusFields(
	gameId: number,
	fake: FakePasses | undefined,
	passes: CosmeticPassTable = COSMETIC_PASSES,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): WalletRobuxItem[] {
	const out: WalletRobuxItem[] = [];
	if (fake !== undefined && !fake.on) return out;
	for (const itemId of robuxItemIds(catalog)) {
		if (fake !== undefined && fake.on) {
			out.push({ itemId, fakeRobux: fake.robux });
			continue;
		}
		const passId = cosmeticPassIdOf(gameId, itemId, passes);
		if (passId !== undefined) out.push({ itemId, passId });
	}
	return out;
}
