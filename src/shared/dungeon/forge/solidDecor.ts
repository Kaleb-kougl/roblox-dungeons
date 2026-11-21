/**
 * Kaleb-Vale (not in the original Dungeon Forge): solid decor and room themes, Diablo-style dressing that is also
 * gameplay (docs/DECOR.md "Solid decor" and "Room themes"). With ForgeParams.solidDecor, after all decoration and solid
 * pillars, every room draws a theme and its set pieces' cells become WALL: they block movement, bullets and sight like
 * any wall, and the decor plan draws their art on them instead of a wall block.
 *
 *   boss       "throne": the throne on its dais (4 x 2) against a far wall, as centred as it gets at least
 *              centreDoorTiles from the doors, a candle stand each side of it, a 2-wide red carpet (flat, walkable:
 *              Dungeon.carpets) up to 16 tiles from the dais toward the arena, candle pairs along the carpet outside the arena's middle, and a brazier each side of every
 *              doorway, inside.
 *   shrine     "shrine": the statue on its round base (3 x 3) against a far wall, clear of the shrine, candles each
 *              side.
 *   entrance   "entrance": a brazier each side of every doorway, inside.
 *   combat /   one of (themeWeights; graveyard rooms are always crypts, frozen-lake rooms are left bare):
 *   elite        crypt   3-4 tombs (2 x 1; 5-6 in big rooms) lying along the walls, each with a candle stand at one or both ends, and
 *                        in big rooms maybe one free-standing tomb in the middle, candles past both ends;
 *                hall    candle stands lining the walls every few tiles, maybe a run of bookcases on a far wall, and in
 *                        big rooms maybe a statue on a far wall;
 *                library runs of bookcases (1 x 1 each) end to end against the far walls, candle stands at their ends,
 *                        then a reading area where one fits (a free-standing study table, 2 x 2, its long axis
 *                        parallel to the first run, about reading.readingDist and at most reading.maxDist from the
 *                        nearest case, clearing the solid pillars under it and its ring back to floor; no draw), then
 *                        a lectern flush against the wall at one end of the room's long axis with a carpet runner
 *                        (1 wide, Dungeon.carpets) from it down the room (no draw), in big rooms maybe a second
 *                        study table beside the runner, display cases (2 x 1) by room size beside the runner, and
 *                        maybe a toppled case (2 x 1, low) near a run (docs/KENNEY_DECOR.md KN6); a room where no run
 *                        fits is dressed as plain instead;
 *                mess    a mess hall: barrel stacks (2 x 1) flush on any wall, then dining tables (1 x 1) free-standing
 *                        in a loose grid at least mess.tableSpacing apart (KN7); a room where nothing fits is dressed
 *                        as plain instead;
 *                store   solid stock (barrel stacks, crate stacks, lumber, lying barrels) flush in its corners first,
 *                        then along its walls, and in big rooms maybe a stockpile (2 x 2, tall) in a corner (KN8); its
 *                        breakables cluster in its corners after (breakables.ts);
 *                plain   maybe one tomb along a wall, and in big rooms maybe a free-standing one.
 *
 * Every piece against a wall sits flush with it (all cells behind its back row are non-floor) and keeps every cell
 * within clearTiles of its open sides floor of its room (past its ends the back line may be wall too, where the wall
 * curves or steps: the piece then touches it), so it only ever widens the wall: paths beside and in front stay at
 * least two tiles wide. Free-standing pieces (a centre tomb, a study table, a display case, a toppled case, a dining
 * table) keep the ring on every side and stand on no carpet; the Kenney ones (all but the tomb) may cover solid
 * pillars of the room with it, which are cleared (back to floor, or under the piece; Dungeon.clearedPillars), the
 * fewest a spot can (a dining table on a pillar's own cell takes its place as cover). A corner piece (store stock)
 * keeps the ring on its two open sides, the whole line beside each of its two walled sides a real wall (not a piece or
 * a pillar); a lectern, a barrel stack and store stock along a wall stand against a real wall too. Nothing stands
 * within doorTiles of a doorway except the door braziers, which flank the opening in the wall's own row. A bookcase stands only on a far wall (its front to the camera), with
 * `bookcase.backTiles` of non-walkable cells behind it (its top rises over the wall on screen and must never stand over
 * another floor) and never in front of a wall cell holding a torch or a banner (the `hangs` the Forge placed before).
 * The caller re-floods and takes every piece back if the floor ever split (the spec checks it never does on the census
 * floors).
 *
 * Its own stream (makeRng(seed ^ SOLID_DECOR.salt)), so the main stream, and with it every room, corridor, prop,
 * spawn, torch, pool and the name, are exactly the option-off floor's. Rooms in id order.
 *
 * @module
 */
import { makeRng, type Rng } from "./rng";
import { RoomType, TileType, type Room } from "./types";

/** The solid set pieces the pass can place. Every cell of a piece becomes WALL. */
export type SolidDecorKind =
	| "tomb"
	| "candelabrum"
	| "throne"
	| "statue"
	| "brazier"
	| "bookcase"
	| "table"
	| "chair"
	| "studyTable"
	| "display"
	| "lectern"
	| "fallenShelf"
	| "diningTable"
	| "barrelStack"
	| "crateStack"
	| "lumber"
	| "barrelHeap"
	| "stockpile";

/** A room's dressing theme (Dungeon.roomThemes, by room id). "none": treasure rooms, lakes, option off. */
export type RoomTheme =
	| "none"
	| "entrance"
	| "throne"
	| "shrine"
	| "crypt"
	| "hall"
	| "store"
	| "plain"
	| "library"
	| "mess";

/** One solid decor piece: its kind and its cells (x .. x + w - 1, y .. y + h - 1), all WALL on the floor. */
export interface SolidDecorPiece {
	/** What stands there. */
	readonly kind: SolidDecorKind;
	/** Lowest column of its cells. */
	readonly x: number;
	/** Lowest row of its cells. */
	readonly y: number;
	/** Cells along x. */
	readonly w: number;
	/** Cells along y. */
	readonly h: number;
	/** The id of the room it stands in. */
	readonly room: number;
	/**
	 * Facing into the room for a piece against a wall ((1, 0) / (0, 1) on far walls, negative on near walls; a corner
	 * piece: off one of its two walls); a lectern: the way it faces, down its runner; a study table, display case or
	 * toppled case: its long axis ((1, 0) along X, (0, 1) along Z); else 0. ("table" / "chair", the reading line before
	 * the study table, are no longer placed: docs/KENNEY_DECOR.md KND12.)
	 */
	readonly fx: number;
	/** The facing's z part (grid y). */
	readonly fz: number;
}

/**
 * A carpet run (flat, walkable): its cells, laid in 2-tile segments from its head along (fx, fz), the last the end: the
 * throne's (2 wide, 2 x 2 segments) or a library's runner (1 wide, from its lectern).
 */
export interface DecorCarpet {
	/** Lowest column of its cells. */
	readonly x: number;
	/** Lowest row of its cells. */
	readonly y: number;
	/** Cells along x. */
	readonly w: number;
	/** Cells along y. */
	readonly h: number;
	/** The direction it is laid in from its head, x part. */
	readonly fx: number;
	/** The direction it is laid in from its head, z part (grid y). */
	readonly fz: number;
	/** The id of the room it lies in. */
	readonly room: number;
}

/** What the solid decor pass placed on one floor; `generate` copies it onto the Dungeon. */
export interface SolidDecorLayout {
	/** Every piece, rooms in id order (Dungeon.solidDecor). */
	readonly pieces: SolidDecorPiece[];
	/** Every carpet run (Dungeon.carpets). */
	readonly carpets: DecorCarpet[];
	/**
	 * Solid pillar cells a free-standing piece took (docs/BOOKSHELVES.md, docs/KENNEY_DECOR.md): back to FLOOR in its
	 * ring, or under the piece. Their pillar props stay in Dungeon.props; the decor plan draws nothing for them.
	 */
	readonly clearedPillars: Array<{ readonly x: number; readonly y: number }>;
	/** By room id. */
	readonly themes: RoomTheme[];
}

/**
 * The solid decor pass's tunables: its rng salt and the distances, sizes and chances of its placement rules. Changing
 * one changes every floor generated with ForgeParams.solidDecor.
 */
export const SOLID_DECOR = {
	salt: 0x7f4a7c15,
	/** Random spots tried per free-standing cluster. */
	tries: 24,
	/** Every cell within this many tiles of a piece's open sides is floor of its room. */
	clearTiles: 2,
	/** No piece cell within this many tiles of a doorway (door braziers excepted). */
	doorTiles: 3,
	/** A throne or a statue goes to the most centred wall spot at least this far from every doorway (if any). */
	centreDoorTiles: 6,
	/** Rooms with at least this many floor tiles are big: a free-standing tomb, a hall's statue. */
	bigRoomTiles: 320,
	/** The tomb's length; a free-standing tomb's candles stand candleGap cells of floor past each end. */
	tombLength: 2,
	candleGap: 1,
	/** Every cell within this many tiles of a free-standing candle is floor of its room (but its own tomb's). */
	candleClearTiles: 2,
	/** Combat / elite room themes by biome (grim favours crypts; docs/KENNEY_DECOR.md "Mess hall"). */
	themeWeights: {
		grim: { crypt: 0.37, hall: 0.18, store: 0.14, plain: 0.11, library: 0.12, mess: 0.08 },
		other: { crypt: 0.17, hall: 0.17, store: 0.17, plain: 0.17, library: 0.2, mess: 0.12 },
	},
	crypt: { tombsMin: 3, tombsMax: 4, bigExtra: 2, bothCandles: 0.5, centreShare: 0.5 },
	plain: { wallShare: 0.55, centreShare: 0.3 },
	hall: { candleSpacing: 5, maxCandles: 16, statueShare: 0.5, shelfShare: 0.5, shelfMin: 2, shelfMax: 3 },
	/** A bookcase (1 x 1, far walls only): this many non-walkable cells behind its back (docs/BOOKSHELVES.md BKD5). */
	bookcase: { backTiles: 2 },
	/**
	 * Library rooms: runsMin..runsMax runs (+bigExtra in big rooms) of runMin..runMax cases end to end, at most maxCases
	 * a room, runs at least runGap floor cells apart; a candle stand at one or both ends (bothCandles). (The statue roll
	 * is gone: the lectern took its place, docs/KENNEY_DECOR.md KN6; statues stay in halls.)
	 */
	library: {
		runsMin: 2,
		runsMax: 3,
		bigExtra: 1,
		runMin: 2,
		runMax: 5,
		maxCases: 16,
		runGap: 3,
		bothCandles: 0.5,
	},
	/**
	 * A library's reading area: a study table tableSize x tableSize (its chairs drawn with it, KND12), its long axis
	 * parallel to the room's first run, free-standing (clearTiles of floor all round, doorTiles from every doorway), where
	 * it and its ring may cover the room's solid pillars (they go back to floor). Its nearest bookcase (Chebyshev, cell to
	 * cell) at most maxDist away; its spot: the one whose nearest case is closest to readingDist away, then the one
	 * clearing the fewest pillars, then the one nearest the room centre, first in cell order on ties (no draw). In big
	 * rooms with a runner, a second study table with secondShare, besideMin..besideMax (Chebyshev) from the runner,
	 * its long axis along it (as every later free-standing piece: a spot clearing the fewest pillars, drawn).
	 */
	reading: { tableSize: 2, readingDist: 4, maxDist: 8, secondShare: 0.5, besideMin: 2, besideMax: 3 },
	/**
	 * A library's runner (1 wide, walkable): from a lectern (1 x 1) flush against the wall at one end of the room's long
	 * axis, facing down it, in `segment`-tile segments while every cell is floor of the room, no carpet, more than
	 * doorTiles from every doorway and one more floor cell lies past it; minSegments..maxSegments. The lectern spot: the
	 * longest runner, then the one nearest the room's middle across the axis, first in cell order (no draw).
	 */
	runner: { segment: 2, minSegments: 2, maxSegments: 6 },
	/**
	 * Library display cases (length x 1, free-standing): one in rooms of oneTiles floor tiles, two in twoTiles; with a
	 * runner, its long axis along the runner and besideMin..besideMax (Chebyshev) from it, else (or when none fits
	 * there) anywhere in the room.
	 */
	display: { length: 2, oneTiles: 200, twoTiles: 320, besideMin: 2, besideMax: 3 },
	/** A toppled bookcase (length x 1, low, free-standing) in `share` of libraries, at most maxDist from a bookcase. */
	fallenShelf: { length: 2, share: 0.4, maxDist: 3 },
	/**
	 * Mess halls: stacksMin..stacksMax barrel stacks (stackLength x 1) flush on any wall, then tablesMin..tablesMax
	 * dining tables (bigTablesMax in big rooms), 1 x 1 free-standing, each tableSpacing (Chebyshev) from every other:
	 * on a lattice of pitch tableSpacing (its offset drawn per room) where a cell there is free, else anywhere free.
	 */
	mess: {
		stacksMin: 1,
		stacksMax: 2,
		stackLength: 2,
		tablesMin: 3,
		tablesMax: 6,
		bigTablesMax: 8,
		tableSpacing: 4,
	},
	/**
	 * Storerooms: piecesMin..piecesMax stock pieces of `kinds` (a barrel stack stackLength x 1, the others 1 x 1), in a
	 * corner (walls on two sides) when one fits, else flush along a wall; before them, in big rooms with stockpileShare,
	 * a stockpile (stockpileSize square, tall) in a corner with `bookcase.backTiles` of non-walkable cells behind any
	 * far-wall side (its top rises over that wall on screen).
	 */
	store: {
		piecesMin: 1,
		piecesMax: 3,
		kinds: ["barrelStack", "crateStack", "lumber", "barrelHeap"],
		stackLength: 2,
		stockpileShare: 0.5,
		stockpileSize: 2,
	},
	throne: { length: 4, depth: 2, carpetWidth: 2, carpetMaxSegments: 8, candleRowStep: 5, arenaClear: 7 },
	statue: { size: 3, shrineClear: 3 },
} as const;

const { FLOOR } = TileType;
const WALL = TileType.WALL;

/** A rect of cells x .. x + w - 1, y .. y + h - 1. */
interface Rect {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/** A spot: the rect and its facing (or long axis). */
interface Spot extends Rect {
	readonly fx: number;
	readonly fz: number;
}

/** A free-standing piece's shape: its size and its long axis. */
interface Shape {
	readonly w: number;
	readonly h: number;
	readonly fx: number;
	readonly fz: number;
}

/** A piece `len` long and one wide, along X or along Z (fx / fz its long axis). */
function lineShapes(len: number): Shape[] {
	return [
		{ w: len, h: 1, fx: 1, fz: 0 },
		{ w: 1, h: len, fx: 0, fz: 1 },
	];
}

/** Chebyshev distance, cell to cell, between two rects (0 when they touch or overlap). */
function rectGap(a: Rect, b: Rect): number {
	return math.max(a.x - (b.x + b.w - 1), b.x - (a.x + a.w - 1), a.y - (b.y + b.h - 1), b.y - (a.y + a.h - 1), 0);
}

const FACES_FAR: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[0, 1],
];
const FACES_ALL: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[0, 1],
	[-1, 0],
	[0, -1],
];
/** A runner along X / Z: its lectern faces +X / +Z (far wall) or -X / -Z. */
const FACES_RUN_X: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[-1, 0],
];
const FACES_RUN_Z: ReadonlyArray<readonly [number, number]> = [
	[0, 1],
	[0, -1],
];

/**
 * Places the solid decor and room themes, writing WALL into `grid` for every piece (see the file comment). `grid`,
 * `roomId` and `doorway` are the Forge's arrays (y * W + x).
 */
export function placeSolidDecor(
	seed: number,
	W: number,
	H: number,
	grid: number[],
	roomId: ReadonlyArray<number>,
	doorway: ReadonlyArray<number>,
	rooms: ReadonlyArray<Room>,
	grim: boolean,
	boss: number,
	hangs: ReadonlyArray<{ readonly x: number; readonly y: number }> = [],
	pillars: ReadonlyArray<{ readonly x: number; readonly y: number }> = [],
): SolidDecorLayout {
	const rng = makeRng((seed ^ SOLID_DECOR.salt) >>> 0);
	/** Wall cells holding a torch or a banner: no bookcase stands in front of them. */
	const hung = new Set<number>();
	for (const h of hangs) hung.add(h.y * W + h.x);
	/** Solid pillar cells (WALL, in their room's footprint): a free-standing piece may clear them. */
	const pillarAt = new Set<number>();
	for (const p of pillars) pillarAt.add(p.y * W + p.x);
	const clearedPillars: Array<{ readonly x: number; readonly y: number }> = [];
	const pieces: SolidDecorPiece[] = [];
	const carpets: DecorCarpet[] = [];
	const themes = new Array<RoomTheme>(rooms.size(), "none");
	const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
	const floorOf = (x: number, y: number, rid: number) =>
		inB(x, y) && grid[y * W + x] === FLOOR && roomId[y * W + x] === rid;
	const solid = (x: number, y: number) => !inB(x, y) || grid[y * W + x] !== FLOOR;
	/** Every cell of x0..x1, y0..y1 is floor of room `rid`. */
	const allFloor = (x0: number, y0: number, x1: number, y1: number, rid: number) => {
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!floorOf(x, y, rid)) return false;
		return true;
	};
	const doorDist = (x0: number, y0: number, x1: number, y1: number, r: number) => {
		for (let d = 0; d <= r; d++)
			for (let y = y0 - d; y <= y1 + d; y++)
				for (let x = x0 - d; x <= x1 + d; x++) if (inB(x, y) && doorway[y * W + x] !== 0) return d;
		return r + 1;
	};
	/** Cells walled by a piece placed so far. */
	const pieceAt = new Set<number>();
	const wall = (kind: SolidDecorKind, s: Spot, rid: number) => {
		for (let yy = s.y; yy < s.y + s.h; yy++)
			for (let xx = s.x; xx < s.x + s.w; xx++) {
				grid[yy * W + xx] = WALL;
				pieceAt.add(yy * W + xx);
			}
		pieces.push({ kind, x: s.x, y: s.y, w: s.w, h: s.h, room: rid, fx: s.fx, fz: s.fz });
	};
	/** A real wall cell (or outside the grid): solid, and neither a piece nor a solid pillar. */
	const realWall = (x: number, y: number) =>
		!inB(x, y) || (solid(x, y) && !pieceAt.has(y * W + x) && !pillarAt.has(y * W + x));
	/** Carpet cells (walkable): no later piece stands on one. */
	const carpetAt = new Set<number>();
	const layCarpet = (c: DecorCarpet) => {
		carpets.push(c);
		for (let yy = c.y; yy < c.y + c.h; yy++) for (let xx = c.x; xx < c.x + c.w; xx++) carpetAt.add(yy * W + xx);
	};
	const onCarpet = (s: Rect) => {
		for (let yy = s.y; yy < s.y + s.h; yy++)
			for (let xx = s.x; xx < s.x + s.w; xx++) if (carpetAt.has(yy * W + xx)) return true;
		return false;
	};
	/** The spot with its back row flush against a wall: `len` cells along the wall, `depth` into the room. */
	const spotAt = (x: number, y: number, len: number, depth: number, fx: number, fz: number): Spot =>
		fx !== 0 ? { x, y, w: depth, h: len, fx, fz } : { x, y, w: len, h: depth, fx, fz };
	/** Every cell behind the spot's back row is solid (it stands flush), and the open sides keep `clear` of floor. */
	const flushOk = (s: Spot, clear: number, rid: number, doorR: number) => {
		const x1 = s.x + s.w - 1;
		const y1 = s.y + s.h - 1;
		if (s.fx === 1) {
			for (let y = s.y; y <= y1; y++) if (!solid(s.x - 1, y)) return false;
		} else if (s.fx === -1) {
			for (let y = s.y; y <= y1; y++) if (!solid(x1 + 1, y)) return false;
		} else if (s.fz === 1) {
			for (let x = s.x; x <= x1; x++) if (!solid(x, s.y - 1)) return false;
		} else {
			for (let x = s.x; x <= x1; x++) if (!solid(x, y1 + 1)) return false;
		}
		const xa = s.fx === 1 ? s.x : s.x - clear;
		const xb = s.fx === -1 ? x1 : x1 + clear;
		const ya = s.fz === 1 ? s.y : s.y - clear;
		const yb = s.fz === -1 ? y1 : y1 + clear;
		for (let y = ya; y <= yb; y++)
			for (let x = xa; x <= xb; x++) {
				if (floorOf(x, y, rid)) continue;
				// past the ends, the back line may be wall (a curved or stepped wall): the piece touches it, no gap
				const inSpan = x >= s.x && x <= x1 && y >= s.y && y <= y1;
				const backLine =
					(s.fx === 1 && x === s.x) ||
					(s.fx === -1 && x === x1) ||
					(s.fz === 1 && y === s.y) ||
					(s.fz === -1 && y === y1);
				if (inSpan || !backLine) return false;
				// ... but only as one solid run from the piece's end: floor between them would be a one-tile pinch
				if (s.fx !== 0) {
					const from = y < s.y ? y + 1 : y1 + 1;
					const to = y < s.y ? s.y - 1 : y - 1;
					for (let yy = from; yy <= to; yy++) if (floorOf(x, yy, rid)) return false;
				} else {
					const from = x < s.x ? x + 1 : x1 + 1;
					const to = x < s.x ? s.x - 1 : x - 1;
					for (let xx = from; xx <= to; xx++) if (floorOf(xx, y, rid)) return false;
				}
			}
		return doorR < 0 || doorDist(s.x, s.y, x1, y1, doorR) > doorR;
	};
	/** Every wall-attached spot of a room for a len x depth piece facing one of `faces`, in cell order. */
	const spotsOf = (
		r: Room,
		len: number,
		depth: number,
		faces: ReadonlyArray<readonly [number, number]>,
		clear: number,
	): Spot[] => {
		const out: Spot[] = [];
		const x0 = math.ceil(r.cx - r.w / 2) - 1;
		const x1 = math.floor(r.cx + r.w / 2) + 1;
		const y0 = math.ceil(r.cy - r.h / 2) - 1;
		const y1 = math.floor(r.cy + r.h / 2) + 1;
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++)
				for (const [fx, fz] of faces) {
					const s = spotAt(x, y, len, depth, fx, fz);
					if (flushOk(s, clear, r.id, SOLID_DECOR.doorTiles)) out.push(s);
				}
		return out;
	};
	/** The cell `along` cells along the wall from the spot's first back cell (negative: before it), in its back row. */
	const alongCell = (s: Spot, along: number): readonly [number, number] => {
		const bx = s.fx === -1 ? s.x + s.w - 1 : s.x;
		const by = s.fz === -1 ? s.y + s.h - 1 : s.y;
		return s.fx !== 0 ? [bx, s.y + along] : [s.x + along, by];
	};
	/** The room's cell bounds, one cell past its rect on every side. */
	const boundsOf = (r: Room): LuaTuple<[number, number, number, number]> =>
		$tuple(
			math.ceil(r.cx - r.w / 2) - 1,
			math.floor(r.cx + r.w / 2) + 1,
			math.ceil(r.cy - r.h / 2) - 1,
			math.floor(r.cy + r.h / 2) + 1,
		);
	/** A solid pillar of room `rid` still standing: a free-standing piece may clear it (docs/BOOKSHELVES.md). */
	const standingPillar = (x: number, y: number, rid: number) =>
		inB(x, y) && pillarAt.has(y * W + x) && grid[y * W + x] === WALL && roomId[y * W + x] === rid;
	/**
	 * A free-standing spot: its cells and every cell within clearTiles of them floor of the room or one of its solid
	 * pillars (cleared when the piece is placed), none of its cells on a carpet, more than doorTiles from every doorway.
	 * The number of pillars it would clear, or -1 when it does not fit.
	 */
	const freeCost = (s: Rect, rid: number): number => {
		const ct = SOLID_DECOR.clearTiles;
		const dr = SOLID_DECOR.doorTiles;
		if (onCarpet(s) || doorDist(s.x, s.y, s.x + s.w - 1, s.y + s.h - 1, dr) <= dr) return -1;
		let n = 0;
		for (let yy = s.y - ct; yy <= s.y + s.h - 1 + ct; yy++)
			for (let xx = s.x - ct; xx <= s.x + s.w - 1 + ct; xx++) {
				if (floorOf(xx, yy, rid)) continue;
				if (!standingPillar(xx, yy, rid)) return -1;
				n++;
			}
		return n;
	};
	/**
	 * The free-standing spots of a room for one of `shapes` that `keep` accepts and that clear the fewest solid pillars,
	 * in cell order, then shape order.
	 */
	const freeSpotsOf = (r: Room, shapes: ReadonlyArray<Shape>, keep?: (s: Spot) => boolean): Spot[] => {
		let out: Spot[] = [];
		let best = math.huge;
		const [x0, x1, y0, y1] = boundsOf(r);
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++)
				for (const sh of shapes) {
					const s: Spot = { x, y, w: sh.w, h: sh.h, fx: sh.fx, fz: sh.fz };
					const cost = freeCost(s, r.id);
					if (cost < 0 || cost > best || (keep !== undefined && !keep(s))) continue;
					if (cost < best) {
						best = cost;
						out = [];
					}
					out.push(s);
				}
		return out;
	};
	/** Places a free-standing piece: the solid pillars under it and in its ring go first (clearedPillars). */
	const placeFree = (kind: SolidDecorKind, s: Spot, rid: number) => {
		const ct = SOLID_DECOR.clearTiles;
		for (let yy = s.y - ct; yy <= s.y + s.h - 1 + ct; yy++)
			for (let xx = s.x - ct; xx <= s.x + s.w - 1 + ct; xx++)
				if (standingPillar(xx, yy, rid)) {
					grid[yy * W + xx] = FLOOR;
					clearedPillars.push({ x: xx, y: yy });
				}
		wall(kind, s, rid);
	};
	/** Every cell behind a wall-attached spot's back row is a real wall (not another piece or a solid pillar). */
	const backReal = (s: Spot) => {
		const n = s.fx !== 0 ? s.h : s.w;
		for (let k = 0; k < n; k++) {
			const [cx, cy] = alongCell(s, k);
			if (!realWall(cx - s.fx, cy - s.fz)) return false;
		}
		return true;
	};
	/**
	 * A spot walled on `solids` sides (unit directions out of the piece): the whole line of cells beside it on each is
	 * a real wall; every cell of it and within clearTiles of its other sides is floor of the room; none on a carpet; more than
	 * doorTiles from every doorway. So no floor cell beside it is walled in on its far side: no new pinch.
	 */
	const boxOk = (s: Rect, solids: ReadonlyArray<readonly [number, number]>, rid: number) => {
		const ct = SOLID_DECOR.clearTiles;
		const dr = SOLID_DECOR.doorTiles;
		const x1 = s.x + s.w - 1;
		const y1 = s.y + s.h - 1;
		let xa = s.x - ct;
		let xb = x1 + ct;
		let ya = s.y - ct;
		let yb = y1 + ct;
		for (const [dx, dy] of solids) {
			if (dx === -1) {
				xa = s.x;
				for (let y = s.y; y <= y1; y++) if (!realWall(s.x - 1, y)) return false;
			} else if (dx === 1) {
				xb = x1;
				for (let y = s.y; y <= y1; y++) if (!realWall(x1 + 1, y)) return false;
			} else if (dy === -1) {
				ya = s.y;
				for (let x = s.x; x <= x1; x++) if (!realWall(x, s.y - 1)) return false;
			} else {
				yb = y1;
				for (let x = s.x; x <= x1; x++) if (!realWall(x, y1 + 1)) return false;
			}
		}
		if (!allFloor(xa, ya, xb, yb, rid) || onCarpet(s)) return false;
		return doorDist(s.x, s.y, x1, y1, dr) > dr;
	};
	/**
	 * Every corner spot of a room for a len x depth piece: its back row flush against a wall (facing into the room, any
	 * of the four ways) and one end against another (boxOk on those two sides), that `keep` accepts, in cell order.
	 */
	const cornerSpotsOf = (
		r: Room,
		len: number,
		depth: number,
		keep?: (s: Spot, solids: ReadonlyArray<readonly [number, number]>) => boolean,
	): Spot[] => {
		const out: Spot[] = [];
		const [x0, x1, y0, y1] = boundsOf(r);
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++)
				for (const [fx, fz] of FACES_ALL) {
					const s = spotAt(x, y, len, depth, fx, fz);
					const ends: ReadonlyArray<readonly [number, number]> = fx !== 0 ? FACES_RUN_Z : FACES_RUN_X;
					for (const [ex, ez] of ends) {
						const solids: ReadonlyArray<readonly [number, number]> = [
							[-fx, -fz],
							[-ex, -ez],
						];
						if (boxOk(s, solids, r.id) && (keep === undefined || keep(s, solids))) {
							out.push(s);
							break;
						}
					}
				}
		return out;
	};
	/**
	 * The candle stands flush against the same wall beside a piece, at each `along` that fits: checked BEFORE the piece
	 * is walled (its cells still floor), with the full clearance on the candle's own open sides, so the candle touches
	 * the piece and leaves no pinch anywhere else.
	 */
	const flankSpots = (s: Spot, alongs: ReadonlyArray<number>, rid: number): Spot[] => {
		const out: Spot[] = [];
		for (const along of alongs) {
			const [cx, cy] = alongCell(s, along);
			const c = spotAt(cx, cy, 1, 1, s.fx, s.fz);
			if (flushOk(c, SOLID_DECOR.clearTiles, rid, SOLID_DECOR.doorTiles)) out.push(c);
		}
		return out;
	};
	const placeFlanks = (spots: Spot[], rid: number) => {
		for (const c of spots) wall("candelabrum", c, rid);
	};
	/**
	 * The wall spot best centred on its wall's middle among those at least centreDoorTiles from every doorway (else
	 * the one farthest from the doors), first in cell order on ties (deterministic).
	 */
	const centredSpot = (r: Room, spots: Spot[], minFromCentre: number): Spot | undefined => {
		const want = SOLID_DECOR.centreDoorTiles;
		let best: Spot | undefined;
		let bestScore = -math.huge;
		for (const s of spots) {
			const midX = s.x + (s.w - 1) / 2;
			const midY = s.y + (s.h - 1) / 2;
			const fromCentre = math.max(math.abs(midX - r.cx), math.abs(midY - r.cy));
			if (fromCentre < minFromCentre) continue;
			const off = s.fx !== 0 ? math.abs(midY - r.cy) : math.abs(midX - r.cx);
			const door = doorDist(s.x, s.y, s.x + s.w - 1, s.y + s.h - 1, want);
			// far enough from the doors: as centred as it gets; else the farther from the doors, the better
			const score = door > want ? 1000 - off : door * 10 - off;
			if (score > bestScore) {
				bestScore = score;
				best = s;
			}
		}
		return best;
	};
	/** A free-standing tomb with candles past both ends (the first solid decor rule), somewhere in the room. */
	const centreTomb = (r: Room) => {
		const L = SOLID_DECOR.tombLength;
		const ct = SOLID_DECOR.clearTiles;
		const alongX = rng.chance(0.5);
		const w = alongX ? L : 1;
		const h = alongX ? 1 : L;
		const xMin = math.ceil(r.cx - r.w / 2) + ct;
		const xMax = math.floor(r.cx + r.w / 2) - ct - (w - 1);
		const yMin = math.ceil(r.cy - r.h / 2) + ct;
		const yMax = math.floor(r.cy + r.h / 2) - ct - (h - 1);
		if (xMax < xMin || yMax < yMin) return;
		const step = SOLID_DECOR.candleGap + 1;
		for (let t = 0; t < SOLID_DECOR.tries; t++) {
			const x = rng.i(xMin, xMax);
			const y = rng.i(yMin, yMax);
			if (!allFloor(x - ct, y - ct, x + w - 1 + ct, y + h - 1 + ct, r.id)) continue;
			if (doorDist(x, y, x + w - 1, y + h - 1, SOLID_DECOR.doorTiles) <= SOLID_DECOR.doorTiles) continue;
			wall("tomb", { x, y, w, h, fx: 0, fz: 0 }, r.id);
			const ends = alongX
				? [
						[x - step, y],
						[x + w - 1 + step, y],
				  ]
				: [
						[x, y - step],
						[x, y + h - 1 + step],
				  ];
			const cr = SOLID_DECOR.candleClearTiles;
			const ownTomb = (xx: number, yy: number) => xx >= x && xx < x + w && yy >= y && yy < y + h;
			for (const [cx, cy] of ends) {
				let ok = doorDist(cx, cy, cx, cy, SOLID_DECOR.doorTiles) > SOLID_DECOR.doorTiles;
				for (let yy = cy - cr; yy <= cy + cr && ok; yy++)
					for (let xx = cx - cr; xx <= cx + cr && ok; xx++)
						if (!floorOf(xx, yy, r.id) && !ownTomb(xx, yy)) ok = false;
				if (ok) wall("candelabrum", { x: cx, y: cy, w: 1, h: 1, fx: 0, fz: 0 }, r.id);
			}
			return;
		}
	};
	/** A tomb lying along a wall (random spot), with a candle stand at one or both ends. */
	const wallTomb = (r: Room, bothShare: number): boolean => {
		const spots = spotsOf(r, SOLID_DECOR.tombLength, 1, FACES_ALL, SOLID_DECOR.clearTiles);
		if (spots.size() === 0) return false;
		const s = rng.pick(spots);
		const both = rng.chance(bothShare);
		const first = rng.chance(0.5);
		const alongs: number[] = [];
		if (both || first) alongs.push(-1);
		if (both || !first) alongs.push(SOLID_DECOR.tombLength);
		const flanks = flankSpots(s, alongs, r.id);
		wall("tomb", s, r.id);
		placeFlanks(flanks, r.id);
		return true;
	};
	/** The statue on its base against a far wall, best centred, candles each side; false when nothing fits. */
	const statue = (r: Room, minFromCentre: number): boolean => {
		const n = SOLID_DECOR.statue.size;
		const s = centredSpot(r, spotsOf(r, n, n, FACES_FAR, SOLID_DECOR.clearTiles), minFromCentre);
		if (s === undefined) return false;
		const flanks = flankSpots(s, [-1, n], r.id);
		wall("statue", s, r.id);
		placeFlanks(flanks, r.id);
		return true;
	};
	/** A brazier each side of every doorway of the room, flush with the wall beside the opening. */
	const doorBraziers = (r: Room) => {
		const taken = new Set<number>();
		const x0 = math.ceil(r.cx - r.w / 2) - 1;
		const x1 = math.floor(r.cx + r.w / 2) + 1;
		const y0 = math.ceil(r.cy - r.h / 2) - 1;
		const y1 = math.floor(r.cy + r.h / 2) + 1;
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				if (!floorOf(x, y, r.id)) continue;
				for (const [ox, oy] of FACES_ALL) {
					// (x, y) is a threshold cell when the cell outward is a doorway
					const dx = x + ox;
					const dy = y + oy;
					if (!inB(dx, dy) || doorway[dy * W + dx] === 0) continue;
					for (const side of [-1, 1]) {
						const bx = x + side * oy;
						const by = y + side * ox;
						const key = by * W + bx;
						if (taken.has(key) || !floorOf(bx, by, r.id)) continue;
						// flush: the cell outward of it is wall (not the opening), and it is no threshold itself
						const wx = bx + ox;
						const wy = by + oy;
						if (!solid(wx, wy) || (inB(wx, wy) && doorway[wy * W + wx] !== 0)) continue;
						let threshold = false;
						for (const [px, py] of FACES_ALL) {
							const nx = bx + px;
							const ny = by + py;
							if (inB(nx, ny) && doorway[ny * W + nx] !== 0) threshold = true;
						}
						if (threshold) continue;
						// the room side of it stays floor (no pinch against another piece or a jog of the wall)
						const s = spotAt(bx, by, 1, 1, ox === 0 ? 0 : -ox, oy === 0 ? 0 : -oy);
						if (!flushOk(s, SOLID_DECOR.clearTiles, r.id, -1)) continue;
						taken.add(key);
						wall("brazier", s, r.id);
					}
				}
			}
	};
	/** The boss room's throne, carpet and candles; false when no wall spot fits. */
	const throne = (r: Room): boolean => {
		const T = SOLID_DECOR.throne;
		const s = centredSpot(r, spotsOf(r, T.length, T.depth, FACES_FAR, SOLID_DECOR.clearTiles), T.arenaClear);
		if (s === undefined) return false;
		const flanks = flankSpots(s, [-1, T.length], r.id);
		wall("throne", s, r.id);
		placeFlanks(flanks, r.id);
		// the carpet: 2 x 2 segments from the dais front along the facing, while the floor holds and a row is left
		const off = (T.length - T.carpetWidth) / 2;
		const [ax, ay] = alongCell(s, off);
		// first carpet cell: the dais front row + 1
		const fx0 = ax + s.fx * T.depth;
		const fy0 = ay + s.fz * T.depth;
		let segs = 0;
		while (segs < T.carpetMaxSegments) {
			let ok = true;
			for (let d = 0; d < 2 + 2 && ok; d++)
				for (let a = 0; a < T.carpetWidth && ok; a++) {
					const k = segs * 2 + d;
					const cx = fx0 + s.fx * k + (s.fx !== 0 ? 0 : a);
					const cy = fy0 + s.fz * k + (s.fx !== 0 ? a : 0);
					// the segment's two rows are floor, and so are the two rows past it (a row of floor at the end)
					if (!floorOf(cx, cy, r.id)) ok = false;
				}
			if (!ok) break;
			segs++;
		}
		if (segs > 0) {
			const len = segs * 2;
			const cx0 = s.fx === -1 ? fx0 - (len - 1) : fx0;
			const cy0 = s.fz === -1 ? fy0 - (len - 1) : fy0;
			const w = s.fx !== 0 ? len : T.carpetWidth;
			const h = s.fx !== 0 ? T.carpetWidth : len;
			layCarpet({ x: cx0, y: cy0, w, h, fx: s.fx, fz: s.fz, room: r.id });
			// candle pairs one cell outside the carpet's edges, every candleRowStep rows, outside the arena's middle
			for (let k = T.candleRowStep - T.depth; k < len; k += T.candleRowStep) {
				for (const a of [-2, T.carpetWidth + 1]) {
					const cx = fx0 + s.fx * k + (s.fx !== 0 ? 0 : a);
					const cy = fy0 + s.fz * k + (s.fx !== 0 ? a : 0);
					if (math.max(math.abs(cx - r.cx), math.abs(cy - r.cy)) < T.arenaClear) continue;
					const cr = SOLID_DECOR.clearTiles;
					if (!allFloor(cx - cr, cy - cr, cx + cr, cy + cr, r.id)) continue;
					if (doorDist(cx, cy, cx, cy, SOLID_DECOR.doorTiles) <= SOLID_DECOR.doorTiles) continue;
					wall("candelabrum", { x: cx, y: cy, w: 1, h: 1, fx: 0, fz: 0 }, r.id);
				}
			}
		}
		return true;
	};
	/** Candle stands flush against the walls, at least candleSpacing apart, in cell order. */
	const hallCandles = (r: Room) => {
		const H2 = SOLID_DECOR.hall;
		const placed: Array<readonly [number, number]> = [];
		for (const s of spotsOf(r, 1, 1, FACES_ALL, SOLID_DECOR.clearTiles)) {
			if (placed.size() >= H2.maxCandles) break;
			if (!flushOk(s, SOLID_DECOR.clearTiles, r.id, SOLID_DECOR.doorTiles)) continue;
			let near = false;
			for (const [px, py] of placed)
				if (math.max(math.abs(px - s.x), math.abs(py - s.y)) < H2.candleSpacing) near = true;
			if (near) continue;
			wall("candelabrum", s, r.id);
			placed.push([s.x, s.y]);
		}
	};

	/**
	 * A far-wall run spot (depth 1) a bookcase run may take: `backTiles` non-walkable cells behind every cell, no torch or
	 * banner on the wall cell right behind, and at least `runGap` floor cells from every earlier run of the room.
	 */
	const shelfOk = (s: Spot, runs: ReadonlyArray<Spot>): boolean => {
		const n = s.fx !== 0 ? s.h : s.w;
		for (let k = 0; k < n; k++) {
			const [cx, cy] = alongCell(s, k);
			for (let d = 1; d <= SOLID_DECOR.bookcase.backTiles; d++) {
				const bx = cx - s.fx * d;
				const by = cy - s.fz * d;
				if (inB(bx, by) && (grid[by * W + bx] === FLOOR || grid[by * W + bx] === TileType.POOL)) return false;
				if (d === 1 && inB(bx, by) && hung.has(by * W + bx)) return false;
			}
		}
		const gap = SOLID_DECOR.library.runGap;
		for (const o of runs) {
			const between = math.max(
				o.x - (s.x + s.w - 1),
				s.x - (o.x + o.w - 1),
				o.y - (s.y + s.h - 1),
				s.y - (o.y + o.h - 1),
			);
			if (between - 1 < gap) return false;
		}
		return true;
	};
	/**
	 * A run of bookcases end to end against a far wall: the longest of want..min cases that fits (one flushOk spot of the
	 * whole run, so no new pinch), picked at random, with candle stands at one or both ends (bothShare). Returns the
	 * cases placed.
	 */
	const bookcaseRun = (r: Room, min: number, want: number, bothShare: number, runs: Spot[]): number => {
		for (let n = want; n >= min; n--) {
			const spots: Spot[] = [];
			for (const s of spotsOf(r, n, 1, FACES_FAR, SOLID_DECOR.clearTiles)) if (shelfOk(s, runs)) spots.push(s);
			if (spots.size() === 0) continue;
			const s = rng.pick(spots);
			const both = rng.chance(bothShare);
			const first = rng.chance(0.5);
			const alongs: number[] = [];
			if (both || first) alongs.push(-1);
			if (both || !first) alongs.push(n);
			const flanks = flankSpots(s, alongs, r.id);
			for (let k = 0; k < n; k++) {
				const [cx, cy] = alongCell(s, k);
				wall("bookcase", spotAt(cx, cy, 1, 1, s.fx, s.fz), r.id);
			}
			placeFlanks(flanks, r.id);
			runs.push(s);
			return n;
		}
		return 0;
	};
	/**
	 * A library's reading area (SOLID_DECOR.reading): a study table, its long axis parallel to the first run, in front of
	 * the shelves; the solid pillars under it and its ring go back to floor. No draw. False when no spot fits.
	 */
	const readingArea = (r: Room, firstRun: Spot): boolean => {
		const R = SOLID_DECOR.reading;
		const ct = SOLID_DECOR.clearTiles;
		const dr = SOLID_DECOR.doorTiles;
		// a run facing +X / -X lies along Z: so does the table
		const alongX = firstRun.fx === 0;
		const w = R.tableSize;
		const h = R.tableSize;
		const cases: Array<readonly [number, number]> = [];
		for (const p of pieces) if (p.room === r.id && p.kind === "bookcase") cases.push([p.x, p.y]);
		const x0 = math.ceil(r.cx - r.w / 2) - 1;
		const x1 = math.floor(r.cx + r.w / 2) + 1;
		const y0 = math.ceil(r.cy - r.h / 2) - 1;
		const y1 = math.floor(r.cy + r.h / 2) + 1;
		/** A solid pillar of this room (still standing): clearable. */
		const pillarOf = (x: number, y: number) => standingPillar(x, y, r.id);
		let best: readonly [number, number] | undefined;
		let bestOff = math.huge;
		let bestCleared = math.huge;
		let bestCentre = math.huge;
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				const xe = x + w - 1;
				const ye = y + h - 1;
				let near = math.huge;
				for (const [px, py] of cases) {
					const d = math.max(math.max(x - px, px - xe, 0), math.max(y - py, py - ye, 0));
					if (d < near) near = d;
				}
				if (near > R.maxDist) continue;
				// the line and its ring: floor of the room, or a solid pillar of it (cleared)
				let cleared = 0;
				let ok = true;
				for (let yy = y - ct; yy <= ye + ct && ok; yy++)
					for (let xx = x - ct; xx <= xe + ct && ok; xx++) {
						if (floorOf(xx, yy, r.id)) continue;
						if (pillarOf(xx, yy)) cleared++;
						else ok = false;
					}
				if (!ok || doorDist(x, y, xe, ye, dr) <= dr) continue;
				const off = math.abs(near - R.readingDist);
				const mx = x + (w - 1) / 2 - r.cx;
				const my = y + (h - 1) / 2 - r.cy;
				const centre = mx * mx + my * my;
				if (
					off < bestOff ||
					(off === bestOff && (cleared < bestCleared || (cleared === bestCleared && centre < bestCentre)))
				) {
					best = [x, y];
					bestOff = off;
					bestCleared = cleared;
					bestCentre = centre;
				}
			}
		if (best === undefined) return false;
		const [bx, by] = best;
		for (let yy = by - ct; yy <= by + h - 1 + ct; yy++)
			for (let xx = bx - ct; xx <= bx + w - 1 + ct; xx++)
				if (pillarOf(xx, yy)) {
					grid[yy * W + xx] = FLOOR;
					clearedPillars.push({ x: xx, y: yy });
				}
		wall("studyTable", { x: bx, y: by, w, h, fx: alongX ? 1 : 0, fz: alongX ? 0 : 1 }, r.id);
		return true;
	};
	/**
	 * A library's lectern and runner (SOLID_DECOR.runner): the lectern flush against the wall at one end of the room's
	 * long axis, facing down it, the runner laid from it. No draw. The runner, or undefined when no spot fits.
	 */
	const lecternRunner = (r: Room): DecorCarpet | undefined => {
		const RN = SOLID_DECOR.runner;
		const dr = SOLID_DECOR.doorTiles;
		const alongX = r.w >= r.h;
		let best: Spot | undefined;
		let bestSegs = 0;
		let bestOff = math.huge;
		for (const s of spotsOf(r, 1, 1, alongX ? FACES_RUN_X : FACES_RUN_Z, SOLID_DECOR.clearTiles)) {
			if (!backReal(s)) continue;
			let segs = 0;
			while (segs < RN.maxSegments) {
				let ok = true;
				// the segment's cells, and one more cell of floor past it
				for (let k = 1; k <= RN.segment + 1 && ok; k++) {
					const cx = s.x + s.fx * (segs * RN.segment + k);
					const cy = s.y + s.fz * (segs * RN.segment + k);
					if (!floorOf(cx, cy, r.id) || carpetAt.has(cy * W + cx)) ok = false;
					else if (k <= RN.segment && doorDist(cx, cy, cx, cy, dr) <= dr) ok = false;
				}
				if (!ok) break;
				segs++;
			}
			if (segs < RN.minSegments) continue;
			const off = alongX ? math.abs(s.y - r.cy) : math.abs(s.x - r.cx);
			if (segs > bestSegs || (segs === bestSegs && off < bestOff)) {
				best = s;
				bestSegs = segs;
				bestOff = off;
			}
		}
		if (best === undefined) return undefined;
		wall("lectern", best, r.id);
		const len = bestSegs * RN.segment;
		const fx0 = best.x + best.fx;
		const fy0 = best.y + best.fz;
		const runner: DecorCarpet = {
			x: best.fx === -1 ? fx0 - (len - 1) : fx0,
			y: best.fz === -1 ? fy0 - (len - 1) : fy0,
			w: best.fx !== 0 ? len : 1,
			h: best.fx !== 0 ? 1 : len,
			fx: best.fx,
			fz: best.fz,
			room: r.id,
		};
		layCarpet(runner);
		return runner;
	};
	/** The shape of a piece `len` long whose long axis runs along the runner. */
	const alongRunner = (runner: DecorCarpet, len: number, depth: number): Shape =>
		runner.fx !== 0 ? { w: len, h: depth, fx: 1, fz: 0 } : { w: depth, h: len, fx: 0, fz: 1 };
	/** A big library's second study table beside its runner (SOLID_DECOR.reading); false when none fits. */
	const secondStudyTable = (r: Room, runner: DecorCarpet): boolean => {
		const R = SOLID_DECOR.reading;
		const spots = freeSpotsOf(r, [alongRunner(runner, R.tableSize, R.tableSize)], (s) => {
			const g = rectGap(s, runner);
			return g >= R.besideMin && g <= R.besideMax;
		});
		if (spots.size() === 0) return false;
		placeFree("studyTable", rng.pick(spots), r.id);
		return true;
	};
	/** A library's display case (SOLID_DECOR.display), beside the runner when one fits there; false when none fits. */
	const displayCase = (r: Room, runner: DecorCarpet | undefined): boolean => {
		const D = SOLID_DECOR.display;
		let spots: Spot[] = [];
		if (runner !== undefined)
			spots = freeSpotsOf(r, [alongRunner(runner, D.length, 1)], (s) => {
				const g = rectGap(s, runner);
				return g >= D.besideMin && g <= D.besideMax;
			});
		if (spots.size() === 0) spots = freeSpotsOf(r, lineShapes(D.length));
		if (spots.size() === 0) return false;
		placeFree("display", rng.pick(spots), r.id);
		return true;
	};
	/** A toppled bookcase near one of the room's cases (SOLID_DECOR.fallenShelf); false when none fits. */
	const fallenShelf = (r: Room): boolean => {
		const F = SOLID_DECOR.fallenShelf;
		const cases: SolidDecorPiece[] = [];
		for (const p of pieces) if (p.room === r.id && p.kind === "bookcase") cases.push(p);
		const spots = freeSpotsOf(r, lineShapes(F.length), (s) => {
			for (const c of cases) if (rectGap(s, c) <= F.maxDist) return true;
			return false;
		});
		if (spots.size() === 0) return false;
		placeFree("fallenShelf", rng.pick(spots), r.id);
		return true;
	};
	/**
	 * A library: runs of bookcases on the far walls, then its reading area, its lectern and runner, maybe a second study
	 * table (big rooms), display cases by size and maybe a toppled case. Returns the cases placed.
	 */
	const library = (r: Room, big: boolean, tiles: number): number => {
		const L = SOLID_DECOR.library;
		const runs: Spot[] = [];
		const count = rng.i(L.runsMin, L.runsMax) + (big ? L.bigExtra : 0);
		let cases = 0;
		for (let k = 0; k < count; k++) {
			const room = L.maxCases - cases;
			if (room < L.runMin) break;
			const placed = bookcaseRun(r, L.runMin, math.min(rng.i(L.runMin, L.runMax), room), L.bothCandles, runs);
			if (placed === 0) break;
			cases += placed;
		}
		if (cases === 0) return 0;
		readingArea(r, runs[0]);
		const runner = lecternRunner(r);
		if (big && runner !== undefined && rng.chance(SOLID_DECOR.reading.secondShare)) secondStudyTable(r, runner);
		const D = SOLID_DECOR.display;
		const displays = tiles >= D.twoTiles ? 2 : tiles >= D.oneTiles ? 1 : 0;
		for (let k = 0; k < displays; k++) if (!displayCase(r, runner)) break;
		if (rng.chance(SOLID_DECOR.fallenShelf.share)) fallenShelf(r);
		return cases;
	};
	/**
	 * A mess hall (SOLID_DECOR.mess): barrel stacks flush on its walls, then dining tables on a loose grid. Returns the
	 * pieces placed.
	 */
	const mess = (r: Room, big: boolean): number => {
		const M = SOLID_DECOR.mess;
		let placed = 0;
		const stacks = rng.i(M.stacksMin, M.stacksMax);
		for (let k = 0; k < stacks; k++) {
			const spots = spotsOf(r, M.stackLength, 1, FACES_ALL, SOLID_DECOR.clearTiles).filter(backReal);
			if (spots.size() === 0) break;
			wall("barrelStack", rng.pick(spots), r.id);
			placed++;
		}
		const want = rng.i(M.tablesMin, big ? M.bigTablesMax : M.tablesMax);
		const pitch = M.tableSpacing;
		const ox = rng.i(0, pitch - 1);
		const oy = rng.i(0, pitch - 1);
		const [x0, x1, y0, y1] = boundsOf(r);
		const tables: Spot[] = [];
		while (tables.size() < want) {
			// every free cell tableSpacing from every table: the lattice's first, else any
			// the free spots clearing the fewest pillars; a lattice cell or a pillar's own cell (the table takes its
			// place as cover) first
			let onGrid: Spot[] = [];
			let offGrid: Spot[] = [];
			let best = math.huge;
			for (let y = y0; y <= y1; y++)
				for (let x = x0; x <= x1; x++) {
					const s: Spot = { x, y, w: 1, h: 1, fx: 0, fz: 0 };
					const cost = freeCost(s, r.id);
					if (cost < 0 || cost > best) continue;
					let spaced = true;
					for (const t of tables) if (math.max(math.abs(t.x - x), math.abs(t.y - y)) < pitch) spaced = false;
					if (!spaced) continue;
					if (cost < best) {
						best = cost;
						onGrid = [];
						offGrid = [];
					}
					const lattice = (x - x0 + pitch - ox) % pitch === 0 && (y - y0 + pitch - oy) % pitch === 0;
					if (lattice || standingPillar(x, y, r.id)) onGrid.push(s);
					else offGrid.push(s);
				}
			const from = onGrid.size() > 0 ? onGrid : offGrid;
			if (from.size() === 0) break;
			const s = rng.pick(from);
			placeFree("diningTable", s, r.id);
			tables.push(s);
			placed++;
		}
		return placed;
	};
	/**
	 * A storeroom's solid stock (SOLID_DECOR.store): maybe a stockpile in a corner (big rooms), then stock pieces in
	 * corners first, else flush along a wall.
	 */
	const storeRoom = (r: Room, big: boolean) => {
		const S = SOLID_DECOR.store;
		if (big && rng.chance(S.stockpileShare)) {
			const n = S.stockpileSize;
			const spots = cornerSpotsOf(r, n, n, (s, solids) => {
				// a far-wall side (screen-up): non-walkable cells behind it, as behind a bookcase
				for (const [dx, dy] of solids) {
					if (dx !== -1 && dy !== -1) continue;
					const len = dx !== 0 ? s.h : s.w;
					for (let k = 0; k < len; k++)
						for (let d = 1; d <= SOLID_DECOR.bookcase.backTiles; d++) {
							const bx = dx !== 0 ? s.x - d : s.x + k;
							const by = dx !== 0 ? s.y + k : s.y - d;
							if (inB(bx, by) && (grid[by * W + bx] === FLOOR || grid[by * W + bx] === TileType.POOL))
								return false;
						}
				}
				return true;
			});
			if (spots.size() > 0) wall("stockpile", rng.pick(spots), r.id);
		}
		const count = rng.i(S.piecesMin, S.piecesMax);
		for (let k = 0; k < count; k++) {
			const kind = rng.pick(S.kinds);
			const len = kind === "barrelStack" ? S.stackLength : 1;
			let spots = cornerSpotsOf(r, len, 1);
			if (spots.size() === 0) spots = spotsOf(r, len, 1, FACES_ALL, SOLID_DECOR.clearTiles).filter(backReal);
			if (spots.size() === 0) continue;
			wall(kind, rng.pick(spots), r.id);
		}
	};

	const area = new Array<number>(rooms.size(), 0);
	for (let c = 0; c < W * H; c++) {
		const rid = roomId[c];
		if (rid >= 0 && rid < rooms.size() && grid[c] === FLOOR) area[rid]++;
	}
	const weights = grim ? SOLID_DECOR.themeWeights.grim : SOLID_DECOR.themeWeights.other;
	for (const r of rooms) {
		const big = area[r.id] >= SOLID_DECOR.bigRoomTiles;
		if (r.lake === true) continue;
		if (r.id === boss || r.type === RoomType.BOSS) {
			themes[r.id] = "throne";
			throne(r);
			doorBraziers(r);
			continue;
		}
		if (r.type === RoomType.ENTRANCE) {
			themes[r.id] = "entrance";
			doorBraziers(r);
			continue;
		}
		if (r.type === RoomType.SHRINE) {
			themes[r.id] = "shrine";
			statue(r, SOLID_DECOR.statue.shrineClear + 1);
			continue;
		}
		if (r.type !== RoomType.COMBAT && r.type !== RoomType.ELITE) continue;
		const theme = r.grave === true ? "crypt" : pickTheme(rng, weights);
		themes[r.id] = theme;
		if (theme === "crypt") {
			const C = SOLID_DECOR.crypt;
			const n = rng.i(C.tombsMin, C.tombsMax) + (big ? C.bigExtra : 0);
			for (let k = 0; k < n; k++) if (!wallTomb(r, C.bothCandles)) break;
			if (big && rng.chance(C.centreShare)) centreTomb(r);
		} else if (theme === "hall") {
			const H2 = SOLID_DECOR.hall;
			if (big && rng.chance(H2.statueShare)) statue(r, 0);
			if (rng.chance(H2.shelfShare)) bookcaseRun(r, H2.shelfMin, rng.i(H2.shelfMin, H2.shelfMax), 0, []);
			hallCandles(r);
		} else if (theme === "store") storeRoom(r, big);
		// a room whose far walls hold no run (round or stepped walls, doors) is no library: it is dressed as plain; so
		// is a mess hall where nothing fits
		if (theme === "library" && library(r, big, area[r.id]) === 0) themes[r.id] = "plain";
		if (theme === "mess" && mess(r, big) === 0) themes[r.id] = "plain";
		if (themes[r.id] === "plain") {
			const P = SOLID_DECOR.plain;
			if (rng.chance(P.wallShare)) wallTomb(r, 0);
			if (big && rng.chance(P.centreShare)) centreTomb(r);
		}
	}
	return { pieces, carpets, themes, clearedPillars };
}

function pickTheme(
	rng: Rng,
	w: {
		readonly crypt: number;
		readonly hall: number;
		readonly store: number;
		readonly plain: number;
		readonly library: number;
		readonly mess: number;
	},
): RoomTheme {
	const t = rng.f(0, w.crypt + w.hall + w.store + w.plain + w.library + w.mess);
	if (t < w.crypt) return "crypt";
	if (t < w.crypt + w.hall) return "hall";
	if (t < w.crypt + w.hall + w.store) return "store";
	if (t < w.crypt + w.hall + w.store + w.plain) return "plain";
	if (t < w.crypt + w.hall + w.store + w.plain + w.library) return "library";
	return "mess";
}
