/**
 * Decor tunables (docs/DECOR.md R3, R6, R8) that are Roblox-port choices rather than the web decor plan's own
 * constants (those keep their web names in ./decorPlan.ts: MAX_TALL_PER_ROOM, TALL_MIN_SPACING, MAX_DECOR_SHARE,
 * BULLET_Y, BULLET_PAD_PX, DECOR_BOX, WALL_DEPTH_BIAS). Presentation only: nothing here reaches the sim or a replay,
 * and none of it touches a Forge param (the Forge's props are the candidate set; these only thin, swap and re-weight).
 *
 * Kept in this folder rather than in `shared/config` (where docs/DECOR.md Phase 2 names DECOR_DEPTH) so the decor
 * plan's data lives with the module that owns it; move it if a non-view module ever needs it.
 *
 * @module
 */
import type { RoomTheme } from "shared/dungeon";
import { PEDESTAL_RADIUS, SHRINE_RADIUS, STAIRWELL_RADIUS } from "shared/sim";
import type { DecorKind } from "shared/theme";

/** One depth band of DECOR_DEPTH (docs/DECOR.md Phase 2 part 1). Shares are fractions in [0, 1]. */
export interface DecorDepthBand {
	/** kept / worn / ruined / abyss. */
	readonly name: string;
	/** The band holds from this endless floor on (until the next band's). */
	readonly fromFloor: number;
	/** Flat clutter cap as a share of a room's floor tiles (the R3 cap MAX_DECOR_SHARE stays the ceiling). */
	readonly flatShare: number;
	/** Share of legal `column` / tall `pillar` spots drawn as the broken stump `columnBroken` (Lords of Pain column2). */
	readonly columnBrokenShare: number;
	/** Weight of the clutter kinds (bones, debris: rocks / bricks) against the other flat kinds when a room is thinned. */
	readonly clutterWeight: number;
	/** Share of wall torches that start lit. */
	readonly litTorchShare: number;
	/** Ambient light multiplier (and the ambient particle rate multiplier, R9). */
	readonly light: number;
}

/**
 * Depth bands (docs/DECOR.md Phase 2 part 1; starting values, R15 tunes them). Bands go by endless floor, like the
 * breakables' (BREAKABLE.bands): kept 1-4, worn 5-9, ruined 10-14, abyss 15+. The boss floors (every 5th) sit on the
 * boundaries, so every boss floor opens on a new look.
 */
export const DECOR_DEPTH = {
	bands: [
		{
			name: "kept",
			fromFloor: 1,
			flatShare: 0.2,
			columnBrokenShare: 0,
			clutterWeight: 1,
			litTorchShare: 1,
			light: 1,
		},
		{
			name: "worn",
			fromFloor: 5,
			flatShare: 0.28,
			columnBrokenShare: 0.3,
			clutterWeight: 1.3,
			litTorchShare: 0.85,
			light: 0.9,
		},
		{
			name: "ruined",
			fromFloor: 10,
			flatShare: 0.34,
			columnBrokenShare: 0.6,
			clutterWeight: 1.7,
			litTorchShare: 0.65,
			light: 0.8,
		},
		{
			name: "abyss",
			fromFloor: 15,
			flatShare: 0.4,
			columnBrokenShare: 0.85,
			clutterWeight: 2,
			litTorchShare: 0.45,
			light: 0.7,
		},
	] as ReadonlyArray<DecorDepthBand>,
	/** Flat kinds the band's clutterWeight applies to (debris covers the pack's rocks and bricks). */
	clutterKinds: ["bones", "debris"] as ReadonlyArray<string>,
	/** Workspace attribute that forces a band in Studio (its index, 0 = kept); read by the client (R4). */
	forceBandAttribute: "KV_DecorBand",
} as const;

/**
 * Keep-out zones of the decor plan (the slice's interactables, docs/DECOR.md D3: they replace the web Delve's), tiles.
 * A piece whose cell centre is closer than a zone's radius to its centre is dropped.
 */
export const DECOR_CLEAR = {
	/** Chebyshev distance from any doorway cell within which nothing is drawn (R6 doorway jamb columns excepted). */
	doorTiles: 1,
	/** Around each treasure room's relic pedestal (its pickup radius plus a margin). */
	pedestalTiles: PEDESTAL_RADIUS + 1,
	/** Around each shrine room's shrine (its zone plus a margin): the shrine crystal under it is dropped. */
	shrineTiles: SHRINE_RADIUS + 1,
	/** Around the stairwell (the boss room's centre, also the boss arena centre). */
	stairwellTiles: STAIRWELL_RADIUS + 1,
	/** Around the boss arena centre (the boss's spot; the boss crystal there is dropped). */
	bossCentreTiles: 2,
	/** Around the entrance spawn (the entrance `ring` is its marker and is kept). */
	entranceTiles: 1.5,
} as const;

/** Far-wall dressing (docs/DECOR.md R6): wall segments on straight far-wall runs, columns at corners and jambs. */
export const DECOR_DRESSING = {
	/** A far-wall run shorter than this gets a column in its middle (no wall segments on any run: not decoration). */
	minRunTiles: 4,
} as const;

/** Placement details of the port (where pieces sit on their cell). */
export const DECOR_PLACE = {
	/** Height of a wall piece's anchor (torch, banner) on its face, tiles above the floor. */
	wallPieceHeightTiles: 0.65,
} as const;

/**
 * Salts of decorHash (one per independent choice), so e.g. a torch's lit roll and its variant never correlate.
 * Arbitrary distinct 32-bit values.
 */
export const DECOR_SALT = {
	variant: 0x1b873593,
	flat: 0x2c1b3c6d,
	column: 0x297a2d39,
	torch: 0x3d4d51cb,
	scatterRoom: 0x5bd1e995,
	scatterCell: 0x68e31da4,
	banner: 0x1b56c4e9,
	bookcaseSet: 0x7f4a7c15,
	bookcaseCell: 0x4cf5ad43,
	bookcaseWide: 0x7b2c3e91,
	bookcaseWideLook: 0x1f5e9a3d,
	patchRoom: 0x3b9aca07,
	patchBlock: 0x2a6bd1c7,
	kenneyLook: 0x5f3759df,
	libraryCandle: 0x6c8e9cf5,
} as const;

/**
 * Bookcase art sets (docs/KENNEY_DECOR.md): a pack's bookcase variants come in facing pairs (+X, +Z). Pair 0 is the
 * primary art (vale: the kit bookcase), pairs 1.. an alternative set (vale: Kenney's cases, pair 1 the full shelf). A
 * room draws all its bookcases from one set, by room hash: `altRoomShare` of the rooms take the alternative set. In
 * it, a case takes pair 1 at `altCommonShare`, else one of the others, evenly, by cell hash. Presentation only.
 */
export const DECOR_BOOKCASES = {
	altRoomShare: 0.5,
	altCommonShare: 0.45,
	/**
	 * Wide cases (docs/KENNEY_DECOR.md KN3, KND11): in a room drawing the alternative set, when the pack has wide art
	 * (decor kind bookcaseWide), each run is walked from its low end and a case with a neighbour after it in the run
	 * starts a pair at this share (cell hash): the two cells draw as one wide case. Its look: the full case at
	 * `altCommonShare`, else one of the others, evenly.
	 */
	wideShare: 0.5,
} as const;

/**
 * Room banners (docs/DECOR.md "Solid decor": banners on room walls like Diablo's): besides the Forge's, each room hangs
 * up to `perRoom` banners on its far-wall faces (the ones the camera sees), on cells no other wall piece or tall piece
 * holds, at least `spacingTiles` (Chebyshev) from every wall piece, lowest cell hash first; only when the pack has
 * banner art. Never in the boss room.
 */
export const DECOR_BANNERS = {
	perRoom: 2,
	spacingTiles: 3,
} as const;

/**
 * Floor patches (docs/KENNEY_DECOR.md KN4): planks and dirt worn into the floor, decor kind `patch`, laid by the decor
 * plan itself on 2 x 2 blocks of open floor, only when the pack has patch art. Presentation only (walkable, flat).
 */
export const DECOR_PATCHES = {
	/** A room's patches: one per this many floor tiles, rounded down, at least 1 and at most maxPerRoom. */
	tilesPerPatch: 100,
	maxPerRoom: 3,
	/** A room needs at least this many floor tiles. */
	minRoomTiles: 24,
	/** The boss arena: at most this many, in bossShare of the boss rooms (by room hash). */
	bossMax: 1,
	bossShare: 0.5,
	/**
	 * Every cell of the block and of a ring this wide around it is FLOOR of the room and carries no other flat piece
	 * (no two flats overlap: they lie at one height), and the block is not kept out (doorways, interactables,
	 * breakables). Patches keep spacingTiles (Chebyshev, between block corners) from one another.
	 */
	ringTiles: 1,
	spacingTiles: 4,
} as const;

/**
 * Scattered pieces (docs/DECOR.md "3D kits"): decor kinds no Forge piece places, laid by the decor plan itself on open
 * floor, at most one per room, only when the pack has art for the kind. The fallen chandelier: about a third of the
 * rooms big enough for it, never the boss room, a few per floor.
 */
export const DECOR_SCATTER = {
	kinds: ["chandelier"],
	/** Share of eligible rooms that get one (by room hash). */
	roomShare: 0.35,
	/** A room needs at least this many floor tiles. */
	minRoomTiles: 40,
	/** Every cell within this many tiles (Chebyshev) of the spot is floor: the art never lies over a wall or pool. */
	clearTiles: 1,
	/** At most this many per floor (rooms in index order). */
	maxPerFloor: 4,
} as const;

/** A Kenney solid kind's looks (docs/KENNEY_DECOR.md KN9): see decorPlan's kenneyVariant. */
export interface DecorKenneyLooks {
	/** Variants per look, one per facing (or axis) the piece is drawn in; 1: the look alone. */
	readonly per: number;
	/** The last `rareLooks` looks are drawn at `rareShare` of the pieces (cell hash), the others evenly. */
	readonly rareLooks: number;
	readonly rareShare: number;
}

/**
 * Kenney solid pieces' looks (docs/KENNEY_DECOR.md KN9, the plan's tables), picked per piece by cell hash (salt
 * DECOR_SALT.kenneyLook), presentation only: a study table's three looks evenly (axis pairs); a display case's sword 1
 * in 4, the plain, books and open cases evenly (axis pairs); a lectern's empty stand 1 in 4 (four facings each); a
 * dining table's broken set 1 in 4 (two looks), the six whole ones evenly. Kinds not listed take their facing or axis
 * alone (decorPlan's solid step). A pack with fewer variants than one look's facings: the hash picks, as for any kind.
 */
export const DECOR_KENNEY: Readonly<Partial<Record<DecorKind, DecorKenneyLooks>>> = {
	studyTable: { per: 2, rareLooks: 0, rareShare: 0 },
	display: { per: 2, rareLooks: 1, rareShare: 0.25 },
	lectern: { per: 4, rareLooks: 1, rareShare: 0.25 },
	diningTable: { per: 1, rareLooks: 2, rareShare: 0.25 },
};

/**
 * A library's runner (docs/KENNEY_DECOR.md KN9): a carpet run 1 wide (min(w, h) = 1 in Dungeon.carpets) draws as
 * `carpet` variants from `firstVariant` (0-based, after the throne carpet's four): a 2 x 1 segment along X, along Z,
 * then the end of a runner running toward +X, +Z, -X, -Z (`variants` in all). Each end cell takes an end piece (its
 * open side toward the runner), the cells between them 2 x 1 segments (the Forge lays an even length, so they pair
 * up). Only when the pack has every runner variant; else the runner is not drawn.
 */
export const DECOR_RUNNER = {
	firstVariant: 4,
	variants: 6,
	/** The segment variants (along X, along Z), before the four ends. */
	segmentVariants: 2,
	segmentCells: 2,
} as const;

/**
 * A library's candle stands (docs/KENNEY_DECOR.md, the library table's run ends): in a room of theme `library`, a
 * `candelabrum` draws as decor kind `libraryCandle` (Kenney's candle stands, a variant by cell hash, salt
 * DECOR_SALT.libraryCandle) when the pack has that kind; elsewhere, or without it, the candelabrum as before.
 */
export const DECOR_LIBRARY_THEME: RoomTheme = "library";
