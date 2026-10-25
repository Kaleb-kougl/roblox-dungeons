/**
 * 'sniper' (E1.8, GDD "Sniper: telegraphed long-range lines"; source: `src/sim/actors/archetypes/sniper.ts`): keeps
 * the player at mid range (backs off when they come close, closes in when they are far, strafes in between and flips
 * direction when a wall stops it), and every ~2 s telegraphs 0.6 s along its aim line (aim follows the player for the
 * first 0.35 s, then locks for the last 0.25 s; the direction and the line's length up to the first wall are in v[] for
 * the renderer's warning line), then fires a fast narrow 3-shot line down the locked aim: three single bullets on one
 * direction at different speeds, so the line stretches as it flies. It never fires without line of sight at the moment
 * of the shot (the volley is cancelled). No contact damage. Leashes home after losing the player.
 */

import { SIM_DT } from "../../../units";
import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { BulletKind, type BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { faceToward, moveActor, toPlayer, walkToward } from "../helpers";
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

export interface SniperData extends RoomEnemyData {
	/** Preferred distance band to the player (world units). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Only starts a volley when the player is this close. */
	readonly fireRange: number;
	/** Telegraph ticks, and the last ticks of it during which the aim is locked. */
	readonly telegraphTicks: number;
	readonly lockTicks: number;
	/** The three shots (same direction, different speeds). */
	readonly shots: ReadonlyArray<BurstSpec>;
	/** Ticks between volleys (random in [min, max]) and before the first one after engaging. */
	readonly volleyCooldownMin: number;
	readonly volleyCooldownMax: number;
	readonly firstVolleyMin: number;
	readonly firstVolleyMax: number;
	/** Strafe direction flips after a random [min, max] ticks (or when a wall stops it). */
	readonly strafeFlipMin: number;
	readonly strafeFlipMax: number;
	/** Weight of the sideways component of the move (radial is 1). */
	readonly strafeWeight: number;
	/** Longest warning line drawn (world units; walls cut it shorter). */
	readonly aimMaxLength: number;
}

// --- States and attack ids
/** Keeping range: approach / back off / strafe, count down to the next volley. */
export const SNIPER_REPOSITION = STATE_ENGAGED;
/** ActorState.attack while telegraphing the line. */
export const SNIPER_ATTACK_LINE = 1;

// --- v[] slots (0..2 shared)
export const SNIPER_LOST = 3;
/** Aim direction (unit) and warning line length (world units, to the first wall), valid while telegraphing. */
export const SNIPER_AIM_X = 4;
export const SNIPER_AIM_Z = 5;
export const SNIPER_AIM_LEN = 6;
/** Strafe side, +1 or -1. */
export const SNIPER_STRAFE = 7;

const TELEGRAPH_SECONDS = 0.6;
const LOCK_SECONDS = 0.25;
const SHOT_LIFE = 1.3;
const SHOT_RADIUS = 0.4;
/** The fastest shot's speed (the warning line covers its range). */
const FAST_SHOT_SPEED = 12;
const shot = (speed: number): BurstSpec => ({
	count: 1,
	spread: 0,
	speed,
	life: SHOT_LIFE,
	damage: HIT_NORMAL,
	kind: BulletKind.SNIPER,
	radius: SHOT_RADIUS,
});
/** Ray-march step for the warning line length. */
const AIM_MARCH = 0.25;
/** A move shorter than this fraction of the step means a wall: flip the strafe side. */
const STRAFE_BLOCKED = 0.3;
/** Coin flip for the first strafe side. */
const COIN = 0.5;

export const SNIPER = registerArchetype<SniperData>({
	id: "sniper",
	data: {
		hp: 4,
		radius: 0.35,
		speed: 2.6,
		contactDamage: 0,
		spriteId: "enemy.sniper",
		roomEnemy: true,
		aggroRange: 10,
		leashRange: 15,
		lostTicks: secondsToTicks(2.5),
		alertRange: 4.5,
		keepMin: 5,
		keepMax: 8,
		fireRange: 11,
		telegraphTicks: secondsToTicks(TELEGRAPH_SECONDS), // 36
		lockTicks: secondsToTicks(LOCK_SECONDS), // 15
		shots: [shot(FAST_SHOT_SPEED), shot(10.5), shot(9)],
		volleyCooldownMin: secondsToTicks(1.6),
		volleyCooldownMax: secondsToTicks(2.4),
		firstVolleyMin: secondsToTicks(0.6),
		firstVolleyMax: secondsToTicks(1.2),
		strafeFlipMin: secondsToTicks(0.8),
		strafeFlipMax: secondsToTicks(2.2),
		strafeWeight: 0.8,
		aimMaxLength: FAST_SHOT_SPEED * SHOT_LIFE,
		fx: {
			aimLine: {
				dirX: SNIPER_AIM_X,
				dirZ: SNIPER_AIM_Z,
				lenSlot: SNIPER_AIM_LEN,
				boldTicks: secondsToTicks(LOCK_SECONDS),
			},
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		const d = ctx.data<SniperData>(a);
		a.v[SNIPER_STRAFE] = ctx.random() < COIN ? -1 : 1;
		a.cooldown = ctx.randomInt(d.firstVolleyMin, d.firstVolleyMax);
	},
	step(ctx, a) {
		const d = ctx.data<SniperData>(a);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		if (a.aiState === AiState.TELEGRAPH) telegraphing(ctx, a, d);
		else reposition(ctx, a, d);
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a);
	},
});

/** Sets the aim to the player's direction and measures the warning line to the first wall. */
function aimAtPlayer(ctx: SimCtx, a: ActorState, d: SniperData, dirX: number, dirZ: number): void {
	a.v[SNIPER_AIM_X] = dirX;
	a.v[SNIPER_AIM_Z] = dirZ;
	faceToward(a, dirX, dirZ);
	let len = AIM_MARCH;
	while (len < d.aimMaxLength && !ctx.isBlocked(a.x + dirX * len, a.z + dirZ * len)) len += AIM_MARCH;
	a.v[SNIPER_AIM_LEN] = len < d.aimMaxLength ? len : d.aimMaxLength;
}

function telegraphing(ctx: SimCtx, a: ActorState, d: SniperData): void {
	const p = ctx.player;
	a.aiTicks--;
	if (a.aiTicks >= d.lockTicks) {
		// Tracking: follow the player while it can see them (the line swings with them), then lock.
		const tp = toPlayer(ctx, a);
		if (ctx.lineOfSight(a.x, a.z, p.x, p.z)) aimAtPlayer(ctx, a, d, tp.dirX, tp.dirZ);
	}
	if (a.aiTicks > 0) return;
	// Fire down the locked aim, but only with line of sight to the player right now.
	if (p.dead === 0 && ctx.lineOfSight(a.x, a.z, p.x, p.z)) {
		const shots = d.shots;
		for (let i = 0; i < shots.size(); i++) ctx.fireEnemy(a, a.v[SNIPER_AIM_X], a.v[SNIPER_AIM_Z], shots[i]);
		a.cooldown = ctx.randomInt(d.volleyCooldownMin, d.volleyCooldownMax);
	} else {
		a.cooldown = ctx.randomInt(d.firstVolleyMin, d.firstVolleyMax); // cancelled: try again soon
	}
	a.aiState = SNIPER_REPOSITION;
	a.aiTicks = ctx.randomInt(d.strafeFlipMin, d.strafeFlipMax);
	a.attack = 0;
}

function reposition(ctx: SimCtx, a: ActorState, d: SniperData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (los) {
		a.v[SNIPER_LOST] = 0;
	} else {
		a.v[SNIPER_LOST] += 1;
		if (a.v[SNIPER_LOST] > d.lostTicks) {
			leash(a);
			return;
		}
	}
	if (a.cooldown > 0) a.cooldown--;
	if (los && a.cooldown <= 0 && dist <= d.fireRange) {
		aimAtPlayer(ctx, a, d, dirX, dirZ);
		ctx.telegraph(a, d.telegraphTicks, SNIPER_ATTACK_LINE);
		return;
	}
	const stepLen = d.speed * SIM_DT;
	if (!los) {
		// Lost sight: walk toward the player to find a line again (walls slide it around corners).
		walkToward(ctx, a, p.x, p.z, stepLen, STEER);
		return;
	}
	faceToward(a, dirX, dirZ);
	const radial = dist < d.keepMin ? -1 : dist > d.keepMax ? 1 : 0;
	const side = a.v[SNIPER_STRAFE] * d.strafeWeight;
	// Perpendicular to the player direction: (-dirZ, dirX).
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
			a.v[SNIPER_STRAFE] = -a.v[SNIPER_STRAFE];
		}
	}
	a.aiTicks -= 1;
	if (a.aiTicks <= 0) {
		a.v[SNIPER_STRAFE] = -a.v[SNIPER_STRAFE];
		a.aiTicks = ctx.randomInt(d.strafeFlipMin, d.strafeFlipMax);
	}
}
