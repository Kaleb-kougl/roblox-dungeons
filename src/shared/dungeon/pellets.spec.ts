// Pellets (docs/PELLETS.md PL0 / PL1, PD4 / PD5 / PD9): where an endless floor's pellets lie and which is the power
// pellet. Pure (the same floor always gets the same pellets), its own stream with fixed draws (a hand twin replays
// them), only open FLOOR cells of rooms with enemies (never a piece, a planned spawn, a pillar, a corridor or the
// entrance / treasure / shrine / boss room), every pellet reachable from its room's spawns, the room caps, the power
// pellet's rate from floor 2 and never before, the pattern walkers' geometry, and the rest of the floor (layout,
// spawns, pieces, affixes, loot, boss pick) untouched. Census (PL0): runs 1-10 x floors 1-20 at roomScale 2, usable
// pellets per room by pattern and the rooms under minPerRoom.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES,
	BOSS_PICK,
	BREAKABLE,
	BREAKABLE_LOOT,
	ENDLESS_ROOM_SCALE,
	EncounterRng,
	FLOOR_SEED_MUL,
	NO_POWER_PELLET,
	PELLETS,
	PELLET_CHANCE_RANGE,
	ROSTER,
	TileType,
	assignAffixes,
	bossKindFor,
	buildEndlessFloor,
	cellKey,
	endlessRoomSpawns,
	generateDungeon,
	gridToWorld,
	pelletPatternCells,
	pelletPatternDef,
	pelletPatternPath,
	pelletSeed,
	placeBreakableLoot,
	placeBreakables,
	placePellets,
	reachableFloor,
	roomGridRect,
	tileAt,
	worldToGrid,
	type BreakableFloorInput,
	type Dungeon,
	type EndlessFloorLayout,
	type FloorPellets,
	type ForgeParams,
	type PelletPattern,
	type TileXZ,
} from "shared/dungeon";
import { piecesBeforeGolden } from "shared/dungeon/testing";

const dungeons = new Map<string, Dungeon>();
function dungeonFor(params: ForgeParams): Dungeon {
	const key = `${params.seed}/${params.roomCount}`;
	let d = dungeons.get(key);
	if (d === undefined) {
		d = generateDungeon(params);
		dungeons.set(key, d);
	}
	return d;
}

const CENSUS_RUNS = 10;
const CENSUS_FLOORS = 20;
const CENSUS: EndlessFloorLayout[] = [];
for (let run = 1; run <= CENSUS_RUNS; run++)
	for (let floor = 1; floor <= CENSUS_FLOORS; floor++) CENSUS.push(buildEndlessFloor(run, floor, dungeonFor));

function pelletsOf(l: EndlessFloorLayout): FloorPellets {
	expect(l.pellets).never.toBe(undefined);
	return l.pellets!;
}

function inputOf(l: EndlessFloorLayout): BreakableFloorInput {
	return {
		seed: l.seed,
		dungeon: l.dungeon,
		encounter: l.encounter,
		roomSpawns: l.roomSpawns,
		spawn: l.spawn,
		stairwell: l.stairwell,
	};
}

/** The usable test placePellets applies (pieces, planned spawns, reachability from the entrance). */
function usableOf(l: EndlessFloorLayout): (gx: number, gy: number) => boolean {
	const d = l.dungeon;
	const solid = new Set<number>();
	// the pieces placed before the pellets: the Goldling's own comes later (docs/GOLDLING_RUMOURS.md GR1)
	for (const b of piecesBeforeGolden(l)) solid.add(cellKey(b.x, b.y));
	const spawns = new Set<number>();
	for (const list of l.roomSpawns) for (const s of list) spawns.add(cellKey(worldToGrid(s.x), worldToGrid(s.z)));
	const reach = reachableFloor(d, l.spawn.x, l.spawn.z, solid);
	return (gx, gy) => reach[gy * d.W + gx] && !solid.has(cellKey(gx, gy)) && !spawns.has(cellKey(gx, gy));
}

/**
 * A hand twin of placePellets from its file comment: two draws per room with enemies (pattern, inset), the cells from
 * pelletPatternCells, the min rule, then the power draws. Returns the pellets and the draws taken.
 */
function twin(l: EndlessFloorLayout, seed = l.seed): { pellets: FloorPellets; draws: number } {
	const rng = new EncounterRng(bit32.bxor(seed, PELLETS.salt));
	let draws = 0;
	const usable = usableOf(l);
	const tiles: TileXZ[] = [];
	const room: number[] = [];
	const firsts: number[] = [];
	const counts: number[] = [];
	for (const r of l.encounter.rooms) {
		if ((l.roomSpawns[r.id] ?? []).size() === 0) continue;
		const def = PELLETS.patterns[rng.int(0, PELLETS.patterns.size() - 1)];
		const inset = rng.int(def.insetTiles[0], def.insetTiles[1]);
		draws += 2;
		const cells = pelletPatternCells(l.dungeon, r, def.pattern, inset, PELLETS.maxPerRoom, usable);
		if (cells.size() < PELLETS.minPerRoom) continue;
		firsts.push(tiles.size());
		counts.push(cells.size());
		for (const c of cells) {
			tiles.push(c);
			room.push(r.id);
		}
	}
	let power = NO_POWER_PELLET;
	if (l.floor >= PELLETS.power.fromFloor && firsts.size() > 0) {
		draws++;
		if (rng.int(0, PELLET_CHANCE_RANGE - 1) < PELLETS.power.chancePercent) {
			const k = rng.int(0, firsts.size() - 1);
			power = firsts[k] + rng.int(0, counts[k] - 1);
			draws += 2;
		}
	}
	return { pellets: { tiles, room, power }, draws };
}

/** Cells reachable from `seeds` (grid) on foot: 4-neighbour BFS over FLOOR minus `solid`, independent of reachableFloor. */
function bfs(d: Dungeon, seeds: ReadonlyArray<readonly [number, number]>, solid: ReadonlySet<number>): Set<number> {
	const seen = new Set<number>();
	const queue: Array<readonly [number, number]> = [];
	for (const s of seeds) {
		const k = cellKey(s[0], s[1]);
		if (!seen.has(k)) {
			seen.add(k);
			queue.push(s);
		}
	}
	let head = 0;
	while (head < queue.size()) {
		const [x, y] = queue[head];
		head++;
		for (const [dx, dy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		]) {
			const nx = x + dx;
			const ny = y + dy;
			const k = cellKey(nx, ny);
			if (seen.has(k) || solid.has(k) || tileAt(d, nx, ny) !== TileType.FLOOR) continue;
			seen.add(k);
			queue.push([nx, ny]);
		}
	}
	return seen;
}

function keysOf(path: ReadonlyArray<readonly [number, number]>): string[] {
	return path.map((c) => `${c[0]},${c[1]}`);
}

// ---------------------------------------------------------------------------------------------

describe("pellets: tunables, stream and determinism", () => {
	it("tunables (PL0 census below): per-pattern insets and spacing, caps, the power pellet", () => {
		expect(PELLETS.salt).toBe(0x27220a95);
		expect([PELLETS.minPerRoom, PELLETS.maxPerRoom, PELLETS.laneGapTiles]).toEqual([8, 28, 4]);
		expect(PELLETS.patterns.map((p) => [p.pattern, p.insetTiles[0], p.insetTiles[1], p.spacingTiles])).toEqual([
			["ring", 2, 3, 2],
			["cross", 1, 2, 2],
			["lanes", 2, 3, 2],
			["zigzag", 1, 3, 1],
		]);
		expect(pelletPatternDef("cross")).toBe(PELLETS.patterns[1]);
		expect([PELLETS.power.fromFloor, PELLETS.power.chancePercent]).toEqual([2, 33]);
	});

	it("draws from its own stream: floor seed ^ salt, a salt no other floor stream uses", () => {
		expect(pelletSeed(12345)).toBe(bit32.bxor(12345, PELLETS.salt));
		// Every dungeon-side salt and the floor seed mixer (the sim's drop stream, 0x4b564452, is checked in sim/pellets).
		const salts = [PELLETS.salt, BREAKABLE.salt, BOSS_PICK.salt, AFFIXES.salt, BREAKABLE_LOOT.salt, ROSTER.salt];
		for (let i = 0; i < salts.size(); i++) {
			expect(salts[i]).never.toBe(FLOOR_SEED_MUL);
			for (let j = i + 1; j < salts.size(); j++) expect(salts[i]).never.toBe(salts[j]);
		}
	});

	it("is a pure function of the floor: the same floor always gets the same pellets (fresh dungeon too)", () => {
		for (let k = 0; k < 6; k++) {
			const l = CENSUS[k * 31];
			expect(placePellets(inputOf(l), l.floor, piecesBeforeGolden(l))).toEqual(pelletsOf(l));
			const run = 1 + math.floor((k * 31) / CENSUS_FLOORS);
			const fresh = buildEndlessFloor(run, l.floor, (p) => generateDungeon(p));
			expect(fresh.pellets).toEqual(l.pellets);
		}
	});

	it("fixed draws: a hand twin of the file comment gives the same pellets; 2 per room + the power draws", () => {
		for (const l of CENSUS) {
			const t = twin(l);
			expect(t.pellets).toEqual(pelletsOf(l));
			let rooms = 0;
			for (const s of l.roomSpawns) if (s.size() > 0) rooms++;
			const p = pelletsOf(l);
			const powerDraws =
				l.floor >= PELLETS.power.fromFloor && p.tiles.size() > 0 ? (p.power !== NO_POWER_PELLET ? 3 : 1) : 0;
			expect(t.draws).toBe(2 * rooms + powerDraws);
		}
	});

	it("nothing in the input is mutated", () => {
		const l = CENSUS[17];
		const pieces = (l.breakables ?? []).map((b) => ({ ...b }));
		const spawns = l.roomSpawns.map((s) => s.map((x) => ({ ...x })));
		placePellets(inputOf(l), l.floor, l.breakables ?? []);
		expect(l.breakables ?? []).toEqual(pieces);
		expect(l.roomSpawns).toEqual(spawns);
	});
});

describe("pellets: where they lie", () => {
	it("only open FLOOR cells of a room with enemies, never a piece's or a planned spawn's cell, one per cell", () => {
		for (const l of CENSUS) {
			const d = l.dungeon;
			const p = pelletsOf(l);
			expect(p.room.size()).toBe(p.tiles.size());
			const pieces = new Set<number>();
			for (const b of l.breakables ?? []) pieces.add(cellKey(b.x, b.y));
			const spawns = new Set<number>();
			for (const list of l.roomSpawns)
				for (const s of list) spawns.add(cellKey(worldToGrid(s.x), worldToGrid(s.z)));
			const seen = new Set<number>();
			let lastRoom = -1;
			for (let i = 0; i < p.tiles.size(); i++) {
				const t = p.tiles[i];
				const gx = worldToGrid(t.x);
				const gy = worldToGrid(t.z);
				expect([t.x, t.z]).toEqual([gridToWorld(gx), gridToWorld(gy)]);
				const k = cellKey(gx, gy);
				expect(tileAt(d, gx, gy)).toBe(TileType.FLOOR);
				expect(d.roomId[gy * d.W + gx]).toBe(p.room[i]);
				expect([pieces.has(k), spawns.has(k), seen.has(k)]).toEqual([false, false, false]);
				seen.add(k);
				expect(p.room[i] >= lastRoom).toBe(true);
				lastRoom = p.room[i];
				expect(l.roomSpawns[p.room[i]].size() > 0).toBe(true);
				expect(p.room[i] !== d.entrance && p.room[i] !== d.boss).toBe(true);
				const roomType = l.encounter.rooms[p.room[i]].type;
				expect(roomType === "combat" || roomType === "elite").toBe(true);
			}
		}
	});

	it("every pellet is reachable on foot from its room's spawns (FLOOR, round the pieces)", () => {
		for (const l of CENSUS) {
			const p = pelletsOf(l);
			if (p.tiles.size() === 0) continue;
			const solid = new Set<number>();
			for (const b of l.breakables ?? []) solid.add(cellKey(b.x, b.y));
			const byRoom = new Map<number, Set<number>>();
			for (let i = 0; i < p.tiles.size(); i++) {
				const id = p.room[i];
				let reach = byRoom.get(id);
				if (reach === undefined) {
					const seeds = l.roomSpawns[id].map((s) => [worldToGrid(s.x), worldToGrid(s.z)] as const);
					reach = bfs(l.dungeon, seeds, solid);
					byRoom.set(id, reach);
				}
				expect(reach.has(cellKey(worldToGrid(p.tiles[i].x), worldToGrid(p.tiles[i].z)))).toBe(true);
			}
		}
	});

	it("per room: none, or minPerRoom..maxPerRoom; the power pellet is one of them, from floor 2 only", () => {
		for (const l of CENSUS) {
			const p = pelletsOf(l);
			const per = new Map<number, number>();
			for (const id of p.room) per.set(id, (per.get(id) ?? 0) + 1);
			for (const [, n] of per) expect(n >= PELLETS.minPerRoom && n <= PELLETS.maxPerRoom).toBe(true);
			if (l.floor < PELLETS.power.fromFloor || p.tiles.size() === 0) expect(p.power).toBe(NO_POWER_PELLET);
			else expect(p.power === NO_POWER_PELLET || (p.power >= 0 && p.power < p.tiles.size())).toBe(true);
		}
	});

	it("the power pellet: near chancePercent of the floors from floor 2, never on floor 1 (1000 streams)", () => {
		const l = CENSUS[5]; // run 1, floor 6
		expect(pelletsOf(l).tiles.size() > 0).toBe(true);
		let hits = 0;
		const n = 1000;
		for (let seed = 1; seed <= n; seed++) {
			const out = placePellets({ ...inputOf(l), seed }, l.floor, piecesBeforeGolden(l));
			if (out.power !== NO_POWER_PELLET) hits++;
			if (seed <= 100) {
				expect(placePellets({ ...inputOf(l), seed }, 1, piecesBeforeGolden(l)).power).toBe(NO_POWER_PELLET);
				expect(out).toEqual(twin(l, seed).pellets);
			}
		}
		print(`[pellets] power pellet on ${hits} / ${n} streams (chance ${PELLETS.power.chancePercent} %)`);
		expect(math.abs(hits / n - PELLETS.power.chancePercent / 100) < 0.045).toBe(true);
	});

	it("leaves the rest of the floor exactly as before: pieces, spawns, affixes, loot, boss pick, layout", () => {
		for (const l of CENSUS.filter((_l, i) => i % 9 === 0)) {
			const input = inputOf(l);
			const pieces = placeBreakables(input, l.floor);
			// (the Goldling's own piece comes after the pellets, docs/GOLDLING_RUMOURS.md GR1)
			expect(pieces).toEqual(piecesBeforeGolden(l));
			expect(endlessRoomSpawns(l.dungeon, l.floor, 1, l.roster)).toEqual(l.roomSpawns);
			expect(assignAffixes(l.seed, l.floor, l.encounter.rooms, l.roomSpawns)).toEqual(l.roomAffixes);
			expect(placeBreakableLoot(l.seed, l.floor, pieces, l.encounter)).toEqual(l.breakableLoot);
			if (l.bossFloor) expect(l.bossKind).toBe(bossKindFor(l.seed));
			expect(l.dungeon.params.roomScale).toBe(ENDLESS_ROOM_SCALE);
		}
	});
});

describe("pellets: pattern walkers", () => {
	it("ring: the inset rectangle's outline clockwise from its top-left, every spacing-th cell", () => {
		// 5 x 3 rectangle at (0, 0): outline 4 + 2 + 4 + 1 = 12 cells, every 2nd.
		expect(keysOf(pelletPatternPath("ring", 0, 0, 4, 2, 2, 4))).toEqual(["0,0", "2,0", "4,0", "4,2", "2,2", "0,2"]);
		// A one-row rectangle walks its row once.
		expect(keysOf(pelletPatternPath("ring", 0, 5, 4, 5, 2, 4))).toEqual(["0,5", "2,5", "4,5"]);
	});

	it("cross: the centre row, then the centre column, on the spacing grid through the centre (centre once)", () => {
		expect(keysOf(pelletPatternPath("cross", 0, 0, 6, 4, 2, 4))).toEqual(["1,2", "3,2", "5,2", "3,0", "3,4"]);
	});

	it("lanes: evenly spread lines along the long axis, snaking", () => {
		// 9 wide x 9 tall (x long on a tie): span 8, gap 4 -> 3 lanes at y 0, 4, 8.
		expect(keysOf(pelletPatternPath("lanes", 0, 0, 8, 8, 4, 4))).toEqual([
			"0,0",
			"4,0",
			"8,0",
			"8,4",
			"4,4",
			"0,4",
			"0,8",
			"4,8",
			"8,8",
		]);
		// Tall room: lanes run along y; a short span under the gap is one centre lane.
		expect(keysOf(pelletPatternPath("lanes", 0, 0, 2, 6, 3, 4))).toEqual(["1,0", "1,3", "1,6"]);
	});

	it("zigzag: a diagonal bouncing between the short-axis edges, every spacing-th step", () => {
		expect(keysOf(pelletPatternPath("zigzag", 0, 0, 8, 2, 1, 4))).toEqual([
			"0,0",
			"1,1",
			"2,2",
			"3,1",
			"4,0",
			"5,1",
			"6,2",
			"7,1",
			"8,0",
		]);
		expect(keysOf(pelletPatternPath("zigzag", 0, 0, 8, 2, 2, 4))).toEqual(["0,0", "2,2", "4,0", "6,2", "8,0"]);
	});

	it("an empty rectangle (inset past the room) walks nothing; every path's cells are distinct", () => {
		for (const { pattern } of PELLETS.patterns) {
			expect(pelletPatternPath(pattern, 3, 0, 2, 5).size()).toBe(0);
			for (let w = 0; w <= 12; w++)
				for (let h = 0; h <= 12; h++) {
					const keys = keysOf(pelletPatternPath(pattern, 0, 0, w, h));
					expect(new Set(keys).size()).toBe(keys.size());
					expect(keys.size() > 0).toBe(true);
				}
		}
	});

	it("pelletPatternCells: a room's own FLOOR cells on the path, trimmed evenly along it to the cap", () => {
		const l = CENSUS[2];
		const d = l.dungeon;
		let checked = 0;
		for (const r of l.encounter.rooms) {
			if ((l.roomSpawns[r.id] ?? []).size() === 0) continue;
			for (const { pattern } of PELLETS.patterns) {
				const all = pelletPatternCells(d, r, pattern, 2, math.huge);
				const [x0, y0, x1, y1] = roomGridRect(r);
				const path = pelletPatternPath(pattern, x0 + 2, y0 + 2, x1 - 2, y1 - 2);
				let floors = 0;
				for (const [gx, gy] of path)
					if (tileAt(d, gx, gy) === TileType.FLOOR && d.roomId[gy * d.W + gx] === r.id) floors++;
				expect(all.size()).toBe(floors);
				const cap = 5;
				const trimmed = pelletPatternCells(d, r, pattern, 2, cap);
				if (all.size() <= cap) expect(trimmed).toEqual(all);
				else {
					expect(trimmed.size()).toBe(cap);
					expect(trimmed[0]).toEqual(all[0]);
					for (let j = 0; j < cap; j++) expect(trimmed[j]).toEqual(all[math.floor((j * all.size()) / cap)]);
				}
				checked++;
			}
		}
		expect(checked > 0).toBe(true);
	});
});

describe("pellets: PL0 census (runs 1-10 x floors 1-20, roomScale 2)", () => {
	it("usable pellets per room by pattern, rooms under minPerRoom, pellets and power pellets per floor", () => {
		interface Stat {
			rooms: number;
			sum: number;
			min: number;
			max: number;
			under: number;
			over: number;
		}
		const byPattern = new Map<PelletPattern, Stat>();
		for (const p of PELLETS.patterns)
			byPattern.set(p.pattern, { rooms: 0, sum: 0, min: math.huge, max: 0, under: 0, over: 0 });
		let enemyRooms = 0;
		let pelletRooms = 0;
		let total = 0;
		let powerFloors = 0;
		let powerEligible = 0;
		let emptyFloors = 0;
		for (const l of CENSUS) {
			const usable = usableOf(l);
			for (const r of l.encounter.rooms) {
				if ((l.roomSpawns[r.id] ?? []).size() === 0) continue;
				enemyRooms++;
				for (const { pattern, insetTiles } of PELLETS.patterns)
					for (let inset = insetTiles[0]; inset <= insetTiles[1]; inset++) {
						const n = pelletPatternCells(l.dungeon, r, pattern, inset, math.huge, usable).size();
						const s = byPattern.get(pattern)!;
						s.rooms++;
						s.sum += n;
						s.min = math.min(s.min, n);
						s.max = math.max(s.max, n);
						if (n < PELLETS.minPerRoom) s.under++;
						if (n > PELLETS.maxPerRoom) s.over++;
					}
			}
			const p = pelletsOf(l);
			const rooms = new Set<number>();
			for (const id of p.room) rooms.add(id);
			pelletRooms += rooms.size();
			total += p.tiles.size();
			if (p.tiles.size() === 0) emptyFloors++;
			if (l.floor >= PELLETS.power.fromFloor) {
				powerEligible++;
				if (p.power !== NO_POWER_PELLET) powerFloors++;
			}
		}
		for (const { pattern } of PELLETS.patterns) {
			const s = byPattern.get(pattern)!;
			print(
				`[pellets] ${pattern}: ${string.format("%.1f", s.sum / s.rooms)} usable per room (min ${s.min}, max ${
					s.max
				}), ${s.under}/${s.rooms} under minPerRoom ${PELLETS.minPerRoom}, ${s.over}/${s.rooms} trimmed to ${
					PELLETS.maxPerRoom
				} (every inset)`,
			);
		}
		// No pattern may be useless: most rooms can hold it.
		for (const { pattern } of PELLETS.patterns) {
			const s = byPattern.get(pattern)!;
			expect(s.under / s.rooms < 0.25).toBe(true);
		}
		print(
			`[pellets] ${CENSUS.size()} floors: ${pelletRooms}/${enemyRooms} enemy rooms with pellets (${
				enemyRooms - pelletRooms
			} under minPerRoom), ${string.format("%.1f", total / CENSUS.size())} pellets per floor, ${string.format(
				"%.1f",
				total / math.max(1, pelletRooms),
			)} per room, ${emptyFloors} floors without pellets, power pellet on ${powerFloors}/${powerEligible} floors from floor ${
				PELLETS.power.fromFloor
			}`,
		);
		expect(pelletRooms / enemyRooms > 0.85).toBe(true);
	});
});
