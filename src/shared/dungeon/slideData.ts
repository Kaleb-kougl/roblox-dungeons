/**
 * The player's slide mover tunables (docs/WALL_SLIDE.md Design 1-3, decisions WSD2 / WSD3; a Roblox-port feature, no
 * web source). Data only: ./slide.ts reads it, nothing is inline in the logic. A LEAF (no imports).
 *
 * @module
 */

/** How `slideCircle` resolves one move (docs/WALL_SLIDE.md Design 1-3). */
export interface PlayerSlideTuning {
	/** Push-out passes per move (each takes the deepest overlap); an overlap left after them falls back to moveCircle. */
	readonly iterations: number;
	/** A first contact on a box corner whose tangential share of the step is below this gets the tie-break. */
	readonly tieShare: number;
	/** The tie-break's push along the corner's tangent, as a share of the step's length. */
	readonly tiePush: number;
	/** Face assist: a run (anything but an isolated blocker) is slipped round when it is cleared within this (tiles). */
	readonly assistTiles: number;
	/** The assists run only when the slide kept less than this share of the step's length. */
	readonly assistStallShare: number;
	/** An isolated blocker (all 8 neighbours open: a pillar, a lone crate) is slipped round across its whole face. */
	readonly pillarSlip: boolean;
}

/** The live tuning (WSD3: pillars slip on any hit, everything wider within 0.35 tiles of its end). */
export const PLAYER_SLIDE: PlayerSlideTuning = {
	iterations: 4,
	tieShare: 0.05,
	tiePush: 0.3,
	assistTiles: 0.35,
	assistStallShare: 0.2,
	pillarSlip: true,
};
