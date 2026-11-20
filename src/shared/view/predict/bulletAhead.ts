/**
 * Enemy bullets drawn ahead (docs/LOCAL_PREDICTION.md Design 5, LP10, LPD9), pure and read only: where an enemy bullet
 * will be `n` ticks past the merged state, so the bullets on screen show the same tick as the predicted knight.
 *
 * `BulletAhead.prepare(state, world, n)` once a frame, then `pose(sim, i, out)` per slot: the bullet's (prev, cur) pair
 * n ticks later, which the renderer lerps by the client's alpha exactly as it lerps today's pair. Each of the n ticks
 * follows the sim's own step (combat/bullets.ts `step`, then combat.ts's enemy collision walk). Positions use the
 * closed form pos + vel x (dt_0 + ... + dt_k-1) instead of the sim's k additions (no acceleration: see below), within
 * about 1e-15 of the sim's (the spec measures it); a bullet's life is counted down tick by tick like the sim's when it
 * might run out; a spawn delay is replayed step by step (`replay`):
 *
 *   dt        tick k steps by SIM_DT x HOURGLASS_TIME_SCALE while the Hourglass would still run (any run player's
 *             hourglassTicks > k: consumeEnemyBulletTimeScale counts each one down once a tick), else SIM_DT
 *   delay     a spawn delay counts down first; the bullet moves on the tick it runs out (always 0 in the sim today)
 *   move      prev = pos; pos += vel x dt (no acceleration: no enemy bullet has one, and the pool has no accessor; the
 *             spec steps the real sim, so one would fail it)
 *   life      life -= dt; at or below 0 the bullet is gone: hidden (false)
 *   bounds    the pool's culling cube (math.huge on dungeon floors): gone, hidden (checked at the end: it is convex)
 *   collide   the floor's bullet blocker (world.isBulletBlocked) or an intact piece's cell (not for goo / strikes),
 *             both a per-grid-cell answer (shared/dungeon isBulletBlocked, breakableSlotAt): a bullet that stays in its
 *             cell is not tested, one that leaves it tests the box of cells between its ends, and only when one of them
 *             stops bullets are its tick positions tested (each new cell) to find the tick:
 *             the sim consumes it there, so it is drawn STOPPED at its last free position (prev = cur) until the
 *             merged state catches up and removes it
 *   breaks    a piece that enemy bullets break inside the window (docs/NEW_ENEMIES_3.md NT11: an imp's fan into a
 *             barrel, its first bullet breaking it, the rest flying through) stops only the bullets that reach it
 *             before it breaks: `plan` (once a frame per pool, lazily) replays every enemy bullet's hits on pieces in
 *             the sim's order (tick, then slot), each taking `config.enemyBulletDamage` (none on an inert piece or the
 *             Goldling's, which refuse enemy sources), and a bullet that reaches a broken piece's cell after the break
 *             flies on to its next stop; repeated until no bullet moves
 *
 * Goo and strikes do not move and are drawn by their own pools: they keep today's pair. n = 0 is exactly today's
 * pair. Not predicted (Design 5): a shot fired inside the window appears up to n ticks along (no fade-in: the pool
 * keeps no age to fade by), a bullet a teammate, a guard, an Ember or a hit takes flies on until the merged state
 * removes it (so a bullet a hit took before its piece still counts toward the piece's break), a Hourglass slow that
 * starts inside the window overshoots for a moment, a piece broken inside it by anything but an enemy bullet (a player's
 * shot or swing, a slam, a Charger) still stops bullets, and a delayed bullet (`replay`; none in the sim today) neither
 * breaks pieces nor sees them broken. No allocation per call once the scratch has grown.
 *
 * @module
 */
import {
	BulletKind,
	BulletPayload,
	HOURGLASS_TIME_SCALE,
	SIM_DT,
	TILE_SIZE,
	breakableSlotAt,
	goldenGuardsPiece,
	inertPiece,
	type BreakablesState,
	type BulletBlocker,
	type BulletSimulation,
	type SimConfig,
	type SimState,
	type Vec3,
} from "shared/sim";
import { gridToWorld } from "shared/dungeon";
import { BULLET_AHEAD } from "./config";

/**
 * A bullet whose life outlasts the window's steps by more than this (seconds) is alive at its end without counting its
 * life down tick by tick (the sim's repeated subtraction can only differ from one subtraction of the sum by far less).
 */
const LIFE_MARGIN = 1e-9;

/**
 * The most re-routing rounds of the break plan (each round lets the bullets that reach a newly broken piece fly on to
 * their next stop; a round with no such bullet ends it). Far more than a frame ever needs: a chain of pieces broken one
 * behind another along a fan.
 */
const PLAN_ROUNDS = 8;

/** The grid's cell size, read once (cellOf runs four times a bullet a frame). */
const CELL = TILE_SIZE;

/** shared/dungeon worldToGrid, inlined: the grid cell (one axis) of world coordinate `v`. */
function cellOf(v: number): number {
	return math.floor(v / CELL + 0.5);
}

/** A bullet's drawn pair n ticks ahead (world units): the renderer draws lerp(prev, cur, alpha). */
export interface AheadPose {
	prevX: number;
	prevY: number;
	prevZ: number;
	x: number;
	y: number;
	z: number;
}

export function newAheadPose(): AheadPose {
	return { prevX: 0, prevY: 0, prevZ: 0, x: 0, y: 0, z: 0 };
}

/** The most ticks any run player's Hourglass still slows enemy bullets (consumeEnemyBulletTimeScale's counters). */
function hourglassTicksLeft(state: Readonly<SimState>): number {
	const r = state.run;
	if (r === undefined) return 0;
	let most = 0;
	for (const p of r.players) if (p.hourglassTicks > most) most = p.hourglassTicks;
	return most;
}

export class BulletAhead {
	/** The ticks this frame draws ahead (0: today's pairs). */
	ticks = 0;
	/** dts[k]: tick k's step; sums[k]: the steps of ticks 0 .. k - 1 added in order (sums[0] = 0). */
	private readonly dts: number[] = [];
	private readonly sums: number[] = [0];
	private blocked: BulletBlocker | undefined;
	private pieces: Readonly<BreakablesState> | undefined;
	private state: Readonly<SimState> | undefined;
	private readonly prev: Vec3 = { x: 0, y: 0, z: 0 };
	/** The pool this frame's break plan was made for (undefined: none yet this frame). */
	private planFor: BulletSimulation | undefined;
	/** Per bullet slot, from the plan: the window tick it is stopped (0: not stopped), and by which piece (-1: a wall). */
	private readonly stopTick: number[] = [];
	private readonly stopPiece: number[] = [];
	/** Per bullet slot: its last free position before that stop. */
	private readonly stopX: number[] = [];
	private readonly stopY: number[] = [];
	private readonly stopZ: number[] = [];
	/** Per piece slot, from the plan: the window tick enemy bullets break it (0: not inside the window), its breaker. */
	private readonly breakTick: number[] = [];
	private readonly breaker: number[] = [];
	private readonly pieceHp: number[] = [];
	/** search()'s answer: the stop's piece slot (-1 a wall) and its last free position. */
	private foundPiece = -1;
	private foundX = 0;
	private foundY = 0;
	private foundZ = 0;

	/**
	 * Sets up a frame: `n` ticks ahead (clamped to 0..BULLET_AHEAD.maxTicks, whole ticks) of merged `state`, on the
	 * floor whose config is `world` (simWorldConfig: its bullet blocker).
	 */
	prepare(state: Readonly<SimState>, world: Readonly<SimConfig>, n: number): void {
		let ticks = math.floor(n);
		if (!(ticks > 0)) ticks = 0;
		if (ticks > BULLET_AHEAD.maxTicks) ticks = BULLET_AHEAD.maxTicks;
		this.ticks = ticks;
		const slowed = hourglassTicksLeft(state);
		// combat.ts: `enemyTimeScale === 1 ? SIM_DT : SIM_DT * enemyTimeScale`, the same product every tick.
		const slow = SIM_DT * HOURGLASS_TIME_SCALE;
		let sum = 0;
		for (let k = 0; k < ticks; k++) {
			const dt = k < slowed ? slow : SIM_DT;
			sum += dt;
			if (k < this.dts.size()) this.dts[k] = dt;
			else this.dts.push(dt);
			if (k + 1 < this.sums.size()) this.sums[k + 1] = sum;
			else this.sums.push(sum);
		}
		this.blocked = world.isBulletBlocked;
		const b = state.breakables;
		this.pieces = b !== undefined && b.intact > 0 ? b : undefined;
		this.state = state;
		this.planFor = undefined;
	}

	/** The floor's blocker or an intact piece stops a bullet at (x, z): both answer per grid cell. */
	private stops(x: number, z: number): boolean {
		const blocked = this.blocked;
		if (blocked !== undefined && blocked(x, z)) return true;
		const pieces = this.pieces;
		return pieces !== undefined && breakableSlotAt(pieces, x, z) >= 0;
	}

	/**
	 * The plan's stop test for bullet slot `i` entering (x, z) on window tick `k` (1-based): a wall, or an intact piece
	 * that is not yet broken when the sim's collision walk reaches this bullet (a piece broken on tick k by a lower slot
	 * no longer stops it). Writes the piece slot (-1 a wall) to `foundPiece`.
	 */
	private stopsAt(x: number, z: number, k: number, i: number): boolean {
		const blocked = this.blocked;
		if (blocked !== undefined && blocked(x, z)) {
			this.foundPiece = -1;
			return true;
		}
		const pieces = this.pieces;
		if (pieces === undefined) return false;
		const slot = breakableSlotAt(pieces, x, z);
		if (slot < 0) return false;
		const bt = this.breakTick[slot];
		if (bt !== 0 && (k > bt || (k === bt && i > this.breaker[slot]))) return false;
		this.foundPiece = slot;
		return true;
	}

	/**
	 * The window tick (1-based) live slot `i` of `sim` is first stopped by a wall or a piece the plan has not broken
	 * before it gets there, or 0: it flies the whole window, or its life or the culling cube ends it first (the sim
	 * releases it before the collision walk). Writes `foundPiece` and the last free position (`foundX/Y/Z`).
	 */
	private search(sim: BulletSimulation, i: number): number {
		const n = this.ticks;
		const cur = sim.positionAt(i);
		const px = cur.x;
		const py = cur.y;
		const pz = cur.z;
		const v = sim.velocityAt(i);
		const vx = v.x;
		const vy = v.y;
		const vz = v.z;
		const sums = this.sums;
		const sn = sums[n];
		const g0x = cellOf(px);
		const g0z = cellOf(pz);
		const g1x = cellOf(px + vx * sn);
		const g1z = cellOf(pz + vz * sn);
		if ((g0x === g1x && g0z === g1z) || !this.boxStops(g0x, g0z, g1x, g1z)) return 0;
		const limit = sim.boundsLimit;
		const cull = limit !== math.huge;
		let life = sim.lifeAt(i);
		let lastX = px;
		let lastY = py;
		let lastZ = pz;
		let checkedX = g0x;
		let checkedZ = g0z;
		for (let k = 1; k <= n; k++) {
			life -= this.dts[k - 1];
			if (life <= 0) return 0;
			const sk = sums[k];
			const x = px + vx * sk;
			const y = py + vy * sk;
			const z = pz + vz * sk;
			if (cull && (x > limit || x < -limit || y > limit || y < -limit || z > limit || z < -limit)) return 0;
			const gx = cellOf(x);
			const gz = cellOf(z);
			if (gx !== checkedX || gz !== checkedZ) {
				checkedX = gx;
				checkedZ = gz;
				if (this.stopsAt(x, z, k, i)) {
					this.foundX = lastX;
					this.foundY = lastY;
					this.foundZ = lastZ;
					return k;
				}
			}
			lastX = x;
			lastY = y;
			lastZ = z;
		}
		return 0;
	}

	/** Records search()'s answer for slot `i`. */
	private record(sim: BulletSimulation, i: number): void {
		const k = this.search(sim, i);
		this.stopTick[i] = k;
		this.stopPiece[i] = k > 0 ? this.foundPiece : -1;
		this.stopX[i] = this.foundX;
		this.stopY[i] = this.foundY;
		this.stopZ[i] = this.foundZ;
	}

	/**
	 * The frame's break plan for `sim` (see the file comment, `breaks`), made once a frame per pool on the first pose
	 * that needs it: every flying enemy bullet's first stop, then the pieces' hits in the sim's order (tick, then slot)
	 * and the bullets that reach a piece after it broke re-routed, until none moves.
	 */
	private plan(sim: BulletSimulation): void {
		if (this.planFor === sim) return;
		this.planFor = sim;
		const pieces = this.pieces!;
		const state = this.state!;
		const n = this.ticks;
		const hw = sim.highWater();
		const list = pieces.pieces;
		const np = list.size();
		const damage = pieces.config.enemyBulletDamage;
		for (let s = 0; s < np; s++) {
			if (s < this.breakTick.size()) {
				this.breakTick[s] = 0;
				this.breaker[s] = -1;
				this.pieceHp[s] = 0;
			} else {
				this.breakTick.push(0);
				this.breaker.push(-1);
				this.pieceHp.push(0);
			}
		}
		for (let i = 0; i < hw; i++) {
			if (i >= this.stopTick.size()) {
				this.stopTick.push(0);
				this.stopPiece.push(-1);
				this.stopX.push(0);
				this.stopY.push(0);
				this.stopZ.push(0);
			}
			this.stopTick[i] = 0;
			this.stopPiece[i] = -1;
			if (!sim.isLive(i) || sim.delayAt(i) > 0) continue;
			const kind = BulletPayload.get(sim.payloadAt(i), "kind");
			if (kind === BulletKind.GOO || kind === BulletKind.STRIKE) continue;
			this.record(sim, i);
		}
		for (let round = 0; round < PLAN_ROUNDS; round++) {
			// The pieces' hits in the sim's order: a hit on a piece the plan already broke is not one (re-routed below).
			for (let s = 0; s < np; s++) {
				this.breakTick[s] = 0;
				this.breaker[s] = -1;
				this.pieceHp[s] = list[s].hp;
			}
			for (let k = 1; k <= n; k++) {
				for (let i = 0; i < hw; i++) {
					if (this.stopTick[i] !== k) continue;
					const s = this.stopPiece[i];
					if (s < 0 || this.breakTick[s] !== 0) continue;
					if (inertPiece(list[s].kind) || goldenGuardsPiece(state, s)) continue;
					const hp = this.pieceHp[s] - damage;
					this.pieceHp[s] = hp;
					if (hp > 0) continue;
					this.breakTick[s] = k;
					this.breaker[s] = i;
				}
			}
			let moved = false;
			for (let i = 0; i < hw; i++) {
				const k = this.stopTick[i];
				const s = this.stopPiece[i];
				if (k === 0 || s < 0) continue;
				const bt = this.breakTick[s];
				if (bt === 0 || k < bt || (k === bt && i <= this.breaker[s])) continue;
				this.record(sim, i);
				moved = true;
			}
			if (!moved) break;
		}
	}

	/**
	 * True when any cell of the box between grid cells (ax, az) (the bullet's own: the sim already tested it) and
	 * (bx, bz) stops bullets.
	 */
	private boxStops(ax: number, az: number, bx: number, bz: number): boolean {
		const x0 = math.min(ax, bx);
		const x1 = math.max(ax, bx);
		const z0 = math.min(az, bz);
		const z1 = math.max(az, bz);
		for (let gz = z0; gz <= z1; gz++) {
			for (let gx = x0; gx <= x1; gx++) {
				if (gx === ax && gz === az) continue;
				if (this.stops(gridToWorld(gx), gridToWorld(gz))) return true;
			}
		}
		return false;
	}

	/**
	 * Slot `i` of `sim` (the enemy bullets) `ticks` ticks ahead into `out`; false when it will be gone by then (hidden).
	 * The slot must be live (`isLive`); with ticks 0 it must be visible (as the renderers draw today).
	 */
	pose(sim: BulletSimulation, i: number, out: AheadPose): boolean {
		const cur = sim.positionAt(i);
		const prev = sim.previousPositionAt(i, this.prev);
		const n = this.ticks;
		const kind = BulletPayload.get(sim.payloadAt(i), "kind");
		if (n === 0 || kind === BulletKind.GOO || kind === BulletKind.STRIKE) {
			if (!sim.isVisible(i)) return false;
			out.prevX = prev.x;
			out.prevY = prev.y;
			out.prevZ = prev.z;
			out.x = cur.x;
			out.y = cur.y;
			out.z = cur.z;
			return true;
		}
		if (sim.delayAt(i) > 0) return this.replay(sim, i, cur.x, cur.y, cur.z, prev.x, prev.y, prev.z, out);
		// Life: certainly alive past the window, else counted down tick by tick like the sim.
		const sums = this.sums;
		let life = sim.lifeAt(i);
		if (!(life - sums[n] > LIFE_MARGIN)) {
			for (let k = 0; k < n; k++) {
				life -= this.dts[k];
				if (life <= 0) return false;
			}
		}
		const v = sim.velocityAt(i);
		const vx = v.x;
		const vy = v.y;
		const vz = v.z;
		const px = cur.x;
		const py = cur.y;
		const pz = cur.z;
		const sn = sums[n];
		const fx = px + vx * sn;
		const fy = py + vy * sn;
		const fz = pz + vz * sn;
		const limit = sim.boundsLimit;
		// The culling cube is convex: inside at both ends is inside all the way.
		if (
			limit !== math.huge &&
			(fx > limit || fx < -limit || fy > limit || fy < -limit || fz > limit || fz < -limit)
		) {
			return false;
		}
		// Walls and pieces answer per grid cell. A bullet that stays in its cell needs no test (the sim tested that cell
		// when the bullet entered it); one that leaves it tests the box of cells between its ends first, and only when
		// one of them stops bullets are its tick positions tested (where they enter a new cell) to find the tick.
		const g0x = cellOf(px);
		const g0z = cellOf(pz);
		const g1x = cellOf(fx);
		const g1z = cellOf(fz);
		const walls = this.blocked !== undefined || this.pieces !== undefined;
		if (walls && (g0x !== g1x || g0z !== g1z) && this.boxStops(g0x, g0z, g1x, g1z)) {
			if (this.pieces !== undefined) {
				// Pieces can break inside the window (the break plan): the plan's stop for this slot.
				this.plan(sim);
				if (this.stopTick[i] > 0) {
					return this.stopped(out, this.stopX[i], this.stopY[i], this.stopZ[i]);
				}
			} else if (this.search(sim, i) > 0) {
				// Walls only: consumed there by the sim, drawn still at its last free position.
				return this.stopped(out, this.foundX, this.foundY, this.foundZ);
			}
		}
		const s1 = sums[n - 1];
		out.prevX = px + vx * s1;
		out.prevY = py + vy * s1;
		out.prevZ = pz + vz * s1;
		out.x = fx;
		out.y = fy;
		out.z = fz;
		return true;
	}

	/** A bullet the sim consumes inside the window: drawn still at its last free position (x, y, z). */
	private stopped(out: AheadPose, x: number, y: number, z: number): boolean {
		out.prevX = x;
		out.prevY = y;
		out.prevZ = z;
		out.x = x;
		out.y = y;
		out.z = z;
		return true;
	}

	/**
	 * The sim's step replayed tick by tick from (px, py, pz) / (qx, qy, qz) (the delay path; see the file comment):
	 * pose()'s answer for a bullet still waiting to appear.
	 */
	replay(
		sim: BulletSimulation,
		i: number,
		px: number,
		py: number,
		pz: number,
		qx: number,
		qy: number,
		qz: number,
		out: AheadPose,
	): boolean {
		const n = this.ticks;
		const v = sim.velocityAt(i);
		const limit = sim.boundsLimit;
		const cull = limit !== math.huge;
		let delay = sim.delayAt(i);
		let life = sim.lifeAt(i);
		for (let k = 0; k < n; k++) {
			const dt = this.dts[k];
			if (delay > 0) {
				delay -= dt;
				if (delay > 0) continue;
			}
			const nx = px + v.x * dt;
			const ny = py + v.y * dt;
			const nz = pz + v.z * dt;
			life -= dt;
			if (life <= 0) return false;
			if (cull && (nx > limit || nx < -limit || ny > limit || ny < -limit || nz > limit || nz < -limit))
				return false;
			if (this.stops(nx, nz)) {
				out.prevX = px;
				out.prevY = py;
				out.prevZ = pz;
				out.x = px;
				out.y = py;
				out.z = pz;
				return true;
			}
			qx = px;
			qy = py;
			qz = pz;
			px = nx;
			py = ny;
			pz = nz;
		}
		if (delay > 0) return false; // still waiting to appear
		out.prevX = qx;
		out.prevY = qy;
		out.prevZ = qz;
		out.x = px;
		out.y = py;
		out.z = pz;
		return true;
	}
}
