/**
 * 'weapon.bow' (E1.8; source: `src/sim/weapons/defs/bow.ts`): the ranged weapon set.
 *
 *   FIRE held  a steady stream of fast single arrows, one every streamTicks (the first on the press tick), turned by a
 *              small fixed 4-step pattern (0, +a, 0, -a; a ~1.8 degrees).
 *   ALT held   charges for chargeTicks (walking at chargeMoveMultiplier, no stream). Releasing ALT fully charged fires
 *              one heavy piercing arrow. Releasing early cancels. A roll or a SWAP cancels the charge. After a heavy
 *              arrow the stream waits heavyRecoverTicks.
 *
 * State (slot.v): V_CHARGE ticks charged (0 = not charging), V_SHOT stream pattern step (0..3), V_HEAVY_TICK the tick
 * after the last heavy arrow (render flash; 0 = none).
 * Firing goes through ctx.firePlayer -> fireBurst.
 * M2 Piercing Arrows (endless runs): every arrow pierces runMods bowPierce more actors (BOW_PIERCE_BOON; builds: per
 * level, the *_BY_PIERCE specs: same count / spread, so the same arc-table shape).
 */

import { PLAYER_MUZZLE_OFFSET, TURN_COS } from "../../combatData";
import { secondsToTicks } from "../../../playerData";
import { BulletKind, halfRotation, rotateDir, type BurstSpec, type Dir } from "../../patterns";
import { registerWeapon } from "../registry";
import type { WeaponData, WeaponSlotState } from "../types";
import { altHeld } from "./altButton";
import { BOW_PIERCE_BOONS } from "../../../progression/progressionData";
import { buildsFlurryArrow, buildsFlurryArrowsFired } from "../../../builds/hooks";
import { FLURRY_ARROW_COUNT, FLURRY_ARROW_SPREAD } from "../../../builds/effectsData";
import type { SimCtx } from "../../ctx";
import { jsMin } from "shared/jsmath";
import { runMods } from "../../../progression/runMods";

export interface BowData extends WeaponData {
	/** Stream: ticks between arrows while FIRE is held (= cooldownTicks). */
	streamTicks: number;
	/** Stream arrow speed (world units / s) and lifetime (s). */
	speed: number;
	life: number;
	/** Charged shot: ticks ALT must be held. */
	chargeTicks: number;
	/** Walking speed multiplier while charging. */
	chargeMoveMultiplier: number;
	heavyDamage: number;
	heavySpeed: number;
	heavyLife: number;
	/** Actors the heavy arrow passes through (it can hit heavyPierce + 1). */
	heavyPierce: number;
	/** Drawn size of the heavy arrow (render only). */
	heavyScale: number;
	/** Ticks before the stream can fire again after a heavy arrow. */
	heavyRecoverTicks: number;
}

export const BOW_DATA: BowData = {
	cooldownTicks: secondsToTicks(0.2), // 12: 5 arrows / s
	streamTicks: secondsToTicks(0.2),
	damage: 1,
	style: "ranged",
	spriteId: "item.weapon.bow",
	speed: 16,
	life: 0.75, // 12 tiles
	chargeTicks: secondsToTicks(0.6), // 36
	chargeMoveMultiplier: 0.5,
	heavyDamage: 4,
	heavySpeed: 22,
	heavyLife: 0.7, // 15.4 tiles
	heavyPierce: 2,
	heavyScale: 1.8,
	heavyRecoverTicks: secondsToTicks(0.3), // 18
};

/** Scratch slots (slot.v). */
export const BOW_V_CHARGE = 0;
export const BOW_V_SHOT = 1;
export const BOW_V_HEAVY_TICK = 2;

const ARROW: BurstSpec = {
	count: 1,
	spread: 0,
	speed: BOW_DATA.speed,
	life: BOW_DATA.life,
	damage: BOW_DATA.damage,
	kind: BulletKind.PLAYER,
};
const HEAVY_ARROW: BurstSpec = {
	count: 1,
	spread: 0,
	speed: BOW_DATA.heavySpeed,
	life: BOW_DATA.heavyLife,
	damage: BOW_DATA.heavyDamage,
	kind: BulletKind.PLAYER,
	pierce: BOW_DATA.heavyPierce,
	scale: BOW_DATA.heavyScale,
};

/** The most extra pierce any Piercing Arrows level gives. */
const BOW_PIERCE_BOONS_MAX = BOW_PIERCE_BOONS.reduce((m, v) => (v > m ? v : m), 0);

/**
 * The specs per extra pierce (runMods bowPierce: M2 Piercing Arrows' BOW_PIERCE_BOON without builds; with builds its
 * level's BOW_PIERCE_BOONS entry, docs/BUILDS.md BU5 fix: level II's +2 used to fire as +1). Index = extra pierce, built
 * once (same count / spread, so the same arc-table shape). FLURRY_* : the same arrow fired as Flurry's triple
 * (sim/builds evolutions.ts; FLURRY_ARROW_COUNT @ FLURRY_ARROW_SPREAD, a web shape).
 */
const ARROWS_BY_PIERCE: BurstSpec[] = [];
const HEAVY_ARROWS_BY_PIERCE: BurstSpec[] = [];
const FLURRY_ARROWS_BY_PIERCE: BurstSpec[] = [];
for (let extra = 0; extra <= BOW_PIERCE_BOONS_MAX; extra++) {
	const arrow: BurstSpec = extra === 0 ? ARROW : { ...ARROW, pierce: (ARROW.pierce ?? 0) + extra };
	ARROWS_BY_PIERCE.push(arrow);
	HEAVY_ARROWS_BY_PIERCE.push(
		extra === 0 ? HEAVY_ARROW : { ...HEAVY_ARROW, pierce: (HEAVY_ARROW.pierce ?? 0) + extra },
	);
	FLURRY_ARROWS_BY_PIERCE.push({ ...arrow, count: FLURRY_ARROW_COUNT, spread: FLURRY_ARROW_SPREAD });
}

function arrowSpec(ctx: SimCtx, heavy: boolean, flurry = false): BurstSpec {
	const extra = jsMin(runMods(ctx.state, ctx.playerIndex).bowPierce, BOW_PIERCE_BOONS_MAX);
	if (heavy) return HEAVY_ARROWS_BY_PIERCE[extra];
	return flurry ? FLURRY_ARROWS_BY_PIERCE[extra] : ARROWS_BY_PIERCE[extra];
}

// The stream's wobble: the spiral step (63/65, ~14.25 degrees) halved three times with sqrt (~1.78 degrees).
// Computed once at load from IEEE-exact operations, so it is the same number everywhere.
const wobble: Dir = { x: 1, z: 0 };
halfRotation(TURN_COS, wobble);
halfRotation(wobble.x, wobble);
halfRotation(wobble.x, wobble);
/** cos / sin of the stream's side step. */
export const BOW_WOBBLE_COS = wobble.x;
export const BOW_WOBBLE_SIN = wobble.z;
/** Side step per stream arrow: 0, +1, 0, -1 (times the wobble angle). */
const WOBBLE_PATTERN = [0, 1, 0, -1] as const;
/** V_SHOT wraps with `& 3`. */
const WOBBLE_MASK = 3;

const dir: Dir = { x: 0, z: 1 };

function muzzleFire(ctx: SimCtx, slot: WeaponSlotState, dirX: number, dirZ: number, spec: BurstSpec): number {
	const p = ctx.player;
	return ctx.firePlayer(slot, p.x + dirX * PLAYER_MUZZLE_OFFSET, p.z + dirZ * PLAYER_MUZZLE_OFFSET, dirX, dirZ, spec);
}

export const BOW = registerWeapon<BowData>({
	id: "weapon.bow",
	data: BOW_DATA,
	trigger: "hold",
	step(ctx, slot) {
		const v = slot.v;
		if (ctx.events.weaponSwapped !== 0 || ctx.player.rollTicks > 0) {
			v[BOW_V_CHARGE] = 0; // a swap (in) or a roll cancels the charge
			return;
		}
		if (altHeld(ctx)) {
			if (v[BOW_V_CHARGE] < BOW_DATA.chargeTicks) v[BOW_V_CHARGE]++;
			return;
		}
		if (v[BOW_V_CHARGE] === 0) return;
		// ALT released this tick.
		if (v[BOW_V_CHARGE] >= BOW_DATA.chargeTicks) {
			const p = ctx.player;
			muzzleFire(ctx, slot, p.faceX, p.faceZ, arrowSpec(ctx, true));
			v[BOW_V_HEAVY_TICK] = ctx.tick + 1;
			if (slot.cooldown < BOW_DATA.heavyRecoverTicks) slot.cooldown = BOW_DATA.heavyRecoverTicks;
		}
		v[BOW_V_CHARGE] = 0;
	},
	fire(ctx, slot) {
		if (slot.v[BOW_V_CHARGE] > 0 || altHeld(ctx)) return false; // drawing a heavy arrow: no stream
		const p = ctx.player;
		const side = WOBBLE_PATTERN[slot.v[BOW_V_SHOT]];
		// Builds (docs/BUILDS.md BU5, opt-in): Flurry makes every 6th stream arrow a triple.
		const flurry = ctx.state.builds !== undefined && buildsFlurryArrow(ctx);
		const spec = arrowSpec(ctx, false, flurry);
		let n: number;
		if (side === 0) {
			n = muzzleFire(ctx, slot, p.faceX, p.faceZ, spec);
		} else {
			rotateDir(p.faceX, p.faceZ, BOW_WOBBLE_COS, side * BOW_WOBBLE_SIN, dir);
			n = muzzleFire(ctx, slot, dir.x, dir.z, spec);
		}
		if (flurry) buildsFlurryArrowsFired(ctx, p.x, p.z, n);
		slot.v[BOW_V_SHOT] = bit32.band(slot.v[BOW_V_SHOT] + 1, WOBBLE_MASK);
		return true;
	},
	moveMultiplier(slot) {
		return slot.v[BOW_V_CHARGE] > 0 ? BOW_DATA.chargeMoveMultiplier : 1;
	},
});

/** Charge progress 0..1 of a bow slot (render / UI). */
export function bowCharge(slot: Readonly<WeaponSlotState>): number {
	return jsMin(1, slot.v[BOW_V_CHARGE] / BOW_DATA.chargeTicks);
}
