/**
 * The M1 "first fight" room populations (Roblox port of project-kaleb-vale src/bullets/enemyRooms.ts @ 42897e2):
 * DEFAULT_ENCOUNTER.populate. A pure RoomPopulator: the same dungeon always gets the same enemies on the same tiles
 * (per-room rng from placeEncounter, no math.random, no clock).
 *
 * Rules (Act-I style, tuned for the 12-room MVP floor):
 *   - Only rooms on the critical path (the entrance -> boss route, Dungeon Forge edges with isCritical) that are
 *     combat or elite rooms get enemies. Never the entrance (safe start) or the boss room (the boss agent's arena);
 *     treasure / shrine rooms and side rooms stay empty for now.
 *   - Each such room gets 1 group, or 2 when its difficulty (Forge: 0.15 + 0.85 * depth / maxDepth) is at least
 *     TWO_GROUPS_AT, or it is an elite room. A group is one of
 *         swarm    a swarmer pack, 4 (+1 from difficulty 0.4, +2 from 0.7; elite +1, capped at 6)
 *         snipers  1 sniper, 2 from difficulty 0.5 (or in an elite room)
 *         bruiser  a bruiser with 2 swarmers (only from difficulty 0.35, or in an elite room)
 *     drawn from the room's rng with weights that shift toward snipers / bruisers as difficulty grows; a room's two
 *     groups are never the same kind.
 *   - Budget: at most ENEMY_BUDGET actors over the whole floor, split evenly between the populated rooms and capped at
 *     ROOM_CAP per room; a group that doesn't fit is shrunk (packs down to 3), swapped for the snipers that fit, or
 *     dropped.
 *   - Positions are tile centers of the room's own FLOOR tiles with all 8 neighbours FLOOR too and at least
 *     DOOR_CLEARANCE tiles from the room's doorways, relaxed when that leaves too few tiles. Group anchors are spread
 *     apart (best of a few rng draws), packs fill the open tiles nearest their anchor, each sniper gets its own
 *     spread-out tile.
 */
import { stableSort } from "shared/jsmath";
import { tileAt, worldToGrid } from "./collision";
import type { DungeonRng, EncounterOptions, RoomPopulator, RoomTools, TileXZ } from "./encounter";
import type { ActorSpawn, EncounterRoom } from "./encounterTypes";
import { TileType, type Dungeon } from "./forge";

/** Most room enemies on one floor (leaves MAX_ACTORS 64 - 40 = 24 slots for the boss, its adds and later spawns). */
export const ENEMY_BUDGET = 40;
/** Most enemies in one room. */
export const ROOM_CAP = 12;
/** Rooms at least this difficult get two groups. */
export const TWO_GROUPS_AT = 0.55;
/** Spawns keep at least this many tiles from the room's doorways (when the room leaves MIN_TILES that far). */
export const DOOR_CLEARANCE = 3;
const MIN_TILES = 8;
/** Random anchor draws per spread-out tile (the farthest one wins). */
export const SPREAD_TRIES = 6;

/** Archetype ids placed by this populator (registry ids in the sim). */
export const SWARMER_KIND = "swarmer";
export const SNIPER_KIND = "sniper";
export const BRUISER_KIND = "bruiser";
/** The Act I boss archetype id. */
export const BOSS_ACT1_KIND = "boss.act1";

export type EnemyGroupKind = "swarm" | "snipers" | "bruiser";

const GROUP_KINDS: ReadonlyArray<EnemyGroupKind> = ["swarm", "snipers", "bruiser"];

/** Room ids touching a critical-path edge, minus the entrance and the boss room. */
export function criticalPathRooms(d: Dungeon): number[] {
	const on = new Array<boolean>(d.rooms.size(), false);
	for (const e of d.edges) {
		if (!e.isCritical) continue;
		on[e.a] = true;
		on[e.b] = true;
	}
	const out: number[] = [];
	for (let id = 0; id < on.size(); id++) if (on[id] && id !== d.entrance && id !== d.boss) out.push(id);
	return out;
}

/** The critical-path rooms that get enemies (combat / elite). */
export function populatedRooms(d: Dungeon): number[] {
	return criticalPathRooms(d).filter((id) => d.rooms[id].type === "combat" || d.rooms[id].type === "elite");
}

/** Enemy cap for each populated room of `d`. */
export function roomBudget(d: Dungeon): number {
	const n = populatedRooms(d).size();
	return n > 0 ? math.min(ROOM_CAP, math.floor(ENEMY_BUDGET / n)) : 0;
}

function isOpen(d: Dungeon, t: TileXZ): boolean {
	const gx = worldToGrid(t.x);
	const gy = worldToGrid(t.z);
	for (let oy = -1; oy <= 1; oy++)
		for (let ox = -1; ox <= 1; ox++) if (tileAt(d, gx + ox, gy + oy) !== TileType.FLOOR) return false;
	return true;
}

function dist2(a: TileXZ, b: TileXZ): number {
	const dx = a.x - b.x;
	const dz = a.z - b.z;
	return dx * dx + dz * dz;
}

/** Corridor doorway cells (Dungeon.doorway) touching room `roomId` (4-neighbour), as world tile centers. */
export function roomDoorways(d: Dungeon, roomId: number): TileXZ[] {
	const out: TileXZ[] = [];
	const inRoom = (gx: number, gy: number) =>
		gx >= 0 && gy >= 0 && gx < d.W && gy < d.H && d.roomId[gy * d.W + gx] === roomId;
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			if (d.doorway[gy * d.W + gx] === 0) continue;
			if (inRoom(gx + 1, gy) || inRoom(gx - 1, gy) || inRoom(gx, gy + 1) || inRoom(gx, gy - 1))
				out.push({ x: gx, z: gy });
		}
	return out;
}

/** Weighted pick of a group kind; `excluded` (the original's `not`, a Luau keyword) is excluded (the room's other group). */
function pickGroup(
	rng: DungeonRng,
	difficulty: number,
	elite: boolean,
	excluded: EnemyGroupKind | undefined,
): EnemyGroupKind {
	const w: Record<EnemyGroupKind, number> = {
		swarm: 3,
		snipers: difficulty >= 0.3 ? 2 : 1,
		bruiser: elite ? 3 : difficulty >= 0.35 ? 1 + difficulty * 2 : 0,
	};
	if (excluded !== undefined) w[excluded] = 0;
	const total = w.swarm + w.snipers + w.bruiser;
	let r = rng.next() * total;
	for (const k of GROUP_KINDS) {
		if (r < w[k]) return k;
		r -= w[k];
	}
	return GROUP_KINDS.find((k) => w[k] > 0) ?? "swarm";
}

/** Swarmer pack size before the budget. */
function packSize(difficulty: number, elite: boolean): number {
	return math.min(6, 4 + (difficulty >= 0.4 ? 1 : 0) + (difficulty >= 0.7 ? 1 : 0) + (elite ? 1 : 0));
}

/**
 * Best of `tries` random open tiles: the one farthest from every tile in `away` (the first draw when none).
 * With `open` empty the first draw is still made and undefined is returned (the web build would throw when `away`
 * is not empty; unreachable in practice).
 */
export function spreadTile(
	rng: DungeonRng,
	open: ReadonlyArray<TileXZ>,
	away: ReadonlyArray<TileXZ>,
	tries: number,
): TileXZ | undefined {
	let best: TileXZ | undefined = open[math.floor(rng.next() * open.size())];
	if (away.size() === 0 || best === undefined) return best;
	const score = (t: TileXZ) => {
		let m = math.huge;
		for (const a of away) m = math.min(m, dist2(a, t));
		return m;
	};
	let bestScore = score(best);
	for (let i = 1; i < tries; i++) {
		const t = open[math.floor(rng.next() * open.size())];
		const s = score(t);
		if (s > bestScore) {
			best = t;
			bestScore = s;
		}
	}
	return best;
}

/** The `n` free open tiles nearest `anchor` (ties: row-major order, i.e. the floor list order). */
export function nearestFree(
	open: ReadonlyArray<TileXZ>,
	used: ReadonlySet<TileXZ>,
	anchor: TileXZ,
	n: number,
): TileXZ[] {
	const free = open.filter((t) => !used.has(t)).map((t, i) => ({ t, i, d: dist2(t, anchor) }));
	stableSort(free, (a, b) => (a.d !== b.d ? a.d - b.d : a.i - b.i));
	const out: TileXZ[] = [];
	for (let k = 0; k < math.min(n, free.size()); k++) out.push(free[k].t);
	return out;
}

export interface PlannedGroup {
	kind: EnemyGroupKind;
	size: number;
}

/** The groups a room gets (kinds, before placement): exposed for tests and tuning. */
export function planRoom(d: Dungeon, room: EncounterRoom, rng: DungeonRng): PlannedGroup[] {
	const difficulty = d.rooms[room.id].difficulty;
	const elite = room.type === "elite";
	const groups = elite || difficulty >= TWO_GROUPS_AT ? 2 : 1;
	let left = roomBudget(d);
	const out: PlannedGroup[] = [];
	let prev: EnemyGroupKind | undefined;
	for (let g = 0; g < groups; g++) {
		let kind = pickGroup(rng, difficulty, elite, prev);
		let size =
			kind === "swarm"
				? packSize(difficulty, elite)
				: kind === "snipers"
				? elite || difficulty >= 0.5
					? 2
					: 1
				: 3;
		if (size > left) {
			// Doesn't fit: a smaller pack (>= 3), else as many snipers as fit (<= 2), else nothing.
			if (kind === "swarm" && left >= 3) size = left;
			else if (prev !== "snipers" && left >= 1) {
				kind = "snipers";
				size = math.min(2, left);
			} else size = 0;
		}
		if (size <= 0) continue;
		prev = kind;
		out.push({ kind, size });
		left -= size;
	}
	return out;
}

/**
 * The tiles a room's enemies may stand on (see "Positions" at the top of this file): FLOOR tiles with 8 FLOOR
 * neighbours (any floor tile in an odd tiny room), at least DOOR_CLEARANCE tiles from the room's doorways when that
 * leaves MIN_TILES. Row order. Draws nothing from the rng.
 */
export function roomSpawnTiles(d: Dungeon, room: EncounterRoom, tools: RoomTools): TileXZ[] {
	let open = tools.floor().filter((t) => isOpen(d, t));
	if (open.size() < MIN_TILES) open = [...tools.floor()]; // odd tiny room: any floor tile
	const doors = roomDoorways(d, room.id);
	const clear = open.filter((t) => doors.every((door) => dist2(door, t) >= DOOR_CLEARANCE * DOOR_CLEARANCE));
	if (clear.size() >= MIN_TILES) open = clear;
	return open;
}

/** DEFAULT_ENCOUNTER.populate: see the rules at the top of this file. */
export const populateEnemies: RoomPopulator = (room: EncounterRoom, tools: RoomTools): ReadonlyArray<ActorSpawn> => {
	const d = tools.dungeon;
	if (room.id === d.entrance || room.id === d.boss) return [];
	if (!populatedRooms(d).includes(room.id)) return [];
	const rng = tools.rng;
	const open = roomSpawnTiles(d, room, tools);
	if (open.size() === 0) return [];
	const plan = planRoom(d, room, rng);
	const spawns: ActorSpawn[] = [];
	const used = new Set<TileXZ>();
	const anchors: TileXZ[] = [];
	for (const group of plan) {
		const anchor = spreadTile(rng, open, anchors, SPREAD_TRIES)!; // open is not empty
		anchors.push(anchor);
		if (group.kind === "snipers") {
			// Separate tiles, apart from each other and from other groups.
			for (let i = 0; i < group.size; i++) {
				const t =
					i === 0 && !used.has(anchor)
						? anchor
						: spreadTile(
								rng,
								open.filter((o) => !used.has(o)),
								anchors,
								SPREAD_TRIES,
						  );
				if (!t) break;
				used.add(t);
				if (i > 0) anchors.push(t);
				spawns.push({ kind: SNIPER_KIND, x: t.x, z: t.z });
			}
			continue;
		}
		const tiles = nearestFree(open, used, anchor, group.size);
		for (let i = 0; i < tiles.size(); i++) {
			used.add(tiles[i]);
			const kind = group.kind === "bruiser" && i === 0 ? BRUISER_KIND : SWARMER_KIND;
			spawns.push({ kind, x: tiles[i].x, z: tiles[i].z });
		}
	}
	return spawns;
};

/** M1 sandbox: one turret per room in the three rooms nearest the entrance, in this order. */
export const TEST_TURRET_KINDS: ReadonlyArray<string> = ["turret.sprayer", "turret.sniper", "turret.caster"];

/**
 * The game's encounter (project-kaleb-vale src/bullets/defaultEncounter.ts @ 42897e2):
 * no sandbox turrets, swarmer / sniper / bruiser groups in the critical-path rooms, the Act I boss in the boss room.
 */
export const DEFAULT_ENCOUNTER: EncounterOptions = {
	nearest: [],
	populate: populateEnemies,
	boss: BOSS_ACT1_KIND,
};
