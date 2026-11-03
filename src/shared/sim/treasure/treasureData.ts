/**
 * Treasure tunables in the sim (docs/TREASURE.md Design §2, decisions TRD7 / TRD8 / TRD10 / TRD11; a Roblox-port
 * feature, no web source). Data only, a LEAF (types and shared/dungeon only): treasure.ts, stepTreasure.ts and
 * breakables.ts read it, nothing is inline in the logic. Where the vault is, its lock and its starting tier are floor
 * data (shared/dungeon vaultData.ts VAULT, vault.ts placeVault): the sim reads the dungeon's VaultLock / VaultTier
 * tables, and treasure.spec.ts pins the numbers both sides share (VAULT_TIER_COUNT, VAULT_LOCK_COUNT, the per-tier
 * tables' lengths).
 */
import { VaultLock, VaultTier } from "shared/dungeon";
import { TILE_SIZE } from "../units";

/** SimConfig.treasure: presence turns treasure rooms on (ENDLESS_TREASURE_CONFIG is the game's, TR5). */
export interface TreasureConfig {
	/** SWIFT: the countdown starts at the room's par x this percent (round half up; 100 = par exactly, FAST's rule). */
	readonly swiftParPercent: number;
	/** A living player's centre within this of the chest's centre opens an unlocked chest (world units; TR4). */
	readonly reachTiles: number;
	/** UNTOUCHED: extra hits allowed, by Respite level (TRD10; dormant until Respite exists, respite.ts). */
	readonly respiteAllowance: ReadonlyArray<number>;
	/** SWIFT: extra par percent, by Respite level (TRD10; dormant). */
	readonly respiteSwiftPercent: ReadonlyArray<number>;
	/** TREASURE base points by tier (VaultTier order), once per open, combo-neutral (TRD11; TR4). */
	readonly points: ReadonlyArray<number>;
	/** Boosts per living present player by tier (VaultTier order; Rare's 0 means a relic instead; TR4). */
	readonly boosts: ReadonlyArray<number>;
}

/** A forward / side offset from the chest's centre, in tiles along its facing (forward) and across it (side). */
export interface TreasureOffset {
	readonly forward: number;
	readonly side: number;
}

export interface TreasureTunables {
	/**
	 * The treasure stream (the draws made when a chest opens, TR4): seedToState(seed) XOR salt ("KVTR"), like the drops'
	 * "KVDR" 0x4b564452; never state.rngState. TR0 checked it is unused (hex and decimal) in src/, scripts/, fixtures/.
	 */
	readonly salt: number;
	/**
	 * Where a chest's boosts land (TR4, correction 9): the lowest free ground slots take these in order. In front of
	 * the chest only (its back is a wall): every forward > half a tile (past the chest cell's front edge), every side
	 * within half a tile (VAULT.wallClearTiles guarantees the two cells straight in front are FLOOR of the room).
	 */
	readonly boostOffsets: ReadonlyArray<TreasureOffset>;
}

export const TREASURE: TreasureTunables = table.freeze({
	salt: 0x4b565452,
	boostOffsets: table.freeze([
		table.freeze({ forward: 0.9 * TILE_SIZE, side: -0.3 * TILE_SIZE }),
		table.freeze({ forward: 0.9 * TILE_SIZE, side: 0.3 * TILE_SIZE }),
		table.freeze({ forward: 1.7 * TILE_SIZE, side: -0.3 * TILE_SIZE }),
		table.freeze({ forward: 1.7 * TILE_SIZE, side: 0.3 * TILE_SIZE }),
	]),
});

/** TreasureState.status. Append only: hashed. */
export const VaultStatus = {
	/** No vault on this floor. */
	NONE: 0,
	/** The floor's vault, its room not engaged yet. */
	SEALED: 1,
	/** Its room engaged: the lock is live (UNTOUCHED counts hits, SWIFT counts down). */
	ARMED: 2,
	/** The lock cracked (one tier down, once); the room still needs clearing. */
	CRACKED: 3,
	/** Its room cleared: the chest can be opened (TR4). */
	UNLOCKED: 4,
	/** Opened (TR4). */
	OPENED: 5,
} as const;

/** Every unset TreasureState scalar (room, record, slot, tiers, ticks, counts that do not apply). */
export const TREASURE_UNSET = -1;

/** The chest piece's hp (breakables piecesFrom, by kind): never read for damage, the chest is unbreakable. */
export const CHEST_HP = 1;

/** VaultTier entries (COMMON, RARE, LEGENDARY): the per-tier tables' length. */
export const VAULT_TIER_COUNT = VaultTier.LEGENDARY + 1;
/** VaultLock entries (UNTOUCHED, SWIFT): the dungeon's VAULT.lockWeights length. */
export const VAULT_LOCK_COUNT = VaultLock.SWIFT + 1;
/** The lowest tier a crack can reach (a crack never drops below it, TRD1). */
export const VAULT_LOWEST_TIER = VaultTier.COMMON;
/** The tiers a crack steps down by. */
export const VAULT_CRACK_TIERS = 1;

/** SWIFT's par percent (TR11 tunes it): 100 = par exactly, so a kept SWIFT lock is exactly a FAST clear. */
export const TREASURE_SWIFT_PAR_PERCENT = 100;
/** Open reach (TR4). */
export const TREASURE_REACH_TILES = 1.5 * TILE_SIZE;
/** The Respite level without Respite (docs/DIFFICULTY.md, not built): respite.ts returns it, the tables' first entry. */
export const TREASURE_RESPITE_NONE = 0;
/** TRD10: Respite levels 0 / I / II / III. */
export const TREASURE_RESPITE_ALLOWANCE: ReadonlyArray<number> = [0, 0, 1, 1];
export const TREASURE_RESPITE_SWIFT_PERCENT: ReadonlyArray<number> = [0, 10, 20, 30];
/** TRD11: Common / Rare / Legendary. */
export const TREASURE_POINTS: ReadonlyArray<number> = [300, 800, 1500];
/** Common 2 boosts, Rare a relic (0 boosts), Legendary 1 boost (plus the bonus deal). */
export const TREASURE_BOOSTS: ReadonlyArray<number> = [2, 0, 1];

/** The game's treasure rules (endless worlds from TR5). */
export const ENDLESS_TREASURE_CONFIG: TreasureConfig = table.freeze({
	swiftParPercent: TREASURE_SWIFT_PAR_PERCENT,
	reachTiles: TREASURE_REACH_TILES,
	respiteAllowance: TREASURE_RESPITE_ALLOWANCE,
	respiteSwiftPercent: TREASURE_RESPITE_SWIFT_PERCENT,
	points: TREASURE_POINTS,
	boosts: TREASURE_BOOSTS,
});
