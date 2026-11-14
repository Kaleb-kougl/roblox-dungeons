/**
 * The wallet on the wire (docs/SILVER.md "Remotes", SV3): the `wallet` payload WalletService sends. Pure.
 *
 * `own` and `equipped` are lists (a Map is no remote-friendly shape for Flamework's guard), sorted by id / slot.
 * `loaded` false (a failed join load, or the Studio fake `unknown`) carries nothing else. `result` answers a
 * `walletBuy` / `walletEquip`; `grant` is a run's settled breakdown (the push after the grant's transaction).
 */
import type { ArmoryItem } from "./catalog";
import { ARMORY_CATALOG } from "./catalog";
import { ownedLevel, walletBalance, type WalletDoc } from "./doc";
import { nextGoals, type SilverGrantBreakdown, type WalletGoal, type WalletRefusal } from "./transforms";

export interface WalletOwnedEntry {
	itemId: string;
	level: number;
}

export interface WalletEquippedEntry {
	slot: string;
	itemId: string;
}

/** The answer to one `walletBuy` / `walletEquip`. */
export interface WalletActionResult {
	action: "buy" | "equip";
	itemId: string;
	ok: boolean;
	/** Why it was refused: a WalletRefusal, `notLoaded`, `busy` or `failed` (the DataStore call failed). */
	reason?: WalletRefusal | "notLoaded" | "busy" | "failed";
	/** A purchase: the level bought and its price. */
	level?: number;
	price?: number;
}

/** The `wallet` payload (server -> client). */
export interface WalletStatus {
	/** False when the join load failed (or the Studio fake says `unknown`): the Armory is greyed, the Knight only. */
	loaded: boolean;
	balance?: number;
	earned?: number;
	/** Items owned (absent when none), sorted by id. */
	own?: WalletOwnedEntry[];
	/** Equipped cosmetics (absent when none), sorted by slot. */
	equipped?: WalletEquippedEntry[];
	/** Today's first-run bonus has not been paid yet (by the stored doc as this server last read it). */
	firstRunBonusOpen?: boolean;
	/** Today's Daily bonus has not been paid yet. */
	dailyBonusOpen?: boolean;
	/** The next levels to buy, cheapest first (nextGoals). */
	goals?: WalletGoal[];
	result?: WalletActionResult;
	grant?: SilverGrantBreakdown;
}

/** The status of `doc` on UTC day `day` (`loaded` false, or no doc: `{ loaded: false }` alone). */
export function walletStatusOf(
	doc: Readonly<WalletDoc> | undefined,
	loaded: boolean,
	day: number,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): WalletStatus {
	if (!loaded || doc === undefined) return { loaded: false };
	const status: WalletStatus = {
		loaded: true,
		balance: walletBalance(doc),
		earned: doc.earned,
		firstRunBonusOpen: doc.runDay === undefined || doc.runDay < day,
		dailyBonusOpen: doc.dailyDay === undefined || doc.dailyDay < day,
		goals: nextGoals(doc, undefined, catalog),
	};
	const own: WalletOwnedEntry[] = [];
	for (const [itemId] of doc.own) own.push({ itemId, level: ownedLevel(doc, itemId, catalog) });
	own.sort((a, b) => a.itemId < b.itemId);
	if (own.size() > 0) status.own = own;
	if (doc.eq !== undefined) {
		const equipped: WalletEquippedEntry[] = [];
		for (const [slot, itemId] of doc.eq) equipped.push({ slot, itemId });
		equipped.sort((a, b) => a.slot < b.slot);
		if (equipped.size() > 0) status.equipped = equipped;
	}
	return status;
}
