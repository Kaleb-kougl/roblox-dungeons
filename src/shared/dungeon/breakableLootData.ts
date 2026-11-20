/**
 * Breakable loot tunables (docs/BREAKABLE_DROPS.md BL1, decisions BLD1 / BLD2 / BLD8; a Roblox-port feature, no web
 * source): how many barrels and crates of an endless floor hold a boost, and which. Data only: ./breakableLoot.ts
 * reads it, nothing is inline in the logic. The sim-side rules (release on break, ground slots) live in shared/sim
 * drops/breakLoot.ts.
 *
 * @module
 */
import type { BreakableKindName } from "./breakablesData";

/** A depth band of loaded pieces per floor (the DECOR bands: kept 1-4, worn 5-9, ruined 10-14, abyss 15+). */
export interface BreakableLootBand {
	/** The band's first floor. */
	readonly fromFloor: number;
	/** Loaded pieces per floor, one draw in [min, max] (capped by the pieces available). */
	readonly min: number;
	readonly max: number;
}

export interface BreakableLootTunables {
	/**
	 * The loot's own rng stream: new EncounterRng(floor seed ^ salt) (murmur3's n), like the breakables (0x5bd1e995),
	 * the boss pick (0x27d4eb2f) and the affixes (0xcc9e2d51). Nothing else on the floor reads it.
	 */
	readonly salt: number;
	/** Depth bands, by first floor ascending. */
	readonly bands: ReadonlyArray<BreakableLootBand>;
	/** At most this many loaded pieces in one room (spread). */
	readonly maxPerRoom: number;
	/** Weight of each piece kind in the piece pick (crates take twice the hits, so they hold loot twice as often). */
	readonly pieceWeight: Readonly<Record<BreakableKindName, number>>;
	/**
	 * Weight of each boost kind (shared/sim Boost order: Fury, Quickstep, Frenzy, Aegis). MUST equal shared/sim BOOSTS'
	 * weights (BLD8): the dungeon cannot import the sim, so a sim spec (drops/breakLoot.spec.ts) checks it.
	 */
	readonly kindWeights: ReadonlyArray<number>;
}

export const BREAKABLE_LOOT: BreakableLootTunables = table.freeze({
	salt: 0xe6546b64,
	bands: table.freeze([
		table.freeze({ fromFloor: 1, min: 0, max: 2 }), // kept   ~1.0 per floor
		table.freeze({ fromFloor: 5, min: 1, max: 2 }), // worn   ~1.5
		table.freeze({ fromFloor: 10, min: 1, max: 3 }), // ruined ~2.0
		table.freeze({ fromFloor: 15, min: 1, max: 3 }), // abyss  ~2.0
	]),
	maxPerRoom: 1,
	pieceWeight: table.freeze({ barrel: 1, crate: 2 }),
	kindWeights: table.freeze([3, 3, 3, 2]),
});
