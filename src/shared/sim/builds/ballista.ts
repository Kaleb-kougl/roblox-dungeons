/**
 * Ballista (docs/BUILDS_V2.md "Ballista", BV3; a Roblox-port feature, no web source): the heavy arrow bursts into bolts
 * when it is consumed. Only with state.builds, and only for an owner with Ballista (any level); everyone else's arrows
 * end exactly as before. Siege Bolt's pins (level III) are ./siege.ts.
 *
 * Heavy arrows: ./duos.ts isHeavyArrow (kind PLAYER, the bow's source, the heavy arrow's squared speed). Stream arrows,
 * Flurry arrows, the bow-held Ember Wake ring and every effect bolt (Ricochet's splits included) never burst.
 *
 * The two moments (combat.ts, the player bullet walk; the arrow is consumed on both):
 *   - the last pierce: piercingBulletHit's hit with no pierce left -> a RING (BALLISTA_RINGS[level], @ FULL_RING) at
 *     the hit: centred on the enemy struck, its bolts starting on that enemy's hit circle (spawn radius = its radius +
 *     PLAYER_BULLET_RADIUS) and flying outward, so a survivor does not soak the whole ring; turned onto the arrow's
 *     flight direction (the shape's heading);
 *   - a wall (a blocked cell) or a piece it does not break (playerBulletHit's two consuming exits), and a Siege Bolt
 *     slam (./siege.ts) -> a back FAN (BALLISTA_FANS[level], @ BALLISTA_FAN_SPREAD) from the arrow's position at the
 *     START of the tick (pos - v x SIM_DT: a straight flight, so outside the wall it hit), aimed along -velocity (unit
 *     vector, one sqrt), so it comes back into the room. A start position that is itself blocked (an arrow fired
 *     point blank into a wall) fans nothing: no bolt ever spawns inside a wall cell. A slam's fan starts from the
 *     slammed actor instead (centre, spawn radius its radius + PLAYER_BULLET_RADIUS, the same aim): the body sits
 *     just behind the arrow, so a fan from the arrow would fly straight into it.
 * An arrow that ends its life in the air bursts nothing (BVD5: the pool releases expired bullets silently), and a heavy
 * arrow that breaks a piece flies on (no burst there).
 *
 * The walk never spawns into the pool it walks: buildsOnHeavyEnd queues the burst in module scratch (never across
 * ticks, so not hashed, like Ricochet's splits), and stepBuilds (./procs.ts, inside its effect budget session, after the
 * duos' pre-drain phase) fires it: fireEffect for the owner, effect BuildEffect.BALLISTA, generation 0 (the bolts' kills
 * proc at gen 1), at the owner's level when it fires. A departed owner's bursts are dropped. BuildEvents ballistaX / Z /
 * Owner / Fired / Wall per burst that spawned at least one bolt (Wall 1: a back fan, 0: a ring).
 *
 * The charge: Ballista II / III shorten it to BALLISTA_CHARGE_PERCENT (75 %: 36 -> 27 ticks) through runMods'
 * `ballistaChargePercent`, read by bow.ts bowChargeTicks (the sim's charge and the view's bowCharge).
 *
 * @module
 */
import type { SimCtx } from "../combat/ctx";
import type { SimState } from "../state";
import type { Vec3 } from "../combat/bullets";
import type { ActorState } from "../combat/actors/types";
import { PLAYER_BULLET_RADIUS } from "../combat/combatData";
import { SIM_DT } from "../units";
import { Boon } from "../progression/progressionData";
import { buildLevel, type BuildsState } from "./builds";
import { BuildEffect } from "./buildsData";
import { BALLISTA_FANS, BALLISTA_RINGS } from "./effectsData";
import { fireEffect } from "./effects";
import { isHeavyArrow } from "./duos";
import { buildPlayerLeft } from "./hooks";
import { levelEntry } from "./onKill";
import { siegeArrowEnd } from "./siege";

/** True when anything of Ballista can happen this tick: a player owns it (any level), or a pin is still recorded. */
export function ballistaActive(state: Readonly<SimState>): boolean {
	const s = state.builds;
	if (s === undefined) return false;
	if (s.pins.size() > 0) return true;
	for (const p of s.players) if (buildLevel(p, Boon.BALLISTA) > 0) return true;
	return false;
}

// ---------------------------------------------------------------------------------------------
// Bursts queued by this tick's player bullet walk, fired by stepBuilds the same tick

const burstOwner: number[] = [];
const burstX: number[] = [];
const burstZ: number[] = [];
const burstDirX: number[] = [];
const burstDirZ: number[] = [];
/** 1: a back fan (a wall, an unbroken piece, a slam); 0: the last pierce's ring. */
const burstWall: number[] = [];
/** The bolts' spawn radius round the origin (a ring: the struck enemy's hit circle; a fan: 0). */
const burstRadius: number[] = [];

/**
 * Heavy arrow player bullet `i` (payload `payload`, at `pos` after this tick's move) is consumed by the walk, credited
 * to ctx's bound player: `wall` for a blocked cell, a piece it did not break or a slam that is due, false for its last
 * pierce (`struck`: the enemy that hit was on). Ends its Siege Bolt pin record (./siege.ts siegeArrowEnd: the slam when
 * it carries) and queues the owner's burst (see the file comment). Anything that is not a heavy arrow: nothing.
 */
export function buildsOnHeavyEnd(
	ctx: SimCtx,
	i: number,
	pos: Readonly<Vec3>,
	payload: number,
	wall: boolean,
	struck?: Readonly<ActorState>,
): void {
	const s = ctx.state.builds;
	if (s === undefined) return;
	const v = ctx.combat.playerBullets.velocityAt(i);
	const vx = v.x;
	const vz = v.z;
	if (!isHeavyArrow(payload, vx, vz)) return;
	const owner = ctx.playerIndex;
	// Siege Bolt (BV4): the arrow's pin record ends here (a carrying arrow slams: its back fan below).
	const slammed = siegeArrowEnd(ctx, i, payload);
	const p = s.players[owner];
	if (p === undefined || buildLevel(p, Boon.BALLISTA) <= 0 || buildPlayerLeft(ctx.state, owner)) return;
	const speed = math.sqrt(vx * vx + vz * vz);
	if (!(speed > 0)) return;
	const dirX = vx / speed;
	const dirZ = vz / speed;
	if (slammed !== undefined) {
		queueBurst(owner, slammed.x, slammed.z, -dirX, -dirZ, 1, slammed.radius + PLAYER_BULLET_RADIUS);
	} else if (wall) {
		const x = pos.x - vx * SIM_DT;
		const z = pos.z - vz * SIM_DT;
		const blocked = ctx.config.isBulletBlocked;
		if (blocked !== undefined && blocked(x, z)) return;
		queueBurst(owner, x, z, -dirX, -dirZ, 1, 0);
	} else if (struck !== undefined) {
		queueBurst(owner, struck.x, struck.z, dirX, dirZ, 0, struck.radius + PLAYER_BULLET_RADIUS);
	} else {
		queueBurst(owner, pos.x, pos.z, dirX, dirZ, 0, 0);
	}
}

function queueBurst(
	owner: number,
	x: number,
	z: number,
	dirX: number,
	dirZ: number,
	wall: number,
	radius: number,
): void {
	burstOwner.push(owner);
	burstX.push(x);
	burstZ.push(z);
	burstDirX.push(dirX);
	burstDirZ.push(dirZ);
	burstWall.push(wall);
	burstRadius.push(radius);
}

/** stepBuilds (inside the effect budget session): fires this tick's queued bursts, in queue order. */
export function stepBallista(ctx: SimCtx, s: BuildsState): void {
	if (burstOwner.size() === 0) return;
	const e = s.events;
	for (let k = 0; k < burstOwner.size(); k++) {
		const owner = burstOwner[k];
		const p = s.players[owner];
		if (p === undefined || buildPlayerLeft(ctx.state, owner)) continue;
		const level = buildLevel(p, Boon.BALLISTA);
		if (level <= 0) continue;
		const wall = burstWall[k];
		const base = levelEntry(wall !== 0 ? BALLISTA_FANS : BALLISTA_RINGS, level);
		const radius = burstRadius[k];
		const spec = radius > 0 ? { ...base, radius } : base;
		const x = burstX[k];
		const z = burstZ[k];
		const n = fireEffect(ctx, owner, x, z, burstDirX[k], burstDirZ[k], spec, BuildEffect.BALLISTA, 0);
		if (n <= 0) continue;
		e.ballistaX.push(x);
		e.ballistaZ.push(z);
		e.ballistaOwner.push(owner);
		e.ballistaFired.push(n);
		e.ballistaWall.push(wall);
	}
	resetBallistaScratch();
}

/** Drops this module's per-tick scratch (the queued bursts): see procs.ts resetBuildScratch. */
export function resetBallistaScratch(): void {
	burstOwner.clear();
	burstX.clear();
	burstZ.clear();
	burstDirX.clear();
	burstDirZ.clear();
	burstWall.clear();
	burstRadius.clear();
}
