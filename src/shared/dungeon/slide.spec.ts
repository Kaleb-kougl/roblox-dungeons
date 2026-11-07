/**
 * The player's slide mover (docs/WALL_SLIDE.md WS1 / WS2): slideCircle's contract (no tunnelling, never farther than
 * the step, never left in a wall, start-overlap escape, moveCircle where no corner is touched, deterministic), the
 * corner tie-break, the face assist's 0.35 margin and the pillar slip, for keyboard and quantized stick input.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	KALEB_VALE_MVP_PARAMS,
	PLAYER_SLIDE,
	TileType,
	cellKey,
	circleOverlapsWall,
	endlessFloorParams,
	entranceSpawn,
	generateDungeon,
	isIsolatedBlocker,
	isWalkable,
	moveCircle,
	mulberry32,
	playerSlideMover,
	slideCircle,
	tileAt,
	type Dungeon,
	type PlayerSlideTuning,
	type SolidCells,
} from "shared/dungeon";
import { sceneGrid, solidOf, ticksTo, walk, type SceneMover } from "shared/dungeon/testing";
import { screenToWorld } from "shared/play";
import { AXIS_MAX, MAX_MOVE_STEP, PLAYER_RADIUS, SQRT1_2, WALK_STEP, quantizeAxis } from "shared/sim";

const R = PLAYER_RADIUS;
/** Overlap tolerance of the "never in a wall" checks (circleOverlapsWall's default). */
const TOL = 1e-6;

const slide: SceneMover = (d, x, z, dx, dz, r, solid?: SolidCells) => slideCircle(d, x, z, dx, dz, r, solid);
function tuned(t: PlayerSlideTuning): SceneMover {
	return (d, x, z, dx, dz, r, solid?: SolidCells) => slideCircle(d, x, z, dx, dz, r, solid, t);
}

/** A walk tick for quantized move axes, exactly as stepPlayer turns them into a step (clamped to unit length). */
function stepOf(qx: number, qz: number): [number, number] {
	let mx = qx / AXIS_MAX;
	let mz = qz / AXIS_MAX;
	const l2 = mx * mx + mz * mz;
	if (l2 > 1) {
		const inv = 1 / math.sqrt(l2);
		mx *= inv;
		mz *= inv;
	}
	return [mx * WALK_STEP, mz * WALK_STEP];
}

/** A screen-relative input (right, up) through the iso camera's yaw and the frame's quantization, as a walk tick. */
function inputStep(right: number, up: number): [number, number] {
	const w = screenToWorld(right, up);
	return stepOf(quantizeAxis(w.x), quantizeAxis(w.z));
}

interface Dir {
	name: string;
	dx: number;
	dz: number;
}

/** The 8 keyboard directions (screen-relative: W = a world diagonal, W+D = a world axis). */
const KEYS: Dir[] = [];
for (const [name, right, up] of [
	["W", 0, 1],
	["W+D", SQRT1_2, SQRT1_2],
	["D", 1, 0],
	["S+D", SQRT1_2, -SQRT1_2],
	["S", 0, -1],
	["S+A", -SQRT1_2, -SQRT1_2],
	["A", -1, 0],
	["W+A", -SQRT1_2, SQRT1_2],
] as const) {
	const [dx, dz] = inputStep(right, up);
	KEYS.push({ name, dx, dz });
}

/** 64 full-deflection stick directions, quantized like real input. */
const STICKS: Dir[] = [];
for (let k = 0; k < 64; k++) {
	const a = (2 * math.pi * k) / 64;
	const [dx, dz] = inputStep(math.cos(a), math.sin(a));
	STICKS.push({ name: `stick ${k}/64`, dx, dz });
}
const ALL_DIRS: Dir[] = [...KEYS, ...STICKS];

/** One move's contract: never farther than the step, never ending in a wall (or `solid` cell). */
function contractBroken(
	d: Dungeon,
	x: number,
	z: number,
	dx: number,
	dz: number,
	r: number,
	px: number,
	pz: number,
	solid?: SolidCells,
): string | undefined {
	const where = `(${x}, ${z}) + (${dx}, ${dz}) r ${r} -> (${px}, ${pz})`;
	if (math.sqrt((px - x) * (px - x) + (pz - z) * (pz - z)) > math.sqrt(dx * dx + dz * dz) + 1e-9)
		return `moved too far, ${where}`;
	if (circleOverlapsWall(d, px, pz, r, TOL, solid)) return `overlaps a wall, ${where}`;
	return undefined;
}

/**
 * True when the segment between two centres enters a blocking tile (sampled every 0.005): a move that jumped through a
 * wall. A real slide's chord stays clear (it turns at most 90 degrees round one corner per step).
 */
function crossesWall(d: Dungeon, x0: number, z0: number, x1: number, z1: number): boolean {
	const n = 100;
	for (let i = 1; i < n; i++) {
		const t = i / n;
		if (!isWalkable(d, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return true;
	}
	return false;
}

describe("slideCircle: the contract (WS1)", () => {
	it("never tunnels through 1-tile walls, a pillar or a diagonal corner touch: steps up to 0.5, every angle", () => {
		// A 1-tile wall across X (column 10), one across Z (row 10, x >= 14) and a lone cell, in a 25 x 25 room; starts
		// touching each.
		const d = sceneGrid(25, 25, (gx, gy) => gx === 10 || (gy === 10 && gx >= 14) || (gx === 18 && gy === 18));
		let failure: string | undefined;
		let moves = 0;
		for (const r of [0.2, R, 0.45])
			for (const [sx, sz] of [
				[9.5 - r, 5],
				[10.5 + r, 15],
				[17, 9.5 - r],
				[17, 10.5 + r],
				[17.5 - r, 18],
				[18, 18.5 + r],
				[17.5 - r, 17.5 - r],
			])
				for (let deg = 0; deg < 360; deg += 3)
					for (const len of [0.1, 0.25, 0.4, 0.5]) {
						const a = (deg * math.pi) / 180;
						const dx = math.cos(a) * len,
							dz = math.sin(a) * len;
						let x = sx,
							z = sz;
						for (let i = 0; i < 12; i++) {
							const p = slideCircle(d, x, z, dx, dz, r);
							moves++;
							failure ??= contractBroken(d, x, z, dx, dz, r, p.x, p.z);
							if (failure === undefined && crossesWall(d, x, z, p.x, p.z))
								failure = `crossed a wall: (${x}, ${z}) + (${dx}, ${dz}) r ${r} -> (${p.x}, ${p.z})`;
							x = p.x;
							z = p.z;
						}
					}
		expect(failure).toBeUndefined();
		expect(moves).toBeGreaterThan(50000);
	});

	it("diagonal cells touching corner to corner stay closed from every angle, every step up to 0.5", () => {
		// A diagonal line of cells (gx === gy): each touches the next only at a corner. The line z = x lies inside them.
		const d = sceneGrid(24, 24, (gx, gy) => gx === gy);
		let failure: string | undefined;
		for (const r of [0.2, R, 0.45])
			for (let k = 4; k <= 18; k++)
				for (const above of [true, false]) {
					// Start touching the pinch between cells (k, k) and (k + 1, k + 1), on one side of the line.
					const sx = above ? k + 0.5 - r : k + 0.5 + r,
						sz = above ? k + 0.5 + r : k + 0.5 - r;
					for (let deg = 0; deg < 360; deg += 5)
						for (const len of [0.1, 0.3, 0.5]) {
							const a = (deg * math.pi) / 180;
							const dx = math.cos(a) * len,
								dz = math.sin(a) * len;
							let x = sx,
								z = sz;
							for (let i = 0; i < 8; i++) {
								const p = slideCircle(d, x, z, dx, dz, r);
								failure ??= contractBroken(d, x, z, dx, dz, r, p.x, p.z);
								if (failure === undefined && p.z > p.x !== above)
									failure = `crossed the diagonal: (${x}, ${z}) + (${dx}, ${dz}) r ${r} -> (${p.x}, ${p.z})`;
								x = p.x;
								z = p.z;
							}
						}
				}
		expect(failure).toBeUndefined();
	});

	it("never moves farther than the step or ends in a wall over randomized moves on generated floors", () => {
		// collision.spec's randomized walk (25 M1 floors, radius 0.1 .. 0.49, steps up to 0.5), through slideCircle.
		const rand = mulberry32(2024);
		let clipped = 0;
		let moves = 0;
		let failure: string | undefined;
		for (let s = 0; s < 25; s++) {
			const d = generateDungeon({ seed: 1000 + s * 31, ...KALEB_VALE_MVP_PARAMS });
			const start = entranceSpawn(d);
			let x = start.x,
				z = start.z;
			const radius = 0.1 + rand() * 0.39;
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
				const p = slideCircle(d, x, z, dx, dz, radius);
				moves++;
				failure ??= contractBroken(d, x, z, dx, dz, radius, p.x, p.z);
				if (failure === undefined && !isWalkable(d, p.x, p.z))
					failure = `ended on an unwalkable tile: floor ${s} move ${i} (${x}, ${z}) -> (${p.x}, ${p.z})`;
				if (math.abs(p.x - x - dx) > 1e-9 || math.abs(p.z - z - dz) > 1e-9) clipped++;
				x = p.x;
				z = p.z;
			}
		}
		expect(failure).toBeUndefined();
		expect(moves).toBe(25 * 3000);
		expect(clipped).toBeGreaterThan(2000);
	});

	it("walks the player through endless floors (pillars, solid decor, crates) at walk speed, never into a wall", () => {
		const rand = mulberry32(77);
		let moves = 0;
		let clipped = 0;
		let failure: string | undefined;
		for (let run = 1; run <= 4; run++)
			for (let floor = 1; floor <= 5; floor++) {
				const d = generateDungeon(endlessFloorParams(run * 7919, floor));
				// Crates: every 23rd FLOOR cell that is not the spawn's.
				const sp = entranceSpawn(d);
				const crates = new Map<number, number>();
				let n = 0;
				for (let gy = 0; gy < d.H; gy++)
					for (let gx = 0; gx < d.W; gx++)
						if (tileAt(d, gx, gy) === TileType.FLOOR && (gx !== sp.x || gy !== sp.z) && ++n % 23 === 0)
							crates.set(cellKey(gx, gy), n);
				const mover = playerSlideMover(d, R);
				let x = sp.x,
					z = sp.z;
				let dir = ALL_DIRS[0];
				for (let i = 0; i < 2500; i++) {
					if (rand() < 0.03) dir = ALL_DIRS[math.floor(rand() * ALL_DIRS.size())];
					const p = mover(x, z, dir.dx, dir.dz, crates);
					moves++;
					failure ??= contractBroken(d, x, z, dir.dx, dir.dz, R, p.x, p.z, crates);
					if (math.abs(p.x - x - dir.dx) > 1e-9 || math.abs(p.z - z - dir.dz) > 1e-9) clipped++;
					x = p.x;
					z = p.z;
				}
			}
		expect(failure).toBeUndefined();
		expect(moves).toBe(20 * 2500);
		expect(clipped).toBeGreaterThan(1000);
	});

	it("lets a circle that starts overlapping a wall or a crate walk out", () => {
		const d = sceneGrid(12, 12, (gx) => gx === 3);
		// 0.25 into column 3 (x <= 3.5): moves as if the wall were not there, like moveCircle.
		const p = slideCircle(d, 3.6, 5, 0.1, 0, R);
		expect([p.x, p.z]).toEqual([3.6 + 0.1, 5]);
		const q = slideCircle(d, 3.6, 5, 0.1, 0.05, R);
		expect([q.x, q.z]).toEqual([3.6 + 0.1, 5 + 0.05]);
		// A crate that appears under the player: every direction walks out and ends clear of it.
		const crate = solidOf([[7, 7]]);
		for (const dir of ALL_DIRS) {
			const w = walk(slide, d, 7.1, 6.95, dir.dx, dir.dz, R, 15, 1, crate);
			expect([dir.name, circleOverlapsWall(d, w.x, w.z, R, TOL, crate)]).toEqual([dir.name, false]);
		}
	});

	it("is moveCircle (within 1e-9) on open floor and along flat walls", () => {
		const open = sceneGrid(40, 40, () => false);
		const rand = mulberry32(5);
		let worst = 0;
		for (let i = 0; i < 2000; i++) {
			const x = 10 + rand() * 20,
				z = 10 + rand() * 20;
			const dx = (rand() - 0.5) * 0.2,
				dz = (rand() - 0.5) * 0.2;
			const a = moveCircle(open, x, z, dx, dz, R);
			const b = slideCircle(open, x, z, dx, dz, R);
			worst = math.max(worst, math.abs(a.x - b.x), math.abs(a.z - b.z));
		}
		// Flat walls: across Z (rows >= 3) and across X (columns >= 3), pushed into at every angle.
		const rowWall = sceneGrid(30, 6, (_gx, gy) => gy >= 3);
		const colWall = sceneGrid(6, 30, (gx) => gx >= 3);
		for (let deg = -85; deg <= 85; deg += 5) {
			const a0 = (deg * math.pi) / 180;
			const along = math.cos(a0) * MAX_MOVE_STEP,
				into = math.sin(a0) * MAX_MOVE_STEP;
			for (const [d, x0, z0, dx, dz] of [
				[rowWall, 13, 1.5, along, math.abs(into)],
				[colWall, 1.5, 13, math.abs(into), along],
			] as const) {
				let ax: number = x0,
					az: number = z0,
					bx: number = x0,
					bz: number = z0;
				for (let t = 0; t < 100; t++) {
					const a = moveCircle(d, ax, az, dx, dz, R);
					const b = slideCircle(d, bx, bz, dx, dz, R);
					ax = a.x;
					az = a.z;
					bx = b.x;
					bz = b.z;
					worst = math.max(worst, math.abs(ax - bx), math.abs(az - bz));
				}
			}
		}
		expect(worst).toBeLessThanOrEqual(1e-9);
	});

	it("is deterministic: two runs give bit-identical positions", () => {
		function trace(): number[] {
			const out: number[] = [];
			const rand = mulberry32(31337);
			const d = generateDungeon(endlessFloorParams(4242, 3));
			const mover = playerSlideMover(d, R);
			const sp = entranceSpawn(d);
			let x = sp.x,
				z = sp.z;
			let dir = ALL_DIRS[0];
			for (let i = 0; i < 4000; i++) {
				if (rand() < 0.03) dir = ALL_DIRS[math.floor(rand() * ALL_DIRS.size())];
				const p = mover(x, z, dir.dx, dir.dz);
				x = p.x;
				z = p.z;
				out.push(x, z);
			}
			return out;
		}
		const a = trace();
		const b = trace();
		expect(a.size()).toBe(8000);
		let same = true;
		for (let i = 0; i < a.size(); i++) if (a[i] !== b[i]) same = false;
		expect(same).toBe(true);
	});
});

/** A 25 x 25 room with the cells `blocked` (and nothing else but the border). */
function room(blocked: (gx: number, gy: number) => boolean): Dungeon {
	return sceneGrid(25, 25, blocked);
}

/**
 * Walks `dir` at the obstacle centred on (cx, cz) from 5 tiles before it, `offset` tiles to the side; the ticks until
 * the circle is 1.5 past the centre along `dir` (-1: never in 200), and the first broken contract.
 */
function passTicks(
	mover: SceneMover,
	d: Dungeon,
	cx: number,
	cz: number,
	dir: Dir,
	offset: number,
	solid?: SolidCells,
): [number, string | undefined] {
	const len = math.sqrt(dir.dx * dir.dx + dir.dz * dir.dz);
	const ux = dir.dx / len,
		uz = dir.dz / len;
	let x = cx - ux * 5 - uz * offset,
		z = cz - uz * 5 + ux * offset;
	let failure: string | undefined;
	for (let t = 1; t <= 200; t++) {
		const p = mover(d, x, z, dir.dx, dir.dz, R, solid);
		failure ??= contractBroken(d, x, z, dir.dx, dir.dz, R, p.x, p.z, solid);
		x = p.x;
		z = p.z;
		if ((x - cx) * ux + (z - cz) * uz >= 1.5) return [t, failure];
	}
	return [-1, failure];
}

/** Offsets -0.9 .. 0.9 across the obstacle. */
const OFFSETS: number[] = [];
for (let i = -9; i <= 9; i++) OFFSETS.push(i / 10);

describe("pillar slip and corner tie-break (WS2)", () => {
	const pillar = room((gx, gy) => gx === 12 && gy === 12);
	const empty = room(() => false);

	it("a solid pillar is an isolated blocker; a wall end, a 2x1 block and a wall's cells are not", () => {
		expect(isIsolatedBlocker(pillar, 12, 12)).toBe(true);
		expect(isIsolatedBlocker(pillar, 11, 12)).toBe(false); // open
		const pair = room((gx, gy) => gy === 12 && (gx === 12 || gx === 13));
		expect(isIsolatedBlocker(pair, 12, 12)).toBe(false);
		const diag = room((gx, gy) => (gx === 12 && gy === 12) || (gx === 13 && gy === 13));
		expect(isIsolatedBlocker(diag, 12, 12)).toBe(false);
		expect(isIsolatedBlocker(empty, 0, 5)).toBe(false); // the border
		const crate = solidOf([[12, 12]]);
		expect(isIsolatedBlocker(empty, 12, 12, crate)).toBe(true);
		expect(isIsolatedBlocker(empty, 12, 12)).toBe(false);
		const crateByPillar = solidOf([[13, 13]]);
		expect(isIsolatedBlocker(pillar, 12, 12, crateByPillar)).toBe(false);
	});

	it("a 1x1 pillar is passed head-on at every offset within 10 ticks of open floor: 8 keys and 64 stick angles", () => {
		let failure: string | undefined;
		let worst = 0;
		let worstAt = "";
		for (const dir of ALL_DIRS) {
			const [open] = passTicks(slide, empty, 12, 12, dir, 0);
			for (const off of OFFSETS) {
				const [t, broke] = passTicks(slide, pillar, 12, 12, dir, off);
				failure ??= broke;
				if (failure === undefined && t < 0) failure = `${dir.name} offset ${off}: never got past`;
				if (t - open > worst) {
					worst = t - open;
					worstAt = `${dir.name} offset ${off}`;
				}
			}
		}
		print(`[slide] pillar head-on: worst ${worst} ticks slower than open floor (${worstAt})`);
		expect(failure).toBeUndefined();
		expect(worst).toBeLessThanOrEqual(10);
	});

	it("a lone crate (a solid cell) slips exactly like a pillar", () => {
		const crate = solidOf([[12, 12]]);
		for (const dir of ALL_DIRS)
			for (const off of OFFSETS) {
				const a = passTicks(slide, pillar, 12, 12, dir, off);
				const b = passTicks(slide, empty, 12, 12, dir, off, crate);
				expect([dir.name, off, b[0], b[1]]).toEqual([dir.name, off, a[0], undefined]);
			}
	});

	it("pillarSlip off: a pillar keeps the walls' 0.35 margin (passed from offset 0.5), assistTiles 0 from 0.6", () => {
		const noSlip = tuned({ ...PLAYER_SLIDE, pillarSlip: false });
		const none = tuned({ ...PLAYER_SLIDE, pillarSlip: false, assistTiles: 0 });
		const east: Dir = { name: "+X", dx: WALK_STEP, dz: 0 };
		const firstPass = (m: SceneMover) => {
			for (let i = 0; i <= 9; i++) if (passTicks(m, pillar, 12, 12, east, i / 10)[0] > 0) return i / 10;
			return -1;
		};
		const a = firstPass(noSlip);
		const b = firstPass(none);
		print(`[slide] case A, pillarSlip off: assist 0.35 passes from ${a}, assist 0 from ${b}`);
		expect(a).toBe(0.5);
		expect(b).toBe(0.6);
	});

	it("the exact corner tie (W straight at a diamond's tip) takes a fixed side, the ray's right", () => {
		// W walks (-0.707, -0.707) * WALK_STEP: straight down the pillar's diagonal from its (12.5, 12.5) corner.
		const w = KEYS[0];
		expect(w.dx).toBe(w.dz);
		const [t] = passTicks(slide, pillar, 12, 12, w, 0);
		expect(t).toBeGreaterThan(0);
		// The ray's right of (-1, -1) is (-1, 1): the circle passes on the pillar's +Z side, x < z all the way past.
		let x = 17,
			z = 17;
		let minSide = 0;
		for (let i = 0; i < 120; i++) {
			const p = slideCircle(pillar, x, z, w.dx, w.dz, R);
			x = p.x;
			z = p.z;
			minSide = math.min(minSide, z - x);
		}
		expect(minSide).toBeGreaterThanOrEqual(-1e-12);
		expect(z - x).toBeGreaterThan(0.5);
	});
});

/**
 * Presses `dir` from (x, z) until the circle has not moved for 20 ticks (at most `maxTicks`): the end, whether it came
 * to rest, and the first broken contract.
 */
function press(
	d: Dungeon,
	x: number,
	z: number,
	dir: Dir,
	solid?: SolidCells,
	maxTicks = 300,
): { x: number; z: number; still: boolean; failure?: string } {
	let px = x,
		pz = z;
	let quiet = 0;
	let failure: string | undefined;
	for (let t = 1; t <= maxTicks && quiet < 20; t++) {
		const p = slideCircle(d, px, pz, dir.dx, dir.dz, R, solid);
		failure ??= contractBroken(d, px, pz, dir.dx, dir.dz, R, p.x, p.z, solid);
		quiet = p.x === px && p.z === pz ? quiet + 1 : 0;
		px = p.x;
		pz = p.z;
	}
	return { x: px, z: pz, still: quiet >= 20, failure };
}

describe("the face assist keeps its 0.35 margin; nothing slips or jitters where it should not (WS2)", () => {
	const north: Dir = { name: "+Z", dx: 0, dz: WALK_STEP };
	const east: Dir = { name: "+X", dx: WALK_STEP, dz: 0 };
	const reached = (gz: number) => (_x: number, z: number) => z >= gz;
	const reachedX = (gx: number) => (x: number) => x >= gx;

	it("a 2x1 block: a hit on its face stops; within 0.35 of an end (the centre off the face) slips round", () => {
		const tomb = room((gx, gy) => gy === 12 && (gx === 12 || gx === 13)); // face x 11.5 .. 13.5
		for (const x of [11.6, 12, 12.5, 13, 13.4]) {
			const p = press(tomb, x, 9, north);
			expect([x, p.x, p.z, p.still, p.failure]).toEqual([x, x, 11.5 - 0.35, true, undefined]);
		}
		for (const x of [11.2, 11.4, 11.5, 13.5, 13.6, 13.8])
			expect([x, ticksTo(slide, tomb, x, 9, 0, WALK_STEP, R, reached(13.5), 200) > 0]).toEqual([x, true]);
		// End-on (the 1-wide end at x 11.5, z 11.5 .. 12.5): the centre stops, within 0.35 of a corner slips.
		for (const z of [11.6, 12, 12.4]) {
			const p = press(tomb, 8, z, east);
			expect([z, p.z, p.still]).toEqual([z, z, true]);
			expect(p.x).toBeLessThan(11.5);
		}
		for (const z of [11.4, 11.5, 12.5, 12.6])
			expect([z, ticksTo(slide, tomb, 8, z, WALK_STEP, 0, R, reachedX(14), 200) > 0]).toEqual([z, true]);
	});

	it("a long wall: its middle stops dead; only within 0.35 of an end slips round", () => {
		const wall = room((gx, gy) => gx === 12 && gy >= 4 && gy <= 20); // face z 3.5 .. 20.5
		for (const z of [4, 8, 12.25, 16, 20.4]) {
			const p = press(wall, 8, z, east);
			expect([z, p.x, p.z, p.still]).toEqual([z, 11.5 - 0.35, z, true]);
		}
		for (const z of [3.3, 3.5, 20.5, 20.7])
			expect([z, ticksTo(slide, wall, 8, z, WALK_STEP, 0, R, reachedX(13), 200) > 0]).toEqual([z, true]);
	});

	it("a concave corner and a staircase face: no slip, at rest", () => {
		// An L: column 12 (rows 6 .. 12) and row 12 (columns 6 .. 12); its inside corner faces -X / -Z.
		const ell = room((gx, gy) => (gx === 12 && gy >= 6 && gy <= 12) || (gy === 12 && gx >= 6 && gx <= 12));
		const p = press(ell, 9, 9, east);
		expect([p.x, p.z, p.still]).toEqual([11.5 - 0.35, 9, true]);
		const q = press(ell, 9, 9, north);
		expect([q.x, q.z, q.still]).toEqual([9, 11.5 - 0.35, true]);
		// Into the inside corner (11.5, 11.5) near the end of each wall: rests in the corner.
		const c = press(ell, 11, 10.9, east);
		expect([c.x, c.z, c.still]).toEqual([11.5 - 0.35, 10.9, true]);
		// A 1:1 staircase (blocked gy >= gx + 3): pressing a tooth's face in its middle.
		const stair = room((gx, gy) => gy >= gx + 3);
		const s = press(stair, 10, 11, north); // the tooth (10, 13), face z 12.5, x 9.5 .. 10.5
		expect([s.x, s.z, s.still]).toEqual([10, 12.5 - 0.35, true]);
		const s2 = press(stair, 12, 12, { name: "-X", dx: -WALK_STEP, dz: 0 }); // the tooth (9, 12), face x 9.5
		expect([s2.x, s2.z, s2.still]).toEqual([9.5 + 0.35, 12, true]);
	});

	it("no back-and-forth: pressing into every scene in every direction ends at rest (20 still ticks)", () => {
		// Small rooms (15 x 15), so every press ends against something: a face, a corner, a notch. A stick a few degrees
		// off an axis slides along a wall at a tenth of walk speed, hence the long limit.
		const scenes: Array<[string, Dungeon, SolidCells | undefined, ReadonlyArray<readonly [number, number]>]> = [
			[
				"pillar",
				sceneGrid(15, 15, (gx, gy) => gx === 7 && gy === 7),
				undefined,
				[
					[5, 5],
					[7, 5.4],
					[9.3, 7.2],
				],
			],
			[
				"crate",
				sceneGrid(15, 15, () => false),
				solidOf([[7, 7]]),
				[
					[5, 5],
					[7, 5.4],
					[9.3, 7.2],
				],
			],
			[
				"2x1",
				sceneGrid(15, 15, (gx, gy) => gy === 7 && (gx === 7 || gx === 8)),
				undefined,
				[
					[7.5, 5.5],
					[5.5, 7],
				],
			],
			[
				"wall",
				sceneGrid(15, 15, (gx, gy) => gx === 7 && gy >= 3 && gy <= 11),
				undefined,
				[
					[5.5, 7],
					[5.5, 2.6],
				],
			],
			[
				"ell",
				sceneGrid(15, 15, (gx, gy) => (gx === 9 && gy >= 4 && gy <= 9) || (gy === 9 && gx >= 4 && gx <= 9)),
				undefined,
				[
					[7, 7],
					[8.1, 8.1],
				],
			],
			[
				"stair",
				sceneGrid(15, 15, (gx, gy) => gy >= gx + 3),
				undefined,
				[
					[7, 6],
					[4, 5],
				],
			],
			[
				"doorway",
				sceneGrid(15, 15, (gx, gy) => gx === 8 && gy !== 7),
				undefined,
				[
					[6, 6.6],
					[6, 4],
					[10, 9],
				],
			],
		];
		let failure: string | undefined;
		let presses = 0;
		for (const [name, d, solid, starts] of scenes)
			for (const [x, z] of starts)
				for (const dir of ALL_DIRS) {
					const p = press(d, x, z, dir, solid, 3000);
					presses++;
					failure ??= p.failure;
					if (failure === undefined && !p.still)
						failure = `${name} from (${x}, ${z}) ${dir.name}: still moving at (${p.x}, ${p.z})`;
				}
		expect(failure).toBeUndefined();
		expect(presses).toBe(17 * ALL_DIRS.size());
	});
});
