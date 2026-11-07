/**
 * Tile-grid collision for the fixed-step simulation. Pure and deterministic: no trig, no allocation beyond the
 * returned point. Roblox port of project-kaleb-vale src/dungeon/collision.ts @ 42897e2, plus `lineOfSight` from
 * src/sim/actors/helpers.ts @ 42897e2 (it only needs a bullet blocker, so it lives with the tile queries here).
 *
 * Coordinates: dungeon grid cell (gx, gy) is centered on world (gx * TILE_SIZE, 0, gy * TILE_SIZE)
 * and covers [gx - 0.5, gx + 0.5] x [gy - 0.5, gy + 0.5] tiles. World x follows grid x and
 * world z follows grid y; the floor is y = 0. (World units here are sim units; the view scales them to studs.)
 *
 * Walkability: only FLOOR is walkable. WALL and VOID (and anything outside the grid) block.
 * POOL (lava / water / miasma pits and wall pockets) also blocks movement for now.
 */
import { TileType, type Dungeon, type Room } from "./forge";

/** Sim units per grid tile (the web build's src/config.ts TILE_SIZE). */
export const TILE_SIZE = 1;

export interface WorldXZ {
	x: number;
	z: number;
}

/**
 * Extra solid cells over the tile grid (docs/DECOR.md D4: the intact breakables), keyed by `cellKey(gx, gy)`; only
 * `has` is read. The sim passes its own (state.breakables.slotByCell) as the movers' and blockers' optional trailing
 * argument; absent, every function here takes exactly its grid-only path.
 */
export type SolidCells = ReadonlyMap<number, number>;

/** Row stride of cellKey (grids are far narrower). */
export const CELL_KEY_STRIDE = 65536;

/** The SolidCells key of grid cell (gx, gy) (any cell inside the grid). */
export function cellKey(gx: number, gy: number): number {
	return gy * CELL_KEY_STRIDE + gx;
}

/** `SimConfig.moveResolver`: moves the player circle, sliding along walls (and `solid` cells). */
export type MoveResolver = (x: number, z: number, dx: number, dz: number, solid?: SolidCells) => WorldXZ;
/** `SimConfig.actorMover`: moves a circle of any radius (enemies, bosses). */
export type ActorMover = (x: number, z: number, dx: number, dz: number, radius: number, solid?: SolidCells) => WorldXZ;
/** `SimConfig.isBulletBlocked`: true when a bullet at world (x, z) hits a wall (or a `solid` cell). */
export type BulletBlocker = (x: number, z: number, solid?: SolidCells) => boolean;

/** Tile at integer grid coords; VOID outside the grid. */
export function tileAt(d: Dungeon, gx: number, gy: number): TileType {
	if (gx < 0 || gy < 0 || gx >= d.W || gy >= d.H) return TileType.VOID;
	return d.grid[gy * d.W + gx] as TileType;
}

/** Grid cell index (along one axis) containing world coordinate v. */
export function worldToGrid(v: number): number {
	return math.floor(v / TILE_SIZE + 0.5);
}

/** World coordinate of a grid cell's center (along one axis). */
export function gridToWorld(g: number): number {
	return g * TILE_SIZE;
}

/** True for tiles an entity can stand on (FLOOR only; see the POOL note above). */
export function isWalkableTile(t: TileType): boolean {
	return t === TileType.FLOOR;
}

/** True when the world point (x, z) lies on a walkable tile. */
export function isWalkable(d: Dungeon, x: number, z: number): boolean {
	return isWalkableTile(tileAt(d, worldToGrid(x), worldToGrid(z)));
}

/**
 * A non-walkable tile, or (only when `solid` is given) a walkable one listed in it: what stops a moving circle (exported
 * for the player's slide mover, slide.ts).
 */
export function blocksMove(d: Dungeon, gx: number, gy: number, solid?: SolidCells): boolean {
	if (!isWalkableTile(tileAt(d, gx, gy))) return true;
	return solid !== undefined && solid.has(cellKey(gx, gy));
}

/** Touching within this distance is not penetration (absorbs float rounding at rest). */
const EPS = 1e-9;

/**
 * Sweep a circle along one axis. `u` is the moving coordinate, `v` the fixed one; `alongX`
 * says which world axis `u` is. Returns the furthest reachable u.
 * Exact swept circle-vs-box per axis: for each blocking tile in the swept band, the circle
 * stops where it first touches the tile (u = edge -/+ sqrt(r^2 - gap^2)), so it cannot skip
 * over a tile regardless of step length. Exported for the player's slide mover (slide.ts).
 */
export function sweepAxis(
	d: Dungeon,
	u: number,
	v: number,
	du: number,
	r: number,
	alongX: boolean,
	solid?: SolidCells,
): number {
	if (du === 0) return u;
	const half = TILE_SIZE / 2;
	let nu = u + du;
	const gu0 = worldToGrid(math.min(u, nu) - r),
		gu1 = worldToGrid(math.max(u, nu) + r);
	const gv0 = worldToGrid(v - r),
		gv1 = worldToGrid(v + r);
	const r2 = r * r;
	for (let gv = gv0; gv <= gv1; gv++) {
		const v0 = gv * TILE_SIZE - half,
			v1 = gv * TILE_SIZE + half;
		const gap = v < v0 ? v0 - v : v > v1 ? v - v1 : 0;
		const rem = r2 - gap * gap;
		if (rem <= 0) continue; // this row/column is out of the circle's reach
		const reach = math.sqrt(rem);
		for (let gu = gu0; gu <= gu1; gu++) {
			if (!(alongX ? blocksMove(d, gu, gv, solid) : blocksMove(d, gv, gu, solid))) continue;
			if (du > 0) {
				const stop = gu * TILE_SIZE - half - reach;
				// stop < u - EPS means we already overlap this tile (spawned inside it): let it go.
				if (stop >= u - EPS && stop < nu) nu = stop;
			} else {
				const stop = gu * TILE_SIZE + half + reach;
				if (stop <= u + EPS && stop > nu) nu = stop;
			}
		}
	}
	return nu;
}

/**
 * Move a circle of `radius` from world (x, z) by (dx, dz), sliding along walls: X is resolved
 * first, then Z from the new X (axis-separated), each with an exact swept test against every
 * non-walkable tile.
 *
 * Contract: no tunnelling for |dx|, |dz| <= 0.5 world units per call. Convex wall corners stop the axis that hits
 * them (no tangential deflection); the other axis still slides. If the circle starts overlapping a tile (e.g.
 * spawned inside a wall), that tile does not block it, so the entity can walk out.
 * `solid` (optional): extra blocking cells (the sim's intact breakables); absent, the grid alone.
 */
export function moveCircle(
	d: Dungeon,
	x: number,
	z: number,
	dx: number,
	dz: number,
	radius: number,
	solid?: SolidCells,
): WorldXZ {
	const nx = sweepAxis(d, x, z, dx, radius, true, solid);
	const nz = sweepAxis(d, z, nx, dz, radius, false, solid);
	return { x: nx, z: nz };
}

/** blocksMove() at primary-axis cell `gu` and lateral cell `gv`. */
function blocksAcross(d: Dungeon, gu: number, gv: number, alongX: boolean, solid?: SolidCells): boolean {
	return alongX ? blocksMove(d, gu, gv, solid) : blocksMove(d, gv, gu, solid);
}

/** A blocked remainder below this is no block (float noise of a slide). */
const NUDGE_EPS = 1e-9;

/** cornerNudge's result (module scratch: read it before the next call); `ok` false = no nudge (keep moveCircle's). */
const nudged = { u: 0, v: 0, ok: false };

/** A nudge sweep that stops more than this short of where it was sent counts as blocked (no nudge). */
const REACH_EPS = 1e-9;

/**
 * Nudge around the obstacle in front of a circle that `moveCircle` stopped on its primary axis: the circle at (u, v)
 * (u the primary axis) asked to move (mu, mv), and may travel `budget` more world units. The obstacle is the run of
 * blocking tiles in the column just ahead that the circle touches; the circle goes round one of its ENDS (the next
 * tile along the run, in that column, is open). The end is chosen so that a nudge only ever helps where moveCircle
 * would slide anyway, and is refused (nudged.ok false: moveCircle's result stands) otherwise:
 *   pillar     both ends open and nothing behind the run (the column beyond it is open there): the side the move's
 *              ray passes the run's centre on, in world terms so an X-blocked and a Z-blocked call agree (a ray through
 *              the centre passes on its right). Sliding that way only moves the ray further to that side.
 *   wall end   anything else touched on its face (one end open, or a 1-wide wall seen end-on, which goes on behind
 *              the run): only toward an open end that the move's ray already passes outside of (the circle's body
 *              clips the end, its centre line misses it). Where the ray meets the run itself (a wall's middle, a
 *              concave corner, a staircase wall, a wall end the target is right behind) there is no nudge, so the
 *              circle rests where moveCircle rests instead of being pushed back and forth by X- and Z-blocked calls.
 *   a wall's corner (touched, not a pillar): along the corner's tangent by the move's own component along it (a
 *              frictionless deflection: the same for an X- and a Z-blocked call there); none when it points straight
 *              at the corner.
 * Then the move, every part an exact sweep that must get all the way (else no nudge):
 *   face       (the circle's centre is within the run's lateral span): slide along the face toward that end by
 *              min(budget, distance to clear it), then what is left of the budget forward again.
 *   corner     (it touches the run's corner): `budget` along the corner's tangent toward that side, the axis that
 *              moves away from the corner first.
 */
function cornerNudge(
	d: Dungeon,
	u: number,
	v: number,
	mu: number,
	mv: number,
	budget: number,
	r: number,
	alongX: boolean,
	solid?: SolidCells,
): void {
	nudged.ok = false;
	const half = TILE_SIZE / 2;
	const s = mu > 0 ? 1 : -1;
	const gu = worldToGrid(u + s * (r + TILE_SIZE * CORNER_PROBE));
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
	if (hi < lo) return;
	const downOpen = !blocksAcross(d, gu, lo - 1, alongX, solid);
	const upOpen = !blocksAcross(d, gu, hi + 1, alongX, solid);
	if (!downOpen && !upOpen) return;
	let behind = false;
	for (let gv = lo; gv <= hi; gv++) if (blocksAcross(d, gu + s, gv, alongX, solid)) behind = true;
	const pillar = downOpen && upOpen && !behind;
	const vLo = lo * TILE_SIZE - half,
		vHi = hi * TILE_SIZE + half;
	const onFace = v >= vLo && v <= vHi;
	let dir: number;
	if (pillar) {
		// The side the move's ray passes the run's centre on. World cross product move x (run centre - circle) >= 0
		// puts the obstacle on the ray's left (a ray through the centre passes on its right).
		const cu = gu * TILE_SIZE - u;
		const cv = ((lo + hi) * TILE_SIZE) / 2 - v;
		const crossUV = mu * cv - mv * cu;
		const left = alongX ? crossUV >= 0 : -crossUV >= 0;
		dir = (left ? -s : s) * (alongX ? 1 : -1);
	} else if (!onFace) dir = 0; // a wall's corner: decided below, by the corner itself
	else {
		// A wall's end (or a 1-wide wall seen end-on): only when the move's ray already passes outside the run on an
		// open side (the circle's body clips the end, its centre line does not). Where the ray meets the run, a concave
		// corner or a staircase has wall: no nudge.
		const aim = v + (mv / math.abs(mu)) * math.abs(gu * TILE_SIZE - u);
		if (aim < vLo && downOpen) dir = -1;
		else if (aim > vHi && upOpen) dir = 1;
		else return;
	}
	if (onFace) {
		// Face: slide toward the chosen end, then forward with what is left.
		const dist = dir < 0 ? v - (vLo - r) : vHi + r - v;
		const m = budget < dist ? budget : dist;
		if (m <= NUDGE_EPS) return;
		const nv = sweepAxis(d, v, u, dir * m, r, !alongX, solid);
		if (math.abs(nv - v) < m - REACH_EPS) return;
		const rest = budget - m;
		nudged.v = nv;
		nudged.u = rest > NUDGE_EPS ? sweepAxis(d, u, nv, s * rest, r, alongX, solid) : u;
		nudged.ok = true;
		return;
	}
	// Corner: the tangent at the corner point K, toward the chosen side (a pillar: by the whole budget).
	const nu = u - (gu * TILE_SIZE - s * half);
	const nv0 = v - (v < vLo ? vLo : vHi);
	const len = math.sqrt(nu * nu + nv0 * nv0);
	if (len <= NUDGE_EPS) return;
	// tangent = sigma * (-nv0, nu)
	let sigma: number;
	let amount = budget;
	if (dir !== 0) sigma = nu * dir >= 0 ? 1 : -1; // a pillar: its lateral part sigma * nu has the sign of dir
	else {
		// A wall's corner: slide along the tangent by the move's own component along it (a frictionless deflection),
		// the same for an X- and a Z-blocked call at that corner; none when the move points straight at it.
		const along = (-nv0 * mu + nu * mv) / len;
		if (math.abs(along) <= CORNER_TIE * math.sqrt(mu * mu + mv * mv)) return;
		sigma = along > 0 ? 1 : -1;
		amount = math.min(budget, math.abs(along));
	}
	const tu = (-sigma * nv0 * amount) / len;
	const tv = (sigma * nu * amount) / len;
	let u1 = u,
		v1 = v;
	if (nv0 * tv >= 0) {
		v1 = sweepAxis(d, v, u, tv, r, !alongX, solid);
		u1 = sweepAxis(d, u, v1, tu, r, alongX, solid);
	} else {
		u1 = sweepAxis(d, u, v, tu, r, alongX, solid);
		v1 = sweepAxis(d, v, u1, tv, r, !alongX, solid);
	}
	if (math.abs(u1 - u) < math.abs(tu) - REACH_EPS || math.abs(v1 - v) < math.abs(tv) - REACH_EPS) return;
	nudged.u = u1;
	nudged.v = v1;
	nudged.ok = true;
}

/** A move within this sine of pointing straight at a wall's corner takes neither tangent (moveCircle's result). */
const CORNER_TIE = 1e-3;

/** A steered move's squared length may exceed the step's by this factor (float rounding), never more. */
const STEP_BOUND = 1 + 1e-12;

/** How far past the circle's front (in tiles) the nudge looks for the blocking column. */
const CORNER_PROBE = 1e-6;

/**
 * `moveCircle`, then around convex corners: when the move's primary axis (the larger of |dx|, |dz|; X on a tie) was
 * stopped by an obstacle with a usable end (`cornerNudge`: a pillar, the end of a wall the move slides toward), the
 * unused part of the step goes round it: a slide along its face toward that end (then forward again), or along the
 * tangent of the corner it touches. A circle walking at a target behind a 1-tile pillar therefore rounds it instead of
 * pressing on its face (plain moveCircle stops the blocked axis and only slides the other, so a head-on approach
 * stalls). Everywhere else (open floor, a long wall head-on, a concave corner, a staircase wall) it IS moveCircle, so
 * it rests where moveCircle rests and never flips between two positions. Same contract as moveCircle (pure, every
 * move an exact sweep); the result is never farther from (x, z) than the step's length |(dx, dz)|. `solid` cells
 * (a breakable) are obstacles like any wall tile: a lone crate is rounded like a pillar.
 */
export function moveCircleAroundCorners(
	d: Dungeon,
	x: number,
	z: number,
	dx: number,
	dz: number,
	radius: number,
	solid?: SolidCells,
): WorldXZ {
	const res = moveCircle(d, x, z, dx, dz, radius, solid);
	const adx = math.abs(dx),
		adz = math.abs(dz);
	if (adx === 0 && adz === 0) return res;
	const alongX = adx >= adz;
	const lost = alongX ? adx - math.abs(res.x - x) : adz - math.abs(res.z - z);
	if (lost <= NUDGE_EPS) return res;
	// What moveCircle used of the step's length is spent; the nudge gets the rest (so |result - start| <= |step|).
	const ox = res.x - x,
		oz = res.z - z;
	const budget = math.sqrt(dx * dx + dz * dz) - math.sqrt(ox * ox + oz * oz);
	if (budget <= NUDGE_EPS) return res;
	if (alongX) cornerNudge(d, res.x, res.z, dx, dz, budget < lost ? budget : lost, radius, true, solid);
	else cornerNudge(d, res.z, res.x, dz, dx, budget < lost ? budget : lost, radius, false, solid);
	if (!nudged.ok) return res;
	const nx = alongX ? nudged.u : nudged.v,
		nz = alongX ? nudged.v : nudged.u;
	// Never farther than the step asked for (up to rounding: the budget above already keeps it within the step).
	if ((nx - x) * (nx - x) + (nz - z) * (nz - z) > (dx * dx + dz * dz) * STEP_BOUND) return res;
	return { x: nx, z: nz };
}

/** `SimConfig.moveResolver` for the player: `(x, z, dx, dz, solid) => moveCircle(d, x, z, dx, dz, radius, solid)`. */
export function circleMover(d: Dungeon, radius: number): MoveResolver {
	return (x, z, dx, dz, solid) => moveCircle(d, x, z, dx, dz, radius, solid);
}

/** `SimConfig.actorMover`: `(x, z, dx, dz, radius, solid) => moveCircle(d, x, z, dx, dz, radius, solid)`. */
export function actorMover(d: Dungeon): ActorMover {
	return (x, z, dx, dz, radius, solid) => moveCircle(d, x, z, dx, dz, radius, solid);
}

/**
 * `SimConfig.actorSteerMover` (endless floors): `(x, z, dx, dz, radius) => moveCircleAroundCorners(d, ...)`, so
 * walking enemies round solid pillars and wall ends instead of snagging on them.
 */
export function actorSteerMover(d: Dungeon): ActorMover {
	return (x, z, dx, dz, radius, solid) => moveCircleAroundCorners(d, x, z, dx, dz, radius, solid);
}

/** A tile stops a bullet when it is WALL or VOID (outside the grid reads as VOID). FLOOR and POOL let it through. */
export function isBulletBlockingTile(t: TileType): boolean {
	return t === TileType.WALL || t === TileType.VOID;
}

/**
 * True when a bullet whose center is at world (x, z) is inside a WALL or VOID tile (or, when given, a `solid` cell)
 * and must be consumed.
 */
export function isBulletBlocked(d: Dungeon, x: number, z: number, solid?: SolidCells): boolean {
	const gx = worldToGrid(x);
	const gy = worldToGrid(z);
	if (isBulletBlockingTile(tileAt(d, gx, gy))) return true;
	return solid !== undefined && solid.has(cellKey(gx, gy));
}

/**
 * `SimConfig.isBodyBlocked`: true when the cell under (x, z) stops a body (blocksMove: anything but FLOOR, so a pool
 * tile too, which bullets cross; or a `solid` cell).
 */
export function bodyBlocker(d: Dungeon): BulletBlocker {
	return (x, z, solid) => blocksMove(d, worldToGrid(x), worldToGrid(z), solid);
}

/**
 * `SimConfig.isBulletBlocked`: `(x, z, solid) => isBulletBlocked(d, x, z, solid)`. Line of sight calls it with
 * (x, z) only, so sight never sees `solid` cells (docs/DECOR.md B2: breakables are low cover).
 */
export function bulletBlocker(d: Dungeon): BulletBlocker {
	return (x, z, solid) => isBulletBlocked(d, x, z, solid);
}

/** Default tolerance of circleOverlapsWall. */
const OVERLAP_TOLERANCE = 1e-6;

/** True when the circle overlaps any non-walkable tile (or `solid` cell) by more than `tolerance`. */
export function circleOverlapsWall(
	d: Dungeon,
	x: number,
	z: number,
	radius: number,
	tolerance = OVERLAP_TOLERANCE,
	solid?: SolidCells,
): boolean {
	const half = TILE_SIZE / 2;
	const r2 = (radius - tolerance) * (radius - tolerance);
	for (let gy = worldToGrid(z - radius); gy <= worldToGrid(z + radius); gy++)
		for (let gx = worldToGrid(x - radius); gx <= worldToGrid(x + radius); gx++) {
			if (!blocksMove(d, gx, gy, solid)) continue;
			const cx = math.min(math.max(x, gx * TILE_SIZE - half), gx * TILE_SIZE + half);
			const cz = math.min(math.max(z, gy * TILE_SIZE - half), gy * TILE_SIZE + half);
			if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < r2) return true;
		}
	return false;
}

/**
 * Line of sight on the tile grid (project-kaleb-vale src/sim/actors/helpers.ts lineOfSight @ 42897e2): false when any
 * tile the segment (x0, z0) -> (x1, z1) passes through stops bullets (`blocked` tested at each tile's center), true
 * otherwise and always true without a blocker. Exact grid traversal (Amanatides-Woo DDA, both neighbours checked when
 * the segment crosses a tile corner exactly), both end tiles included. Pure, no trig, no allocation.
 */
export function lineOfSight(
	blocked: BulletBlocker | undefined,
	x0: number,
	z0: number,
	x1: number,
	z1: number,
): boolean {
	if (!blocked) return true;
	// Grid units with cell g covering [g, g + 1): world v -> v / TILE_SIZE + 0.5 (tile g is centered on world g * TILE_SIZE).
	const ux0 = x0 / TILE_SIZE + 0.5;
	const uz0 = z0 / TILE_SIZE + 0.5;
	const ux1 = x1 / TILE_SIZE + 0.5;
	const uz1 = z1 / TILE_SIZE + 0.5;
	let gx = math.floor(ux0);
	let gz = math.floor(uz0);
	const gx1 = math.floor(ux1);
	const gz1 = math.floor(uz1);
	if (blocked(gx * TILE_SIZE, gz * TILE_SIZE)) return false;
	const dx = ux1 - ux0;
	const dz = uz1 - uz0;
	const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
	const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
	const tDeltaX = stepX !== 0 ? math.abs(1 / dx) : math.huge;
	const tDeltaZ = stepZ !== 0 ? math.abs(1 / dz) : math.huge;
	let tMaxX = stepX > 0 ? (gx + 1 - ux0) / dx : stepX < 0 ? (ux0 - gx) / -dx : math.huge;
	let tMaxZ = stepZ > 0 ? (gz + 1 - uz0) / dz : stepZ < 0 ? (uz0 - gz) / -dz : math.huge;
	let left = math.abs(gx1 - gx) + math.abs(gz1 - gz);
	while (left > 0) {
		if (tMaxX < tMaxZ) {
			gx += stepX;
			tMaxX += tDeltaX;
			left--;
		} else if (tMaxZ < tMaxX) {
			gz += stepZ;
			tMaxZ += tDeltaZ;
			left--;
		} else {
			// Exactly through a corner: both side tiles count (no squeezing between two diagonal walls).
			if (blocked((gx + stepX) * TILE_SIZE, gz * TILE_SIZE) || blocked(gx * TILE_SIZE, (gz + stepZ) * TILE_SIZE))
				return false;
			gx += stepX;
			gz += stepZ;
			tMaxX += tDeltaX;
			tMaxZ += tDeltaZ;
			left -= 2;
		}
		if (blocked(gx * TILE_SIZE, gz * TILE_SIZE)) return false;
	}
	return true;
}

/** The boss room. */
export function bossRoom(d: Dungeon): Room {
	return d.rooms[d.boss];
}

/** The entrance room. */
export function entranceRoom(d: Dungeon): Room {
	return d.rooms[d.entrance];
}

/**
 * Player spawn: world position of the entrance room's center tile. For a valid dungeon this is
 * always FLOOR (the generator's connectivity BFS starts there). Defensive fallback: the nearest
 * FLOOR tile by ring search, preferring tiles of the entrance room.
 */
export function entranceSpawn(d: Dungeon): WorldXZ {
	const r = entranceRoom(d);
	if (tileAt(d, r.cx, r.cy) === TileType.FLOOR) return { x: gridToWorld(r.cx), z: gridToWorld(r.cy) };
	const maxRing = math.max(d.W, d.H);
	for (const sameRoomOnly of [true, false])
		for (let k = 1; k <= maxRing; k++)
			for (let oy = -k; oy <= k; oy++)
				for (let ox = -k; ox <= k; ox++) {
					if (math.max(math.abs(ox), math.abs(oy)) !== k) continue;
					const gx = r.cx + ox,
						gy = r.cy + oy;
					if (tileAt(d, gx, gy) !== TileType.FLOOR) continue;
					if (sameRoomOnly && d.roomId[gy * d.W + gx] !== r.id) continue;
					return { x: gridToWorld(gx), z: gridToWorld(gy) };
				}
	error("entranceSpawn: dungeon has no floor tiles");
}
