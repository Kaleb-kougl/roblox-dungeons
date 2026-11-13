/**
 * The void planner (docs/VOID_DECOR.md VD2, VD4): which void cells are shoulder, ledge, outcrop or abyss, how high
 * each stands, and the greedy rectangles (one Part each, VD3) that cover them. Pure and deterministic: the same Dungeon
 * and floor seed give the same plan on every client and replay viewer. View code: it reads the Dungeon, never the sim,
 * and changes no collision, hash or replay (VDD4). Every choice is decorHash(floorSeed, key, VOID.salt.*).
 *
 * Rules, in the order planVoid applies them (distances are the field's Chebyshev distance to a wall / floor cell):
 *   shoulder  every void cell at dist <= VOID.shoulderMinTiles; beyond that, cells out to the minimum plus the band's
 *             extra width (VOID_DEPTH: shoulderExtraMin..Max), the extra read per cell from value noise on a lattice
 *             VOID.shoulderNoiseTiles apart (smooth, so the edge is ragged over a few tiles and neighbouring cells'
 *             widths differ by at most one tile). Enclosed pockets whose deepest cell is within VOID.pocketFillTiles
 *             fill solid. Then a cleanup: a shoulder cell past the minimum with no shoulder neighbour one tile closer
 *             to the dungeon is dropped (nothing floats detached from the band), and a void cell whose four
 *             neighbours are all shoulder or non-void is filled (no 1-cell holes).
 *   ledge     void cells next to the shoulder (8-neighbours), kept per VOID.ledgeChunkTiles square chunk with the
 *             band's ledgeKeep share.
 *   outcrop   in the mid band (VOID.outcropMinDist..outcropMaxDist), at cells touching no shoulder, ledge or other
 *             outcrop: seeds at the band's outcropRate per VOID.outcropRatePer eligible cells (hashed gaps between
 *             seeds along the scan, so one hash per seed, not per cell), each grown (4-connected, by hash) to
 *             1..VOID.outcropMaxCells cells; top = the shoulder's or the ledge's (hash).
 *             Never higher than the shoulder top: taller pieces are VD5's, under the footprint rule.
 *   abyss     every other void cell (top -VOID.abyssDepthTiles). Non-void cells are NONE with top 0.
 *   rects     greedy rectangles (tileMerge's greedyRects scan) merged per (layer, top), in scan order. With a
 *             hold-out (VoidPlanInput.holdOut: a secret room's chamber and ring, docs/SECRET_ROOMS.md SR7) the cells
 *             inside it merge only with each other, never across its edge, and `held` lists their rects, so the
 *             VoidController can sink them at the open; every layer and top is the same as without it. No hold-out:
 *             the plan is exactly the one before (no `held`).
 *
 * Why nothing here can hide a bullet: the Forge walls all eight neighbours of every floor and pool cell, so void is at
 * least one wall tile from anywhere a bullet flies, and every top here is at most VOID.shoulderTopTiles (below the wall
 * top). The view ray from a bullet climbs about 1.4 tiles per tile it travels (the camera's 55 degree pitch), so it is
 * far above any void top before it reaches a void cell (plan.spec.ts checks it with ray casts).
 */
import type { Dungeon, EndlessFloorLayout } from "shared/dungeon";
import { TileType } from "shared/dungeon";
import { decorHash01, decorProfile, type DecorProfile } from "../decor";
import { VOID, VOID_DEPTH, type VoidDepthBand } from "./config";
import { voidField, type VoidField } from "./field";
import { VoidLayer } from "./layer";
// By file: a leaf (the shared/view/secrets barrel imports the void's planner's users).
import { inCellRect, secretRingRect, type CellRect } from "../secrets/geometry";

/** Cells [x, x + w) x [y, y + h) of one layer at one height (grid cells; top in tiles above the floor). */
export interface VoidRect {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
	readonly layer: VoidLayer;
	readonly top: number;
}

/** What planVoid reads. Only `dungeon` is required (M1 and tests); endless floors pass their layout's seed and floor. */
export interface VoidPlanInput {
	readonly dungeon: Dungeon;
	/** The floor seed (decorHash's seed); default dungeon.seed. */
	readonly floorSeed?: number;
	/** Endless floor number (the depth band); default 1. */
	readonly floor?: number;
	/** The run's Depth (state.endless.depth); default 1. */
	readonly depth?: number;
	/** Force a depth band (KV_DecorBand). */
	readonly forceBand?: number;
	/** A ready decor profile (its band overrides floor / depth / forceBand). */
	readonly profile?: DecorProfile;
	/**
	 * docs/SECRET_ROOMS.md SR7: a rectangle of cells (a secret room's chamber and its ring, secretRingRect) whose raised
	 * cells form rects of their own (VoidPlan.held), never merged across its edge. Absent: the plan before, exactly.
	 */
	readonly holdOut?: CellRect;
}

/** Cell counts of a plan, per layer, and the outcrop draw's inputs. */
export interface VoidStats {
	readonly shoulder: number;
	readonly ledge: number;
	readonly outcrop: number;
	readonly abyss: number;
	/** Shoulder cells that came from the pocket fill alone (beyond the band's width). */
	readonly pocketFilled: number;
	/** Outcrop clusters. */
	readonly outcrops: number;
	/** Cells that were eligible outcrop seeds when the scan reached them. */
	readonly outcropEligible: number;
}

export interface VoidPlan {
	readonly W: number;
	readonly H: number;
	readonly floorSeed: number;
	/** Index into VOID_DEPTH.bands (= DECOR_DEPTH.bands). */
	readonly band: number;
	/** VoidLayer per cell (y * W + x). */
	readonly layer: ReadonlyArray<number>;
	/** Top per cell, tiles above the floor: abyss cells -VOID.abyssDepthTiles, non-void 0. */
	readonly top: ReadonlyArray<number>;
	readonly field: VoidField;
	/** Shoulder, ledge and outcrop cells, greedy-merged per (layer, top). */
	readonly rects: ReadonlyArray<VoidRect>;
	readonly stats: VoidStats;
	/**
	 * With VoidPlanInput.holdOut: the indices into `rects` (ascending) of the rects inside it (every one of their cells
	 * is in the hold-out; no other rect has one). Absent without a hold-out.
	 */
	readonly held?: ReadonlyArray<number>;
}

/**
 * planVoid's input for an endless floor layout (its seed and floor; a secret floor's chamber and ring as the hold-out,
 * docs/SECRET_ROOMS.md SR7: the rock over them sinks at the open).
 */
export function voidInputOfLayout(layout: EndlessFloorLayout, depth?: number): VoidPlanInput {
	const secret = layout.secret;
	return {
		dungeon: layout.dungeon,
		floorSeed: layout.seed,
		floor: layout.floor,
		depth,
		holdOut: secret !== undefined ? secretRingRect(secret) : undefined,
	};
}

/** The VOID_DEPTH band index `input` plans with (decorProfile's band, clamped to VOID_DEPTH). */
export function voidBandOf(input: VoidPlanInput): number {
	const d = input.dungeon;
	const band =
		input.profile !== undefined
			? input.profile.band
			: decorProfile(input.floor ?? 1, input.depth ?? 1, d.params.themeKey, input.forceBand).band;
	return math.clamp(math.floor(band), 0, VOID_DEPTH.bands.size() - 1);
}

/** halo value of a cell next to the shoulder, the ledge or two outcrops: no outcrop may take it. */
const HALO_BLOCKED = -2;

/** chunkKeep value of a ledge chunk not rolled yet. */
const CHUNK_UNSET = -1;

/** Smoothstep weight of t in [0, 1]. */
function smooth(t: number): number {
	return t * t * (3 - 2 * t);
}

/** The plan of `input.dungeon` (see the file comment). Pure: the same input gives the same plan. */
export function planVoid(input: VoidPlanInput): VoidPlan {
	const d = input.dungeon;
	const W = d.W;
	const H = d.H;
	const n = W * H;
	const grid = d.grid;
	const seed = input.floorSeed ?? d.seed;
	const band = voidBandOf(input);
	const b: VoidDepthBand = VOID_DEPTH.bands[band];
	const field = voidField(d);
	const dist = field.dist;
	const salt = VOID.salt;

	const shoulderTop = VOID.shoulderTopTiles;
	const ledgeTop = VOID.ledgeTopTiles;
	const abyssTop = -VOID.abyssDepthTiles;
	const minT = VOID.shoulderMinTiles;
	const extraMin = math.max(0, math.floor(b.shoulderExtraMin));
	const extraMax = math.max(extraMin, math.floor(b.shoulderExtraMax));
	const extraSpan = extraMax - extraMin + 1;
	const maxShoulder = minT + extraMax;

	const layer = new Array<number>(n, VoidLayer.NONE);
	const top = new Array<number>(n, 0);
	/** Shoulder cells set by the pocket fill (exempt from the detached-cell cleanup). */
	const pocketFill = new Array<boolean>(n, false);

	// --- shoulder: the minimum, the band's ragged extra width, the pocket fill -------------------------------
	const S = math.max(1, VOID.shoulderNoiseTiles);
	const LW = math.floor((W - 1) / S) + 2;
	const LH = math.floor((H - 1) / S) + 2;
	const lattice = new Array<number>(LW * LH, 0);
	for (let ly = 0; ly < LH; ly++)
		for (let lx = 0; lx < LW; lx++)
			lattice[ly * LW + lx] = decorHash01(seed, ly * VOID.latticeStride + lx, salt.shoulderNoise);
	let pocketFilled = 0;
	// Void cells the shoulder, its cleanup and the ledge can touch (row-major), and the outcrops' mid band.
	const nearLimit = math.max(maxShoulder, VOID.pocketFillTiles) + 1;
	const near: number[] = [];
	const mid: number[] = [];
	const pocket = field.pocket;
	const pocketMaxDist = field.pocketMaxDist;
	for (let y = 0; y < H; y++) {
		const fy = y / S;
		const ly = math.floor(fy);
		const v = smooth(fy - ly);
		for (let x = 0; x < W; x++) {
			const c = y * W + x;
			if (grid[c] !== TileType.VOID) continue;
			const dc = dist[c];
			if (dc <= nearLimit) near.push(c);
			if (dc >= VOID.outcropMinDist && dc <= VOID.outcropMaxDist) mid.push(c);
			let shoulder = dc <= minT;
			if (!shoulder && dc <= maxShoulder) {
				const fx = x / S;
				const lx = math.floor(fx);
				const u = smooth(fx - lx);
				const i = ly * LW + lx;
				const top0 = lattice[i] + (lattice[i + 1] - lattice[i]) * u;
				const bot0 = lattice[i + LW] + (lattice[i + LW + 1] - lattice[i + LW]) * u;
				const noise = top0 + (bot0 - top0) * v;
				const extra = math.min(extraMax, extraMin + math.floor(noise * extraSpan));
				shoulder = dc <= minT + extra;
			}
			const p = pocket[c];
			if (!shoulder && p >= 0 && pocketMaxDist[p] <= VOID.pocketFillTiles) {
				shoulder = true;
				pocketFill[c] = true;
				pocketFilled++;
			}
			layer[c] = shoulder ? VoidLayer.SHOULDER : VoidLayer.ABYSS;
			top[c] = shoulder ? shoulderTop : abyssTop;
		}
	}

	// --- cleanup: nothing detached (each band cell has a shoulder neighbour one tile closer), no 1-cell holes ---
	for (let k = minT + 1; k <= maxShoulder; k++)
		for (const c of near) {
			if (layer[c] !== VoidLayer.SHOULDER || dist[c] !== k || pocketFill[c]) continue;
			const x = c % W;
			const y = (c - x) / W;
			let held = false;
			for (let ny = math.max(0, y - 1); ny <= math.min(H - 1, y + 1) && !held; ny++)
				for (let nx = math.max(0, x - 1); nx <= math.min(W - 1, x + 1); nx++) {
					const j = ny * W + nx;
					if (layer[j] === VoidLayer.SHOULDER && dist[j] === k - 1) {
						held = true;
						break;
					}
				}
			if (!held) {
				layer[c] = VoidLayer.ABYSS;
				top[c] = abyssTop;
			}
		}
	/** True when cell j (in the grid) closes a hole: shoulder or non-void. */
	const closed = (j: number) => layer[j] === VoidLayer.SHOULDER || layer[j] === VoidLayer.NONE;
	let changed = true;
	while (changed) {
		changed = false;
		for (const c of near) {
			if (layer[c] !== VoidLayer.ABYSS) continue;
			const x = c % W;
			const y = (c - x) / W;
			if (x === 0 || y === 0 || x === W - 1 || y === H - 1) continue;
			if (closed(c - 1) && closed(c + 1) && closed(c - W) && closed(c + W)) {
				layer[c] = VoidLayer.SHOULDER;
				top[c] = shoulderTop;
				changed = true;
			}
		}
	}

	// --- ledge: the shoulder's rim, broken per chunk -----------------------------------------------------------
	const chunk = math.max(1, VOID.ledgeChunkTiles);
	const CW = math.floor((W - 1) / chunk) + 1;
	const CH = math.floor((H - 1) / chunk) + 1;
	/** Each chunk's keep roll, hashed once on first use (CHUNK_UNSET until then). */
	const chunkKeep = new Array<number>(CW * CH, CHUNK_UNSET);
	for (const c of near) {
		if (layer[c] !== VoidLayer.ABYSS) continue;
		const x = c % W;
		const y = (c - x) / W;
		let rim = false;
		for (let ny = math.max(0, y - 1); ny <= math.min(H - 1, y + 1) && !rim; ny++)
			for (let nx = math.max(0, x - 1); nx <= math.min(W - 1, x + 1); nx++)
				if (layer[ny * W + nx] === VoidLayer.SHOULDER) {
					rim = true;
					break;
				}
		if (!rim) continue;
		const cy = math.floor(y / chunk);
		const cx = math.floor(x / chunk);
		let keep = chunkKeep[cy * CW + cx];
		if (keep === CHUNK_UNSET) {
			keep = decorHash01(seed, cy * VOID.latticeStride + cx, salt.ledge) < b.ledgeKeep ? 1 : 0;
			chunkKeep[cy * CW + cx] = keep;
		}
		if (keep === 1) {
			layer[c] = VoidLayer.LEDGE;
			top[c] = ledgeTop;
		}
	}

	// --- outcrops: sparse clusters in the mid band ---------------------------------------------------------------
	// halo[c]: -1 = touches nothing raised; an outcrop id = touches only that outcrop; HALO_BLOCKED = touches the
	// shoulder, the ledge or two outcrops. A cell may join outcrop `id` when it is abyss in the mid band and its halo
	// is -1 or `id`.
	const halo = new Array<number>(n, -1);
	const reach = VOID.outcropMinDist - 1;
	for (const c of near) {
		const l = layer[c];
		if ((l !== VoidLayer.SHOULDER && l !== VoidLayer.LEDGE) || dist[c] < reach) continue;
		const x = c % W;
		const y = (c - x) / W;
		for (let ny = math.max(0, y - 1); ny <= math.min(H - 1, y + 1); ny++)
			for (let nx = math.max(0, x - 1); nx <= math.min(W - 1, x + 1); nx++) halo[ny * W + nx] = HALO_BLOCKED;
	}
	const outcropFree = (j: number, id: number): boolean => {
		if (layer[j] !== VoidLayer.ABYSS) return false;
		const dj = dist[j];
		if (dj < VOID.outcropMinDist || dj > VOID.outcropMaxDist) return false;
		const hj = halo[j];
		return hj === -1 || hj === id;
	};
	const place = (j: number, id: number, height: number) => {
		layer[j] = VoidLayer.OUTCROP;
		top[j] = height;
		const x = j % W;
		const y = (j - x) / W;
		for (let ny = math.max(0, y - 1); ny <= math.min(H - 1, y + 1); ny++)
			for (let nx = math.max(0, x - 1); nx <= math.min(W - 1, x + 1); nx++) {
				const k = ny * W + nx;
				const hk = halo[k];
				halo[k] = hk === -1 || hk === id ? id : HALO_BLOCKED;
			}
	};
	// Seeds fall every `gap` eligible cells (in scan order), each gap drawn uniformly from 1..gapMax with mean
	// outcropRatePer / outcropRate: the band's rate with one hash per seed, not one per cell.
	const gapMax = b.outcropRate > 0 ? math.max(1, math.round((2 * VOID.outcropRatePer) / b.outcropRate - 1)) : 0;
	const drawGap = (k: number) => 1 + math.floor(decorHash01(seed, k, salt.outcropSeed) * gapMax);
	let gap = gapMax > 0 ? drawGap(0) : -1;
	const maxCells = math.max(1, math.floor(VOID.outcropMaxCells));
	const cluster = new Array<number>(maxCells, 0);
	const DX = [1, 0, -1, 0];
	const DY = [0, 1, 0, -1];
	let outcrops = 0;
	let outcropEligible = 0;
	for (const c of mid) {
		if (!outcropFree(c, outcrops)) continue;
		outcropEligible++;
		gap--;
		if (gap !== 0) continue;
		const id = outcrops;
		outcrops++;
		gap = drawGap(outcrops);
		const size = math.min(maxCells, 1 + math.floor(decorHash01(seed, c, salt.outcropSize) * maxCells));
		const height = decorHash01(seed, c, salt.outcropTop) < VOID.outcropShoulderShare ? shoulderTop : ledgeTop;
		cluster[0] = c;
		place(c, id, height);
		let count = 1;
		let stuck = false;
		while (count < size && !stuck) {
			stuck = true;
			// grow from the newest cell first, then older ones, trying the four directions from a hashed start
			for (let from = count - 1; from >= 0 && stuck; from--) {
				const f = cluster[from];
				const fx = f % W;
				const fy = (f - fx) / W;
				const dir0 = math.floor(decorHash01(seed, f, salt.outcropGrow + count) * DX.size());
				for (let t = 0; t < DX.size(); t++) {
					const dir = (dir0 + t) % DX.size();
					const nx = fx + DX[dir];
					const ny = fy + DY[dir];
					if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
					const j = ny * W + nx;
					if (!outcropFree(j, id)) continue;
					cluster[count] = j;
					count++;
					place(j, id, height);
					stuck = false;
					break;
				}
			}
		}
	}

	// --- rects and stats ----------------------------------------------------------------------------------------
	const holdOut = input.holdOut;
	const rects = voidRects(W, H, layer, top, near, mid, holdOut);
	let heldRects: number[] | undefined;
	if (holdOut !== undefined) {
		heldRects = [];
		for (let i = 0; i < rects.size(); i++) if (inCellRect(holdOut, rects[i].x, rects[i].y)) heldRects.push(i);
	}
	let shoulder = 0;
	let ledge = 0;
	let outcrop = 0;
	let abyss = 0;
	for (let c = 0; c < n; c++) {
		const l = layer[c];
		if (l === VoidLayer.SHOULDER) shoulder++;
		else if (l === VoidLayer.LEDGE) ledge++;
		else if (l === VoidLayer.OUTCROP) outcrop++;
		else if (l === VoidLayer.ABYSS) abyss++;
	}
	return {
		W,
		H,
		floorSeed: seed,
		band,
		layer,
		top,
		field,
		rects,
		stats: { shoulder, ledge, outcrop, abyss, pocketFilled, outcrops, outcropEligible },
		held: heldRects,
	};
}

/** A held cell's greedy key: its rectKey past every free key, so held and free cells never merge. */
const HELD_KEY_OFFSET = 4;

/** Greedy key of a raised (layer, top) pair: 1..4 in rect order, 0 for none (non-void, abyss). */
function rectKey(l: number, t: number): number {
	if (l === VoidLayer.SHOULDER) return 1;
	if (l === VoidLayer.LEDGE) return 2;
	if (l === VoidLayer.OUTCROP) return t === VOID.shoulderTopTiles ? 3 : 4;
	return 0;
}

/**
 * Greedy rectangles (tileMerge's greedyRects scan, one pass for every group at once) over the raised cells, merged per
 * (layer, top): rows top to bottom, at the first uncovered raised cell grow right while the key matches, then down
 * while the whole row segment does. Each raised cell lands in exactly one rect.
 */
function voidRects(
	W: number,
	H: number,
	layer: ReadonlyArray<number>,
	top: ReadonlyArray<number>,
	near: ReadonlyArray<number>,
	mid: ReadonlyArray<number>,
	holdOut: CellRect | undefined,
): VoidRect[] {
	// Every raised cell is in `near` (shoulder, ledge) or `mid` (outcrops). A covered cell's key drops to 0, so the
	// key array doubles as greedyRects' `covered`.
	const key = new Array<number>(W * H, 0);
	for (const c of near) key[c] = rectKey(layer[c], top[c]);
	for (const c of mid) key[c] = rectKey(layer[c], top[c]);
	// The hold-out (docs/SECRET_ROOMS.md SR7): its raised cells take keys of their own, so no rect crosses its edge.
	if (holdOut !== undefined)
		for (let y = math.max(0, holdOut.y0); y <= math.min(H - 1, holdOut.y1); y++)
			for (let x = math.max(0, holdOut.x0); x <= math.min(W - 1, holdOut.x1); x++) {
				const c = y * W + x;
				if (key[c] !== 0) key[c] += HELD_KEY_OFFSET;
			}
	const out: VoidRect[] = [];
	for (let y = 0; y < H; y++) {
		const row = y * W;
		let x = 0;
		while (x < W) {
			const k = key[row + x];
			if (k === 0) {
				x++;
				continue;
			}
			let w = 1;
			while (x + w < W && key[row + x + w] === k) w++;
			let h = 1;
			let grow = true;
			while (grow && y + h < H) {
				const r2 = (y + h) * W + x;
				for (let i = 0; i < w; i++)
					if (key[r2 + i] !== k) {
						grow = false;
						break;
					}
				if (grow) h++;
			}
			for (let dy = 0; dy < h; dy++) {
				const r2 = (y + dy) * W + x;
				for (let i = 0; i < w; i++) key[r2 + i] = 0;
			}
			out.push({ x, y, w, h, layer: layer[row + x] as VoidLayer, top: top[row + x] });
			x += w;
		}
	}
	return out;
}

let cachedDungeon: Dungeon | undefined;
let cachedSeed = 0;
let cachedBand = -1;
let cachedHoldOut: CellRect | undefined;
let cachedPlan: VoidPlan | undefined;

function sameRect(a: CellRect | undefined, b: CellRect | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

/**
 * planVoid, memoised on the LAST input (the same Dungeon object, floor seed, band and hold-out), so two controllers (the void
 * geometry, the void pieces) share one plan per floor. A new floor replaces it.
 */
export function planVoidCached(input: VoidPlanInput): VoidPlan {
	const seed = input.floorSeed ?? input.dungeon.seed;
	const band = voidBandOf(input);
	if (
		cachedPlan !== undefined &&
		cachedDungeon === input.dungeon &&
		cachedSeed === seed &&
		cachedBand === band &&
		sameRect(cachedHoldOut, input.holdOut)
	)
		return cachedPlan;
	const plan = planVoid(input);
	cachedDungeon = input.dungeon;
	cachedSeed = seed;
	cachedBand = band;
	cachedHoldOut = input.holdOut;
	cachedPlan = plan;
	return plan;
}
