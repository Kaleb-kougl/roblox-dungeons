/**
 * The player's mover: collide and slide (docs/WALL_SLIDE.md Design 1-3, WS1 / WS2; a Roblox-port feature, no web
 * source). Where `moveCircle` sweeps X then Z and stops the axis that meets a corner, `slideCircle` moves to the
 * target and pushes the circle back out of the deepest overlap along the box's closest-point normal (radial at a
 * corner, so every corner is rounded by the circle's own radius), which deflects it round corners. Two assists on
 * top: a corner tie-break (a move straight at a corner picks a side) and the face assist / pillar slip (a stalled
 * move at the end of a run, or anywhere on an isolated blocker's face, slips sideways round it).
 *
 * Same contract as moveCircle: pure, deterministic (fixed scan order, sqrt only, no trig), no allocation beyond the
 * result (module scratch, read before the next call), and the result is never farther from the start than the step.
 * Tunables: ./slideData.ts (PLAYER_SLIDE).
 */
import type { Dungeon } from "./forge";
import {
	TILE_SIZE,
	blocksMove,
	moveCircle,
	sweepAxis,
	worldToGrid,
	type MoveResolver,
	type SolidCells,
	type WorldXZ,
} from "./collision";
import { PLAYER_SLIDE, type PlayerSlideTuning } from "./slideData";

/** Overlap below this depth is touching, not penetration (absorbs float rounding at rest; sweepAxis's EPS). */
const EPS = 1e-9;

/** A cell the circle already overlaps by more than this at the start does not block the move (it walks out). */
const START_EPS = 1e-9;

/**
 * A result may lie this far (world units) beyond the step's length, never more: the float rounding of start + step,
 * which is relative to the coordinates, not to the step (a tiny step far from the origin).
 */
const STEP_SLACK = 1e-12;

/** How far past the circle's front (in tiles) the assist looks for the blocking column (collision's CORNER_PROBE). */
const PROBE = 1e-6;

/** A slip goes this far past the point where the circle clears the run's end (tiles), so the next move is free. */
const SLIP_CLEAR = 1e-6;

/** A sweep that stops more than this short of where it was sent counts as blocked. */
const REACH_EPS = 1e-9;

/** A run's end cleared within assistTiles plus this counts as within (float rounding of the edge arithmetic). */
const MARGIN_EPS = 1e-9;

/** True when the tile (or `solid` cell) at (gx, gy) blocks and all 8 cells around it are open: a pillar, a lone crate. */
export function isIsolatedBlocker(d: Dungeon, gx: number, gy: number, solid?: SolidCells): boolean {
	if (!blocksMove(d, gx, gy, solid)) return false;
	for (let oy = -1; oy <= 1; oy++)
		for (let ox = -1; ox <= 1; ox++) {
			if (ox === 0 && oy === 0) continue;
			if (blocksMove(d, gx + ox, gy + oy, solid)) return false;
		}
	return true;
}

/** deepest()'s result (module scratch): the deepest overlapped cell. */
const hit = { gx: 0, gy: 0 };

/**
 * The deepest overlap of the circle at (px, pz) with a blocking cell, scanned gy then gx (the first wins a tie); cells
 * the circle overlaps at the start (sx, sz) are skipped. False when nothing overlaps; else the cell is in `hit`.
 */
function deepest(d: Dungeon, px: number, pz: number, sx: number, sz: number, r: number, solid?: SolidCells): boolean {
	const half = TILE_SIZE / 2;
	const touch2 = (r - EPS) * (r - EPS);
	const start2 = (r - START_EPS) * (r - START_EPS);
	let found = false;
	let best = 0;
	for (let gy = worldToGrid(pz - r); gy <= worldToGrid(pz + r); gy++)
		for (let gx = worldToGrid(px - r); gx <= worldToGrid(px + r); gx++) {
			if (!blocksMove(d, gx, gy, solid)) continue;
			const x0 = gx * TILE_SIZE - half,
				x1 = gx * TILE_SIZE + half,
				z0 = gy * TILE_SIZE - half,
				z1 = gy * TILE_SIZE + half;
			const cx = math.min(math.max(px, x0), x1);
			const cz = math.min(math.max(pz, z0), z1);
			const d2 = (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
			if (d2 >= touch2) continue;
			const scx = math.min(math.max(sx, x0), x1);
			const scz = math.min(math.max(sz, z0), z1);
			if ((sx - scx) * (sx - scx) + (sz - scz) * (sz - scz) < start2) continue; // overlapped at the start
			// Centre outside the box: r - distance; inside (or on its edge): r + the depth to the nearest face.
			const pen = d2 > 0 ? r - math.sqrt(d2) : r + math.min(px - x0, x1 - px, pz - z0, z1 - pz);
			if (!found || pen > best) {
				found = true;
				best = pen;
				hit.gx = gx;
				hit.gy = gy;
			}
		}
	return found;
}

/** pushOut()'s result (module scratch): the pushed centre. */
const pushed = { x: 0, z: 0 };

/**
 * The circle at (px, pz) pushed out of cell (gx, gy) along the closest-point normal, to touching (`pushed`; the same
 * point when it does not overlap). A face contact sets the one coordinate exactly as sweepAxis does (edge -/+ r), so
 * rest positions are moveCircle's; a centre inside the box leaves by its nearest face (-x, +x, -z, +z on a tie); a
 * corner contact goes to corner + normal * r.
 * A push can lengthen the move (radially off a rounded corner, or onto a face's line from a start that rests on the
 * face's rounded corner). When the pushed point is farther than `len` from the move's start (sx, sz), it moves along
 * the contact (the face's line, or the corner's circle) to the point exactly `len` from the start on its side, so the
 * slide keeps the step's length; where there is none it stays (slideCircle's step bound decides).
 */
function pushOut(px: number, pz: number, gx: number, gy: number, r: number, sx: number, sz: number, len: number): void {
	const half = TILE_SIZE / 2;
	pushed.x = px;
	pushed.z = pz;
	const x0 = gx * TILE_SIZE - half,
		x1 = gx * TILE_SIZE + half,
		z0 = gy * TILE_SIZE - half,
		z1 = gy * TILE_SIZE + half;
	const cx = math.min(math.max(px, x0), x1);
	const cz = math.min(math.max(pz, z0), z1);
	const ex = px - cx,
		ez = pz - cz;
	const d2 = ex * ex + ez * ez;
	if (d2 >= (r - EPS) * (r - EPS)) return;
	// The face pushed onto: 1 across X (pushed.x set), 2 across Z, 0 a corner.
	let face = 0;
	if (d2 === 0) {
		const dl = px - x0,
			dr = x1 - px,
			db = pz - z0,
			dt = z1 - pz;
		const m = math.min(dl, dr, db, dt);
		if (dl === m || dr === m) {
			pushed.x = dl === m ? gx * TILE_SIZE - half - r : gx * TILE_SIZE + half + r;
			face = 1;
		} else {
			pushed.z = db === m ? gy * TILE_SIZE - half - r : gy * TILE_SIZE + half + r;
			face = 2;
		}
	} else if (ez === 0) {
		// The centre is within the box's Z span: a face across X.
		pushed.x = ex < 0 ? gx * TILE_SIZE - half - r : gx * TILE_SIZE + half + r;
		face = 1;
	} else if (ex === 0) {
		pushed.z = ez < 0 ? gy * TILE_SIZE - half - r : gy * TILE_SIZE + half + r;
		face = 2;
	} else {
		const el = math.sqrt(d2);
		pushed.x = cx + (ex / el) * r;
		pushed.z = cz + (ez / el) * r;
	}
	const qx = pushed.x,
		qz = pushed.z;
	const len2 = len * len;
	const bound = len + STEP_SLACK;
	if ((qx - sx) * (qx - sx) + (qz - sz) * (qz - sz) <= bound * bound) return;
	if (face === 1) {
		// Along the face's line x = qx: z = sz +/- sqrt(len^2 - (qx - sx)^2), on the pushed point's side.
		const w2 = len2 - (qx - sx) * (qx - sx);
		if (w2 < 0 || qz === sz) return;
		pushed.z = sz + (qz > sz ? math.sqrt(w2) : -math.sqrt(w2));
		return;
	}
	if (face === 2) {
		const w2 = len2 - (qz - sz) * (qz - sz);
		if (w2 < 0 || qx === sx) return;
		pushed.x = sx + (qx > sx ? math.sqrt(w2) : -math.sqrt(w2));
		return;
	}
	// The circle (start, len) meets the corner's circle (corner, r): a along start -> corner, h across it.
	const kx = cx - sx,
		kz = cz - sz;
	const k2 = kx * kx + kz * kz;
	if (k2 <= 0) return;
	const k = math.sqrt(k2);
	const a = (len2 - r * r + k2) / (2 * k);
	const h2 = len2 - a * a;
	if (h2 < 0) return;
	const h = math.sqrt(h2);
	const bx = sx + (kx / k) * a,
		bz = sz + (kz / k) * a;
	// The two points b +/- h * (-kz, kx) / k: the one on the pushed point's side of the start -> corner line.
	const side = kx * (qz - sz) - kz * (qx - sx) >= 0 ? 1 : -1;
	pushed.x = bx - ((side * h) / k) * kz;
	pushed.z = bz + ((side * h) / k) * kx;
}

/** slip()'s result (module scratch). */
const slipped = { x: 0, z: 0 };

/**
 * Face assist and pillar slip (Design 3) for a move from (sx, sz) by (dx, dz) (length `len`) that the slide took to
 * (px, pz), `stalled` when that kept less than assistStallShare of the step. The move's primary axis (X on a tie) is
 * swept first (the forward leg: it stops on the obstacle); the obstacle is the run of blocking cells in the column just
 * ahead that the circle then touches (like cornerNudge). Then a lateral leg (an exact sweep that must get all the way)
 * of min(sqrt(len^2 - forward^2), distance to clear + SLIP_CLEAR), so the result stays within the step:
 *   pillar  an isolated blocker (`pillarSlip`): toward the side the move's ray passes its centre on (a ray through the
 *           centre passes on its right, as cornerNudge's pillar), when stalled; on a face hit at any angle (the
 *           circle's centre within the face) when the slide got less far toward that side; on a graze (past the face's
 *           end) when the slide went the other way. So every move at a pillar goes round it on the same side;
 *   run     anything else, when stalled: toward an end the circle clears within `assistTiles`, when the cells past that
 *           end (in the run's column and the column on the circle's side) are open. A long wall's middle, a concave
 *           corner or a staircase face has no such end.
 * The result must be overlap-free. True with the point in `slipped`; false = keep the slide.
 */
function slip(
	d: Dungeon,
	sx: number,
	sz: number,
	px: number,
	pz: number,
	dx: number,
	dz: number,
	len: number,
	stalled: boolean,
	r: number,
	solid: SolidCells | undefined,
	tuning: PlayerSlideTuning,
): boolean {
	const half = TILE_SIZE / 2;
	const alongX = math.abs(dx) >= math.abs(dz);
	const su = alongX ? sx : sz,
		v = alongX ? sz : sx;
	const du = alongX ? dx : dz;
	const s = du > 0 ? 1 : -1;
	const u = sweepAxis(d, su, v, du, r, alongX, solid);
	const fwd = math.abs(u - su);
	if (fwd >= math.abs(du) - REACH_EPS) return false; // nothing ahead on the primary axis
	const gu = worldToGrid(u + s * (r + TILE_SIZE * PROBE));
	const r2 = r * r;
	let lo = 0;
	let hi = -1;
	for (let gv = worldToGrid(v - r); gv <= worldToGrid(v + r); gv++) {
		const v0 = gv * TILE_SIZE - half,
			v1 = gv * TILE_SIZE + half;
		const gap = v < v0 ? v0 - v : v > v1 ? v - v1 : 0;
		if (r2 - gap * gap <= 0 || !blocksAcross(d, gu, gv, alongX, solid)) continue;
		if (hi < lo) lo = gv;
		hi = gv;
	}
	if (hi < lo) return false;
	const lat2 = len * len - fwd * fwd;
	const budget = lat2 > 0 ? math.sqrt(lat2) : 0;
	let dir = 0;
	let dist = 0;
	const pillar = lo === hi && tuning.pillarSlip && isIsolatedBlocker(d, alongX ? gu : lo, alongX ? lo : gu, solid);
	if (pillar) {
		const ccx = (alongX ? gu : lo) * TILE_SIZE,
			ccz = (alongX ? lo : gu) * TILE_SIZE;
		// The ray's right is (dz, -dx): its lateral part has the sign -s across X moves, s across Z moves.
		dir = rayPassesLeft(dx, dz, ccx - sx, ccz - sz) === alongX ? -s : s;
		const vLo = lo * TILE_SIZE - half,
			vHi = lo * TILE_SIZE + half;
		dist = dir < 0 ? v - (vLo - r) : vHi + r - v;
		if (!stalled) {
			// How far the slide went toward that side. A face hit slips unless the slide already gets as far; a graze
			// (the centre past the face's end) keeps the slide round the corner unless it goes the other way.
			const slid = ((alongX ? pz : px) - v) * dir;
			if (v < vLo || v > vHi ? slid >= 0 : slid >= (budget < dist ? budget : dist)) return false;
		}
	} else {
		const a = tuning.assistTiles;
		if (!stalled || a <= 0) return false;
		const lim = a + MARGIN_EPS;
		// The run's low end, if the circle clears it within the margin.
		let loEnd = lo;
		let loDist = v - (loEnd * TILE_SIZE - half - r);
		while (loDist <= lim && blocksAcross(d, gu, loEnd - 1, alongX, solid)) {
			loEnd--;
			loDist = v - (loEnd * TILE_SIZE - half - r);
		}
		const loOk = loDist <= lim && !blocksAcross(d, gu - s, loEnd - 1, alongX, solid);
		let hiEnd = hi;
		let hiDist = hiEnd * TILE_SIZE + half + r - v;
		while (hiDist <= lim && blocksAcross(d, gu, hiEnd + 1, alongX, solid)) {
			hiEnd++;
			hiDist = hiEnd * TILE_SIZE + half + r - v;
		}
		const hiOk = hiDist <= lim && !blocksAcross(d, gu - s, hiEnd + 1, alongX, solid);
		if (loOk && (!hiOk || loDist <= hiDist)) {
			dir = -1;
			dist = loDist;
		} else if (hiOk) {
			dir = 1;
			dist = hiDist;
		} else return false;
	}
	const want = dist + SLIP_CLEAR;
	const m = budget < want ? budget : want;
	if (m <= EPS) return false;
	const nv = sweepAxis(d, v, u, dir * m, r, !alongX, solid);
	if (math.abs(nv - v) < m - REACH_EPS) return false;
	const fx = alongX ? u : nv,
		fz = alongX ? nv : u;
	if (deepest(d, fx, fz, sx, sz, r, solid)) return false;
	const bound = len + STEP_SLACK;
	if ((fx - sx) * (fx - sx) + (fz - sz) * (fz - sz) > bound * bound) return false;
	slipped.x = fx;
	slipped.z = fz;
	return true;
}

/**
 * True when the point at offset (ox, oz) from the move's start is on the move's ray's left or on it (world cross
 * product move x offset >= 0): the ray then passes it on its right.
 */
function rayPassesLeft(dx: number, dz: number, ox: number, oz: number): boolean {
	return dx * oz - dz * ox >= 0;
}

/** blocksMove() at primary-axis cell `gu` and lateral cell `gv`. */
function blocksAcross(d: Dungeon, gu: number, gv: number, alongX: boolean, solid?: SolidCells): boolean {
	return alongX ? blocksMove(d, gu, gv, solid) : blocksMove(d, gv, gu, solid);
}

/**
 * Move a circle of `radius` from world (x, z) by (dx, dz), sliding round walls and corners (docs/WALL_SLIDE.md
 * Design 1-3):
 *   1. to the target, then up to `iterations` passes, each pushing the circle out of the deepest overlap with a
 *      blocking cell (blocksMove: a non-FLOOR tile or a `solid` cell), along the box's closest-point normal; a push
 *      that would leave the circle farther than the step from the start stops on the contact at the step's length
 *      (pushOut), so the slide never speeds a move up (WSD2);
 *   2. a cell the circle already overlaps at the start does not block (a body spawned inside a tile walks out);
 *   3. corner tie-break: when the first contact is a box corner and the move's share along its tangent is below
 *      `tieShare`, the target first moves `tiePush` of the step along the tangent, to the side the move's ray passes
 *      the corner on (an isolated blocker: its centre; a ray straight through passes on its right);
 *   4. moveCircle's result instead when an overlap is left after the passes or the result is farther than the step;
 *   5. after a contact, the face assist / pillar slip (slip()): a stall (less than `assistStallShare` of the step
 *      kept) at a run's end within `assistTiles`, or any blocked move at an isolated blocker (`pillarSlip`).
 * Where no corner is touched (open floor, a flat wall, a square room corner) it rests where moveCircle rests (and
 * without moveCircle's flat-wall seam snag: its overlap test has the same 1e-9 tolerance as touching).
 * No tunnelling for steps up to 0.5 with radius >= 0.18: two free regions are then farther apart than the step, and a
 * result farther than the step falls back to moveCircle. The player moves in sub-steps of MAX_MOVE_STEP 0.1.
 */
export function slideCircle(
	d: Dungeon,
	x: number,
	z: number,
	dx: number,
	dz: number,
	radius: number,
	solid?: SolidCells,
	tuning: PlayerSlideTuning = PLAYER_SLIDE,
): WorldXZ {
	if (dx === 0 && dz === 0) return { x, z };
	const r = radius;
	const step2 = dx * dx + dz * dz;
	const len = math.sqrt(step2);
	let px = x + dx,
		pz = z + dz;
	let pass = 0;
	while (deepest(d, px, pz, x, z, r, solid)) {
		if (pass >= tuning.iterations) return moveCircle(d, x, z, dx, dz, radius, solid); // a concave jam
		const gx = hit.gx,
			gy = hit.gy;
		if (pass === 0) {
			// Corner tie-break: the first contact is a box corner K and the move points (nearly) straight at it.
			const half = TILE_SIZE / 2;
			const kx = math.min(math.max(px, gx * TILE_SIZE - half), gx * TILE_SIZE + half);
			const kz = math.min(math.max(pz, gy * TILE_SIZE - half), gy * TILE_SIZE + half);
			const ex = px - kx,
				ez = pz - kz;
			if (ex !== 0 && ez !== 0) {
				const el = math.sqrt(ex * ex + ez * ez);
				const tx = -ez / el,
					tz = ex / el;
				const along = dx * tx + dz * tz;
				if (math.abs(along) < tuning.tieShare * len) {
					// K on the ray's left (or on it): pass on its right, (dz, -dx). An isolated blocker (pillarSlip) is
					// judged by its centre instead, as slip() does, so the two never pull opposite ways.
					const left =
						tuning.pillarSlip && isIsolatedBlocker(d, gx, gy, solid)
							? rayPassesLeft(dx, dz, gx * TILE_SIZE - x, gy * TILE_SIZE - z)
							: rayPassesLeft(dx, dz, kx - x, kz - z);
					const right = tx * dz - tz * dx >= 0;
					const sg = left === right ? 1 : -1;
					const push = tuning.tiePush * len;
					px += sg * tx * push;
					pz += sg * tz * push;
				}
			}
		}
		pushOut(px, pz, gx, gy, r, x, z, len);
		px = pushed.x;
		pz = pushed.z;
		pass++;
	}
	const moved2 = (px - x) * (px - x) + (pz - z) * (pz - z);
	const bound = len + STEP_SLACK;
	if (moved2 > bound * bound) return moveCircle(d, x, z, dx, dz, radius, solid);
	if (pass > 0 && (tuning.pillarSlip || tuning.assistTiles > 0)) {
		const stall = tuning.assistStallShare * len;
		if (slip(d, x, z, px, pz, dx, dz, len, moved2 < stall * stall, r, solid, tuning))
			return { x: slipped.x, z: slipped.z };
	}
	return { x: px, z: pz };
}

/** `SimConfig.moveResolver` for the player: `(x, z, dx, dz, solid) => slideCircle(d, x, z, dx, dz, radius, solid, tuning)`. */
export function playerSlideMover(d: Dungeon, radius: number, tuning: PlayerSlideTuning = PLAYER_SLIDE): MoveResolver {
	return (x, z, dx, dz, solid) => slideCircle(d, x, z, dx, dz, radius, solid, tuning);
}
