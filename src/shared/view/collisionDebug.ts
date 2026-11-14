/**
 * KV_CollisionDebug's logic (docs/WALL_SLIDE.md WS6; tunables: COLLISION_DEBUG in collisionDebugConfig.ts; drawing:
 * the client's CollisionDebugController). Pure and headless:
 *
 *   collisionBlocks / isIsolatedBlocker   which grid cells stop the player's body (and which are isolated 1x1 pillars)
 *   blockingCellsNear                     the blocking cells around the watched player's cell, in a fixed scan order
 *   inputMagnitude                        the move input's length as the sim uses it (unit, clamped to 1)
 *   StallDetector                         the stall flash: input held, body (almost) not moving; one event per episode
 *   stallLine                             the `[collision] stall ...` output line
 *   collisionDebugDungeon                 the grid the sim moves on: a secret floor's carved copy (docs/SECRET_ROOMS.md
 *                                         SR5: the chamber and the crack FLOOR, the crack held shut by its intact pieces
 *                                         in `solid`), else the floor's own
 *
 * Presentation only: it reads a Dungeon and SolidCells the sim already uses and never writes anything back.
 */
import {
	blocksMove,
	isIsolatedBlocker,
	isWalkableTile,
	tileAt,
	worldToGrid,
	type Dungeon,
	type SolidCells,
} from "shared/dungeon";
import { AXIS_MAX, PLAYER_SPEED, SIM_HZ, type PlayerState } from "shared/sim";
import { COLLISION_DEBUG } from "./collisionDebugConfig";

/**
 * The Dungeon the overlay reads for a floor drawn from `forge` (EndlessRunFloor.dungeon, the Forge's grid the view
 * draws): the sim's carved copy when the floor has a secret room (`secret`: EndlessRunFloor.secret / the layout's,
 * FloorSecret.dungeon; shared/run endlessFloorWorld builds the movers on it), else `forge` itself. Pass the result with
 * the sim's solidCells(state): an unopened crack blocks through its pieces (a `solid` cell), an opened one not at all,
 * and the chamber is walkable, exactly as the player's mover sees them.
 */
export function collisionDebugDungeon(forge: Dungeon, secret: { readonly dungeon: Dungeon } | undefined): Dungeon {
	return secret?.dungeon ?? forge;
}

/**
 * True when grid cell (gx, gy) stops a body: a tile other than FLOOR (WALL, VOID, POOL, anything outside the grid), or
 * a FLOOR cell listed in `solid` (an intact breakable). The movers' own rule: shared/dungeon `blocksMove`.
 */
export const collisionBlocks = blocksMove;

/** An isolated 1x1 blocker (a pillar, a lone crate; the wall slide's pillar slip): shared/dungeon `isIsolatedBlocker`. */
export { isIsolatedBlocker };

/** One blocking cell the overlay draws. */
export interface CollisionDebugCell {
	readonly gx: number;
	readonly gy: number;
	/** isIsolatedBlocker: drawn in COLLISION_DEBUG.isolatedRole. */
	readonly isolated: boolean;
	/** The cell is FLOOR and blocks only through `solid` (an intact breakable). */
	readonly solid: boolean;
}

/**
 * The blocking cells whose centre lies within `radiusTiles` of cell (cgx, cgy)'s centre (a disc of cells, the edge
 * included), scanned row by row (gy, then gx, ascending). Cells outside the grid count (they are VOID).
 */
export function blockingCellsNear(
	d: Dungeon,
	cgx: number,
	cgy: number,
	solid?: SolidCells,
	radiusTiles: number = COLLISION_DEBUG.cellRadiusTiles,
): CollisionDebugCell[] {
	const out = new Array<CollisionDebugCell>();
	const r = math.floor(radiusTiles);
	const r2 = radiusTiles * radiusTiles;
	for (let dy = -r; dy <= r; dy++) {
		for (let dx = -r; dx <= r; dx++) {
			if (dx * dx + dy * dy > r2) continue;
			const gx = cgx + dx;
			const gy = cgy + dy;
			if (!collisionBlocks(d, gx, gy, solid)) continue;
			out.push({
				gx,
				gy,
				isolated: isIsolatedBlocker(d, gx, gy, solid),
				solid: isWalkableTile(tileAt(d, gx, gy)),
			});
		}
	}
	return out;
}

/** The move input's length as the sim walks it: the world axes over AXIS_MAX, clamped to 1 (shared/sim player.ts). */
export function inputMagnitude(moveX: number, moveZ: number): number {
	return math.min(1, math.sqrt(moveX * moveX + moveZ * moveZ) / AXIS_MAX);
}

/** Absorbs float error in holdSec x hz (0.3 s x 60 Hz is 18 ticks, never 19). */
const HOLD_EPSILON = 1e-9;

/**
 * The stall flash (WS5's stall rule on screen): a **stall** is the move input held (inputMagnitude at least
 * COLLISION_DEBUG.stallInputMin) for stallHoldSec or more while the body moved (straight-line) less than
 * stallMoveShare of what a free walk at that input would have covered (PLAYER_SPEED x magnitude x elapsed) over the
 * last stallHoldSec. Time is the sim's tick, so a pause, the hitstop or a stage cover (no tick) neither builds nor ends
 * an episode.
 *
 * Feed it once per rendered frame: `update` returns true on the frame a stall **episode** starts (once), and
 * `isStalled()` stays true until the body moves freely again or the input is released (or `reset`). A tick that went
 * backwards (a new run) starts over.
 */
export class StallDetector {
	private readonly holdTicks: number;
	/** The samples of the current hold, oldest first: tick, position, free-walk distance since the hold began. */
	private readonly ticks = new Array<number>();
	private readonly xs = new Array<number>();
	private readonly zs = new Array<number>();
	private readonly free = new Array<number>();
	private stalled = false;

	constructor(private readonly hz: number = SIM_HZ, private readonly speed: number = PLAYER_SPEED) {
		this.holdTicks = math.ceil(COLLISION_DEBUG.stallHoldSec * hz - HOLD_EPSILON);
	}

	/** True while a stall episode is on. */
	isStalled(): boolean {
		return this.stalled;
	}

	/** Forgets the hold and ends any episode (input released, a new floor, the overlay turned off). */
	reset(): void {
		this.ticks.clear();
		this.xs.clear();
		this.zs.clear();
		this.free.clear();
		this.stalled = false;
	}

	/**
	 * One frame: the sim tick, the body's (uninterpolated) position after it and this frame's input magnitude (0 when
	 * none is known, e.g. a spectated teammate or a dead player). True only on the frame a stall episode starts.
	 */
	update(tick: number, x: number, z: number, magnitude: number): boolean {
		if (!(magnitude >= COLLISION_DEBUG.stallInputMin)) {
			this.reset();
			return false;
		}
		const n = this.ticks.size();
		if (n > 0 && tick < this.ticks[n - 1]) this.reset();
		const size = this.ticks.size();
		if (size === 0) {
			this.push(tick, x, z, 0);
			return false;
		}
		const lastTick = this.ticks[size - 1];
		if (tick === lastTick) return false; // no tick this frame: nothing moved, nothing to judge
		const walk = (this.speed * math.min(1, magnitude) * (tick - lastTick)) / this.hz;
		this.push(tick, x, z, this.free[size - 1] + walk);
		// Keep one sample at least holdTicks old as the window's base; drop the older ones.
		while (this.ticks.size() >= 2 && tick - this.ticks[1] >= this.holdTicks) {
			this.ticks.remove(0);
			this.xs.remove(0);
			this.zs.remove(0);
			this.free.remove(0);
		}
		if (tick - this.ticks[0] < this.holdTicks) return false; // not held long enough yet
		const last = this.ticks.size() - 1;
		const mx = x - this.xs[0];
		const mz = z - this.zs[0];
		const moved = math.sqrt(mx * mx + mz * mz);
		const freeWalk = this.free[last] - this.free[0];
		if (!(moved < COLLISION_DEBUG.stallMoveShare * freeWalk)) {
			this.stalled = false;
			return false;
		}
		if (this.stalled) return false;
		this.stalled = true;
		return true;
	}

	private push(tick: number, x: number, z: number, free: number): void {
		this.ticks.push(tick);
		this.xs.push(x);
		this.zs.push(z);
		this.free.push(free);
	}
}

function fixed(v: number): string {
	return string.format(`%.${COLLISION_DEBUG.logDecimals}f`, v);
}

/** `[collision] stall at x,z (gx,gy) input ix,iz`: world position, its grid cell, the unit move input (developer text). */
export function stallLine(x: number, z: number, moveX: number, moveZ: number): string {
	return (
		`[collision] stall at ${fixed(x)},${fixed(z)} (${worldToGrid(x)},${worldToGrid(z)}) ` +
		`input ${fixed(moveX / AXIS_MAX)},${fixed(moveZ / AXIS_MAX)}`
	);
}

/** Where KV_CollisionDebug draws its body rings this frame (sim units; see collisionRings). */
export interface CollisionRings {
	/** The body ring: the player as drawn. */
	bodyX: number;
	bodyZ: number;
	/** The merged (sim) body's ring, shown only while the drawn player is not the merged one (predicted). */
	mergedShown: boolean;
	mergedX: number;
	mergedZ: number;
}

/**
 * docs/LOCAL_PREDICTION.md LP6: the body ring at the drawn player (SimController.getDrawnPlayer) and, while that is
 * the predicted body (another object than the merged player), a second ring at the merged one; both interpolated by
 * `alpha` like every view. Written into `out`, returned.
 */
export function collisionRings(
	drawn: Readonly<PlayerState>,
	merged: Readonly<PlayerState>,
	alpha: number,
	out: CollisionRings,
): CollisionRings {
	out.bodyX = drawn.prevX + (drawn.x - drawn.prevX) * alpha;
	out.bodyZ = drawn.prevZ + (drawn.z - drawn.prevZ) * alpha;
	out.mergedShown = drawn !== merged;
	out.mergedX = merged.prevX + (merged.x - merged.prevX) * alpha;
	out.mergedZ = merged.prevZ + (merged.z - merged.prevZ) * alpha;
	return out;
}
