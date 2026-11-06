/**
 * The decor plan (docs/DECOR.md R3, R6, R8): which of a floor's Dungeon Forge pieces are drawn, as what, and where.
 * Pure and deterministic: the same Dungeon (and inputs) gives the same plan on every client. View code: it reads the
 * Dungeon, never the sim, and changes no collision, hash or replay.
 *
 * WRITTEN FROM docs/DECOR.md, NOT PORTED. D3 says this ports the web build's `src/dungeon/decorPlan.ts` @ `35307022`,
 * but that source was not available; this module implements the rules the plan writes down ("What already exists"
 * core rules, "The key constraint", D2, R3, R6, Phase 2 part 1) and keeps the web names (decorPlan.ts, planDecor,
 * MAX_TALL_PER_ROOM, TALL_MIN_SPACING, MAX_DECOR_SHARE, BULLET_Y, BULLET_PAD_PX, DECOR_BOX, WALL_DEPTH_BIAS) so a
 * later diff against web `35307022` is easy. Pending that comparison; record it in PROVENANCE.md when done.
 *
 * Rules, in the order planDecor applies them:
 *   keep-out   nothing within DECOR_CLEAR.doorTiles (Chebyshev) of a doorway cell, on a breakable's cell, or within a
 *              zone of the slice's interactables (D3: relic pedestals, shrine zones, the stairwell / boss arena centre,
 *              the entrance spawn; DECOR_CLEAR). Chests are never drawn (the treasure room's pedestal stands there);
 *              arches are not decor kinds (doorways stay clear). Exceptions: the entrance `ring` (the spawn's own
 *              marker) ignores the entrance zone; R6 doorway jamb columns ignore the doorway rule.
 *   tall       brazier > sarco > pillar > grave > candle > icicle > shardIce (TALL_PRIORITY; Forge order inside a
 *              kind). Each goes on top of a FAR-WALL cell of its own room (a WALL cell, not a solid pillar, with the
 *              room's floor in front of it at +X or +Z: the -X / -Z walls the camera looks at), the legal one
 *              nearest the Forge's spot, else it is dropped. Legal: free, not kept out, at least TALL_MIN_SPACING
 *              tiles from every tall piece placed so far, the room under MAX_TALL_PER_ROOM, and the footprint rule.
 *   footprint  the art's screen box (DECOR_BOX, standing on the wall top, padded by BULLET_PAD_PX) may not cover
 *              any part of a bullet-open cell (FLOOR or POOL: bullets fly over pools) at bullet height BULLET_Y that
 *              lies behind the art's plane, except where the wall block under the art already hides it (cells
 *              behind the block, inside its silhouette by at least the pad). Computed with the game camera's true
 *              projection (./screen.ts), exactly, by clipping each cell's projected square against the box. That
 *              geometry depends only on the box and the footprint's shape, so it is a cached stencil of cell offsets
 *              (footprintStencil) and a spot is legal when none of its stencil cells is bullet-open.
 *   dressing   R6: per room, after its Forge pieces and under the same caps and rules: `column`s on the room's back
 *              corners, its doorway jambs and the middle of its short runs (under minRunTiles). No wall segments
 *              (`wall` / `wallBroken`, Lords of Pain wall2 / wall3): wall props are not decoration (docs/DECOR.md
 *              R6, 2026-11-02; docs/VOID_DECOR.md VDD10).
 *   pillars    D2: a solid pillar (an endless floor's `pillar` prop on a WALL cell) is a real wall: it never moves
 *              to a far wall and is never a floor prop. It gets the low `columnBroken` stump on its own top where the
 *              footprint rule allows (with the stump's box), else only the wall material (dropped here). A pillar a
 *              library's reading area cleared (Dungeon.clearedPillars, docs/BOOKSHELVES.md) draws nothing at all.
 *   flat       debris, bones, crack, moss, roots (moved onto the floor cell its breach faces), ring, bossCrystal,
 *              shrineCrystal lie where the Forge put them, on FLOOR, one per cell, at most profile.flatShare (never
 *              above MAX_DECOR_SHARE) of their room's floor tiles (corridors count as one group); a full room keeps
 *              the pieces with the lowest decorHash / weight (the band's clutter weight for bones and debris).
 *   wall       torches (Dungeon.torches) and banners hang only on a wall face the camera sees (+X or +Z; a piece on a
 *              hidden face moves to the cell's visible face onto a floor cell, if it has one), one per cell, never on
 *              a cell carrying a tall piece. Torches light by the band (litTorchShare, by cell hash).
 *   profile    R8 (./profile.ts): the band's share swaps `pillar` / `column` for `columnBroken` on legal spots
 *              (the broken box lies inside the whole ones, so a legal spot stays legal),
 *              cap and weight the flat clutter, and light torches. It never adds a piece or touches a Forge param.
 *   void       docs/VOID_DECOR.md VD5, only when the input carries a VoidPlan (absent: the plan is exactly the one
 *              without it): set pieces on the void's surfaces, appended after everything above (so no earlier entry or
 *              fade box index moves), source "void", each entry's `y` the surface top it stands / lies on. Standing
 *              (on SHOULDER cells near a room, VOID_PIECES): `column` / `columnBroken` (or a biome void kind the pack
 *              has art for, decor.void.b<n>.<kind>); never a wall prop (docs/VOID_DECOR.md VDD10); each passes the
 *              footprint rule at its surface's top (footprintClear(d, f, box, DECOR_CAMERA, top)) and stands only on
 *              its room's far side (VDD2: the first walkable cell straight screen-down along (+1, +1) is its room's,
 *              within the cell's field distance + 1 + farSideSlackTiles; no walkable cell screen-up along (-1, -1)
 *              within nearSideReachTiles), at most
 *              tallPerRoom per room (a void cell's room: the nearest floor cell's, carried out from the walls by
 *              field distance),
 *              tallMinSpacing apart, decorClearTiles from every decor standing and wall piece, maxStanding per floor;
 *              whole vs broken by the depth profile's shares (own salts). Flat (shoulder and ledge tops): debris, the
 *              biome's extras (bones grim, moss verdant), flagstones near rooms, a biome void flat kind the pack has;
 *              drawn at most VOID_PIECES.flatRadiusTiles from their pivot and only where every cell in that radius is
 *              the same surface (so, by docs/VOID_DECOR.md rule 0, never over floor; the spec checks with ray casts),
 *              flatMinSpacing apart, capped at maxFlat and flatShare of the shoulder.
 *   banners    docs/DECOR.md "Solid decor", after the wall pieces, only when the pack has banner art: per room but the
 *              boss's, up to DECOR_BANNERS.perRoom more banners on its far-wall faces (no wall or tall piece there,
 *              spacingTiles from every wall piece), lowest cell hash first; source "dressing".
 *   solid      docs/DECOR.md "Solid decor", after the wall pieces (before the void): Dungeon.solidDecor's tombs (2 x 1) and candle
 *              stands stand on their own WALL cells at floor level (source "solid", layer low, a fade box like every
 *              standing piece); obstacles, so the footprint rule does not apply. A tomb's variant is its axis, and so
 *              is a reading area's table's (docs/BOOKSHELVES.md); a chair's is its facing (+X, +Z, -X, -Z).
 *   scatter    docs/DECOR.md "3D kits", appended after the void (so no earlier entry or fade box index moves), only
 *              for a DECOR_SCATTER kind the pack has art for (input.variants; absent: nothing): per room in index
 *              order, never the boss room, at least minRoomTiles of floor, roomShare of them by room hash, one flat
 *              piece on the room's FLOOR cell with the lowest cell hash that is not kept out, carries no flat piece
 *              and has only FLOOR within clearTiles; at most maxPerFloor per floor. Source "scatter".
 *   patches    docs/KENNEY_DECOR.md KN4, appended after the scattered pieces, only when the pack has `patch` art: per
 *              room in index order, DECOR_PATCHES' count (by floor tiles; the boss arena at most bossMax, in bossShare
 *              of them), each a flat 2 x 2 block (cellX .. cellX + 1, cellY .. cellY + 1; anchor its centre) of the
 *              room's FLOOR whose ring is FLOOR too, with no flat piece on any of them and the block not kept out,
 *              lowest block hash first, spacingTiles apart. Source "scatter".
 *
 * Coordinates: grid cell (gx, gy) is world (x, z) = (gx, gy) (TILE_SIZE 1, shared/dungeon collision.ts); heights in
 * tiles above the floor. Entries carry world positions in sim units; the renderer converts with studsX / studsY /
 * studsZ.
 */
import { BULLET_Y as SIM_BULLET_Y } from "shared/sim";
import { PIXELS_PER_TILE, STUDS_PER_TILE } from "shared/config";
import {
	TileType,
	cellKey,
	encounterRooms,
	entranceSpawn,
	gridToWorld,
	isBulletBlockingTile,
	tileAt,
	type Dungeon,
	type EndlessFloorLayout,
	type PropKind,
	type SolidDecorPiece,
	type WorldXZ,
} from "shared/dungeon";
import { stableSort } from "shared/jsmath";
import {
	VOID_DECOR,
	decorId,
	voidDecorId,
	type BiomeId,
	type DecorKind,
	type DecorLayer,
	type VoidDecorKind,
} from "shared/theme";
import { BULLET_VIEW, GAME_WORLD } from "../config";
import { floorClearanceStuds } from "../sprites";
import type { IsoBasis } from "../iso";
// The void's config and layers by file, not the voidDecor barrel: voidDecor/plan.ts imports this folder's barrel.
import { VOID_PIECES } from "../voidDecor/config";
import { VoidLayer } from "../voidDecor/layer";
import type { VoidPlan } from "../voidDecor/plan";
import {
	DECOR_BANNERS,
	DECOR_BOOKCASES,
	DECOR_CLEAR,
	DECOR_DRESSING,
	DECOR_PLACE,
	DECOR_PATCHES,
	DECOR_SALT,
	DECOR_SCATTER,
} from "./config";
import { decorHash, decorHash01 } from "./hash";
import { decorProfile, flatKindWeight, type DecorProfile } from "./profile";
import {
	DECOR_CAMERA,
	clipConvex,
	convexHull,
	groundAt,
	insideBy,
	polygonBounds,
	screenDepth,
	screenX,
	screenY,
	type ScreenPolygon,
} from "./screen";

// ---------------------------------------------------------------------------------------------
// The web plan's constants (names kept for the diff against web 35307022)

/** At most this many tall pieces (Forge pieces and R6 dressing together) per room. */
export const MAX_TALL_PER_ROOM = 3;
/** Tall pieces stand at least this many tiles apart (Euclidean, between their nearest footprint cells). */
export const TALL_MIN_SPACING = 3;
/** Flat pieces cover at most this share of a room's floor tiles (the ceiling of every depth band's share). */
export const MAX_DECOR_SHARE = 0.4;
/** Height bullets fly at, tiles (the sim's BULLET_Y): where the footprint rule looks for a hidden bullet. */
export const BULLET_Y = SIM_BULLET_Y;
/**
 * The footprint rule's pad, render pixels (PIXELS_PER_TILE per tile): an enemy bullet's drawn radius
 * (BULLET_VIEW.enemyDrawRadius 0.17 tiles = 2.7 px), rounded up, so art that touches any part of a bullet counts.
 */
export const BULLET_PAD_PX = math.ceil(BULLET_VIEW.enemyDrawRadius * PIXELS_PER_TILE);
/**
 * Wall pieces' billboards are pushed this far toward the camera off their wall face, tiles, so the face does not cut
 * them (the web's WALL_DEPTH_BIAS, re-derived for this camera; R4 tunes it in Studio).
 */
export const WALL_DEPTH_BIAS = 0.6;

/**
 * A standing piece's screen box for the footprint rule, render pixels (PIXELS_PER_TILE per tile, as drawn at the game
 * camera): `w` wide centred on the pivot (plus `x`, pixels right of it), `h` above the pivot, `below` under it. A
 * wall segment's box runs along its whole run (the box at each end, hulled).
 */
export interface DecorBoxPx {
	readonly w: number;
	readonly h: number;
	readonly below: number;
	readonly x?: number;
}

/**
 * Standing pieces' boxes (the opaque body, not the baked shadow). Measured (R5) on the vale pack's Lords of Pain art as
 * drawn, at the pack's 29.6 px per tile (the outlines in art/build/contact/decor.*.png): column1 (pillar, column) 20 x
 * 54.6 render px, column2 (columnBroken) 18.9 x 21.6, standing on their front corner; the brazier's body is 15.1 x 17.8
 * and its box keeps room above the bowl for the flame (vfx/flames, held inside it at decorFlameMaxGrow); wall2 / wall3
 * segments fit their run's hull at 0.96-0.99 by their outline. Generous guesses where the pack has no art. Nothing
 * hangs below a wall-top pivot (it would cover bullets hugging the wall's face). Broken variants must fit inside their
 * whole kind's box (a swap keeps a legal spot legal; the spec checks).
 */
export const DECOR_BOX: Readonly<Record<StandingKind, DecorBoxPx>> = {
	brazier: { w: 26, h: 30, below: 0 },
	sarco: { w: 34, h: 22, below: 0 },
	pillar: { w: 20, h: 55, below: 0 },
	grave: { w: 18, h: 26, below: 0 },
	candle: { w: 10, h: 18, below: 0 },
	icicle: { w: 12, h: 22, below: 0 },
	shardIce: { w: 16, h: 24, below: 0 },
	wall: { w: 8, h: 28, below: 0 },
	wallBroken: { w: 8, h: 22, below: 0 },
	column: { w: 20, h: 55, below: 0 },
	columnBroken: { w: 19, h: 22, below: 0 },
	// solid decor (docs/DECOR.md "Solid decor"), measured on the world-scale renders: a tomb's box at each end of its 2
	// x 1 footprint (art 73 x 70 px around its floor-centre pivot), the candle stand's at its cell (art 20 x 35, on its
	// base); `below`: they stand on the floor, so art reaches below the anchor line
	tomb: { w: 20, h: 33, below: 27 },
	candelabrum: { w: 12, h: 19, below: 2 },
	// room themes (docs/DECOR.md "Room themes"): a box at each of the footprint's four corners, hulled (the throne's
	// 4 x 2 dais, the statue's 3 x 3 base; art measured on the world-scale renders)
	throne: { w: 12, h: 26, below: 7 },
	statue: { w: 6, h: 10, below: 4 },
	// bookcases (docs/BOOKSHELVES.md): one cell each, the case against the cell's back edge; measured on the BK5 renders
	// (art 29 x 50 px at 125 kit units a tile, pivot the cell centre): the outline reaches 21.1 art px (11.4 render px) to
	// the left of the pivot facing +X and 20.9 to the right facing +Z (w covers both facings, x 0), 43.1 above it (23.3)
	// and 5.9 below (3.2); `below` 6 since docs/KENNEY_DECOR.md: Kenney's deeper cases reach 8.2 art px below the pivot
	// (10.0 with the ladder, 5.4 render px), so their art draws whole too (a solid piece: no footprint rule, the fade box only)
	bookcase: { w: 23, h: 24, below: 6 },
	// a library's reading area (docs/BOOKSHELVES.md), measured on the built outlines (render px = art px / 1.85), the
	// worst case over the facings: the table's box at both ends of its 2 x 1 footprint, hulled (as the tomb's), the
	// chair's at its cell
	table: { w: 14, h: 10, below: 2 },
	chair: { w: 11, h: 11, below: 4 },
	// a wide bookcase (docs/KENNEY_DECOR.md KN3): two cells of a run drawn as one Kenney case, its box at both ends of the
	// pair (the run's outer edges), hulled (as the tomb's); the smallest box (w x h + below) holding the outlines of all
	// six looks in both facings at full size is 11 / 19 / 2, kept with a pixel to spare
	bookcaseWide: { w: 13, h: 21, below: 3 },
};

/** Tall Forge pieces in placement priority (highest first). */
export const TALL_PRIORITY: ReadonlyArray<StandingKind> = [
	"brazier",
	"sarco",
	"pillar",
	"grave",
	"candle",
	"icicle",
	"shardIce",
];

/** Forge piece kinds drawn flat, where the Forge put them. */
export const FLAT_FORGE_KINDS: ReadonlyArray<PropKind> = [
	"debris",
	"bones",
	"crack",
	"moss",
	"roots",
	"ring",
	"bossCrystal",
	"shrineCrystal",
];

/** Pieces that light (flames, the light pool, the director's ignition): torches and braziers. */
export const DECOR_LIGHT_KINDS: ReadonlyArray<DecorKind> = ["torch", "brazier"];

// ---------------------------------------------------------------------------------------------
// Types

/** Decor kinds that stand (tall or low): the ones with a DECOR_BOX. */
export type StandingKind =
	| "brazier"
	| "sarco"
	| "pillar"
	| "grave"
	| "candle"
	| "icicle"
	| "shardIce"
	| "wall"
	| "wallBroken"
	| "column"
	| "columnBroken"
	| "tomb"
	| "candelabrum"
	| "throne"
	| "statue"
	| "bookcase"
	| "table"
	| "chair"
	| "bookcaseWide";

/**
 * Where an entry comes from: a Forge prop, a Forge torch, R6 far-wall dressing, a solid pillar's stump, or a void set
 * piece (docs/VOID_DECOR.md VD5: only with DecorPlanInput.voidPlan).
 */
export type DecorSource = "forge" | "torch" | "dressing" | "pillar" | "void" | "scatter" | "solid";

/** Why a Forge piece is not drawn (planDecor's `dropped` counts). */
export type DecorDropReason =
	/** chests: the treasure room's pedestal stands there */
	| "chest"
	/** within DECOR_CLEAR.doorTiles of a doorway */
	| "doorway"
	/** inside an interactable's zone (pedestal, shrine, stairwell, boss centre, entrance spawn) */
	| "interactable"
	/** on a breakable's cell */
	| "breakable"
	/** a tall piece with no legal far-wall spot in its room (footprint, spacing, cap, or none at all) */
	| "noSpot"
	/** a piece with no room (corridor walls, a tall piece outside every room) */
	| "noRoom"
	/** a solid pillar whose stump would hide a bullet (it keeps the wall material) */
	| "solidPillar"
	/** a flat piece over its room's flat share */
	| "cap"
	/** a second piece on a cell that already has one of its layer */
	| "occupied"
	/** a flat piece not on FLOOR */
	| "notFloor"
	/** a wall piece with no wall face the camera sees */
	| "hiddenFace"
	/** a wall piece on a cell carrying a tall piece */
	| "underTall"
	/** on the wall cell right behind a bookcase (docs/BOOKSHELVES.md: the case's top rises over it) */
	| "behindShelf";

/** Every DecorDropReason, in report order. */
export const DECOR_DROP_REASONS: ReadonlyArray<DecorDropReason> = [
	"chest",
	"doorway",
	"interactable",
	"breakable",
	"noSpot",
	"noRoom",
	"solidPillar",
	"cap",
	"occupied",
	"notFloor",
	"hiddenFace",
	"underTall",
	"behindShelf",
];

/** One drawn piece. World positions in sim units (tiles; x = grid x, z = grid y, y = height above the floor). */
export interface DecorEntry {
	readonly kind: DecorKind;
	/** decorId(biome, kind): the base ID; the variant is `variant` into pack.decorVariants(biome, kind). */
	readonly id: string;
	/** How it is drawn: tall / low stand on a wall top, flat lies on the floor, wall hangs on a face. */
	readonly layer: DecorLayer;
	/**
	 * The anchor: tall / low the pivot's spot on the wall top (a segment: its middle), flat the floor cell's centre
	 * (y 0), wall the face's centre at DECOR_PLACE.wallPieceHeightTiles. Void pieces (source "void"): `y` is the top
	 * of the void surface they stand or lie on (VoidPlan.top: the shoulder's or the ledge's), not the wall top or floor.
	 */
	readonly x: number;
	readonly y: number;
	readonly z: number;
	/** The grid cell it stands / lies / hangs on (a segment: its first cell). */
	readonly cellX: number;
	readonly cellY: number;
	/** Cells it covers along (runX, runZ): 1 for every planned piece (no wall segments since 2026-11-02). */
	readonly cells: number;
	readonly runX: number;
	readonly runZ: number;
	/**
	 * Wall pieces: the face's outward normal ((1, 0) or (0, 1): toward the camera side). Tall / low on far walls: the
	 * direction of the room in front. Flat: the Forge's facing (cracks, roots), else (0, 0).
	 */
	readonly faceX: number;
	readonly faceZ: number;
	/** Room id (Dungeon.rooms), -1 for corridors. */
	readonly roomId: number;
	/** decorHash(floor seed, cell, DECOR_SALT.variant): variant, facing of round pieces, flame phase. */
	readonly hash: number;
	/** Index into pack.decorVariants(biome, kind): hash % count when the plan was given counts, else 0. */
	readonly variant: number;
	/** Index into DecorPlan.fadeBoxes (tall and low pieces), -1 for flat and wall pieces. */
	readonly fade: number;
	/** A light source (torch, brazier): flames, the light pool and the director's per-room ignition. */
	readonly light: boolean;
	/** Starts lit (torches by the band's litTorchShare; braziers true). Meaningless when `light` is false. */
	readonly lit: boolean;
	readonly source: DecorSource;
	/** Index into Dungeon.props (forge, pillar) or Dungeon.torches (torch); -1 for dressing and scattered pieces. */
	readonly forgeIndex: number;
	/** The Forge's rotation (radians) and scale; 0 and 1 for dressing and scattered pieces. */
	readonly rot: number;
	readonly scale: number;
	/**
	 * docs/VOID_DECOR.md VD7 / VD5: a biome void art piece (decor.void.b<n>.<kind>): `id` is voidDecorId, `variant`
	 * indexes pack.voidDecorVariants(biome, voidKind), and `kind` is the standard kind whose box the footprint rule
	 * checked (`column` tall, `columnBroken` low, `debris` flat). Absent on every other entry.
	 */
	readonly voidKind?: VoidDecorKind;
}

/** A standing piece's screen box for fading (unpadded), and the depth of its billboard plane. */
export interface DecorFadeBox {
	/** Index into DecorPlan.entries. */
	readonly entry: number;
	/** Counter-clockwise screen polygon, tiles (./screen.ts). */
	readonly polygon: ScreenPolygon;
	/** View depth of the billboard plane, tiles: something deeper than this behind the polygon is hidden by it. */
	readonly depth: number;
}

export interface DecorPlan {
	readonly floorSeed: number;
	readonly floor: number;
	readonly biome: BiomeId;
	readonly profile: DecorProfile;
	/** Standing pieces first (Forge tall, dressing, pillar stumps), then flat, then wall pieces. */
	readonly entries: ReadonlyArray<DecorEntry>;
	readonly fadeBoxes: ReadonlyArray<DecorFadeBox>;
	/** Entry indices of each room's light sources (index = room id), for the director. */
	readonly lightsByRoom: ReadonlyArray<ReadonlyArray<number>>;
	/** Entry indices of the light sources outside every room (corridor torches). */
	readonly corridorLights: ReadonlyArray<number>;
	/** Forge pieces not drawn, by reason (every DECOR_DROP_REASONS key present). */
	readonly dropped: ReadonlyMap<DecorDropReason, number>;
	/** Entries per layer. */
	readonly counts: Readonly<Record<DecorLayer, number>>;
	/** Void set pieces (source "void", docs/VOID_DECOR.md VD5) per layer, included in `counts`; all 0 without a voidPlan. */
	readonly voidCounts: Readonly<Record<DecorLayer, number>>;
}

/** What planDecor reads. Only `dungeon` is required (M1 and tests); endless floors pass their layout's extras. */
export interface DecorPlanInput {
	readonly dungeon: Dungeon;
	/** The floor seed (decorHash's seed); default dungeon.seed. */
	readonly floorSeed?: number;
	/** Endless floor number (the depth band); default 1. */
	readonly floor?: number;
	/** The run's Depth (state.endless.depth); default 1. */
	readonly depth?: number;
	/** Force a depth band (KV_DecorBand). */
	readonly forceBand?: number;
	/** A ready profile (overrides floor / depth / forceBand). */
	readonly profile?: DecorProfile;
	/** Breakable cells (EndlessFloorLayout.breakables): nothing is drawn on them. */
	readonly breakables?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
	/** The entrance spawn (world); default entranceSpawn(dungeon). */
	readonly spawn?: WorldXZ;
	/** The stairwell (world); default the boss room's centre floor tile. */
	readonly stairwell?: WorldXZ;
	/** The pack's variant count of a kind (pack.decorVariants(biome, kind).size()); absent: every variant is 0. */
	readonly variants?: (kind: DecorKind) => number;
	/**
	 * docs/VOID_DECOR.md VD5: the floor's void plan (planVoid / planVoidCached of the same Dungeon). Present: void set
	 * pieces are planned on its surfaces (source "void", appended last). Absent: the plan is exactly the one without it.
	 */
	readonly voidPlan?: VoidPlan;
	/**
	 * The pack's variant count of a biome void kind (pack.voidDecorVariants(biome, kind).size()). A void kind is only
	 * planned when the pack has art for it (it is optional extra art, unlike the standard kinds); absent: none.
	 */
	readonly voidVariants?: (kind: VoidDecorKind) => number;
}

/** planDecor's input for an endless floor layout (its seed, floor, breakables, spawn and stairwell). */
export function decorInputOfLayout(layout: EndlessFloorLayout, depth?: number): DecorPlanInput {
	return {
		dungeon: layout.dungeon,
		floorSeed: layout.seed,
		floor: layout.floor,
		depth,
		breakables: layout.breakables,
		spawn: layout.spawn,
		stairwell: layout.stairwell,
	};
}

// ---------------------------------------------------------------------------------------------
// DecorFootprint geometry

const HALF = 0.5;
/** A flat kind's thinning weight never drops below this (a zero weight would always lose). */
const MIN_FLAT_WEIGHT = 1e-6;
const PAD_TILES = BULLET_PAD_PX / PIXELS_PER_TILE;

export interface DecorFootprint {
	/** First and last cell (the same for a point piece) and the run axis. */
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
	readonly runX: number;
	readonly runZ: number;
}

/**
 * The anchors a footprint's box stands on: its cell's top centre, a segment's two outer ends, or a rectangle's four
 * outer corners (runX and runZ both set: a set piece of solid decor).
 */
function anchorsOf(f: DecorFootprint, top: number): number[] {
	if (f.x0 === f.x1 && f.y0 === f.y1) return [f.x0, top, f.y0];
	if (f.runX > 0 && f.runZ > 0 && f.x0 !== f.x1 && f.y0 !== f.y1) {
		const xa = f.x0 - HALF;
		const xb = f.x1 + HALF;
		const za = f.y0 - HALF;
		const zb = f.y1 + HALF;
		return [xa, top, za, xb, top, za, xb, top, zb, xa, top, zb];
	}
	return [f.x0 - HALF * f.runX, top, f.y0 - HALF * f.runZ, f.x1 + HALF * f.runX, top, f.y1 + HALF * f.runZ];
}

/** The box's screen polygon (ccw, tiles), grown by `pad` on every side. */
function boxPolygon(cam: IsoBasis, f: DecorFootprint, box: DecorBoxPx, top: number, pad: number): number[] {
	const a = anchorsOf(f, top);
	const w = box.w / PIXELS_PER_TILE / 2 + pad;
	const dx = (box.x ?? 0) / PIXELS_PER_TILE;
	const hUp = box.h / PIXELS_PER_TILE + pad;
	const hDown = box.below / PIXELS_PER_TILE + pad;
	const pts: number[] = [];
	for (let i = 0; i < a.size(); i += 3) {
		const sx = screenX(cam, a[i], a[i + 1], a[i + 2]) + dx;
		const sy = screenY(cam, a[i], a[i + 1], a[i + 2]);
		pts.push(sx - w, sy - hDown, sx + w, sy - hDown, sx + w, sy + hUp, sx - w, sy + hUp);
	}
	return convexHull(pts);
}

/** The billboard plane's depth: the nearest anchor's, minus the camera-ward floor clearance of the box's lower part. */
function planeDepth(cam: IsoBasis, f: DecorFootprint, box: DecorBoxPx, top: number): number {
	const a = anchorsOf(f, top);
	let d = math.huge;
	for (let i = 0; i < a.size(); i += 3) d = math.min(d, screenDepth(cam, a[i], a[i + 1], a[i + 2]));
	const belowStuds = (box.below / PIXELS_PER_TILE) * STUDS_PER_TILE;
	return d - floorClearanceStuds(belowStuds) / STUDS_PER_TILE;
}

/** The screen silhouette of the wall block under a footprint (its cells from the floor to `top`). */
function blockSilhouette(cam: IsoBasis, f: DecorFootprint, top: number): number[] {
	const pts: number[] = [];
	for (const [cx, cy] of [
		[f.x0, f.y0],
		[f.x1, f.y1],
	])
		for (const ox of [-HALF, HALF])
			for (const oz of [-HALF, HALF])
				for (const y of [0, top]) {
					const x = cx + ox;
					const z = cy + oz;
					pts.push(screenX(cam, x, y, z), screenY(cam, x, y, z));
				}
	return convexHull(pts);
}

/** Screen offsets of a cell's four corners at bullet height from its centre's projection, and their depth offsets. */
function cellCornerOffsets(cam: IsoBasis): { readonly quad: number[]; readonly maxDepth: number } {
	const quad: number[] = [];
	let maxDepth = -math.huge;
	for (const [ox, oz] of [
		[-HALF, -HALF],
		[HALF, -HALF],
		[HALF, HALF],
		[-HALF, HALF],
	]) {
		quad.push(screenX(cam, ox, 0, oz), screenY(cam, ox, 0, oz));
		maxDepth = math.max(maxDepth, screenDepth(cam, ox, 0, oz));
	}
	return { quad, maxDepth };
}

/**
 * The footprint rule's stencil: the cells, relative to the footprint's first cell, where a bullet would be hidden by
 * box `box` standing on footprint `f`'s top (`top`: the wall top, or a void surface's) if that cell were bullet-open
 * (see the file comment). Exact: each
 * candidate cell's projected square (at BULLET_Y) is clipped against the padded box; a cell hides a bullet when
 * anything is left that is not inside the wall block's silhouette by the pad (or the cell is not behind the block
 * at all). The geometry only depends on the box and the footprint's shape, never on where it stands, so the answer
 * is a fixed list of offsets (cached per surface top and shape for the game camera).
 */
export function footprintStencil(
	f: DecorFootprint,
	box: DecorBoxPx,
	cam: IsoBasis = DECOR_CAMERA,
	top: number = GAME_WORLD.wallHeightTiles,
): ReadonlyArray<number> {
	const rel: DecorFootprint = { x0: 0, y0: 0, x1: f.x1 - f.x0, y1: f.y1 - f.y0, runX: f.runX, runZ: f.runZ };
	const shared = cam === DECOR_CAMERA;
	const key = `${top}/${box.w}/${box.h}/${box.below}/${box.x ?? 0}/${rel.x1}/${rel.y1}/${rel.runX}/${rel.runZ}`;
	if (shared) {
		const hit = STENCILS.get(key);
		if (hit !== undefined) return hit;
	}
	const art = boxPolygon(cam, rel, box, top, PAD_TILES);
	const plane = planeDepth(cam, rel, box, top);
	const sil = blockSilhouette(cam, rel, top);
	const corners = cellCornerOffsets(cam);
	const [bx0, by0, bx1, by1] = polygonBounds(art);
	// candidate window: the box's bounds back-projected onto the bullet plane, plus a cell
	let gx0 = math.huge;
	let gx1 = -math.huge;
	let gy0 = math.huge;
	let gy1 = -math.huge;
	for (const [sx, sy] of [
		[bx0, by0],
		[bx1, by0],
		[bx0, by1],
		[bx1, by1],
	]) {
		const [x, z] = groundAt(cam, sx, sy, BULLET_Y);
		gx0 = math.min(gx0, x);
		gx1 = math.max(gx1, x);
		gy0 = math.min(gy0, z);
		gy1 = math.max(gy1, z);
	}
	const maxFx = math.max(rel.x0, rel.x1);
	const maxFy = math.max(rel.y0, rel.y1);
	const q = corners.quad;
	const cell: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
	const out: number[] = [];
	const iy1 = math.ceil(gy1) + 1;
	const ix1 = math.ceil(gx1) + 1;
	// nearest the camera first: the cells right behind the block decide most illegal spots, so they fail fast
	for (let gy = iy1; gy >= math.floor(gy0) - 1; gy--)
		for (let gx = ix1; gx >= math.floor(gx0) - 1; gx--) {
			const inBlock =
				gx >= math.min(rel.x0, rel.x1) && gx <= maxFx && gy >= math.min(rel.y0, rel.y1) && gy <= maxFy;
			if (inBlock) continue; // the wall cells themselves stop bullets
			const behindBlock = gx <= maxFx && gy <= maxFy;
			if (!behindBlock && screenDepth(cam, gx, BULLET_Y, gy) + corners.maxDepth <= plane) continue;
			const cx = screenX(cam, gx, BULLET_Y, gy);
			const cy = screenY(cam, gx, BULLET_Y, gy);
			let qx0 = math.huge;
			let qx1 = -math.huge;
			let qy0 = math.huge;
			let qy1 = -math.huge;
			for (let k = 0; k < 4; k++) {
				const x = cx + q[k * 2];
				const y = cy + q[k * 2 + 1];
				cell[k * 2] = x;
				cell[k * 2 + 1] = y;
				qx0 = math.min(qx0, x);
				qx1 = math.max(qx1, x);
				qy0 = math.min(qy0, y);
				qy1 = math.max(qy1, y);
			}
			if (qx1 < bx0 || qx0 > bx1 || qy1 < by0 || qy0 > by1) continue;
			const hit = clipConvex(cell, art);
			const n = math.floor(hit.size() / 2);
			if (n === 0) continue;
			let hides = !behindBlock;
			for (let k = 0; k < n && !hides; k++)
				if (!insideBy(sil, hit[k * 2], hit[k * 2 + 1], PAD_TILES)) hides = true;
			if (hides) out.push(gx, gy);
		}
	if (shared) STENCILS.set(key, out);
	return out;
}

/** DecorFootprint stencils of the game camera, by surface top, box and footprint shape (see footprintStencil). */
const STENCILS = new Map<string, ReadonlyArray<number>>();

/**
 * The footprint rule: true when box `box` standing on footprint `f`'s wall top hides no part of any bullet at
 * BULLET_Y over a bullet-open cell (FLOOR or POOL) of `d`: no cell of footprintStencil is bullet-open.
 */
export function footprintClear(
	d: Dungeon,
	f: DecorFootprint,
	box: DecorBoxPx,
	cam: IsoBasis = DECOR_CAMERA,
	top: number = GAME_WORLD.wallHeightTiles,
): boolean {
	const st = footprintStencil(f, box, cam, top);
	for (let i = 0; i < st.size(); i += 2)
		if (!isBulletBlockingTile(tileAt(d, f.x0 + st[i], f.y0 + st[i + 1]))) return false;
	return true;
}

// ---------------------------------------------------------------------------------------------
// The plan

interface Zone {
	readonly x: number;
	readonly z: number;
	readonly r2: number;
	readonly entrance: boolean;
}

/** A far-wall cell of a room: the wall cell and the direction of the room's floor in front of it. */
interface FarWall {
	readonly x: number;
	readonly y: number;
	readonly fx: number;
	readonly fz: number;
}

interface Placed {
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
}

const STANDING: ReadonlySet<string> = new Set<string>(TALL_PRIORITY);
const FLAT: ReadonlySet<string> = new Set<string>(FLAT_FORGE_KINDS);
const LIGHTS: ReadonlySet<string> = new Set<string>(DECOR_LIGHT_KINDS);

/** The plan of `input.dungeon` (see the file comment). Pure: the same input gives the same plan. */
export function planDecor(input: DecorPlanInput): DecorPlan {
	const d = input.dungeon;
	const W = d.W;
	const H = d.H;
	const n = W * H;
	const seed = input.floorSeed ?? d.seed;
	const floor = input.floor ?? 1;
	const profile = input.profile ?? decorProfile(floor, input.depth ?? 1, d.params.themeKey, input.forceBand);
	const biome = profile.biome;
	const flatShare = math.min(profile.flatShare, MAX_DECOR_SHARE);
	const cam = DECOR_CAMERA;
	const top = GAME_WORLD.wallHeightTiles;
	const roomCount = d.rooms.size();

	const dropped = new Map<DecorDropReason, number>();
	for (const r of DECOR_DROP_REASONS) dropped.set(r, 0);
	const drop = (r: DecorDropReason) => dropped.set(r, (dropped.get(r) ?? 0) + 1);

	// --- keep-out masks -------------------------------------------------------------------------
	const nearDoor = new Array<boolean>(n, false);
	const dr = DECOR_CLEAR.doorTiles;
	for (let gy = 0; gy < H; gy++)
		for (let gx = 0; gx < W; gx++) {
			if (d.doorway[gy * W + gx] === 0) continue;
			for (let oy = -dr; oy <= dr; oy++)
				for (let ox = -dr; ox <= dr; ox++) {
					const x = gx + ox;
					const y = gy + oy;
					if (x >= 0 && y >= 0 && x < W && y < H) nearDoor[y * W + x] = true;
				}
		}
	const zones: Zone[] = [];
	const zone = (p: WorldXZ, r: number, entrance = false) => zones.push({ x: p.x, z: p.z, r2: r * r, entrance });
	const rooms = encounterRooms(d);
	for (const room of rooms) {
		const c = { x: room.cx, z: room.cz };
		if (room.type === "treasure") zone(c, DECOR_CLEAR.pedestalTiles);
		else if (room.type === "shrine") zone(c, DECOR_CLEAR.shrineTiles);
	}
	const bossRoom = rooms[d.boss];
	if (bossRoom !== undefined) zone({ x: bossRoom.cx, z: bossRoom.cz }, DECOR_CLEAR.bossCentreTiles);
	const stair = input.stairwell ?? (bossRoom !== undefined ? { x: bossRoom.cx, z: bossRoom.cz } : undefined);
	if (stair !== undefined) zone(stair, DECOR_CLEAR.stairwellTiles);
	zone(input.spawn ?? entranceSpawn(d), DECOR_CLEAR.entranceTiles, true);
	const breakable = new Set<number>();
	for (const b of input.breakables ?? []) breakable.add(cellKey(b.x, b.y));
	/** The wall cell right behind every bookcase (docs/BOOKSHELVES.md): nothing stands or hangs there. */
	const shelfBack = new Set<number>();
	for (const p of d.solidDecor ?? []) if (p.kind === "bookcase") shelfBack.add(cellKey(p.x - p.fx, p.y - p.fz));

	/** Why (gx, gy) is kept clear, or undefined. */
	const keptOut = (
		gx: number,
		gy: number,
		ignoreDoor: boolean,
		ignoreEntrance: boolean,
	): DecorDropReason | undefined => {
		if (!ignoreDoor && nearDoor[gy * W + gx]) return "doorway";
		if (breakable.has(cellKey(gx, gy))) return "breakable";
		if (shelfBack.has(cellKey(gx, gy))) return "behindShelf";
		const x = gridToWorld(gx);
		const z = gridToWorld(gy);
		for (const zn of zones) {
			if (ignoreEntrance && zn.entrance) continue;
			if ((x - zn.x) * (x - zn.x) + (z - zn.z) * (z - zn.z) < zn.r2) return "interactable";
		}
		return undefined;
	};

	// --- solid pillars and far walls --------------------------------------------------------------
	/** Solid pillars a library's reading area cleared (docs/BOOKSHELVES.md): their props draw nothing. */
	const clearedPillar = new Set<number>();
	for (const c of d.clearedPillars ?? []) clearedPillar.add(c.y * W + c.x);
	const solidPillar = new Set<number>();
	for (const p of d.props)
		if (p.kind === "pillar" && tileAt(d, p.x, p.y) === TileType.WALL && !clearedPillar.has(p.y * W + p.x))
			solidPillar.add(p.y * W + p.x);
	/** A wall cell that dresses: WALL, outside every room (so not a solid pillar or an interior wall). */
	const outerWall = (gx: number, gy: number) =>
		tileAt(d, gx, gy) === TileType.WALL && d.roomId[gy * W + gx] < 0 && !solidPillar.has(gy * W + gx);
	const farWalls: FarWall[][] = [];
	/** Back corners: the -X -Z corner cell of a room, its floor only on the +X +Z diagonal. */
	const corners: FarWall[][] = [];
	for (let r = 0; r < roomCount; r++) {
		farWalls.push([]);
		corners.push([]);
	}
	for (let gy = 0; gy < H; gy++)
		for (let gx = 0; gx < W; gx++) {
			if (!outerWall(gx, gy)) continue;
			if (tileAt(d, gx + 1, gy) === TileType.WALL && tileAt(d, gx, gy + 1) === TileType.WALL) {
				const r = tileAt(d, gx + 1, gy + 1) === TileType.FLOOR ? d.roomId[(gy + 1) * W + gx + 1] : -1;
				if (r >= 0 && r < roomCount) corners[r].push({ x: gx, y: gy, fx: 1, fz: 1 });
				continue;
			}
			for (const [fx, fz] of [
				[1, 0],
				[0, 1],
			]) {
				if (tileAt(d, gx + fx, gy + fz) !== TileType.FLOOR) continue;
				const r = d.roomId[(gy + fz) * W + gx + fx];
				if (r >= 0 && r < roomCount) farWalls[r].push({ x: gx, y: gy, fx, fz });
			}
		}

	// --- standing pieces ------------------------------------------------------------------------
	const entries: DecorEntry[] = [];
	const fadeBoxes: DecorFadeBox[] = [];
	const tallCell = new Set<number>();
	const placed: Placed[] = [];
	const tallInRoom = new Array<number>(roomCount, 0);
	const spacing2 = TALL_MIN_SPACING * TALL_MIN_SPACING;

	const spacedOk = (f: DecorFootprint) => {
		const ax0 = math.min(f.x0, f.x1);
		const ax1 = math.max(f.x0, f.x1);
		const ay0 = math.min(f.y0, f.y1);
		const ay1 = math.max(f.y0, f.y1);
		for (const p of placed) {
			const dx = math.max(0, p.x0 - ax1, ax0 - p.x1);
			const dy = math.max(0, p.y0 - ay1, ay0 - p.y1);
			if (dx * dx + dy * dy < spacing2) return false;
		}
		return true;
	};
	const cellsOf = (f: DecorFootprint): number[] => {
		const out: number[] = [];
		const len = math.max(math.abs(f.x1 - f.x0), math.abs(f.y1 - f.y0)) + 1;
		for (let i = 0; i < len; i++) out.push((f.y0 + i * f.runZ) * W + f.x0 + i * f.runX);
		return out;
	};
	const legal = (f: DecorFootprint, kind: StandingKind) => footprintClear(d, f, DECOR_BOX[kind], cam, top);
	const pushStanding = (
		kind: StandingKind,
		layer: DecorLayer,
		f: DecorFootprint,
		roomId: number,
		faceX: number,
		faceZ: number,
		source: DecorSource,
		forgeIndex: number,
		rot: number,
		scale: number,
	) => {
		const a = anchorsOf(f, top);
		const ax = a.size() === 3 ? a[0] : (a[0] + a[3]) / 2;
		const az = a.size() === 3 ? a[2] : (a[2] + a[5]) / 2;
		const index = entries.size();
		const box = DECOR_BOX[kind];
		fadeBoxes.push({ entry: index, polygon: boxPolygon(cam, f, box, top, 0), depth: planeDepth(cam, f, box, top) });
		const hash = decorHash(seed, cellKey(f.x0, f.y0), DECOR_SALT.variant);
		entries.push({
			kind,
			id: decorId(biome, kind),
			layer,
			x: ax,
			y: top,
			z: az,
			cellX: f.x0,
			cellY: f.y0,
			cells: cellsOf(f).size(),
			runX: f.runX,
			runZ: f.runZ,
			faceX,
			faceZ,
			roomId,
			hash,
			variant: variantOf(input, kind, hash),
			fade: fadeBoxes.size() - 1,
			light: LIGHTS.has(kind),
			lit: LIGHTS.has(kind),
			source,
			forgeIndex,
			rot,
			scale,
		});
	};
	/** Places a tall footprint if it is legal (everything but the footprint checked first, cheapest first). */
	const tryTall = (f: DecorFootprint, kind: StandingKind, room: number, ignoreDoor: boolean): boolean => {
		if (tallInRoom[room] >= MAX_TALL_PER_ROOM) return false;
		const cells = cellsOf(f);
		for (const c of cells) {
			if (tallCell.has(c)) return false;
			if (keptOut(c % W, math.floor(c / W), ignoreDoor, false) !== undefined) return false;
		}
		if (!spacedOk(f) || !legal(f, kind)) return false;
		for (const c of cells) tallCell.add(c);
		placed.push({
			x0: math.min(f.x0, f.x1),
			y0: math.min(f.y0, f.y1),
			x1: math.max(f.x0, f.x1),
			y1: math.max(f.y0, f.y1),
		});
		tallInRoom[room]++;
		return true;
	};
	const point = (x: number, y: number): DecorFootprint => ({ x0: x, y0: y, x1: x, y1: y, runX: 0, runZ: 0 });
	/** `column` / `pillar` -> `columnBroken` by the band's share (cell hash). */
	const swapped = (kind: StandingKind, gx: number, gy: number): StandingKind => {
		if (kind === "pillar" || kind === "column")
			return decorHash01(seed, cellKey(gx, gy), DECOR_SALT.column) < profile.columnBrokenShare
				? "columnBroken"
				: kind;
		return kind;
	};
	const layerOf = (kind: StandingKind): DecorLayer => (kind === "columnBroken" ? "low" : "tall");

	// 1. Forge tall pieces, by priority
	interface TallPiece {
		readonly index: number;
		readonly kind: StandingKind;
		readonly rank: number;
	}
	const tall: TallPiece[] = [];
	d.props.forEach((p, index) => {
		if (!STANDING.has(p.kind)) return;
		if (p.kind === "pillar" && solidPillar.has(p.y * W + p.x)) return; // step 3
		if (p.kind === "pillar" && clearedPillar.has(p.y * W + p.x)) return; // gone (a reading area's)
		tall.push({ index, kind: p.kind as StandingKind, rank: TALL_PRIORITY.indexOf(p.kind as StandingKind) });
	});
	stableSort(tall, (a, b) => a.rank - b.rank);
	const exhausted = new Set<string>();
	for (const t of tall) {
		const p = d.props[t.index];
		const room = pieceRoom(d, p.x, p.y, p.roomId, p.dx, p.dy);
		if (room < 0 || room >= roomCount) {
			drop("noRoom");
			continue;
		}
		// a full room, or a kind that already found no spot here (spots only ever get taken), cannot place it
		const scanKey = `${room}/${t.kind}`;
		if (tallInRoom[room] >= MAX_TALL_PER_ROOM || exhausted.has(scanKey)) {
			drop("noSpot");
			continue;
		}
		const spots = [...farWalls[room]];
		const dist = (s: FarWall) => (s.x - p.x) * (s.x - p.x) + (s.y - p.y) * (s.y - p.y);
		stableSort(spots, (a, b) => dist(a) - dist(b));
		let done = false;
		for (const s of spots) {
			const f = point(s.x, s.y);
			if (!tryTall(f, t.kind, room, false)) continue;
			const kind = swapped(t.kind, s.x, s.y);
			pushStanding(kind, layerOf(kind), f, room, s.fx, s.fz, "forge", t.index, p.rot, p.scale);
			done = true;
			break;
		}
		if (!done) {
			exhausted.add(scanKey);
			drop("noSpot");
		}
	}

	// 2. R6 far-wall dressing, room by room: columns only (no wall segments: wall props are not decoration)
	for (let room = 0; room < roomCount; room++) {
		if (tallInRoom[room] >= MAX_TALL_PER_ROOM) continue;
		const walls = farWalls[room];
		const free = walls.filter((s) => keptOut(s.x, s.y, false, false) === undefined);
		const runs = farWallRuns(free);
		// columns: back corners, doorway jambs, short runs' middles
		const columns: Array<{ s: FarWall; jamb: boolean }> = [];
		for (const s of corners[room]) columns.push({ s, jamb: false });
		for (const s of walls) {
			const ax = s.fz;
			const az = s.fx;
			for (const sign of [-1, 1]) {
				const nx = s.x + ax * sign;
				const ny = s.y + az * sign;
				if (tileAt(d, nx, ny) !== TileType.FLOOR) continue;
				const c = ny * W + nx;
				if (d.doorway[c] !== 0 || d.corridor[c] !== 0 || d.roomId[c] !== room) {
					columns.push({ s, jamb: true });
					break;
				}
			}
		}
		for (const run of runs)
			if (run.size() < DECOR_DRESSING.minRunTiles)
				columns.push({ s: run[math.floor((run.size() - 1) / 2)], jamb: false });
		for (const col of columns) {
			if (tallInRoom[room] >= MAX_TALL_PER_ROOM) break;
			const f = point(col.s.x, col.s.y);
			if (!tryTall(f, "column", room, col.jamb)) continue;
			const kind = swapped("column", col.s.x, col.s.y);
			pushStanding(kind, layerOf(kind), f, room, col.s.fx, col.s.fz, "dressing", -1, 0, 1);
		}
	}

	// 3. solid pillars: the low stump where the footprint rule allows it
	d.props.forEach((p, index) => {
		if (p.kind !== "pillar" || !solidPillar.has(p.y * W + p.x)) return;
		const why = keptOut(p.x, p.y, false, false);
		if (why !== undefined) {
			drop(why);
			return;
		}
		const f = point(p.x, p.y);
		if (!legal(f, "columnBroken")) {
			drop("solidPillar");
			return;
		}
		tallCell.add(p.y * W + p.x);
		const room = p.roomId ?? d.roomId[p.y * W + p.x];
		pushStanding("columnBroken", "low", f, room, 0, 0, "pillar", index, p.rot, p.scale);
	});

	// --- flat pieces ----------------------------------------------------------------------------
	interface FlatPiece {
		readonly index: number;
		readonly x: number;
		readonly y: number;
		readonly group: number;
		readonly key: number;
	}
	const flatTaken = new Set<number>();
	// a carpet's cells (docs/DECOR.md "Room themes", drawn with the solid decor) carry no Forge flat piece
	if (input.variants !== undefined && input.variants("carpet") > 0)
		for (const cp of d.carpets ?? [])
			for (let yy = cp.y; yy < cp.y + cp.h; yy++)
				for (let xx = cp.x; xx < cp.x + cp.w; xx++) flatTaken.add(yy * W + xx);
	const groups = new Map<number, FlatPiece[]>();
	d.props.forEach((p, index) => {
		if (p.kind === "chest") {
			drop("chest");
			return;
		}
		if (!FLAT.has(p.kind)) return;
		let x = p.x;
		let y = p.y;
		if (p.kind === "roots") {
			x += p.dx ?? 0;
			y += p.dy ?? 0;
		}
		if (tileAt(d, x, y) !== TileType.FLOOR) {
			drop("notFloor");
			return;
		}
		const why = keptOut(x, y, false, p.kind === "ring");
		if (why !== undefined) {
			drop(why);
			return;
		}
		const c = y * W + x;
		if (flatTaken.has(c)) {
			drop("occupied");
			return;
		}
		flatTaken.add(c);
		const rid = d.roomId[c];
		const group = rid >= 0 && rid < roomCount ? rid : -1;
		const key =
			decorHash01(seed, cellKey(x, y), DECOR_SALT.flat) /
			math.max(flatKindWeight(profile, p.kind), MIN_FLAT_WEIGHT);
		let list = groups.get(group);
		if (list === undefined) {
			list = [];
			groups.set(group, list);
		}
		list.push({ index, x, y, group, key });
	});
	const floorTiles = new Map<number, number>();
	for (let c = 0; c < n; c++) {
		if (d.grid[c] !== TileType.FLOOR) continue;
		const rid = d.roomId[c];
		const g = rid >= 0 && rid < roomCount ? rid : -1;
		floorTiles.set(g, (floorTiles.get(g) ?? 0) + 1);
	}
	const keepFlat = new Set<number>();
	const groupIds: number[] = [];
	for (const [g] of groups) groupIds.push(g);
	stableSort(groupIds, (a, b) => a - b);
	for (const g of groupIds) {
		const list = [...(groups.get(g) ?? [])];
		const cap = math.floor(flatShare * (floorTiles.get(g) ?? 0));
		stableSort(list, (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
		for (let i = 0; i < list.size(); i++) {
			if (i < cap) keepFlat.add(list[i].index);
			else drop("cap");
		}
	}
	const flatOrder: FlatPiece[] = [];
	for (const g of groupIds) for (const fp of groups.get(g) ?? []) if (keepFlat.has(fp.index)) flatOrder.push(fp);
	stableSort(flatOrder, (a, b) => a.index - b.index);
	for (const fp of flatOrder) {
		const p = d.props[fp.index];
		const kind = p.kind as DecorKind;
		const hash = decorHash(seed, cellKey(fp.x, fp.y), DECOR_SALT.variant);
		entries.push({
			kind,
			id: decorId(biome, kind),
			layer: "flat",
			x: gridToWorld(fp.x),
			y: 0,
			z: gridToWorld(fp.y),
			cellX: fp.x,
			cellY: fp.y,
			cells: 1,
			runX: 0,
			runZ: 0,
			faceX: p.dx ?? 0,
			faceZ: p.dy ?? 0,
			roomId: fp.group,
			hash,
			variant: variantOf(input, kind, hash),
			fade: -1,
			light: false,
			lit: false,
			source: "forge",
			forgeIndex: fp.index,
			rot: p.rot,
			scale: p.scale,
		});
	}

	// --- wall pieces ----------------------------------------------------------------------------
	const wallTaken = new Set<number>();
	const hangs: Array<{
		kind: DecorKind;
		x: number;
		y: number;
		dx: number;
		dy: number;
		source: DecorSource;
		index: number;
		rot: number;
		scale: number;
	}> = [];
	d.torches.forEach((t, index) =>
		hangs.push({ kind: "torch", x: t.x, y: t.y, dx: t.dx, dy: t.dy, source: "torch", index, rot: 0, scale: 1 }),
	);
	d.props.forEach((p, index) => {
		if (p.kind === "banner")
			hangs.push({
				kind: "banner",
				x: p.x,
				y: p.y,
				dx: p.dx ?? 0,
				dy: p.dy ?? 0,
				source: "forge",
				index,
				rot: p.rot,
				scale: p.scale,
			});
	});
	for (const h of hangs) {
		const face = visibleFace(d, h.x, h.y, h.dx, h.dy);
		if (face === undefined) {
			drop("hiddenFace");
			continue;
		}
		const c = h.y * W + h.x;
		if (tallCell.has(c)) {
			drop("underTall");
			continue;
		}
		if (wallTaken.has(c)) {
			drop("occupied");
			continue;
		}
		const why = keptOut(h.x, h.y, false, false);
		if (why !== undefined) {
			drop(why);
			continue;
		}
		wallTaken.add(c);
		const [fx, fz] = face;
		const front = (h.y + fz) * W + h.x + fx;
		const rid = d.roomId[front];
		const room = rid >= 0 && rid < roomCount ? rid : -1;
		const hash = decorHash(seed, cellKey(h.x, h.y), DECOR_SALT.variant);
		const light = LIGHTS.has(h.kind);
		entries.push({
			kind: h.kind,
			id: decorId(biome, h.kind),
			layer: "wall",
			x: gridToWorld(h.x) + HALF * fx,
			y: DECOR_PLACE.wallPieceHeightTiles,
			z: gridToWorld(h.y) + HALF * fz,
			cellX: h.x,
			cellY: h.y,
			cells: 1,
			runX: 0,
			runZ: 0,
			faceX: fx,
			faceZ: fz,
			roomId: room,
			hash,
			variant: variantOf(input, h.kind, hash),
			fade: -1,
			light,
			lit: light && decorHash01(seed, cellKey(h.x, h.y), DECOR_SALT.torch) < profile.litTorchShare,
			source: h.source,
			forgeIndex: h.index,
			rot: h.rot,
			scale: h.scale,
		});
	}

	// --- room banners (docs/DECOR.md "Solid decor"): more banners on far walls, only with the pack's art ---------
	// First a banner each side of every throne (docs/DECOR.md "Room themes"), on the wall two cells past its dais' ends
	// (past the candle stands), then up to DECOR_BANNERS.perRoom per other room, spaced from every wall piece.
	if (input.variants !== undefined && input.variants("banner") > 0) {
		const sp = DECOR_BANNERS.spacingTiles;
		const hung: Array<readonly [number, number]> = [];
		for (const c of wallTaken) {
			const gx = c % W;
			hung.push([gx, (c - gx) / W]);
		}
		const hang = (fw: FarWall, r: number) => {
			const c = fw.y * W + fw.x;
			wallTaken.add(c);
			hung.push([fw.x, fw.y]);
			const hash = decorHash(seed, cellKey(fw.x, fw.y), DECOR_SALT.variant);
			entries.push({
				kind: "banner",
				id: decorId(biome, "banner"),
				layer: "wall",
				x: gridToWorld(fw.x) + HALF * fw.fx,
				y: DECOR_PLACE.wallPieceHeightTiles,
				z: gridToWorld(fw.y) + HALF * fw.fz,
				cellX: fw.x,
				cellY: fw.y,
				cells: 1,
				runX: 0,
				runZ: 0,
				faceX: fw.fx,
				faceZ: fw.fz,
				roomId: r,
				hash,
				variant: variantOf(input, "banner", hash),
				fade: -1,
				light: false,
				lit: false,
				source: "dressing",
				forgeIndex: -1,
				rot: 0,
				scale: 1,
			});
		};
		const free = (fw: FarWall) => {
			const c = fw.y * W + fw.x;
			return !wallTaken.has(c) && !tallCell.has(c) && keptOut(fw.x, fw.y, false, false) === undefined;
		};
		for (const piece of d.solidDecor ?? []) {
			if (piece.kind !== "throne" || piece.room < 0 || piece.room >= roomCount) continue;
			const len = piece.fx !== 0 ? piece.h : piece.w;
			for (const along of [-2, len + 1]) {
				// the wall cell behind the dais' back row, `along` cells along it
				const wx = piece.fx !== 0 ? piece.x - piece.fx : piece.x + along;
				const wy = piece.fx !== 0 ? piece.y + along : piece.y - piece.fz;
				const fw = farWalls[piece.room].find(
					(f) => f.x === wx && f.y === wy && f.fx === piece.fx && f.fz === piece.fz,
				);
				if (fw !== undefined && free(fw)) hang(fw, piece.room);
			}
		}
		for (let r = 0; r < roomCount; r++) {
			if (r === d.boss) continue;
			const spots = farWalls[r].filter(free);
			const keyed = spots.map((fw) => ({ fw, h: decorHash(seed, cellKey(fw.x, fw.y), DECOR_SALT.banner) }));
			stableSort(keyed, (a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
			let added = 0;
			for (const { fw } of keyed) {
				if (added >= DECOR_BANNERS.perRoom) break;
				const c = fw.y * W + fw.x;
				if (wallTaken.has(c)) continue;
				let near = false;
				for (const [hx, hy] of hung)
					if (math.abs(hx - fw.x) < sp && math.abs(hy - fw.y) < sp) {
						near = true;
						break;
					}
				if (near) continue;
				hang(fw, r);
				added++;
			}
		}
	}

	// --- solid decor (docs/DECOR.md "Solid decor", "Room themes"), after the wall pieces ---------------------------
	// Dungeon.solidDecor's set pieces stand on their own WALL cells (real obstacles: the footprint rule does not apply,
	// nothing can stand behind them inside their cells), at floor level, faded like any standing piece. A 2 x 1 tomb's
	// box stands at both ends of its run, a rectangle's (throne, statue) at its four corners. Then the carpets, flat.
	// Two bookcases of a run may draw as one wide case (bookcasePairs, docs/KENNEY_DECOR.md KN3): the lower piece index
	// of the pair plans one bookcaseWide entry over both cells, the other none.
	const solidPieces = d.solidDecor ?? [];
	const widePairs = bookcasePairs(solidPieces, input.variants, seed);
	solidPieces.forEach((piece, index) => {
		const partner = widePairs.get(index);
		if (partner !== undefined && partner < index) return;
		const wide = partner !== undefined;
		const other = wide ? solidPieces[partner] : piece;
		const kind: StandingKind = wide ? "bookcaseWide" : piece.kind;
		const rect = piece.w > 1 && piece.h > 1;
		const f: DecorFootprint = {
			x0: math.min(piece.x, other.x),
			y0: math.min(piece.y, other.y),
			x1: math.max(piece.x + piece.w, other.x + other.w) - 1,
			y1: math.max(piece.y + piece.h, other.y + other.h) - 1,
			runX: piece.w > 1 || other.x !== piece.x ? 1 : 0,
			runZ: piece.h > 1 || other.y !== piece.y ? 1 : 0,
		};
		const box = DECOR_BOX[kind];
		const x = (f.x0 + f.x1) / 2;
		const z = (f.y0 + f.y1) / 2;
		fadeBoxes.push({
			entry: entries.size(),
			polygon: boxPolygon(cam, f, box, 0, 0),
			depth: planeDepth(cam, f, box, 0),
		});
		const hash = decorHash(seed, cellKey(f.x0, f.y0), DECOR_SALT.variant);
		const count = input.variants !== undefined ? input.variants(kind) : 0;
		// a tomb's / table's variants: 1 along X, 2 along Z; a throne's / statue's / bookcase's: 1 facing +X, 2 facing +Z;
		// a chair's: 1 facing +X, 2 +Z, 3 -X, 4 -Z (each only when the pack has them all)
		let axisVariant = -1;
		let axisVariants = 2;
		if (kind === "tomb" || kind === "table") axisVariant = piece.w > 1 ? 0 : 1;
		else if (rect && (kind === "throne" || kind === "statue")) axisVariant = piece.fx !== 0 ? 0 : 1;
		else if (kind === "bookcase" || kind === "bookcaseWide") axisVariant = piece.fx !== 0 ? 0 : 1;
		else if (kind === "chair") {
			axisVariants = 4;
			axisVariant = piece.fx > 0 ? 0 : piece.fz > 0 ? 1 : piece.fx < 0 ? 2 : 3;
		}
		let variant = axisVariant >= 0 && count >= axisVariants ? axisVariant : variantOf(input, kind, hash);
		if (kind === "bookcase") {
			// facing pairs, one art set per room (docs/KENNEY_DECOR.md)
			const v = bookcaseVariant(
				count,
				axisVariant,
				decorHash01(seed, piece.room, DECOR_SALT.bookcaseSet),
				decorHash01(seed, cellKey(piece.x, piece.y), DECOR_SALT.bookcaseCell),
			);
			if (v >= 0) variant = v;
		} else if (wide) {
			// facing pairs, the full case most often (DECOR_BOOKCASES)
			const v = wideBookcaseVariant(
				count,
				axisVariant,
				decorHash01(seed, cellKey(f.x0, f.y0), DECOR_SALT.bookcaseWideLook),
			);
			if (v >= 0) variant = v;
		}
		const light = LIGHTS.has(kind);
		entries.push({
			kind,
			id: decorId(biome, kind),
			layer: "low",
			x,
			y: 0,
			z,
			cellX: f.x0,
			cellY: f.y0,
			cells: math.max(f.x1 - f.x0, f.y1 - f.y0) + 1,
			runX: f.runX,
			runZ: f.runZ,
			faceX: piece.fx,
			faceZ: piece.fz,
			roomId: piece.room,
			hash,
			variant,
			fade: fadeBoxes.size() - 1,
			light,
			lit: light,
			source: "solid",
			forgeIndex: -1,
			rot: 0,
			scale: 1,
		});
	});
	if (input.variants !== undefined && input.variants("carpet") > 0)
		for (const cp of d.carpets ?? []) {
			// 2 x 2 segments from the throne outward; variants: 1 along X, 2 along Z, 3 / 4 the end along X / Z
			const len = cp.fx !== 0 ? cp.w : cp.h;
			const count = input.variants("carpet");
			for (let k = 0; k < len; k += 2) {
				// segment k's first cell along the run, counted from the throne
				const along = cp.fx === -1 || cp.fz === -1 ? len - 2 - k : k;
				const sx = cp.fx !== 0 ? cp.x + along : cp.x;
				const sy = cp.fx !== 0 ? cp.y : cp.y + along;
				const last = k + 2 >= len;
				const v = (cp.fx !== 0 ? 0 : 1) + (last ? 2 : 0);
				const hash = decorHash(seed, cellKey(sx, sy), DECOR_SALT.variant);
				entries.push({
					kind: "carpet",
					id: decorId(biome, "carpet"),
					layer: "flat",
					x: sx + HALF,
					y: 0,
					z: sy + HALF,
					cellX: sx,
					cellY: sy,
					cells: 2,
					runX: cp.fx !== 0 ? 1 : 0,
					runZ: cp.fx !== 0 ? 0 : 1,
					faceX: cp.fx,
					faceZ: cp.fz,
					roomId: cp.room,
					hash,
					variant: count > v ? v : variantOf(input, "carpet", hash),
					fade: -1,
					light: false,
					lit: false,
					source: "solid",
					forgeIndex: -1,
					rot: 0,
					scale: 1,
				});
			}
		}

	// --- void set pieces (docs/VOID_DECOR.md VD5) -------------------------------------------------
	if (input.voidPlan !== undefined) addVoidPieces(input, input.voidPlan, seed, profile, entries, fadeBoxes);

	// --- scattered pieces (docs/DECOR.md "3D kits"), appended last --------------------------------
	for (const kind of DECOR_SCATTER.kinds) {
		if (input.variants === undefined || input.variants(kind) <= 0) continue;
		const cellsOf: number[][] = [];
		for (let r = 0; r < roomCount; r++) cellsOf.push([]);
		for (let c = 0; c < n; c++) {
			const rid = d.roomId[c];
			if (rid >= 0 && rid < roomCount && d.grid[c] === TileType.FLOOR) cellsOf[rid].push(c);
		}
		const ct = DECOR_SCATTER.clearTiles;
		const clear = (gx: number, gy: number) => {
			for (let oy = -ct; oy <= ct; oy++)
				for (let ox = -ct; ox <= ct; ox++) if (tileAt(d, gx + ox, gy + oy) !== TileType.FLOOR) return false;
			return true;
		};
		let laid = 0;
		for (let r = 0; r < roomCount && laid < DECOR_SCATTER.maxPerFloor; r++) {
			if (r === d.boss || cellsOf[r].size() < DECOR_SCATTER.minRoomTiles) continue;
			if (decorHash01(seed, r, DECOR_SALT.scatterRoom) >= DECOR_SCATTER.roomShare) continue;
			let best = -1;
			let bestHash = 0;
			for (const c of cellsOf[r]) {
				if (flatTaken.has(c)) continue;
				const gx = c % W;
				const gy = (c - gx) / W;
				if (keptOut(gx, gy, false, false) !== undefined || !clear(gx, gy)) continue;
				const h = decorHash(seed, cellKey(gx, gy), DECOR_SALT.scatterCell);
				if (best < 0 || h < bestHash) {
					best = c;
					bestHash = h;
				}
			}
			if (best < 0) continue;
			flatTaken.add(best);
			laid++;
			const gx = best % W;
			const gy = (best - gx) / W;
			const hash = decorHash(seed, cellKey(gx, gy), DECOR_SALT.variant);
			entries.push({
				kind,
				id: decorId(biome, kind),
				layer: "flat",
				x: gridToWorld(gx),
				y: 0,
				z: gridToWorld(gy),
				cellX: gx,
				cellY: gy,
				cells: 1,
				runX: 0,
				runZ: 0,
				faceX: 0,
				faceZ: 0,
				roomId: r,
				hash,
				variant: variantOf(input, kind, hash),
				fade: -1,
				light: false,
				lit: false,
				source: "scatter",
				forgeIndex: -1,
				rot: 0,
				scale: 1,
			});
		}
	}

	// --- floor patches (docs/KENNEY_DECOR.md KN4), appended last ----------------------------------
	if (input.variants !== undefined && input.variants("patch") > 0) {
		const P = DECOR_PATCHES;
		const floorTiles = new Array<number>(roomCount, 0);
		for (let c = 0; c < n; c++) {
			const rid = d.roomId[c];
			if (rid >= 0 && rid < roomCount && d.grid[c] === TileType.FLOOR) floorTiles[rid]++;
		}
		const rt = P.ringTiles;
		// carpets (whether the pack draws them or not)
		const carpet = new Set<number>();
		for (const cp of d.carpets ?? [])
			for (let yy = cp.y; yy < cp.y + cp.h; yy++)
				for (let xx = cp.x; xx < cp.x + cp.w; xx++) carpet.add(yy * W + xx);
		// a block (gx .. gx + 1, gy .. gy + 1) of room r: it and its ring FLOOR of r with no flat piece or carpet, it not
		// kept out
		const legal = (gx: number, gy: number, r: number): boolean => {
			for (let oy = -rt; oy <= 1 + rt; oy++)
				for (let ox = -rt; ox <= 1 + rt; ox++) {
					const x = gx + ox;
					const y = gy + oy;
					if (tileAt(d, x, y) !== TileType.FLOOR) return false;
					const c = y * W + x;
					if (d.roomId[c] !== r || flatTaken.has(c) || carpet.has(c)) return false;
					if (ox >= 0 && ox <= 1 && oy >= 0 && oy <= 1 && keptOut(x, y, false, false) !== undefined)
						return false;
				}
			return true;
		};
		const blocks: number[][] = [];
		for (let r = 0; r < roomCount; r++) blocks.push([]);
		for (let gy = 0; gy < H - 1; gy++)
			for (let gx = 0; gx < W - 1; gx++) {
				const r = d.roomId[gy * W + gx];
				if (r >= 0 && r < roomCount && legal(gx, gy, r)) blocks[r].push(gy * W + gx);
			}
		for (let r = 0; r < roomCount; r++) {
			let want = 0;
			if (r === d.boss) want = decorHash01(seed, r, DECOR_SALT.patchRoom) < P.bossShare ? P.bossMax : 0;
			else if (floorTiles[r] >= P.minRoomTiles)
				want = math.min(P.maxPerRoom, math.max(1, math.floor(floorTiles[r] / P.tilesPerPatch)));
			const laid: number[] = [];
			while (laid.size() < want) {
				// the lowest block hash not within spacingTiles of a patch already laid here
				let best = -1;
				let bestHash = 0;
				for (const c of blocks[r]) {
					const gx = c % W;
					const gy = (c - gx) / W;
					let near = false;
					for (const o of laid) {
						const ox = o % W;
						const oy = (o - ox) / W;
						if (math.abs(ox - gx) < P.spacingTiles && math.abs(oy - gy) < P.spacingTiles) {
							near = true;
							break;
						}
					}
					if (near) continue;
					const h = decorHash(seed, cellKey(gx, gy), DECOR_SALT.patchBlock);
					if (best < 0 || h < bestHash) {
						best = c;
						bestHash = h;
					}
				}
				if (best < 0) break;
				laid.push(best);
				const gx = best % W;
				const gy = (best - gx) / W;
				for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) flatTaken.add((gy + oy) * W + gx + ox);
				const hash = decorHash(seed, cellKey(gx, gy), DECOR_SALT.variant);
				entries.push({
					kind: "patch",
					id: decorId(biome, "patch"),
					layer: "flat",
					x: gridToWorld(gx) + HALF,
					y: 0,
					z: gridToWorld(gy) + HALF,
					cellX: gx,
					cellY: gy,
					cells: 1,
					runX: 0,
					runZ: 0,
					faceX: 0,
					faceZ: 0,
					roomId: r,
					hash,
					variant: variantOf(input, "patch", hash),
					fade: -1,
					light: false,
					lit: false,
					source: "scatter",
					forgeIndex: -1,
					rot: 0,
					scale: 1,
				});
			}
		}
	}

	// --- per-room lights, counts ----------------------------------------------------------------
	const lightsByRoom: number[][] = [];
	for (let r = 0; r < roomCount; r++) lightsByRoom.push([]);
	const corridorLights: number[] = [];
	const counts: Record<DecorLayer, number> = { flat: 0, low: 0, tall: 0, wall: 0 };
	const voidCounts: Record<DecorLayer, number> = { flat: 0, low: 0, tall: 0, wall: 0 };
	entries.forEach((e, i) => {
		counts[e.layer]++;
		if (e.source === "void") voidCounts[e.layer]++;
		if (!e.light) return;
		if (e.roomId >= 0 && e.roomId < roomCount) lightsByRoom[e.roomId].push(i);
		else corridorLights.push(i);
	});
	return {
		floorSeed: seed,
		floor,
		biome,
		profile,
		entries,
		fadeBoxes,
		lightsByRoom,
		corridorLights,
		dropped,
		counts,
		voidCounts,
	};
}

// ---------------------------------------------------------------------------------------------
// Helpers

/**
 * A bookcase's variant (0-based) among the pack's `count` (docs/KENNEY_DECOR.md, DECOR_BOOKCASES): facing pairs, `axis`
 * 0 facing +X, 1 facing +Z. With two pairs or more, a room whose hash `room01` (0..1) falls under `altRoomShare` draws
 * from the alternative set (pairs 1..): pair 1 when the cell's hash `cell01` falls under `altCommonShare`, else one of the
 * others, evenly; every other room the primary pair 0. One pair: the facing alone, as before the alternative set; no
 * pair: -1 (the caller's hash pick).
 */
export function bookcaseVariant(count: number, axis: number, room01: number, cell01: number): number {
	const pairCount = math.floor(count / 2);
	if (pairCount < 1 || axis < 0) return -1;
	if (pairCount < 2 || room01 >= DECOR_BOOKCASES.altRoomShare) return axis;
	const others = pairCount - 2;
	const common = DECOR_BOOKCASES.altCommonShare;
	let pair = 1;
	if (others > 0 && cell01 >= common)
		pair = 2 + math.min(others - 1, math.floor(((cell01 - common) / (1 - common)) * others));
	return pair * 2 + axis;
}

/**
 * A wide bookcase's variant (0-based) among the pack's `count` bookcaseWide variants (docs/KENNEY_DECOR.md KN3): facing
 * pairs, `axis` 0 facing +X, 1 facing +Z; pair 0 (the full case) when the pair's hash `look01` (0..1) falls under
 * DECOR_BOOKCASES.altCommonShare, else one of the other pairs, evenly. No pair or no axis: -1 (the caller's hash pick).
 */
export function wideBookcaseVariant(count: number, axis: number, look01: number): number {
	const pairCount = math.floor(count / 2);
	if (pairCount < 1 || axis < 0) return -1;
	const others = pairCount - 1;
	const common = DECOR_BOOKCASES.altCommonShare;
	let pair = 0;
	if (others > 0 && look01 >= common)
		pair = 1 + math.min(others - 1, math.floor(((look01 - common) / (1 - common)) * others));
	return pair * 2 + axis;
}

/**
 * Which solid bookcases draw as wide pairs (docs/KENNEY_DECOR.md KN3, KND11; presentation only): piece index -> its
 * partner's index, both ways. Only when the pack has wide art (two bookcaseWide variants or more) and an alternative
 * bookcase set (bookcaseVariant), and only in rooms that draw the alternative set (the primary art has no wide case). A
 * run is the room's bookcases with one facing, consecutive along their wall; each is walked from its low end, and a
 * case with a neighbour after it pairs with it when its cell hash falls under DECOR_BOOKCASES.wideShare (then the walk
 * skips the neighbour). So a pair never spans two runs, a corner or a gap, and every pick is stable per cell.
 */
export function bookcasePairs(
	pieces: ReadonlyArray<SolidDecorPiece>,
	variants: ((kind: DecorKind) => number) | undefined,
	seed: number,
): Map<number, number> {
	const partners = new Map<number, number>();
	if (variants === undefined || math.floor(variants("bookcaseWide") / 2) < 1) return partners;
	const narrow = variants("bookcase");
	if (bookcaseVariant(narrow, 0, 0, 0) < 2) return partners;
	const at = new Map<number, number>();
	pieces.forEach((p, i) => {
		if (p.kind === "bookcase" && p.w === 1 && p.h === 1) at.set(cellKey(p.x, p.y), i);
	});
	const seen = new Set<number>();
	pieces.forEach((p, i) => {
		if (p.kind !== "bookcase" || seen.has(i) || !at.has(cellKey(p.x, p.y))) return;
		// the run: along Z for a case facing +-X, along X for one facing +-Z
		const sx = p.fx !== 0 ? 0 : 1;
		const sy = p.fx !== 0 ? 1 : 0;
		const sameRun = (j: number | undefined): j is number => {
			if (j === undefined) return false;
			const q = pieces[j];
			return q.room === p.room && q.fx === p.fx && q.fz === p.fz;
		};
		let x0 = p.x;
		let y0 = p.y;
		while (sameRun(at.get(cellKey(x0 - sx, y0 - sy)))) {
			x0 -= sx;
			y0 -= sy;
		}
		const run: number[] = [];
		let j = at.get(cellKey(x0, y0));
		let k = 0;
		while (sameRun(j)) {
			run.push(j);
			seen.add(j);
			k++;
			j = at.get(cellKey(x0 + k * sx, y0 + k * sy));
		}
		if (bookcaseVariant(narrow, 0, decorHash01(seed, p.room, DECOR_SALT.bookcaseSet), 0) < 2) return;
		let n = 0;
		while (n + 1 < run.size()) {
			const a = run[n];
			const q = pieces[a];
			if (decorHash01(seed, cellKey(q.x, q.y), DECOR_SALT.bookcaseWide) < DECOR_BOOKCASES.wideShare) {
				partners.set(a, run[n + 1]);
				partners.set(run[n + 1], a);
				n += 2;
			} else n++;
		}
	});
	return partners;
}

function variantOf(input: DecorPlanInput, kind: DecorKind, hash: number): number {
	const count = input.variants !== undefined ? input.variants(kind) : 0;
	return count > 1 ? hash % count : 0;
}

/** The room a Forge piece belongs to: its own roomId, the room of its cell, else of the floor cell it faces. */
function pieceRoom(d: Dungeon, x: number, y: number, roomId?: number, dx?: number, dy?: number): number {
	if (roomId !== undefined && roomId >= 0) return roomId;
	const own = tileAt(d, x, y) !== TileType.VOID ? d.roomId[y * d.W + x] : -1;
	if (own !== undefined && own >= 0) return own;
	if (dx !== undefined && dy !== undefined && (dx !== 0 || dy !== 0)) {
		const fx = x + dx;
		const fy = y + dy;
		if (tileAt(d, fx, fy) === TileType.FLOOR) return d.roomId[fy * d.W + fx];
	}
	return -1;
}

/**
 * The wall face of cell (x, y) a piece hangs on: its Forge face (dx, dy) when the camera sees it (+X or +Z) and a
 * floor cell is in front; else the cell's other visible face onto a floor cell (+X first); else undefined.
 */
function visibleFace(d: Dungeon, x: number, y: number, dx: number, dy: number): readonly [number, number] | undefined {
	if (tileAt(d, x, y) !== TileType.WALL) return undefined;
	if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1))
		if (tileAt(d, x + dx, y + dy) === TileType.FLOOR) return [dx, dy];
	if (tileAt(d, x + 1, y) === TileType.FLOOR) return [1, 0];
	if (tileAt(d, x, y + 1) === TileType.FLOOR) return [0, 1];
	return undefined;
}

/**
 * Straight runs of a room's far-wall cells: cells with the same front direction, consecutive along the wall (front
 * +Z: along x in one row; front +X: along y in one column). Each run in wall order; runs in first-cell order.
 */
function farWallRuns(walls: ReadonlyArray<FarWall>): FarWall[][] {
	const byX: FarWall[] = []; // front +X: the wall runs along y
	const byZ: FarWall[] = []; // front +Z: the wall runs along x
	for (const s of walls) (s.fx === 1 ? byX : byZ).push(s);
	stableSort(byX, (a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
	stableSort(byZ, (a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
	const runs: FarWall[][] = [];
	for (const [list, alongX] of [
		[byZ, true],
		[byX, false],
	] as Array<[FarWall[], boolean]>) {
		let run: FarWall[] = [];
		for (const s of list) {
			const last = run[run.size() - 1];
			const adjacent =
				last !== undefined &&
				(alongX ? s.y === last.y && s.x === last.x + 1 : s.x === last.x && s.y === last.y + 1);
			if (!adjacent && run.size() > 0) {
				runs.push(run);
				run = [];
			}
			run.push(s);
		}
		if (run.size() > 0) runs.push(run);
	}
	return runs;
}

// ---------------------------------------------------------------------------------------------
// Void set pieces (docs/VOID_DECOR.md VD5)

/** decorHash's range (2^32): a hash over it is a fraction in [0, 1). */
const HASH_RANGE = 4294967296;
/** gapOf reads a hash's bits from this one up (the low bits pick variants, the high bits fractions). */
const GAP_SHIFT = 8;
/** The void scans' keys for their first gap's hash (decorHash(seed, key, VOID_PIECES.salt.gap)). */
const COLUMN_SCAN = 1;
const FLAT_SCAN = 2;

/** A scan gap in 1..gapMax from hash `h`'s middle bits. */
function gapOf(h: number, gapMax: number): number {
	return 1 + (bit32.rshift(h, GAP_SHIFT) % gapMax);
}

/** The standard kind a biome void flat piece is planned as (its entry's `kind`: a round flat piece). */
const VOID_FLAT_STAND_IN: DecorKind = "debris";
/** A cell with no room or corridor in reach. */
const NO_ROOM = -2;
/** A cell whose room is not worked out (yet): every value below 0 means "no room" to the placement (-1: a corridor). */
const ROOM_UNSET = -3;
const DX8 = [1, -1, 0, 0, 1, -1, 1, -1];
const DY8 = [0, 0, 1, -1, 1, 1, -1, -1];

/** Cell offsets (dx, dy pairs) whose square comes nearer than `r` to the centre cell's centre (the centre included). */
function offsetsWithin(r: number): number[] {
	const out: number[] = [];
	const k = math.ceil(r);
	for (let oy = -k; oy <= k; oy++)
		for (let ox = -k; ox <= k; ox++) {
			const nx = math.max(0, math.abs(ox) - HALF);
			const ny = math.max(0, math.abs(oy) - HALF);
			if (nx * nx + ny * ny < r * r) out.push(ox, oy);
		}
	return out;
}

/** Cell offsets (dx, dy pairs) whose centre lies nearer than `r` to the centre cell's (the centre included). */
function centresWithin(r: number): number[] {
	const out: number[] = [];
	const k = math.ceil(r);
	for (let oy = -k; oy <= k; oy++) for (let ox = -k; ox <= k; ox++) if (ox * ox + oy * oy < r * r) out.push(ox, oy);
	return out;
}

/** Appends planDecor's void set pieces (see the file comment's `void` rule) to `entries` / `fadeBoxes`. */
function addVoidPieces(
	input: DecorPlanInput,
	vp: VoidPlan,
	seed: number,
	profile: DecorProfile,
	entries: DecorEntry[],
	fadeBoxes: DecorFadeBox[],
): void {
	const d = input.dungeon;
	const W = d.W;
	const H = d.H;
	const n = W * H;
	if (vp.W !== W || vp.H !== H) return;
	const P = VOID_PIECES;
	const cam = DECOR_CAMERA;
	const biome = profile.biome;
	const grid = d.grid;
	const layer = vp.layer;
	const vtop = vp.top;
	const dist = vp.field.dist;
	const roomCount = d.rooms.size();

	// --- the raised cells, from the plan's rects (rect order; no full-grid scan) -----------------------------
	const shoulder: number[] = [];
	const flatCells: number[] = [];
	for (const r of vp.rects) {
		const isShoulder = r.layer === VoidLayer.SHOULDER;
		if (!isShoulder && r.layer !== VoidLayer.LEDGE) continue;
		const lastY = r.y + r.h - 1;
		const lastX = r.x + r.w - 1;
		for (let y = r.y; y <= lastY; y++)
			for (let x = r.x; x <= lastX; x++) {
				const c = y * W + x;
				if (isShoulder) shoulder.push(c);
				flatCells.push(c);
			}
	}
	if (shoulder.size() === 0) return;

	// --- each shoulder cell's room: the nearest floor cell's. A wall's room is its floor neighbour's (a room before a
	// corridor); a shoulder cell next to the walls (field distance 1) takes its walls' room, and every farther one the
	// room of its first neighbour one tile nearer the dungeon (one always exists: the field is a Chebyshev distance), so
	// cells are worked out nearest first (buckets by distance), each from a few neighbour reads, with no BFS queue.
	const room = new Array<number>(n, ROOM_UNSET);
	/** Wall cell j's room: its first floor neighbour's (a room before a corridor: -1), NO_ROOM if none; cached. */
	const wallRoom = (j: number): number => {
		let r = room[j];
		if (r !== ROOM_UNSET) return r;
		r = NO_ROOM;
		const x = j % W;
		const y = (j - x) / W;
		for (let m = 0; m < DX8.size(); m++) {
			const wx = x + DX8[m];
			const wy = y + DY8[m];
			if (wx < 0 || wy < 0 || wx >= W || wy >= H) continue;
			const fj = wy * W + wx;
			const t = grid[fj];
			if (t !== TileType.FLOOR && t !== TileType.POOL) continue;
			const fr = d.roomId[fj];
			r = fr >= 0 && fr < roomCount ? fr : -1;
			if (r >= 0) break;
		}
		room[j] = r;
		return r;
	};
	const byDist: number[][] = [];
	for (const c of shoulder) {
		const k = dist[c];
		while (byDist.size() <= k) byDist.push([]);
		byDist[k].push(c);
	}
	for (let k = 1; k < byDist.size(); k++)
		for (const c of byDist[k]) {
			const x = c % W;
			const y = (c - x) / W;
			let best = NO_ROOM;
			for (let i = 0; i < DX8.size(); i++) {
				const nx = x + DX8[i];
				const ny = y + DY8[i];
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
				const j = ny * W + nx;
				if (k > 1) {
					// copy the first nearer neighbour's room that is worked out (a shoulder cell with a room or corridor)
					if (dist[j] !== k - 1 || room[j] < -1) continue;
					best = room[j];
					break;
				}
				if (grid[j] !== TileType.WALL) continue;
				const r = wallRoom(j);
				if (r >= 0) {
					best = r;
					break;
				}
				if (r === -1) best = -1;
			}
			room[c] = best;
		}

	// --- keep clear of the decor's standing and wall pieces ----------------------------------------
	const nearDecor = new Array<boolean>(n, false);
	const clearOffsets = centresWithin(P.decorClearTiles);
	for (const e of entries) {
		if (e.layer === "flat") continue;
		for (let i = 0; i < math.max(1, e.cells); i++) {
			const cx = e.cellX + i * e.runX;
			const cy = e.cellY + i * e.runZ;
			for (let k = 0; k < clearOffsets.size(); k += 2) {
				const x = cx + clearOffsets[k];
				const y = cy + clearOffsets[k + 1];
				if (x >= 0 && y >= 0 && x < W && y < H) nearDecor[y * W + x] = true;
			}
		}
	}

	// --- biome void kinds the pack has art for ------------------------------------------------------
	const standKinds: VoidDecorKind[] = [];
	const flatVoidKinds: VoidDecorKind[] = [];
	const voidCount = (k: VoidDecorKind) => (input.voidVariants !== undefined ? input.voidVariants(k) : 0);
	for (const k of VOID_DECOR.kinds) {
		if (voidCount(k) <= 0) continue;
		const layers = VOID_DECOR.layers[k] as ReadonlyArray<DecorLayer>;
		if (layers.includes("flat")) flatVoidKinds.push(k);
		else standKinds.push(k);
	}

	// --- entries -----------------------------------------------------------------------------------
	const variantFor = (kind: DecorKind, voidKind: VoidDecorKind | undefined, hash: number) => {
		if (voidKind === undefined) return variantOf(input, kind, hash);
		const count = voidCount(voidKind);
		return count > 1 ? hash % count : 0;
	};
	const ids = new Map<string, string>();
	const idOf = (kind: DecorKind, voidKind: VoidDecorKind | undefined): string => {
		const key = voidKind !== undefined ? `void/${voidKind}` : kind;
		let id = ids.get(key);
		if (id === undefined) {
			id = voidKind !== undefined ? voidDecorId(biome, voidKind) : decorId(biome, kind);
			ids.set(key, id);
		}
		return id;
	};
	const pushVoid = (
		kind: DecorKind,
		voidKind: VoidDecorKind | undefined,
		lay: DecorLayer,
		f: DecorFootprint,
		roomId: number,
		faceX: number,
		faceZ: number,
		top: number,
		hash: number,
	) => {
		let fade = -1;
		let x = gridToWorld(f.x0);
		let z = gridToWorld(f.y0);
		let cells = 1;
		if (lay !== "flat") {
			const a = anchorsOf(f, top);
			x = a.size() === 3 ? a[0] : (a[0] + a[3]) / 2;
			z = a.size() === 3 ? a[2] : (a[2] + a[5]) / 2;
			cells = math.max(math.abs(f.x1 - f.x0), math.abs(f.y1 - f.y0)) + 1;
			const box = DECOR_BOX[kind as StandingKind];
			fadeBoxes.push({
				entry: entries.size(),
				polygon: boxPolygon(cam, f, box, top, 0),
				depth: planeDepth(cam, f, box, top),
			});
			fade = fadeBoxes.size() - 1;
		}
		entries.push({
			kind,
			id: idOf(kind, voidKind),
			layer: lay,
			x,
			y: top,
			z,
			cellX: f.x0,
			cellY: f.y0,
			cells,
			runX: f.runX,
			runZ: f.runZ,
			faceX,
			faceZ,
			roomId: roomId >= 0 ? roomId : -1,
			hash,
			variant: variantFor(kind, voidKind, hash),
			fade,
			light: false,
			lit: false,
			source: "void",
			forgeIndex: -1,
			rot: 0,
			scale: 1,
			voidKind,
		});
	};

	/**
	 * A placed piece's one hash (decorHash costs ~5 us under Lune, so one per piece): its variant and facing (low
	 * bits, as every entry's), whole or broken and a flat piece's kind (its fraction: high bits), and the scan's next gap
	 * (gapOf: middle bits).
	 */
	const pieceHash = (x: number, y: number) => decorHash(seed, cellKey(x, y), P.salt.variant);

	// --- standing pieces ---------------------------------------------------------------------------
	const taken = new Array<boolean>(n, false);
	const placed: Placed[] = [];
	/** Standing void pieces per room (VOID_PIECES.tallPerRoom). */
	const perRoom = new Map<number, number>();
	let standing = 0;
	const spacing2 = P.tallMinSpacing * P.tallMinSpacing;
	/**
	 * VDD2 (docs/VOID_DECOR.md: standing pieces only on a room's far, screen-up side; the camera, at +X +Z, looks toward
	 * -X -Z): marching screen-down along (+1, +1) from every cell of `f` (across the void and the wall), the first
	 * walkable cell (floor, pool) is room `roomId`'s, within the cell's field distance + 1 + VOID_PIECES.farSideSlackTiles
	 * steps (so the room lies in front of it, toward the camera), and no walkable cell lies screen-up of it along
	 * (-1, -1) within nearSideReachTiles (so it stands on no room's camera side either).
	 */
	const farSide = (f: DecorFootprint, len: number, roomId: number): boolean => {
		for (let i = 0; i < len; i++) {
			const x = f.x0 + i * f.runX;
			const y = f.y0 + i * f.runZ;
			// across the void and the wall: the cell's field distance, one more step onto the floor, and the slack
			const limit = dist[y * W + x] + 1 + P.farSideSlackTiles;
			let front = false;
			for (let k = 1; k <= limit; k++) {
				const nx = x + k;
				const ny = y + k;
				if (nx >= W || ny >= H) break;
				const j = ny * W + nx;
				const t = grid[j];
				if (t !== TileType.FLOOR && t !== TileType.POOL) continue;
				front = d.roomId[j] === roomId;
				break;
			}
			if (!front) return false;
			for (let k = 1; k <= P.nearSideReachTiles; k++) {
				const nx = x - k;
				const ny = y - k;
				if (nx < 0 || ny < 0) break;
				const t = grid[ny * W + nx];
				if (t === TileType.FLOOR || t === TileType.POOL) return false;
			}
		}
		return true;
	};
	/** The surface top `f` stands on if it is legal for `kind` (see the file comment), else undefined; marks it taken. */
	const tryStand = (f: DecorFootprint, kind: StandingKind, roomId: number): number | undefined => {
		if (standing >= P.maxStanding || roomId < 0 || (perRoom.get(roomId) ?? 0) >= P.tallPerRoom) return undefined;
		const len = math.max(math.abs(f.x1 - f.x0), math.abs(f.y1 - f.y0)) + 1;
		let top: number | undefined;
		for (let i = 0; i < len; i++) {
			const x = f.x0 + i * f.runX;
			const y = f.y0 + i * f.runZ;
			if (x < 0 || y < 0 || x >= W || y >= H) return undefined;
			const c = y * W + x;
			if (layer[c] !== VoidLayer.SHOULDER || taken[c] || nearDecor[c]) return undefined;
			if (top === undefined) top = vtop[c];
			else if (vtop[c] !== top) return undefined;
		}
		if (top === undefined || !farSide(f, len, roomId)) return undefined;
		const ax0 = math.min(f.x0, f.x1);
		const ax1 = math.max(f.x0, f.x1);
		const ay0 = math.min(f.y0, f.y1);
		const ay1 = math.max(f.y0, f.y1);
		for (const p of placed) {
			const dx = math.max(0, p.x0 - ax1, ax0 - p.x1);
			const dy = math.max(0, p.y0 - ay1, ay0 - p.y1);
			if (dx * dx + dy * dy < spacing2) return undefined;
		}
		// footprintClear(d, f, DECOR_BOX[kind], cam, top), with the stencil's cells read straight off the grid
		const st = footprintStencil(f, DECOR_BOX[kind], cam, top);
		for (let i = 0; i < st.size(); i += 2) {
			const x = f.x0 + st[i];
			const y = f.y0 + st[i + 1];
			if (x < 0 || y < 0 || x >= W || y >= H) continue; // outside the grid: VOID, which stops bullets
			if (!isBulletBlockingTile(grid[y * W + x] as TileType)) return undefined;
		}
		for (let i = 0; i < len; i++) taken[(f.y0 + i * f.runZ) * W + f.x0 + i * f.runX] = true;
		placed.push({ x0: ax0, y0: ay0, x1: ax1, y1: ay1 });
		perRoom.set(roomId, (perRoom.get(roomId) ?? 0) + 1);
		standing++;
		return top;
	};

	// columns (or biome void kinds) at hashed gaps along the scan: the first gap from its own hash, each next one
	// from the piece just placed (no hash on a cell that is skipped or refused). No wall props in the void
	// (docs/VOID_DECOR.md VDD10): no ruin runs (`wall` / `wallBroken`), no curbs.
	const columnGapMax = math.max(1, 2 * P.columnGap - 1);
	let gap = gapOf(decorHash(seed, COLUMN_SCAN, P.salt.gap), columnGapMax);
	for (const c of shoulder) {
		if (standing >= P.maxStanding) break;
		const dc = dist[c];
		if (dc < P.columnMinDist || dc > P.columnMaxDist || room[c] < 0 || taken[c] || nearDecor[c]) continue;
		gap--;
		if (gap > 0) continue;
		const x = c % W;
		const y = (c - x) / W;
		let voidKind: VoidDecorKind | undefined;
		if (standKinds.size() > 0) {
			const h = decorHash01(seed, c, P.salt.biome);
			if (h < P.biomeShare) voidKind = standKinds[math.floor((h / P.biomeShare) * standKinds.size())];
		}
		const tall =
			voidKind === undefined || (VOID_DECOR.layers[voidKind] as ReadonlyArray<DecorLayer>).includes("tall");
		const boxKind: StandingKind = tall ? "column" : "columnBroken";
		const f: DecorFootprint = { x0: x, y0: y, x1: x, y1: y, runX: 0, runZ: 0 };
		const top = tryStand(f, boxKind, room[c]);
		if (top === undefined) continue; // the gap stays spent: the next eligible cell tries
		const h = pieceHash(x, y);
		gap = gapOf(h, columnGapMax);
		// face the wall: the 4-neighbour nearest the dungeon (first on a tie)
		let fx = 0;
		let fz = 0;
		let best = dc;
		for (let k = 0; k < 4; k++) {
			const nx = x + DX8[k];
			const ny = y + DY8[k];
			if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
			const dn = dist[ny * W + nx];
			if (dn < best) {
				best = dn;
				fx = DX8[k];
				fz = DY8[k];
			}
		}
		if (voidKind !== undefined) {
			pushVoid(boxKind, voidKind, tall ? "tall" : "low", f, room[c], fx, fz, top, h);
			continue;
		}
		const broken = h / HASH_RANGE < profile.columnBrokenShare;
		pushVoid(broken ? "columnBroken" : "column", undefined, broken ? "low" : "tall", f, room[c], fx, fz, top, h);
	}

	// --- flat pieces at hashed gaps along the scan ---------------------------------------------------
	const flatLimit = math.min(P.maxFlat, math.floor(P.flatShare * shoulder.size()));
	const patch = offsetsWithin(P.flatRadiusTiles);
	const spaced = centresWithin(P.flatMinSpacing);
	/** Cells a new flat piece may not take: within flatMinSpacing of one placed (and standing cells). */
	const flatBlocked = taken;
	const baseKinds = P.flatKinds as ReadonlyArray<DecorKind>;
	const biomeKinds = (P.biomeFlatKinds[biome] ?? []) as ReadonlyArray<DecorKind>;
	const flatGapMax = math.max(1, 2 * P.flatGap - 1);
	let flats = 0;
	gap = gapOf(decorHash(seed, FLAT_SCAN, P.salt.gap), flatGapMax);
	const kindsHere: DecorKind[] = [];
	for (const c of flatCells) {
		if (flats >= flatLimit) break;
		if (flatBlocked[c]) continue;
		gap--;
		if (gap > 0) continue;
		const x = c % W;
		const y = (c - x) / W;
		const l = layer[c];
		const t = vtop[c];
		let fits = true;
		for (let k = 0; k < patch.size() && fits; k += 2) {
			const px = x + patch[k];
			const py = y + patch[k + 1];
			if (px < 0 || py < 0 || px >= W || py >= H) fits = false;
			else {
				const j = py * W + px;
				fits = layer[j] === l && vtop[j] === t;
			}
		}
		if (!fits) continue; // the gap stays spent: the next eligible cell tries
		const h = pieceHash(x, y);
		gap = gapOf(h, flatGapMax);
		kindsHere.clear();
		for (const k of baseKinds) kindsHere.push(k);
		for (const k of biomeKinds) kindsHere.push(k);
		if (l === VoidLayer.SHOULDER && room[c] >= 0 && dist[c] <= P.flagstoneMaxDist) kindsHere.push("flagstones");
		// standard kinds first, then the biome void flat kinds (index past the standard ones)
		const pick = math.floor((h / HASH_RANGE) * (kindsHere.size() + flatVoidKinds.size()));
		const f: DecorFootprint = { x0: x, y0: y, x1: x, y1: y, runX: 0, runZ: 0 };
		if (pick < kindsHere.size()) pushVoid(kindsHere[pick], undefined, "flat", f, room[c], 0, 0, t, h);
		else pushVoid(VOID_FLAT_STAND_IN, flatVoidKinds[pick - kindsHere.size()], "flat", f, room[c], 0, 0, t, h);
		for (let k = 0; k < spaced.size(); k += 2) {
			const px = x + spaced[k];
			const py = y + spaced[k + 1];
			if (px >= 0 && py >= 0 && px < W && py < H) flatBlocked[py * W + px] = true;
		}
		flats++;
	}
}
