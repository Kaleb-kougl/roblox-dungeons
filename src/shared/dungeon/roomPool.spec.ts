// The endless room pool (docs/ENEMY_VARIANTS.md EV5, EVD2): the original three kinds and weights unchanged, the new
// kinds appended with named unlock floors, the spender skipping a kind below its floor or at its room maximum, wide
// bodies placed only on open tiles (8 FLOOR neighbours), WIDE_BODY_KINDS matching the sim's radii.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ENDLESS_ROOM_ACTOR_CAP,
	ENDLESS_ROOM_KINDS,
	ROOM_KIND_UNLOCK_FLOOR,
	SUMMONERS_PER_ROOM,
	WIDE_BODY_KINDS,
	EncounterRng,
	buildEndlessFloor,
	encounterCost,
	encounterRooms,
	endlessFloorParams,
	generateDungeon,
	isOpenTile,
	populateEndlessRoom,
	roomFloorTiles,
	spendEncounterBudget,
	worldToGrid,
	type Dungeon,
	type ForgeParams,
	type RoomTools,
	type TileXZ,
} from "shared/dungeon";
import { archetypeAt, archetypeIndex } from "shared/sim";

/** Body radius above which a body on a tile centre reaches past the tile's edge. */
const HALF_TILE = 0.5;

const generated = new Map<string, Dungeon>();
function dungeonFor(p: ForgeParams): Dungeon {
	const key = `${p.seed}/${p.roomCount}`;
	let d = generated.get(key);
	if (d === undefined) {
		d = generateDungeon(p);
		generated.set(key, d);
	}
	return d;
}

function costOf(kinds: ReadonlyArray<string>): number {
	let c = 0;
	for (const k of kinds) c += encounterCost(k);
	return c;
}

function count(kinds: ReadonlyArray<string>, kind: string): number {
	let n = 0;
	for (const k of kinds) if (k === kind) n++;
	return n;
}

describe("ENDLESS_ROOM_KINDS", () => {
	it("keeps the original three and their weights first, then imp / slime / summoner (EVD2)", () => {
		expect(ENDLESS_ROOM_KINDS.map((k) => [k.kind, k.weight, k.fromFloor ?? 1, k.maxPerRoom ?? 0])).toEqual([
			["swarmer", 3, 1, 0],
			["sniper", 2, 1, 0],
			["bruiser", 1, 1, 0],
			["imp", 2, 2, 0],
			["slime", 1, 4, 0],
			["summoner", 1, 6, 1],
		]);
		expect([ROOM_KIND_UNLOCK_FLOOR.imp, ROOM_KIND_UNLOCK_FLOOR.slime, ROOM_KIND_UNLOCK_FLOOR.summoner]).toEqual([
			2, 4, 6,
		]);
		expect(SUMMONERS_PER_ROOM).toBe(1);
	});

	it("WIDE_BODY_KINDS are exactly the room kinds whose sim radius is over half a tile", () => {
		const wide: string[] = [];
		for (const k of ENDLESS_ROOM_KINDS) {
			const r = archetypeAt(archetypeIndex(k.kind)).data.radius;
			if (r > HALF_TILE) wide.push(k.kind);
			expect([k.kind, WIDE_BODY_KINDS.has(k.kind)]).toEqual([k.kind, r > HALF_TILE]);
		}
		expect(wide).toEqual(["slime"]);
	});
});

describe("spendEncounterBudget by floor", () => {
	it("never buys a kind below its floor or a second summoner; stays within the budget and the cap", () => {
		for (let floor = 1; floor <= 8; floor++)
			for (let seed = 1; seed <= 150; seed++) {
				const budget = 6 + (seed % 40) * 1.7;
				const a = spendEncounterBudget(new EncounterRng(seed), budget, floor);
				expect(a).toEqual(spendEncounterBudget(new EncounterRng(seed), budget, floor));
				expect(costOf(a) <= budget).toBe(true);
				expect(a.size() <= ENDLESS_ROOM_ACTOR_CAP).toBe(true);
				if (a.size() < ENDLESS_ROOM_ACTOR_CAP) expect(budget - costOf(a) < 1).toBe(true);
				for (const k of ENDLESS_ROOM_KINDS)
					if (k.fromFloor !== undefined && floor < k.fromFloor)
						expect([floor, k.kind, count(a, k.kind)]).toEqual([floor, k.kind, 0]);
				expect(count(a, "summoner") <= SUMMONERS_PER_ROOM).toBe(true);
			}
	});

	it("a budget the cap cannot hold buys the dearest open kinds: one summoner at most, the rest bruisers / oozes", () => {
		let summoners = 0;
		for (let seed = 1; seed <= 100; seed++) {
			const big = spendEncounterBudget(new EncounterRng(seed), 3 * ENDLESS_ROOM_ACTOR_CAP, 20);
			expect(big.size()).toBe(ENDLESS_ROOM_ACTOR_CAP);
			for (const k of big) expect(encounterCost(k)).toBe(3);
			expect(count(big, "summoner") <= SUMMONERS_PER_ROOM).toBe(true);
			summoners += count(big, "summoner");
		}
		// With bruiser 1 / slime 1 / summoner 1 by weight, nearly every such room takes its one summoner.
		expect(summoners > 90).toBe(true);
	});

	it("the new kinds each turn up from their floor", () => {
		const seen = new Map<string, number>();
		for (let seed = 1; seed <= 200; seed++)
			for (const k of spendEncounterBudget(new EncounterRng(seed), 20, 6)) seen.set(k, (seen.get(k) ?? 0) + 1);
		for (const k of ENDLESS_ROOM_KINDS) expect([k.kind, (seen.get(k.kind) ?? 0) > 0]).toEqual([k.kind, true]);
	});
});

describe("wide bodies stand on open tiles", () => {
	it("a tiny room's fallback tiles: a slime only takes an open one, and placement stops when none is left", () => {
		const d = generateDungeon(endlessFloorParams(1, 8));
		const rooms = encounterRooms(d);
		let checked = 0;
		for (const room of rooms) {
			if (room.type !== "combat" && room.type !== "elite") continue;
			if (room.id === d.entrance || room.id === d.boss) continue;
			const all = roomFloorTiles(d, room.id);
			const open = all.filter((t) => isOpenTile(d, t));
			const edge = all.filter((t) => !isOpenTile(d, t));
			if (open.size() < 1 || edge.size() < 6) continue;
			// Seven tiles, one of them open: fewer than MIN_TILES open tiles, so roomSpawnTiles falls back to all seven.
			const keep = new Set<TileXZ>([open[0], ...edge.filter((_, i) => i < 6)]);
			const tiles = all.filter((t) => keep.has(t));
			for (let seed = 1; seed <= 40; seed++) {
				const tools: RoomTools = {
					dungeon: d,
					rng: new EncounterRng(seed),
					floor() {
						return tiles;
					},
					center() {
						return { x: room.cx, z: room.cz };
					},
				};
				const kinds = spendEncounterBudget(new EncounterRng(seed), 21.6, 8);
				const spawns = populateEndlessRoom(room, tools, 21.6, 8);
				for (let i = 0; i < spawns.size(); i++) {
					expect(spawns[i].kind).toBe(kinds[i]);
					if (WIDE_BODY_KINDS.has(spawns[i].kind)) expect(isOpenTile(d, spawns[i])).toBe(true);
				}
				// Stopped early with tiles to spare: only because the next kind is wide and no open tile is free.
				if (spawns.size() < math.min(kinds.size(), tiles.size()))
					expect(WIDE_BODY_KINDS.has(kinds[spawns.size()])).toBe(true);
				if (count(kinds, "slime") > 0) checked++;
			}
			break;
		}
		expect(checked > 10).toBe(true);
	});

	it("on built floors every slime has 8 FLOOR neighbours and no breakable beside it (runs 1-6, floors 4-9, party 1 and 4)", () => {
		let slimes = 0;
		for (let run = 1; run <= 6; run++)
			for (let floor = 4; floor <= 9; floor++)
				for (const party of [1, 4]) {
					const fl = buildEndlessFloor(run, floor, dungeonFor, party);
					for (const room of fl.roomSpawns)
						for (const s of room) {
							if (!WIDE_BODY_KINDS.has(s.kind)) continue;
							slimes++;
							expect(isOpenTile(fl.dungeon, s)).toBe(true);
							for (const b of fl.breakables ?? [])
								expect(
									math.max(math.abs(b.x - worldToGrid(s.x)), math.abs(b.y - worldToGrid(s.z))) > 1,
								).toBe(true);
						}
				}
		expect(slimes > 50).toBe(true);
	});
});
