// Solid pillars on endless floors (ForgeParams.solidPillars, docs/DECOR.md D2): the conversion after decoration keeps
// the rng stream and every other piece, keeps the floor connected, and nothing on an endless floor stands on a pillar;
// pillars block sight, bullets and bodies, and the steering mover walks enemies around them.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ENDLESS_SOLID_PILLARS,
	KALEB_VALE_MVP_PARAMS,
	TILE_SIZE,
	TileType,
	buildEndlessFloor,
	bulletBlocker,
	circleOverlapsWall,
	endlessFloorParams,
	generateDungeon,
	gridToWorld,
	isBulletBlocked,
	isWalkable,
	lineOfSight,
	makeRng,
	moveCircle,
	moveCircleAroundCorners,
	tileAt,
	worldToGrid,
	type Dungeon,
	type EndlessFloorLayout,
	type ForgeParams,
	type Prop,
} from "shared/dungeon";

const RUNS = 12;
const FLOORS = 6;

interface Pair {
	params: ForgeParams;
	off: Dungeon;
	on: Dungeon;
}

const floorPairs: Pair[] = [];
for (let run = 1; run <= RUNS; run++)
	for (let floor = 1; floor <= FLOORS; floor++) {
		const params = endlessFloorParams(run * 7919, floor);
		floorPairs.push({
			params,
			// solid decor off in both: it reads the walled grid (./solidDecor.spec.ts has its own)
			off: generateDungeon({ ...params, solidPillars: false, solidDecor: false }),
			on: generateDungeon({ ...params, solidDecor: false }),
		});
	}

function pillarsOf(d: Dungeon): Prop[] {
	return d.props.filter((pr) => pr.kind === "pillar");
}

function isPillarCell(d: Dungeon, gx: number, gy: number): boolean {
	return d.props.some((pr) => pr.kind === "pillar" && pr.x === gx && pr.y === gy);
}

/** Every FLOOR cell reachable from the entrance center over FLOOR (4-neighbour), computed here independently. */
function allFloorConnected(d: Dungeon): boolean {
	const e = d.rooms[d.entrance];
	const seen = new Array<boolean>(d.W * d.H, false);
	const q: number[] = [e.cy * d.W + e.cx];
	seen[q[0]] = true;
	let h = 0;
	while (h < q.size()) {
		const c = q[h++];
		const x = c % d.W;
		const y = math.floor(c / d.W);
		for (const [ox, oy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		]) {
			const nx = x + ox,
				ny = y + oy;
			if (tileAt(d, nx, ny) !== TileType.FLOOR) continue;
			const n = ny * d.W + nx;
			if (seen[n]) continue;
			seen[n] = true;
			q.push(n);
		}
	}
	for (let i = 0; i < d.W * d.H; i++) if (d.grid[i] === TileType.FLOOR && !seen[i]) return false;
	return true;
}

describe("solidPillars (Forge option)", () => {
	it("is on for endless floors only: M1's preset leaves it off", () => {
		expect(ENDLESS_SOLID_PILLARS).toBe(true);
		expect(endlessFloorParams(1337, 1).solidPillars).toBe(true);
		expect((KALEB_VALE_MVP_PARAMS as ForgeParams).solidPillars).toBe(undefined);
	});

	it("off (false) is the same floor as undefined (the demo / fixture path)", () => {
		for (const seed of [1337, 42, 7]) {
			const a = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
			const b = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed, solidPillars: false });
			expect(b.grid).toEqual(a.grid);
			expect(b.bfs).toEqual(a.bfs);
			expect(b.props).toEqual(a.props);
			expect(b.spawns).toEqual(a.spawns);
			expect(b.stats).toEqual(a.stats);
		}
	});

	it("the endless census has pillars to test (not vacuous)", () => {
		let n = 0;
		for (const pr of floorPairs) n += pillarsOf(pr.on).size();
		expect(n).toBeGreaterThan(RUNS * FLOORS);
	});

	it("draws nothing: the same attempt, rooms, edges, props, spawns, torches, arches, pools and name as off", () => {
		for (const { off, on } of floorPairs) {
			expect(on.seed).toBe(off.seed);
			expect(on.stats.attempts).toBe(off.stats.attempts); // no reroll caused by the walls
			expect(on.name).toBe(off.name);
			expect(on.rooms).toEqual(off.rooms);
			expect(on.edges).toEqual(off.edges);
			expect(on.props).toEqual(off.props);
			expect(on.spawns).toEqual(off.spawns);
			expect(on.torches).toEqual(off.torches);
			expect(on.arches).toEqual(off.arches);
			expect(on.pools).toEqual(off.pools);
			expect(on.lakeCells).toEqual(off.lakeCells);
			expect(on.lakeMask).toEqual(off.lakeMask);
			expect(on.roomId).toEqual(off.roomId); // a pillar cell keeps its room id
			expect(on.corridor).toEqual(off.corridor);
			expect(on.doorway).toEqual(off.doorway);
		}
	});

	it("walls exactly the pillar cells (FLOOR before, WALL after), interior room cells away from doors", () => {
		for (const { off, on } of floorPairs) {
			const pillars = pillarsOf(on);
			let changed = 0;
			for (let i = 0; i < on.grid.size(); i++) if (on.grid[i] !== off.grid[i]) changed++;
			expect(changed).toBe(pillars.size());
			for (const pr of pillars) {
				const c = pr.y * on.W + pr.x;
				expect(off.grid[c]).toBe(TileType.FLOOR);
				expect(on.grid[c]).toBe(TileType.WALL);
				expect(on.roomId[c]).toBe(pr.roomId);
				expect(on.doorway[c]).toBe(0);
				expect(on.lakeMask[c]).toBe(0);
				for (let oy = -1; oy <= 1; oy++)
					for (let ox = -1; ox <= 1; ox++)
						if (ox !== 0 || oy !== 0) expect(tileAt(on, pr.x + ox, pr.y + oy)).toBe(TileType.FLOOR);
			}
		}
	});

	it("keeps the floor connected; bfs, maxBfs, floorTiles, reach and valid describe the walled grid", () => {
		for (const { off, on } of floorPairs) {
			expect(on.valid).toBe(true);
			expect(allFloorConnected(on)).toBe(true);
			const pillars = pillarsOf(on).size();
			expect(on.stats.floorTiles).toBe(off.stats.floorTiles - pillars);
			expect(on.stats.reach).toBe(on.stats.floorTiles);
			let maxBfs = 0;
			let bad = 0;
			for (let i = 0; i < on.grid.size(); i++) {
				if (on.grid[i] === TileType.FLOOR) {
					// reached, and a detour can only lengthen paths
					if (on.bfs[i] < 0 || on.bfs[i] < off.bfs[i]) bad++;
					if (on.bfs[i] > maxBfs) maxBfs = on.bfs[i];
				} else if (on.bfs[i] !== -1) bad++;
			}
			expect(bad).toBe(0);
			expect(on.maxBfs).toBe(maxBfs);
			if (pillars === 0) expect(on.bfs).toEqual(off.bfs);
		}
	});
});

describe("nothing on an endless floor stands on a pillar", () => {
	const layouts: EndlessFloorLayout[] = [];
	for (let run = 1; run <= RUNS; run++)
		for (let floor = 1; floor <= FLOORS; floor++)
			layouts.push(buildEndlessFloor(run * 7919, floor, generateDungeon));

	// a pillar a library's reading area cleared (Dungeon.clearedPillars, docs/BOOKSHELVES.md) is floor again: its prop
	// stays in `props`, but nothing stands there any more
	const onFloor = (d: Dungeon, x: number, z: number) => {
		const gx = worldToGrid(x);
		const gy = worldToGrid(z);
		const cleared = (d.clearedPillars ?? []).some((c) => c.x === gx && c.y === gy);
		return tileAt(d, gx, gy) === TileType.FLOOR && (cleared || !isPillarCell(d, gx, gy));
	};

	it("entrance spawn, stairwell, boss, pedestals (treasure centres) and the shrine are FLOOR, never a pillar", () => {
		for (const fl of layouts) {
			const d = fl.dungeon;
			expect(onFloor(d, fl.spawn.x, fl.spawn.z)).toBe(true);
			expect(onFloor(d, fl.stairwell.x, fl.stairwell.z)).toBe(true);
			for (const s of fl.encounter.spawns) expect(onFloor(d, s.x, s.z)).toBe(true);
			for (const room of fl.encounter.rooms) {
				// Every room centre the sim uses (pedestals, shrine, stairwell, boss, AI) is a floor tile of the room.
				expect(onFloor(d, room.cx, room.cz)).toBe(true);
				expect(d.roomId[worldToGrid(room.cz) * d.W + worldToGrid(room.cx)]).toBe(room.id);
			}
		}
	});

	it("deferred room spawns and their candidate tiles are FLOOR tiles, never a pillar", () => {
		let n = 0;
		for (const fl of layouts) {
			const d = fl.dungeon;
			for (let id = 0; id < fl.roomSpawns.size(); id++) {
				for (const s of fl.roomSpawns[id]) {
					expect(onFloor(d, s.x, s.z)).toBe(true);
					n++;
				}
				for (const t of fl.roomSpawnTiles[id]) expect(onFloor(d, t.x, t.z)).toBe(true);
			}
		}
		expect(n).toBeGreaterThan(0);
	});
});

/** The first pillar of the census with open floor all around it (5 x 5 tiles), and its floor. */
function firstPillar(): { d: Dungeon; px: number; pz: number } {
	for (const { on } of floorPairs)
		for (const p of pillarsOf(on)) {
			let open = true;
			for (let oy = -2; oy <= 2; oy++)
				for (let ox = -2; ox <= 2; ox++)
					if ((ox !== 0 || oy !== 0) && tileAt(on, p.x + ox, p.y + oy) !== TileType.FLOOR) open = false;
			if (open) return { d: on, px: gridToWorld(p.x), pz: gridToWorld(p.y) };
		}
	error("no open pillar in the census");
}

describe("a solid pillar is cover", () => {
	const { d, px, pz } = firstPillar();
	const blocked = bulletBlocker(d);

	it("blocks line of sight through it, not past it", () => {
		expect(lineOfSight(blocked, px - 1.5, pz, px + 1.5, pz)).toBe(false);
		expect(lineOfSight(blocked, px, pz - 1.5, px, pz + 1.5)).toBe(false);
		expect(lineOfSight(blocked, px - 1.5, pz - 1, px + 1.5, pz - 1)).toBe(true);
	});

	it("stops a bullet: its cell blocks, the cells around it don't", () => {
		expect(isBulletBlocked(d, px, pz)).toBe(true);
		expect(isBulletBlocked(d, px + 0.45, pz - 0.45)).toBe(true);
		expect(isBulletBlocked(d, px + 0.55, pz)).toBe(false);
		// a bullet marching at it is consumed at the pillar's face, never behind it
		let x = px - 1.5;
		while (!isBulletBlocked(d, x, pz)) x += 0.05;
		expect(x > px - 0.55 && x <= px - 0.45).toBe(true);
	});

	it("is not walkable, and a body (the player's roll included) stops at its face", () => {
		expect(isWalkable(d, px, pz)).toBe(false);
		for (const r of [0.3, 0.35, 0.5]) {
			let x = px - 1.5;
			for (let i = 0; i < 40; i++) x = moveCircle(d, x, pz, 0.1, 0, r).x; // 0.1 / call: the roll's sub-steps
			expect(x).toBeCloseTo(px - TILE_SIZE / 2 - r, 9);
		}
	});
});

describe("moveCircleAroundCorners: walking enemies round a pillar", () => {
	const { d, px, pz } = firstPillar();
	const STEP = 0.07; // a swarmer's walk per tick (4.2 u/s)

	/** Walks a circle at the target like walkToward; returns the ticks it took, or -1. */
	function walk(
		mover: typeof moveCircle,
		r: number,
		x0: number,
		z0: number,
		tx: number,
		tz: number,
		overlaps: { n: number },
		step = STEP,
	): number {
		let x = x0,
			z = z0;
		for (let t = 1; t <= 400; t++) {
			const dx = tx - x,
				dz = tz - z;
			const dist = math.sqrt(dx * dx + dz * dz);
			if (dist < 0.02) return t;
			const k = math.min(step, dist) / dist;
			const res = mover(d, x, z, dx * k, dz * k, r);
			x = res.x;
			z = res.z;
			if (circleOverlapsWall(d, x, z, r)) overlaps.n++;
		}
		return -1;
	}

	it("plain moveCircle stalls on the face when the target is right behind the pillar", () => {
		const o = { n: 0 };
		expect(walk(moveCircle, 0.3, px - 1.5, pz, px + 1.5, pz, o)).toBe(-1);
		expect(walk(moveCircle, 0.5, px, pz + 1.5, px, pz - 1.5, o)).toBe(-1);
	});

	it("reaches a target behind the pillar from every side, every enemy radius, any offset, never in a wall", () => {
		const o = { n: 0 };
		const sides: Array<[number, number]> = [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		];
		for (const r of [0.3, 0.35, 0.5])
			for (const [sx, sz] of sides)
				for (const off of [-0.6, -0.3, -0.1, 0, 0.1, 0.3, 0.6]) {
					// lateral offset across the approach axis
					const lx = sz !== 0 ? off : 0,
						lz = sx !== 0 ? off : 0;
					const ticks = walk(
						moveCircleAroundCorners,
						r,
						px - sx * 1.5 + lx,
						pz - sz * 1.5 + lz,
						px + sx * 1.5 - lx,
						pz + sz * 1.5 - lz,
						o,
					);
					expect([r, sx, sz, off, ticks > 0 && ticks < 120]).toEqual([r, sx, sz, off, true]);
				}
		expect(o.n).toBe(0);
	});

	it("gets across between any two points around the pillar (radii and walk speeds of every enemy), never in a wall", () => {
		const ring = (spacing: number) => {
			const out: Array<[number, number]> = [];
			const n = math.floor(1.5 / spacing + 0.5);
			for (let k = -n; k <= n; k++) {
				const t = k * spacing;
				out.push([t, -1.5], [t, 1.5]);
				if (k !== -n && k !== n) out.push([-1.5, t], [1.5, t]);
			}
			return out;
		};
		const o = { n: 0 };
		let worst = 0;
		let stalls = 0;
		let walks = 0;
		const cases: Array<[number, number, Array<[number, number]>]> = [
			[0.3, 0.07, ring(0.25)], // swarmer
			[0.35, 2.6 / 60, ring(0.5)], // sniper
			[0.5, 2 / 60, ring(0.5)], // bruiser
			[0.5, 0.1, ring(0.5)], // a fast big body (MAX_MOVE_STEP)
		];
		for (const [r, step, pts] of cases)
			for (const [ax, az] of pts)
				for (const [bx, bz] of pts) {
					if (ax === bx && az === bz) continue;
					walks++;
					const ticks = walk(moveCircleAroundCorners, r, px + ax, pz + az, px + bx, pz + bz, o, step);
					if (ticks < 0) stalls++;
					else if (ticks * step > worst) worst = ticks * step;
				}
		expect(walks).toBeGreaterThan(3500);
		expect(stalls).toBe(0);
		expect(o.n).toBe(0);
		// the longest detour (3 tiles across, round half the pillar) stays well under twice the straight line
		expect(worst).toBeLessThan(6);
	});

	it("never puts a body into a wall on real endless floors (random walks through every room)", () => {
		const rng = makeRng(99);
		let overlaps = 0;
		let moves = 0;
		for (let i = 0; i < 6; i++) {
			const fl = floorPairs[i].on;
			for (const room of fl.rooms)
				for (const r of [0.3, 0.5]) {
					let x = gridToWorld(room.cx),
						z = gridToWorld(room.cy);
					if (tileAt(fl, room.cx, room.cy) !== TileType.FLOOR) continue;
					for (let k = 0; k < 150; k++) {
						const res = moveCircleAroundCorners(
							fl,
							x,
							z,
							(rng.raw() - 0.5) * 0.2,
							(rng.raw() - 0.5) * 0.2,
							r,
						);
						x = res.x;
						z = res.z;
						moves++;
						if (circleOverlapsWall(fl, x, z, r)) overlaps++;
					}
				}
		}
		expect(moves).toBeGreaterThan(10000);
		expect(overlaps).toBe(0);
	});

	it("is moveCircle wherever nothing is in the way, and against every long straight wall head-on", () => {
		// open floor next to the pillar
		const a = moveCircleAroundCorners(d, px - 1.5, pz - 1.2, 0.07, 0.01, 0.3);
		const b = moveCircle(d, px - 1.5, pz - 1.2, 0.07, 0.01, 0.3);
		expect([a.x, a.z]).toEqual([b.x, b.z]);
		// head-on (and slightly off) into the middle of every straight wall run of the census, from all four sides
		let sites = 0;
		let differ = 0;
		const sides: Array<[number, number]> = [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		];
		for (const { on } of floorPairs)
			for (let gy = 3; gy < on.H - 3; gy++)
				for (let gx = 3; gx < on.W - 3; gx++)
					for (const [sx, sz] of sides) {
						// wall cells ahead (gx + sx, gy + sz) +- 2 across, floor cells here +- 1 across
						const ax = sz,
							az = sx;
						let ok = true;
						for (let k = -2; k <= 2; k++)
							if (tileAt(on, gx + sx + k * ax, gy + sz + k * az) !== TileType.WALL) ok = false;
						for (let k = -1; k <= 1; k++)
							if (tileAt(on, gx + k * ax, gy + k * az) !== TileType.FLOOR) ok = false;
						if (!ok) continue;
						sites++;
						for (const r of [0.3, 0.35, 0.5])
							for (const lat of [-0.03, 0, 0.03]) {
								const x0 = gridToWorld(gx) + sx * (0.5 - r) + ax * 0.1,
									z0 = gridToWorld(gy) + sz * (0.5 - r) + az * 0.1;
								const mx = sx * 0.07 + ax * lat,
									mz = sz * 0.07 + az * lat;
								const st = moveCircleAroundCorners(on, x0, z0, mx, mz, r);
								const pl = moveCircle(on, x0, z0, mx, mz, r);
								if (st.x !== pl.x || st.z !== pl.z) differ++;
							}
					}
		expect(sites).toBeGreaterThan(200);
		expect(differ).toBe(0);
	});
});

/** A bare tile grid for the steering specs: W x H floor inside a wall border, plus `cells` ([x, y, tile]). */
function testGrid(W: number, H: number, cells: ReadonlyArray<readonly [number, number, number]>): Dungeon {
	const grid: number[] = [];
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++)
			grid.push(x === 0 || y === 0 || x === W - 1 || y === H - 1 ? TileType.WALL : TileType.FLOOR);
	for (const [x, y, t] of cells) grid[y * W + x] = t;
	return { W, H, grid } as unknown as Dungeon;
}

/** Walks like walkToward (step per tick, straight at the target); the tick it arrived on, or -1. */
function walkTo(
	mover: typeof moveCircle,
	d: Dungeon,
	r: number,
	x0: number,
	z0: number,
	tx: number,
	tz: number,
	step: number,
	maxTicks: number,
): number {
	let x = x0,
		z = z0;
	for (let t = 1; t <= maxTicks; t++) {
		const dx = tx - x,
			dz = tz - z;
		const dist = math.sqrt(dx * dx + dz * dz);
		if (dist < 0.02) return t;
		const k = math.min(step, dist) / dist;
		const res = mover(d, x, z, dx * k, dz * k, r);
		x = res.x;
		z = res.z;
	}
	return -1;
}

/** Points on a square ring of half-size `R` around (cx, cz), `sp` apart. */
function squareRing(cx: number, cz: number, R: number, sp: number): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	const n = math.floor(R / sp + 0.5);
	for (let k = -n; k <= n; k++) {
		const t = k * sp;
		out.push([cx + t, cz - R], [cx + t, cz + R]);
		if (k !== -n && k !== n) out.push([cx - R, cz + t], [cx + R, cz + t]);
	}
	return out;
}

describe("moveCircleAroundCorners is never worse than moveCircle", () => {
	const RADII = [0.3, 0.35, 0.5];

	it("never moves farther than the step it was asked for (the nudge spends what moveCircle left)", () => {
		// the review's case: a slide along a pillar's face plus a nudge used to add up to sqrt(2) x the step
		const pd = testGrid(21, 21, [[10, 10, TileType.WALL]]);
		const res = moveCircleAroundCorners(pd, 9.2, 9.75, 0.1, 0.099, 0.3);
		const len = math.sqrt(0.1 * 0.1 + 0.099 * 0.099);
		const moved = math.sqrt((res.x - 9.2) * (res.x - 9.2) + (res.z - 9.75) * (res.z - 9.75));
		expect(moved).toBeLessThanOrEqual(len * (1 + 1e-12));
		expect(moved).toBeGreaterThan(0.099); // more than moveCircle's slide alone: the nudge still helps
		// and everywhere on real floors: random moves from every room centre and from beside the first few pillars
		// (endless rooms are large, so a walk from a centre alone rarely reaches anything to steer round), every radius
		const rng = makeRng(5);
		let worst = 0;
		for (let i = 0; i < 6; i++) {
			const fl = floorPairs[i].on;
			const starts: [number, number][] = fl.rooms.map((room) => [room.cx, room.cy]);
			for (const pr of pillarsOf(fl).filter((_, k) => k < 8)) starts.push([pr.x + 1, pr.y]);
			for (const [sx, sy] of starts)
				for (const r of RADII) {
					let x = gridToWorld(sx),
						z = gridToWorld(sy);
					if (tileAt(fl, sx, sy) !== TileType.FLOOR) continue;
					for (let k = 0; k < 120; k++) {
						const dx = (rng.raw() - 0.5) * 0.2,
							dz = (rng.raw() - 0.5) * 0.2;
						const st = moveCircleAroundCorners(fl, x, z, dx, dz, r);
						const pl = moveCircle(fl, x, z, dx, dz, r);
						const ratio =
							math.sqrt((st.x - x) * (st.x - x) + (st.z - z) * (st.z - z)) / math.sqrt(dx * dx + dz * dz);
						// only the steered moves (moveCircle's own touch tolerance can add ~1e-9 where nothing steers)
						if ((st.x !== pl.x || st.z !== pl.z) && ratio > worst) worst = ratio;
						x = st.x;
						z = st.z;
					}
				}
		}
		expect(worst).toBeGreaterThan(0.5); // some moves were steered
		expect(worst).toBeLessThanOrEqual(1 + 1e-12);
	});

	it("never flips between positions where moveCircle comes to rest (room centres walked to their bbox corners)", () => {
		// The review's sweep, smaller: the bbox corners are mostly inside walls (oct chamfers, ellipse rims, staircase
		// edges), the worst case for steering. A walk oscillates when its last 40 ticks travel far but go nowhere.
		const result = new Map<string, number>();
		for (const [name, mover] of [
			["steer", moveCircleAroundCorners],
			["plain", moveCircle],
		] as Array<[string, typeof moveCircle]>)
			for (const [r, step] of [
				[0.3, 0.07],
				[0.35, 2.6 / 60],
				[0.5, 2 / 60],
			]) {
				let osc = 0;
				for (let run = 1; run <= 3; run++)
					for (let floor = 1; floor <= 2; floor++) {
						const fl = buildEndlessFloor(run * 7919, floor, generateDungeon);
						for (const room of fl.encounter.rooms)
							for (const [cx, cz] of [
								[room.minX, room.minZ],
								[room.maxX, room.minZ],
								[room.minX, room.maxZ],
								[room.maxX, room.maxZ],
							]) {
								let x = room.cx,
									z = room.cz;
								let path = 0,
									hx = 0,
									hz = 0;
								for (let t = 1; t <= 300; t++) {
									const dx = cx - x,
										dz = cz - z;
									const dist = math.sqrt(dx * dx + dz * dz);
									if (dist < 1e-6) break;
									const k = math.min(step, dist) / dist;
									const res = mover(fl.dungeon, x, z, dx * k, dz * k, r);
									if (t > 260)
										path += math.sqrt((res.x - x) * (res.x - x) + (res.z - z) * (res.z - z));
									if (t === 260) {
										hx = res.x;
										hz = res.z;
									}
									x = res.x;
									z = res.z;
								}
								const net = math.sqrt((x - hx) * (x - hx) + (z - hz) * (z - hz));
								if (path > 10 * step && net < path * 0.1) osc++;
							}
					}
				result.set(`${name} ${r}`, osc);
			}
		for (const r of RADII) {
			expect([r, result.get(`plain ${r}`)]).toEqual([r, 0]);
			expect([r, result.get(`steer ${r}`)]).toEqual([r, 0]);
		}
	});

	interface Scene {
		name: string;
		d: Dungeon;
		pts: Array<[number, number]>;
	}
	const wallCol = (x: number, y0: number, y1: number) => {
		const c: Array<[number, number, number]> = [];
		for (let y = y0; y <= y1; y++) c.push([x, y, TileType.WALL]);
		return c;
	};
	const stair: Array<[number, number, number]> = [];
	for (let k = 0; k <= 8; k++) stair.push([5 + k, 14 - k, TileType.WALL], [6 + k, 14 - k, TileType.WALL]);
	const scenes: Scene[] = [
		{
			name: "pillar 2 tiles from a pit (diagonal)",
			d: testGrid(21, 21, [
				[10, 10, TileType.WALL],
				[12, 12, TileType.POOL],
			]),
			pts: squareRing(11, 11, 2, 0.5),
		},
		{
			name: "pillar beside a wall (1-tile gap)",
			d: testGrid(21, 5, [[10, 2, TileType.WALL]]),
			pts: squareRing(10, 2, 1.4, 0.35),
		},
		{
			name: "wall end (a door below it)",
			d: testGrid(21, 21, wallCol(10, 1, 9)),
			pts: squareRing(10, 9, 2.5, 0.5),
		},
		{
			name: "corridor mouth (a 3-wide door in a wall)",
			d: testGrid(21, 21, [...wallCol(10, 1, 8), ...wallCol(10, 12, 19)]),
			pts: squareRing(10, 10, 3, 0.5),
		},
		{
			name: "L corner (concave)",
			d: testGrid(21, 21, [
				...wallCol(10, 1, 9),
				[11, 9, TileType.WALL],
				[12, 9, TileType.WALL],
				[13, 9, TileType.WALL],
				[14, 9, TileType.WALL],
				[15, 9, TileType.WALL],
			]),
			pts: squareRing(10, 9, 2.5, 0.5),
		},
		{ name: "staircase wall", d: testGrid(21, 21, stair), pts: squareRing(10, 10, 3, 0.6) },
	];

	/** Walks between every pair of ring points the circle fits on; [walks, steer stalls where plain arrives]. */
	function census(sc: Scene, r: number): [number, number] {
		let walks = 0,
			worse = 0;
		for (const [ax, az] of sc.pts)
			for (const [bx, bz] of sc.pts) {
				if (ax === bx && az === bz) continue;
				if (!isWalkable(sc.d, ax, az) || !isWalkable(sc.d, bx, bz)) continue;
				if (circleOverlapsWall(sc.d, ax, az, r) || circleOverlapsWall(sc.d, bx, bz, r)) continue;
				walks++;
				const st = walkTo(moveCircleAroundCorners, sc.d, r, ax, az, bx, bz, 0.07, 300);
				if (st < 0 && walkTo(moveCircle, sc.d, r, ax, az, bx, bz, 0.07, 300) > 0) worse++;
			}
		return [walks, worse];
	}

	for (const sc of scenes)
		it(`${sc.name}: no walk that moveCircle finishes stalls with steering`, () => {
			for (const r of RADII) {
				const [walks, worse] = census(sc, r);
				expect(walks).toBeGreaterThan(20);
				expect([r, worse]).toEqual([r, 0]);
			}
		});

	it("pillar 2 tiles from a pit (a 1-tile gap): only the bruiser's exact-fit squeeze is worse (known residual)", () => {
		// r 0.5 fits the 1-tile gap only exactly centred; the steered route round the pillar can arrive at it
		// off-centre (as moveCircle does on other routes). The review counted 4 of 4032 walks; this ring is coarser.
		const sc: Scene = {
			name: "pit gap",
			d: testGrid(21, 21, [
				[10, 10, TileType.WALL],
				[12, 10, TileType.POOL],
			]),
			pts: squareRing(11, 10, 2, 0.5),
		};
		for (const r of [0.3, 0.35]) expect([r, census(sc, r)[1]]).toEqual([r, 0]);
		const [walks, worse] = census(sc, 0.5);
		expect(worse <= walks * 0.01).toBe(true);
	});

	it("a 1-wide wall seen end-on is not a pillar: the review's walk round its tip arrives like moveCircle's", () => {
		const wd = testGrid(21, 21, wallCol(10, 1, 9));
		expect(walkTo(moveCircle, wd, 0.3, 8.75, 11.5, 11, 6.5, 0.07, 400) > 0).toBe(true);
		expect(walkTo(moveCircleAroundCorners, wd, 0.3, 8.75, 11.5, 11, 6.5, 0.07, 400) > 0).toBe(true);
	});

	it("still rounds a lone pillar head-on, every enemy radius", () => {
		const pd = testGrid(21, 21, [[10, 10, TileType.WALL]]);
		for (const r of RADII)
			expect([r, walkTo(moveCircleAroundCorners, pd, r, 8.4, 10, 11.6, 10, 0.07, 200) > 0]).toEqual([r, true]);
	});
});
