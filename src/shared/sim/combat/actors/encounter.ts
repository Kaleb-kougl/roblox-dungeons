/**
 * Encounter config (E1.8; source: `src/sim/actors/encounter.ts`): what stands where at run start, plus the room
 * geometry AI needs. Built once per run OUTSIDE the sim by a pure function of the dungeon (placeEncounter) and handed
 * in as SimConfig.encounter, so live play and replays rebuild the same world. Plain data; never mutated.
 *
 * The canonical definitions live in `shared/dungeon` (encounterTypes.ts), which never imports the sim; the sim
 * re-exports them so `placeEncounter(d, DEFAULT_ENCOUNTER)` plugs straight into SimConfig.encounter.
 */

export { EMPTY_ENCOUNTER, roomAt } from "shared/dungeon";
export type { ActorSpawn, EncounterConfig, EncounterRoom, EncounterRoomType } from "shared/dungeon";
