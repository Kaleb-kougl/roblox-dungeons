/**
 * A hand-built secret room for sim specs (docs/SECRET_ROOMS.md SR2-SR4; never imported by the game): one combat room
 * (FLOOR gx 1..36, gz 8..28, room 0) whose far wall row gz 7 (the room at +z: facing (0, 1)) holds a two-cell crack at
 * (18, 7) and (19, 7), and behind it a 5 x 4 chamber (gx 17..21, gz 3..6) with its chest at (19, 3), walled round,
 * void outside. The grid is the CARVED one (shared/dungeon carveSecret's output: the crack cells and the chamber FLOOR),
 * as the sim steps on it; the pieces are `extra` (slots 0 ..), then the two crack pieces, then the chest. Run as an
 * endless run so the floor's world carries the pieces and the plan (EndlessFloorWorld.breakables / .secret).
 *
 * @module
 */
import {
	TileType,
	actorMover,
	actorSteerMover,
	bodyBlocker,
	bulletBlocker,
	circleMover,
	worldToGrid,
	type BreakablePlacement,
	type Dungeon,
	type FloorSecret,
} from "shared/dungeon";
import type { EncounterRoom } from "shared/dungeon";
import type { ActorSpawn } from "shared/dungeon";
import { VaultTier } from "shared/dungeon";
import type { EndlessFloorWorld } from "../endless";
import type { SimConfig } from "../step";
import { BREAKABLES_CONFIG } from "../breakables/breakables";
import { PLAYER_RADIUS } from "../playerData";

export const ARENA = {
	W: 40,
	H: 32,
	/** The room's floor. */
	room: { x0: 1, x1: 36, z0: 8, z1: 28 },
	/** The wall row (the far wall) and the crack's cells along it. */
	wallZ: 7,
	crackX: 18,
	cells: 2,
	/** The chamber's floor rectangle and its chest. */
	chamber: { x0: 17, y0: 3, w: 5, h: 4 },
	chestX: 19,
	chestY: 3,
	/** Where the player starts: the front box's middle, 3 cells in front of the crack. */
	spawnX: 18.5,
	spawnZ: 10,
} as const;

function tile(gx: number, gz: number): number {
	const r = ARENA.room;
	const c = ARENA.chamber;
	if (gz === ARENA.wallZ && gx >= ARENA.crackX && gx < ARENA.crackX + ARENA.cells) return TileType.FLOOR;
	if (gx >= r.x0 && gx <= r.x1 && gz >= r.z0 && gz <= r.z1) return TileType.FLOOR;
	if (gx >= c.x0 && gx < c.x0 + c.w && gz >= c.y0 && gz < c.y0 + c.h) return TileType.FLOOR;
	if (gx >= r.x0 - 1 && gx <= r.x1 + 1 && gz >= r.z0 - 1 && gz <= r.z1 + 1) return TileType.WALL;
	if (gx >= c.x0 - 1 && gx <= c.x0 + c.w && gz >= c.y0 - 1 && gz <= c.y0 + c.h) return TileType.WALL;
	return TileType.VOID;
}

const grid: number[] = [];
const roomId: number[] = [];
for (let gz = 0; gz < ARENA.H; gz++)
	for (let gx = 0; gx < ARENA.W; gx++) {
		grid.push(tile(gx, gz));
		const r = ARENA.room;
		roomId.push(gx >= r.x0 && gx <= r.x1 && gz >= r.z0 && gz <= r.z1 ? 0 : -1);
	}
/** The carved grid (only the fields the movers and blockers read). */
export const ARENA_MAP = { W: ARENA.W, H: ARENA.H, grid, roomId } as unknown as Dungeon;

/** The arena's one encounter room (its floor box, tile edges included). */
export const ARENA_ROOM: EncounterRoom = {
	id: 0,
	type: "combat",
	depth: 1,
	cx: 18,
	cz: 18,
	minX: ARENA.room.x0 - 0.5,
	maxX: ARENA.room.x1 + 0.5,
	minZ: ARENA.room.z0 - 0.5,
	maxZ: ARENA.room.z1 + 0.5,
	floorTiles: (ARENA.room.x1 - ARENA.room.x0 + 1) * (ARENA.room.z1 - ARENA.room.z0 + 1),
};

/** The arena's FloorSecret with its crack after `pieceCount` pieces (tier RARE unless given). */
export function arenaSecret(pieceCount: number, tier: number = VaultTier.RARE): FloorSecret {
	return {
		room: 0,
		x: ARENA.crackX,
		y: ARENA.wallZ,
		fx: 0,
		fz: 1,
		ax: 1,
		az: 0,
		cells: ARENA.cells,
		x0: ARENA.chamber.x0,
		y0: ARENA.chamber.y0,
		w: ARENA.chamber.w,
		h: ARENA.chamber.h,
		along: ARENA.chamber.w,
		depth: ARENA.chamber.h,
		chestX: ARENA.chestX,
		chestY: ARENA.chestY,
		tier,
		crackSlot: pieceCount,
		chestSlot: pieceCount + ARENA.cells,
		dungeon: ARENA_MAP,
	};
}

/** The arena's pieces: `extra`, then the crack cells, then the chest. */
export function arenaPieces(extra: ReadonlyArray<BreakablePlacement> = []): BreakablePlacement[] {
	const out: BreakablePlacement[] = [...extra];
	for (let c = 0; c < ARENA.cells; c++) out.push({ x: ARENA.crackX + c, y: ARENA.wallZ, kind: "crackedWall" });
	out.push({ x: ARENA.chestX, y: ARENA.chestY, kind: "chest" });
	return out;
}

export interface ArenaOptions {
	/** Pieces before the crack (slots 0 ..). */
	readonly extra?: ReadonlyArray<BreakablePlacement>;
	/** Initial spawns (spawned at run start). */
	readonly spawns?: ReadonlyArray<ActorSpawn>;
	/** The plan's tier. */
	readonly tier?: number;
	/** No plan on the floor (the pieces only). */
	readonly noPlan?: boolean;
	/** The loadout (default: the sword). */
	readonly loadout?: ReadonlyArray<string>;
	/** SimConfig fields merged in last (builds, scoring, secrets, party, ...). */
	readonly extraConfig?: Partial<SimConfig>;
}

/** The arena's floor world (every floor the same). */
export function arenaWorld(o: ArenaOptions = {}): (floor: number) => EndlessFloorWorld {
	const extra = o.extra ?? [];
	const cache = new Map<number, EndlessFloorWorld>();
	return (floor) => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: {
					loadout: o.loadout ?? ["weapon.sword"],
					moveResolver: circleMover(ARENA_MAP, PLAYER_RADIUS),
					actorMover: actorMover(ARENA_MAP),
					actorSteerMover: actorSteerMover(ARENA_MAP),
					isBulletBlocked: bulletBlocker(ARENA_MAP),
					isBodyBlocked: bodyBlocker(ARENA_MAP),
					encounter: { spawns: o.spawns ?? [], rooms: [ARENA_ROOM], entranceRoom: -1, bossRoom: -1 },
				},
				bossFloor: false,
				spawnX: ARENA.spawnX,
				spawnZ: ARENA.spawnZ,
				stairX: 1000,
				stairZ: 1000,
				roomSpawns: [[]],
				roomIdAt: (x, z) => {
					const gx = worldToGrid(x);
					const gz = worldToGrid(z);
					const r = ARENA.room;
					return gx >= r.x0 && gx <= r.x1 && gz >= r.z0 && gz <= r.z1 ? 0 : -1;
				},
				breakables: arenaPieces(extra),
				secret: o.noPlan === true ? undefined : arenaSecret(extra.size(), o.tier),
			};
			cache.set(floor, w);
		}
		return w;
	};
}

/** The arena's run config (endless, breakables on; `seed` is the run seed). */
export function arenaConfig(seed: number, o: ArenaOptions = {}): SimConfig {
	return {
		loadout: o.loadout ?? ["weapon.sword"],
		endless: { runSeed: seed, worldForFloor: arenaWorld(o) },
		breakables: BREAKABLES_CONFIG,
		...o.extraConfig,
	};
}
