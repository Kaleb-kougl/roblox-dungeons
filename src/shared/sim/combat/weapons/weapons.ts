/**
 * Player weapon state and the generic weapon rules (E1.8; source: `src/sim/weapons/weapons.ts`): two weapon sets,
 * instant SWAP, per-set cooldowns, triggers. The weapons themselves are WeaponDefs in ./defs.
 *
 * stepWeapons order (inside stepCombat, after the actors and the stress emitter, before bullets move):
 *   1. every set's cooldown counts down (swapping never pauses or resets a cooldown)
 *   2. dead -> nothing else (prevButtons still updated)
 *      M2 Ember Wake (endless runs): a roll the acting player started this tick (rollTicks === ROLL_TICKS: only on
 *      the start tick, after stepPlayer's countdown) fires a ring of player bullets; builds (docs/LEGENDARIES.md LG3):
 *      that moment restarts Bastion's brace count, and a swap (3.) ends a guard's
 *   3. SWAP press edge -> activeSet = next set, events.weaponSwapped = 1 (instant; allowed while rolling) when the
 *      next set holds a weapon; onto an empty set nothing happens (docs/ARCHER.md ARD3: no event, no buildsOnSwap; a
 *      one-weapon character's SWAP is dead). Every two-weapon loadout swaps exactly as before.
 *   4. the active set's weapon: def.step?(ctx, slot)
 *   5. trigger ('hold': FIRE held / 'press': FIRE edge / 'custom': never), not rolling, cooldown 0
 *        -> def.fire(ctx, slot); true -> slot.cooldown = data.cooldownTicks (M2 Swift Strikes: x 80 %, rounded)
 *   6. prevButtons = input.buttons
 *
 * @module
 */

import { Button } from "../../input";
import type { SimCtx } from "../ctx";
import { weaponAt, weaponIndex } from "./registry";
import { NO_WEAPON, WEAPON_SCRATCH_SLOTS, WEAPON_SETS, type WeaponSlotState, type WeaponsState } from "./types";
import { BulletKind, FULL_RING, type BurstSpec } from "../patterns";
import { attackTicks, runMods } from "../../progression/runMods";
import { ROLL_TICKS } from "../../playerData";
import { ROLL_RING_COUNT, ROLL_RING_DAMAGE, ROLL_RING_LIFE, ROLL_RING_SPEED } from "../../progression/progressionData";
import { buildsOnRollStart, buildsOnSwap } from "../../builds/hooks";

/** M2 Ember Wake's ring (16 / FULL_RING: an arc-table shape). */
const ROLL_RING: BurstSpec = {
	count: ROLL_RING_COUNT,
	spread: FULL_RING,
	speed: ROLL_RING_SPEED,
	life: ROLL_RING_LIFE,
	damage: ROLL_RING_DAMAGE,
	kind: BulletKind.PLAYER,
};

function zeros(n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(0);
	return out;
}

/**
 * Weapon state for a run from a loadout: one weapon id per set (undefined / "" = empty), padded / cut to WEAPON_SETS.
 * Unknown ids throw (lists the registered ones). `emitterId` is the player's id in the player bullet simulation.
 */
export function createWeaponsState(loadout: ReadonlyArray<string | undefined>, emitterId: number): WeaponsState {
	const sets: WeaponSlotState[] = [];
	for (let i = 0; i < WEAPON_SETS; i++) {
		const id = loadout[i];
		sets.push({
			weapon: id !== undefined && id !== "" ? weaponIndex(id) : NO_WEAPON,
			cooldown: 0,
			v: zeros(WEAPON_SCRATCH_SLOTS),
		});
	}
	return {
		activeSet: 0,
		prevButtons: 0,
		emitterId,
		sets,
		swingTick: -1,
		swingX: 0,
		swingZ: 0,
		swingDirX: 0,
		swingDirZ: 1,
		swingRadius: 0,
		swingHalfCos: 1,
	};
}

export function cloneWeaponsState(w: Readonly<WeaponsState>): WeaponsState {
	return { ...w, sets: w.sets.map((s) => ({ ...s, v: [...s.v] })) };
}

/** The slot in hand. */
export function activeWeaponSlot(w: Readonly<WeaponsState>): WeaponSlotState {
	return w.sets[w.activeSet];
}

/** Walking speed multiplier from the weapon in hand (its def's moveMultiplier; 1 without one). Read by stepPlayer. */
export function weaponMoveMultiplier(w: Readonly<WeaponsState>): number {
	const slot = w.sets[w.activeSet];
	if (slot === undefined || slot.weapon === NO_WEAPON) return 1;
	const def = weaponAt(slot.weapon);
	return def.moveMultiplier !== undefined ? def.moveMultiplier(slot) : 1;
}

/**
 * Whether the weapon in hand brakes the walk this tick (docs/SWORD_SPACING.md Design 3, SP2: its def's `spacing` hook
 * with the tick's buttons; false without one, or with an empty set in hand). Read by stepPlayer, only with a spacing
 * brake (SimConfig.spacing).
 */
export function weaponSpacingActive(w: Readonly<WeaponsState>, buttons: number): boolean {
	const slot = w.sets[w.activeSet];
	if (slot === undefined || slot.weapon === NO_WEAPON) return false;
	const def = weaponAt(slot.weapon);
	return def.spacing !== undefined ? def.spacing(slot, buttons) : false;
}

/**
 * One tick of the acting player's weapons (ctx.weapons / ctx.player / ctx.input: player 0 in a solo run; stepCombat
 * binds each co-op player in index order). See the order at the top of this file.
 */
export function stepWeapons(ctx: SimCtx): void {
	const w = ctx.weapons;
	const buttons = ctx.input.buttons;
	const sets = w.sets;
	for (const s of sets) if (s.cooldown > 0) s.cooldown--;

	const p = ctx.player;
	if (p.dead === 0) {
		if (p.rollTicks === ROLL_TICKS && runMods(ctx.state, ctx.playerIndex).rollRing) {
			ctx.firePlayer(sets[w.activeSet], p.x, p.z, p.rollDirX, p.rollDirZ, ROLL_RING);
		}
		// Builds (docs/LEGENDARIES.md LG3, opt-in): Bastion's brace count restarts with a roll.
		if (p.rollTicks === ROLL_TICKS && ctx.state.builds !== undefined) buildsOnRollStart(ctx.state, ctx.playerIndex);
		if (bit32.band(buttons, Button.SWAP) !== 0 && bit32.band(w.prevButtons, Button.SWAP) === 0 && sets.size() > 1) {
			const target = (w.activeSet + 1) % sets.size();
			// docs/ARCHER.md ARD3: a swap onto an empty set does nothing.
			if (sets[target].weapon !== NO_WEAPON) {
				w.activeSet = target;
				ctx.events.weaponSwapped = 1;
				// Builds (LG3): a swap ends a guard, and its brace count with it.
				if (ctx.state.builds !== undefined) buildsOnSwap(ctx.state, ctx.playerIndex);
			}
		}
		const slot = sets[w.activeSet];
		if (slot.weapon !== NO_WEAPON) {
			const def = weaponAt(slot.weapon);
			if (def.step !== undefined) def.step(ctx, slot);
			const trigger = def.trigger ?? "hold";
			const fireDown = bit32.band(buttons, Button.FIRE) !== 0;
			const pulled =
				trigger === "hold"
					? fireDown
					: trigger === "press"
					? fireDown && bit32.band(w.prevButtons, Button.FIRE) === 0
					: false;
			if (pulled && p.rollTicks === 0 && slot.cooldown === 0 && def.fire(ctx, slot)) {
				slot.cooldown = attackTicks(ctx.state, ctx.playerIndex, def.data.cooldownTicks);
			}
		}
	}
	w.prevButtons = buttons;
}

/** Hash fields for weapon state, fixed order. Append only. */
export function writeWeaponsHash(w: Readonly<WeaponsState>, out: number[]): void {
	out.push(
		w.activeSet,
		w.prevButtons,
		w.emitterId,
		w.swingTick,
		w.swingX,
		w.swingZ,
		w.swingDirX,
		w.swingDirZ,
		w.swingRadius,
		w.swingHalfCos,
		w.sets.size(),
	);
	for (const s of w.sets) {
		out.push(s.weapon, s.cooldown);
		for (const n of s.v) out.push(n);
	}
}

/** Dump names for writeWeaponsHash, same order (`<prefix>.activeSet`, ...; co-op party members use their own prefix). */
export function weaponsHashNames(w: Readonly<WeaponsState>, out: string[], prefix = "weapons"): void {
	for (const f of [
		"activeSet",
		"prevButtons",
		"emitterId",
		"swingTick",
		"swingX",
		"swingZ",
		"swingDirX",
		"swingDirZ",
		"swingRadius",
		"swingHalfCos",
	]) {
		out.push(`${prefix}.${f}`);
	}
	out.push(`${prefix}.sets.length`);
	for (let i = 0; i < w.sets.size(); i++) {
		out.push(`${prefix}.sets[${i}].weapon`, `${prefix}.sets[${i}].cooldown`);
		for (let k = 0; k < w.sets[i].v.size(); k++) out.push(`${prefix}.sets[${i}].v[${k}]`);
	}
}
