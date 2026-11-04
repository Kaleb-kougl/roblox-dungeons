/**
 * Pact altar tunables (docs/FORTUNE.md PS1, decisions FD1 / FD3; a Roblox-port feature, no web source): where an
 * endless floor's two pact altars stand in its shrine room, and the stream of the curse Greed shows. Data only:
 * ./pacts.ts reads it, nothing is inline in the logic. A LEAF (no imports). The sim-side rules (Greed's deal, Horde's
 * wave, the x2) live in shared/sim pacts/.
 */

/** The pacts, by index (state, hash, the altars' order in FloorPacts.altars). APPEND ONLY. */
export const PactKind = {
	/** Pact of Greed: take the curse shown on the altar, choose a Legendary now. */
	GREED: 0,
	/** Pact of the Horde: the next enemy room fights a second wave and pays x2. */
	HORDE: 1,
} as const;
export type PactKindId = (typeof PactKind)[keyof typeof PactKind];
/** Pact names in index order (theme string keys `pact.<name>.*`, dump names). */
export const PACT_KIND_NAMES = ["greed", "horde"] as const;
/** How many pacts (altars per shrine room). */
export const PACT_KIND_COUNT = PACT_KIND_NAMES.size();

export interface PactAltarTunables {
	/**
	 * The pacts' own stream: floor seed ^ salt (the curse Greed shows, pactCurseIndex). Like the breakables (0x5bd1e995),
	 * the boss pick (0x27d4eb2f), the affixes (0xcc9e2d51), the loot (0xe6546b64) and the pellets (0x27220a95); nothing
	 * else on the floor reads it. Placing the altars draws nothing.
	 */
	readonly salt: number;
	/** Per player, mixed into the curse stream: imul(player + 1, playerMul), so each player sees their own curse. */
	readonly playerMul: number;
	/**
	 * Screen-right as a grid step (x, y): the 45-degree iso camera's screen-horizontal line (shared/sim
	 * DRAFT_SCREEN_RIGHT_X / _Z = (SQRT1_2, -SQRT1_2), checked by a sim spec). Greed stands screen-left of the crystal,
	 * Horde screen-right.
	 */
	readonly screenRight: readonly [number, number];
	/**
	 * Steps along that line from the crystal (the shrine room's centre floor cell) tried for the altars, in this order:
	 * first the offsets where BOTH sides fit (the pair mirrors the crystal), then each side alone. An offset of k steps
	 * is k x sqrt(2) tiles away, so the smallest keeps the altar's zone clear of the crystal's.
	 */
	readonly offsetSteps: ReadonlyArray<number>;
	/** Screen-down as a grid step (x, y), perpendicular to screenRight. */
	readonly screenDown: readonly [number, number];
	/**
	 * Shifts of the whole pair along screenDown, tried in this order, when no offset fits on the crystal's own line (a
	 * small shrine room whose statue stands on that line): the pair keeps its screen-horizontal line, just above or
	 * below the crystal. 0 (the crystal's line) first.
	 */
	readonly shiftSteps: ReadonlyArray<number>;
	/**
	 * Every cell within this many cells (Chebyshev) of an altar's cell is FLOOR of the shrine room, holds no breakable
	 * and no pellet: the altar's zone (the sim's SHRINE_RADIUS, one tile) lies on open floor you can walk all round.
	 */
	readonly clearCells: number;
}

export const PACTS: PactAltarTunables = table.freeze({
	salt: 0x5c3a91e7,
	playerMul: 0x9e3779b1,
	screenRight: table.freeze([1, -1] as [number, number]),
	offsetSteps: table.freeze([3, 4, 2, 5, 6, 7]),
	screenDown: table.freeze([1, 1] as [number, number]),
	// PS1 census (runs 1-20 x floors 1-20): on the crystal's line alone 11 of 391 shrine floors fit no pair (an 11 x 13
	// room whose statue stands on the line); shifting the pair a step or two screen-up / down places every one.
	shiftSteps: table.freeze([0, 1, -1, 2, -2, 3, -3]),
	clearCells: 1,
});
