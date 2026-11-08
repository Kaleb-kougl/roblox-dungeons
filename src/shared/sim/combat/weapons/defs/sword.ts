/**
 * 'weapon.sword' (E1.8; source: `src/sim/weapons/defs/sword.ts`): the melee weapon set.
 *
 *   FIRE held  a 3-hit combo: swings 1 and 2 (120-degree arcs for `damage`), then a wind-up (finisherWindupTicks)
 *              lunging lungeDistance forward, then the finisher (180 degrees, longer, finisherDamage). Every swing
 *              hits each actor in its arc once and deletes the enemy bullets inside it. swingRecoveryTicks between
 *              swings, finisherRecoveryTicks after the finisher. Not holding FIRE for comboWindowTicks after a swing's
 *              recovery resets the combo.
 *   ALT press  guard: for guardTicks a wide frontal arc deletes enemy bullets every tick (no damage), walking at
 *              guardMoveMultiplier; guardCooldownTicks from the guard's start (slot.cooldown).
 *   A roll cancels a wind-up or a guard and pauses the combo; a SWAP (in) resets the combo and the guard.
 *   Breakables (docs/DECOR.md D4): swings and the finisher hit the pieces in their arc for the BASE damage; the guard
 *   does not hurt them.
 *   M2 (endless runs): Sharpened scales the damage when it hits, Swift Strikes the swing / finisher recovery; with
 *   the Mirror Cloak relic every bullet the guard erases comes back as a player bullet (sweepArc reflectSource).
 *   Co-op: always the swinging player's own modifiers (ctx.playerIndex, bound for the weapons phase).
 *   Bastion (docs/LEGENDARIES.md LG3, builds runs): the guard lasts BASTION_GUARD_TICKS and sweeps the full ring
 *   (swordGuardTicks / swordGuardSweepCos read runMods' `bastion`; without it SWORD_DATA's numbers exactly), and every
 *   guard tick tells sim/builds hooks.ts buildsOnGuardCancels what it erased (the brace count).
 *   Riposte (docs/BUILDS_V2.md BV2 / BV6, builds runs): every guard tick then calls sim/builds riposte.ts
 *   buildsOnRiposteGuard (the count, Rebuke's mark, Thunder Guard's sparks from the erased positions, Stillwater), and
 *   the tick the counter reaches 0 (the guard ran its full length; a roll or a swap zeroes it without this, BVD3)
 *   buildsOnGuardEnd (the counter-wave).
 */

import { secondsToTicks } from "../../../playerData";
import { movePlayer } from "../../../player";
import { sweepArc, type ArcActorHit, type ArcEraseSink } from "../melee";
import { buildsOnFinisher } from "../../../builds/evolutions";
import { registerWeapon } from "../registry";
import type { WeaponData, WeaponSlotState } from "../types";
import { altPressed } from "./altButton";
import { scoreGuardCancels } from "../../../score/score";
import { tutorialOnGuardCancels } from "../../../tutorial/tutorial";
import type { SimCtx } from "../../ctx";
import type { ActorState } from "../../actors/types";
import { attackTicks, playerHitDamage, runMods } from "../../../progression/runMods";
import {
	BASTION_GUARD_HALF_ANGLE_COS,
	BASTION_GUARD_SWEEP_HALF_ANGLE_COS,
	BASTION_GUARD_TICKS,
} from "../../../progression/progressionData";
import { buildsOnGuardCancels } from "../../../builds/hooks";
import { buildsOnGuardEnd, buildsOnRiposteGuard } from "../../../builds/riposte";
import type { SimState } from "../../../state";

export interface SwordData extends WeaponData {
	/** Swings 1 and 2: reach (world units from the player's center) and half-angle cosine (0.5 = 120-degree arc). */
	reach: number;
	halfAngleCos: number;
	finisherDamage: number;
	finisherReach: number;
	finisherHalfAngleCos: number;
	/** Ticks from one swing to the next while FIRE is held. */
	swingRecoveryTicks: number;
	/** Ticks from the finisher's press to the finisher (the lunge happens during them). */
	finisherWindupTicks: number;
	/** Lunge distance, world units, spread evenly over the wind-up (through the world's collision). */
	lungeDistance: number;
	/** Walking speed multiplier during the wind-up. */
	windupMoveMultiplier: number;
	/** Ticks after the finisher before swing 1 can start again. */
	finisherRecoveryTicks: number;
	/** Idle ticks (after a swing's recovery) before the combo resets to swing 1. */
	comboWindowTicks: number;
	guardTicks: number;
	guardCooldownTicks: number;
	guardReach: number;
	guardHalfAngleCos: number;
	guardMoveMultiplier: number;
}

export const SWORD_DATA: SwordData = {
	cooldownTicks: 0, // trigger 'custom': the sword times itself (slot.cooldown = the guard's cooldown)
	damage: 3,
	style: "melee",
	spriteId: "item.weapon.sword",
	// Port retune (CLAUDE.md decision log): swing and finisher reach SWORD_REACH_PERCENT (15%) longer than the web
	// build's (WEB_SWORD_TIMINGS). The swing fan and blade are drawn from these, so they grow too; the guard does not.
	reach: 1.955, // web 1.7
	halfAngleCos: 0.5,
	finisherDamage: 6,
	finisherReach: 2.53, // web 2.2
	finisherHalfAngleCos: 0,
	// Port retune (CLAUDE.md decision log): every swing timer SWORD_TEMPO_PERCENT (20%) slower than the web build's
	// (WEB_SWORD_TIMINGS), rounded to whole ticks. The knight's attack animations stretch over these, so they slow too.
	swingRecoveryTicks: 14, // ~0.23 s (web 12)
	finisherWindupTicks: 11, // ~0.18 s (web 9)
	lungeDistance: 0.6,
	windupMoveMultiplier: 0.35,
	finisherRecoveryTicks: secondsToTicks(0.42), // 25 (web secondsToTicks(0.35) = 21)
	comboWindowTicks: secondsToTicks(0.5), // 30
	guardTicks: secondsToTicks(0.3), // 18
	guardCooldownTicks: secondsToTicks(1), // 60
	guardReach: 1.9,
	guardHalfAngleCos: -0.2, // ~203 degrees: everything in front and a little to the sides
	guardMoveMultiplier: 0.5,
};

/** The sword values the port retuned (CLAUDE.md decision log): its timers (ticks) and its swing reach (world units). */
export interface SwordTimings {
	readonly swingRecoveryTicks: number;
	readonly finisherWindupTicks: number;
	readonly finisherRecoveryTicks: number;
	readonly reach: number;
	readonly finisherReach: number;
}

/**
 * The web build's sword timers and reach (fixtures/constants.json, before the port's 20% slower / 15% longer retune).
 * Every golden fixture was recorded with these, so the parity specs replay under them (setSwordTimings).
 */
export const WEB_SWORD_TIMINGS: SwordTimings = {
	swingRecoveryTicks: 12,
	finisherWindupTicks: 9,
	finisherRecoveryTicks: 21,
	reach: 1.7,
	finisherReach: 2.2,
};

/** The port's slowdown of the web sword's timers, percent (CLAUDE.md decision log; specs pin the rounding). */
export const SWORD_TEMPO_PERCENT = 120;

/** The port's lengthening of the web sword's swing and finisher reach, percent (CLAUDE.md decision log). */
export const SWORD_REACH_PERCENT = 115;

/**
 * Specs only: sets SWORD_DATA's timers and reach (e.g. to WEB_SWORD_TIMINGS for a golden replay) and returns the
 * previous ones to restore. The sword reads them on every tick, so the change applies to every run stepped afterwards.
 */
export function setSwordTimings(t: SwordTimings): SwordTimings {
	const previous: SwordTimings = {
		swingRecoveryTicks: SWORD_DATA.swingRecoveryTicks,
		finisherWindupTicks: SWORD_DATA.finisherWindupTicks,
		finisherRecoveryTicks: SWORD_DATA.finisherRecoveryTicks,
		reach: SWORD_DATA.reach,
		finisherReach: SWORD_DATA.finisherReach,
	};
	SWORD_DATA.swingRecoveryTicks = t.swingRecoveryTicks;
	SWORD_DATA.finisherWindupTicks = t.finisherWindupTicks;
	SWORD_DATA.finisherRecoveryTicks = t.finisherRecoveryTicks;
	SWORD_DATA.reach = t.reach;
	SWORD_DATA.finisherReach = t.finisherReach;
	return previous;
}

/** Scratch slots (slot.v). */
export const SWORD_V_STEP = 0; // next combo swing: 0, 1 (swing 1, 2), 2 (finisher next), SWORD_STEP_WINDUP
export const SWORD_V_BUSY = 1; // ticks until the next swing may start (recovery), or until the finisher (wind-up)
export const SWORD_V_WINDOW = 2; // idle ticks left before the combo resets
export const SWORD_V_GUARD = 3; // guard ticks left (0 = not guarding)
export const SWORD_V_LAST = 4; // last swing: 0 none, 1 / 2 combo swings, 3 finisher
/** SWORD_V_STEP while the finisher winds up. */
export const SWORD_STEP_WINDUP = 3;
/** SWORD_V_LAST of a finisher. */
export const SWORD_FINISHER = 3;

// Module-level hit callbacks (no closure per swing).
const hitSwing: ArcActorHit = (ctx, actor) => {
	ctx.damageActor(actor, playerHitDamage(ctx.state, ctx.playerIndex, SWORD_DATA.damage));
};
/** The first actor the finisher being swept hit (builds' Storm Blade, docs/BUILDS.md BU6); undefined otherwise. */
let finisherFirst: ActorState | undefined;
const hitFinisher: ArcActorHit = (ctx, actor) => {
	if (finisherFirst === undefined) finisherFirst = actor;
	ctx.damageActor(actor, playerHitDamage(ctx.state, ctx.playerIndex, SWORD_DATA.finisherDamage));
};

/**
 * The guard's erase sink (docs/GRAZE_PARRY.md GP1): pointed at the scored state's ScoreEvents.guardX / guardZ just
 * before a guard sweep and back at NO_SINK_ROW after it, so it never keeps a state's arrays alive. Nothing is ever
 * pushed into NO_SINK_ROW (the sink is only handed to sweepArc right after it is pointed at a state).
 */
const NO_SINK_ROW: number[] = [];
const guardSink: ArcEraseSink = { x: NO_SINK_ROW, z: NO_SINK_ROW };

function resetCombo(v: number[]): void {
	v[SWORD_V_STEP] = 0;
	v[SWORD_V_BUSY] = 0;
	v[SWORD_V_WINDOW] = 0;
}

function swing(ctx: SimCtx, v: number[], n: number): void {
	const p = ctx.player;
	if (n === SWORD_FINISHER) {
		finisherFirst = undefined;
		const hits = sweepArc(
			ctx,
			p.x,
			p.z,
			p.faceX,
			p.faceZ,
			SWORD_DATA.finisherReach,
			SWORD_DATA.finisherHalfAngleCos,
			hitFinisher,
			true,
			true,
			undefined,
			SWORD_DATA.finisherDamage, // breakables take the base damage (docs/DECOR.md D4)
		);
		// Builds (docs/BUILDS.md BU5 / BU6, opt-in): the finisher hook (Flurry's crescent, Storm Blade's spark).
		if (ctx.state.builds !== undefined) buildsOnFinisher(ctx, hits, finisherFirst);
		finisherFirst = undefined;
		v[SWORD_V_STEP] = 0;
		v[SWORD_V_BUSY] = attackTicks(ctx.state, ctx.playerIndex, SWORD_DATA.finisherRecoveryTicks);
	} else {
		sweepArc(
			ctx,
			p.x,
			p.z,
			p.faceX,
			p.faceZ,
			SWORD_DATA.reach,
			SWORD_DATA.halfAngleCos,
			hitSwing,
			true,
			true,
			undefined,
			SWORD_DATA.damage, // breakables take the base damage (docs/DECOR.md D4)
		);
		v[SWORD_V_STEP] = n; // the next one
		v[SWORD_V_BUSY] = attackTicks(ctx.state, ctx.playerIndex, SWORD_DATA.swingRecoveryTicks);
	}
	v[SWORD_V_WINDOW] = SWORD_DATA.comboWindowTicks;
	v[SWORD_V_LAST] = n;
}

export const SWORD = registerWeapon<SwordData>({
	id: "weapon.sword",
	data: SWORD_DATA,
	trigger: "custom",
	step(ctx, slot) {
		const v = slot.v;
		const p = ctx.player;
		if (ctx.events.weaponSwapped !== 0) {
			resetCombo(v);
			v[SWORD_V_GUARD] = 0;
		}
		if (p.rollTicks > 0) {
			if (v[SWORD_V_STEP] === SWORD_STEP_WINDUP) resetCombo(v);
			v[SWORD_V_GUARD] = 0;
			return;
		}

		// Guard (ALT press, off cooldown): cancels the combo. Bastion (LG3): its own length and the full ring.
		let starting = false;
		if (altPressed(ctx) && slot.cooldown === 0) {
			resetCombo(v);
			v[SWORD_V_GUARD] = swordGuardTicks(ctx.state, ctx.playerIndex);
			slot.cooldown = SWORD_DATA.guardCooldownTicks;
			starting = true;
		}
		if (v[SWORD_V_GUARD] > 0) {
			v[SWORD_V_GUARD]--;
			const deletedBefore = ctx.events.bulletsDeleted;
			// docs/GRAZE_PARRY.md GP1 (presentation only): scored runs report each erased bullet's position into the
			// score events' guardX / guardZ (one reused sink, no allocation per tick); guardPlayer follows below.
			const score = ctx.state.score;
			let sink: ArcEraseSink | undefined;
			// Riposte's duos (docs/BUILDS_V2.md BV6): where this tick's erased positions start in guardX / guardZ.
			const guardFrom = score !== undefined ? score.events.guardX.size() : 0;
			if (score !== undefined) {
				guardSink.x = score.events.guardX;
				guardSink.z = score.events.guardZ;
				sink = guardSink;
			}
			sweepArc(
				ctx,
				p.x,
				p.z,
				p.faceX,
				p.faceZ,
				SWORD_DATA.guardReach,
				swordGuardSweepCos(ctx.state, ctx.playerIndex),
				undefined,
				true,
				false,
				runMods(ctx.state, ctx.playerIndex).mirror ? slot.weapon + 1 : undefined,
				undefined,
				sink,
				true, // the guard erases goo too (docs/ENEMY_VARIANTS.md EVD14), outside bulletsDeleted: no points
			);
			// M2 scoring (opt-in): guard cancels, told apart from swing deletes. The tutorial's block lesson: a block
			// releases its room's held enemies (tutorial.ts guard lock).
			const cancels = ctx.events.bulletsDeleted - deletedBefore;
			if (score !== undefined) {
				guardSink.x = NO_SINK_ROW;
				guardSink.z = NO_SINK_ROW;
				const players = score.events.guardPlayer;
				for (let k = 0; k < cancels; k++) players.push(ctx.playerIndex);
				scoreGuardCancels(ctx.state, cancels);
			}
			if (ctx.state.tutorial !== undefined) tutorialOnGuardCancels(ctx.state, cancels);
			// Builds (docs/LEGENDARIES.md LG3, opt-in): Bastion's brace count (reset on the guard's start tick).
			const builds = ctx.state.builds;
			if (builds !== undefined) {
				const braces = builds.events.bracePlayer.size();
				buildsOnGuardCancels(ctx.state, ctx.playerIndex, cancels, starting);
				// Riposte (docs/BUILDS_V2.md BV2 / BV6): its count, Rebuke's mark, Thunder Guard, Stillwater.
				const braced = builds.events.bracePlayer.size() > braces;
				buildsOnRiposteGuard(ctx, cancels, starting, guardFrom, braced);
				// Riposte (BV2, BVD3): only a guard that runs its full length fires the counter-wave.
				if (v[SWORD_V_GUARD] === 0) buildsOnGuardEnd(ctx);
			}
			return;
		}

		// Finisher wind-up: lunge, then strike.
		if (v[SWORD_V_STEP] === SWORD_STEP_WINDUP) {
			// Read per tick (not at module load) so setSwordTimings applies; the same division gives the same bits.
			const lungeStep = SWORD_DATA.lungeDistance / SWORD_DATA.finisherWindupTicks;
			movePlayer(ctx.state, p.faceX * lungeStep, p.faceZ * lungeStep, ctx.config, p);
			v[SWORD_V_BUSY] -= 1;
			if (v[SWORD_V_BUSY] <= 0) swing(ctx, v, SWORD_FINISHER);
			return;
		}

		if (v[SWORD_V_BUSY] > 0) {
			v[SWORD_V_BUSY]--;
		} else if (v[SWORD_V_WINDOW] > 0) {
			v[SWORD_V_WINDOW] -= 1;
			if (v[SWORD_V_WINDOW] === 0) v[SWORD_V_STEP] = 0;
		}

		if (ctx.fireHeld() && v[SWORD_V_BUSY] === 0) {
			if (v[SWORD_V_STEP] < 2) {
				swing(ctx, v, v[SWORD_V_STEP] + 1);
			} else {
				v[SWORD_V_STEP] = SWORD_STEP_WINDUP;
				v[SWORD_V_BUSY] = SWORD_DATA.finisherWindupTicks;
			}
		}
	},
	fire() {
		return false; // trigger 'custom': never called
	},
	moveMultiplier(slot) {
		if (slot.v[SWORD_V_GUARD] > 0) return SWORD_DATA.guardMoveMultiplier;
		if (slot.v[SWORD_V_STEP] === SWORD_STEP_WINDUP) return SWORD_DATA.windupMoveMultiplier;
		return 1;
	},
});

/**
 * Guard progress of a sword slot: 1 at the guard's start, 0 when down (render). `guardTicks`: the guard's length for
 * its player (swordGuardTicks; SWORD_DATA.guardTicks by default). Kept within 0..1 (a Bastion guard read with the
 * default length would start above 1).
 */
export function swordGuard(slot: Readonly<WeaponSlotState>, guardTicks: number = SWORD_DATA.guardTicks): number {
	const g = slot.v[SWORD_V_GUARD] / guardTicks;
	return g > 1 ? 1 : g;
}

/**
 * The length of player `playerIndex`'s sword guard in ticks: BASTION_GUARD_TICKS with Bastion (docs/LEGENDARIES.md
 * LG3), else SWORD_DATA.guardTicks. The sim's and the view's (swordGuard's `guardTicks`).
 */
export function swordGuardTicks(state: Readonly<SimState>, playerIndex: number): number {
	return runMods(state, playerIndex).bastion ? BASTION_GUARD_TICKS : SWORD_DATA.guardTicks;
}

/**
 * The half-angle cosine of player `playerIndex`'s guard as drawn: BASTION_GUARD_HALF_ANGLE_COS (-1, the full ring)
 * with Bastion, else SWORD_DATA.guardHalfAngleCos. A view draws a full ring for -1 (swordGuardRing).
 */
export function swordGuardHalfAngleCos(state: Readonly<SimState>, playerIndex: number): number {
	return runMods(state, playerIndex).bastion ? BASTION_GUARD_HALF_ANGLE_COS : SWORD_DATA.guardHalfAngleCos;
}

/** True when player `playerIndex`'s guard is the full ring (Bastion). */
export function swordGuardRing(state: Readonly<SimState>, playerIndex: number): boolean {
	return runMods(state, playerIndex).bastion;
}

/**
 * The half-angle cosine the guard's sweep passes to sweepArc: BASTION_GUARD_SWEEP_HALF_ANGLE_COS (below -1, so the
 * cone test always holds) with Bastion, else SWORD_DATA.guardHalfAngleCos.
 */
export function swordGuardSweepCos(state: Readonly<SimState>, playerIndex: number): number {
	return runMods(state, playerIndex).bastion ? BASTION_GUARD_SWEEP_HALF_ANGLE_COS : SWORD_DATA.guardHalfAngleCos;
}
