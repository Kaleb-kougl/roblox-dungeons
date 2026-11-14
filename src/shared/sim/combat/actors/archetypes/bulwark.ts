/**
 * 'bulwark' (Roblox port, docs/NEW_ENEMIES_2.md; no web source): an armoured demon behind a round shield that guards
 * its front and the allies behind it. 10 hp, contact damage 0 (its bash lands through its own overlap check,
 * `ctx.hurtPlayerAt`). Engaged, it walks to keepMin-keepMax from its target with the shield toward it.
 *
 * Planned (NX2, not built yet): the facing turns toward the target by at most one (turnCos, turnSin) rotation a tick
 * (2.5 degrees: 150 degrees a second), so a player who circles faster gets behind it. While GUARDING (v[BULWARK_GUARDING]
 * 1: every state but BULWARK_RECOVER and BULWARK_STAGGER) a hit whose origin is inside the front cone (dot(face,
 * origin - centre) >= frontCos x the distance) is blocked (0 damage, the bullet consumed, a swing does nothing to it),
 * and a player bullet passing within coverRadius of its centre inside the cone stops there (NXD6: the allies behind it
 * are covered). A blocked sword finisher, heavy arrow or Siege slam breaks the guard instead (NXD7): BULWARK_STAGGER
 * for staggerTicks. Bash: target within bashRange and the cooldown out (bashCooldownMin-Max, `enemyCooldown`) ->
 * bashTelegraphTicks (attack BULWARK_ATTACK_BASH; the `aimLine` hint, bashLineLength long, heading locked at the
 * telegraph's start in v[BULWARK_DIR_*]), then BULWARK_BASH: a lunge of bashLunge units over bashLungeTicks, the first
 * overlap with each player hurts bashDamage once (BULWARK_HIT_BITS), then BULWARK_RECOVER for recoverTicks with the
 * shield down. Draws: the first cooldown in init, one per bash.
 *
 * NX1 skeleton: the data block and a minimal step (calm / leash / engage, then keep range straight along the target's
 * bearing, facing it at once); no turn limit, no shield, no bash, no draws. v[BULWARK_GUARDING] is set to 1 at spawn
 * and never read yet.
 *
 * View contract: states BULWARK_GUARD (= STATE_ENGAGED) / AiState.TELEGRAPH (the bash) / BULWARK_BASH /
 * BULWARK_RECOVER / BULWARK_STAGGER (each counts down aiTicks); attack id BULWARK_ATTACK_BASH; v slots BULWARK_LOST
 * (ticks without sight), BULWARK_HIT_BITS (players already hit by this bash, one bit per party index),
 * BULWARK_GUARDING (1 while the shield is up), BULWARK_DIR_X / _Z (the locked bash heading).
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
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

export interface BulwarkData extends RoomEnemyData {
	/** Preferred distance band to its target (world units). */
	readonly keepMin: number;
	readonly keepMax: number;
	/** The most its facing turns a tick, as a rotation (cos, sin): a literal, no trig in the sim. */
	readonly turnCos: number;
	readonly turnSin: number;
	/** The shield's front cone: a hit origin at offset o from its centre is in front when dot(face, o) >= frontCos x |o|. */
	readonly frontCos: number;
	/** NXD6: a player bullet within this of its centre (world units) inside the front cone stops (the cover arc). */
	readonly coverRadius: number;
	/** NXD7: the guard break's stagger (shield down, standing still). */
	readonly staggerTicks: number;
	/** Bashes when its target is this close (world units) and the cooldown is out. */
	readonly bashRange: number;
	/** Ticks between bashes (random in [min, max], `enemyCooldown`; the first drawn at spawn). */
	readonly bashCooldownMin: number;
	readonly bashCooldownMax: number;
	/** Bash telegraph ticks (the heading locks at its start) and its warning line's length (world units). */
	readonly bashTelegraphTicks: number;
	readonly bashLineLength: number;
	/** The bash's lunge: distance (world units) and ticks it takes. */
	readonly bashLunge: number;
	readonly bashLungeTicks: number;
	/** Half hearts of the bash's hit (once per player per bash). */
	readonly bashDamage: number;
	/** Standing with the shield down after a bash (the Knight's opening). */
	readonly recoverTicks: number;
}

// --- States and attack ids
/** Guarding: keeping range with the shield toward its target. */
export const BULWARK_GUARD = STATE_ENGAGED;
/** Lunging along v[BULWARK_DIR_*]. */
export const BULWARK_BASH = AiState.CUSTOM + 1;
/** Shield down after a bash. */
export const BULWARK_RECOVER = AiState.CUSTOM + 2;
/** Guard broken (NXD7): shield down, standing still. */
export const BULWARK_STAGGER = AiState.CUSTOM + 3;
/** ActorState.attack while telegraphing the bash. */
export const BULWARK_ATTACK_BASH = 1;

// --- v[] slots (0..2 shared)
/** Ticks without line of sight to its target (the bruiser's lost counter). */
export const BULWARK_LOST = 3;
/** Players already hit by this bash (bit k = party index k). */
export const BULWARK_HIT_BITS = 4;
/** 1 while the shield is up (guarding), 0 in bash recovery and stagger. */
export const BULWARK_GUARDING = 5;
/** Locked bash heading (unit). */
export const BULWARK_DIR_X = 6;
export const BULWARK_DIR_Z = 7;

/** Design: the facing turns 2.5 degrees a tick (150 deg/s): cos and sin of 2.5 degrees as literals. */
export const BULWARK_TURN_COS = 0.9990482215818578;
export const BULWARK_TURN_SIN = 0.043619387365336;
/** Design: the front cone, dot >= 0.34 x the distance (~140 degrees wide). */
export const BULWARK_FRONT_COS = 0.34;
/** NXD6: the cover arc's reach (world units). */
export const BULWARK_COVER_RADIUS = 1;
const BASH_TELEGRAPH_SECONDS = 0.45;
const BASH_LINE_LENGTH = 1.6;
/** NX1 starting value (the plan gives the lunge's length, not its time): 0.15 s. */
const BASH_LUNGE_SECONDS = 0.15;

export const BULWARK = registerArchetype<BulwarkData>({
	id: "bulwark",
	band: PORT_BAND_ENEMIES_3,
	data: {
		hp: 10,
		radius: 0.45,
		speed: 2,
		contactDamage: 0,
		spriteId: "enemy.bulwark",
		roomEnemy: true,
		aggroRange: 8,
		leashRange: 14,
		lostTicks: secondsToTicks(3),
		alertRange: 4.5,
		keepMin: 2,
		keepMax: 3,
		turnCos: BULWARK_TURN_COS,
		turnSin: BULWARK_TURN_SIN,
		frontCos: BULWARK_FRONT_COS,
		coverRadius: BULWARK_COVER_RADIUS,
		staggerTicks: secondsToTicks(1.5), // 90
		bashRange: 1.8,
		bashCooldownMin: secondsToTicks(2.5),
		bashCooldownMax: secondsToTicks(3.5),
		bashTelegraphTicks: secondsToTicks(BASH_TELEGRAPH_SECONDS), // 27
		bashLineLength: BASH_LINE_LENGTH,
		bashLunge: 1.4,
		bashLungeTicks: secondsToTicks(BASH_LUNGE_SECONDS), // 9
		bashDamage: HIT_NORMAL,
		recoverTicks: secondsToTicks(0.6), // 36
		fx: {
			aimLine: {
				dirX: BULWARK_DIR_X,
				dirZ: BULWARK_DIR_Z,
				length: BASH_LINE_LENGTH,
				boldTicks: secondsToTicks(BASH_TELEGRAPH_SECONDS), // locked from the start: bold throughout
				attack: BULWARK_ATTACK_BASH,
			},
		},
	},
	init(_ctx, a) {
		initRoomEnemy(a);
		a.v[BULWARK_GUARDING] = 1;
	},
	step(ctx, a) {
		const d = ctx.data<BulwarkData>(a);
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

/** NX1 skeleton: backs off inside keepMin, closes in past keepMax, else stands facing its target (no turn limit). */
function keepRange(ctx: SimCtx, a: ActorState, d: BulwarkData): void {
	const tp = toPlayer(ctx, a);
	const dirX = tp.dirX;
	const dirZ = tp.dirZ;
	faceToward(a, dirX, dirZ);
	const radial = tp.dist < d.keepMin ? -1 : tp.dist > d.keepMax ? 1 : 0;
	if (radial === 0) return;
	const stepLen = walkStep(ctx, a) * radial;
	moveActor(ctx, a, dirX * stepLen, dirZ * stepLen, STEER);
}
