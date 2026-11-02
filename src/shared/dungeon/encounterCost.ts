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
	// Roblox port: the endless room enemies of docs/ENEMY_VARIANTS.md (EVD1). `slime.small` (the split) is never
	// bought, so it has no row; the slime's cost includes its split.
	["imp", 2],
	["slime", 3],
	["summoner", 3],
	// Roblox port: the second set of endless room enemies (docs/NEW_ENEMIES.md NE1). Rows only: nothing buys them
	// until NE7 appends them to ENDLESS_ROOM_KINDS.
	["bomber", 2],
	["charger", 3],
	["stormcaller", 3],
	["warbanner", 2],
	["reaper", 3],
]);
/** Cost of an archetype id not in the table (never 0, so every spawn counts). */
export const DEFAULT_ENCOUNTER_COST = 1;
export function encounterCost(archetypeId: string): number {
	return ENCOUNTER_COST.get(archetypeId) ?? DEFAULT_ENCOUNTER_COST;
}
