/**
 * Sprite inputs of the third endless set (docs/NEW_ENEMIES_2.md NX7): the Shieldwall (`bulwark`), Chainhook, Snatcher,
 * Pyre-keeper and its brazier (`pyre`) as ActorSpriteInput builders, registered in sprites.ts ACTOR_SPRITE_INPUTS
 * through ONE function (withNewEnemy2SpriteInputs: sprites.luau sits near Luau's 200 top-level locals, so it takes one
 * name for all five). Animation names only (NEW_ENEMY_2_SPRITE_VIEW.anims; NX8 builds the art and measures any
 * marks). Imports sprites.ts for types only (no require cycle). Presentation only.
 *
 *   Shieldwall   `block` in place of idle while it guards (ActorSpriteInput.idleAnim; a set without it: idle), the
 *                bash telegraph + lunge as `attack`, the stagger as `hit` (TakeDamage) stretched over the whole stagger
 *                (slowed, like the Charger's stun)
 *   Chainhook    the aim as `attack` stretched over the aim, the yank telegraph as `attack` too; the throw in flight and
 *                the drag hold no attack (idle: it stands)
 *   Snatcher     the swallow telegraph as `attack` stretched over it (the gulp); runs by speed
 *   Pyre-keeper  the light telegraph and the panic as `attack`
 *   pyre         a still turret: idle (the lit loop) until its death (the unlit cell)
 */
import {
	AiState,
	BULWARK,
	BULWARK_ATTACK_BASH,
	BULWARK_BASH,
	BULWARK_GUARDING,
	BULWARK_STAGGER,
	CHAINHOOK,
	CHAINHOOK_ATTACK_THROW,
	CHAINHOOK_ATTACK_YANK,
	CORPSE_TICKS,
	PYRE,
	PYREKEEPER,
	PYREKEEPER_ATTACK_LIGHT,
	PYREKEEPER_ATTACK_PANIC,
	SIM_HZ,
	SNATCHER,
	SNATCHER_ATTACK_SWALLOW,
	type ActorState,
	type ArchetypeData,
} from "shared/sim";
import { NEW_ENEMY_2_SPRITE_VIEW } from "./newEnemies2Config";
import type { ActorAttack, ActorSpriteInput } from "./sprites";

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

/** The ActorSpriteInput fields every one of the five fills the same way. */
function baseInput(
	a: Readonly<ActorState>,
	alpha: number,
	data: Readonly<ArchetypeData>,
	refSpeed: number,
	attack: ActorAttack | undefined,
): ActorSpriteInput {
	return {
		alive: a.alive !== 0,
		deadTicks: a.deadTicks,
		corpseTicks: data.corpseTicks ?? CORPSE_TICKS,
		flashTicks: a.flashTicks,
		attack: a.alive !== 0 ? attack : undefined,
		speed: groundSpeed(a),
		refSpeed,
		alpha,
	};
}

/** A telegraph of `total` ticks with attack id `attack` as one `attack` timeline (undefined otherwise). */
function telegraphAttack(
	a: Readonly<ActorState>,
	attack: number,
	total: number,
	alpha: number,
): ActorAttack | undefined {
	if (a.aiState !== AiState.TELEGRAPH || a.attack !== attack) return undefined;
	return { elapsed: elapsedOf(total, a.aiTicks, alpha), total };
}

/**
 * The Shieldwall's attack timeline (bulwark.ts view contract): the bash telegraph (TELEGRAPH, BULWARK_ATTACK_BASH) then
 * the lunge (BULWARK_BASH) as one `attack`; the stagger (BULWARK_STAGGER, staggerTicks counting down) as `hit`
 * stretched over it. The recovery: undefined (it stands, shield down: idle).
 */
export function bulwarkAttack(a: Readonly<ActorState>, alpha: number): ActorAttack | undefined {
	const d = BULWARK.data;
	const total = d.bashTelegraphTicks + d.bashLungeTicks;
	if (a.aiState === AiState.TELEGRAPH) {
		if (a.attack !== BULWARK_ATTACK_BASH) return undefined;
		return { elapsed: elapsedOf(d.bashTelegraphTicks, a.aiTicks, alpha), total };
	}
	if (a.aiState === BULWARK_BASH) {
		return { elapsed: d.bashTelegraphTicks + elapsedOf(d.bashLungeTicks, a.aiTicks, alpha), total };
	}
	if (a.aiState === BULWARK_STAGGER) {
		const st = d.staggerTicks;
		return { anim: NEW_ENEMY_2_SPRITE_VIEW.anims.stagger, elapsed: elapsedOf(st, a.aiTicks, alpha), total: st };
	}
	return undefined;
}

/**
 * ActorSpriteInput for a Shieldwall: `block` in place of idle while it guards (chooseActorAnim plays the move loop
 * while it walks, so the block shows whenever it stands with the shield up; a set without it: idle).
 */
export function bulwarkSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	const V = NEW_ENEMY_2_SPRITE_VIEW;
	const input = baseInput(a, alpha, BULWARK.data, V.bulwarkMoveRefSpeed, bulwarkAttack(a, alpha));
	if (a.alive === 0 || a.v[BULWARK_GUARDING] !== 1) return input;
	return { ...input, idleAnim: V.anims.block };
}

/** The Chainhook's attack timeline: the aim (CHAINHOOK_ATTACK_THROW) or the yank telegraph, each as `attack`. */
export function chainhookAttack(a: Readonly<ActorState>, alpha: number): ActorAttack | undefined {
	const d = CHAINHOOK.data;
	return (
		telegraphAttack(a, CHAINHOOK_ATTACK_THROW, d.aimTicks, alpha) ??
		telegraphAttack(a, CHAINHOOK_ATTACK_YANK, d.yankTelegraphTicks, alpha)
	);
}

export function chainhookSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return baseInput(
		a,
		alpha,
		CHAINHOOK.data,
		NEW_ENEMY_2_SPRITE_VIEW.chainhookMoveRefSpeed,
		chainhookAttack(a, alpha),
	);
}

/** The Snatcher's attack timeline: the swallow (TELEGRAPH, SNATCHER_ATTACK_SWALLOW, swallowTicks) as `attack`. */
export function snatcherAttack(a: Readonly<ActorState>, alpha: number): ActorAttack | undefined {
	return telegraphAttack(a, SNATCHER_ATTACK_SWALLOW, SNATCHER.data.swallowTicks, alpha);
}

export function snatcherSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return baseInput(a, alpha, SNATCHER.data, NEW_ENEMY_2_SPRITE_VIEW.snatcherMoveRefSpeed, snatcherAttack(a, alpha));
}

/** The Pyre-keeper's attack timeline: the light (the torch raised) or the panic telegraph, each as `attack`. */
export function pyrekeeperAttack(a: Readonly<ActorState>, alpha: number): ActorAttack | undefined {
	const d = PYREKEEPER.data;
	return (
		telegraphAttack(a, PYREKEEPER_ATTACK_LIGHT, d.lightTelegraphTicks, alpha) ??
		telegraphAttack(a, PYREKEEPER_ATTACK_PANIC, d.panicTelegraphTicks, alpha)
	);
}

export function pyrekeeperSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return baseInput(
		a,
		alpha,
		PYREKEEPER.data,
		NEW_ENEMY_2_SPRITE_VIEW.pyrekeeperMoveRefSpeed,
		pyrekeeperAttack(a, alpha),
	);
}

/** ActorSpriteInput for a pyre: never moves or attacks (the idle loop is its lit flame; death the unlit bowl). */
export function pyreSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return { ...baseInput(a, alpha, PYRE.data, 1, undefined), speed: 0 };
}

type SpriteInputOf = (a: Readonly<ActorState>, alpha: number) => ActorSpriteInput;

/** The five's rows for sprites.ts ACTOR_SPRITE_INPUTS. */
export const NEW_ENEMY_2_SPRITE_INPUT_ROWS: ReadonlyArray<readonly [string, SpriteInputOf]> = [
	[BULWARK.id, bulwarkSpriteInput],
	[CHAINHOOK.id, chainhookSpriteInput],
	[SNATCHER.id, snatcherSpriteInput],
	[PYREKEEPER.id, pyrekeeperSpriteInput],
	[PYRE.id, pyreSpriteInput],
];

/** Adds the five to sprites.ts's ACTOR_SPRITE_INPUTS map (one import there: sprites.luau's top-level locals). */
export function withNewEnemy2SpriteInputs(map: Map<string, SpriteInputOf>): Map<string, SpriteInputOf> {
	for (const [id, f] of NEW_ENEMY_2_SPRITE_INPUT_ROWS) map.set(id, f);
	return map;
}
