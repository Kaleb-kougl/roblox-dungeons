/**
 * 'swarmer' (E1.8, GDD "Swarmer: fast, weak, rushes in packs"; source: `src/sim/actors/archetypes/swarmer.ts`): 2 hp
 * fodder placed in packs of 4-6. Idle until the player is in range and sight (or it is hit, or a packmate engages);
 * then it runs at the player, and from close range winds up for 0.4 s (telegraph tint + a short warning line along the
 * locked lunge direction) and lunges ~2.75 units in a straight line. Contact damage HIT_NORMAL. Packmates push each
 * other apart every tick (cheap pairwise separation in slot order, no allocation) so a pack reads as a pack, not one
 * sprite. Leashes home after losing the player.
 *
 * Telegraph choice: 0.4 s (GDD "telegraph everything" asks >= 0.5 s for real attacks; small fodder may use a shorter
 * but visible 0.3-0.5 s wind-up). Its lunge is short, aimed where the player stood when the wind-up began, and the
 * player outruns its walk (6 vs 4.2 u/s), so a sidestep during the wind-up always clears it.
 *
 * @module
 */

import { SIM_DT } from "../../../units";
import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import type { SimCtx } from "../../ctx";
import { enemyCooldown, walkStep } from "../actorMods";
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

/**
 * Tuning of the swarmer: the lunge (trigger, wind-up, speed, recovery, cooldown), where its chase stops and how
 * packmates push apart. Distances in world units, times in ticks.
 */
export interface SwarmerData extends RoomEnemyData {
	/** Starts a lunge wind-up when the player is this close (and in sight). */
	readonly lungeTrigger: number;
	/** Wind-up ticks (telegraph). */
	readonly lungeTelegraphTicks: number;
	/** Lunge speed (world units / s) and duration (ticks): reach = speed * ticks / 60. */
	readonly lungeSpeed: number;
	/** Ticks a lunge lasts, moving lungeSpeed / 60 world units each; a wall ends it early. */
	readonly lungeTicks: number;
	/** Standing still after a lunge (punish window). */
	readonly recoverTicks: number;
	/** Ticks between lunges (random in [min, max], drawn from the sim rng). */
	readonly lungeCooldownMin: number;
	/** Longest cooldown between lunges (ticks, inclusive); the shortest is `lungeCooldownMin`. */
	readonly lungeCooldownMax: number;
	/** Stops chasing this far from the player's center (inside contact range: radius + PLAYER_RADIUS). */
	readonly chaseStop: number;
	/** Packmates closer than this (center to center) push apart. */
	readonly separation: number;
	/** Most a swarmer is pushed per tick by its packmates (world units). */
	readonly separationMaxStep: number;
}

// --- States (aiState) and attack ids
/** Running at the player (or at where it was last seen). */
export const SWARMER_CHASE = STATE_ENGAGED;
/** Lunging along v[SWARMER_DIR_*]. */
export const SWARMER_LUNGE = AiState.CUSTOM + 1;
/** Standing still after a lunge. */
export const SWARMER_RECOVER = AiState.CUSTOM + 2;
/** ActorState.attack while winding up / lunging. */
export const SWARMER_ATTACK_LUNGE = 1;

// --- v[] slots (0..2 are the shared V_AGGRO / V_HOME_X / V_HOME_Z)
/** Ticks without line of sight while chasing. */
export const SWARMER_LOST = 3;
/** Lunge direction (unit), locked when the wind-up starts. */
export const SWARMER_DIR_X = 4;
/** v slot: Z component of the unit lunge direction (the pair of SWARMER_DIR_X). */
export const SWARMER_DIR_Z = 5;
/** Where the player was last seen. */
export const SWARMER_LAST_X = 6;
/** v slot: world Z of where the player was last seen (the pair of SWARMER_LAST_X). */
export const SWARMER_LAST_Z = 7;

const LUNGE_TELEGRAPH_SECONDS = 0.4;
const LUNGE_SPEED = 11;
const LUNGE_SECONDS = 0.25;
/** A lunge that moved less than this fraction of its step hit a wall: it ends early. */
const LUNGE_BLOCKED = 0.5;
/** Packs don't lunge in lockstep: the first cooldown is random in [0, this]. */
const FIRST_LUNGE_JITTER_SECONDS = 0.5;
/** Two swarmers on the exact same point split along X by id, each by this fraction of `separation`. */
const STACKED_SPLIT = 0.5;
/** Each neighbour pushes by half the overlap. */
const SEPARATION_SHARE = 0.5;

/**
 * The web build's swarmer hp (fixtures/constants.json). Every golden fixture was recorded with it, so the parity specs
 * replay under it (setSwarmerHp), like the sword's WEB_SWORD_TIMINGS.
 */
export const WEB_SWARMER_HP = 2;

/** The port's swarmer hp (CLAUDE.md decision log, 2026-10-31): one less than the web build's, so fodder dies to one hit. */
export const SWARMER_HP = 1;

/**
 * The registered `swarmer` archetype (a web archetype, band 0): its data and hooks. Its hp is SWARMER_HP unless a spec
 * replaced it with `setSwarmerHp`.
 */
export const SWARMER = registerArchetype<SwarmerData>({
	id: "swarmer",
	data: {
		hp: SWARMER_HP,
		radius: 0.3,
		speed: 4.2,
		contactDamage: HIT_NORMAL,
		spriteId: "enemy.swarmer",
		roomEnemy: true,
		aggroRange: 8,
		leashRange: 16,
		lostTicks: secondsToTicks(2),
		alertRange: 4.5,
		lungeTrigger: 2.8,
		lungeTelegraphTicks: secondsToTicks(LUNGE_TELEGRAPH_SECONDS), // 24
		lungeSpeed: LUNGE_SPEED,
		lungeTicks: secondsToTicks(LUNGE_SECONDS), // 15 -> 2.75 units
		recoverTicks: secondsToTicks(0.35),
		lungeCooldownMin: secondsToTicks(1),
		lungeCooldownMax: secondsToTicks(1.6),
		chaseStop: 0.55,
		separation: 0.9,
		separationMaxStep: 0.06,
		fx: {
			aimLine: { dirX: SWARMER_DIR_X, dirZ: SWARMER_DIR_Z, length: LUNGE_SPEED * LUNGE_SECONDS, boldTicks: 8 },
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		a.cooldown = enemyCooldown(ctx, a, 0, secondsToTicks(FIRST_LUNGE_JITTER_SECONDS)); // packs don't lunge in lockstep
	},
	step(ctx, a) {
		const d = ctx.data<SwarmerData>(a);
		if (a.aiState !== SWARMER_LUNGE) separate(ctx, a, d);
		if (stepCalm(ctx, a)) return;
		if (shouldLeash(ctx, a)) {
			leash(a);
			return;
		}
		switch (a.aiState) {
			case AiState.TELEGRAPH:
				a.aiTicks -= 1;
				if (a.aiTicks <= 0) {
					a.aiState = SWARMER_LUNGE;
					a.aiTicks = d.lungeTicks;
				}
				return;
			case SWARMER_LUNGE: {
				const stepLen = d.lungeSpeed * SIM_DT;
				const x0 = a.x;
				const z0 = a.z;
				moveActor(ctx, a, a.v[SWARMER_DIR_X] * stepLen, a.v[SWARMER_DIR_Z] * stepLen);
				const mx = a.x - x0;
				const mz = a.z - z0;
				const blocked = mx * mx + mz * mz < stepLen * stepLen * LUNGE_BLOCKED * LUNGE_BLOCKED;
				a.aiTicks -= 1;
				if (a.aiTicks <= 0 || blocked) {
					a.aiState = SWARMER_RECOVER;
					a.aiTicks = d.recoverTicks;
				}
				return;
			}
			case SWARMER_RECOVER:
				a.aiTicks -= 1;
				if (a.aiTicks <= 0) {
					a.aiState = SWARMER_CHASE;
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
		alertOnDeath(ctx, a);
	},
});

function chase(ctx: SimCtx, a: ActorState, d: SwarmerData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dist = tp.dist;
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (los) {
		a.v[SWARMER_LOST] = 0;
		a.v[SWARMER_LAST_X] = p.x;
		a.v[SWARMER_LAST_Z] = p.z;
	} else {
		a.v[SWARMER_LOST] += 1;
		if (a.v[SWARMER_LOST] > d.lostTicks) {
			leash(a);
			return;
		}
	}
	if (a.cooldown > 0) a.cooldown--;
	if (los && a.cooldown <= 0 && dist <= d.lungeTrigger) {
		a.v[SWARMER_DIR_X] = dirX;
		a.v[SWARMER_DIR_Z] = dirZ;
		faceToward(a, dirX, dirZ);
		a.cooldown = enemyCooldown(ctx, a, d.lungeCooldownMin, d.lungeCooldownMax);
		ctx.telegraph(a, d.lungeTelegraphTicks, SWARMER_ATTACK_LUNGE);
		return;
	}
	// Run at the player (or where it was last seen), stopping just inside contact range so a pack surrounds the player
	// instead of collapsing onto one point (separation spreads it around them).
	const tx = a.v[SWARMER_LAST_X] - a.x;
	const tz = a.v[SWARMER_LAST_Z] - a.z;
	const left = math.sqrt(tx * tx + tz * tz) - d.chaseStop;
	if (left > 0) {
		const walk = walkStep(ctx, a);
		walkToward(ctx, a, a.v[SWARMER_LAST_X], a.v[SWARMER_LAST_Z], walk < left ? walk : left, STEER);
	} else faceToward(a, tx, tz);
}

/**
 * Pairwise separation: every other live swarmer closer than data.separation pushes this one away by half the overlap
 * (capped at separationMaxStep per tick, through the world with moveActor). Fixed slot order, no allocation; two
 * swarmers on the exact same point split along X by id.
 */
function separate(ctx: SimCtx, a: ActorState, d: SwarmerData): void {
	const actors = ctx.actors;
	const sep = d.separation;
	const sep2 = sep * sep;
	let px = 0;
	let pz = 0;
	for (let i = 0; i < actors.size(); i++) {
		const o = actors[i];
		if (o === a || o.kind !== a.kind || o.alive === 0) continue;
		const dx = a.x - o.x;
		const dz = a.z - o.z;
		const d2 = dx * dx + dz * dz;
		if (d2 >= sep2) continue;
		if (d2 < 1e-12) {
			px += (a.id < o.id ? -STACKED_SPLIT : STACKED_SPLIT) * sep; // exactly stacked: split along X by id
			continue;
		}
		const dist = math.sqrt(d2);
		const k = ((sep - dist) / dist) * SEPARATION_SHARE;
		px += dx * k;
		pz += dz * k;
	}
	if (px === 0 && pz === 0) return;
	const len2 = px * px + pz * pz;
	const max = d.separationMaxStep;
	if (len2 > max * max) {
		const k = max / math.sqrt(len2);
		px *= k;
		pz *= k;
	}
	moveActor(ctx, a, px, pz);
}

/**
 * Specs only: sets the swarmer's hp (e.g. to WEB_SWARMER_HP for a golden replay) and returns the previous value to
 * restore. Hp is read at spawn, so it applies to every swarmer spawned afterwards.
 */
export function setSwarmerHp(hp: number): number {
	const previous = SWARMER.data.hp;
	SWARMER.data.hp = hp;
	return previous;
}
