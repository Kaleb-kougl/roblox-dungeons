/**
 * Tile collision: the dungeon-1337.json query vectors bit for bit (moveCircle = the sim's circleMover / actorMover,
 * isBulletBlocked = bulletBlocker, lineOfSight), plus the web build's src/dungeon/collision.test.ts and the bullet
 * blocker test of src/bullets/setup.test.ts, ported to jest-globals.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import dungeon1337 from "shared/fixtures-generated/dungeon-1337";
import {
	KALEB_VALE_MVP_PARAMS,
	TileType,
	actorMover,
	bulletBlocker,
	circleMover,
	circleOverlapsWall,
	entranceSpawn,
	generateDungeon,
	isBulletBlocked,
	isWalkable,
	lineOfSight,
	moveCircle,
	mulberry32,
	tileAt,
	type Dungeon,
	type Room,
} from "shared/dungeon";
import { f64Hex, hexF64 } from "./fixtureDiff";

const PLAYER_RADIUS = 0.35;
const collision = dungeon1337.collision;

describe("collision vectors (dungeon-1337.json)", () => {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });

	it("moveCircle: 400 moves near walls, every radius, outputs bit-exact (also through circleMover / actorMover)", () => {
		const player = circleMover(d, PLAYER_RADIUS);
		const actors = actorMover(d);
		expect(collision.moveCircle.size()).toBe(400);
		collision.moveCircle.forEach((m, i) => {
			const [x, z, dx, dz, radius] = m.inHex.map(hexF64);
			const p = moveCircle(d, x, z, dx, dz, radius);
			expect([i, f64Hex(p.x), f64Hex(p.z)]).toEqual([i, m.outHex[0], m.outHex[1]]);
			const q = actors(x, z, dx, dz, radius);
			expect([i, f64Hex(q.x), f64Hex(q.z)]).toEqual([i, m.outHex[0], m.outHex[1]]);
			if (radius === PLAYER_RADIUS) {
				const r = player(x, z, dx, dz);
				expect([i, f64Hex(r.x), f64Hex(r.z)]).toEqual([i, m.outHex[0], m.outHex[1]]);
			}
		});
	});

	it("walk: 400 chained player moves from the entrance spawn, bit-exact after every call", () => {
		const dirs: ReadonlyArray<readonly [number, number]> = [
			[0.1, 0],
			[0, 0.1],
			[-0.1, 0],
			[0, -0.1],
			[0.0707, 0.0707],
			[-0.0707, 0.0707],
			[-0.0707, -0.0707],
			[0.0707, -0.0707],
		];
		const sp = entranceSpawn(d);
		let x = sp.x;
		let z = sp.z;
		expect(collision.walk.size()).toBe(400);
		collision.walk.forEach((want, i) => {
			const [dx, dz] = dirs[math.floor(i / 50)];
			const p = moveCircle(d, x, z, dx, dz, PLAYER_RADIUS);
			x = p.x;
			z = p.z;
			expect([i, f64Hex(x), f64Hex(z)]).toEqual([i, want[0], want[1]]);
		});
	});

	it("isBulletBlocked / bulletBlocker: 400 points, some exactly on tile edges", () => {
		const blocked = bulletBlocker(d);
		collision.isBulletBlocked.forEach((b, i) => {
			const [x, z] = b.inHex.map(hexF64);
			expect([i, isBulletBlocked(d, x, z), blocked(x, z)]).toEqual([i, b.blocked, b.blocked]);
		});
	});

	it("lineOfSight(bulletBlocker(d), ...): 300 segments", () => {
		const blocked = bulletBlocker(d);
		let clear = 0;
		collision.lineOfSight.forEach((l, i) => {
			const [x0, z0, x1, z1] = l.inHex.map(hexF64);
			const got = lineOfSight(blocked, x0, z0, x1, z1);
			expect([i, got]).toEqual([i, l.clear]);
			if (got) clear++;
		});
		// both outcomes are exercised
		expect(clear > 0 && clear < collision.lineOfSight.size()).toBe(true);
		expect(lineOfSight(undefined, 0, 0, 100, 100)).toBe(true);
	});
});

/** Hand-made dungeon from ASCII rows: '.' floor, '#' wall, '~' pool, ' ' void. */
function asciiDungeon(rows: ReadonlyArray<string>): Dungeon {
	const H = rows.size(),
		W = rows[0].size();
	const code: Record<string, number> = {
		" ": TileType.VOID,
		".": TileType.FLOOR,
		"#": TileType.WALL,
		"~": TileType.POOL,
	};
	const grid = new Array<number>(W * H, 0);
	rows.forEach((row, y) => {
		for (let x = 0; x < W; x++) grid[y * W + x] = code[string.sub(row, x + 1, x + 1)];
	});
	const room: Room = {
		id: 0,
		cx: 2,
		cy: 2,
		w: 3,
		h: 3,
		arch: "s",
		shape: "rect",
		sx0: 2,
		sy0: 2,
		type: "entrance",
		depth: 0,
		difficulty: 0,
		degree: 0,
	};
	return {
		valid: true,
		params: { seed: 0, roomCount: 1, loopChance: 0, decorDensity: 0, themeKey: "ancient" },
		seed: 0,
		name: "test",
		W,
		H,
		grid,
		roomId: new Array<number>(W * H, -1),
		corridor: new Array<number>(W * H, 0),
		doorway: new Array<number>(W * H, 0),
		bfs: new Array<number>(W * H, 0),
		maxBfs: 0,
		rooms: [room],
		edges: [],
		entrance: 0,
		boss: 0,
		maxDepth: 1,
		props: [],
		spawns: [],
		torches: [],
		pools: [],
		lakeCells: [],
		lakeMask: new Array<number>(W * H, 0),
		arches: [],
		stats: { rooms: 1, edges: 0, loops: 0, critLen: 0, floorTiles: 0, reach: 0, genMs: 0, attempts: 1 },
	};
}

const BOX = asciiDungeon(["#######", "#.....#", "#.....#", "#..~..#", "#.....#", "#######"]);

/** |a - b| < 10^-digits / 2, like jest's toBeCloseTo(b, digits). */
function close(a: number, b: number, digits = 12): boolean {
	return math.abs(a - b) < 10 ** -digits / 2;
}

describe("tileAt / isWalkable (collision.test.ts)", () => {
	it("reads tiles and treats out-of-grid as VOID", () => {
		expect(tileAt(BOX, 0, 0)).toBe(TileType.WALL);
		expect(tileAt(BOX, 1, 1)).toBe(TileType.FLOOR);
		expect(tileAt(BOX, 3, 3)).toBe(TileType.POOL);
		expect(tileAt(BOX, -1, 2)).toBe(TileType.VOID);
		expect(tileAt(BOX, 7, 2)).toBe(TileType.VOID);
	});
	it("maps world (x, z) to the tile centered on (gx, gy)", () => {
		expect(isWalkable(BOX, 1, 1)).toBe(true);
		expect(isWalkable(BOX, 0.51, 1.49)).toBe(true);
		expect(isWalkable(BOX, 0.49, 1)).toBe(false); // wall tile 0 spans [-0.5, 0.5)
		expect(isWalkable(BOX, 3, 3)).toBe(false); // POOL is not walkable (for now)
	});
});

describe("moveCircle (collision.test.ts)", () => {
	it("stops flush against a wall face", () => {
		const p = moveCircle(BOX, 4.9, 2, 0.5, 0, 0.3); // wall tile x=6 starts at 5.5
		expect(close(p.x, 5.2)).toBe(true);
		expect(p.z).toBe(2);
		const q = moveCircle(BOX, p.x, p.z, 0.5, 0, 0.3);
		expect(close(q.x, 5.2)).toBe(true);
	});
	it("slides along a wall when moving diagonally into it", () => {
		const p = moveCircle(BOX, 5.2, 2, 0.4, 0.3, 0.3);
		expect(close(p.x, 5.2)).toBe(true);
		expect(close(p.z, 2.3)).toBe(true);
	});
	it("treats pools as solid", () => {
		const p = moveCircle(BOX, 3, 1.9, 0, 0.5, 0.25); // pool tile (3,3) starts at z=2.5
		expect(close(p.z, 2.25)).toBe(true);
	});
	it("lets an entity that starts overlapping a wall walk out", () => {
		const p = moveCircle(BOX, 1.1, 2, 0.2, 0, 0.3);
		expect(close(p.x, 1.3)).toBe(true);
	});
	it("never ends inside a wall over randomized moves on generated floors (steps up to 0.5)", () => {
		const rand = mulberry32(2024);
		let clipped = 0;
		let moves = 0;
		let firstFailure: string | undefined;
		for (let s = 0; s < 25; s++) {
			const d = generateDungeon({ seed: 1000 + s * 31, ...KALEB_VALE_MVP_PARAMS });
			const start = entranceSpawn(d);
			let x = start.x,
				z = start.z;
			const radius = 0.1 + rand() * 0.39;
			// Wander with a persistent heading so the circle actually reaches and scrapes walls.
			let hx = rand() - 0.5,
				hz = rand() - 0.5;
			for (let i = 0; i < 3000; i++) {
				if (rand() < 0.05) {
					hx = rand() - 0.5;
					hz = rand() - 0.5;
				}
				const k = rand();
				const dx = math.max(-0.5, math.min(0.5, hx * k + (rand() - 0.5) * 0.2));
				const dz = math.max(-0.5, math.min(0.5, hz * k + (rand() - 0.5) * 0.2));
				const p = moveCircle(d, x, z, dx, dz, radius);
				moves++;
				if (firstFailure === undefined) {
					const where = `floor ${s} move ${i}: (${x}, ${z}) + (${dx}, ${dz}) r ${radius} -> (${p.x}, ${p.z})`;
					if (math.abs(p.x - x) > math.abs(dx) + 1e-9 || math.abs(p.z - z) > math.abs(dz) + 1e-9)
						firstFailure = `moved too far, ${where}`;
					else if (!isWalkable(d, p.x, p.z)) firstFailure = `ended on an unwalkable tile, ${where}`;
					else if (circleOverlapsWall(d, p.x, p.z, radius)) firstFailure = `overlaps a wall, ${where}`;
				}
				if (math.abs(p.x - x) < math.abs(dx) - 1e-9 || math.abs(p.z - z) < math.abs(dz) - 1e-9) clipped++;
				x = p.x;
				z = p.z;
			}
		}
		expect(firstFailure).toBeUndefined();
		expect(moves).toBe(25 * 3000);
		// The walk really does scrape walls (otherwise this test proves nothing).
		expect(clipped).toBeGreaterThan(2000);
	});
	it("does not tunnel through a one-tile wall even at max step", () => {
		const thin = asciiDungeon(["#####", "#.#.#", "#####"]);
		for (let i = 0; i < 20; i++) {
			const p = moveCircle(thin, 1, 1, 0.5, 0, 0.05);
			expect(p.x <= 1.45 + 1e-12).toBe(true);
		}
	});
});

describe("entranceSpawn (collision.test.ts)", () => {
	it("is on a walkable tile in the entrance room", () => {
		for (let seed = 0; seed < 50; seed++) {
			const d = generateDungeon({ seed, ...KALEB_VALE_MVP_PARAMS });
			const s = entranceSpawn(d);
			expect(isWalkable(d, s.x, s.z)).toBe(true);
			expect(d.roomId[s.z * d.W + s.x]).toBe(d.entrance);
		}
	});
});

describe("bullet blocker (setup.test.ts)", () => {
	it("blocks WALL and VOID (and outside the grid), lets FLOOR and POOL through", () => {
		const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });
		const blocked = bulletBlocker(d);
		const seen = new Set<number>();
		for (let gy = 0; gy < d.H; gy++)
			for (let gx = 0; gx < d.W; gx++) {
				const t = tileAt(d, gx, gy);
				seen.add(t);
				if (blocked(gx + 0.3, gy - 0.2) !== (t === TileType.WALL || t === TileType.VOID))
					expect(`tile ${gx},${gy}`).toBe("consistent");
			}
		expect(seen.has(TileType.WALL) && seen.has(TileType.FLOOR) && seen.has(TileType.VOID)).toBe(true);
		expect(isBulletBlocked(d, -5, -5)).toBe(true);
		expect(isBulletBlocked(d, d.W + 3, 2)).toBe(true);
	});
});
