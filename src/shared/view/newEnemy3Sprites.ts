/**
 * Sprite inputs of the fourth endless set (docs/NEW_ENEMIES_3.md NT7): the Mortar, Mender and Jackal as ActorSpriteInput
 * builders, registered in sprites.ts ACTOR_SPRITE_INPUTS through newEnemy2Sprites.ts withNewEnemy2SpriteInputs (one
 * name there for all eight: sprites.luau sits near Luau's 200 top-level locals). Animation names only
 * (NEW_ENEMY_3_SPRITE_VIEW.anims): NT8 builds the art, fills the optional `crouch` / `hop` animations and measures any
 * marks; every name a set lacks falls back as written below, so the contract is ready before the art. Imports sprites.ts
 * for types only (no require cycle). Presentation only.
 *
 *   Mortar  the draw (TELEGRAPH, MORTAR_ATTACK_LOB) as `attack` stretched over the draw plus mortarReleaseTicks of the
 *           flight (the release); the rest of the flight it walks (move / idle) while the shell flies
 *   Mender  the link (TELEGRAPH, MENDER_ATTACK_HEAL) as `attack` stretched over it, the channel as `attack` LOOPED
 *           (ActorAttack.loop, the arms held up), the bolt wind-up as `attack.2` (absent: `attack`), the flinch as `hit`
 *           stretched over it
 *   Jackal  the wind-up as `crouch` (absent: `attack`, so a set without it plays its attack over the wind-up and the
 *           lunge, the swarmer's way), the lunge as `attack`, the spooked hop as the special `hop` (absent: skipped, it
 *           plays its move: never the attack), the stagger as `hit` stretched over the whole stagger (slowed); the
 *           recover: undefined (it stands)
 */
import {
	AiState,
	CORPSE_TICKS,
	JACKAL,
	JACKAL_ATTACK_LUNGE,
	JACKAL_HOP,
	JACKAL_LUNGE,
	JACKAL_PHASE,
	JACKAL_STAGGER,
	MENDER,
	MENDER_ATTACK_BOLT,
	MENDER_ATTACK_HEAL,
	MENDER_CHANNEL,
	MENDER_CHANNEL_TICKS,
	MENDER_FLINCH,
	MORTAR,
	MORTAR_ATTACK_LOB,
	MORTAR_FLIGHT,
	MORTAR_FLIGHT_TICKS,
	SIM_HZ,
	type ActorState,
	type ArchetypeData,
} from "shared/sim";
import { NEW_ENEMY_3_SPRITE_VIEW } from "./newEnemies3Config";
import type { ActorAttack, ActorSpecial, ActorSpriteInput } from "./sprites";

/** Remaining-ticks timer of `total` ticks -> elapsed ticks, render-interpolated (sprites.ts elapsedOf). */
function elapsedOf(total: number, remaining: number, alpha: number): number {
	return math.max(0, total - remaining + alpha);
}

/** Ground speed from one tick's position delta, world units / s (sprites.ts tickSpeed; no import: no require cycle). */
function groundSpeed(a: Readonly<ActorState>): number {
	const dx = a.x - a.prevX;
	const dz = a.z - a.prevZ;
	return math.sqrt(dx * dx + dz * dz) * SIM_HZ;
}

function baseInput(
	a: Readonly<ActorState>,
	alpha: number,
	data: Readonly<ArchetypeData>,
	refSpeed: number,
	attack: ActorAttack | undefined,
	special?: ActorSpecial,
): ActorSpriteInput {
	const alive = a.alive !== 0;
	return {
		alive,
		deadTicks: a.deadTicks,
		corpseTicks: data.corpseTicks ?? CORPSE_TICKS,
		flashTicks: a.flashTicks,
		attack: alive ? attack : undefined,
		special: alive ? special : undefined,
		speed: groundSpeed(a),
		refSpeed,
		alpha,
	};
}

/**
 * The Mortar's attack timeline: the draw (TELEGRAPH, MORTAR_ATTACK_LOB, drawTicks) then the first mortarReleaseTicks of
 * the flight (MORTAR_FLIGHT, its ticks left counting down from flightTicks) as one `attack`.
 */
export function mortarAttack(a: Readonly<ActorState>, alpha: number): ActorAttack | undefined {
	const d = MORTAR.data;
	const release = NEW_ENEMY_3_SPRITE_VIEW.mortarReleaseTicks;
	const total = d.drawTicks + release;
	if (a.aiState === AiState.TELEGRAPH) {
		if (a.attack !== MORTAR_ATTACK_LOB) return undefined;
		return { elapsed: elapsedOf(d.drawTicks, a.aiTicks, alpha), total };
	}
	if (a.aiState === MORTAR_FLIGHT) {
		const into = elapsedOf(d.flightTicks, a.v[MORTAR_FLIGHT_TICKS], alpha);
		if (into >= release) return undefined;
		return { elapsed: d.drawTicks + into, total };
	}
	return undefined;
}

export function mortarSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return baseInput(a, alpha, MORTAR.data, NEW_ENEMY_3_SPRITE_VIEW.mortarMoveRefSpeed, mortarAttack(a, alpha));
}

/**
 * The Mender's attack timeline: the link as `attack` stretched over linkTicks, the channel as `attack` looped (elapsed:
 * the channel's ticks), the bolt wind-up as `attack.2`, the flinch as `hit` stretched over flinchTicks.
 */
export function menderAttack(a: Readonly<ActorState>, alpha: number): ActorAttack | undefined {
	const d = MENDER.data;
	const V = NEW_ENEMY_3_SPRITE_VIEW;
	if (a.aiState === AiState.TELEGRAPH) {
		if (a.attack === MENDER_ATTACK_HEAL)
			return { elapsed: elapsedOf(d.linkTicks, a.aiTicks, alpha), total: d.linkTicks };
		if (a.attack === MENDER_ATTACK_BOLT) {
			return {
				anim: V.anims.bolt,
				elapsed: elapsedOf(d.boltWindupTicks, a.aiTicks, alpha),
				total: d.boltWindupTicks,
			};
		}
		return undefined;
	}
	if (a.aiState === MENDER_CHANNEL) {
		return { elapsed: math.max(0, a.v[MENDER_CHANNEL_TICKS] + alpha), total: d.channelTicks, loop: true };
	}
	if (a.aiState === MENDER_FLINCH) {
		return { anim: V.anims.flinch, elapsed: elapsedOf(d.flinchTicks, a.aiTicks, alpha), total: d.flinchTicks };
	}
	return undefined;
}

export function menderSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return baseInput(a, alpha, MENDER.data, NEW_ENEMY_3_SPRITE_VIEW.menderMoveRefSpeed, menderAttack(a, alpha));
}

/** The Jackal's attack timeline: the crouch (wind-up), the lunge, the stagger (jackal.ts view contract). */
export function jackalAttack(a: Readonly<ActorState>, alpha: number): ActorAttack | undefined {
	const d = JACKAL.data;
	const V = NEW_ENEMY_3_SPRITE_VIEW;
	if (a.aiState === AiState.TELEGRAPH) {
		if (a.attack !== JACKAL_ATTACK_LUNGE) return undefined;
		return { anim: V.anims.crouch, elapsed: elapsedOf(d.windupTicks, a.aiTicks, alpha), total: d.windupTicks };
	}
	if (a.aiState === JACKAL_LUNGE) return { elapsed: elapsedOf(d.lungeTicks, a.aiTicks, alpha), total: d.lungeTicks };
	if (a.aiState === JACKAL_STAGGER) {
		return {
			anim: V.anims.stagger,
			elapsed: elapsedOf(d.staggerTicks, a.v[JACKAL_PHASE], alpha),
			total: d.staggerTicks,
		};
	}
	return undefined;
}

/** The Jackal's spooked hop (JACKAL_HOP, v[JACKAL_PHASE] counting hopTicks down) as the special `hop`, no fallback. */
export function jackalSpecial(a: Readonly<ActorState>, alpha: number): ActorSpecial | undefined {
	if (a.aiState !== JACKAL_HOP) return undefined;
	const d = JACKAL.data;
	return {
		anim: NEW_ENEMY_3_SPRITE_VIEW.anims.hop,
		elapsed: elapsedOf(d.hopTicks, a.v[JACKAL_PHASE], alpha),
		total: d.hopTicks,
	};
}

export function jackalSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return baseInput(
		a,
		alpha,
		JACKAL.data,
		NEW_ENEMY_3_SPRITE_VIEW.jackalMoveRefSpeed,
		jackalAttack(a, alpha),
		jackalSpecial(a, alpha),
	);
}

type SpriteInputOf = (a: Readonly<ActorState>, alpha: number) => ActorSpriteInput;

/** The three's rows for sprites.ts ACTOR_SPRITE_INPUTS (added by withNewEnemy2SpriteInputs). */
export const NEW_ENEMY_3_SPRITE_INPUT_ROWS: ReadonlyArray<readonly [string, SpriteInputOf]> = [
	[MORTAR.id, mortarSpriteInput],
	[MENDER.id, menderSpriteInput],
	[JACKAL.id, jackalSpriteInput],
];
