/**
 * Encounter config: what stands where at run start, plus the room geometry AI needs (arena bounds for bosses).
 * Plain data types, mirroring the web build's src/sim/actors/encounter.ts @ 42897e2, so the sim can import them
 * from `shared/dungeon` without a cycle (the dungeon module never imports the sim). Built once per run OUTSIDE the
 * sim by placeEncounter (./encounter) and handed in as SimConfig.encounter. Never mutated.
 *
 * @module
 */

/** One actor placed at run start: archetype id (e.g. "swarmer", "boss.act1") and world position. */
export interface ActorSpawn {
	/** The archetype id. */
	readonly kind: string;
	/** World x. */
	readonly x: number;
	/** World z. */
	readonly z: number;
}

/** Room types (Dungeon Forge): entrance, combat, elite, treasure, shrine, boss. */
export type EncounterRoomType = "entrance" | "combat" | "elite" | "treasure" | "shrine" | "boss";

/**
 * A dungeon room in world units, for AI. `rooms[i].id === i`.
 *   (cx, cz)               the room's center FLOOR tile (world), where a boss stands
 *   minX..maxX, minZ..maxZ  the bounding box of the room's own floor tiles, tile edges included (world). Corridors are
 *                           not part of a room; use lineOfSight / the tile grid for exact walls.
 */
export interface EncounterRoom {
	/** The room's index in `rooms` (the Forge room id). */
	readonly id: number;
	/** The room's role. */
	readonly type: EncounterRoomType;
	/** Corridor hops from the entrance. */
	readonly depth: number;
	/** World x of the center floor tile. */
	readonly cx: number;
	/** World z of the center floor tile. */
	readonly cz: number;
	/** West edge of the floor tiles' bounding box, world x. */
	readonly minX: number;
	/** East edge of the bounding box, world x. */
	readonly maxX: number;
	/** Low-z edge of the bounding box, world z. */
	readonly minZ: number;
	/** High-z edge of the bounding box, world z. */
	readonly maxZ: number;
	/** Number of floor tiles that belong to the room. */
	readonly floorTiles: number;
}

/**
 * A floor's enemies and rooms as the sim reads them (SimConfig's world): the starting spawns and every room in world
 * units.
 */
export interface EncounterConfig {
	/** Spawned in this order by createSimState (slot i = spawns[i] while the pool has room). */
	readonly spawns: ReadonlyArray<ActorSpawn>;
	/** Every room, indexed by id. Empty in tests without a dungeon. */
	readonly rooms: ReadonlyArray<EncounterRoom>;
	/** Index into rooms, or -1. */
	readonly entranceRoom: number;
	/** Index into rooms, or -1. */
	readonly bossRoom: number;
}

/** No spawns and no rooms: the encounter of a world without a dungeon (tests, the greybox). */
export const EMPTY_ENCOUNTER: EncounterConfig = table.freeze({
	spawns: table.freeze([] as ActorSpawn[]),
	rooms: table.freeze([] as EncounterRoom[]),
	entranceRoom: -1,
	bossRoom: -1,
});

/** The first room whose bounds contain world (x, z), or undefined. Pure. */
export function roomAt(encounter: EncounterConfig, x: number, z: number): EncounterRoom | undefined {
	const rooms = encounter.rooms;
	for (let i = 0; i < rooms.size(); i++) {
		const r = rooms[i];
		if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r;
	}
	return undefined;
}
