/**
 * 'chainhook' (Roblox port, docs/NEW_ENEMIES_2.md; no web source): a heavy demon that throws a hook down a telegraphed
 * line and drags the player it catches to its feet. 9 hp, contact damage 0. Engaged, it keeps keepMin-keepMax from its
 * target with line of sight (the sniper's reposition). Never bought on floor 1 (NXD4: the dungeon's room pool, NX6).
 *
 * Planned (NX3, not built yet): every throwCooldownMin-Max (`enemyCooldown`), with its target within throwRange and in
 * sight, it aims for aimTicks (attack CHAINHOOK_ATTACK_THROW; the `aimLine` hint, throwLineLength long, heading locked
 * at the telegraph's start in v[CHAINHOOK_DIR_*]), then fires `hook` (one BulletKind.HOOK bullet) and waits in
 * CHAINHOOK_THROWN while it flies. A hook that reaches a hittable player latches (v[CHAINHOOK_HOOKED] = party index + 1)
 * and CHAINHOOK_DRAG pulls that player toward it at pullSpeed through movePlayer (SimCtx.dragPlayer, from this step)
 * until within pullStop, dragMaxTicks pass, or the drag breaks (a roll, lost sight, its death, breakDamage taken since
 * the latch: v[CHAINHOOK_DAMAGE]). Arrival: the yank, a yankTelegraphTicks telegraph (attack CHAINHOOK_ATTACK_YANK; the
 * `ring` hint at its feet, yankRingRadius) and the imp's 5-bullet fan (`yankFan`, the same spec object and port arc row)
 * at the player. Draws: the first cooldown in init, one per throw (plus the sniper's strafe flips).
 *
 * NX1 skeleton: the data block and a minimal step (calm / leash / engage, then keep range straight along the target's
 * bearing); no aim, no hook, no drag, no draws.
 *
 * View contract: states CHAINHOOK_KEEP (= STATE_ENGAGED) / AiState.TELEGRAPH (the aim, then the yank) /
 * CHAINHOOK_THROWN / CHAINHOOK_DRAG (aiTicks counts the drag's ticks); attack ids CHAINHOOK_ATTACK_THROW /
 * CHAINHOOK_ATTACK_YANK; v slots CHAINHOOK_DIR_X / _Z (the locked throw heading), CHAINHOOK_HOOKED (hooked party index
 * + 1, 0 none: the view suspends local prediction while it names the local player), CHAINHOOK_DAMAGE (shared: ticks
 * without sight while keeping range, damage taken since the latch while dragging), CHAINHOOK_STRAFE (+1 / -1).
 */

import { secondsToTicks } from "../../../playerData";
import { BulletKind, type BurstSpec } from "../../patterns";
import type { SimCtx } from "../../ctx";
import { walkStep } from "../actorMods";
import { faceToward, moveActor, toPlayer } from "../helpers";
import { PORT_BAND_ENEMIES_3, registerArchetype } from "../registry";
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
import { IMP } from "./imp";

export interface ChainhookData extends RoomEnemyData {
	/** Preferred distance band to its target (world units; it wants line of sight). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** Ticks between throws (random in [min, max], `enemyCooldown`; the first drawn at spawn). */
	readonly throwCooldownMin: number;
	readonly throwCooldownMax: number;
	/** Throws when its target is this close (world units) and in sight. */
	readonly throwRange: number;
	/** Aim telegraph ticks (the heading locks at its start) and its warning line's length (world units). */
	readonly aimTicks: number;
	readonly throwLineLength: number;
	/** The hook: one BulletKind.HOOK bullet (0 damage: it latches, never hurts). */
	readonly hook: BurstSpec;
	/** The drag: pull speed (world units / s), stop distance (world units), longest drag (ticks). */
	readonly pullSpeed: number;
	readonly pullStop: number;
	readonly dragMaxTicks: number;
	/** Damage it takes since the latch that breaks the drag (a teammate freed you). */
	readonly breakDamage: number;
	/** The yank strike on arrival: telegraph ticks, the ring at its feet (world units), the fan. */
	readonly yankTelegraphTicks: number;
	readonly yankRingRadius: number;
	readonly yankFan: BurstSpec;
}

// --- States and attack ids
/** Keeping range. */
export const CHAINHOOK_KEEP = STATE_ENGAGED;
/** The hook is in flight. */
export const CHAINHOOK_THROWN = AiState.CUSTOM + 1;
/** Dragging the hooked player (aiTicks counts the drag's ticks). */
export const CHAINHOOK_DRAG = AiState.CUSTOM + 2;
/** ActorState.attack while telegraphing the throw (the aim line). */
export const CHAINHOOK_ATTACK_THROW = 1;
/** ActorState.attack while telegraphing the yank (the ring at its feet). */
export const CHAINHOOK_ATTACK_YANK = 2;

// --- v[] slots (0..2 shared)
/** Locked throw heading (unit). */
export const CHAINHOOK_DIR_X = 3;
export const CHAINHOOK_DIR_Z = 4;
/** The hooked player's party index + 1 (0: nobody). */
export const CHAINHOOK_HOOKED = 5;
/**
 * Shared by state: ticks without line of sight while keeping range (the sniper's lost counter), damage taken since the
 * latch while dragging (cleared at each change).
 */
export const CHAINHOOK_DAMAGE = 6;
/** Strafe side, +1 or -1. */
export const CHAINHOOK_STRAFE = 7;

const AIM_SECONDS = 0.7;
const THROW_RANGE = 8;
const HOOK_SPEED = 16;
const HOOK_LIFE = 0.5;
const YANK_SECONDS = 0.3;
const YANK_RING_RADIUS = 1.6;

export const CHAINHOOK = registerArchetype<ChainhookData>({
	id: "chainhook",
	band: PORT_BAND_ENEMIES_3,
	data: {
		hp: 9,
		radius: 0.45,
		speed: 2.2,
		contactDamage: 0,
		spriteId: "enemy.chainhook",
		roomEnemy: true,
		aggroRange: 10,
		leashRange: 15,
		lostTicks: secondsToTicks(2.5),
		alertRange: 4.5,
		keepMin: 4,
		keepMax: 7,
		throwCooldownMin: secondsToTicks(4),
		throwCooldownMax: secondsToTicks(5),
		throwRange: THROW_RANGE,
		aimTicks: secondsToTicks(AIM_SECONDS), // 42
		throwLineLength: THROW_RANGE,
		hook: {
			count: 1,
			spread: 0,
			speed: HOOK_SPEED,
			life: HOOK_LIFE, // 8 units
			damage: 0,
			kind: BulletKind.HOOK,
		},
		pullSpeed: 10,
		pullStop: 1.3,
		dragMaxTicks: secondsToTicks(0.6), // 36
		breakDamage: 3,
		yankTelegraphTicks: secondsToTicks(YANK_SECONDS), // 18
		yankRingRadius: YANK_RING_RADIUS,
		yankFan: IMP.data.fan,
		fx: {
			aimLine: {
				dirX: CHAINHOOK_DIR_X,
				dirZ: CHAINHOOK_DIR_Z,
				length: THROW_RANGE,
				boldTicks: secondsToTicks(AIM_SECONDS), // locked from the start: bold throughout
				attack: CHAINHOOK_ATTACK_THROW,
			},
			ring: {
				state: AiState.TELEGRAPH,
				radius: YANK_RING_RADIUS,
				fillTicks: secondsToTicks(YANK_SECONDS),
				attack: CHAINHOOK_ATTACK_YANK,
			},
		},
	},
	init(_ctx, a) {
		initRoomEnemy(a);
	},
	step(ctx, a) {
		const d = ctx.data<ChainhookData>(a);
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

/** NX1 skeleton: backs off inside keepMin, closes in past keepMax, else stands facing its target (no strafe, no draw). */
function keepRange(ctx: SimCtx, a: ActorState, d: ChainhookData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	const radial = tp.dist < d.keepMin ? -1 : tp.dist > d.keepMax ? 1 : 0;
	if (radial === 0) return;
	const stepLen = walkStep(ctx, a) * radial;
	moveActor(ctx, a, dirX * stepLen, dirZ * stepLen, STEER);
}
