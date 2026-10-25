/**
 * Encounter budget cost per archetype id (GDD "Dungeon generation and difficulty"). Shared by endless floor
 * population (budget spending) and scoring (room par time). Data only.
 */
export const ENCOUNTER_COST: ReadonlyMap<string, number> = new Map<string, number>([
	["swarmer", 1],
	["sniper", 2],
	["bruiser", 3],
	["turret.caster", 2],
	["turret.sniper", 2],
	["turret.sprayer", 2],
]);
/** Cost of an archetype id not in the table (never 0, so every spawn counts). */
export const DEFAULT_ENCOUNTER_COST = 1;
export function encounterCost(archetypeId: string): number {
	return ENCOUNTER_COST.get(archetypeId) ?? DEFAULT_ENCOUNTER_COST;
}
