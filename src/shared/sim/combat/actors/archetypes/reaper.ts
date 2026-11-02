/**
 * 'reaper' (Roblox port, docs/NEW_ENEMIES.md NE4; no web source): a demon with two sickles that closes in and spins a
 * slow spiral of bullets. 7 hp, contact damage HIT_NORMAL. Engaged, it closes to keepMin-keepMax of its target
 * (backs off inside keepMin; walkStep, STEER) and gives up after lostTicks without line of sight, like the bruiser.
 *
 * Cast: with its cooldown run out (spinCooldownMin-Max, `enemyCooldown`; the first one firstSpinTicks after it spawns
 * or calms down, `enemyCooldownFixed`, no draw), its target in sight and within spinTrigger, it draws the cooldown,
 * then the spin's turn sign (one `ctx.random()` coin: +1 / -1) and winds up for windTicks (`ctx.telegraph`, attack
 * REAPER_ATTACK_WIND; the `ring` hint at its feet, windRingRadius, filling). TWO draws per cast, none anywhere else.
 *
 * Spin (REAPER_SPIN, spinTicks from the tick the wind ends): k starts at the entry of the SPIRAL row
 * (`arcTrig(REAPER_SPIRAL_COUNT, FULL_RING)`, a WEB arc row: the turret sprayer's ring) nearest the target's bearing
 * (largest dot product, first wins; no draw); every volleyEveryTicks it fires `spiralShot` (1 @ 0, a web row) along
 * entries k and k + count / 2 (directions straight from the table: no trig, no rotation), then k += the turn sign
 * (mod count): spinTicks / volleyEveryTicks = 12 volleys, 24 bullets. Every spin tick it drifts toward its target at
 * spinDriftSpeed (scaled by actorWalkPercent like a walk; stops at contact). Then REAPER_DIZZY for dizzyTicks (still,
 * the punish window), back to REAPER_KEEP.
 *
 * View contract: states REAPER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the wind) / REAPER_SPIN / REAPER_DIZZY
 * (aiTicks counts down); attack id REAPER_ATTACK_WIND while winding (0 from the spin on); v slots REAPER_PHASE_TICKS
 * (ticks into the spin), REAPER_SPIRAL_INDEX (k of the next volley), REAPER_TURN (+1 / -1), REAPER_LOST.
 */

import { HIT_NORMAL, PLAYER_RADIUS, secondsToTicks } from "../../../playerData";
import { scalePercent } from "../../../progression/runMods";
import { SIM_DT } from "../../../units";
import { BulletKind, FULL_RING, type BurstSpec } from "../../patterns";
import { arcTrig } from "../../projectilePatterns";
import type { SimCtx } from "../../ctx";
import { actorWalkPercent, enemyCooldown, enemyCooldownFixed, walkStep } from "../actorMods";
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

export interface ReaperData extends RoomEnemyData {
	/** Preferred distance band to its target (world units). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Ticks between spins (random in [min, max], `enemyCooldown`). */
	readonly spinCooldownMin: number;
	readonly spinCooldownMax: number;
	/** Ticks before its first spin (fixed, `enemyCooldownFixed`: no draw), set at spawn and while calm. */
	readonly firstSpinTicks: number;
	/** Casts only with its target in sight within this distance (world units). */
	readonly spinTrigger: number;
	/** Wind-up ticks (telegraph) and the ring at its feet (render). */
	readonly windTicks: number;
	readonly windRingRadius: number;
	/** Spin ticks, its drift toward the target (world units / s) and a volley every this many ticks. */
	readonly spinTicks: number;
	readonly spinDriftSpeed: number;
	readonly volleyEveryTicks: number;
	/** Directions in the spiral's ring (REAPER_SPIRAL_COUNT @ FULL_RING); each volley fires two opposite entries. */
	readonly spiralCount: number;
	/** One spiral bullet (fired one at a time along an entry of the ring). */
	readonly spiralShot: BurstSpec;
	/** Standing still after the spin (the punish window). */
	readonly dizzyTicks: number;
}

// --- States and attack ids
/** Closing in. */
export const REAPER_KEEP = STATE_ENGAGED;
/** Spinning: volleys every volleyEveryTicks. */
export const REAPER_SPIN = AiState.CUSTOM + 1;
/** Dizzy after the spin. */
export const REAPER_DIZZY = AiState.CUSTOM + 2;
/** ActorState.attack while winding up. */
export const REAPER_ATTACK_WIND = 1;

// --- v[] slots (0..2 shared)
/** Ticks into the current spin. */
export const REAPER_PHASE_TICKS = 3;
/** The spiral entry k of the next volley (0 .. spiralCount - 1; the volley also fires k + spiralCount / 2). */
export const REAPER_SPIRAL_INDEX = 4;
/** Turn sign of this spin, +1 or -1 (one draw per cast). */
export const REAPER_TURN = 5;
/** Ticks without line of sight while closing in (lostTicks: leash). */
export const REAPER_LOST = 6;

/** The spiral's ring: 16 @ FULL_RING, a web arc-table row (fixtures/arc-table.json), so no port row (NE1). */
export const REAPER_SPIRAL_COUNT = 16;
const WIND_SECONDS = 0.6;
const WIND_RING_RADIUS = 3;
const SPIRAL_SPEED = 4;
const SPIRAL_LIFE = 1.6;
/** Coin for the spin's turn sign. */
const COIN = 0.5;
/** Stops drifting this far inside contact range (the bruiser's rule). */
const STOP_INSIDE_CONTACT = 0.05;

export const REAPER = registerArchetype<ReaperData>({
	id: "reaper",
	band: PORT_BAND_ENEMIES_2,
	data: {
		hp: 7,
		radius: 0.4,
		speed: 3,
		contactDamage: HIT_NORMAL,
		spriteId: "enemy.reaper",
		roomEnemy: true,
		aggroRange: 9,
		leashRange: 15,
		lostTicks: secondsToTicks(2.5),
		alertRange: 4.5,
		keepMin: 3,
		keepMax: 4,
		spinCooldownMin: secondsToTicks(3.5),
		spinCooldownMax: secondsToTicks(4.5),
		firstSpinTicks: secondsToTicks(1.2), // 72
		spinTrigger: 5,
		windTicks: secondsToTicks(WIND_SECONDS), // 36
		windRingRadius: WIND_RING_RADIUS,
		spinTicks: secondsToTicks(1.6), // 96 = 12 volleys of 8
		spinDriftSpeed: 1.4,
		volleyEveryTicks: 8,
		spiralCount: REAPER_SPIRAL_COUNT,
		spiralShot: {
			count: 1,
			spread: 0,
			speed: SPIRAL_SPEED,
			life: SPIRAL_LIFE,
			damage: HIT_NORMAL,
			kind: BulletKind.ENEMY,
		},
		dizzyTicks: secondsToTicks(0.9), // 54
		fx: {
			ring: {
				state: AiState.TELEGRAPH,
				radius: WIND_RING_RADIUS,
				fillTicks: secondsToTicks(WIND_SECONDS),
				attack: REAPER_ATTACK_WIND,
			},
		},
	},
	init(ctx, a) {
		initRoomEnemy(a);
		a.v[REAPER_TURN] = 1;
		a.cooldown = enemyCooldownFixed(ctx, a, ctx.data<ReaperData>(a).firstSpinTicks);
	},
	step(ctx, a) {
		const d = ctx.data<ReaperData>(a);
		if (stepCalm(ctx, a)) {
			a.cooldown = enemyCooldownFixed(ctx, a, d.firstSpinTicks);
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
				if (a.aiTicks <= 0) {
					startSpin(a, d, tp.dirX, tp.dirZ);
					spinTick(ctx, a, d);
				}
				return;
			}
			case REAPER_SPIN:
				spinTick(ctx, a, d);
				return;
			case REAPER_DIZZY:
				a.aiTicks -= 1;
				if (a.aiTicks <= 0) {
					a.aiState = REAPER_KEEP;
					a.aiTicks = 0;
				}
				return;
			default:
				keepRange(ctx, a, d);
		}
	},
	onHit(ctx, a) {
		engageOnHit(ctx, a);
	},
	onDeath(ctx, a) {
		alertOnDeath(ctx, a); // its spiral keeps flying
	},
});

/**
 * Closing in: counts the cooldown down, casts when ready (target in sight within spinTrigger: the cooldown draw, then
 * the turn-sign draw, then the wind telegraph), else backs off inside keepMin, closes in past keepMax (stopping at
 * keepMax), and stands facing its target in between.
 */
function keepRange(ctx: SimCtx, a: ActorState, d: ReaperData): void {
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	const los = ctx.lineOfSight(a.x, a.z, p.x, p.z);
	if (los) {
		a.v[REAPER_LOST] = 0;
	} else {
		a.v[REAPER_LOST] += 1;
		if (a.v[REAPER_LOST] > d.lostTicks) {
			leash(a);
			return;
		}
	}
	if (a.cooldown > 0) a.cooldown--;
	faceToward(a, dirX, dirZ);
	if (a.cooldown <= 0 && los && tp.dist <= d.spinTrigger) {
		a.cooldown = enemyCooldown(ctx, a, d.spinCooldownMin, d.spinCooldownMax);
		a.v[REAPER_TURN] = ctx.random() < COIN ? -1 : 1;
		ctx.telegraph(a, d.windTicks, REAPER_ATTACK_WIND);
		return;
	}
	if (tp.dist > d.keepMax) {
		const walk = walkStep(ctx, a);
		const left = tp.dist - d.keepMax;
		walkToward(ctx, a, p.x, p.z, walk < left ? walk : left, STEER);
	} else if (tp.dist < d.keepMin) {
		const stepLen = walkStep(ctx, a);
		moveActor(ctx, a, -dirX * stepLen, -dirZ * stepLen, STEER);
	}
}

/** Index of the `count` @ FULL_RING row entry nearest the unit direction (dirX, dirZ): largest dot, first wins. */
export function reaperNearestEntry(count: number, dirX: number, dirZ: number): number {
	const ring = arcTrig(count, FULL_RING);
	let best = 0;
	let bestDot = -math.huge;
	for (let k = 0; k < count; k++) {
		const dot = ring.sin[k] * dirX + ring.cos[k] * dirZ;
		if (dot > bestDot) {
			bestDot = dot;
			best = k;
		}
	}
	return best;
}

/** The wind ended: spin from the entry nearest the target's bearing (dirX, dirZ). No draw. */
function startSpin(a: ActorState, d: ReaperData, dirX: number, dirZ: number): void {
	a.aiState = REAPER_SPIN;
	a.aiTicks = d.spinTicks;
	a.attack = 0;
	a.v[REAPER_PHASE_TICKS] = 0;
	a.v[REAPER_SPIRAL_INDEX] = reaperNearestEntry(d.spiralCount, dirX, dirZ);
}

/** One spin tick: a volley every volleyEveryTicks (entries k and k + count / 2), the drift, then dizzy at the end. */
function spinTick(ctx: SimCtx, a: ActorState, d: ReaperData): void {
	const phase = a.v[REAPER_PHASE_TICKS];
	if (phase % d.volleyEveryTicks === 0) {
		const ring = arcTrig(d.spiralCount, FULL_RING);
		const k = a.v[REAPER_SPIRAL_INDEX];
		const opposite = (k + d.spiralCount / 2) % d.spiralCount;
		ctx.fireEnemy(a, ring.sin[k], ring.cos[k], d.spiralShot);
		ctx.fireEnemy(a, ring.sin[opposite], ring.cos[opposite], d.spiralShot);
		a.v[REAPER_SPIRAL_INDEX] = (k + a.v[REAPER_TURN] + d.spiralCount) % d.spiralCount;
	}
	const p = ctx.player;
	const tp = toPlayer(ctx, a);
	const contact = a.radius + PLAYER_RADIUS - STOP_INSIDE_CONTACT;
	if (tp.dist > contact) {
		const drift = scalePercent(d.spinDriftSpeed * SIM_DT, actorWalkPercent(ctx, a));
		const left = tp.dist - contact;
		walkToward(ctx, a, p.x, p.z, drift < left ? drift : left, STEER);
	} else faceToward(a, tp.dx, tp.dz);
	a.v[REAPER_PHASE_TICKS] = phase + 1;
	a.aiTicks = d.spinTicks - (phase + 1);
	if (phase + 1 >= d.spinTicks) {
		a.aiState = REAPER_DIZZY;
		a.aiTicks = d.dizzyTicks;
	}
}
