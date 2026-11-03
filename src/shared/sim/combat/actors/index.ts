/** Public API of the actor system (E1.8; source: `src/sim/actors/index.ts`), plus every archetype's exports. */
export { ACTOR_HASH_FIELDS, ACTOR_SCRATCH_SLOTS, AiState, NO_KIND } from "./types";
export type { ActorScalarField, ActorState, ArchetypeData, ArchetypeDef } from "./types";
export {
	PORT_BAND_BOSSES,
	PORT_BAND_ENEMIES,
	PORT_BAND_ENEMIES_2,
	PORT_BAND_TUTORIAL,
	WEB_ARCHETYPE_BAND,
	archetypeAt,
	archetypeIds,
	archetypeIndex,
	hasArchetype,
	registerArchetype,
	webArchetypeIds,
} from "./registry";
export {
	actorCooldownPercent,
	actorWalkPercent,
	auraCooldownPercent,
	auraWalkPercent,
	enemyCooldown,
	enemyCooldownFixed,
	walkStep,
} from "./actorMods";
export { faceToward, lineOfSight, moveActor, toPlayer, walkToward, type ToPlayer } from "./helpers";
export { EMPTY_ENCOUNTER, roomAt } from "./encounter";
export type { ActorSpawn, EncounterConfig, EncounterRoom, EncounterRoomType } from "./encounter";
export { isActorPresent, spawnActor } from "./actors";
export * from "./archetypes";
