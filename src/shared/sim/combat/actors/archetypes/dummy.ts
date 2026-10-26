/**
 * 'dummy' (Roblox port, docs/TUTORIAL.md T3; no web source): the Training Dummy of the tutorial's first combat room.
 * A target, not an enemy that fights: it never moves, turns, attacks or fires (no telegraph, no bullets), and its body
 * is harmless (contactDamage 0). Everything else is the generic actor path: it takes damage (hit flash, health bar,
 * damage numbers), dies when hp reaches 0, lingers as a corpse for the default CORPSE_TICKS, and counts as a kill
 * (events.enemiesKilled, score, telemetry) like any enemy.
 *
 * Registered in band PORT_BAND_TUTORIAL, so its kind (index 7) comes after the whole web table and no web archetype's
 * index moves. It is in no random pool (dungeon/endlessData ENDLESS_ROOM_KINDS, enemyRooms populateEnemies): only
 * an explicit `{ kind: DUMMY_KIND }` spawn places it. dungeon/encounterCost has no entry on purpose (it is not bought
 * with a budget), so room par time uses DEFAULT_ENCOUNTER_COST (1).
 */

import { PORT_BAND_TUTORIAL, registerArchetype } from "../registry";
import type { ArchetypeData } from "../types";

/** The archetype id (an encounter spawn's `kind`). */
export const DUMMY_KIND = "dummy";

/**
 * Hit points. The sword's combo deals 3, 3, then 6 (weapons/defs/sword.ts SWORD_DATA.damage / finisherDamage):
 * swings 1 and 2 leave it at 2 hp and the finisher kills it, so a first-time player sees the whole combo land.
 * With the bow (1 per arrow) it takes 8 arrows. Endless runs scale it like any actor (endlessActorHp).
 */
const DUMMY_HP = 8;
/** Body radius, world units: a slim post (the swarmer is 0.3, the bruiser 0.5). */
const DUMMY_RADIUS = 0.35;

export const DUMMY = registerArchetype<ArchetypeData>({
	id: DUMMY_KIND,
	band: PORT_BAND_TUTORIAL,
	data: {
		hp: DUMMY_HP,
		radius: DUMMY_RADIUS,
		speed: 0,
		contactDamage: 0,
		spriteId: "enemy.dummy",
	},
	step() {},
});
