/**
 * 'jackal' (Roblox port, docs/NEW_ENEMIES_3.md "Design > Jackal"; no web source): a lanky beast that comes as a pack of
 * three (one buy, NTD6), circles its target and lunges at its back; facing it during the wind-up spooks it off, and a
 * sword guard into a lunge staggers it (a parry, NTD9). 3 hp, contact damage 0.
 *
 * NT1 skeleton: the data (the Design table as named fields, the v slots, the `aimLine` hint) and a stub step: idle /
 * walking home / leashing like every room enemy (enemyShared), and once engaged it only faces its target. No circling,
 * no lunge, no movement while engaged, no draw (init draws nothing yet). NT4 builds the behaviour:
 *
 *   Circling at circleMin-circleMax (the tangent from the actor id's parity, a pull into the band, a push off every
 *   other Jackal within separation, through walkStep and the steer mover); the lunge when its cooldown is out, no other
 *   Jackal on the same target (its nearest living player, NT0 finding 15) is winding up or lunging, and it stands
 *   outside the target's front cone (dot(face, toJackal) < frontCos): the wind-up (ctx.telegraph windupTicks, the heading
 *   locked); spooked when the facing turns onto it (dot >= spookCos): a hop back hopDistance over hopTicks, cooldown
 *   spookCooldownTicks, no draw; else the lunge (lungeDistance over lungeTicks, lungeDamage once per player through
 *   v[JACKAL_HIT_BITS], the Bulwark's bash rule), then recoverTicks; a guard up with the Jackal in its cone refuses the
 *   hit and staggers it staggerTicks (one parry-feed entry, NTD9, NT0 findings 8 / 9). NTD10: the last of a pack keeps
 *   the back-only rule.
 *
 * Draws (NT4): the first cooldown in init; one per lunge (the next cooldown). A spook draws nothing.
 *
 * View contract: states JACKAL_CIRCLE (= STATE_ENGAGED) / AiState.TELEGRAPH (the wind-up, crouched) / JACKAL_LUNGE /
 * JACKAL_RECOVER / JACKAL_HOP (spooked) / JACKAL_STAGGER; attack id JACKAL_ATTACK_LUNGE; v slots JACKAL_PHASE (ticks
 * left in a hop / recover / stagger), JACKAL_DIR_X / _Z (the lunge heading), JACKAL_HIT_BITS.
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { faceToward, toPlayer } from "../helpers";
import { PORT_BAND_ENEMIES_4, registerArchetype } from "../registry";
import {
	STATE_ENGAGED,
	alertOnDeath,
	engageOnHit,
	initRoomEnemy,
	leash,
	shouldLeash,
	stepCalm,
	type RoomEnemyData,
} from "./enemyShared";

export interface JackalData extends RoomEnemyData {
	/** The circling band around its target (world units). */
	readonly circleMin: number;
	readonly circleMax: number;
	/** Pushes away from every other Jackal within this (world units). */
	readonly separation: number;
	/** Lunges only from outside its target's front cone: dot(face, toJackal) < frontCos (a cosine literal). */
	readonly frontCos: number;
	/** Called off when, during the wind-up, the facing turns onto it: dot >= spookCos (a cosine literal). */
	readonly spookCos: number;
	/** The wind-up: the telegraph's ticks (crouched, the aim line along the locked heading). */
	readonly windupTicks: number;
	/** The lunge: lungeDistance world units over lungeTicks along the locked heading. */
	readonly lungeDistance: number;
	readonly lungeTicks: number;
	/** Half hearts the lunge deals, once per player. */
	readonly lungeDamage: number;
	/** Standing after a lunge (the punish window). */
	readonly recoverTicks: number;
	/** Spooked: a hop back hopDistance over hopTicks, then spookCooldownTicks to the next try. */
	readonly hopDistance: number;
	readonly hopTicks: number;
	readonly spookCooldownTicks: number;
	/** Staggered by a sword guard (NTD9): standing still, taking full damage. */
	readonly staggerTicks: number;
	/** Ticks between lunges (random in [min, max], `enemyCooldown`), and before the first one. */
	readonly lungeCooldownMin: number;
	readonly lungeCooldownMax: number;
}

// --- States and attack ids
/** Circling its target. */
export const JACKAL_CIRCLE = STATE_ENGAGED;
/** Lunging along v[JACKAL_DIR_X / _Z]. */
export const JACKAL_LUNGE = STATE_ENGAGED + 1;
/** Standing after a lunge. */
export const JACKAL_RECOVER = STATE_ENGAGED + 2;
/** Spooked: the hop back. */
export const JACKAL_HOP = STATE_ENGAGED + 3;
/** Staggered by a sword guard. */
export const JACKAL_STAGGER = STATE_ENGAGED + 4;
/** ActorState.attack while winding up / lunging. */
export const JACKAL_ATTACK_LUNGE = 1;

// --- v[] slots (0..2 shared)
/** Ticks left in the hop / recover / stagger. */
export const JACKAL_PHASE = 3;
/** The lunge heading (unit), locked when the wind-up starts. */
export const JACKAL_DIR_X = 4;
export const JACKAL_DIR_Z = 5;
/** Players this lunge already hurt (bit k: player k). */
export const JACKAL_HIT_BITS = 6;

const LUNGE_DISTANCE = 2.8;

export const JACKAL = registerArchetype<JackalData>({
	id: "jackal",
	band: PORT_BAND_ENEMIES_4,
	data: {
		hp: 3,
		radius: 0.32,
		speed: 4.6,
		contactDamage: 0,
		spriteId: "enemy.jackal",
		roomEnemy: true,
		aggroRange: 8,
		leashRange: 16,
		lostTicks: secondsToTicks(2),
		alertRange: 4.5,
		circleMin: 3,
		circleMax: 3.6,
		separation: 1.4,
		frontCos: 0.34,
		spookCos: 0.5,
		windupTicks: secondsToTicks(0.35), // 21
		lungeDistance: LUNGE_DISTANCE,
		lungeTicks: secondsToTicks(0.18), // 11
		lungeDamage: HIT_NORMAL,
		recoverTicks: secondsToTicks(0.5), // 30
		hopDistance: 1.2,
		hopTicks: secondsToTicks(0.2), // 12
		spookCooldownTicks: secondsToTicks(0.6), // 36
		staggerTicks: secondsToTicks(1), // 60
		lungeCooldownMin: secondsToTicks(1.4),
		lungeCooldownMax: secondsToTicks(2),
		fx: {
			aimLine: {
				dirX: JACKAL_DIR_X,
				dirZ: JACKAL_DIR_Z,
				length: LUNGE_DISTANCE,
				boldTicks: 8,
				attack: JACKAL_ATTACK_LUNGE,
			},
		},
	},
	init(_ctx, a) {
		initRoomEnemy(a);
	},
	step(ctx, a) {
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		// NT1 stub: engaged, it only faces its target (NT4: circling, lunge, spook, guard stop).
		const tp = toPlayer(ctx, a);
		faceToward(a, tp.dirX, tp.dirZ);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});
