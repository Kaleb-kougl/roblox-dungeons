/**
 * Sprite inputs of the second endless set (docs/NEW_ENEMIES.md NE8): the Bomber, Charger, Stormcaller, Warbanner and
 * Reaper as ActorSpriteInput builders (registered in sprites.ts ACTOR_SPRITE_INPUTS), wired to the animation names of
 * the plan's mapping table (idle / move / attack segments / hit / death, the optional `death.2` and `move.back`) with
 * marks as named placeholders (NEW_ENEMY_ANIM_MARKS; NE9 measures them on the art). Their own module because the
 * compiled sprites.luau sits near Luau's 200 top-level locals; it imports sprites.ts for types only (no require
 * cycle). Presentation only.
 */
import {
	AiState,
	BOMBER,
	BOMBER_ATTACK_FUSE,
	BOMBER_DETONATED,
	BOMBER_FUSED,
	CHARGER,
	CHARGER_ATTACK_LANE,
	CHARGER_CHARGE,
	CHARGER_LEFT,
	CHARGER_STUN,
	CORPSE_TICKS,
	REAPER,
	REAPER_ATTACK_WIND,
	REAPER_DIZZY,
	REAPER_SPIN,
	SIM_DT,
	SIM_HZ,
	STORMCALLER,
	STORMCALLER_ATTACK_CAST,
	WARBANNER,
	WARBANNER_ATTACK_PANIC,
	type ActorState,
	type ArchetypeData,
} from "shared/sim";
import { NEW_ENEMY_ANIM_MARKS, NEW_ENEMY_SPRITE_VIEW } from "./newEnemiesConfig";
import type { ActorAttack, ActorSpriteInput, AnimSegment } from "./sprites";

/** Remaining-ticks timer of `total` ticks -> elapsed ticks, render-interpolated (sprites.ts elapsedOf). */
function elapsedOf(total: number, remaining: number, alpha: number): number {
	return total - remaining + alpha;
}

/** Ground speed from one tick's position delta, world units / s (sprites.ts tickSpeed; no import: no require cycle). */
function groundSpeed(a: Readonly<ActorState>): number {
	const dx = a.x - a.prevX;
	const dz = a.z - a.prevZ;
	return math.sqrt(dx * dx + dz * dz) * SIM_HZ;
}

/** An attack animation (`attack`) wound up over [0, mark) and released over [mark, 1]. */
function markSegments(mark: number): readonly [AnimSegment, AnimSegment] {
	return [
		{ from: 0, to: mark },
		{ from: mark, to: 1 },
	];
}

const [CHARGER_REAR, CHARGER_RUSH] = markSegments(NEW_ENEMY_ANIM_MARKS.charger.lane);
const [STORM_RAISE, STORM_HOLD] = markSegments(NEW_ENEMY_ANIM_MARKS.stormcaller.raise);
const [REAPER_WIND, REAPER_WHIRL] = markSegments(NEW_ENEMY_ANIM_MARKS.reaper.spin);

/** The ActorSpriteInput fields every room enemy fills the same way. */
function roomEnemyInput(
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

/**
 * The Bomber's attack timeline (bomber.ts view contract): the fuse (TELEGRAPH, BOMBER_ATTACK_FUSE, fuseTicks; the ring
 * fills, the blast fires as it runs out) plays `attack` (Imp 5's Crouch, held) stretched over it. Undefined otherwise.
 */
export function bomberAttack(aiState: number, attack: number, aiTicks: number, alpha: number): ActorAttack | undefined {
	if (aiState !== AiState.TELEGRAPH || attack !== BOMBER_ATTACK_FUSE) return undefined;
	const total = BOMBER.data.fuseTicks;
	return { elapsed: math.max(0, elapsedOf(total, aiTicks, alpha)), total };
}

/**
 * ActorSpriteInput for a Bomber: the fuse, the sprint (move by speed), and on a corpse that DETONATED
 * (v[BOMBER_FUSED] = BOMBER_DETONATED) the detonation death `death.2` (Explode; a set without it plays `death`); a
 * fizzled corpse (shot, even mid-fuse) plays `death` (Die 1).
 */
export function bomberSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	const input = roomEnemyInput(
		a,
		alpha,
		BOMBER.data,
		NEW_ENEMY_SPRITE_VIEW.bomberMoveRefSpeed,
		bomberAttack(a.aiState, a.attack, a.aiTicks, alpha),
	);
	if (a.alive !== 0 || a.v[BOMBER_FUSED] !== BOMBER_DETONATED) return input;
	return { ...input, deathAnim: NEW_ENEMY_SPRITE_VIEW.anims.detonation };
}

/**
 * The Charger's attack timeline (charger.ts view contract): the lane (TELEGRAPH, CHARGER_ATTACK_LANE, laneTicks) plays
 * the rear back [0, lane) of `attack`; the charge (CHARGER_CHARGE: aiTicks stays 0, so the time comes from the distance
 * run, chargeRange - v[CHARGER_LEFT], at chargeSpeed) loops [lane, 1]; the stun (CHARGER_STUN, stunTicks counting down)
 * plays `hit` stretched over the whole stun (slowed). The recover and keeping range: undefined (idle / move).
 */
export function chargerAttack(a: Readonly<ActorState>, alpha: number): ActorAttack | undefined {
	const d = CHARGER.data;
	if (a.aiState === AiState.TELEGRAPH) {
		if (a.attack !== CHARGER_ATTACK_LANE) return undefined;
		const total = d.laneTicks;
		return { segment: CHARGER_REAR, elapsed: math.max(0, elapsedOf(total, a.aiTicks, alpha)), total };
	}
	if (a.aiState === CHARGER_CHARGE) {
		const step = d.chargeSpeed * SIM_DT;
		const ran = step > 0 ? math.max(0, d.chargeRange - a.v[CHARGER_LEFT]) / step : 0;
		const total = step > 0 ? d.chargeRange / step : 1;
		return { segment: CHARGER_RUSH, elapsed: ran + alpha, total, loop: true };
	}
	if (a.aiState === CHARGER_STUN) {
		const total = d.stunTicks;
		return {
			anim: NEW_ENEMY_SPRITE_VIEW.anims.stun,
			elapsed: math.max(0, elapsedOf(total, a.aiTicks, alpha)),
			total,
		};
	}
	return undefined;
}

/** ActorSpriteInput for a Charger (walks: the move loop scales by NEW_ENEMY_SPRITE_VIEW.chargerMoveRefSpeed). */
export function chargerSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return roomEnemyInput(a, alpha, CHARGER.data, NEW_ENEMY_SPRITE_VIEW.chargerMoveRefSpeed, chargerAttack(a, alpha));
}

/**
 * The Stormcaller's attack timeline (stormcaller.ts view contract): the cast (TELEGRAPH, STORMCALLER_ATTACK_CAST,
 * castTicks; the row fills, the strike lands as it runs out) plays the staff rising [0, raise) of `attack` over the
 * cast but its last holdTicks, then the staff held overhead [raise, 1] over those (NEW_ENEMY_ANIM_MARKS.stormcaller).
 */
export function stormcallerAttack(
	aiState: number,
	attack: number,
	aiTicks: number,
	alpha: number,
): ActorAttack | undefined {
	if (aiState !== AiState.TELEGRAPH || attack !== STORMCALLER_ATTACK_CAST) return undefined;
	const total = STORMCALLER.data.castTicks;
	const hold = math.clamp(NEW_ENEMY_ANIM_MARKS.stormcaller.holdTicks, 0, total);
	const raise = total - hold;
	const e = math.max(0, elapsedOf(total, aiTicks, alpha));
	if (e < raise) return { segment: STORM_RAISE, elapsed: e, total: raise };
	return { segment: STORM_HOLD, elapsed: e - raise, total: math.max(1, hold) };
}

/** ActorSpriteInput for a Stormcaller (it strafes: the move loop scales by its walk speed). */
export function stormcallerSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	return roomEnemyInput(
		a,
		alpha,
		STORMCALLER.data,
		NEW_ENEMY_SPRITE_VIEW.stormcallerMoveRefSpeed,
		stormcallerAttack(a.aiState, a.attack, a.aiTicks, alpha),
	);
}

/**
 * True when a body moving from (prevX, prevZ) to (x, z) with facing (faceX, faceZ) walks AWAY from its facing: the
 * unit velocity . unit facing is at most `dot` (NEW_ENEMY_SPRITE_VIEW.moveBackDot). Standing, or with no facing: false.
 */
export function movesBack(
	prevX: number,
	prevZ: number,
	x: number,
	z: number,
	faceX: number,
	faceZ: number,
	dot: number = NEW_ENEMY_SPRITE_VIEW.moveBackDot,
): boolean {
	const dx = x - prevX;
	const dz = z - prevZ;
	const v = math.sqrt(dx * dx + dz * dz);
	const f = math.sqrt(faceX * faceX + faceZ * faceZ);
	if (!(v > 0) || !(f > 0)) return false;
	return (dx * faceX + dz * faceZ) / (v * f) <= dot;
}

/**
 * The Warbanner's attack timeline (warbanner.ts view contract): the panic (TELEGRAPH, WARBANNER_ATTACK_PANIC,
 * panicTelegraphTicks; the ring fires as it runs out) plays `attack` (Imp 3's Attack 4, banner raised) over it.
 */
export function warbannerAttack(
	aiState: number,
	attack: number,
	aiTicks: number,
	alpha: number,
): ActorAttack | undefined {
	if (aiState !== AiState.TELEGRAPH || attack !== WARBANNER_ATTACK_PANIC) return undefined;
	const total = WARBANNER.data.panicTelegraphTicks;
	return { elapsed: math.max(0, elapsedOf(total, aiTicks, alpha)), total };
}

/**
 * ActorSpriteInput for a Warbanner: the panic, and `move.back` (Run Backwards; a set without it walks `move`) while its
 * velocity points away from its facing (movesBack: the keep-away and the back-off after a panic).
 */
export function warbannerSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	const input = roomEnemyInput(
		a,
		alpha,
		WARBANNER.data,
		NEW_ENEMY_SPRITE_VIEW.warbannerMoveRefSpeed,
		warbannerAttack(a.aiState, a.attack, a.aiTicks, alpha),
	);
	if (a.alive === 0 || !movesBack(a.prevX, a.prevZ, a.x, a.z, a.faceX, a.faceZ)) return input;
	return { ...input, moveAnim: NEW_ENEMY_SPRITE_VIEW.anims.moveBack };
}

/**
 * The Reaper's attack timeline (reaper.ts view contract): the wind (TELEGRAPH, REAPER_ATTACK_WIND, windTicks; the ring
 * fills) plays [0, spin) of `attack` (Spawn 5's Taunt f0-4); the spin (REAPER_SPIN, spinTicks counting down) loops
 * [spin, 1] (sickles out wide). The dizzy is no attack (the slowed idle: reaperSpriteInput).
 */
export function reaperAttack(aiState: number, attack: number, aiTicks: number, alpha: number): ActorAttack | undefined {
	const d = REAPER.data;
	if (aiState === AiState.TELEGRAPH) {
		if (attack !== REAPER_ATTACK_WIND) return undefined;
		const total = d.windTicks;
		return { segment: REAPER_WIND, elapsed: math.max(0, elapsedOf(total, aiTicks, alpha)), total };
	}
	if (aiState === REAPER_SPIN) {
		const total = d.spinTicks;
		return { segment: REAPER_WHIRL, elapsed: math.max(0, elapsedOf(total, aiTicks, alpha)), total, loop: true };
	}
	return undefined;
}

/** ActorSpriteInput for a Reaper: the wind and spin, the dizzy as a slowed idle (NEW_ENEMY_SPRITE_VIEW.dizzyIdleRate). */
export function reaperSpriteInput(a: Readonly<ActorState>, alpha: number): ActorSpriteInput {
	const input = roomEnemyInput(
		a,
		alpha,
		REAPER.data,
		NEW_ENEMY_SPRITE_VIEW.reaperMoveRefSpeed,
		reaperAttack(a.aiState, a.attack, a.aiTicks, alpha),
	);
	if (a.alive === 0 || a.aiState !== REAPER_DIZZY) return input;
	return { ...input, idleRate: NEW_ENEMY_SPRITE_VIEW.dizzyIdleRate };
}
