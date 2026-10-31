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
 */

import { secondsToTicks } from "../../../playerData";
import { movePlayer } from "../../../player";
import { sweepArc, type ArcActorHit, type ArcEraseSink } from "../melee";
import { registerWeapon } from "../registry";
import type { WeaponData, WeaponSlotState } from "../types";
import { altPressed } from "./altButton";
import { scoreGuardCancels } from "../../../score/score";
import { tutorialOnGuardCancels } from "../../../tutorial/tutorial";
import type { SimCtx } from "../../ctx";
import { attackTicks, playerHitDamage, runMods } from "../../../progression/runMods";

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
const hitFinisher: ArcActorHit = (ctx, actor) => {
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
		sweepArc(
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

		// Guard (ALT press, off cooldown): cancels the combo.
		if (altPressed(ctx) && slot.cooldown === 0) {
			resetCombo(v);
			v[SWORD_V_GUARD] = SWORD_DATA.guardTicks;
			slot.cooldown = SWORD_DATA.guardCooldownTicks;
		}
		if (v[SWORD_V_GUARD] > 0) {
			v[SWORD_V_GUARD]--;
			const deletedBefore = ctx.events.bulletsDeleted;
			// docs/GRAZE_PARRY.md GP1 (presentation only): scored runs report each erased bullet's position into the
			// score events' guardX / guardZ (one reused sink, no allocation per tick); guardPlayer follows below.
			const score = ctx.state.score;
			let sink: ArcEraseSink | undefined;
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
				SWORD_DATA.guardHalfAngleCos,
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

/** Guard progress of a sword slot: 1 at the guard's start, 0 when down (render). */
export function swordGuard(slot: Readonly<WeaponSlotState>): number {
	return slot.v[SWORD_V_GUARD] / SWORD_DATA.guardTicks;
}
