// Solid decor and room themes on endless floors (ForgeParams.solidDecor, docs/DECOR.md "Solid decor", "Room themes"):
// set pieces become WALL from their own stream, so every other piece of the floor is the option-off one; the floor
// stays one piece, no piece makes a new pinch, nothing but the door braziers stands by a doorway, and M1 and the
// tutorial have none.
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

	it("walls only open floor of each piece's own room, by theme, and leaves the floor in one piece", () => {
		const problems: string[] = [];
		const kindsByType: Record<string, ReadonlyArray<string>> = {
			[RoomType.BOSS]: ["throne", "candelabrum", "brazier"],
			[RoomType.ENTRANCE]: ["brazier"],
			[RoomType.SHRINE]: ["statue", "candelabrum"],
			[RoomType.COMBAT]: ["tomb", "candelabrum", "statue"],
			[RoomType.ELITE]: ["tomb", "candelabrum", "statue"],
		};
		const counts = new Map<string, number>();
		for (const { off, on } of onOff) {
			expect(on.valid).toBe(true);
			expect(connected(on)).toBe(true);
			expect(on.stats.reach).toBe(on.stats.floorTiles);
			expect((on.roomThemes ?? []).size()).toBe(on.rooms.size());
			for (const p of on.solidDecor) {
				const room = on.rooms[p.room];
				counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
				if (!(kindsByType[room.type] ?? []).includes(p.kind)) problems.push(`${p.kind} in ${room.type}`);
				for (let y = p.y; y < p.y + p.h; y++)
					for (let x = p.x; x < p.x + p.w; x++) {
						const c = y * on.W + x;
						if (off.grid[c] !== TileType.FLOOR || off.roomId[c] !== p.room)
							problems.push(`${x},${y} not floor`);
						if (on.grid[c] !== TileType.WALL) problems.push(`${x},${y} not walled`);
					}
				// near a doorway: only the door braziers, which flank an opening (a doorway cell diagonal to them)
				const dr = p.kind === "brazier" ? 0 : SOLID_DECOR.doorTiles;
				for (let y = p.y - dr; y < p.y + p.h + dr; y++)
					for (let x = p.x - dr; x < p.x + p.w + dr; x++)
						if (x >= 0 && y >= 0 && x < on.W && y < on.H && on.doorway[y * on.W + x] !== 0)
							problems.push(`${p.kind} ${x},${y} doorway`);
				if (p.kind === "brazier") {
					let flank = false;
					for (let y = p.y - 1; y <= p.y + 1; y++)
						for (let x = p.x - 1; x <= p.x + 1; x++) if (on.doorway[y * on.W + x] !== 0) flank = true;
					if (!flank) problems.push(`brazier ${p.x},${p.y} flanks no doorway`);
				}
				// flush: every cell behind a wall-attached piece's back row is solid
				if (p.fx !== 0 || p.fz !== 0) {
					const n = p.fx !== 0 ? p.h : p.w;
					for (let k = 0; k < n; k++) {
						const bx = p.fx === 1 ? p.x - 1 : p.fx === -1 ? p.x + p.w : p.x + k;
						const by = p.fx !== 0 ? p.y + k : p.fz === 1 ? p.y - 1 : p.y + p.h;
						if (tileAt(on, bx, by) === TileType.FLOOR) problems.push(`${p.kind} ${p.x},${p.y} not flush`);
					}
				}
			}
		}
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
		const line: string[] = [];
		counts.forEach((v, k) => line.push(`${k} ${string.format("%.1f", v / onOff.size())}`));
		print(`[solid decor] ${onOff.size()} floors, per floor: ${line.join(", ")}`);
		for (const k of ["tomb", "candelabrum", "throne", "statue", "brazier"])
			expect(counts.get(k) ?? 0).toBeGreaterThan(0);
	});

	it("makes no new pinch: a floor cell walled in on two opposite sides by a piece was not so before", () => {
		// (the one exception by design: a free-standing tomb's candle stands one floor cell past its ends)
		const problems: string[] = [];
		for (const { off, on } of onOff) {
			const pieceAt = new Map<number, number>();
			on.solidDecor.forEach((p, i) => {
				for (let y = p.y; y < p.y + p.h; y++)
					for (let x = p.x; x < p.x + p.w; x++) pieceAt.set(y * on.W + x, i);
			});
			const freeCandle = (c: number | undefined) => {
				if (c === undefined) return false;
				const p = on.solidDecor[c];
				return p.kind === "candelabrum" && p.fx === 0 && p.fz === 0;
			};
			const tomb = (c: number | undefined) => c !== undefined && on.solidDecor[c].kind === "tomb";
			for (let y = 1; y < on.H - 1; y++)
				for (let x = 1; x < on.W - 1; x++) {
					const c = y * on.W + x;
					if (on.grid[c] !== TileType.FLOOR) continue;
					for (const [dx, dy] of [
						[1, 0],
						[0, 1],
					]) {
						const a = c - dy * on.W - dx;
						const b = c + dy * on.W + dx;
						if (on.grid[a] === TileType.FLOOR || on.grid[b] === TileType.FLOOR) continue;
						if (off.grid[a] !== TileType.FLOOR && off.grid[b] !== TileType.FLOOR) continue; // pinched already
						const pa = pieceAt.get(a);
						const pb = pieceAt.get(b);
						if (pa === undefined && pb === undefined) continue;
						if ((freeCandle(pa) && tomb(pb)) || (freeCandle(pb) && tomb(pa))) continue;
						problems.push(`${x},${y}`);
					}
				}
		}
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
	});

	it("gives every room a theme by its type; the boss room's carpet lies on its floor in front of the throne", () => {
		const problems: string[] = [];
		let thrones = 0;
		let carpets = 0;
		for (const { on } of onOff) {
			const themes = on.roomThemes ?? [];
			for (const r of on.rooms) {
				const t = themes[r.id];
				const want =
					r.id === on.boss
						? ["throne"]
						: r.type === RoomType.ENTRANCE
						? ["entrance"]
						: r.type === RoomType.SHRINE
						? ["shrine"]
						: r.type === RoomType.COMBAT || r.type === RoomType.ELITE
						? r.lake === true
							? ["none"]
							: r.grave === true
							? ["crypt"]
							: ["crypt", "hall", "store", "plain"]
						: ["none"];
				if (!want.includes(t)) problems.push(`room ${r.id} ${r.type} theme ${t}`);
			}
			const throne = on.solidDecor.find((p) => p.kind === "throne");
			if (throne !== undefined) thrones++;
			for (const cp of on.carpets ?? []) {
				carpets++;
				if (throne === undefined || cp.room !== throne.room) problems.push("carpet without its throne");
				if (cp.fx !== throne?.fx || cp.fz !== throne?.fz) problems.push("carpet not along the throne's facing");
				for (let y = cp.y; y < cp.y + cp.h; y++)
					for (let x = cp.x; x < cp.x + cp.w; x++) {
						const c = y * on.W + x;
						if (on.grid[c] !== TileType.FLOOR || on.roomId[c] !== cp.room)
							problems.push(`carpet ${x},${y}`);
					}
				if ((cp.fx !== 0 ? cp.w : cp.h) % 2 !== 0) problems.push("carpet of odd length");
			}
		}
		expect(problems.filter((_, i) => i < 10)).toEqual([]);
		// every boss room of the census fits its throne
		expect(thrones).toBe(onOff.size());
		expect(carpets).toBe(thrones);
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
