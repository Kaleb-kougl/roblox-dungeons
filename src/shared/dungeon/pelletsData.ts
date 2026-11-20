/**
 * Pellet tunables (docs/PELLETS.md PL1, decisions PD4 / PD5 / PD9; a Roblox-port feature, no web source): where an
 * endless floor's pellets lie and how often it holds a power pellet. Data only: ./pellets.ts reads it, nothing is
 * inline in the logic. A LEAF (no imports). The sim-side rules (pickup radius, points) live in shared/sim pellets/.
 *
 * @module
 */

/** The pellet patterns a room can draw (one draw per room, in this order). */
export type PelletPattern = "ring" | "cross" | "lanes" | "zigzag";

/** One pattern a room can draw and how it is laid. */
export interface PelletPatternDef {
	/** Which pattern. */
	readonly pattern: PelletPattern;
	/** The pattern's distance from the room's floor bounds: one draw rng.int(min, max) per room. */
	readonly insetTiles: readonly [number, number];
	/** One pellet every this many cells along the pattern's path. */
	readonly spacingTiles: number;
}

/** When a floor may hold a power pellet. */
export interface PelletPowerTunables {
	/** The first floor that can hold a power pellet. */
	readonly fromFloor: number;
	/** Per floor from fromFloor: one draw rng.int(0, 99) < chancePercent ("rare", PD4). At most one per floor. */
	readonly chancePercent: number;
}

/**
 * The pellet layout's tunables: its rng salt, the per-room counts, the patterns a room can draw and the power pellet's
 * chance.
 */
export interface PelletTunables {
	/**
	 * The pellets' own rng stream: new EncounterRng(floor seed ^ salt), like the breakables (0x5bd1e995), the boss pick
	 * (0x27d4eb2f), the affixes (0xcc9e2d51) and the loot (0xe6546b64). Nothing else on the floor reads it.
	 */
	readonly salt: number;
	/** A room with fewer usable cells than this on its pattern gets no pellets. */
	readonly minPerRoom: number;
	/** At most this many pellets in a room: more are trimmed evenly along the pattern. */
	readonly maxPerRoom: number;
	/** The patterns a room can draw (one draw over this list per room), with their insets and spacing. */
	readonly patterns: ReadonlyArray<PelletPatternDef>;
	/** `lanes`: at least this many cells between two lanes (the lanes spread evenly between the two outer ones). */
	readonly laneGapTiles: number;
	/** The power pellet's roll. */
	readonly power: PelletPowerTunables;
}

/** The pellet layout values. Changing one changes every endless floor's pellets. */
export const PELLETS: PelletTunables = table.freeze({
	salt: 0x27220a95,
	minPerRoom: 8,
	maxPerRoom: 28,
	// PL0 census (runs 1-10 x floors 1-20 at roomScale 2, docs/PELLETS.md): with the plan's one inset [2, 3] and one
	// spacing 2 for every pattern, the cross fell under minPerRoom in 28 % of the rooms (45 % at inset 3: pillars sit on
	// the centre lines) and the zigzag (one diagonal line, every 2nd step) in 62 %. So the cross keeps closer to the walls
	// ([1, 2]: 6-8 % under) and the zigzag lays every step (1.41 tiles apart on the diagonal: 1-4 % under).
	patterns: table.freeze([
		table.freeze({ pattern: "ring", insetTiles: table.freeze([2, 3] as [number, number]), spacingTiles: 2 }),
		table.freeze({ pattern: "cross", insetTiles: table.freeze([1, 2] as [number, number]), spacingTiles: 2 }),
		table.freeze({ pattern: "lanes", insetTiles: table.freeze([2, 3] as [number, number]), spacingTiles: 2 }),
		table.freeze({ pattern: "zigzag", insetTiles: table.freeze([1, 3] as [number, number]), spacingTiles: 1 }),
	] as PelletPatternDef[]),
	laneGapTiles: 4,
	power: table.freeze({ fromFloor: 2, chancePercent: 33 }),
});

/** The def of `pattern` in PELLETS.patterns. Throws on a pattern not in the list. */
export function pelletPatternDef(pattern: PelletPattern): PelletPatternDef {
	for (const def of PELLETS.patterns) if (def.pattern === pattern) return def;
	error(`pellets: unknown pattern ${pattern}`, 0);
}

/** The power pellet's chance draw: rng.int(0, PELLET_CHANCE_RANGE - 1) < chancePercent. */
export const PELLET_CHANCE_RANGE = 100;
