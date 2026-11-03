/**
 * Kaleb-Vale (not in the original Dungeon Forge): solid decor, Diablo-style obstacles in rooms (docs/DECOR.md "Solid
 * decor"). With ForgeParams.solidDecor, after all decoration and solid pillars, combat and elite rooms get tombs (a 2 x
 * 1 sarcophagus) flanked by candle stands (1 x 1), whose cells become WALL: they block movement, bullets and sight like
 * any wall, and the decor plan draws their art on them instead of a wall block.
 *
 * Its own stream (makeRng(seed ^ SOLID_DECOR.salt)), so the main stream, and with it every room, corridor, prop,
 * spawn, torch, pool and the name, are exactly the option-off floor's. Rooms in id order; per room up to `perRoom`
 * clusters (the second only in rooms of bigRoomTiles floor tiles), each with `roomShare` (the first) / `secondShare`;
 * a cluster takes a random spot of its room (up to `tries`) where every cell within clearTiles (Chebyshev) of the tomb
 * is FLOOR of that room and none is within doorTiles of a doorway; each candle needs every cell within candleClearTiles
 * FLOOR of the room. The clearance ring around everything walled means no new wall touches another, so the floor
 * stays one piece; the caller re-floods and keeps the pieces only if it does.
 */
import { makeRng } from "./rng";
import { RoomType, TileType, type Room } from "./types";

export type SolidDecorKind = "tomb" | "candelabrum";

/** One solid decor piece: its kind and its cells (x .. x + w - 1, y .. y + h - 1), all WALL on the floor. */
export interface SolidDecorPiece {
	readonly kind: SolidDecorKind;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
	readonly room: number;
}

export const SOLID_DECOR = {
	salt: 0x7f4a7c15,
	/** Share of combat / elite rooms that get a first cluster. */
	roomShare: 0.55,
	/** A room with at least this many floor tiles may get a second cluster, with this share. */
	bigRoomTiles: 320,
	secondShare: 0.5,
	perRoom: 2,
	/** Random spots tried per cluster. */
	tries: 24,
	/** Every cell within this many tiles of the tomb is floor of its room (paths round it stay two tiles wide). */
	clearTiles: 2,
	/** No tomb cell within this many tiles of a doorway. */
	doorTiles: 3,
	/** The tomb's length (cells along its axis); candles stand this many cells past each end (one cell of floor). */
	tombLength: 2,
	candleGap: 1,
	/** Every cell within this many tiles of a candle is floor of its room. */
	candleClearTiles: 1,
} as const;

const { FLOOR, WALL } = TileType;

/**
 * Places the solid decor, writing WALL into `grid` for every piece (see the file comment). Returns the pieces, rooms
 * in id order. `grid`, `roomId` and `doorway` are the Forge's arrays (y * W + x).
 */
export function placeSolidDecor(
	seed: number,
	W: number,
	H: number,
	grid: number[],
	roomId: ReadonlyArray<number>,
	doorway: ReadonlyArray<number>,
	rooms: ReadonlyArray<Room>,
): SolidDecorPiece[] {
	const rng = makeRng((seed ^ SOLID_DECOR.salt) >>> 0);
	const out: SolidDecorPiece[] = [];
	const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
	const floorOf = (x: number, y: number, rid: number) =>
		inB(x, y) && grid[y * W + x] === FLOOR && roomId[y * W + x] === rid;
	/** Every cell within `r` of the rect x0..x1, y0..y1 is floor of room `rid`. */
	const clearAround = (x0: number, y0: number, x1: number, y1: number, r: number, rid: number) => {
		for (let y = y0 - r; y <= y1 + r; y++)
			for (let x = x0 - r; x <= x1 + r; x++) if (!floorOf(x, y, rid)) return false;
		return true;
	};
	const nearDoor = (x0: number, y0: number, x1: number, y1: number, r: number) => {
		for (let y = y0 - r; y <= y1 + r; y++)
			for (let x = x0 - r; x <= x1 + r; x++) if (inB(x, y) && doorway[y * W + x] !== 0) return true;
		return false;
	};
	const wall = (kind: SolidDecorKind, x: number, y: number, w: number, h: number, rid: number) => {
		for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) grid[yy * W + xx] = WALL;
		out.push({ kind, x, y, w, h, room: rid });
	};
	const area = new Array<number>(rooms.size(), 0);
	for (let c = 0; c < W * H; c++) {
		const rid = roomId[c];
		if (rid >= 0 && rid < rooms.size() && grid[c] === FLOOR) area[rid]++;
	}
	const L = SOLID_DECOR.tombLength;
	const ct = SOLID_DECOR.clearTiles;
	for (const r of rooms) {
		if (r.type !== RoomType.COMBAT && r.type !== RoomType.ELITE) continue;
		const clusters = area[r.id] >= SOLID_DECOR.bigRoomTiles ? SOLID_DECOR.perRoom : 1;
		for (let k = 0; k < clusters; k++) {
			if (!rng.chance(k === 0 ? SOLID_DECOR.roomShare : SOLID_DECOR.secondShare)) continue;
			const alongX = rng.chance(0.5);
			const w = alongX ? L : 1;
			const h = alongX ? 1 : L;
			const xMin = math.ceil(r.cx - r.w / 2) + ct;
			const xMax = math.floor(r.cx + r.w / 2) - ct - (w - 1);
			const yMin = math.ceil(r.cy - r.h / 2) + ct;
			const yMax = math.floor(r.cy + r.h / 2) - ct - (h - 1);
			if (xMax < xMin || yMax < yMin) continue;
			for (let t = 0; t < SOLID_DECOR.tries; t++) {
				const x = rng.i(xMin, xMax);
				const y = rng.i(yMin, yMax);
				if (!clearAround(x, y, x + w - 1, y + h - 1, ct, r.id)) continue;
				if (nearDoor(x, y, x + w - 1, y + h - 1, SOLID_DECOR.doorTiles)) continue;
				wall("tomb", x, y, w, h, r.id);
				// a candle stand past each end, one cell of floor between
				const step = SOLID_DECOR.candleGap + 1;
				const ends = alongX
					? [
							[x - step, y],
							[x + w - 1 + step, y],
					  ]
					: [
							[x, y - step],
							[x, y + h - 1 + step],
					  ];
				for (const [cx, cy] of ends) {
					const cr = SOLID_DECOR.candleClearTiles;
					if (clearAround(cx, cy, cx, cy, cr, r.id) && !nearDoor(cx, cy, cx, cy, SOLID_DECOR.doorTiles))
						wall("candelabrum", cx, cy, 1, 1, r.id);
				}
				break;
			}
		}
	}
	return out;
}
