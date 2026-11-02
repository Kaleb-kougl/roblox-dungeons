/**
 * 'reaper' (Roblox port, docs/NEW_ENEMIES.md; no web source): a demon with two sickles that closes in and spins a
 * slow spiral of bullets. 7 hp, contact damage HIT_NORMAL. Engaged, it closes to keepMin-keepMax of its target.
 *
 * Planned (NE4, not built yet): every spinCooldownMin-Max (`enemyCooldown`) it winds up for windTicks (attack
 * REAPER_ATTACK_WIND; the `ring` hint at its feet, windRingRadius, filling), then spins for spinTicks drifting toward
 * its target at spinDriftSpeed: every volleyEveryTicks it fires entries k and k + SPIRAL / 2 of the SPIRAL row
 * (REAPER_SPIRAL_COUNT @ FULL_RING: a WEB arc row, the turret sprayer's ring; k += 1 per volley, the turn sign one draw
 * per cast) as `spiralShot` bullets; 12 volleys, 24 bullets. Then REAPER_DIZZY for dizzyTicks (still, vulnerable).
 *
 * NE1 skeleton: the data block and a minimal step (calm / leash / engage, then keep range straight along the target's
 * bearing); no wind, no spin, no draws.
 *
 * View contract: states REAPER_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the wind) / REAPER_SPIN / REAPER_DIZZY;
 * attack id REAPER_ATTACK_WIND; v slots REAPER_PHASE_TICKS (ticks into the spin), REAPER_SPIRAL_INDEX (k),
 * REAPER_TURN (+1 / -1, the spin's turn sign).
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
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

export interface ReaperData extends RoomEnemyData {
	/** Preferred distance band to its target (world units). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Ticks between spins (random in [min, max], `enemyCooldown`). */
	readonly spinCooldownMin: number;
	readonly spinCooldownMax: number;
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
/** The spiral entry k of the next volley (0 .. spiralCount / 2 - 1). */
export const REAPER_SPIRAL_INDEX = 4;
/** Turn sign of this spin, +1 or -1 (one draw per cast). */
export const REAPER_TURN = 5;

/** The spiral's ring: 16 @ FULL_RING, a web arc-table row (fixtures/arc-table.json), so no port row (NE1). */
export const REAPER_SPIRAL_COUNT = 16;
const WIND_SECONDS = 0.6;
const WIND_RING_RADIUS = 3;
const SPIRAL_SPEED = 4;
const SPIRAL_LIFE = 1.6;

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
	init(_ctx, a) {
		initRoomEnemy(a);
		a.v[REAPER_TURN] = 1;
	},
	step(ctx, a) {
		const d = ctx.data<ReaperData>(a);
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

/** NE1 skeleton: backs off inside keepMin, closes in past keepMax, else stands facing its target (no draw). */
function keepRange(ctx: SimCtx, a: ActorState, d: ReaperData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	const radial = tp.dist < d.keepMin ? -1 : tp.dist > d.keepMax ? 1 : 0;
	if (radial === 0) return;
	const stepLen = walkStep(ctx, a) * radial;
	moveActor(ctx, a, dirX * stepLen, dirZ * stepLen, STEER);
}
