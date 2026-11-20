/**
 * Elite affix assignment tunables (docs/ENEMY_VARIANTS.md EV6, decisions EVD6 / EVD7; a Roblox-port feature, no web
 * source). Data only: ./affixes.ts reads it. The sim-side rules (hp / radius / walk / cooldown percents, the shield,
 * the Vengeful ring, the rewards) live in shared/sim affixes/affixesData.ts.
 *
 * Affix ids are NUMBERS here and in the sim (a planned spawn's affix, `state.affixes` slots, the hash). The theme names
 * the same affixes by string in the same order (shared/theme variants.ts `AFFIX_IDS`: "hulking", "swift", "shielded",
 * "vengeful"); the dungeon never imports the theme, so the mapping is this enum: AFFIX_IDS[k - 1] is AffixKind k
 * (affixThemeIndex). 0 (AffixKind.NONE) is "no affix".
 *
 * @module
 */
import type { EncounterRoomType } from "./encounterTypes";

/** Numeric affix ids (theme AFFIX_IDS[id - 1]). Append only: they are recorded in replays through the hash. */
export const AffixKind = {
	NONE: 0,
	HULKING: 1,
	SWIFT: 2,
	SHIELDED: 3,
	VENGEFUL: 4,
} as const;
/** An affix id: 0 for none, 1..AFFIX_KIND_COUNT for an affix. */
export type AffixKindId = (typeof AffixKind)[keyof typeof AffixKind];

/** Affix ids 1..AFFIX_KIND_COUNT exist. */
export const AFFIX_KIND_COUNT = 4;

/** The index into the theme's AFFIX_IDS of affix `kind` (-1 for NONE or an unknown id). */
export function affixThemeIndex(kind: number): number {
	return kind >= 1 && kind <= AFFIX_KIND_COUNT && kind % 1 === 0 ? kind - 1 : -1;
}

/** One affix's first floor (EVD6). */
export interface AffixUnlock {
	/** The affix id (AffixKind). */
	readonly kind: number;
	/** The first endless floor whose rooms may roll it. */
	readonly fromFloor: number;
}

/** The elite affix assignment's tunables: its rng salt, when each affix unlocks and how many room members take one. */
export interface AffixTunables {
	/**
	 * The assignment's own rng stream: new EncounterRng(floor seed ^ salt), like the boss pick (0x27d4eb2f) and the
	 * breakables (0x5bd1e995). It never touches the Forge's or a room encounter's stream, so layouts, digests, props,
	 * room spawns, breakables and the boss pick are the same with or without affixes. murmur3's c1 (odd).
	 */
	readonly salt: number;
	/** Affixes in id order with their first floor; a floor offers the unlocked ones, in this order. */
	readonly unlocks: ReadonlyArray<AffixUnlock>;
	/** Elite rooms from this floor give eliteSharePercent of their eligible members an affix (rounded up, >= 1). */
	readonly eliteFromFloor: number;
	/** The share of an elite room's eligible members that take an affix, percent. */
	readonly eliteSharePercent: number;
	/** Combat rooms from this floor: each eligible member rolls combatChancePercent for an affix. */
	readonly combatFromFloor: number;
	/** Each eligible member of a combat room's chance of an affix, percent. */
	readonly combatChancePercent: number;
	/** The room types each rule reads. */
	readonly eliteRoomType: EncounterRoomType;
	/** The room type the combat rule reads. */
	readonly combatRoomType: EncounterRoomType;
	/** Archetype ids that never take an affix (the split, the training dummy). */
	readonly excludedKinds: ReadonlyArray<string>;
	/** Archetype id prefixes that never take one (every turret, every boss). */
	readonly excludedPrefixes: ReadonlyArray<string>;
	/** The percent denominator: a percent roll draws rng.int(0, percentRange - 1) and succeeds below the percent. */
	readonly percentRange: number;
}

/** The affix assignment's values. Changing one changes which endless enemies carry an affix. */
export const AFFIXES: AffixTunables = table.freeze({
	salt: 0xcc9e2d51,
	unlocks: table.freeze([
		table.freeze({ kind: AffixKind.HULKING, fromFloor: 4 }),
		table.freeze({ kind: AffixKind.SWIFT, fromFloor: 4 }),
		table.freeze({ kind: AffixKind.SHIELDED, fromFloor: 7 }),
		table.freeze({ kind: AffixKind.VENGEFUL, fromFloor: 9 }),
	]),
	eliteFromFloor: 4,
	eliteSharePercent: 35,
	combatFromFloor: 11,
	combatChancePercent: 10,
	eliteRoomType: "elite",
	combatRoomType: "combat",
	excludedKinds: table.freeze(["slime.small", "dummy"]),
	excludedPrefixes: table.freeze(["turret.", "boss."]),
	percentRange: 100,
});
