/**
 * The Goldling's floor roll and flee field tunables (docs/FORTUNE.md GE1, decisions FD10 / FD13; a Roblox-port feature,
 * no web source). Data only: ./golden.ts reads it, nothing is inline in the logic. A LEAF (no imports but types). The
 * sim-side rules (appear / escape timers, speed, jink, payouts) live in shared/sim golden/.
 *
 * @module
 */
import type { EncounterRoomType } from "./encounterTypes";

/** One depth band of the Goldling's per-floor chance (FD13). */
export interface GoldenChanceBand {
	/** The band starts on this floor (bands in ascending fromFloor order; the last one whose fromFloor <= floor wins). */
	readonly fromFloor: number;
	/** One draw rng.int(0, percentRange - 1) < chancePercent puts a Goldling on the floor. */
	readonly chancePercent: number;
}

/** An encounter room type the Goldling can pick, and its weight in the one room draw. */
export interface GoldenRoomWeight {
	/** The room type. */
	readonly type: EncounterRoomType;
	/** Its weight in the room draw. */
	readonly weight: number;
}

/** The Goldling roll's tunables: its rng salt, the chance per depth band and which rooms it may pick. */
export interface GoldenPlaceTunables {
	/**
	 * The roll's own rng stream: new EncounterRng(floor seed ^ salt), like the boss pick (0x27d4eb2f), the breakables
	 * (0x5bd1e995), the affixes (0xcc9e2d51), the loot (0xe6546b64) and the pellets (0x27220a95). Nothing else on the
	 * floor reads it, so every other floor output is the same with or without the Goldling.
	 */
	readonly salt: number;
	/** No Goldling (and no draw) before this floor. */
	readonly fromFloor: number;
	/** The per-floor chance by depth band (FD13: 30 % floors 2-4, 35 % 5-9, 40 % 10+). */
	readonly bands: ReadonlyArray<GoldenChanceBand>;
	/**
	 * The room types it can run in, with their weights (combat / elite rooms with planned spawns, never the boss room).
	 * The plan names a weighted pick but no weights: equal weights until a playtest says otherwise (GE1 as built).
	 */
	readonly roomWeights: ReadonlyArray<GoldenRoomWeight>;
	/** A room with fewer FLOOR cells of its own than this is too cramped for a chase (EncounterRoom.floorTiles). */
	readonly minRoomTiles: number;
	/** The percent denominator of the chance draw. */
	readonly percentRange: number;
}

/** The Goldling roll's values. Changing one changes which endless floors hold a Goldling and where. */
export const GOLDEN_PLACE: GoldenPlaceTunables = table.freeze({
	salt: 0x3d2f8b4d,
	fromFloor: 2,
	bands: table.freeze([
		table.freeze({ fromFloor: 2, chancePercent: 30 }),
		table.freeze({ fromFloor: 5, chancePercent: 35 }),
		table.freeze({ fromFloor: 10, chancePercent: 40 }),
	]),
	roomWeights: table.freeze([
		table.freeze({ type: "combat" as EncounterRoomType, weight: 1 }),
		table.freeze({ type: "elite" as EncounterRoomType, weight: 1 }),
	]),
	// The plan names the rule but no number. GE1 census (golden.spec.ts, runs 1-8 x floors 2-13 at roomScale 2): the
	// smallest combat / elite room with planned spawns has 184 FLOOR cells, so 100 (a 10 x 10 room) only ever rules out
	// a hand-built or future tiny room; it moves no pick today.
	minRoomTiles: 100,
	percentRange: 100,
});

/**
 * The flee field (docs/FORTUNE.md "The Goldling": a multi-source BFS from every living player over the room box, then
 * the `-factor x distance` re-relax so a cornered Goldling slips past instead of pinning itself in a corner; the
 * roguelike "safety map").
 */
export interface GoldenFleeTunables {
	/** Seeds of the re-relax: -factor x the BFS distance from the nearest player (> 1: running past beats cornering). */
	readonly factor: number;
}

/** The flee field's value. */
export const GOLDEN_FLEE: GoldenFleeTunables = table.freeze({ factor: 1.2 });
