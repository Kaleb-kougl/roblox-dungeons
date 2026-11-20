/**
 * Vault tunables (docs/TREASURE.md Design §1, decisions TRD2 / TRD4 / TRD5 / TRD6; a Roblox-port feature, no web
 * source): which endless floors hold a vault (a combat or elite room with a caged chest), where its chest stands, its
 * starting tier and its lock. Data only: ./vault.ts reads it, nothing is inline in the logic. A LEAF but for types.
 * The sim-side rules (the lock, the rewards, the score) live in shared/sim treasure/; the dungeon cannot import the
 * sim, so the tier and lock tables live here and the sim reads them (a sim spec pins the shared numbers, like
 * BREAKABLE_LOOT.kindWeights).
 *
 * Distances are in tiles (TILE_SIZE = 1 world unit), measured between tile centres unless a rule says otherwise.
 *
 * @module
 */
import type { EncounterRoomType } from "./encounterTypes";
import type { BreakablePieceKindName } from "./breakablesData";

/** A depth band of vault floors: from `fromFloor` on, `percent` of the floors hold a vault (TRD6). */
export interface VaultChanceBand {
	/** The band's first floor. */
	readonly fromFloor: number;
	/** The chance a floor of the band holds a vault, percent. */
	readonly percent: number;
}

/** The Legendary share of starting tiers (else Rare, TRD6): base on VAULT.fromFloor, + perFloor a floor, at most max. */
export interface VaultLegendaryTunables {
	/** The Legendary share on VAULT.fromFloor, percent. */
	readonly base: number;
	/** Percent added per floor below it. */
	readonly perFloor: number;
	/** The share's ceiling, percent. */
	readonly max: number;
}

/**
 * The vault roll's tunables: its rng salt, the chance per depth band, which rooms qualify and the chest's tier and lock
 * weights.
 */
export interface VaultTunables {
	/**
	 * The vault's own rng stream: new EncounterRng(floor seed ^ salt), like the breakables (0x5bd1e995), the boss pick
	 * (0x27d4eb2f), the affixes (0xcc9e2d51), the loot (0xe6546b64) and the pellets (0x27220a95); TR0 checked it is
	 * unused (hex and decimal) in src/, scripts/ and fixtures/. Nothing else on the floor reads it.
	 */
	readonly salt: number;
	/** The first floor that can hold a vault. Below it: no vault and no draw. */
	readonly fromFloor: number;
	/** Percent of floors with a vault, by band (first floor ascending; the first band starts at fromFloor). */
	readonly chanceByBand: ReadonlyArray<VaultChanceBand>;
	/** Weight of each room type in the room pick (elite x2: harder fights hold the vaults). Other types: never. */
	readonly roomWeight: Readonly<Partial<Record<EncounterRoomType, number>>>;
	/** A vault room has at least this many floor tiles (EncounterRoom.floorTiles). */
	readonly minRoomTiles: number;
	/** How often a chest starts Legendary. */
	readonly legendaryPercent: VaultLegendaryTunables;
	/** Weight of each lock in the lock draw, VaultLock order (UNTOUCHED, SWIFT; append only). */
	readonly lockWeights: ReadonlyArray<number>;
	/** In front of the chest (along its facing), this many cells are FLOOR of its room and free of pieces. */
	readonly wallClearTiles: number;
	/**
	 * Beside the chest (along its wall, both ways), this many cells are FLOOR of its room and free of pieces: the chest
	 * stands on the open wall, never tucked into a corner or between a wall end and a set piece (TR1 as built).
	 */
	readonly sideClearTiles: number;
	/** The chest's cell is at least this far from every doorway cell of its room (between tile centres). */
	readonly doorFarTiles: number;
	/** No solid-decor cell (tomb, candle stand, statue, throne) within this Chebyshev distance of the chest's cell. */
	readonly decorClearTiles: number;
}

/** The vault values. Changing one changes which endless floors hold a vault and what its chest is. */
export const VAULT: VaultTunables = table.freeze({
	salt: 0xb5297a4d,
	fromFloor: 2,
	chanceByBand: table.freeze([
		table.freeze({ fromFloor: 2, percent: 40 }),
		table.freeze({ fromFloor: 5, percent: 50 }),
		table.freeze({ fromFloor: 10, percent: 55 }),
	]),
	roomWeight: table.freeze({ combat: 1, elite: 2 }),
	minRoomTiles: 120,
	legendaryPercent: table.freeze({ base: 25, perFloor: 1, max: 40 }),
	lockWeights: table.freeze([1, 1]),
	wallClearTiles: 2,
	sideClearTiles: 1,
	doorFarTiles: 6,
	decorClearTiles: 1,
});

/** The vault's lock (TRD4). Append only: stored on the floor and hashed by the sim. */
export const VaultLock = { UNTOUCHED: 0, SWIFT: 1 } as const;
/** The chest's tier (TRD5, the draft's rarities). A vault starts RARE or LEGENDARY; COMMON is a cracked RARE only. */
export const VaultTier = { COMMON: 0, RARE: 1, LEGENDARY: 2 } as const;

/** The chest's piece kind in the floor's breakables (BREAKABLE_PIECE_KINDS[2]; never a BREAKABLE_KINDS entry). */
export const CHEST_KIND: BreakablePieceKindName = "chest";

/** The range of the chance and tier draws: rng.int(0, VAULT_PERCENT_RANGE - 1) < percent. */
export const VAULT_PERCENT_RANGE = 100;

/** Percent of floors with a vault on `floor`: 0 below VAULT.fromFloor, else the last band whose fromFloor <= floor. */
export function vaultChancePercent(floor: number): number {
	if (floor < VAULT.fromFloor) return 0;
	let out = 0;
	for (const b of VAULT.chanceByBand) if (floor >= b.fromFloor) out = b.percent;
	return out;
}

/** The Legendary share of a vault on `floor` (percent): base + perFloor x (floor - fromFloor), at most max. */
export function legendaryPercent(floor: number): number {
	const L = VAULT.legendaryPercent;
	return math.min(L.max, L.base + L.perFloor * math.max(0, floor - VAULT.fromFloor));
}
