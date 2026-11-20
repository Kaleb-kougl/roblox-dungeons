/**
 * Weapon model (E1.8; source: `src/sim/weapons/types.ts`): the player carries WEAPON_SETS weapon sets; each set holds
 * one main weapon (a numeric index into the weapon registry) with its own cooldown and scratch numbers. SWAP switches
 * sets instantly.
 *
 * @module
 */

import type { SimCtx } from "../ctx";

/** Weapon sets the player carries (GDD: two, swapped with SWAP). */
export const WEAPON_SETS = 2;
/** Length of WeaponSlotState.v, the weapon's own numeric scratch slots. */
export const WEAPON_SCRATCH_SLOTS = 8;
/** WeaponSlotState.weapon of an empty slot. */
export const NO_WEAPON = -1;

/** One weapon set's main weapon. Plain numbers, hashed in this order (weapon, cooldown, v). */
export interface WeaponSlotState {
	/** Weapon index (weaponIndex(id)), NO_WEAPON when empty. */
	weapon: number;
	/** Ticks until it can go off again; counted down every tick for EVERY set (swapping does not pause it). */
	cooldown: number;
	/** Weapon scratch (charge, combo step, ...), all 0 at run start. Name your slots with constants. */
	v: number[];
}

/** CombatState.weapons. Plain numbers; hashed field by field (writeWeaponsHash). */
export interface WeaponsState {
	/** Index into sets of the set in hand. */
	activeSet: number;
	/** Last tick's input buttons (press edges for SWAP and press-trigger weapons). */
	prevButtons: number;
	/** The player's emitter id in the player bullet simulation. */
	emitterId: number;
	/** One slot per weapon set, `WEAPON_SETS` long, in set order. A set with no weapon holds `NO_WEAPON`. */
	sets: WeaponSlotState[];
	// Last melee swing (written by sweepArc): tick (-1 none), origin, direction, reach, half-angle cos.
	/** Tick of the last recorded melee swing, -1 before any. The view watches it change to play a swing; hashed. */
	swingTick: number;
	/** Origin x of the last recorded swing, world units. */
	swingX: number;
	/** Origin z of the last recorded swing, world units. */
	swingZ: number;
	/** X of the last recorded swing's unit direction (starts as (0, 1)). */
	swingDirX: number;
	/** Z of the last recorded swing's unit direction. */
	swingDirZ: number;
	/** Reach of the last recorded swing, world units from its origin. */
	swingRadius: number;
	/** Cosine of the last recorded swing's half-angle (1 before any swing). */
	swingHalfCos: number;
}

/**
 * How a weapon attacks: `ranged` fires player bullets, `melee` sweeps arcs. Read by docs and UI only; the sim never
 * branches on it.
 */
export type WeaponStyle = "ranged" | "melee";

/** Gameplay data of a weapon (rule 4). Extend it: `interface BowData extends WeaponData { speed: number }`. */
export interface WeaponData {
	/** Ticks between uses: after fire() returns true, the slot's cooldown is set to this. */
	cooldownTicks: number;
	/** Damage per bullet / per enemy swept (the weapon applies it; generic code does not). */
	damage: number;
	/** 'ranged' fires player bullets, 'melee' sweeps arcs. Docs / UI only. */
	style: WeaponStyle;
	/** Logical theme ID for UI / held-weapon art (optional). */
	spriteId?: string;
}

/**
 * When the generic code calls fire():
 *   'hold'   (default) every tick FIRE is held and the cooldown is 0 (auto-fire)
 *   'press'  only on the FIRE press edge (and cooldown 0)
 *   'custom' never: the weapon's own step() reads the input and acts itself
 * Never while the player is dead or rolling.
 */
export type WeaponTrigger = "hold" | "press" | "custom";

/**
 * A weapon: id, data and behaviour. Hooks run inside the fixed-step sim (determinism rules apply).
 * Hooks are METHODS (roblox-ts calls them with `:`): implement them with method syntax, not arrow properties.
 */
export interface WeaponDef<D extends WeaponData = WeaponData> {
	/** Unique id, lowercase dot-separated, e.g. 'weapon.bow'. */
	readonly id: string;
	/** The weapon's gameplay data. `registerWeapon` checks its `cooldownTicks`, `damage` and `style`. */
	readonly data: D;
	/** When the generic code calls `fire` (see `WeaponTrigger`). Absent: `hold`. */
	readonly trigger?: WeaponTrigger;
	/** Use the weapon now. Return true if it went off (the generic code then sets slot.cooldown). */
	fire(ctx: SimCtx, slot: WeaponSlotState): boolean;
	/** Every tick while this weapon's set is active and the player is alive, before the trigger check. Optional. */
	step?(ctx: SimCtx, slot: WeaponSlotState): void;
	/** Walking speed multiplier while this weapon is in hand, from its slot state only (pure). Optional: 1. */
	moveMultiplier?(slot: Readonly<WeaponSlotState>): number;
	/**
	 * Sword spacing (docs/SWORD_SPACING.md Design 3, SP2): true while this weapon's walk is braked short of contact
	 * enemies (SimConfig.spacing), from its slot state and the tick's buttons only (pure). Optional: never braked.
	 */
	spacing?(slot: Readonly<WeaponSlotState>, buttons: number): boolean;
}
