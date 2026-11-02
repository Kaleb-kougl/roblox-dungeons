/**
 * 'charger' (Roblox port, docs/NEW_ENEMIES.md; no web source): a blade-armed beast that charges down a lane and
 * staggers when it hits a wall. 12 hp, contact damage 0 (its heavy hit lands only while charging, its own overlap
 * check through `ctx.hurtPlayerAt`). Engaged, it keeps keepMin-keepMax from its target (the sniper's approach / back
 * off).
 *
 * Planned (NE3, not built yet): every chargeCooldownMin-Max (`enemyCooldown`) it telegraphs the lane for laneTicks
 * (attack CHARGER_ATTACK_LANE; the `aimLine` hint, chargeRange long, heading locked at the telegraph's start, NED6),
 * then charges at chargeSpeed for up to chargeRange units: the first overlap with each player hurts chargeDamage once
 * (CHARGER_HIT_BITS), it breaks the pieces it passes (`slamBreakables` with chargeBreakRadius). Blocked before the end
 * (wall, pillar, room bound) -> CHARGER_STUN for stunTicks; else CHARGER_RECOVER for recoverTicks.
 *
 * NE1 skeleton: the data block and a minimal step (calm / leash / engage, then keep range straight along the target's
 * bearing); no lane, no charge, no draws.
 *
 * View contract: states CHARGER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the lane) / CHARGER_CHARGE / CHARGER_STUN /
 * CHARGER_RECOVER; attack id CHARGER_ATTACK_LANE; v slots CHARGER_DIR_X / _Z (locked heading), CHARGER_LEFT (charge
 * distance left), CHARGER_HIT_BITS (players already hit this charge, one bit per party index).
 */

import { HIT_HEAVY, secondsToTicks } from "../../../playerData";
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

export interface ChargerData extends RoomEnemyData {
	/** Preferred distance band to its target (world units; it wants line of sight). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Ticks between charges (random in [min, max], `enemyCooldown`). */
	readonly chargeCooldownMin: number;
	readonly chargeCooldownMax: number;
	/** Lane telegraph ticks (the heading locks at its start). */
	readonly laneTicks: number;
	/** Charge speed (world units / s) and longest charge (world units). */
	readonly chargeSpeed: number;
	readonly chargeRange: number;
	/** Half hearts of the charge's hit (once per player per charge). */
	readonly chargeDamage: number;
	/** Pieces whose cell centre is within this of its centre break as it passes. */
	readonly chargeBreakRadius: number;
	/** Staggered after a blocked charge (the punish window), and the short recover after a clear one. */
	readonly stunTicks: number;
	readonly recoverTicks: number;
}

// --- States and attack ids
/** Keeping range. */
export const CHARGER_KEEP = STATE_ENGAGED;
/** Charging along v[CHARGER_DIR_*]. */
export const CHARGER_CHARGE = AiState.CUSTOM + 1;
/** Staggered after a blocked charge. */
export const CHARGER_STUN = AiState.CUSTOM + 2;
/** Standing after a charge that ran its full range. */
export const CHARGER_RECOVER = AiState.CUSTOM + 3;
/** ActorState.attack while telegraphing the lane. */
export const CHARGER_ATTACK_LANE = 1;

// --- v[] slots (0..2 shared)
/** Locked charge heading (unit). */
export const CHARGER_DIR_X = 3;
export const CHARGER_DIR_Z = 4;
/** Charge distance left (world units). */
export const CHARGER_LEFT = 5;
/** Players already hit by this charge (bit k = party index k). */
export const CHARGER_HIT_BITS = 6;

const LANE_SECONDS = 0.75;
const CHARGE_RANGE = 9;

export const CHARGER = registerArchetype<ChargerData>({
	id: "charger",
	band: PORT_BAND_ENEMIES_2,
	data: {
		hp: 12,
		radius: 0.5,
		speed: 2.2,
		contactDamage: 0,
		spriteId: "enemy.charger",
		roomEnemy: true,
		aggroRange: 10,
		leashRange: 15,
		lostTicks: secondsToTicks(2.5),
		alertRange: 4.5,
		keepMin: 5,
		keepMax: 9,
		chargeCooldownMin: secondsToTicks(3),
		chargeCooldownMax: secondsToTicks(4),
		laneTicks: secondsToTicks(LANE_SECONDS), // 45
		chargeSpeed: 11,
		chargeRange: CHARGE_RANGE,
		chargeDamage: HIT_HEAVY,
		chargeBreakRadius: 1,
		stunTicks: secondsToTicks(1.4), // 84
		recoverTicks: secondsToTicks(0.6), // 36
		fx: {
			aimLine: {
				dirX: CHARGER_DIR_X,
				dirZ: CHARGER_DIR_Z,
				length: CHARGE_RANGE,
				boldTicks: secondsToTicks(LANE_SECONDS), // locked from the start: bold throughout
				attack: CHARGER_ATTACK_LANE,
			},
		},
	},
	init(_ctx, a) {
		initRoomEnemy(a);
	},
	step(ctx, a) {
		const d = ctx.data<ChargerData>(a);
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
function keepRange(ctx: SimCtx, a: ActorState, d: ChargerData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	const radial = tp.dist < d.keepMin ? -1 : tp.dist > d.keepMax ? 1 : 0;
	if (radial === 0) return;
	const stepLen = walkStep(ctx, a) * radial;
	moveActor(ctx, a, dirX * stepLen, dirZ * stepLen, STEER);
}
