/**
 * 'stormcaller' (Roblox port, docs/NEW_ENEMIES.md NE5; no web source): a robed caster at the back of the room that marks
 * three circles on the floor and calls lightning on them. 5 hp, no contact damage.
 *
 *   1. Keeping range (STORMCALLER_KEEP): keeps keepMin-keepMax from its target like the imp (approach / back off /
 *      strafe; the strafe side flips when a wall stops it and after every cast: no draw). Without line of sight it walks
 *      toward the target to find a line again, and leashes after lostTicks without one (aiTicks counts them).
 *   2. Cast (cooldown out, the target in sight within castRange): ONE enemyCooldown draw for the next cast (spent
 *      whatever the strike does), then ctx.telegraph(castTicks, STORMCALLER_ATTACK_CAST). The row is fixed at cast
 *      start: centre v[STORMCALLER_CENTRE_X / Z] = the target's position, offset v[STORMCALLER_OFFSET_X / Z] = the
 *      caster -> target bearing turned 90 degrees ((-dirZ, dirX), exact, no trig) x strikeSpacing. The `strikeRow` hint
 *      draws strikeCount circles of strikeRadius there, filling over the cast. It stands still facing its target.
 *   3. Strike (the cast's last tick): one `strike` bullet (BulletKind.STRIKE: speed 0, hit radius STRIKE_BULLET_RADIUS)
 *      per point i, centre + (i - (count - 1) / 2) x offset, in i order. A point whose cell is not floor (a wall / void
 *      cell, ctx.isBlocked, or an intact breakable, solidCells) is skipped: no bullet, no draw. No line-of-sight check
 *      at the strike: it lands where the ring is. Then back to keeping range.
 *
 * STRIKE rules (combat.ts, melee.ts): no grazes, ignores breakables, never erased by any sweep (ordinary swings, the
 * guard (NED7), Nova), no Phantom Step erase (the roller's i-frames avoid it anyway), counts in events.strikes (not the
 * enemy-shoot cue). A strike hurts like any bullet: consumed by the first hit that lands (one player at most), roll
 * i-frames pass through it. It holds for strikeLifeTicks collision passes: the count rides in the payload's `pierce`
 * field (unused on enemy bullets) and the last pass consumes it, so the Hourglass slow (which stretches every enemy
 * bullet's float life) never stretches a strike; `strike.life` (the same 6 ticks) is only the pool's backstop.
 *
 * Draws: init 1 (the first cast's cooldown, enemyCooldown); each cast 1 (the next cooldown). No point is placed by a
 * draw, so the draw count never depends on the layout.
 *
 * View contract: states STORMCALLER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the cast); attack id
 * STORMCALLER_ATTACK_CAST; v slots STORMCALLER_CENTRE_X / _Z (the row's centre), STORMCALLER_OFFSET_X / _Z (from one
 * circle to the next), STORMCALLER_STRAFE (+1 / -1). The strike tick is the one whose events.strikes > 0.
 *
 * @module
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { SIM_DT } from "../../../units";
import { solidCells } from "../../../breakables/cells";
import { cellKey, worldToGrid } from "shared/dungeon";
import { STRIKE_BULLET_RADIUS } from "../../combatData";
import { BulletKind, type BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { enemyCooldown, walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer, walkToward } from "../helpers";
import { PORT_BAND_ENEMIES_2, registerArchetype } from "../registry";
import { AiState, type ActorState } from "../types";
import {
	STATE_ENGAGED,
	STEER,
	alertOnDeath,
	engageOnHit,
	initRoomEnemy,
	leash,
	shouldLeash,
	stepCalm,
	type RoomEnemyData,
} from "./enemyShared";

export interface StormcallerData extends RoomEnemyData {
	/** Preferred distance band to its target (world units). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Only starts a cast when its target is this close (and in sight). */
	readonly castRange: number;
	/** Weight of the sideways component of the move (radial is 1). */
	readonly strafeWeight: number;
	/** Ticks between casts (random in [min, max], `enemyCooldown`), and before the first one. */
	readonly castCooldownMin: number;
	readonly castCooldownMax: number;
	/** Cast telegraph ticks (the circles fill over it). */
	readonly castTicks: number;
	/** Strike points per cast, their circle radius and spacing (world units). */
	readonly strikeCount: number;
	readonly strikeRadius: number;
	readonly strikeSpacing: number;
	/** A strike bullet's hold in collision passes (ticks; `strike.pierce` carries it, `strike.life` is the same). */
	readonly strikeLifeTicks: number;
	/** One strike: a stationary STRIKE bullet. */
	readonly strike: BurstSpec;
}

// --- States and attack ids
/** Keeping range. */
export const STORMCALLER_KEEP = STATE_ENGAGED;
/** ActorState.attack while casting. */
export const STORMCALLER_ATTACK_CAST = 1;

// --- v[] slots (0..2 shared)
/** The strike row's centre (the target's position at cast start). */
export const STORMCALLER_CENTRE_X = 3;
export const STORMCALLER_CENTRE_Z = 4;
/** From one strike circle to the next (strikeSpacing long, perpendicular to caster -> target). */
export const STORMCALLER_OFFSET_X = 5;
export const STORMCALLER_OFFSET_Z = 6;
/** Strafe side, +1 or -1. */
export const STORMCALLER_STRAFE = 7;

const CAST_SECONDS = 1;
const STRIKE_COUNT = 3;
/** Strike hold (ticks). At most the payload's pierce field maximum (7): it rides there. */
export const STORMCALLER_STRIKE_TICKS = 6;
/** A move shorter than this fraction of the step means a wall: flip the strafe side. */
const STRAFE_BLOCKED = 0.3;

export const STORMCALLER = registerArchetype<StormcallerData>({
	id: "stormcaller",
	band: PORT_BAND_ENEMIES_2,
	data: {
		hp: 5,
		radius: 0.35,
		speed: 2.4,
		contactDamage: 0,
		spriteId: "enemy.stormcaller",
		roomEnemy: true,
		aggroRange: 11,
		leashRange: 16,
		lostTicks: secondsToTicks(2.5),
		alertRange: 4.5,
		keepMin: 7,
		keepMax: 10,
		castRange: 12,
		strafeWeight: 0.8,
		castCooldownMin: secondsToTicks(3.6),
		castCooldownMax: secondsToTicks(4.4),
		castTicks: secondsToTicks(CAST_SECONDS), // 60
		strikeCount: STRIKE_COUNT,
		strikeRadius: STRIKE_BULLET_RADIUS,
		strikeSpacing: 2.2,
		strikeLifeTicks: STORMCALLER_STRIKE_TICKS,
		strike: {
			count: 1,
			spread: 0,
			speed: 0,
			life: STORMCALLER_STRIKE_TICKS * SIM_DT,
			damage: HIT_NORMAL,
			kind: BulletKind.STRIKE,
			pierce: STORMCALLER_STRIKE_TICKS,
		},
		fx: {
			strikeRow: {
				state: AiState.TELEGRAPH,
				centreX: STORMCALLER_CENTRE_X,
				centreZ: STORMCALLER_CENTRE_Z,
				offsetX: STORMCALLER_OFFSET_X,
				offsetZ: STORMCALLER_OFFSET_Z,
				count: STRIKE_COUNT,
				radius: STRIKE_BULLET_RADIUS,
				fillTicks: secondsToTicks(CAST_SECONDS),
				attack: STORMCALLER_ATTACK_CAST,
			},
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		const d = ctx.data<StormcallerData>(a);
		// No draw for the side: alternate by actor id (the imp's rule). One draw: the first cast's cooldown.
		a.v[STORMCALLER_STRAFE] = a.id % 2 === 0 ? 1 : -1;
		a.cooldown = enemyCooldown(ctx, a, d.castCooldownMin, d.castCooldownMax);
	},
	step(ctx, a) {
		const d = ctx.data<StormcallerData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		if (a.aiState === AiState.TELEGRAPH) casting(ctx, a, d);
		else keepRange(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a); // a strike already on the floor holds its ticks
	},
});

/**
 * True when a strike point at world (x, z) stands on a floor cell: not a wall / void cell (ctx.isBlocked) and not an
 * intact breakable's cell (solidCells).
 */
export function stormcallerPointOpen(ctx: SimCtx, x: number, z: number): boolean {
	if (ctx.isBlocked(x, z)) return false;
	const solid = solidCells(ctx.state);
	return solid === undefined || !solid.has(cellKey(worldToGrid(x), worldToGrid(z)));
}

/** Starts a cast: ONE cooldown draw, the row fixed from the target's position and bearing, then the telegraph. */
function startCast(ctx: SimCtx, a: ActorState, d: StormcallerData, dirX: number, dirZ: number): void {
	const p = ctx.player;
	a.cooldown = enemyCooldown(ctx, a, d.castCooldownMin, d.castCooldownMax);
	a.v[STORMCALLER_CENTRE_X] = p.x;
	a.v[STORMCALLER_CENTRE_Z] = p.z;
	// The bearing turned 90 degrees: (-dirZ, dirX), exact.
	a.v[STORMCALLER_OFFSET_X] = -dirZ * d.strikeSpacing;
	a.v[STORMCALLER_OFFSET_Z] = dirX * d.strikeSpacing;
	faceToward(a, dirX, dirZ);
	ctx.telegraph(a, d.castTicks, STORMCALLER_ATTACK_CAST);
}

function casting(ctx: SimCtx, a: ActorState, d: StormcallerData): void {
	const tp = toPlayer(ctx, a);
	faceToward(a, tp.dirX, tp.dirZ);
	a.aiTicks -= 1;
	if (a.aiTicks > 0) return;
	const cx = a.v[STORMCALLER_CENTRE_X];
	const cz = a.v[STORMCALLER_CENTRE_Z];
	const ox = a.v[STORMCALLER_OFFSET_X];
	const oz = a.v[STORMCALLER_OFFSET_Z];
	const mid = (d.strikeCount - 1) / 2;
	for (let i = 0; i < d.strikeCount; i++) {
		const k = i - mid;
		const x = cx + ox * k;
		const z = cz + oz * k;
		if (stormcallerPointOpen(ctx, x, z)) ctx.fireEnemy(a, 0, 1, d.strike, x, z);
	}
	a.aiState = STORMCALLER_KEEP;
	a.aiTicks = 0;
	a.attack = 0;
	a.v[STORMCALLER_STRAFE] = -a.v[STORMCALLER_STRAFE];
}

/** Keeping range (the imp's reposition): approach / back off / strafe; casts when the cooldown is out. */
function keepRange(ctx: SimCtx, a: ActorState, d: StormcallerData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (los) {
		a.aiTicks = 0;
	} else {
		a.aiTicks += 1;
		if (a.aiTicks > d.lostTicks) {
			leash(a);
			return;
		}
	}
	if (a.cooldown > 0) a.cooldown--;
	if (los && a.cooldown <= 0 && dist <= d.castRange) {
		startCast(ctx, a, d, dirX, dirZ);
		return;
	}
	const stepLen = walkStep(ctx, a);
	if (!los) {
		// Lost sight: walk toward the target to find a line again (walls slide it around corners).
		walkToward(ctx, a, p.x, p.z, stepLen, STEER);
		return;
	}
	faceToward(a, dirX, dirZ);
	const radial = dist < d.keepMin ? -1 : dist > d.keepMax ? 1 : 0;
	const side = a.v[STORMCALLER_STRAFE] * d.strafeWeight;
	// Perpendicular to the target direction: (-dirZ, dirX).
	let mx = dirX * radial - dirZ * side;
	let mz = dirZ * radial + dirX * side;
	const m2 = mx * mx + mz * mz;
	if (m2 > 1e-12) {
		const k = stepLen / math.sqrt(m2);
		mx *= k;
		mz *= k;
		const x0 = a.x;
		const z0 = a.z;
		moveActor(ctx, a, mx, mz);
		const ox = a.x - x0;
		const oz = a.z - z0;
		if (ox * ox + oz * oz < stepLen * stepLen * STRAFE_BLOCKED * STRAFE_BLOCKED) {
			a.v[STORMCALLER_STRAFE] = -a.v[STORMCALLER_STRAFE];
		}
	}
}
