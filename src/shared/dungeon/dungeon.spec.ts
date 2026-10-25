/**
 * "Any seed produces a playable floor": the web build's src/dungeon/dungeon.test.ts ported to jest-globals (structural
 * properties over many seeds, for the demo's default params and for the Kaleb-Vale MVP preset), plus the determinism
 * smoke test (seeds 1..50 generated twice, deep-compared). seedFromQuery is not ported (no URL query on Roblox).
 *
 * Seed counts: the MVP preset keeps the web test's 200 seeds; the 42-room demo preset runs DEMO_SEEDS of them, because a
 * 42-room floor costs ~10x an MVP floor under Lune (the web test's 200 would take minutes headlessly).
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	FORGE_DEMO_DEFAULT_PARAMS,
	KALEB_VALE_MVP_PARAMS,
	RoomType,
	TileType,
	bossRoom,
	entranceSpawn,
	generateDungeon,
	isWalkable,
	isWalkableTile,
	tileAt,
	type Dungeon,
	type ForgeParams,
} from "shared/dungeon";
import { firstDiff } from "./fixtureDiff";

const MVP_SEEDS: number[] = [];
for (let i = 0; i < 200; i++) MVP_SEEDS.push(i * 7919 + 1);
const DEMO_SEEDS = 25;

function firstN<T extends defined>(arr: ReadonlyArray<T>, n: number): T[] {
	const out: T[] = [];
	for (let i = 0; i < math.min(n, arr.size()); i++) out.push(arr[i]);
	return out;
}

const PRESETS: ReadonlyArray<[string, Omit<ForgeParams, "seed">, ReadonlyArray<number>]> = [
	["demo defaults", FORGE_DEMO_DEFAULT_PARAMS, firstN(MVP_SEEDS, DEMO_SEEDS)],
	["Kaleb-Vale MVP", KALEB_VALE_MVP_PARAMS, MVP_SEEDS],
];

/** BFS over walkable tiles (4-neighbour) from a grid cell; returns visited flags. */
function flood(d: Dungeon, gx: number, gy: number): boolean[] {
	const seen = new Array<boolean>(d.W * d.H, false);
	const q = [gy * d.W + gx];
	seen[q[0]] = true;
	let h = 0;
	while (h < q.size()) {
		const c = q[h++];
		const x = c % d.W;
		const y = (c - x) / d.W;
		for (const [nx, ny] of [
			[x + 1, y],
			[x - 1, y],
			[x, y + 1],
			[x, y - 1],
		]) {
			if (!isWalkableTile(tileAt(d, nx, ny))) continue;
			const n = ny * d.W + nx;
			if (!seen[n]) {
				seen[n] = true;
				q.push(n);
			}
		}
	}
	return seen;
}

/** Every corridor cell sits inside some fully walkable 3x3 block (clearance >= 3 tiles). */
function corridorsAtLeast3Wide(d: Dungeon): boolean {
	const ok3x3 = (cx: number, cy: number) => {
		for (let y = cy - 1; y <= cy + 1; y++)
			for (let x = cx - 1; x <= cx + 1; x++) if (!isWalkableTile(tileAt(d, x, y))) return false;
		return true;
	};
	for (let c = 0; c < d.corridor.size(); c++) {
		if (d.corridor[c] === 0) continue;
		const x = c % d.W,
			y = (c - x) / d.W;
		let covered = false;
		for (let oy = -1; oy <= 1 && !covered; oy++)
			for (let ox = -1; ox <= 1 && !covered; ox++) covered = ok3x3(x + ox, y + oy);
		if (!covered) return false;
	}
	return true;
}

function countType(d: Dungeon, roomType: RoomType): number {
	return d.rooms.filter((r) => r.type === roomType).size();
}

/** The critical edges form a path of rooms from the entrance to the boss. */
function criticalPathConnects(d: Dungeon): boolean {
	const seen = new Array<boolean>(d.rooms.size(), false);
	const q = [d.entrance];
	seen[d.entrance] = true;
	let h = 0;
	while (h < q.size()) {
		const a = q[h++];
		for (const e of d.edges) {
			if (!e.isCritical) continue;
			const b = e.a === a ? e.b : e.b === a ? e.a : -1;
			if (b >= 0 && !seen[b]) {
				seen[b] = true;
				q.push(b);
			}
		}
	}
	return seen[d.boss];
}

/** The MVP floors of the preset loop, reused by the option checks (generation dominates this spec's time). */
let mvpFloors: Dungeon[] = [];

for (const [label, preset, seeds] of PRESETS) {
	describe(`${label}: ${seeds.size()} seeds`, () => {
		const floors = seeds.map((seed) => generateDungeon({ seed, ...preset }));
		if (preset === KALEB_VALE_MVP_PARAMS) mvpFloors = floors;

		it("every floor is valid (fully connected) and unique per room roles", () => {
			for (const d of floors) {
				expect(d.valid).toBe(true);
				expect(d.stats.reach).toBe(d.stats.floorTiles);
				expect(countType(d, RoomType.ENTRANCE)).toBe(1);
				expect(countType(d, RoomType.BOSS)).toBe(1);
				expect(d.rooms[d.entrance].type).toBe(RoomType.ENTRANCE);
				expect(bossRoom(d).type).toBe(RoomType.BOSS);
				expect(d.entrance).never.toBe(d.boss);
			}
		});

		it("the boss room is reachable from the entrance spawn over walkable tiles", () => {
			for (const d of floors) {
				const s = entranceSpawn(d);
				expect(isWalkable(d, s.x, s.z)).toBe(true);
				const seen = flood(d, s.x, s.z);
				let bossTiles = 0,
					reached = 0;
				for (let c = 0; c < seen.size(); c++)
					if (d.roomId[c] === d.boss && d.grid[c] === TileType.FLOOR) {
						bossTiles++;
						if (seen[c]) reached++;
					}
				expect(bossTiles).toBeGreaterThan(0);
				expect(reached).toBe(bossTiles);
			}
		});

		it("is deterministic: same seed twice gives identical grid bytes, rooms and spawns", () => {
			for (let i = 0; i < math.min(50, floors.size()); i++) {
				const d = floors[i];
				const again = generateDungeon({ seed: d.params.seed, ...preset });
				expect(firstDiff(d.grid, again.grid)).toBeUndefined();
				expect(firstDiff(d.rooms, again.rooms)).toBeUndefined();
				expect(firstDiff(d.spawns, again.spawns)).toBeUndefined();
			}
		});
	});
}

describe("Kaleb-Vale MVP options", () => {
	const mvp = mvpFloors;

	it("caps treasure rooms at 2 and shrines at 1", () => {
		expect(mvp.size()).toBe(MVP_SEEDS.size());
		for (const d of mvp) {
			expect(countType(d, RoomType.TREASURE) <= 2).toBe(true);
			expect(countType(d, RoomType.SHRINE) <= 1).toBe(true);
			expect(d.rooms.size()).toBe(12);
		}
		// The caps bind for some seeds (the original allows 4 treasure / 2 shrines).
		const uncapped = MVP_SEEDS.map((seed) =>
			generateDungeon({ seed, ...FORGE_DEMO_DEFAULT_PARAMS, roomCount: 12 }),
		);
		expect(uncapped.some((d) => countType(d, RoomType.TREASURE) > 2)).toBe(true);
	});

	it("combat and elite rooms are at least 8x8", () => {
		for (const d of mvp)
			for (const r of d.rooms)
				if (r.type === RoomType.COMBAT || r.type === RoomType.ELITE) {
					expect(r.w >= 8 && r.h >= 8).toBe(true);
				}
	});

	it("every corridor is 3 tiles wide", () => {
		for (const d of mvp) expect(corridorsAtLeast3Wide(d)).toBe(true);
		// Sanity: the check does fail on the original's 1- and 2-wide corridors.
		const orig = firstN(MVP_SEEDS, 40).map((seed) =>
			generateDungeon({ seed, ...FORGE_DEMO_DEFAULT_PARAMS, roomCount: 12 }),
		);
		expect(orig.some((d) => !corridorsAtLeast3Wide(d))).toBe(true);
	});

	it("options default off: omitting them reproduces the plain generator", () => {
		const plain = generateDungeon({ seed: 1337, roomCount: 12, loopChance: 0.15, decorDensity: 0.4 });
		const explicitUndefined = generateDungeon({
			seed: 1337,
			roomCount: 12,
			loopChance: 0.15,
			decorDensity: 0.4,
			minCombatRoomSize: undefined,
			corridorWidth: undefined,
			treasureCap: undefined,
			shrineCap: undefined,
		});
		expect(firstDiff(plain.grid, explicitUndefined.grid)).toBeUndefined();
	});

	it("rejects nonsense params", () => {
		expect(() => generateDungeon({ seed: 1, roomCount: 1, loopChance: 0, decorDensity: 0 })).toThrow("RangeError");
		expect(() =>
			generateDungeon({ seed: 1, roomCount: 12, loopChance: 0, decorDensity: 0, corridorWidth: 0 }),
		).toThrow("RangeError");
		expect(() => generateDungeon({ seed: 1, roomCount: 12.5, loopChance: 0, decorDensity: 0 })).toThrow(
			"RangeError",
		);
	});
});

describe("determinism smoke: seeds 1..50 twice", () => {
	it("generates identical floors, each with an entrance, a boss room and a connected critical path", () => {
		for (let seed = 1; seed <= 50; seed++) {
			const a = generateDungeon({ seed, ...KALEB_VALE_MVP_PARAMS });
			const b = generateDungeon({ seed, ...KALEB_VALE_MVP_PARAMS });
			const diff = firstDiff(a, b);
			if (diff !== undefined) expect(`seed ${seed}: ${diff}`).toBe(`seed ${seed}: identical`);
			expect(a.rooms[a.entrance].type).toBe(RoomType.ENTRANCE);
			expect(a.rooms[a.boss].type).toBe(RoomType.BOSS);
			expect(criticalPathConnects(a)).toBe(true);
			expect(a.stats.critLen).toBeGreaterThan(0);
			expect(a.valid).toBe(true);
		}
	});
});
