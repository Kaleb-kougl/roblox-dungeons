/**
 * The boon draft's rarity roll (M2; split out of progression.ts so sim/builds cards.ts can share it without a require
 * cycle; progression.ts re-exports both). Pure.
 */
import { jsMax, jsMin } from "shared/jsmath";
import {
	LEGENDARY_PERCENT_MAX,
	LEGENDARY_PERCENT_PER_FLOOR,
	RARITY_PERCENT_COMMON,
	RARITY_PERCENT_LEGENDARY,
	RARITY_PERCENT_RARE,
	Rarity,
	type RarityId,
} from "./progressionData";

/**
 * Rarity percents [common, rare, legendary] for a draft after `floorCleared` (1-based): legendary
 * 5 + (floorCleared - 1), at most 15, the rise taken from common; rare stays 25. Integers summing to 100.
 */
export function rarityPercents(floorCleared: number): [number, number, number] {
	const rise = jsMax(0, floorCleared - 1) * LEGENDARY_PERCENT_PER_FLOOR;
	const legendary = jsMin(LEGENDARY_PERCENT_MAX, RARITY_PERCENT_LEGENDARY + rise);
	const common = RARITY_PERCENT_COMMON - (legendary - RARITY_PERCENT_LEGENDARY);
	return [common, RARITY_PERCENT_RARE, legendary];
}

/** The rarity of a roll in [0, 100): [0, legendary) legendary, then rare, then common. */
export function rarityForRoll(roll: number, floorCleared: number): RarityId {
	const percents = rarityPercents(floorCleared);
	const legendary = percents[Rarity.LEGENDARY];
	if (roll < legendary) return Rarity.LEGENDARY;
	if (roll < legendary + percents[Rarity.RARE]) return Rarity.RARE;
	return Rarity.COMMON;
}
