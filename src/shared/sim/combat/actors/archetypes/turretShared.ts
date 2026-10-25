/**
 * Shared rules of the M1 sandbox turrets (E1.6, ported to archetypes in E1.8 with identical behaviour; source:
 * `src/sim/actors/archetypes/turretShared.ts`): stationary, awake only while the living player is within
 * TURRET_WAKE_RADIUS (no line-of-sight test), a burst every periodTicks, dead for TURRET_RESPAWN_TICKS then back at
 * full hp. Each turret archetype is its own file (turretSprayer.ts, ...).
 */

import { ENEMY_BULLET_DAMAGE, ENEMY_BULLET_LIFE } from "../../combatData";
import type { SimCtx } from "../../ctx";
import { secondsToTicks } from "../../../playerData";
import { turnDir, type BurstSpec, type Dir } from "../../patterns";
import { faceToward, toPlayer } from "../helpers";
import type { ActorState, ArchetypeData, ArchetypeDef } from "../types";

/** Turret body radius for player bullets, world units. */
export const TURRET_RADIUS = 0.45;
/** Turret hit points (player bullets deal their payload damage each). */
export const TURRET_HP = 12;
/** A dead turret comes back after this long, so the sandbox keeps working. */
export const TURRET_RESPAWN_SECONDS = 6;
export const TURRET_RESPAWN_TICKS = secondsToTicks(TURRET_RESPAWN_SECONDS); // 360
/** Turrets only count down and fire while the (living) player is within this distance. */
export const TURRET_WAKE_RADIUS = 9;
const WAKE_R2 = TURRET_WAKE_RADIUS * TURRET_WAKE_RADIUS;

export interface TurretData extends ArchetypeData {
	/** The burst (life ENEMY_BULLET_LIFE, damage ENEMY_BULLET_DAMAGE). */
	burst: BurstSpec;
	/** Ticks between bursts. */
	periodTicks: number;
	/** Ticks before the first burst after spawning / respawning (counted only while awake). */
	firstTicks: number;
	/** true: re-aim at the player before each burst (sniper); false: turn the heading by TURN after each burst. */
	aimed: boolean;
}

// ActorState.v slots.
/** Burst heading, a unit vector: the sniper's last aim, the sprayer's / caster's turning phase. */
export const TURRET_DIR_X = 0;
export const TURRET_DIR_Z = 1;

/** A burst spec with the shared enemy bullet life and damage. */
export function turretBurst(count: number, spread: number, speed: number, kind: number): BurstSpec {
	return { count, spread, speed, life: ENEMY_BULLET_LIFE, damage: ENEMY_BULLET_DAMAGE, kind };
}

/** Common data for a turret archetype. */
export function turretData(
	spriteId: string,
	burst: BurstSpec,
	periodSeconds: number,
	firstSeconds: number,
	aimed: boolean,
): TurretData {
	return {
		hp: TURRET_HP,
		radius: TURRET_RADIUS,
		speed: 0,
		contactDamage: 0,
		spriteId,
		burst,
		periodTicks: secondsToTicks(periodSeconds),
		firstTicks: secondsToTicks(firstSeconds),
		aimed,
	};
}

const turned: Dir = { x: 0, z: 1 };

function turretInit(ctx: SimCtx, a: ActorState): void {
	a.v[TURRET_DIR_X] = 0;
	a.v[TURRET_DIR_Z] = 1;
	a.cooldown = ctx.data<TurretData>(a).firstTicks;
}

function turretStep(ctx: SimCtx, a: ActorState): void {
	const d = ctx.data<TurretData>(a);
	const tp = toPlayer(ctx, a);
	faceToward(a, tp.dx, tp.dz); // the sprite turns toward the player (presentation; asleep too)
	if (ctx.player.dead !== 0) return; // nothing left to shoot at
	const d2 = tp.dist2;
	if (d2 > WAKE_R2) return; // asleep: the cooldown holds
	if (a.cooldown > 0) {
		a.cooldown--;
		if (a.cooldown > 0) return;
	}
	if (d.aimed && d2 > 1e-12) {
		const inv = 1 / math.sqrt(d2);
		a.v[TURRET_DIR_X] = tp.dx * inv;
		a.v[TURRET_DIR_Z] = tp.dz * inv;
	}
	ctx.fireEnemy(a, a.v[TURRET_DIR_X], a.v[TURRET_DIR_Z], d.burst);
	if (!d.aimed) {
		turnDir(a.v[TURRET_DIR_X], a.v[TURRET_DIR_Z], turned);
		a.v[TURRET_DIR_X] = turned.x;
		a.v[TURRET_DIR_Z] = turned.z;
	}
	a.cooldown = d.periodTicks;
}

/** Dead turrets keep their slot and come back after TURRET_RESPAWN_TICKS (no burst on that tick). */
function turretStepDead(ctx: SimCtx, a: ActorState): void {
	if (a.deadTicks < TURRET_RESPAWN_TICKS) return;
	ctx.reviveActor(a);
	a.cooldown = ctx.data<TurretData>(a).firstTicks;
}

/** A turret archetype def (register it from the turret's own file). Hooks are methods (roblox-ts `:` calls). */
export function turretDef(id: string, data: TurretData): ArchetypeDef<TurretData> {
	return {
		id,
		data,
		init(ctx, a) {
			turretInit(ctx, a);
		},
		step(ctx, a) {
			turretStep(ctx, a);
		},
		stepDead(ctx, a) {
			turretStepDead(ctx, a);
		},
	};
}
