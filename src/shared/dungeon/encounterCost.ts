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
	// Roblox port: the second set of endless room enemies (docs/NEW_ENEMIES.md NE1; bought from floor 2 since NE7).
	["bomber", 2],
	["charger", 3],
	["stormcaller", 3],
	["warbanner", 2],
	["reaper", 3],
	// Roblox port: the third set (docs/NEW_ENEMIES_2.md NX1). Rows only: nothing buys them until NX6 appends them to
	// ENDLESS_ROOM_KINDS. The Pyre-keeper's brazier (`pyre`) is never bought and is no room member, so (like
	// `slime.small`) it has no row.
	["bulwark", 3],
	["chainhook", 3],
	["snatcher", 2],
	["pyrekeeper", 3],
	// Roblox port: the fourth set (docs/NEW_ENEMIES_3.md NT1). Rows only: nothing buys them until NT6 appends them to
	// ENDLESS_ROOM_KINDS. A Jackal costs 1 EACH: every reader but the spender is per spawn (the room record's par, the
	// Horde wave's, the SWIFT countdown), so a pack of three is 3; the spender prices a pack at packOf x this (NT5).
	["mortar", 2],
	["mender", 2],
	["jackal", 1],
]);
/** Cost of an archetype id not in the table (never 0, so every spawn counts). */
export const DEFAULT_ENCOUNTER_COST = 1;
export function encounterCost(archetypeId: string): number {
	return ENCOUNTER_COST.get(archetypeId) ?? DEFAULT_ENCOUNTER_COST;
}
