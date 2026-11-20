/**
 * Silver in crates tunables (docs/SILVER.md SC1, "Silver in crates", decisions SVD15 / SVD16; a Roblox-port feature, no
 * web source): how many barrels and crates of an endless floor hold Silver, and how much each holds. Data only:
 * ./breakableSilver.ts reads it, nothing is inline in the logic. The sim-side rules (credited on any break, the team's
 * total) live in shared/sim silver/.
 *
 * @module
 */
import type { BreakableKindName } from "./breakablesData";

/** A depth band of Silver pieces per floor (the loot's and the DECOR bands: kept 1-4, worn 5-9, ruined 10-14, abyss 15+). */
export interface BreakableSilverBand {
	/** The band's first floor. */
	readonly fromFloor: number;
	/** Silver pieces per floor, one draw in [min, max] (capped by the candidates and the per-room cap). */
	readonly min: number;
	/** The most Silver pieces a floor of this band gets. */
	readonly max: number;
}

/** One piece's stack: one draw in [min + bonus, max + bonus], bonus = min(bonusCap, floor((floor - 1) / floorsPerStep)). */
export interface BreakableSilverStack {
	/** The stack range on floor 1. */
	readonly min: number;
	/** The largest stack on floor 1. */
	readonly max: number;
	/** Every this many floors both ends of the range rise by one. */
	readonly floorsPerStep: number;
	/** The rise stops here (reached on floor 1 + bonusCap x floorsPerStep). */
	readonly bonusCap: number;
}

/**
 * The tunables of Silver hidden in breakables: the rng salt, how many pieces per depth band and how large a stack is.
 */
export interface BreakableSilverTunables {
	/**
	 * Silver's own rng stream: new EncounterRng(floor seed ^ salt) ("KVSL"), like the loot (0xe6546b64), the secret
	 * (0x4b565343) and the modifiers (0x4b56464d); unused anywhere else in src/, scripts/ and fixtures/ (hex and decimal,
	 * 1263948620), and breakableSilver.spec checks it against every floor and sim salt. Nothing else on the floor reads it.
	 */
	readonly salt: number;
	/** Depth bands, by first floor ascending (docs/SILVER.md: 2-3 / 3-4 / 3-5 / 3-5, tune). */
	readonly bands: ReadonlyArray<BreakableSilverBand>;
	/** At most this many Silver pieces in one room (a piece in no room is uncapped, like the loot). */
	readonly maxPerRoom: number;
	/** Weight of each piece kind in the piece pick (OC9: barrels too; crates twice as likely, SVD16). */
	readonly pieceWeight: Readonly<Record<BreakableKindName, number>>;
	/** Each piece's stack of Silver (docs/SILVER.md: 4-8 at floor 1, rising with the floor; tune). */
	readonly stack: BreakableSilverStack;
}

/** The Silver-in-breakables values. Changing one changes which pieces pay Silver, never the sim. */
export const BREAKABLE_SILVER: BreakableSilverTunables = table.freeze({
	salt: 0x4b56534c,
	bands: table.freeze([
		table.freeze({ fromFloor: 1, min: 2, max: 3 }), // kept
		table.freeze({ fromFloor: 5, min: 3, max: 4 }), // worn
		table.freeze({ fromFloor: 10, min: 3, max: 5 }), // ruined
		table.freeze({ fromFloor: 15, min: 3, max: 5 }), // abyss
	]),
	maxPerRoom: 2,
	pieceWeight: table.freeze({ barrel: 1, crate: 2 }),
	// Floor 1-2: 4-8, floor 3-4: 5-9, ... +1 every 2 floors up to +10 (floor 21 on: 14-18).
	stack: table.freeze({ min: 4, max: 8, floorsPerStep: 2, bonusCap: 10 }),
});
