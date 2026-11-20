/**
 * Floor modifier tunables (docs/FLOOR_MODIFIERS.md FM1, decisions FMD1-FMD7; a Roblox-port feature, no web source):
 * which endless floors are special (Gilded, Hoard, Feast, Plunder, Blood Moon), how often and how the kind is chosen.
 * Data only: ./modifiers.ts reads it, nothing is inline in the logic. A LEAF (no imports).
 *
 * Modifier ids are NUMBERS (EndlessFloorLayout / EndlessFloorWorld.modifier); `key` is the string id the theme and the
 * dev attribute use (`floorMod.<key>.name`, KV_FloorModifier).
 *
 * @module
 */

/** Numeric floor modifier ids. Append only: daily and endless floors are compared across builds by them. */
export const FloorModifier = {
	NONE: 0,
	GILDED: 1,
	BLOOD_MOON: 2,
	HOARD: 3,
	FEAST: 4,
	PLUNDER: 5,
} as const;
export type FloorModifierId = (typeof FloorModifier)[keyof typeof FloorModifier];

/** A boon is good news (gold banner); a twist names an edge and pays with a reward the game already has (FMD1). */
export const FloorModifierClass = {
	BOON: 0,
	TWIST: 1,
} as const;
export type FloorModifierClassId = (typeof FloorModifierClass)[keyof typeof FloorModifierClass];

/** One modifier kind of the pick (MODIFIERS.kinds, table order). */
export interface FloorModifierKind {
	readonly id: FloorModifierId;
	/** The string id (theme keys `floorMod.<key>.*`, the dev attribute's word). */
	readonly key: string;
	readonly class: FloorModifierClassId;
	/** Weight in the one start-index draw (FMD6: the big payoffs rarer). */
	readonly weight: number;
}

/** One depth band of the per-floor chance (FMD2). */
export interface FloorModifierBand {
	/** The band starts on this floor (ascending; the last band whose fromFloor <= floor wins). */
	readonly fromFloor: number;
	/** One draw rng.int(0, percentRange - 1) < chancePercent makes the floor a modifier floor (if a kind is eligible). */
	readonly chancePercent: number;
}

export interface FloorModifierTunables {
	/**
	 * The pick's own rng stream: new EncounterRng(floor seed ^ salt) ("KVFM", like the drops' "KVDR" 0x4b564452 and the
	 * treasure's "KVTR" 0x4b565452), unused elsewhere in src/, scripts/ and fixtures/ (hex and decimal, FM1). Its draws
	 * are the chance draw and, on a hit, the kind draw; no placer reads it, so a floor without a modifier is the
	 * option-off floor exactly.
	 */
	readonly salt: number;
	/** No modifier (and no draw) before this floor (FMD2). */
	readonly fromFloor: number;
	/** The per-floor chance by depth band (FMD2: 20 % floors 2-4, 25 % 5-9, 30 % 10+). */
	readonly bands: ReadonlyArray<FloorModifierBand>;
	/** The percent denominator of the chance draw. */
	readonly percentRange: number;
	/**
	 * The kinds, in the order the pick tries them from the drawn start index (wrapping): the plan's wave 1 table. Weights
	 * FMD6 (Gilded 1, Hoard 1, Feast 2, Plunder 2, Blood Moon 2; FM9 tunes).
	 */
	readonly kinds: ReadonlyArray<FloorModifierKind>;
	readonly plunder: {
		/** Plunder only where at least this many rooms hold a weighted (lootable) piece, so "every room" means something. */
		readonly minRooms: number;
	};
	readonly bloodMoon: {
		/** Blood Moon only where the doubled shares add at least this many affixed planned members (never a non-event). */
		readonly minExtra: number;
		/** Every affix share (elite rooms' share, combat rooms' chance) times sharePercent / 100 (FMD5: "twice"). */
		readonly sharePercent: number;
	};
}

export const MODIFIERS: FloorModifierTunables = table.freeze({
	salt: 0x4b56464d,
	fromFloor: 2,
	bands: table.freeze([
		table.freeze({ fromFloor: 2, chancePercent: 20 }),
		table.freeze({ fromFloor: 5, chancePercent: 25 }),
		table.freeze({ fromFloor: 10, chancePercent: 30 }),
	]),
	percentRange: 100,
	kinds: table.freeze([
		table.freeze({ id: FloorModifier.GILDED, key: "gilded", class: FloorModifierClass.BOON, weight: 1 }),
		table.freeze({ id: FloorModifier.HOARD, key: "hoard", class: FloorModifierClass.BOON, weight: 1 }),
		table.freeze({ id: FloorModifier.FEAST, key: "feast", class: FloorModifierClass.BOON, weight: 2 }),
		table.freeze({ id: FloorModifier.PLUNDER, key: "plunder", class: FloorModifierClass.BOON, weight: 2 }),
		table.freeze({ id: FloorModifier.BLOOD_MOON, key: "bloodMoon", class: FloorModifierClass.TWIST, weight: 2 }),
	] as FloorModifierKind[]),
	plunder: table.freeze({ minRooms: 3 }),
	bloodMoon: table.freeze({ minExtra: 2, sharePercent: 200 }),
});

/** The kind entry of modifier `id` in MODIFIERS.kinds, or undefined (NONE, an unknown id). */
export function floorModifierKind(id: number): FloorModifierKind | undefined {
	for (const k of MODIFIERS.kinds) if (k.id === id) return k;
	return undefined;
}

/** The string id of modifier `id` ("gilded", ..., "bloodMoon"), or undefined for NONE or an unknown id. */
export function floorModifierKey(id: number): string | undefined {
	return floorModifierKind(id)?.key;
}

/** The modifier whose string id is `key` (exact case), or undefined. */
export function floorModifierByKey(key: string): FloorModifierId | undefined {
	for (const k of MODIFIERS.kinds) if (k.key === key) return k.id;
	return undefined;
}

/** True for a twist (Blood Moon), false for a boon, NONE or an unknown id. */
export function isFloorModifierTwist(id: number): boolean {
	return floorModifierKind(id)?.class === FloorModifierClass.TWIST;
}
