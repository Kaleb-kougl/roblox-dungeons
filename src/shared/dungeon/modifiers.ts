/**
 * Floor modifiers (docs/FLOOR_MODIFIERS.md FM1 / FM2, decisions FMD2-FMD7; a Roblox-port feature, no web source): which
 * endless floor is special and how. Decided when the floor is built, a PURE function of the floor like the rest of
 * ./endless.ts, so live play, every co-op client, the server's validator and a daily seed agree, and the sim draws
 * nothing for it (wave 1 is all floor-built: no sim state, docs/FLOOR_MODIFIERS.md "Sim impact").
 *
 *   stream   its own: new EncounterRng(modifierSeed(floor seed)) = mulberry32 from (seed ^ MODIFIERS.salt). No placer
 *            reads it, so a floor without a modifier is exactly the option-off floor.
 *   floors   none below MODIFIERS.fromFloor (no draw), none on a boss floor (no draw), none when floor n - 1's chance
 *            draw hit (modifierChanceHit on floor n - 1's seed, when n - 1 >= fromFloor and is not a boss floor: its draw
 *            alone, no build; a hit with no eligible kind still counts).
 *   chance   ONE draw rng.int(0, percentRange - 1) < modifierChancePercent(floor) (the depth band's percent).
 *   kind     on a hit ONE weighted draw rng.int(0, total weight - 1) over MODIFIERS.kinds gives a start index; the kinds
 *            are tried in table order from it (wrapping) and the FIRST eligible one wins (never a reroll). None
 *            eligible: no modifier.
 *   draws    0, 1 (a miss) or 2.
 *   eligible (floorModifierEligible, FMD3 "only where certain", FMD7) read from the floor built WITHOUT modifiers:
 *            gilded     the world runs the Goldling, floor >= GOLDEN_PLACE.fromFloor, goldenEligibleRooms non-empty and
 *                       the natural roll missed (no Goldling)
 *            hoard      vaults on, floor >= VAULT.fromFloor, vaultRooms non-empty and the natural roll missed (no vault)
 *            feast      the world runs pellets, floor >= PELLETS.power.fromFloor, some room got pellets and the natural
 *                       roll missed (no power pellet)
 *            plunder    the world runs breakable loot and at least MODIFIERS.plunder.minRooms rooms hold a weighted
 *                       piece (breakableLootRooms)
 *            bloodMoon  the world runs affixes, floor >= AFFIXES.eliteFromFloor, and the doubled shares
 *                       (assignAffixes with MODIFIERS.bloodMoon.sharePercent) affix at least minExtra more planned
 *                       members than the natural assignment, outside the boss room
 *   override (FloorModifierOverride, the dev world's KV_FloorModifier) `kind` on every floor from MODIFIERS.fromFloor
 *            where it is eligible, boss floors included, ignoring the chance and the streak; no modifier elsewhere.
 *
 * Effects (buildEndlessFloor): the affected placer re-runs with its force flag (placeGolden certain, placeVault every,
 * placePellets powerCertain, placeBreakableLoot everyRoom, assignAffixes sharePercent) and every placer after it in the
 * build order; a forced chance draw is still made, so the draws after it are a natural hit's.
 *
 * @module
 */
import { u32 } from "shared/jsmath";
import { EncounterRng } from "./encounter";
import type { BreakableFloorInput, BreakablePlacement } from "./breakables";
import { assignAffixes, countAffixed } from "./affixes";
import { AFFIXES } from "./affixesData";
import { breakableLootRooms } from "./breakableLoot";
import { NO_POWER_PELLET, type FloorPellets } from "./pellets";
import { PELLETS } from "./pelletsData";
import { vaultChest, vaultRooms, type VaultPlan } from "./vault";
import { VAULT } from "./vaultData";
import { goldenEligibleRooms, type FloorGolden } from "./golden";
import { GOLDEN_PLACE } from "./goldenData";
import { FloorModifier, MODIFIERS, floorModifierKind, type FloorModifierId } from "./modifiersData";

/**
 * The floor parts a world's sim runs (shared/sim SimConfig.golden / pellets / drops.breakableLoot / affixes, and the
 * vaults of EndlessFloorOptions.vaults), so a modifier is only picked where the sim will show its effect (FMD3).
 */
export interface FloorModifierWorld {
	readonly golden: boolean;
	readonly pellets: boolean;
	readonly breakableLoot: boolean;
	readonly affixes: boolean;
}

/** FloorModifierWorld plus the vaults (EndlessFloorOptions.vaults): what eligibility reads of the world. */
export interface FloorModifierParts extends FloorModifierWorld {
	readonly vaults: boolean;
}

/** Every part on: what every endless world runs (shared/run ENDLESS_MODIFIER_WORLD), and the specs' default. */
export const FLOOR_MODIFIER_WORLD_ALL: FloorModifierWorld = table.freeze({
	golden: true,
	pellets: true,
	breakableLoot: true,
	affixes: true,
});

/**
 * Dev world only (KV_FloorModifier, docs/FLOOR_MODIFIERS.md FM4): `kind` on every floor from MODIFIERS.fromFloor where
 * it is eligible (boss floors too), ignoring the chance and the streak; elsewhere none. Never reaches the server (the
 * dev world is server-refused).
 */
export interface FloorModifierOverride {
	readonly every: true;
	readonly kind: FloorModifierId;
}

/** What the pick reads of the floor's place in the run (buildEndlessFloor: floorModifierPickInput). */
export interface FloorModifierPickInput {
	readonly floor: number;
	/** floorSeed(runSeed, floor). */
	readonly seed: number;
	readonly bossFloor: boolean;
	/** floorSeed(runSeed, floor - 1) and isBossFloor(floor - 1): the streak rule's floor. */
	readonly prevSeed: number;
	readonly prevBossFloor: boolean;
}

/** What eligibility reads of the floor built WITHOUT modifiers (buildEndlessFloor's natural parts). */
export interface FloorModifierFloor extends BreakableFloorInput {
	readonly floor: number;
	/** The placed pieces, before any vault chest. */
	readonly breakables: ReadonlyArray<BreakablePlacement>;
	/** The natural affixes (assignAffixes without a force). */
	readonly roomAffixes: ReadonlyArray<ReadonlyArray<number>>;
	readonly pellets: FloorPellets;
	/** The natural vault (undefined: the roll missed, vaults off, below fromFloor or no room). */
	readonly vault?: VaultPlan;
	/** The natural Goldling (undefined: the roll missed, below fromFloor or no room). */
	readonly golden?: FloorGolden;
}

/** Seed of the modifier stream: the floor seed with MODIFIERS.salt mixed in (uint32). */
export function modifierSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), MODIFIERS.salt);
}

/** The per-floor chance (percent) on `floor`: 0 below fromFloor, else its depth band's (FMD2). */
export function modifierChancePercent(floor: number): number {
	if (floor < MODIFIERS.fromFloor) return 0;
	let percent = 0;
	for (const b of MODIFIERS.bands) if (floor >= b.fromFloor) percent = b.chancePercent;
	return percent;
}

/** The chance draw on `rng` (a fresh modifier stream). Draws nothing below fromFloor. */
function chanceDraw(rng: EncounterRng, floor: number): boolean {
	if (floor < MODIFIERS.fromFloor) return false;
	return rng.int(0, MODIFIERS.percentRange - 1) < modifierChancePercent(floor);
}

/**
 * The floor's one chance draw (seed `floorSeed`, floor `floor`): true on a hit (whether or not a kind turns out
 * eligible). False below fromFloor. Boss floors are the caller's rule (they never draw). Pure.
 */
export function modifierChanceHit(floorSeed: number, floor: number): boolean {
	return chanceDraw(new EncounterRng(modifierSeed(floorSeed)), floor);
}

/** True when floor n - 1's chance draw hit (n - 1 >= fromFloor, not a boss floor): floor n gets no modifier. */
export function modifierStreakBlocked(input: FloorModifierPickInput): boolean {
	const prev = input.floor - 1;
	return prev >= MODIFIERS.fromFloor && !input.prevBossFloor && modifierChanceHit(input.prevSeed, prev);
}

/** The kind draw's start index into MODIFIERS.kinds: ONE rng.int(0, total weight - 1) walked by weight. */
function kindStart(rng: EncounterRng): number {
	const kinds = MODIFIERS.kinds;
	let total = 0;
	for (const k of kinds) total += k.weight;
	let roll = rng.int(0, total - 1);
	for (let i = 0; i < kinds.size(); i++) {
		if (roll < kinds[i].weight) return i;
		roll -= kinds[i].weight;
	}
	return kinds.size() - 1; // unreachable: the roll is below the total weight
}

/** The floor's assignment with every affix share doubled (Blood Moon's, MODIFIERS.bloodMoon.sharePercent). Pure. */
export function bloodMoonAffixes(floor: FloorModifierFloor): number[][] {
	return assignAffixes(floor.seed, floor.floor, floor.encounter.rooms, floor.roomSpawns, {
		sharePercent: MODIFIERS.bloodMoon.sharePercent,
	});
}

/** The boss room's id on `floor` (the Dungeon's; its planned spawns are always empty on endless floors). */
function bossRoomOf(floor: FloorModifierFloor): number {
	return floor.dungeon.boss;
}

/**
 * Whether modifier `kind` may be picked on the floor built without modifiers `floor`, in a world running `parts` (the
 * file comment's "eligible"). False for NONE and unknown ids. Pure; draws nothing any placer reads.
 */
export function floorModifierEligible(kind: number, floor: FloorModifierFloor, parts: FloorModifierParts): boolean {
	const f = floor.floor;
	if (kind === FloorModifier.GILDED) {
		if (!parts.golden || f < GOLDEN_PLACE.fromFloor || floor.golden !== undefined) return false;
		// The Goldling's room needs a cell for its own barrel or crate (docs/GOLDLING_RUMOURS.md GR1) against every
		// natural piece, the vault's chest included.
		const pieces = floor.vault !== undefined ? [...floor.breakables, vaultChest(floor.vault)] : floor.breakables;
		return goldenEligibleRooms({ ...floor, pieces }).size() > 0;
	}
	if (kind === FloorModifier.HOARD) {
		if (!parts.vaults || f < VAULT.fromFloor || floor.vault !== undefined) return false;
		return vaultRooms(floor, floor.breakables, floor.pellets).size() > 0;
	}
	if (kind === FloorModifier.FEAST) {
		if (!parts.pellets || f < PELLETS.power.fromFloor) return false;
		return floor.pellets.tiles.size() > 0 && floor.pellets.power === NO_POWER_PELLET;
	}
	if (kind === FloorModifier.PLUNDER) {
		if (!parts.breakableLoot) return false;
		return breakableLootRooms(floor.breakables, floor.encounter).size() >= MODIFIERS.plunder.minRooms;
	}
	if (kind === FloorModifier.BLOOD_MOON) {
		if (!parts.affixes || f < AFFIXES.eliteFromFloor) return false;
		const boss = bossRoomOf(floor);
		const extra = countAffixed(bloodMoonAffixes(floor), boss) - countAffixed(floor.roomAffixes, boss);
		return extra >= MODIFIERS.bloodMoon.minExtra;
	}
	return false;
}

/**
 * The modifier of the floor `input` / `floor` (built without modifiers) in a world running `parts`, `override` the dev
 * world's (see the file comment). FloorModifier.NONE when none. Pure and deterministic.
 */
export function pickFloorModifier(
	input: FloorModifierPickInput,
	floor: FloorModifierFloor,
	parts: FloorModifierParts,
	override?: FloorModifierOverride,
): FloorModifierId {
	if (input.floor < MODIFIERS.fromFloor) return FloorModifier.NONE;
	if (override !== undefined && override.every && floorModifierKind(override.kind) !== undefined) {
		return floorModifierEligible(override.kind, floor, parts) ? override.kind : FloorModifier.NONE;
	}
	if (input.bossFloor || modifierStreakBlocked(input)) return FloorModifier.NONE;
	const rng = new EncounterRng(modifierSeed(input.seed));
	if (!chanceDraw(rng, input.floor)) return FloorModifier.NONE;
	const kinds = MODIFIERS.kinds;
	const start = kindStart(rng);
	for (let i = 0; i < kinds.size(); i++) {
		const k = kinds[(start + i) % kinds.size()];
		if (floorModifierEligible(k.id, floor, parts)) return k.id;
	}
	return FloorModifier.NONE;
}
