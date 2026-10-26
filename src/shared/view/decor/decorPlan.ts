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
 *   dressing   R6: per room, after its Forge pieces and under the same caps and rules: `wall` segments
 *              (DECOR_DRESSING.segmentTiles cells) on straight far-wall runs of at least minRunTiles, spaced
 *              TALL_MIN_SPACING apart and centred on the run (longest runs first); then `column`s on the room's back
 *              corners, its doorway jambs and the middle of its short runs.
 *   pillars    D2: a solid pillar (an endless floor's `pillar` prop on a WALL cell) is a real wall: it never moves
 *              to a far wall and is never a floor prop. It gets the low `columnBroken` stump on its own top where the
 *              footprint rule allows (with the stump's box), else only the wall material (dropped here).
 *   flat       debris, bones, crack, moss, roots (moved onto the floor cell its breach faces), ring, bossCrystal,
 *              shrineCrystal lie where the Forge put them, on FLOOR, one per cell, at most profile.flatShare (never
 *              above MAX_DECOR_SHARE) of their room's floor tiles (corridors count as one group); a full room keeps
 *              the pieces with the lowest decorHash / weight (the band's clutter weight for bones and debris).
 *   wall       torches (Dungeon.torches) and banners hang only on a wall face the camera sees (+X or +Z; a piece on a
 *              hidden face moves to the cell's visible face onto a floor cell, if it has one), one per cell, never on
 *              a cell carrying a tall piece. Torches light by the band (litTorchShare, by cell hash).
 *   profile    R8 (./profile.ts): the band's shares swap `pillar` / `column` for `columnBroken` and `wall` for
 *              `wallBroken` on legal spots (the broken boxes lie inside the whole ones, so a legal spot stays legal),
 *              cap and weight the flat clutter, and light torches. It never adds a piece or touches a Forge param.
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
	type WorldXZ,
} from "shared/dungeon";
import { stableSort } from "shared/jsmath";
import { decorId, type BiomeId, type DecorKind, type DecorLayer } from "shared/theme";
import { BULLET_VIEW, GAME_WORLD } from "../config";
import { floorClearanceStuds } from "../sprites";
import type { IsoBasis } from "../iso";
import { DECOR_CLEAR, DECOR_DRESSING, DECOR_PLACE, DECOR_SALT } from "./config";
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
	| "columnBroken";

/** Where an entry comes from: a Forge prop, a Forge torch, R6 far-wall dressing, or a solid pillar's stump. */
export type DecorSource = "forge" | "torch" | "dressing" | "pillar";

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
	| "underTall";

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
	 * (y 0), wall the face's centre at DECOR_PLACE.wallPieceHeightTiles.
	 */
	readonly x: number;
	readonly y: number;
	readonly z: number;
	/** The grid cell it stands / lies / hangs on (a segment: its first cell). */
	readonly cellX: number;
	readonly cellY: number;
	/** Cells it covers along (runX, runZ): 1, or DECOR_DRESSING.segmentTiles for a wall segment. */
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
	/** Index into Dungeon.props (forge, pillar) or Dungeon.torches (torch); -1 for dressing. */
	readonly forgeIndex: number;
	/** The Forge's rotation (radians) and scale; 0 and 1 for dressing. */
	readonly rot: number;
	readonly scale: number;
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

/** The anchors a footprint's box stands on: its cell's top centre, or a segment's two outer ends. */
function anchorsOf(f: DecorFootprint, top: number): number[] {
	if (f.x0 === f.x1 && f.y0 === f.y1) return [f.x0, top, f.y0];
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
 * box `box` standing on footprint `f`'s wall top if that cell were bullet-open (see the file comment). Exact: each
 * candidate cell's projected square (at BULLET_Y) is clipped against the padded box; a cell hides a bullet when
 * anything is left that is not inside the wall block's silhouette by the pad (or the cell is not behind the block
 * at all). The geometry only depends on the box and the footprint's shape, never on where it stands, so the answer
 * is a fixed list of offsets (cached per shape for the game camera).
 */
export function footprintStencil(
	f: DecorFootprint,
	box: DecorBoxPx,
	cam: IsoBasis = DECOR_CAMERA,
	top: number = GAME_WORLD.wallHeightTiles,
): ReadonlyArray<number> {
	const rel: DecorFootprint = { x0: 0, y0: 0, x1: f.x1 - f.x0, y1: f.y1 - f.y0, runX: f.runX, runZ: f.runZ };
	const shared = cam === DECOR_CAMERA && top === GAME_WORLD.wallHeightTiles;
	const key = `${box.w}/${box.h}/${box.below}/${box.x ?? 0}/${rel.x1}/${rel.y1}/${rel.runX}/${rel.runZ}`;
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

/** DecorFootprint stencils of the game camera, by box and footprint shape (see footprintStencil). */
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

	/** Why (gx, gy) is kept clear, or undefined. */
	const keptOut = (
		gx: number,
		gy: number,
		ignoreDoor: boolean,
		ignoreEntrance: boolean,
	): DecorDropReason | undefined => {
		if (!ignoreDoor && nearDoor[gy * W + gx]) return "doorway";
		if (breakable.has(cellKey(gx, gy))) return "breakable";
		const x = gridToWorld(gx);
		const z = gridToWorld(gy);
		for (const zn of zones) {
			if (ignoreEntrance && zn.entrance) continue;
			if ((x - zn.x) * (x - zn.x) + (z - zn.z) * (z - zn.z) < zn.r2) return "interactable";
		}
		return undefined;
	};

	// --- solid pillars and far walls --------------------------------------------------------------
	const solidPillar = new Set<number>();
	for (const p of d.props)
		if (p.kind === "pillar" && tileAt(d, p.x, p.y) === TileType.WALL) solidPillar.add(p.y * W + p.x);
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
	/** `column` / `pillar` -> `columnBroken`, `wall` -> `wallBroken` by the band's share (cell hash). */
	const swapped = (kind: StandingKind, gx: number, gy: number): StandingKind => {
		if (kind === "pillar" || kind === "column")
			return decorHash01(seed, cellKey(gx, gy), DECOR_SALT.column) < profile.columnBrokenShare
				? "columnBroken"
				: kind;
		if (kind === "wall")
			return decorHash01(seed, cellKey(gx, gy), DECOR_SALT.wall) < profile.wallBrokenShare ? "wallBroken" : kind;
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

	// 2. R6 far-wall dressing, room by room
	for (let room = 0; room < roomCount; room++) {
		if (tallInRoom[room] >= MAX_TALL_PER_ROOM) continue;
		const walls = farWalls[room];
		const free = walls.filter((s) => keptOut(s.x, s.y, false, false) === undefined);
		const runs = farWallRuns(free);
		// segments, longest runs first
		const seg = DECOR_DRESSING.segmentTiles;
		const gap = TALL_MIN_SPACING - 1;
		const order = [...runs];
		stableSort(order, (a, b) => b.size() - a.size());
		for (const run of order) {
			if (run.size() < DECOR_DRESSING.minRunTiles) continue;
			const count = math.floor((run.size() + gap) / (seg + gap));
			const used = count * seg + (count - 1) * gap;
			let at = math.floor((run.size() - used) / 2);
			for (let k = 0; k < count; k++) {
				const a = run[at];
				const b = run[at + seg - 1];
				at += seg + gap;
				const f: DecorFootprint = { x0: a.x, y0: a.y, x1: b.x, y1: b.y, runX: a.fz, runZ: a.fx };
				if (!tryTall(f, "wall", room, false)) continue;
				const kind = swapped("wall", a.x, a.y);
				pushStanding(kind, layerOf(kind), f, room, a.fx, a.fz, "dressing", -1, 0, 1);
			}
		}
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

	// --- per-room lights, counts ----------------------------------------------------------------
	const lightsByRoom: number[][] = [];
	for (let r = 0; r < roomCount; r++) lightsByRoom.push([]);
	const corridorLights: number[] = [];
	const counts: Record<DecorLayer, number> = { flat: 0, low: 0, tall: 0, wall: 0 };
	entries.forEach((e, i) => {
		counts[e.layer]++;
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
	};
}

// ---------------------------------------------------------------------------------------------
// Helpers

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
