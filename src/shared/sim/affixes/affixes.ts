/**
 * Elite affixes in the sim (docs/ENEMY_VARIANTS.md EV7; a Roblox-port feature, no web source). OPT-IN like drops: only
 * a SimConfig with `affixes` creates `SimState.affixes`, and only then is anything here reached or the hash's "affixes"
 * group written (appended after every other group, after "drops"). Without it (M1, every golden fixture, the tutorial)
 * every hook below is a no-op and every read neutral.
 *
 * State: one AffixSlot per actor slot (state.affixes.slots[i] mirrors state.combat.actors[i]; grown with the pool by
 * spawnActor, reset when a slot is (re)used or freed). `actorId` guards against a stale slot: a read only counts when it
 * equals the actor's id. Affixes come only from the endless room spawn path (sim endless.ts enterRoom: a planned spawn's
 * affix from EndlessFloorWorld.roomAffixes, stamped by spawnActor BEFORE def.init, so Swift scales the first
 * cooldown drawn in init). Runtime spawns (summons, splits, boss adds) and initial spawns never carry one.
 *
 * Rules (AFFIX_RULES; ids are shared/dungeon AffixKind):
 *   Hulking   hp x hulkingHpPercent and radius x hulkingRadiusPercent at the stamp; walk x hulkingWalkPercent
 *   Swift     walk x swiftWalkPercent, attack cooldowns x swiftCooldownPercent (actorMods.ts: actorWalkPercent /
 *             actorCooldownPercent; telegraphs never shorten)
 *   Shielded  shield = shieldHpPercent of its hp at the stamp; damageActor hands it the damage AFTER filterDamage and
 *             BEFORE the damage cap (affixAbsorb): the shield takes what it can, the rest goes on; any damage resets
 *             the idle timer; stepAffixes refills it fully after shieldRefillTicks ticks without damage
 *   Vengeful  killActor arms it (affixesOnKill: vengeArmTick = the kill tick); the corpse is held past its corpse time
 *             while armed (stepActors asks affixHoldsCorpse, never def.stepDead); stepAffixes fires the bruiser's gapped
 *             ring from the corpse vengefulTelegraphTicks after the kill (./stepAffixes.ts)
 * Rewards (EVD8): an affixed kill scores x killPointsPercent (scoreKill, combined with Bounty), adds dropChanceBonus
 * points to its drop chance (dropsOnKill); each affixed planned member adds AFFIX_PAR_COST to its room's par.
 *
 * Events (AffixEvents) are presentation only: cleared every tick, NOT hashed.
 */
import { AffixKind } from "shared/dungeon";
import type { SimState } from "../state";
import type { ActorState } from "../combat/actors/types";
import { PERCENT } from "../progression/progressionData";
import { combinedPercent, scalePercent } from "../progression/runMods";
import { AFFIX_RULES, type AffixRules } from "./affixesData";

// ---------------------------------------------------------------------------------------------
// Config

/** SimConfig.affixes: presence turns affixes on; the rules (AFFIXES_CONFIG is the game's). */
export type AffixesConfig = AffixRules;

/** The game's affixes config (endless solo and co-op). */
export const AFFIXES_CONFIG: AffixesConfig = AFFIX_RULES;

// ---------------------------------------------------------------------------------------------
// State

/** One actor slot's affix. Plain numbers, every field hashed. A free / unaffixed slot is all 0 (vengeArmTick -1). */
export interface AffixSlot {
	/** shared/dungeon AffixKind (0 = none). */
	affix: number;
	/** ActorState.id of the actor it was stamped on (0 = none): the stale-slot guard. */
	actorId: number;
	/** Shielded: shield hp left, and its full value (set at the stamp). */
	shield: number;
	shieldMax: number;
	/** Shielded: ticks since the last damage (counts while the shield is below full). */
	shieldIdleTicks: number;
	/** Vengeful: ticks until the ring fires (0 = not armed or fired). */
	vengeTicks: number;
	/** Vengeful: the tick it was armed (the kill tick), -1 = never. Pacts runs: 1 later per frozen tick while armed. */
	vengeArmTick: number;
}

/** One affix event (presentation): the actor slot, its id and position, and an amount (shield hits: absorbed). */
export interface AffixEvent {
	readonly slot: number;
	readonly actorId: number;
	readonly affix: number;
	readonly x: number;
	readonly z: number;
	readonly amount: number;
}

/**
 * Per tick, presentation only (cleared every tick, NOT hashed); each list in the order things happened. A slot named
 * here may be freed by the end of the tick; check actorId against the slot's actor.
 */
export interface AffixEvents {
	/** A shield absorbed damage (amount = absorbed): the shield-colour hit flash. */
	shieldHits: AffixEvent[];
	/** A shield reached 0 (amount = absorbed by the breaking hit): sfx.affix.shieldBreak. */
	shieldBroke: AffixEvent[];
	/** A shield refilled (amount = the shield). */
	shieldRefilled: AffixEvent[];
	/** A Vengeful actor died and its corpse started its telegraph (amount = telegraph ticks). */
	vengefulArmed: AffixEvent[];
	/** A Vengeful corpse fired its ring (amount = bullets spawned): sfx.affix.vengeful. */
	vengefulFired: AffixEvent[];
}

/** SimState.affixes. */
export interface AffixesState {
	/** The run's rules (config, constant for the run: not hashed). */
	readonly config: Readonly<AffixesConfig>;
	/** One per actor slot (same index), grown with the pool. */
	slots: AffixSlot[];
	/** NOT hashed. */
	events: AffixEvents;
}

function freeSlot(): AffixSlot {
	return {
		affix: AffixKind.NONE,
		actorId: 0,
		shield: 0,
		shieldMax: 0,
		shieldIdleTicks: 0,
		vengeTicks: 0,
		vengeArmTick: -1,
	};
}

function clearSlot(s: AffixSlot): void {
	s.affix = AffixKind.NONE;
	s.actorId = 0;
	s.shield = 0;
	s.shieldMax = 0;
	s.shieldIdleTicks = 0;
	s.vengeTicks = 0;
	s.vengeArmTick = -1;
}

function emptyEvents(): AffixEvents {
	return { shieldHits: [], shieldBroke: [], shieldRefilled: [], vengefulArmed: [], vengefulFired: [] };
}

/** Affixes state at run start: one free slot per actor slot already in the pool (`actorSlots`). No rng. */
export function createAffixesState(config: Readonly<AffixesConfig>, actorSlots = 0): AffixesState {
	const slots: AffixSlot[] = [];
	for (let i = 0; i < actorSlots; i++) slots.push(freeSlot());
	return { config, slots, events: emptyEvents() };
}

export function cloneAffixesState(s: Readonly<AffixesState>): AffixesState {
	const e = s.events;
	return {
		config: s.config,
		slots: s.slots.map((x) => ({ ...x })),
		events: {
			shieldHits: [...e.shieldHits],
			shieldBroke: [...e.shieldBroke],
			shieldRefilled: [...e.shieldRefilled],
			vengefulArmed: [...e.vengefulArmed],
			vengefulFired: [...e.vengefulFired],
		},
	};
}

/** Start of every tick (step / stepParty, with the other event clears; frozen draft ticks too). */
export function clearAffixEvents(s: AffixesState): void {
	const e = s.events;
	e.shieldHits.clear();
	e.shieldBroke.clear();
	e.shieldRefilled.clear();
	e.vengefulArmed.clear();
	e.vengefulFired.clear();
}

/** Grows the slots to `n` (the actor pool's size). A `while` loop: the bound changes. */
function ensureSlots(s: AffixesState, n: number): void {
	while (s.slots.size() < n) s.slots.push(freeSlot());
}

export function affixEvent(slot: number, a: Readonly<ActorState>, affix: number, amount: number): AffixEvent {
	return { slot, actorId: a.id, affix, x: a.x, z: a.z, amount };
}

// ---------------------------------------------------------------------------------------------
// Reads

/** The live affix slot of actor slot `slot` holding `a` (the actorId guard), else undefined. */
export function affixSlotAt(state: Readonly<SimState>, slot: number, a: Readonly<ActorState>): AffixSlot | undefined {
	const s = state.affixes?.slots[slot];
	if (s === undefined || s.affix === AffixKind.NONE || s.actorId !== a.id || a.id === 0) return undefined;
	return s;
}

/** `a`'s live affix slot (found by its pool index), else undefined. Undefined without state.affixes. */
export function affixSlotOf(state: Readonly<SimState>, a: Readonly<ActorState>): AffixSlot | undefined {
	if (state.affixes === undefined) return undefined;
	return affixSlotAt(state, state.combat.actors.indexOf(a as ActorState), a);
}

/** `a`'s affix (AffixKind; NONE without one or without state.affixes). */
export function actorAffix(state: Readonly<SimState>, a: Readonly<ActorState>): number {
	return affixSlotOf(state, a)?.affix ?? AffixKind.NONE;
}

/** The affix percent on `a`'s walk step (PERCENT unless Hulking or Swift). */
export function affixWalkPercent(state: Readonly<SimState>, a: Readonly<ActorState>): number {
	const s = state.affixes;
	if (s === undefined) return PERCENT;
	const affix = actorAffix(state, a);
	if (affix === AffixKind.HULKING) return s.config.hulkingWalkPercent;
	if (affix === AffixKind.SWIFT) return s.config.swiftWalkPercent;
	return PERCENT;
}

/** The affix percent on `a`'s attack cooldowns (PERCENT unless Swift). */
export function affixCooldownPercent(state: Readonly<SimState>, a: Readonly<ActorState>): number {
	const s = state.affixes;
	if (s === undefined) return PERCENT;
	return actorAffix(state, a) === AffixKind.SWIFT ? s.config.swiftCooldownPercent : PERCENT;
}

/** scoreKill: the kill's bonus percent `bonus` (Bounty), times killPointsPercent when `a` carries an affix. */
export function affixKillPercent(state: Readonly<SimState>, a: Readonly<ActorState>, bonus: number): number {
	const s = state.affixes;
	if (s === undefined || actorAffix(state, a) === AffixKind.NONE) return bonus;
	return combinedPercent(bonus, s.config.killPointsPercent);
}

/** dropsOnKill: percentage points added to `a`'s drop chance (dropChanceBonus when affixed, else 0). */
export function affixDropBonus(state: Readonly<SimState>, a: Readonly<ActorState>): number {
	const s = state.affixes;
	if (s === undefined || actorAffix(state, a) === AffixKind.NONE) return 0;
	return s.config.dropChanceBonus;
}

/** stepActors: true while actor slot `slot`'s corpse `a` has a Vengeful ring pending (the corpse is not freed). */
export function affixHoldsCorpse(state: Readonly<SimState>, slot: number, a: Readonly<ActorState>): boolean {
	const s = affixSlotAt(state, slot, a);
	return s !== undefined && s.vengeTicks > 0;
}

// ---------------------------------------------------------------------------------------------
// Hooks (actors.ts)

/**
 * spawnActor, after the slot's hp / radius are set and BEFORE def.init: grows the slots with the pool, resets slot
 * `slot`, then stamps `affix` (0: none) on `a`: Hulking scales hp (hp and hpMax) and radius, Shielded gets its shield.
 */
export function affixesOnSpawn(state: SimState, slot: number, a: ActorState, affix: number): void {
	const s = state.affixes;
	if (s === undefined) return;
	ensureSlots(s, state.combat.actors.size());
	const x = s.slots[slot];
	clearSlot(x);
	if (affix === AffixKind.NONE) return;
	const c = s.config;
	x.affix = affix;
	x.actorId = a.id;
	if (affix === AffixKind.HULKING) {
		a.hp = scalePercent(a.hp, c.hulkingHpPercent);
		a.hpMax = a.hp;
		a.radius = scalePercent(a.radius, c.hulkingRadiusPercent);
	} else if (affix === AffixKind.SHIELDED) {
		x.shieldMax = scalePercent(a.hpMax, c.shieldHpPercent);
		x.shield = x.shieldMax;
	}
}

/** freeActor (before the slot is cleared): the slot's affix goes with it (a pending Vengeful ring never fires). */
export function affixesOnFree(state: SimState, a: Readonly<ActorState>): void {
	const s = state.affixes;
	if (s === undefined) return;
	const slot = state.combat.actors.indexOf(a as ActorState);
	const x = s.slots[slot];
	if (x !== undefined) clearSlot(x);
}

/**
 * damageActor, after filterDamage and before the damage cap: a Shielded actor's shield takes what it can of `dmg`
 * (> 0); the idle timer restarts. Returns the damage left for hp. `dmg` itself for anyone else.
 */
export function affixAbsorb(state: SimState, a: Readonly<ActorState>, dmg: number): number {
	const s = state.affixes;
	if (s === undefined || !(dmg > 0)) return dmg;
	const slot = state.combat.actors.indexOf(a as ActorState);
	const x = affixSlotAt(state, slot, a);
	if (x === undefined || x.affix !== AffixKind.SHIELDED) return dmg;
	x.shieldIdleTicks = 0;
	if (x.shield <= 0) return dmg;
	const absorbed = dmg < x.shield ? dmg : x.shield;
	x.shield -= absorbed;
	const ev = affixEvent(slot, a, x.affix, absorbed);
	s.events.shieldHits.push(ev);
	if (x.shield <= 0) {
		x.shield = 0;
		s.events.shieldBroke.push(ev);
	}
	return dmg - absorbed;
}

/** killActor: a Vengeful actor's corpse arms its ring (fires vengefulTelegraphTicks after this tick). */
export function affixesOnKill(state: SimState, a: Readonly<ActorState>): void {
	const s = state.affixes;
	if (s === undefined) return;
	const slot = state.combat.actors.indexOf(a as ActorState);
	const x = affixSlotAt(state, slot, a);
	if (x === undefined || x.affix !== AffixKind.VENGEFUL || x.vengeArmTick >= 0) return;
	x.vengeArmTick = state.tick;
	x.vengeTicks = s.config.vengefulTelegraphTicks;
	s.events.vengefulArmed.push(affixEvent(slot, a, x.affix, x.vengeTicks));
}

// ---------------------------------------------------------------------------------------------
// Hash: the "affixes" group, appended after every other group (after "drops") only when state.affixes exists.
//   slots.length, per slot AFFIX_SLOT_HASH_FIELDS

/** Per slot, in this order (dump names `affixes.slots[<slot>].<name>`). Append only. */
export const AFFIX_SLOT_HASH_FIELDS = [
	"affix",
	"actorId",
	"shield",
	"shieldMax",
	"shieldIdleTicks",
	"vengeTicks",
	"vengeArmTick",
] as const;

export function writeAffixesHash(s: Readonly<AffixesState>, out: number[]): void {
	out.push(s.slots.size());
	for (const x of s.slots) for (const f of AFFIX_SLOT_HASH_FIELDS) out.push(x[f]);
}

/** Dump names for writeAffixesHash, same order. */
export function affixesHashNames(s: Readonly<AffixesState>, out: string[]): void {
	out.push("affixes.slots.length");
	for (let i = 0; i < s.slots.size(); i++)
		for (const f of AFFIX_SLOT_HASH_FIELDS) out.push(`affixes.slots[${i}].${f}`);
}
