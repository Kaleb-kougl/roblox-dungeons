// Breakable loot (docs/BREAKABLE_DROPS.md BL1, BLD1 / BLD2 / BLD8): which barrels and crates of an endless floor hold
// a boost. Pure (the same floor always gets the same loot), its own stream with fixed draws (a hand twin replays them),
// the band counts, at most one loaded piece per room, crates loaded about twice as often as barrels, every kind
// reachable, and the rest of the floor (layout, pieces, spawns, affixes, boss pick) untouched. Census: runs 1-10 x one
// to three floors per depth band at roomScale 2 (endlessFloorParams), with the BL0 print of pieces per floor per band.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES,
	BOSS_PICK,
	BREAKABLE,
	BREAKABLE_KINDS,
	BREAKABLE_LOOT,
	EMPTY_ENCOUNTER,
	EncounterRng,
	ENDLESS_ROOM_SCALE,
	affixSeed,
	assignAffixes,
	bossKindFor,
	breakableLootBand,
	breakableLootSeed,
	breakableSeed,
	buildEndlessFloor,
	generateDungeon,
	gridToWorld,
	placeBreakableLoot,
	placeBreakables,
	roomAt,
	type BreakableLoot,
	type BreakablePlacement,
	type Dungeon,
	type EncounterConfig,
	type EncounterRoom,
	type EndlessFloorLayout,
	type ForgeParams,
} from "shared/dungeon";

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

/** Census floors per band (kept 1-4, worn 5-9, ruined 10-14, abyss 15+), boss floors among them. */
const CENSUS_FLOORS: ReadonlyArray<number> = [1, 3, 4, 5, 7, 9, 10, 12, 14, 15, 17, 19];
const CENSUS_RUNS = 10;
const CENSUS: EndlessFloorLayout[] = [];
for (let run = 1; run <= CENSUS_RUNS; run++)
	for (const floor of CENSUS_FLOORS) CENSUS.push(buildEndlessFloor(run, floor, dungeonFor));

function pieces(l: EndlessFloorLayout): ReadonlyArray<BreakablePlacement> {
	return l.breakables ?? [];
}

function loot(l: EndlessFloorLayout): ReadonlyArray<BreakableLoot> {
	return l.breakableLoot ?? [];
}

/** The room roomAt gives a piece (its cell centre), -1 for none. */
function roomIdOf(encounter: EncounterConfig, b: BreakablePlacement): number {
	return roomAt(encounter, gridToWorld(b.x), gridToWorld(b.y))?.id ?? -1;
}

/** Distinct rooms holding at least one piece (pieces in no room count one each). */
function roomsWithPieces(l: EndlessFloorLayout): number {
	const seen = new Set<number>();
	let loose = 0;
	for (const b of pieces(l)) {
		const id = roomIdOf(l.encounter, b);
		if (id < 0) loose++;
		else seen.add(id);
	}
	return seen.size() + loose;
}

/**
 * A hand twin of placeBreakableLoot from its file comment: count draw, then per loaded piece a weighted piece draw and a
 * weighted kind draw, with the room cap. Returns the loot and the draws taken.
 */
function twin(
	seed: number,
	floor: number,
	list: ReadonlyArray<BreakablePlacement>,
	encounter: EncounterConfig,
): { loot: BreakableLoot[]; draws: number } {
	const rng = new EncounterRng(bit32.bxor(seed, BREAKABLE_LOOT.salt));
	let draws = 0;
	let band = BREAKABLE_LOOT.bands[0];
	for (const b of BREAKABLE_LOOT.bands) if (floor >= b.fromFloor) band = b;
	const count = math.min(rng.int(band.min, band.max), list.size());
	draws++;
	const chosen = new Map<number, number>();
	const used = new Map<number, number>();
	let kindTotal = 0;
	for (const w of BREAKABLE_LOOT.kindWeights) kindTotal += w;
	for (let k = 0; k < count; k++) {
		const cands: number[] = [];
		let total = 0;
		for (let i = 0; i < list.size(); i++) {
			const room = roomIdOf(encounter, list[i]);
			if (chosen.has(i) || (room >= 0 && (used.get(room) ?? 0) >= BREAKABLE_LOOT.maxPerRoom)) continue;
			cands.push(i);
			total += BREAKABLE_LOOT.pieceWeight[list[i].kind];
		}
		if (cands.size() === 0) break;
		let roll = rng.int(0, total - 1);
		draws++;
		let slot = cands[0];
		for (const i of cands) {
			const w = BREAKABLE_LOOT.pieceWeight[list[i].kind];
			if (roll < w) {
				slot = i;
				break;
			}
			roll -= w;
		}
		let kroll = rng.int(0, kindTotal - 1);
		draws++;
		let kind = 0;
		for (let j = 0; j < BREAKABLE_LOOT.kindWeights.size(); j++) {
			if (kroll < BREAKABLE_LOOT.kindWeights[j]) {
				kind = j;
				break;
			}
			kroll -= BREAKABLE_LOOT.kindWeights[j];
		}
		chosen.set(slot, kind);
		const room = roomIdOf(encounter, list[slot]);
		if (room >= 0) used.set(room, (used.get(room) ?? 0) + 1);
	}
	const out: BreakableLoot[] = [];
	for (let i = 0; i < list.size(); i++) {
		const kind = chosen.get(i);
		if (kind !== undefined) out.push({ slot: i, kind });
	}
	return { loot: out, draws };
}

function room(id: number, cx: number, cz: number, h: number): EncounterRoom {
	return {
		id,
		type: "combat",
		depth: 1,
		cx,
		cz,
		minX: cx - h,
		maxX: cx + h,
		minZ: cz - h,
		maxZ: cz + h,
		floorTiles: 9,
	};
}

// ---------------------------------------------------------------------------------------------

describe("breakable loot: stream and determinism", () => {
	it("is a pure function of the floor: the same floor always gets the same loot (fresh dungeon too)", () => {
		for (let k = 0; k < 8; k++) {
			const l = CENSUS[k * 13];
			expect(placeBreakableLoot(l.seed, l.floor, pieces(l), l.encounter)).toEqual(loot(l));
			const run = 1 + math.floor((k * 13) / CENSUS_FLOORS.size());
			const fresh = buildEndlessFloor(run, l.floor, (p) => generateDungeon(p));
			expect(fresh.breakableLoot).toEqual(l.breakableLoot);
		}
	});

	it("draws from its own stream: floor seed ^ salt, a salt no other floor stream uses", () => {
		expect(BREAKABLE_LOOT.salt).toBe(0xe6546b64);
		expect(breakableLootSeed(12345)).toBe(bit32.bxor(12345, BREAKABLE_LOOT.salt));
		const salts = [BREAKABLE_LOOT.salt, BREAKABLE.salt, BOSS_PICK.salt, AFFIXES.salt];
		for (let i = 0; i < salts.size(); i++)
			for (let j = i + 1; j < salts.size(); j++) expect(salts[i]).never.toBe(salts[j]);
		for (const l of CENSUS) {
			const s = breakableLootSeed(l.seed);
			expect([s === breakableSeed(l.seed), s === affixSeed(l.seed), s === l.seed]).toEqual([false, false, false]);
		}
	});

	it("fixed draws: a hand twin of the file comment gives the same loot; 1 + 2 per loaded piece", () => {
		for (const l of CENSUS) {
			const t = twin(l.seed, l.floor, pieces(l), l.encounter);
			expect(t.loot).toEqual(loot(l));
			expect(t.draws).toBe(1 + 2 * loot(l).size());
		}
		// A sandbox list over many seeds (two rooms, mixed kinds).
		const enc: EncounterConfig = { ...EMPTY_ENCOUNTER, rooms: [room(0, 0, 0, 3), room(1, 20, 0, 3)] };
		const list: BreakablePlacement[] = [
			{ x: 0, y: 0, kind: "crate" },
			{ x: 1, y: 0, kind: "barrel" },
			{ x: 20, y: 0, kind: "barrel" },
		];
		for (let seed = 1; seed <= 200; seed++) {
			const t = twin(seed, 12, list, enc);
			expect(placeBreakableLoot(seed, 12, list, enc)).toEqual(t.loot);
		}
	});

	it("no pieces: no loot (the count is still drawn); nothing in input is mutated", () => {
		expect(placeBreakableLoot(7, 1, [], EMPTY_ENCOUNTER)).toEqual([]);
		const l = CENSUS[3];
		const before = pieces(l).map((b) => ({ ...b }));
		placeBreakableLoot(l.seed, l.floor, pieces(l), l.encounter);
		expect(pieces(l)).toEqual(before);
	});

	it("leaves the rest of the floor exactly as before: pieces, spawns, affixes, boss pick, layout", () => {
		for (const l of CENSUS.filter((_l, i) => i % 7 === 0)) {
			expect(
				placeBreakables(
					{
						seed: l.seed,
						dungeon: l.dungeon,
						encounter: l.encounter,
						roomSpawns: l.roomSpawns,
						spawn: l.spawn,
						stairwell: l.stairwell,
					},
					l.floor,
				),
			).toEqual(pieces(l));
			expect(assignAffixes(l.seed, l.floor, l.encounter.rooms, l.roomSpawns)).toEqual(l.roomAffixes);
			if (l.bossFloor) expect(l.bossKind).toBe(bossKindFor(l.seed));
			expect(l.dungeon.params.roomScale).toBe(ENDLESS_ROOM_SCALE);
		}
	});
});

describe("breakable loot: counts, rooms, kinds", () => {
	it("bands: kept 0-2 from floor 1, worn 1-2 from 5, ruined 1-3 from 10, abyss 1-3 from 15", () => {
		const at = [1, 4, 5, 9, 10, 14, 15, 40].map((f) => {
			const b = breakableLootBand(f);
			return [b.min, b.max];
		});
		expect(at).toEqual([
			[0, 2],
			[0, 2],
			[1, 2],
			[1, 2],
			[1, 3],
			[1, 3],
			[1, 3],
			[1, 3],
		]);
		expect(BREAKABLE_LOOT.maxPerRoom).toBe(1);
		expect([BREAKABLE_LOOT.pieceWeight.barrel, BREAKABLE_LOOT.pieceWeight.crate]).toEqual([1, 2]);
	});

	it("every floor: within its band (short only when its pieces sit in fewer rooms), one per room, valid slots", () => {
		for (const l of CENSUS) {
			const band = breakableLootBand(l.floor);
			const list = loot(l);
			const rooms = roomsWithPieces(l);
			expect(list.size() <= band.max).toBe(true);
			expect(list.size() >= math.min(band.min, rooms)).toBe(true);
			const seen = new Set<number>();
			let last = -1;
			for (const e of list) {
				expect(e.slot > last && e.slot < pieces(l).size()).toBe(true);
				last = e.slot;
				expect(e.kind >= 0 && e.kind < BREAKABLE_LOOT.kindWeights.size()).toBe(true);
				const id = roomIdOf(l.encounter, pieces(l)[e.slot]);
				expect(id >= 0).toBe(true);
				expect(seen.has(id)).toBe(false);
				seen.add(id);
				// roomAt and the Forge's own room grid agree on the piece's room.
				const b = pieces(l)[e.slot];
				expect(l.dungeon.roomId[b.y * l.dungeon.W + b.x]).toBe(id);
			}
		}
	});

	it("a hand-built floor: the cap holds per room, a piece in no room is uncapped, weights by kind", () => {
		const enc: EncounterConfig = { ...EMPTY_ENCOUNTER, rooms: [room(0, 0, 0, 3)] };
		const inRoom: BreakablePlacement[] = [
			{ x: 0, y: 0, kind: "crate" },
			{ x: 1, y: 0, kind: "crate" },
			{ x: 2, y: 0, kind: "barrel" },
		];
		const loose: BreakablePlacement[] = [
			{ x: 50, y: 50, kind: "barrel" },
			{ x: 52, y: 50, kind: "barrel" },
		];
		for (let seed = 1; seed <= 60; seed++) {
			// One room, ruined band (1-3): always exactly one.
			expect(placeBreakableLoot(seed, 12, inRoom, enc).size()).toBe(1);
			// Two loose pieces: as many as the draw asks for, up to 2.
			const t = twin(seed, 12, loose, enc);
			expect(placeBreakableLoot(seed, 12, loose, enc)).toEqual(t.loot);
		}
		let crate = 0;
		let barrel = 0;
		for (let seed = 1; seed <= 3000; seed++) {
			const out = placeBreakableLoot(seed, 12, inRoom, enc);
			if (inRoom[out[0].slot].kind === BREAKABLE_KINDS[1]) crate++;
			else barrel++;
		}
		// Weights 2 + 2 + 1: crates 4 / 5 of the picks.
		expect(math.abs(crate / (crate + barrel) - 0.8) < 0.03).toBe(true);
	});

	it("census: crates loaded about twice as often as barrels; every boost kind reachable, near 3 : 3 : 3 : 2", () => {
		let crates = 0;
		let barrels = 0;
		let crateLoaded = 0;
		let barrelLoaded = 0;
		const kinds = [0, 0, 0, 0];
		let total = 0;
		for (const l of CENSUS) {
			for (const b of pieces(l)) {
				if (b.kind === "crate") crates++;
				else barrels++;
			}
			for (const e of loot(l)) {
				if (pieces(l)[e.slot].kind === "crate") crateLoaded++;
				else barrelLoaded++;
				kinds[e.kind]++;
				total++;
			}
		}
		const ratio = crateLoaded / crates / (barrelLoaded / barrels);
		print(
			`[breakable loot] census ${CENSUS.size()} floors: ${total} loaded (${string.format(
				"%.2f",
				total / CENSUS.size(),
			)} per floor), crate / barrel load rate ${string.format("%.2f", ratio)}, kinds ${kinds.join(" / ")}`,
		);
		expect(ratio > 1.3 && ratio < 3).toBe(true);
		for (const n of kinds) expect(n).toBeGreaterThan(0);
		// Aegis (weight 2) the rarest, loosely.
		expect(kinds[3] < math.max(kinds[0], kinds[1], kinds[2])).toBe(true);
	});

	it("BL0 census: pieces per floor by band at roomScale 2, rooms with pieces, floors that cannot place the band max", () => {
		const names = ["kept", "worn", "ruined", "abyss"];
		const stats = new Map<
			string,
			{ floors: number; pieces: number; rooms: number; minRooms: number; short: number; loot: number }
		>();
		for (const l of CENSUS) {
			const band = breakableLootBand(l.floor);
			let bandIdx = 0;
			for (let i = 0; i < BREAKABLE_LOOT.bands.size(); i++) if (BREAKABLE_LOOT.bands[i] === band) bandIdx = i;
			const name = names[bandIdx];
			const e = stats.get(name) ?? { floors: 0, pieces: 0, rooms: 0, minRooms: math.huge, short: 0, loot: 0 };
			const rooms = roomsWithPieces(l);
			e.floors++;
			e.pieces += pieces(l).size();
			e.rooms += rooms;
			e.minRooms = math.min(e.minRooms, rooms);
			if (rooms < band.max) e.short++;
			e.loot += loot(l).size();
			stats.set(name, e);
		}
		for (const name of names) {
			const e = stats.get(name)!;
			print(
				`[breakable loot] ${name}: ${string.format(
					"%.1f",
					e.pieces / e.floors,
				)} pieces per floor in ${string.format("%.1f", e.rooms / e.floors)} rooms (min ${e.minRooms}), ${
					e.short
				}/${e.floors} floors with fewer rooms than the band max, ${string.format(
					"%.2f",
					e.loot / e.floors,
				)} loaded per floor`,
			);
			expect(e.floors).toBeGreaterThan(0);
		}
	});
});
