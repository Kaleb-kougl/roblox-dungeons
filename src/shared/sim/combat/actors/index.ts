/** Public API of the actor system (E1.8; source: `src/sim/actors/index.ts`), plus every archetype's exports. */
export { ACTOR_HASH_FIELDS, ACTOR_SCRATCH_SLOTS, AiState, NO_KIND } from "./types";
export type { ActorScalarField, ActorState, ArchetypeData, ArchetypeDef } from "./types";
export { archetypeAt, archetypeIds, archetypeIndex, hasArchetype, registerArchetype } from "./registry";
export { faceToward, lineOfSight, moveActor, toPlayer, walkToward, type ToPlayer } from "./helpers";
export { EMPTY_ENCOUNTER, roomAt } from "./encounter";
export type { ActorSpawn, EncounterConfig, EncounterRoom, EncounterRoomType } from "./encounter";
export { isActorPresent } from "./actors";
export * from "./archetypes";
