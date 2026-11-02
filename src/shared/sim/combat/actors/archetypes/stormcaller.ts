/**
 * 'stormcaller' (Roblox port, docs/NEW_ENEMIES.md; no web source): a robed caster at the back of the room that marks
 * three circles on the floor and calls lightning on them. 5 hp, no contact damage. Engaged, it keeps keepMin-keepMax
 * from its target, strafing, preferring line of sight.
 *
 * Planned (NE5, not built yet): every castCooldownMin-Max (`enemyCooldown`) it casts for castTicks (attack
 * STORMCALLER_ATTACK_CAST; the `strikeRow` hint: strikeCount circles of strikeRadius centred on the target's position
 * at cast start, strikeSpacing apart along the caster -> target line turned 90 degrees, stored as one centre and one
 * offset in v[]), then strikes: one `strike` bullet (BulletKind.STRIKE, speed 0, strikeLifeTicks, hit radius
 * STRIKE_BULLET_RADIUS) per point; a point on a wall / void / breakable cell is skipped.
 *
 * NE1 skeleton: the data block and a minimal step (calm / leash / engage, then keep range straight along the target's
 * bearing); no cast, no strike, no strafe, no draws.
 *
 * View contract: states STORMCALLER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the cast); attack id
 * STORMCALLER_ATTACK_CAST; v slots STORMCALLER_CENTRE_X / _Z (the row's centre), STORMCALLER_OFFSET_X / _Z (from one
 * circle to the next), STORMCALLER_STRAFE (+1 / -1).
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { SIM_DT } from "../../../units";
import { STRIKE_BULLET_RADIUS } from "../../combatData";
import { BulletKind, type BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer } from "../helpers";
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
	/** Strafe direction flips after a random [min, max] ticks (or when a wall stops it). */
	readonly strafeFlipMin: number;
	readonly strafeFlipMax: number;
	/** Weight of the sideways component of the move (radial is 1). */
	readonly strafeWeight: number;
	/** Ticks between casts (random in [min, max], `enemyCooldown`). */
	readonly castCooldownMin: number;
	readonly castCooldownMax: number;
	/** Cast telegraph ticks (the circles fill over it). */
	readonly castTicks: number;
	/** Strike points per cast, their circle radius and spacing (world units). */
	readonly strikeCount: number;
	readonly strikeRadius: number;
	readonly strikeSpacing: number;
	/** A strike bullet's life in ticks (it is `strike.life` seconds). */
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
const STRIKE_LIFE_TICKS = 6;

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
		strafeFlipMin: secondsToTicks(0.8),
		strafeFlipMax: secondsToTicks(2.2),
		strafeWeight: 0.8,
		castCooldownMin: secondsToTicks(3.6),
		castCooldownMax: secondsToTicks(4.4),
		castTicks: secondsToTicks(CAST_SECONDS), // 60
		strikeCount: STRIKE_COUNT,
		strikeRadius: STRIKE_BULLET_RADIUS,
		strikeSpacing: 2.2,
		strikeLifeTicks: STRIKE_LIFE_TICKS,
		strike: {
			count: 1,
			spread: 0,
			speed: 0,
			life: STRIKE_LIFE_TICKS * SIM_DT,
			damage: HIT_NORMAL,
			kind: BulletKind.STRIKE,
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
	init(_ctx, a) {
		initRoomEnemy(a);
		a.v[STORMCALLER_STRAFE] = 1;
	},
	step(ctx, a) {
		const d = ctx.data<StormcallerData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		keepRange(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});

/** NE1 skeleton: backs off inside keepMin, closes in past keepMax, else stands facing its target (no strafe, no draw). */
function keepRange(ctx: SimCtx, a: ActorState, d: StormcallerData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	const radial = tp.dist < d.keepMin ? -1 : tp.dist > d.keepMax ? 1 : 0;
	if (radial === 0) return;
	const stepLen = walkStep(ctx, a) * radial;
	moveActor(ctx, a, dirX * stepLen, dirZ * stepLen, STEER);
}
