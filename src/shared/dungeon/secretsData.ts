/**
 * Secret room tunables (docs/SECRET_ROOMS.md Design 1, Rules, decisions SRD1 / SRD6 / SRD10; a Roblox-port feature, no
 * web source): which endless floor hides a cracked far wall, where, how big the chamber behind it is and its chest's
 * tier. Data only: ./secrets.ts reads it, nothing is inline in the logic. A leaf but for types and the vault's tier ids. The sim-side rules (the
 * openers, the chest's grants, the points) live in shared/sim secrets/; the tier ids are the vault's (VaultTier).
 *
 * Distances are in tiles (TILE_SIZE = 1 world unit), between cell centres, Chebyshev unless a rule says otherwise.
 *
 * @module
 */
import type { EncounterRoomType } from "./encounterTypes";
import type { BreakablePieceKindName } from "./breakablesData";
import { VaultTier } from "./vaultData";

/** One chamber size: cells along the wall x cells deep (behind it). */
export interface SecretChamberSize {
	/** Cells along the wall. */
	readonly along: number;
	/** Cells deep behind the wall. */
	readonly depth: number;
}

/** A chest tier and its weight in the one tier draw. */
export interface SecretTierWeight {
	/** VaultTier (RARE or LEGENDARY; never COMMON, SRD6). */
	readonly tier: number;
	/** Its weight in the tier draw. */
	readonly weight: number;
}

/**
 * The secret room roll's tunables: its rng salt, the chance, which rooms can hold the crack, the chamber sizes and the
 * chest's tier weights.
 */
export interface SecretTunables {
	/**
	 * The secret's own rng stream: new EncounterRng(floor seed ^ salt) ("KVSC"), like the vault (0xb5297a4d), the
	 * Goldling (0x3d2f8b4d) and the modifiers (0x4b56464d); SR1 checked it unused (hex and decimal) in src/, scripts/ and
	 * fixtures/, and secrets.spec checks it against every floor and sim salt. Nothing else on the floor reads it.
	 */
	readonly salt: number;
	/** No secret (and no draw) before this floor (SRD1). */
	readonly fromFloor: number;
	/** One draw rng.int(0, percentRange - 1) < chancePercent: the floor hides a secret (SRD1: a flat 25 %, no bands). */
	readonly chancePercent: number;
	/** The chance draw's range: `chancePercent` out of this. */
	readonly percentRange: number;
	/** Rooms that can hold the crack (never the entrance, boss, shrine or treasure room). */
	readonly roomTypes: ReadonlyArray<EncounterRoomType>;
	/** Wall cells the crack spans, side by side along one far wall. */
	readonly crackCells: number;
	/** The front box: this many cells in front of every crack cell are FLOOR of the room and free of pieces. */
	readonly frontDepth: number;
	/** Chamber sizes, tried largest first; a crack position keeps the first that fits (SRD10). */
	readonly chambers: ReadonlyArray<SecretChamberSize>;
	/** The chest's tier draw (SRD6: Rare 65 / Legendary 35), VaultTier order. */
	readonly tierWeights: ReadonlyArray<SecretTierWeight>;
	/** No doorway cell (and no doorway arch cell) within this distance of a crack cell. */
	readonly doorClearTiles: number;
	/** No Forge torch, and no Forge prop standing on a wall cell (a banner, a grave on the wall top), within this. */
	readonly wallPropClearTiles: number;
	/** No POOL cell within this distance of a crack cell. */
	readonly poolClearTiles: number;
}

/** The secret room values. Changing one changes which endless floors hide a secret and where. */
export const SECRET: SecretTunables = table.freeze({
	salt: 0x4b565343,
	fromFloor: 2,
	chancePercent: 25,
	percentRange: 100,
	roomTypes: table.freeze(["combat", "elite"] as EncounterRoomType[]),
	crackCells: 2,
	frontDepth: 3,
	chambers: table.freeze([
		table.freeze({ along: 5, depth: 4 }),
		table.freeze({ along: 4, depth: 4 }),
		table.freeze({ along: 4, depth: 3 }),
		table.freeze({ along: 3, depth: 3 }),
	]),
	tierWeights: table.freeze([
		table.freeze({ tier: VaultTier.RARE, weight: 65 }),
		table.freeze({ tier: VaultTier.LEGENDARY, weight: 35 }),
	]),
	doorClearTiles: 2,
	wallPropClearTiles: 1,
	poolClearTiles: 1,
});

/** The crack's piece kind in the floor's breakables (BREAKABLE_PIECE_KINDS[3]; never a BREAKABLE_KINDS entry). */
export const CRACKED_WALL_KIND: BreakablePieceKindName = "crackedWall";
