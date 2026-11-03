// Solid decor on endless floors (ForgeParams.solidDecor, docs/DECOR.md "Solid decor"): tombs and candle stands in combat
// and elite rooms become WALL from their own stream, so every other piece of the floor is the option-off one; the floor
// stays one piece, paths round them stay clear, nothing stands by a doorway, and M1 and the tutorial have none.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	KALEB_VALE_MVP_PARAMS,
	RoomType,
	SOLID_DECOR,
	TileType,
	buildEndlessFloor,
	endlessFloorParams,
	generateDungeon,
	tileAt,
	type Dungeon,
	type ForgeParams,
} from "shared/dungeon";

const RUNS = 12;
const FLOORS = 6;

interface Pair {
	readonly off: Dungeon;
	readonly on: Dungeon;
}

const onOff: Pair[] = [];
for (let run = 1; run <= RUNS; run++)
	for (let floor = 1; floor <= FLOORS; floor++) {
		const params = endlessFloorParams(run * 7919, floor);
		onOff.push({ off: generateDungeon({ ...params, solidDecor: false }), on: generateDungeon(params) });
	}

/** Every FLOOR cell reachable from the entrance centre over FLOOR (4-neighbour), computed here independently. */
function connected(d: Dungeon): boolean {
	const e = d.rooms[d.entrance];
	const start = e.cy * d.W + e.cx;
	const seen = new Set<number>([start]);
	const queue = [start];
	let head = 0;
	while (head < queue.size()) {
		const c = queue[head++];
		const x = c % d.W;
		const y = (c - x) / d.W;
		for (const [dx, dy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		]) {
			if (tileAt(d, x + dx, y + dy) !== TileType.FLOOR) continue;
			const n = (y + dy) * d.W + x + dx;
			if (seen.has(n)) continue;
			seen.add(n);
			queue.push(n);
		}
	}
	let floor = 0;
	for (const t of d.grid) if (t === TileType.FLOOR) floor++;
	return seen.size() === floor;
}

describe("solidDecor (Forge option)", () => {
	it("is on for endless floors only: M1 and the tutorial's Forge params leave it off", () => {
		expect(endlessFloorParams(1337, 1).solidDecor).toBe(true);
		expect((KALEB_VALE_MVP_PARAMS as ForgeParams).solidDecor).toBe(undefined);
		expect(generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 }).solidDecor).toEqual([]);
	});

	it("changes nothing but its own cells: props, spawns, torches, rooms, the name and every other cell match", () => {
		let pieces = 0;
		for (const { off, on } of onOff) {
			expect(on.name).toBe(off.name);
			expect(on.props).toEqual(off.props);
			expect(on.spawns).toEqual(off.spawns);
			expect(on.torches).toEqual(off.torches);
			expect(on.rooms).toEqual(off.rooms);
			const own = new Set<number>();
			for (const p of on.solidDecor)
				for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) own.add(y * on.W + x);
			let other = 0;
			for (let c = 0; c < on.grid.size(); c++) if (!own.has(c) && on.grid[c] !== off.grid[c]) other++;
			expect(other).toBe(0);
			pieces += on.solidDecor.size();
		}
		expect(pieces).toBeGreaterThan(onOff.size()); // a few per floor
	});

	it("walls only open floor of combat / elite rooms, keeps clear of doorways and leaves the floor in one piece", () => {
		const problems: string[] = [];
		let tombs = 0;
		let candles = 0;
		for (const { off, on } of onOff) {
			expect(on.valid).toBe(true);
			expect(connected(on)).toBe(true);
			expect(on.stats.reach).toBe(on.stats.floorTiles);
			for (const p of on.solidDecor) {
				const room = on.rooms[p.room];
				if (room.type !== RoomType.COMBAT && room.type !== RoomType.ELITE)
					problems.push(`room ${p.room} ${room.type}`);
				if (p.kind === "tomb") tombs++;
				else candles++;
				const r = p.kind === "tomb" ? SOLID_DECOR.clearTiles : SOLID_DECOR.candleClearTiles;
				for (let y = p.y; y < p.y + p.h; y++)
					for (let x = p.x; x < p.x + p.w; x++) {
						const c = y * on.W + x;
						if (on.grid[c] !== TileType.WALL || on.roomId[c] !== p.room)
							problems.push(`${x},${y} not walled`);
					}
				// the ring round it was open floor of the room before (off), and only solid decor is walled there now
				for (let y = p.y - r; y < p.y + p.h + r; y++)
					for (let x = p.x - r; x < p.x + p.w + r; x++) {
						const c = y * on.W + x;
						if (off.grid[c] !== TileType.FLOOR || off.roomId[c] !== p.room) problems.push(`${x},${y} ring`);
					}
				const dr = SOLID_DECOR.doorTiles;
				for (let y = p.y - dr; y < p.y + p.h + dr; y++)
					for (let x = p.x - dr; x < p.x + p.w + dr; x++)
						if (x >= 0 && y >= 0 && x < on.W && y < on.H && on.doorway[y * on.W + x] !== 0)
							problems.push(`${x},${y} doorway`);
			}
		}
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
		print(`[solid decor] ${onOff.size()} floors: ${tombs} tombs, ${candles} candle stands`);
		expect(tombs).toBeGreaterThan(0);
		expect(candles).toBeGreaterThan(0);
	});

	it("reaches the endless layout: no room spawn, breakable or party spawn stands on a solid cell", () => {
		for (let run = 1; run <= 6; run++)
			for (let floor = 1; floor <= 6; floor++) {
				const layout = buildEndlessFloor(run * 104729, floor, generateDungeon);
				const d = layout.dungeon;
				const solid = new Set<string>();
				for (const p of d.solidDecor)
					for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) solid.add(`${x},${y}`);
				for (const tiles of layout.roomSpawnTiles)
					for (const t of tiles)
						expect([`${t.x},${t.z}`, solid.has(`${t.x},${t.z}`)]).toEqual([`${t.x},${t.z}`, false]);
				for (const b of layout.breakables ?? []) expect(solid.has(`${b.x},${b.y}`)).toBe(false);
			}
	});
});
