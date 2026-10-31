/**
 * 'bruiser' (E1.8, GDD "Bruiser: tanky melee with shockwaves"; source: `src/sim/actors/archetypes/bruiser.ts`): a slow
 * 10 hp walker. Engaged, it plods at the player; close enough (or after kiting it for 3 s at mid range) it plants,
 * telegraphs 0.7 s (tint) and slams: an expanding ring of slow bullets from its feet with ONE gap (GDD: patterns leave a
 * safe gap) near the player's bearing, plus a flat shockwave on the floor (render hint). Its body deals a heavy hit
 * (HIT_HEAVY = a full heart). After a slam it stands still for a moment (punish window). Leashes home after losing the
 * player.
 *
 * The ring: RING_SLOTS evenly spaced slots (18 degrees apart) with RING_GAP_SLOTS of them left out, fired as one arc
 * centred opposite the gap. Between the two bullets flanking the gap there are (RING_GAP_SLOTS + 1) slots = 72
 * degrees, wide enough for the player (0.35 radius) + bullet hitbox (0.12) from ~0.8 units out; elsewhere bullets are
 * 18 degrees apart, too tight to slip through until ~3 units out. The gap is the player's bearing turned by a random
 * ~37 or ~53 degrees either way (Pythagorean rotations, no trig), so a short sidestep (or running away from the slow
 * ring, or rolling through it) answers it.
 */

import { HIT_HEAVY, HIT_NORMAL, PLAYER_RADIUS, secondsToTicks } from "../../../playerData";
import { BulletKind, rotateDir, type BurstSpec, type Dir } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { enemyCooldown, enemyCooldownFixed, walkStep } from "../actorMods";
import { faceToward, toPlayer, walkToward } from "../helpers";
import { registerArchetype } from "../registry";
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

export interface BruiserData extends RoomEnemyData {
	/** Slams when the player is this close (center to center). */
	readonly slamTrigger: number;
	/** Kited this long past its cooldown (ticks) with the player within frustrationRange in sight: slams anyway. */
	readonly frustrationTicks: number;
	readonly frustrationRange: number;
	readonly telegraphTicks: number;
	/** Standing still after a slam. */
	readonly recoverTicks: number;
	/** Ticks between slams (random in [min, max]) and before the first one after engaging. */
	readonly slamCooldownMin: number;
	readonly slamCooldownMax: number;
	readonly firstSlam: number;
	/** The ring (an arc of RING_SLOTS - RING_GAP_SLOTS bullets, centred opposite the gap). */
	readonly ring: BurstSpec;
}

/** Ring slots around the circle, and how many of them the gap leaves out. */
export const RING_SLOTS = 20;
export const RING_GAP_SLOTS = 3;
/** Angle between the two bullets flanking the gap, radians (render: half of it either side of the gap direction). */
export const RING_GAP_ANGLE = ((RING_GAP_SLOTS + 1) * 2 * math.pi) / RING_SLOTS;

// --- States and attack ids
export const BRUISER_CHASE = STATE_ENGAGED;
/** After the slam: standing still for recoverTicks (aiTicks counts down; the shockwave hint reads it). */
export const BRUISER_RECOVER = AiState.CUSTOM + 1;
export const BRUISER_ATTACK_SLAM = 1;

// --- v[] slots (0..2 shared)
export const BRUISER_LOST = 3;
/** Direction of the last ring's gap (unit). */
export const BRUISER_GAP_X = 4;
export const BRUISER_GAP_Z = 5;

const RECOVER_SECONDS = 0.6;
/** Stops walking this far inside contact range (it means to touch, not to stand on the player). */
const STOP_INSIDE_CONTACT = 0.05;
/** Shockwave hint (render): radius at the start, expansion speed, ticks shown. */
const SHOCK_RADIUS = 0.55;
const SHOCK_SPEED = 9;
const SHOCK_SHOW_TICKS = 16;

/**
 * Gap offsets from the player's bearing, as (cos, sin) rotations: about +-36.9 and +-53.1 degrees. Exported for the
 * summoner's panic ring (docs/ENEMY_VARIANTS.md EV4), which turns its gap the same way.
 */
export const GAP_TURNS: ReadonlyArray<readonly [number, number]> = [
	[4 / 5, 3 / 5],
	[4 / 5, -3 / 5],
	[3 / 5, 4 / 5],
	[3 / 5, -4 / 5],
];
const gapScratch: Dir = { x: 0, z: 1 };

export const BRUISER = registerArchetype<BruiserData>({
	id: "bruiser",
	data: {
		hp: 10,
		radius: 0.5,
		speed: 2,
		contactDamage: HIT_HEAVY,
		spriteId: "enemy.bruiser",
		spriteScale: 1.35,
		roomEnemy: true,
		aggroRange: 8,
		leashRange: 14,
		lostTicks: secondsToTicks(3),
		alertRange: 4.5,
		slamTrigger: 2.6,
		frustrationTicks: secondsToTicks(3),
		frustrationRange: 6.5,
		telegraphTicks: secondsToTicks(0.7), // 42
		recoverTicks: secondsToTicks(RECOVER_SECONDS),
		slamCooldownMin: secondsToTicks(1.4),
		slamCooldownMax: secondsToTicks(2),
		firstSlam: secondsToTicks(0.5),
		ring: {
			count: RING_SLOTS - RING_GAP_SLOTS,
			spread: ((RING_SLOTS - RING_GAP_SLOTS - 1) * 2 * math.pi) / RING_SLOTS,
			speed: 2.6,
			life: 2.6,
			damage: HIT_NORMAL,
			kind: BulletKind.ENEMY,
			radius: SHOCK_RADIUS,
		},
		fx: {
			shockwave: {
				state: BRUISER_RECOVER,
				startTicks: secondsToTicks(RECOVER_SECONDS),
				showTicks: SHOCK_SHOW_TICKS,
				radius: SHOCK_RADIUS,
				speed: SHOCK_SPEED,
				gapX: BRUISER_GAP_X,
				gapZ: BRUISER_GAP_Z,
				gapHalfAngle: RING_GAP_ANGLE / 2,
			},
		},
	},
	init(_ctx, a) {
		initRoomEnemy(a);
		a.v[BRUISER_GAP_Z] = 1;
	},
	step(ctx, a) {
		const d = ctx.data<BruiserData>(a);
		if (stepCalm(ctx, a)) {
			a.cooldown = enemyCooldownFixed(ctx, a, d.firstSlam);
			return;
		}
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		switch (a.aiState) {
			case AiState.TELEGRAPH: {
				const tp = toPlayer(ctx, a);
				faceToward(a, tp.dx, tp.dz);
				a.aiTicks -= 1;
				if (a.aiTicks <= 0) slam(ctx, a, d, tp.dirX, tp.dirZ);
				return;
			}
			case BRUISER_RECOVER:
				a.aiTicks -= 1;
				if (a.aiTicks <= 0) {
					a.aiState = BRUISER_CHASE;
					a.attack = 0;
				}
				return;
			default:
				chase(ctx, a, d);
		}
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a); // its ring keeps flying: the player already had to read it
	},
});

function chase(ctx: SimCtx, a: ActorState, d: BruiserData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (los) {
		a.v[BRUISER_LOST] = 0;
	} else {
		a.v[BRUISER_LOST] += 1;
		if (a.v[BRUISER_LOST] > d.lostTicks) {
			leash(a);
			return;
		}
	}
	if (a.cooldown > -d.frustrationTicks) a.cooldown--;
	const ready = a.cooldown <= 0;
	const frustrated = a.cooldown <= -d.frustrationTicks && dist <= d.frustrationRange;
	if (los && ready && (dist <= d.slamTrigger || frustrated)) {
		faceToward(a, tp.dx, tp.dz);
		ctx.telegraph(a, d.telegraphTicks, BRUISER_ATTACK_SLAM);
		return;
	}
	const contact = a.radius + PLAYER_RADIUS - STOP_INSIDE_CONTACT;
	if (dist > contact) {
		const walk = walkStep(ctx, a);
		const left = dist - contact;
		walkToward(ctx, a, p.x, p.z, walk < left ? walk : left, STEER);
	} else faceToward(a, tp.dx, tp.dz);
}

/** Fires the ring with its gap near the player's bearing (dirX, dirZ) and starts the recovery. */
function slam(ctx: SimCtx, a: ActorState, d: BruiserData, dirX: number, dirZ: number): void {
	const turn = GAP_TURNS[ctx.randomInt(0, GAP_TURNS.size() - 1)];
	rotateDir(dirX, dirZ, turn[0], turn[1], gapScratch);
	a.v[BRUISER_GAP_X] = gapScratch.x;
	a.v[BRUISER_GAP_Z] = gapScratch.z;
	ctx.fireEnemy(a, -gapScratch.x, -gapScratch.z, d.ring);
	a.aiState = BRUISER_RECOVER;
	a.aiTicks = d.recoverTicks;
	a.cooldown = enemyCooldown(ctx, a, d.slamCooldownMin, d.slamCooldownMax);
}
