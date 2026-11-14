/**
 * The wallet as the client reads it (docs/SILVER.md SV8 / SV9 / SV18): pure reads of the server's `wallet` payload
 * (shared/wallet WalletStatus), so the HUD, the menus and SimController agree on one answer. Never a client decision
 * that counts: the server checks every purchase and every run start against its own doc.
 *
 *   walletShown       the payload's state: pending (no answer yet), loaded, unavailable (`loaded: false`)
 *   statusLevel       the level of a catalogue item owned (0 when not, or the wallet is not loaded)
 *   statusOwns        the player may pick character `id`: the Knight always; any other only by its unlock, and only
 *                     with a loaded wallet (an unknown wallet: the Knight only, docs/SILVER.md "The Archer unlock")
 *   statusUpgrades    the sim-lever upgrade levels (shared/characters UpgradeLevels; no wallet: NO_UPGRADES)
 *   statusBalance     the Silver balance (0 when not loaded)
 *   ownedCharacterOr  a pick the player owns, else the default character (the stored DisplaySettings.character);
 *                     before the first payload (pending) the pick stands (the server decides: a `locked_character`
 *                     reply falls back to the Knight), unless `strict` (a run the server never sees: the Knight)
 */
import {
	DEFAULT_CHARACTER,
	NO_UPGRADES,
	clampUpgradeLevels,
	type CharacterId,
	type UpgradeLevels,
} from "shared/characters";
import { UPGRADE_ITEM, characterUnlock, type WalletStatus } from "shared/wallet";

/** What the client knows of its wallet. */
export type WalletShown = "pending" | "loaded" | "unavailable";

/** The state of `status` (undefined: no payload yet). */
export function walletShown(status: Readonly<WalletStatus> | undefined): WalletShown {
	if (status === undefined) return "pending";
	return status.loaded ? "loaded" : "unavailable";
}

/** The level of item `itemId` in `status` (0: not owned, or not loaded). */
export function statusLevel(status: Readonly<WalletStatus> | undefined, itemId: string): number {
	if (status === undefined || !status.loaded || status.own === undefined) return 0;
	for (const o of status.own) if (o.itemId === itemId) return o.level;
	return 0;
}

/** The player may pick character `id` (the Knight always; others by their unlock in a loaded wallet). */
export function statusOwns(status: Readonly<WalletStatus> | undefined, id: CharacterId): boolean {
	if (id === DEFAULT_CHARACTER) return true;
	const unlock = characterUnlock(id);
	return unlock !== undefined && statusLevel(status, unlock.id) >= 1;
}

/** The sim-lever upgrade levels in `status` (clamped; not loaded: NO_UPGRADES). */
export function statusUpgrades(status: Readonly<WalletStatus> | undefined): UpgradeLevels {
	if (status === undefined || !status.loaded) return NO_UPGRADES;
	return clampUpgradeLevels({
		vigor: statusLevel(status, UPGRADE_ITEM.vigor),
		deepFlask: statusLevel(status, UPGRADE_ITEM.deepFlask),
		plating: statusLevel(status, UPGRADE_ITEM.plating),
	});
}

/** The Silver balance in `status` (0 when not loaded). */
export function statusBalance(status: Readonly<WalletStatus> | undefined): number {
	if (status === undefined || !status.loaded) return 0;
	return math.max(0, status.balance ?? 0);
}

/**
 * `pick` when the player owns it, else the default character (the Knight). Before the first payload (`status`
 * undefined) the pick stands unless `strict`: the server checks a ranked start or a Ready itself, so an owner is not
 * turned into the Knight in the seconds before the join push; a run the server never sees passes `strict`.
 */
export function ownedCharacterOr(
	status: Readonly<WalletStatus> | undefined,
	pick: CharacterId,
	strict = false,
): CharacterId {
	if (status === undefined && !strict) return pick;
	return statusOwns(status, pick) ? pick : DEFAULT_CHARACTER;
}
