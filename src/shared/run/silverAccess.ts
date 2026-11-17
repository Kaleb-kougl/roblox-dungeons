/**
 * The server's view of a player's Silver wallet at a run start (docs/SILVER.md SV6 / SV17): their Armory upgrade levels
 * and which characters they own. A seam: the server's run sessions and lobbies read it through `SilverAccess`, the
 * wallet service (shared/wallet, WalletService) provides it, and until it is wired the default `OPEN_SILVER_ACCESS`
 * gives everyone no upgrades and every character, so the build behaves as before Silver.
 *
 * The readers never trust the provider: `accessUpgrades` checks its answer (readUpgradeLevels; an error or junk reads as
 * an unknown wallet) and `accessOwnsCharacter` always grants the starter characters (the Knight) and denies the rest when
 * the provider errors. Pure and Roblox-API-free (pcall only).
 */
import {
	NO_UPGRADES,
	isStarterCharacter,
	readUpgradeLevels,
	type CharacterId,
	type UpgradeLevels,
} from "shared/characters";

/** A wallet's answers for run starts and lobby Readies (arrow properties: called with `.`, never `:`). */
export interface SilverAccess {
	/**
	 * The player's effective upgrade levels (what their next run is built with), or undefined when their wallet is
	 * unknown this session (not loaded): they play with no upgrades and the start says so.
	 */
	readonly upgradesFor: (userId: number) => UpgradeLevels | undefined;
	/**
	 * Whether the player owns `characterId` (the Knight always; others by purchase). An unknown wallet: the Knight
	 * only.
	 */
	readonly ownsCharacter: (userId: number, characterId: CharacterId) => boolean;
	/**
	 * docs/COSMETICS.md CS4: the cosmetics the player wears (their wallet's equipped slots, slot -> item id, owned items
	 * only), or undefined when their wallet is unknown (the default look). Optional: absent, nobody wears anything.
	 */
	readonly equippedFor?: (userId: number) => ReadonlyMap<string, string> | undefined;
}

/** Before a wallet is wired: no upgrades for anyone, every character owned (the build as it was before Silver). */
export const OPEN_SILVER_ACCESS: SilverAccess = table.freeze({
	upgradesFor: () => NO_UPGRADES,
	ownsCharacter: () => true,
});

/**
 * The server's default before the wallet is wired (SilverAccessService): no upgrades, starters only (accessOwnsCharacter
 * always grants the starters), so a wiring mistake locks the Archer rather than giving her away.
 */
export const LOCKED_SILVER_ACCESS: SilverAccess = table.freeze({
	upgradesFor: () => undefined,
	ownsCharacter: () => false,
});

/** `access.upgradesFor(userId)`, checked: undefined when it errors or answers anything but valid UpgradeLevels. */
export function accessUpgrades(access: SilverAccess, userId: number): UpgradeLevels | undefined {
	const [ok, answer] = pcall(() => access.upgradesFor(userId));
	return ok ? readUpgradeLevels(answer) : undefined;
}

/**
 * Whether `userId` may play `characterId`: a starter character always (shared/characters isStarterCharacter), else
 * `access.ownsCharacter`'s answer when it is exactly `true` (an error or any other answer: not owned).
 */
export function accessOwnsCharacter(access: SilverAccess, userId: number, characterId: CharacterId): boolean {
	if (isStarterCharacter(characterId)) return true;
	const [ok, answer] = pcall(() => access.ownsCharacter(userId, characterId));
	return ok && answer === true;
}

/**
 * docs/COSMETICS.md CS4: `access.equippedFor(userId)`, checked: a fresh slot -> item id map of its string entries, or
 * undefined when the provider has none, errors or answers anything but a table (the default look). Presentation only:
 * what a look may hold is decided again by shared/cosmetics cosmeticLookOf.
 */
export function accessEquipped(access: SilverAccess, userId: number): Map<string, string> | undefined {
	const lookup = access.equippedFor;
	if (lookup === undefined) return undefined;
	const [ok, answer] = pcall(() => lookup(userId));
	if (!ok || !typeIs(answer, "table")) return undefined;
	const out = new Map<string, string>();
	for (const [k, v] of pairs(answer as unknown as ReadonlyMap<unknown, unknown>)) {
		if (typeIs(k, "string") && typeIs(v, "string")) out.set(k, v);
	}
	return out;
}
