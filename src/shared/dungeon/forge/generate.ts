/*
 * Ported from Dungeon Forge (https://github.com/majidmanzarpour/threejs-procedural-dungeon), src/main.js.
 * MIT License. Copyright (c) 2026 Majid Manzarpour.
 * Full license text: THIRD_PARTY_NOTICES.md at the repository root.
 *
 * Roblox port of project-kaleb-vale src/dungeon/forge/generate.ts @ 42897e2.
 *
 * Pipeline: scatter -> separate -> Delaunay -> MST + loops -> semantics -> carve ->
 * rasterize + BFS -> decorate. One mulberry32 stream drives every stage. (Kaleb-Vale `chain`: ./chain.ts gives the
 * room graph instead of the first five stages, drawing nothing; carve onwards is the same code.)
 *
 * SEED PARITY: every RNG draw happens in the same order with the same arithmetic as the web build. JS-isms ported
 * deliberately (fixtures/README.md "Porting notes"): Math.round -> jsRound (halves toward +Infinity), Math.hypot ->
 * V8's hypot, Array.sort -> stableSort, Set iteration -> arrays in insertion order, `%` with possibly negative operands
 * -> jsRem, Math.cos / Math.sin -> the deterministic dcos / dsin (./trig), typed arrays -> number arrays.
 * Never add, remove or reorder an rng call.
 */
import { hypot2, jsRound, stableSort, u32, imul, jsRem } from "shared/jsmath";
import { chainGraph, validateChain, type ForgeGraph } from "./chain";
import { delaunay } from "./delaunay";
import { makeRng, type Rng } from "./rng";
import { placeSolidDecor, type SolidDecorPiece } from "./solidDecor";
import { THEMES, resolveAutoTheme, type ForgeTheme } from "./themes";
import { dcos, dsin } from "./trig";
import {
	RoomType,
	TileType,
	type Arch,
	type Cell,
	type Dungeon,
	type Edge,
	type ForgeParams,
	type Prop,
	type PropKind,
	type ResolvedForgeParams,
	type Room,
	type RoomArch,
	type RoomShape,
	type Spawn,
	type Torch,
} from "./types";

const { VOID, FLOOR, WALL, POOL } = TileType;
const TYPE = RoomType;

/** The demo gives up after this many seeds of the reroll chain and shows "unresolved". */
export const FORGE_DEMO_MAX_ATTEMPTS = 5;
/** Kaleb-Vale keeps walking the same chain past the demo's limit so every seed is playable. */
const MAX_ATTEMPTS = 1000;
/** Reroll chain: seed = (seed * REROLL_MUL + REROLL_ADD) >>> 0. */
const REROLL_MUL = 9301;
const REROLL_ADD = 49297;
const TWO_32 = 4294967296;
const TAU = math.pi * 2;
/** Highest roomCount the Delaunay edge key supports. */
const MAX_ROOM_COUNT = 4095;
const MAX_CORRIDOR_WIDTH = 7;
/** Original caps when the Kaleb-Vale options are off. */
const DEFAULT_TREASURE_CAP = 4;
const DEFAULT_SHRINE_CAP = 2;

const NAME_C: ReadonlyArray<string> = [
	"Mal",
	"Vor",
	"Ash",
	"Ker",
	"Ul",
	"Dra",
	"Noth",
	"Zar",
	"Bel",
	"Mor",
	"Gol",
	"Ith",
];
const NAME_D: ReadonlyArray<string> = [
	"goth",
	"ath",
	"ruk",
	"esh",
	"mir",
	"gul",
	"dan",
	"oth",
	"ek",
	"ash",
	"uzek",
	"arim",
];

export function dungeonName(rng: Rng, th: ForgeTheme): string {
	return "The " + rng.pick(th.nameA) + " " + rng.pick(th.nameB) + " of " + rng.pick(NAME_C) + "’" + rng.pick(NAME_D);
}

function isInteger(v: number): boolean {
	return v === v && v !== math.huge && v !== -math.huge && math.floor(v) === v;
}

/** Fill in defaults (AUTO theme from the seed, like the demo) and validate. Draws no randomness. */
export function resolveParams(params: ForgeParams): ResolvedForgeParams {
	const { roomCount, corridorWidth, minCombatRoomSize, roomScale, treasureCap, shrineCap } = params;
	if (!isInteger(roomCount) || roomCount < 2 || roomCount > MAX_ROOM_COUNT) {
		error(`RangeError: roomCount must be an integer in 2..${MAX_ROOM_COUNT} (demo: 12..80), got ${roomCount}`);
	}
	if (
		corridorWidth !== undefined &&
		(!isInteger(corridorWidth) || corridorWidth < 1 || corridorWidth > MAX_CORRIDOR_WIDTH)
	) {
		error(`RangeError: corridorWidth must be an integer in 1..${MAX_CORRIDOR_WIDTH}, got ${corridorWidth}`);
	}
	if (minCombatRoomSize !== undefined && (!isInteger(minCombatRoomSize) || minCombatRoomSize < 1)) {
		error(`RangeError: minCombatRoomSize must be a positive integer, got ${minCombatRoomSize}`);
	}
	if (roomScale !== undefined && (!isInteger(roomScale) || roomScale < 1)) {
		error(`RangeError: roomScale must be a positive integer, got ${roomScale}`);
	}
	if (treasureCap !== undefined && (!isInteger(treasureCap) || treasureCap < 0)) {
		error(`RangeError: treasureCap must be an integer >= 0, got ${treasureCap}`);
	}
	if (shrineCap !== undefined && (!isInteger(shrineCap) || shrineCap < 0)) {
		error(`RangeError: shrineCap must be an integer >= 0, got ${shrineCap}`);
	}
	if (params.chain !== undefined) validateChain(params.chain, roomCount);
	const themeKey =
		params.themeKey === undefined || params.themeKey === "auto"
			? resolveAutoTheme(u32(params.seed))
			: params.themeKey;
	return { ...params, themeKey };
}

/** The next seed of the reroll chain (`(Math.imul(seed, 9301) + 49297) >>> 0`). */
export function forgeRerollSeed(seed: number): number {
	return (imul(seed, REROLL_MUL) + REROLL_ADD) % TWO_32;
}

/**
 * Generate a floor. Faithful to the original generateDungeon(): tries `seed`, and while the
 * layout is invalid (not fully connected) rerolls with seed = seed * 9301 + 49297 (uint32).
 *
 * Divergence (documented, only where the demo itself fails): the demo stops after 5 attempts and
 * shows an "unresolved" dungeon; this keeps walking the same chain (up to 1000 attempts) so any
 * seed yields a valid, playable floor. stats.genMs is always 0 (no clock in deterministic code).
 */
export function generateDungeon(params: ForgeParams): Dungeon {
	const p = resolveParams(params);
	let attempt = 0;
	let seed = u32(p.seed);
	let d: Dungeon | undefined;
	while (attempt < MAX_ATTEMPTS) {
		d = tryGenerate(seed, p);
		if (d && d.valid) break;
		seed = forgeRerollSeed(seed);
		attempt++;
	}
	if (!d || !d.valid) {
		error(`Dungeon Forge: no valid layout for seed ${p.seed} after ${MAX_ATTEMPTS} attempts`);
	}
	d.stats.genMs = 0;
	d.stats.attempts = attempt + 1;
	return d;
}

/** Most separation sweeps. */
const SEPARATE_ITERS = 300;

/**
 * Original "separate" stage: push padded room boxes apart along the axis of least overlap,
 * up to 300 sweeps, then round centers to whole tiles (JS Math.round). No randomness.
 */
function separate(rooms: Room[], PAD: number): void {
	const N = rooms.size();
	const CX = new Array<number>(N, 0),
		CY = new Array<number>(N, 0),
		HW = new Array<number>(N, 0),
		HH = new Array<number>(N, 0);
	for (let i = 0; i < N; i++) {
		CX[i] = rooms[i].cx;
		CY[i] = rooms[i].cy;
		HW[i] = rooms[i].w / 2 + PAD / 2;
		HH[i] = rooms[i].h / 2 + PAD / 2;
	}
	for (let iter = 0; iter < SEPARATE_ITERS; iter++) {
		let moved = false;
		for (let i = 0; i < N; i++)
			for (let j = i + 1; j < N; j++) {
				const ox = HW[i] + HW[j] - math.abs(CX[i] - CX[j]);
				if (ox <= 0) continue;
				const oy = HH[i] + HH[j] - math.abs(CY[i] - CY[j]);
				if (oy <= 0) continue;
				moved = true;
				if (ox < oy) {
					const s = CX[i] <= CX[j] ? -1 : 1;
					CX[i] += (s * ox) / 2;
					CX[j] -= (s * ox) / 2;
				} else {
					const s = CY[i] <= CY[j] ? -1 : 1;
					CY[i] += (s * oy) / 2;
					CY[j] -= (s * oy) / 2;
				}
			}
		if (!moved) break;
	}
	for (let i = 0; i < N; i++) {
		rooms[i].cx = jsRound(CX[i]);
		rooms[i].cy = jsRound(CY[i]);
	}
}

/** Corridor cross-section offsets. Widths 1..3 are the original's; wider is Kaleb-Vale only. */
function corridorOffsets(w: number): number[] {
	if (w === 1) return [0];
	if (w === 2) return [0, 1];
	if (w === 3) return [-1, 0, 1];
	const o: number[] = [];
	const lo = -math.floor((w - 1) / 2);
	for (let k = 0; k < w; k++) o.push(lo + k);
	return o;
}

/** `x || 0` for the prop rotation (also maps -0 and NaN to 0, like JS). */
function orZero(v: number): number {
	return v !== 0 && v === v ? v : 0;
}

/** `x || 1` for the prop scale. */
function orOne(v: number): number {
	return v !== 0 && v === v ? v : 1;
}

interface AdjEdge {
	b: number;
	w: number;
	idx: number;
}

/** Fisher-Yates shuffle with the original's draw order (i from the end, j = rng.i(0, i)). */
function shuffle<T extends defined>(rng: Rng, arr: T[]): void {
	for (let i = arr.size() - 1; i > 0; i--) {
		const j = rng.i(0, i);
		const t = arr[i];
		arr[i] = arr[j];
		arr[j] = t;
	}
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];

interface FloodResult {
	floorTotal: number;
	reach: number;
	maxBfs: number;
}

/**
 * The original's stage 6: 4-neighbour BFS over FLOOR from cell `ei`, writing distances into `bfs` (which must hold -1
 * everywhere). Returns the FLOOR count, the reached count and the farthest distance (0 when `ei` is not FLOOR).
 */
function floodFloor(grid: number[], W: number, ei: number, bfs: number[]): FloodResult {
	const total = grid.size();
	let floorTotal = 0;
	for (let i = 0; i < total; i++) if (grid[i] === FLOOR) floorTotal++;
	let reach = 0,
		maxBfs = 0;
	if (grid[ei] === FLOOR) {
		const q = new Array<number>(floorTotal, 0);
		let qh = 0,
			qt = 0;
		q[qt++] = ei;
		bfs[ei] = 0;
		reach = 1;
		while (qh < qt) {
			const c = q[qh++],
				x = c % W,
				b = bfs[c] + 1;
			let n = c - 1;
			if (x > 0 && grid[n] === FLOOR && bfs[n] < 0) {
				bfs[n] = b;
				q[qt++] = n;
				reach++;
			}
			n = c + 1;
			if (x < W - 1 && grid[n] === FLOOR && bfs[n] < 0) {
				bfs[n] = b;
				q[qt++] = n;
				reach++;
			}
			n = c - W;
			if (c >= W && grid[n] === FLOOR && bfs[n] < 0) {
				bfs[n] = b;
				q[qt++] = n;
				reach++;
			}
			n = c + W;
			if (c < total - W && grid[n] === FLOOR && bfs[n] < 0) {
				bfs[n] = b;
				q[qt++] = n;
				reach++;
			}
		}
		maxBfs = bfs[q[qt - 1]]; /* FIFO: last enqueued cell is farthest */
	}
	return { floorTotal, reach, maxBfs };
}

/**
 * Stages 1-4.2 of a rolled floor (every floor but a Kaleb-Vale chain): scatter, separate, Delaunay -> MST + loops,
 * semantics, minCombatRoomSize. Moved out of tryGenerate unchanged (same draws, same order). Undefined where the
 * original gave up (the Delaunay graph was disconnected).
 */
function rolledGraph(rng: Rng, p: ResolvedForgeParams): ForgeGraph | undefined {
	const N = p.roomCount;
	/* -- 1. scatter -- (Kaleb-Vale roomScale S multiplies every rolled size and the radius; S = 1 is the original) */
	const S = p.roomScale ?? 1;
	const R = math.sqrt(N) * 4.6 * S;
	const rooms: Room[] = [];
	const large: number[] = [];
	for (let i = 0; i < N; i++) {
		const t = rng.raw();
		let w: number, h: number, arch: RoomArch;
		if (t < 0.45) {
			arch = "s";
			w = rng.i(5, 7) * S;
			h = rng.i(5, 7) * S;
		} else if (t < 0.85) {
			arch = "m";
			w = rng.i(8, 12) * S;
			h = rng.i(8, 12) * S;
		} else {
			arch = "l";
			w = rng.i(13, 18) * S;
			h = rng.i(13, 18) * S;
			large.push(i);
		}
		const st = rng.raw();
		const shape: RoomShape = st < 0.6 ? "rect" : st < 0.82 ? "ellipse" : "oct";
		const ang = rng.f(0, TAU),
			rad = R * math.sqrt(rng.raw());
		const c = dcos(ang),
			s = dsin(ang);
		rooms.push({
			id: i,
			cx: c * rad,
			cy: s * rad,
			w,
			h,
			arch,
			shape,
			sx0: c * rad,
			sy0: s * rad,
			type: TYPE.COMBAT,
			depth: 0,
			difficulty: 0.2,
			degree: 0,
		});
	}
	while (large.size() < 2) {
		const j = rng.i(0, N - 1);
		if (rooms[j].arch !== "l") {
			rooms[j].arch = "l";
			rooms[j].w = rng.i(13, 18) * S;
			rooms[j].h = rng.i(13, 18) * S;
			rooms[j].shape = "rect";
			large.push(j);
		}
	}

	/* -- 2. separate -- */
	const PAD = 2;
	separate(rooms, PAD);

	/* -- 3. graph: Delaunay -> MST -> loops -- */
	const centers = rooms.map((r) => ({ x: r.cx, y: r.cy }));
	let delEdges = delaunay(centers);
	if (delEdges.size() === 0) {
		delEdges = [];
		for (let i = 0; i < N - 1; i++) delEdges.push([i, i + 1]);
	}
	const elen = (e: readonly [number, number]) =>
		hypot2(centers[e[0]].x - centers[e[1]].x, centers[e[0]].y - centers[e[1]].y);

	const adj: AdjEdge[][] = [];
	for (let i = 0; i < N; i++) adj.push([]);
	delEdges.forEach((e, idx) => {
		const w = elen(e);
		adj[e[0]].push({ b: e[1], w, idx });
		adj[e[1]].push({ b: e[0], w, idx });
	});
	const inT = new Array<boolean>(N, false);
	inT[0] = true;
	let inCount = 1;
	// The original's Set<number>: iterated in insertion order (float sum order) and tested for membership.
	const mstIdx: number[] = [];
	const inMst = new Array<boolean>(delEdges.size(), false);
	while (inCount < N) {
		let best: AdjEdge | undefined;
		for (let a = 0; a < N; a++)
			if (inT[a]) for (const e of adj[a]) if (!inT[e.b] && (!best || e.w < best.w)) best = e;
		if (!best) break;
		inT[best.b] = true;
		inCount++;
		if (!inMst[best.idx]) {
			inMst[best.idx] = true;
			mstIdx.push(best.idx);
		}
	}
	if (inCount < N) return undefined;

	let mstLenSum = 0;
	for (const i of mstIdx) mstLenSum += elen(delEdges[i]);
	const mstMean = mstLenSum / math.max(1, mstIdx.size());

	const edges: Edge[] = [];
	delEdges.forEach((e, idx) => {
		if (inMst[idx]) edges.push({ a: e[0], b: e[1], isLoop: false, isCritical: false });
		else if (elen(e) < mstMean * 2.2 && rng.chance(p.loopChance))
			edges.push({ a: e[0], b: e[1], isLoop: true, isCritical: false });
	});
	for (const e of edges) {
		rooms[e.a].degree++;
		rooms[e.b].degree++;
	}

	/* leaf guard: dungeons need dead ends — prune loop edges until >=3 leaves */
	if (N >= 20) {
		let leafCount = 0;
		for (let i = 0; i < N; i++) if (rooms[i].degree === 1) leafCount++;
		while (leafCount < 3) {
			let bi = -1,
				bs = -1;
			for (let i = 0; i < edges.size(); i++) {
				const e = edges[i];
				if (!e.isLoop) continue;
				const s = (rooms[e.a].degree === 2 ? 1 : 0) + (rooms[e.b].degree === 2 ? 1 : 0);
				const L = hypot2(centers[e.a].x - centers[e.b].x, centers[e.a].y - centers[e.b].y);
				const score = s * 10000 + L;
				if (score > bs) {
					bs = score;
					bi = i;
				}
			}
			if (bi < 0) break;
			const e = edges[bi];
			rooms[e.a].degree--;
			if (rooms[e.a].degree === 1) leafCount++;
			rooms[e.b].degree--;
			if (rooms[e.b].degree === 1) leafCount++;
			edges.remove(bi);
		}
	}

	/* -- 4. semantics before carving -- */
	const gAdj: Array<Array<{ b: number; i: number }>> = [];
	for (let i = 0; i < N; i++) gAdj.push([]);
	edges.forEach((e, i) => {
		gAdj[e.a].push({ b: e.b, i });
		gAdj[e.b].push({ b: e.a, i });
	});

	let boss = 0;
	for (let i = 1; i < N; i++) if (rooms[i].w * rooms[i].h > rooms[boss].w * rooms[boss].h) boss = i;

	const distFrom = (src: number) => {
		const D = new Array<number>(N, -1);
		D[src] = 0;
		const q = [src];
		// A while loop on purpose: roblox-ts compiles `for (h = 0; h < q.size(); h++)` to a numeric for that reads
		// #q once, but this queue grows while it is walked.
		let h = 0;
		while (h < q.size()) {
			const a = q[h++];
			for (const e of gAdj[a])
				if (D[e.b] < 0) {
					D[e.b] = D[a] + 1;
					q.push(e.b);
				}
		}
		return D;
	};
	const dB = distFrom(boss);
	let entrance = -1,
		bestD = -1;
	for (let i = 0; i < N; i++)
		if (i !== boss && rooms[i].degree === 1 && dB[i] > bestD) {
			bestD = dB[i];
			entrance = i;
		}
	if (entrance < 0) {
		for (let i = 0; i < N; i++)
			if (i !== boss && dB[i] > bestD) {
				bestD = dB[i];
				entrance = i;
			}
	}

	const dE = distFrom(entrance);
	let maxDepth = 1;
	for (let i = 0; i < N; i++) if (dE[i] > maxDepth) maxDepth = dE[i];
	rooms.forEach((r, i) => {
		r.depth = math.max(0, dE[i]);
		r.difficulty = math.min(1, 0.15 + 0.85 * (r.depth / maxDepth));
	});
	rooms[entrance].type = TYPE.ENTRANCE;
	rooms[entrance].difficulty = 0;
	rooms[boss].type = TYPE.BOSS;
	rooms[boss].difficulty = 1;

	const par = new Array<number>(N, -1),
		pe = new Array<number>(N, -1);
	{
		const q = [entrance],
			vis = new Array<boolean>(N, false);
		vis[entrance] = true;
		let h = 0;
		while (h < q.size()) {
			const a = q[h++];
			for (const e of gAdj[a])
				if (!vis[e.b]) {
					vis[e.b] = true;
					par[e.b] = a;
					pe[e.b] = e.i;
					q.push(e.b);
				}
		}
	}
	// The original's Set<number>, in insertion order (it is iterated to build eliteC).
	const critRooms: number[] = [];
	const isCrit = new Array<boolean>(N, false);
	let critLen = 0;
	for (let c = boss; c !== -1; c = par[c]) {
		if (!isCrit[c]) {
			isCrit[c] = true;
			critRooms.push(c);
		}
		if (pe[c] >= 0) {
			edges[pe[c]].isCritical = true;
			critLen++;
		}
		if (c === entrance) break;
	}

	const leaves: number[] = [];
	for (let i = 0; i < N; i++) if (i !== entrance && i !== boss && rooms[i].degree === 1) leaves.push(i);
	stableSort(leaves, (a, b) => rooms[b].depth - rooms[a].depth);
	// Kaleb-Vale treasureCap (original: 4). Fewer treasure rooms leaves more combat rooms,
	// which changes the shrine draw below: the RNG stream diverges from the demo.
	const treasureN = math.min(p.treasureCap ?? DEFAULT_TREASURE_CAP, leaves.size());
	for (let k = 0; k < treasureN; k++) rooms[leaves[k]].type = TYPE.TREASURE;

	const shrineC: number[] = [];
	for (let i = 0; i < N; i++) {
		const r = rooms[i];
		if (r.type === TYPE.COMBAT && !isCrit[i] && r.depth > maxDepth * 0.3 && r.depth < maxDepth * 0.85)
			shrineC.push(i);
	}
	// Kaleb-Vale shrineCap (original: 2). Fewer draws here shifts every later RNG call.
	const shrineMax = p.shrineCap ?? DEFAULT_SHRINE_CAP;
	for (let k = 0; k < shrineMax && shrineC.size() > 0; k++) {
		const j = shrineC.remove(rng.i(0, shrineC.size() - 1))!;
		rooms[j].type = TYPE.SHRINE;
	}
	const eliteC: number[] = [];
	for (const i of critRooms) {
		const r = rooms[i];
		if (r.type === TYPE.COMBAT && r.depth >= maxDepth * 0.55 && r.depth <= maxDepth * 0.85) eliteC.push(i);
	}
	stableSort(eliteC, (a, b) => rooms[a].depth - rooms[b].depth);
	for (let k = 0; k < math.min(2, eliteC.size()); k++) rooms[eliteC[eliteC.size() - 1 - k]].type = TYPE.ELITE;

	/* -- 4.2 Kaleb-Vale minCombatRoomSize (not in the original) --
	   Grow undersized combat/elite rooms to the minimum, then re-run the (RNG-free) separation
	   so grown rooms do not swallow their neighbours. */
	if (p.minCombatRoomSize !== undefined) {
		const m = p.minCombatRoomSize * S;
		let grew = false;
		for (const r of rooms) {
			if ((r.type === TYPE.COMBAT || r.type === TYPE.ELITE) && (r.w < m || r.h < m)) {
				r.w = math.max(r.w, m);
				r.h = math.max(r.h, m);
				grew = true;
			}
		}
		if (grew) separate(rooms, PAD);
	}
	return { rooms, edges, entrance, boss, maxDepth, critLen };
}

/**
 * One attempt with a fixed seed. Returns undefined where the original returned
 * { valid: false, stats: {} } (the Delaunay graph was disconnected, so no MST).
 */
export function tryGenerate(seed: number, params: ForgeParams): Dungeon | undefined {
	const p = resolveParams(params);
	const rng = makeRng(seed);
	const N = p.roomCount;
	const TH = THEMES[p.themeKey];

	/* -- 1-4.2: the room graph. Rolled (scatter ... minCombatRoomSize), or a Kaleb-Vale chain laid out as given. -- */
	const S = p.roomScale ?? 1;
	const graph =
		p.chain !== undefined ? chainGraph(p.chain, S, p.minCombatRoomSize, p.corridorWidth) : rolledGraph(rng, p);
	if (graph === undefined) return undefined;
	const { rooms, edges, entrance, boss, maxDepth, critLen } = graph;

	/* -- 4.5 theme room mutations (generation-aware) -- */
	if (TH.lakes) {
		const lc: number[] = [];
		for (let i = 0; i < N; i++) {
			const r = rooms[i];
			if ((r.type === TYPE.COMBAT || r.type === TYPE.ELITE) && math.min(r.w, r.h) >= 9) lc.push(i);
		}
		for (let k = 0; k < 2 && lc.size() > 0; k++) rooms[lc.remove(rng.i(0, lc.size() - 1))!].lake = true;
	}
	if (TH.graveyards) {
		const gc: number[] = [];
		for (let i = 0; i < N; i++) {
			const r = rooms[i];
			if (r.type === TYPE.COMBAT && r.shape !== "ellipse" && math.min(r.w, r.h) >= 8) gc.push(i);
		}
		for (let k = 0; k < 3 && gc.size() > 0; k++) rooms[gc.remove(rng.i(0, gc.size() - 1))!].grave = true;
	}

	/* -- 5. carve + rasterize -- */
	let minX = 1e9,
		minY = 1e9,
		maxX = -1e9,
		maxY = -1e9;
	for (const r of rooms) {
		minX = math.min(minX, r.cx - math.ceil(r.w / 2));
		maxX = math.max(maxX, r.cx + math.ceil(r.w / 2));
		minY = math.min(minY, r.cy - math.ceil(r.h / 2));
		maxY = math.max(maxY, r.cy + math.ceil(r.h / 2));
	}
	const PADG = 5,
		offX = PADG - minX,
		offY = PADG - minY;
	const W = maxX - minX + PADG * 2 + 1,
		H = maxY - minY + PADG * 2 + 1;
	for (const r of rooms) {
		r.cx += offX;
		r.cy += offY;
		r.sx0 += offX;
		r.sy0 += offY;
	}

	const total = W * H;
	const grid = new Array<number>(total, VOID);
	const roomId = new Array<number>(total, -1);
	const corridor = new Array<number>(total, 0);
	const idx = (x: number, y: number) => y * W + x;
	const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

	for (const r of rooms) {
		const rx = r.w / 2,
			ry = r.h / 2,
			sh = r.shape,
			ch = math.min(rx, ry) * 0.55;
		const irx2 = 1 / (rx * rx),
			iry2 = 1 / (ry * ry);
		const y0 = math.max(0, math.floor(r.cy - ry)),
			y1 = math.min(H - 1, math.ceil(r.cy + ry));
		const x0 = math.max(0, math.floor(r.cx - rx)),
			x1 = math.min(W - 1, math.ceil(r.cx + rx));
		for (let y = y0; y <= y1; y++) {
			const dy = y - r.cy,
				ady = math.abs(dy),
				row = y * W;
			if (ady > ry) continue;
			for (let x = x0; x <= x1; x++) {
				const dx = x - r.cx,
					adx = math.abs(dx);
				if (adx > rx) continue;
				let ok = true;
				if (sh === "ellipse") ok = dx * dx * irx2 + dy * dy * iry2 <= 1.0;
				else if (sh === "oct")
					ok = adx <= rx - ch || ady <= ry - ch || adx - (rx - ch) + (ady - (ry - ch)) <= ch;
				if (ok) {
					const c = row + x;
					grid[c] = FLOOR;
					roomId[c] = r.id;
				}
			}
		}
	}

	const stamp = (x: number, y: number) => {
		if (inB(x, y) && grid[idx(x, y)] !== FLOOR) {
			grid[idx(x, y)] = FLOOR;
			corridor[idx(x, y)] = 1;
		}
	};
	const hLine = (x0: number, x1: number, y: number, w: number) => {
		const o = corridorOffsets(w);
		for (let x = math.min(x0, x1); x <= math.max(x0, x1); x++) for (const k of o) stamp(x, y + k);
	};
	const vLine = (y0: number, y1: number, x: number, w: number) => {
		const o = corridorOffsets(w);
		for (let y = math.min(y0, y1); y <= math.max(y0, y1); y++) for (const k of o) stamp(x + k, y);
	};

	for (const e of edges) {
		const A = rooms[e.a],
			B = rooms[e.b];
		let w: number;
		if (p.corridorWidth !== undefined) {
			// Kaleb-Vale corridorWidth: fixed width, and the original's 40% treasure-corridor
			// narrowing draw is skipped, so the RNG stream diverges from the demo here.
			w = p.corridorWidth;
		} else {
			w = e.isCritical ? 3 : 2;
			if (
				!e.isCritical &&
				(rooms[e.a].type === TYPE.TREASURE || rooms[e.b].type === TYPE.TREASURE) &&
				rng.chance(0.4)
			)
				w = 1;
		}
		const dx = math.abs(A.cx - B.cx),
			dy = math.abs(A.cy - B.cy);
		const ovX = math.min(A.cx + A.w / 2, B.cx + B.w / 2) - math.max(A.cx - A.w / 2, B.cx - B.w / 2);
		const ovY = math.min(A.cy + A.h / 2, B.cy + B.h / 2) - math.max(A.cy - A.h / 2, B.cy - B.h / 2);
		if (ovX >= w + 2 && dy > 0) {
			const x = jsRound(
				(math.max(A.cx - A.w / 2, B.cx - B.w / 2) + math.min(A.cx + A.w / 2, B.cx + B.w / 2)) / 2,
			);
			vLine(A.cy, B.cy, x, w);
		} else if (ovY >= w + 2 && dx > 0) {
			const y = jsRound(
				(math.max(A.cy - A.h / 2, B.cy - B.h / 2) + math.min(A.cy + A.h / 2, B.cy + B.h / 2)) / 2,
			);
			hLine(A.cx, B.cx, y, w);
		} else if (rng.chance(0.5)) {
			hLine(A.cx, B.cx, A.cy, w);
			vLine(A.cy, B.cy, B.cx, w);
		} else {
			vLine(A.cy, B.cy, A.cx, w);
			hLine(A.cx, B.cx, B.cy, w);
		}
	}

	for (let y = 0; y < H; y++) {
		const row = y * W;
		for (let x = 0; x < W; x++) {
			if (grid[row + x] !== FLOOR) continue;
			const ya = math.max(0, y - 1),
				yb = math.min(H - 1, y + 1);
			const xa = math.max(0, x - 1),
				xb = math.min(W - 1, x + 1);
			for (let ny = ya; ny <= yb; ny++) {
				const nrow = ny * W;
				for (let nx = xa; nx <= xb; nx++) {
					const ni = nrow + nx;
					if (grid[ni] === VOID) grid[ni] = WALL;
				}
			}
		}
	}

	const doorway = new Array<number>(total, 0);
	for (let y = 0; y < H; y++) {
		const row = y * W;
		for (let x = 0; x < W; x++) {
			const c = row + x;
			if (corridor[c] === 0) continue;
			if (
				(x < W - 1 && roomId[c + 1] >= 0) ||
				(x > 0 && roomId[c - 1] >= 0) ||
				(y < H - 1 && roomId[c + W] >= 0) ||
				(y > 0 && roomId[c - W] >= 0)
			)
				doorway[c] = 1;
		}
	}

	/* -- 5.5 theme carving: liquid pockets, frozen lakes, arches -- */
	/* Pockets replace single WALL cells with sunken liquid slots (POOL).
	   Connectivity is untouched: floor cells never change, and any VOID
	   exposed behind a pocket is backfilled with WALL. */
	const pools: Cell[] = [];
	const poolSpec = TH.pools;
	if (poolSpec && poolSpec.amount > 0) {
		const nearDoorC = (x: number, y: number, d: number) => {
			for (let oy = -d; oy <= d; oy++)
				for (let ox = -d; ox <= d; ox++) {
					const nx = x + ox,
						ny = y + oy;
					if (nx >= 0 && ny >= 0 && nx < W && ny < H && doorway[idx(nx, ny)] !== 0) return true;
				}
			return false;
		};
		const cand: Cell[] = [];
		for (let y = 1; y < H - 1; y++)
			for (let x = 1; x < W - 1; x++) {
				const c = idx(x, y);
				if (grid[c] !== WALL || nearDoorC(x, y, 2)) continue;
				let nf = 0;
				if (grid[c + 1] === FLOOR) nf++;
				if (grid[c - 1] === FLOOR) nf++;
				if (grid[c + W] === FLOOR) nf++;
				if (grid[c - W] === FLOOR) nf++;
				if (nf === 1) cand.push({ x, y });
			}
		shuffle(rng, cand);
		const target = jsRound(cand.size() * poolSpec.amount);
		for (const s of cand) {
			if (pools.size() >= target) break;
			let close = false;
			for (const pl of pools)
				if (math.max(math.abs(pl.x - s.x), math.abs(pl.y - s.y)) < 3) {
					close = true;
					break;
				}
			if (close) continue;
			grid[idx(s.x, s.y)] = POOL;
			pools.push({ x: s.x, y: s.y });
		}
		for (const pl of pools)
			for (let oy = -1; oy <= 1; oy++)
				for (let ox = -1; ox <= 1; ox++) {
					const nx = pl.x + ox,
						ny = pl.y + oy;
					if (nx >= 0 && ny >= 0 && nx < W && ny < H && grid[idx(nx, ny)] === VOID) grid[idx(nx, ny)] = WALL;
				}
	}

	/* Interior liquid pits: single floor cells sunk into lava/water/miasma.
	   Carved before BFS validation, so connectivity is still guaranteed;
	   interior-only + spacing >= 4 means a room can never be split. */
	const pits = poolSpec ? poolSpec.pits ?? 0 : 0;
	if (pits !== 0) {
		const nearCorridor = (x: number, y: number, dist: number) => {
			for (let oy = -dist; oy <= dist; oy++)
				for (let ox = -dist; ox <= dist; ox++)
					if (inB(x + ox, y + oy) && corridor[idx(x + ox, y + oy)] !== 0) return true;
			return false;
		};
		for (const r of rooms) {
			if ((r.type !== TYPE.COMBAT && r.type !== TYPE.ELITE) || r.lake || r.grave) continue;
			let n = math.min(pits, math.floor((r.w * r.h) / 45) + 1),
				guard = 0;
			while (n > 0 && guard++ < 40) {
				const x = rng.i(math.floor(r.cx - r.w / 2) + 2, math.ceil(r.cx + r.w / 2) - 2);
				const y = rng.i(math.floor(r.cy - r.h / 2) + 2, math.ceil(r.cy + r.h / 2) - 2);
				if (!inB(x, y)) continue;
				const c = idx(x, y);
				if (roomId[c] !== r.id || grid[c] !== FLOOR || doorway[c] !== 0) continue;
				// Kaleb-Vale corridorWidth also promises that clearance at corridor mouths: no pit
				// within 2 tiles of a corridor cell. Off by default; rejected tries cost a guard step as usual.
				if (p.corridorWidth !== undefined && nearCorridor(x, y, 2)) continue;
				let ok = true;
				for (let oy = -1; oy <= 1 && ok; oy++)
					for (let ox = -1; ox <= 1; ox++)
						if (grid[idx(x + ox, y + oy)] !== FLOOR) {
							ok = false;
							break;
						}
				if (ok)
					for (const pl of pools)
						if (math.max(math.abs(pl.x - x), math.abs(pl.y - y)) < 4) {
							ok = false;
							break;
						}
				if (!ok) continue;
				grid[c] = POOL;
				pools.push({ x, y });
				n--;
			}
		}
	}

	/* Frozen lakes: interior floor cells of lake rooms stay walkable (FLOOR
	   for BFS) but are flagged so rendering swaps stone tiles for ice. */
	const lakeMask = new Array<number>(total, 0);
	const lakeCells: Cell[] = [];
	for (const r of rooms) {
		if (!r.lake) continue;
		for (let y = math.floor(r.cy - r.h / 2) + 2; y <= math.ceil(r.cy + r.h / 2) - 2; y++)
			for (let x = math.floor(r.cx - r.w / 2) + 2; x <= math.ceil(r.cx + r.w / 2) - 2; x++) {
				if (!inB(x, y)) continue;
				const c = idx(x, y);
				if (roomId[c] !== r.id || grid[c] !== FLOOR || doorway[c] !== 0) continue;
				let solid = false;
				for (let oy = -1; oy <= 1 && !solid; oy++)
					for (let ox = -1; ox <= 1; ox++)
						if (grid[idx(x + ox, y + oy)] !== FLOOR) {
							solid = true;
							break;
						}
				if (!solid) {
					lakeMask[c] = 1;
					lakeCells.push({ x, y });
				}
			}
	}

	/* Doorway arches: group doorway cells into runs perpendicular to the
	   corridor axis; one arch frame per run of width <= 3. */
	const arches: Arch[] = [];
	{
		const aseen = new Array<boolean>(total, false);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const c = idx(x, y);
				if (doorway[c] === 0 || aseen[c]) continue;
				// The original also computes an unused `ry` in an else-branch here; dropped (no effect).
				let rx = 0;
				if (x < W - 1 && roomId[c + 1] >= 0) rx = 1;
				else if (x > 0 && roomId[c - 1] >= 0) rx = -1;
				const px = rx === 0 ? 1 : 0,
					py = rx === 0 ? 0 : 1;
				let x0 = x,
					y0 = y,
					x1 = x,
					y1 = y;
				while (inB(x0 - px, y0 - py) && doorway[idx(x0 - px, y0 - py)] !== 0 && !aseen[idx(x0 - px, y0 - py)]) {
					x0 -= px;
					y0 -= py;
				}
				while (inB(x1 + px, y1 + py) && doorway[idx(x1 + px, y1 + py)] !== 0 && !aseen[idx(x1 + px, y1 + py)]) {
					x1 += px;
					y1 += py;
				}
				let len = 0;
				for (let ax = x0, ay = y0; ; ax += px, ay += py) {
					aseen[idx(ax, ay)] = true;
					len++;
					if (ax === x1 && ay === y1) break;
				}
				if (len <= 3) arches.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, px, py, len });
			}
	}

	/* -- 6. BFS field + validation -- */
	const bfs = new Array<number>(total, -1);
	const ei = idx(rooms[entrance].cx, rooms[entrance].cy);
	const field = floodFloor(grid, W, ei, bfs);
	let floorTotal = field.floorTotal,
		reach = field.reach,
		maxBfs = field.maxBfs;
	let valid = reach === floorTotal && floorTotal > 0;

	/* -- 7. decoration (pure data) -- */
	const props: Prop[] = [],
		spawns: Spawn[] = [];
	const occ = new Array<boolean>(total, false);
	const nearDoor = (x: number, y: number, d: number) => {
		for (let oy = -d; oy <= d; oy++)
			for (let ox = -d; ox <= d; ox++) if (inB(x + ox, y + oy) && doorway[idx(x + ox, y + oy)] !== 0) return true;
		return false;
	};
	const interior = (x: number, y: number) => {
		for (let oy = -1; oy <= 1; oy++)
			for (let ox = -1; ox <= 1; ox++)
				if (!inB(x + ox, y + oy) || grid[idx(x + ox, y + oy)] !== FLOOR) return false;
		return true;
	};
	const put = (kind: PropKind, x: number, y: number, rot: number, scale: number, rid: number) => {
		props.push({ kind, x, y, rot: orZero(rot), scale: orOne(scale), roomId: rid });
		occ[idx(x, y)] = true;
	};

	for (const r of rooms) {
		const cix = idx(r.cx, r.cy);
		if (r.type === TYPE.ENTRANCE) put("ring", r.cx, r.cy, 0, 1, r.id);
		if (r.type === TYPE.BOSS) {
			put("bossCrystal", r.cx, r.cy, rng.f(0, 6.28), 1, r.id);
			const rr = math.max(2.5, math.min(r.w, r.h) / 2 - 2),
				a0 = rng.f(0, 1);
			for (let k = 0; k < 6; k++) {
				const a = a0 + (k * math.pi) / 3;
				const bx = jsRound(r.cx + dcos(a) * rr),
					by = jsRound(r.cy + dsin(a) * rr);
				if (inB(bx, by) && grid[idx(bx, by)] === FLOOR && !occ[idx(bx, by)] && !nearDoor(bx, by, 1))
					put("brazier", bx, by, 0, 1, r.id);
			}
		}
		if (r.type === TYPE.TREASURE && grid[cix] === FLOOR)
			put("chest", r.cx, r.cy, (rng.i(0, 3) * math.pi) / 2, 1, r.id);
		if (r.type === TYPE.SHRINE && grid[cix] === FLOOR) put("shrineCrystal", r.cx, r.cy, rng.f(0, 6.28), 1, r.id);

		if (
			(r.type === TYPE.COMBAT || r.type === TYPE.ELITE) &&
			math.min(r.w, r.h) >= 10 &&
			r.shape !== "ellipse" &&
			!r.grave &&
			!r.lake
		) {
			const step = math.min(r.w, r.h) >= 14 ? 4 : 3;
			for (let y = math.ceil(r.cy - r.h / 2) + 2; y <= r.cy + r.h / 2 - 2; y++)
				for (let x = math.ceil(r.cx - r.w / 2) + 2; x <= r.cx + r.w / 2 - 2; x++) {
					if (jsRem(x - r.cx, step) !== 0 || jsRem(y - r.cy, step) !== 0) continue;
					if (x === r.cx && y === r.cy) continue;
					if (interior(x, y) && !occ[idx(x, y)] && !nearDoor(x, y, 2))
						put("pillar", x, y, 0, rng.f(0.94, 1.06), r.id);
				}
		}
		if (r.grave) {
			for (let y = math.ceil(r.cy - r.h / 2) + 2; y <= r.cy + r.h / 2 - 2; y += 2)
				for (let x = math.ceil(r.cx - r.w / 2) + 2; x <= r.cx + r.w / 2 - 2; x += 2) {
					if (math.abs(x - r.cx) <= 1 && math.abs(y - r.cy) <= 1) continue;
					if (interior(x, y) && !occ[idx(x, y)] && !nearDoor(x, y, 2) && rng.chance(0.8))
						put("grave", x, y, rng.f(-0.3, 0.3), rng.f(0.85, 1.15), r.id);
				}
			if (math.min(r.w, r.h) >= 10 && grid[cix] === FLOOR && !occ[cix])
				put("sarco", r.cx, r.cy, rng.chance(0.5) ? 0 : math.pi / 2, 1, r.id);
			let cd = 4;
			while (cd-- > 0) {
				const x = rng.i(math.floor(r.cx - r.w / 2) + 1, math.ceil(r.cx + r.w / 2) - 1);
				const y = rng.i(math.floor(r.cy - r.h / 2) + 1, math.ceil(r.cy + r.h / 2) - 1);
				if (inB(x, y) && roomId[idx(x, y)] === r.id && grid[idx(x, y)] === FLOOR && !occ[idx(x, y)])
					put("candle", x, y, 0, rng.f(0.85, 1.2), r.id);
			}
		}
		if (r.type === TYPE.COMBAT || r.type === TYPE.ELITE || r.type === TYPE.BOSS) {
			let area = 0;
			for (let y = math.floor(r.cy - r.h / 2); y <= math.ceil(r.cy + r.h / 2); y++)
				for (let x = math.floor(r.cx - r.w / 2); x <= math.ceil(r.cx + r.w / 2); x++)
					if (inB(x, y) && roomId[idx(x, y)] === r.id) area++;
			let count = jsRound((area / 18) * (0.5 + r.difficulty));
			if (r.type === TYPE.ELITE) count = math.max(2, jsRound(count * 0.6));
			if (r.type === TYPE.BOSS) count = rng.i(2, 3);
			const tier = r.type === TYPE.ELITE ? 3 : math.max(1, math.ceil(r.difficulty * 3));
			let guard = 0;
			while (count > 0 && guard++ < 220) {
				const x = rng.i(math.floor(r.cx - r.w / 2) + 1, math.ceil(r.cx + r.w / 2) - 1);
				const y = rng.i(math.floor(r.cy - r.h / 2) + 1, math.ceil(r.cy + r.h / 2) - 1);
				if (!inB(x, y)) continue;
				const c = idx(x, y);
				if (roomId[c] === r.id && grid[c] === FLOOR && !occ[c] && doorway[c] === 0 && lakeMask[c] === 0) {
					spawns.push({ x, y, tier, roomId: r.id });
					occ[c] = true;
					count--;
				}
			}
		}
	}
	const torchCand: Torch[] = [];
	for (let y = 0; y < H; y++) {
		const row = y * W;
		for (let x = 0; x < W; x++) {
			const c = row + x;
			if (grid[c] !== WALL) continue;
			if (x < W - 1 && grid[c + 1] === FLOOR) torchCand.push({ x, y, dx: 1, dy: 0 });
			else if (x > 0 && grid[c - 1] === FLOOR) torchCand.push({ x, y, dx: -1, dy: 0 });
			else if (y < H - 1 && grid[c + W] === FLOOR) torchCand.push({ x, y, dx: 0, dy: 1 });
			else if (y > 0 && grid[c - W] === FLOOR) torchCand.push({ x, y, dx: 0, dy: -1 });
		}
	}
	shuffle(rng, torchCand);
	const torches: Torch[] = [];
	for (const c of torchCand) {
		let ok = true;
		for (const t of torches)
			if (math.max(math.abs(t.x - c.x), math.abs(t.y - c.y)) < 4) {
				ok = false;
				break;
			}
		if (ok) torches.push(c);
	}
	for (let y = 0; y < H; y++) {
		const row = y * W;
		for (let x = 0; x < W; x++) {
			const c = row + x;
			if (grid[c] !== FLOOR || occ[c] || doorway[c] !== 0 || lakeMask[c] !== 0) continue;
			const rid = roomId[c];
			const diff = rid >= 0 ? rooms[rid].difficulty : 0.5;
			let pr = p.decorDensity * 0.045 * (1.25 - 0.6 * diff);
			if (corridor[c] !== 0) pr *= 0.45;
			if (rng.chance(pr)) {
				// object-literal evaluation order: rot, scale, then v
				const rot = rng.f(0, 6.28);
				const scale = rng.f(0.6, 1.35);
				const v = rng.i(0, 2);
				props.push({ kind: "debris", x, y, rot, scale, roomId: rid, v });
			}
		}
	}

	/* -- 7.5 theme prop sweeps -- */
	const floorDir = (x: number, y: number): readonly [number, number] | undefined => {
		const c = idx(x, y);
		if (x < W - 1 && grid[c + 1] === FLOOR) return [1, 0];
		if (x > 0 && grid[c - 1] === FLOOR) return [-1, 0];
		if (y < H - 1 && grid[c + W] === FLOOR) return [0, 1];
		if (y > 0 && grid[c - W] === FLOOR) return [0, -1];
		return undefined;
	};
	if (TH.icicles) {
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				if (grid[idx(x, y)] !== WALL) continue;
				const d = floorDir(x, y);
				if (d && rng.chance(0.06 + 0.08 * p.decorDensity)) {
					const rot = rng.f(0, 6.28);
					const scale = rng.f(0.7, 1.3);
					props.push({ kind: "icicle", x, y, dx: d[0], dy: d[1], rot, scale });
				}
			}
		for (const lc of lakeCells)
			if (rng.chance(0.05)) {
				const rot = rng.f(0, 6.28);
				const scale = rng.f(0.6, 1.2);
				props.push({ kind: "shardIce", x: lc.x, y: lc.y, rot, scale });
			}
	}
	if (TH.roots) {
		const sites: Torch[] = [];
		for (let y = 1; y < H - 1; y++)
			for (let x = 1; x < W - 1; x++) {
				if (grid[idx(x, y)] !== WALL) continue;
				const d = floorDir(x, y);
				if (d && roomId[idx(x + d[0], y + d[1])] >= 0) sites.push({ x, y, dx: d[0], dy: d[1] });
			}
		shuffle(rng, sites);
		const breaches: Torch[] = [];
		for (const s of sites) {
			if (breaches.size() >= 5) break;
			let close = false;
			for (const b of breaches)
				if (math.max(math.abs(b.x - s.x), math.abs(b.y - s.y)) < 7) {
					close = true;
					break;
				}
			if (!close) breaches.push(s);
		}
		const mossMask = new Array<boolean>(total, false);
		for (const b of breaches) {
			props.push({ kind: "roots", x: b.x, y: b.y, dx: b.dx, dy: b.dy, rot: 0, scale: rng.f(0.9, 1.2) });
			for (let oy = -2; oy <= 2; oy++)
				for (let ox = -2; ox <= 2; ox++) {
					const nx = b.x + ox,
						ny = b.y + oy;
					if (!inB(nx, ny)) continue;
					const c = idx(nx, ny);
					if (grid[c] === FLOOR && !mossMask[c] && rng.chance(0.75)) {
						mossMask[c] = true;
						const rot = rng.f(0, 6.28);
						const scale = rng.f(0.7, 1.4);
						props.push({ kind: "moss", x: nx, y: ny, rot, scale });
					}
				}
		}
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const c = idx(x, y);
				if (grid[c] !== FLOOR || mossMask[c] || lakeMask[c] !== 0) continue;
				let nw = 0;
				if (x < W - 1 && grid[c + 1] === WALL) nw++;
				if (x > 0 && grid[c - 1] === WALL) nw++;
				if (y < H - 1 && grid[c + W] === WALL) nw++;
				if (y > 0 && grid[c - W] === WALL) nw++;
				if (nw > 0 && rng.chance(0.12 * p.decorDensity)) {
					mossMask[c] = true;
					const rot = rng.f(0, 6.28);
					const scale = rng.f(0.6, 1.3);
					props.push({ kind: "moss", x, y, rot, scale });
				}
			}
	}
	if (TH.bones) {
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const c = idx(x, y);
				if (grid[c] !== FLOOR || occ[c] || doorway[c] !== 0 || corridor[c] !== 0) continue;
				const rid = roomId[c];
				if (rid >= 0 && rooms[rid].depth > 1 && rng.chance(0.018 + 0.02 * p.decorDensity)) {
					const rot = rng.f(0, 6.28);
					const scale = rng.f(0.8, 1.2);
					props.push({ kind: "bones", x, y, rot, scale, roomId: rid });
				}
			}
	}
	/* liquid veins: crack decals anchored to pool edges so they read as heat/
	   rot radiating FROM the liquid into the surrounding stone, never floating
	   mid-room. Frost gets pale fracture lines around lake shores. */
	if (poolSpec && (poolSpec.mode === 0 || poolSpec.mode === 3)) {
		const pv = poolSpec.mode === 0 ? 0.8 : 0.45;
		for (const pl of pools)
			for (const [dx, dy] of DIRS) {
				const nx = pl.x + dx,
					ny = pl.y + dy;
				if (!inB(nx, ny) || grid[idx(nx, ny)] !== FLOOR) continue;
				if (rng.chance(pv)) {
					const rot = rng.f(0, 6.28);
					const scale = rng.f(0.9, 1.5);
					props.push({ kind: "crack", x: nx, y: ny, dx, dy, rot, scale });
				}
			}
	}
	if (TH.lakes) {
		for (const lc of lakeCells)
			for (const [dx, dy] of DIRS) {
				const nx = lc.x + dx,
					ny = lc.y + dy;
				if (!inB(nx, ny)) continue;
				const c2 = idx(nx, ny);
				if (grid[c2] !== FLOOR || lakeMask[c2] !== 0) continue;
				if (rng.chance(0.3)) {
					const rot = rng.f(0, 6.28);
					const scale = rng.f(0.7, 1.2);
					props.push({ kind: "crack", x: nx, y: ny, dx, dy, rot, scale, ice: 1 });
				}
			}
	}
	for (const r of rooms) {
		if (r.type !== TYPE.ELITE && r.type !== TYPE.BOSS) continue;
		const cand: Torch[] = [];
		for (let y = math.floor(r.cy - r.h / 2) - 1; y <= math.ceil(r.cy + r.h / 2) + 1; y++)
			for (let x = math.floor(r.cx - r.w / 2) - 1; x <= math.ceil(r.cx + r.w / 2) + 1; x++) {
				if (!inB(x, y) || grid[idx(x, y)] !== WALL) continue;
				const d = floorDir(x, y);
				if (d && roomId[idx(x + d[0], y + d[1])] === r.id) cand.push({ x, y, dx: d[0], dy: d[1] });
			}
		shuffle(rng, cand);
		const placed: Torch[] = [];
		for (const s of cand) {
			if (placed.size() >= (r.type === TYPE.BOSS ? 4 : 2)) break;
			let close = false;
			for (const pl of placed)
				if (math.max(math.abs(pl.x - s.x), math.abs(pl.y - s.y)) < 4) {
					close = true;
					break;
				}
			if (!close) {
				placed.push(s);
				props.push({ kind: "banner", x: s.x, y: s.y, dx: s.dx, dy: s.dy, rot: 0, scale: 1 });
			}
		}
	}

	let loops = 0;
	for (const e of edges) if (e.isLoop) loops++;
	const name = dungeonName(rng, TH);

	/* -- 8. Kaleb-Vale solidPillars (not in the original) --
	   After the last rng draw, so the stream and every other piece (props, spawns, torches, arches, pools, the name)
	   are exactly what the option-off floor has. Each pillar cell becomes WALL; the pillar props stay in `props`.
	   Kept per cell: roomId (like an interior liquid pit, the cell stays in its room's footprint; walkability is the
	   grid's job), doorway / corridor / lakeMask (all 0 there: pillars are interior room cells away from doors and
	   never in lake rooms). Recomputed: the BFS field, maxBfs, floorTiles, reach and valid. A pillar has 8 FLOOR
	   neighbours when it is placed and pillars stand >= 3 tiles apart, so walling one never splits the floor; valid
	   is still re-derived from the new BFS (a false here would be a generator bug: generateDungeon rerolls on it).
	   No torch sits on a pillar (torches are placed on the walls of the option-off grid); a flat prop could in theory
	   share a pillar's cell (verdant breach moss does not check occupancy), none does in 300 endless floors. */
	let walled = 0;
	if (p.solidPillars === true) {
		for (const pr of props) {
			if (pr.kind !== "pillar") continue;
			const c = idx(pr.x, pr.y);
			if (grid[c] !== FLOOR) continue;
			grid[c] = WALL;
			walled++;
		}
	}

	/* -- 9. Kaleb-Vale solidDecor (not in the original; ./solidDecor.ts) --
	   After solid pillars, from its own stream: tombs and candle stands in combat / elite rooms become WALL. Their
	   clearance ring keeps the floor in one piece; if a re-flood ever finds otherwise, the pieces are taken back (the
	   floor is then exactly the option-off one), so they never cost a reroll. */
	let solidDecor: SolidDecorPiece[] = [];
	if (p.solidDecor === true) {
		const before = [...grid];
		solidDecor = placeSolidDecor(seed, W, H, grid, roomId, doorway, rooms);
		if (solidDecor.size() > 0) {
			const probe = new Array<number>(total, -1);
			const f3 = floodFloor(grid, W, ei, probe);
			if (f3.reach !== f3.floorTotal) {
				for (let i = 0; i < total; i++) grid[i] = before[i];
				solidDecor = [];
			} else walled += solidDecor.size();
		}
	}
	if (walled > 0) {
		for (let i = 0; i < total; i++) bfs[i] = -1;
		const f2 = floodFloor(grid, W, ei, bfs);
		floorTotal = f2.floorTotal;
		reach = f2.reach;
		maxBfs = f2.maxBfs;
		valid = valid && reach === floorTotal && floorTotal > 0;
	}
	return {
		valid,
		params: p,
		seed,
		name,
		W,
		H,
		grid,
		roomId,
		corridor,
		doorway,
		bfs,
		maxBfs,
		rooms,
		edges,
		entrance,
		boss,
		maxDepth,
		props,
		spawns,
		torches,
		pools,
		lakeCells,
		lakeMask,
		arches,
		solidDecor,
		stats: {
			rooms: N,
			edges: edges.size(),
			loops,
			critLen,
			floorTiles: floorTotal,
			reach,
			genMs: 0,
			attempts: 1,
		},
	};
}
