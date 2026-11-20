/**
 * Test support for the minimap specs (never imported by the game): hand-made dungeons from text rows, and the tiles
 * census (census.ts: checkMinimapFloor and the endless census its shard specs run).
 *
 * @module
 */
import { RoomType, TileType, type Dungeon } from "shared/dungeon";

const ROOM_FLOOR = "ABCDEFGHIJ";
const ROOM_POOL = "abcdefghij";

/**
 * A bare dungeon from rows (row = grid y = world z, column = grid x = world x): 'A'.. room floor (room 0..), 'a'.. a
 * pool in that room, '.' corridor floor, '~' corridor pool, '#' WALL, anything else VOID. `roomCount` rooms (default:
 * the highest room used + 1), all COMBAT except room `boss` (default 0), which is BOSS.
 */
export function specDungeon(rows: ReadonlyArray<string>, roomCount?: number, boss = 0): Dungeon {
	const H = rows.size();
	const W = rows[0].size();
	const cells: number[] = [];
	const ids: number[] = [];
	let rooms = 0;
	for (const row of rows)
		for (let x = 1; x <= W; x++) {
			const c = string.sub(row, x, x);
			const [floorRoom] = string.find(ROOM_FLOOR, c, 1, true);
			const [poolRoom] = string.find(ROOM_POOL, c, 1, true);
			if (floorRoom !== undefined) {
				cells.push(TileType.FLOOR);
				ids.push(floorRoom - 1);
				rooms = math.max(rooms, floorRoom);
			} else if (poolRoom !== undefined) {
				cells.push(TileType.POOL);
				ids.push(poolRoom - 1);
				rooms = math.max(rooms, poolRoom);
			} else {
				cells.push(
					c === "#" ? TileType.WALL : c === "." ? TileType.FLOOR : c === "~" ? TileType.POOL : TileType.VOID,
				);
				ids.push(-1);
			}
		}
	const roomList: object[] = [];
	for (let i = 0; i < (roomCount ?? rooms); i++)
		roomList.push({ type: i === boss ? RoomType.BOSS : RoomType.COMBAT });
	return { W, H, grid: cells, roomId: ids, rooms: roomList, boss } as unknown as Dungeon;
}

/** An open field: W x H corridor floor inside a one-cell WALL border. */
export function specField(W: number, H: number): Dungeon {
	const rows: string[] = [];
	for (let y = 0; y < H; y++) {
		let row = "";
		for (let x = 0; x < W; x++) row += x === 0 || y === 0 || x === W - 1 || y === H - 1 ? "#" : ".";
		rows.push(row);
	}
	return specDungeon(rows, 0, -1);
}

export * from "./census";
