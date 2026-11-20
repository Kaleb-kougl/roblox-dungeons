/**
 * A floor's decor scene (docs/DECOR.md R4 / R10): the decor plan plus the floor facts the director and the renderers
 * react to, computed once per floor from the same inputs (pure, deterministic): the boss room's flat fire-pit spots,
 * the stairwell, the shrine and the relic pedestals.
 *
 * The boss ring. The Forge puts the boss floor's braziers in a ring around the boss room's centre, but the decor plan
 * moves every tall piece onto a far wall under the footprint rule, and most of them lose that spot (about 1.4 per
 * floor survive, on far walls). So "the boss ring by phase" (Phase 2 part 3) is drawn as FLAT fire pits at the Forge's
 * own brazier spots in the boss room: a floor-level glow (decor.fx.glow, flat) plus a PointLight, never a standing
 * sprite, so nothing in the arena can hide a bullet. The far-wall braziers the plan kept stay ordinary room braziers.
 *
 * @module
 */
import { TileType, encounterRooms, gridToWorld, tileAt, type Dungeon, type WorldXZ } from "shared/dungeon";
import type { DecorPlan, DecorPlanInput } from "./decorPlan";

/** A spot on the floor, world tiles (x = grid x, z = grid y). */
export interface DecorSpot {
	readonly x: number;
	readonly z: number;
}

/** A relic pedestal of the floor: its TREASURE room (encounter room id) and where it stands. */
export interface DecorPedestalSpot extends DecorSpot {
	readonly room: number;
}

export interface DecorScene {
	readonly plan: DecorPlan;
	/** The endless floor (plan.floor; 1 for M1 and tests). */
	readonly floor: number;
	/**
	 * A boss floor (the endless layout's bossFloor), or undefined when the input does not say (M1): the director then
	 * treats a floor as a boss floor once it has seen a boss.
	 */
	readonly bossFloor: boolean | undefined;
	/** Rooms (Dungeon.rooms; the plan's room ids and state.endless.roomsEntered's indices). */
	readonly roomCount: number;
	/** Room centres (the encounter room's centre floor tile, world): the ignition sweep's fallback origin. */
	readonly roomCentres: ReadonlyArray<DecorSpot>;
	/** Dungeon.boss (the boss / stairwell room), -1 for none. */
	readonly bossRoom: number;
	/** The Forge's brazier spots in the boss room, Forge order: the flat fire pits of the boss ring (file comment). */
	readonly bossRing: ReadonlyArray<DecorSpot>;
	/** The stairwell (world), if the floor has one. */
	readonly stairwell: DecorSpot | undefined;
	/** The first SHRINE room (encounter id) and its centre (the shrine), or -1 / undefined. */
	readonly shrineRoom: number;
	readonly shrine: DecorSpot | undefined;
	/** TREASURE rooms in encounter order (the sim's RunState.pedestalRooms order) and their centres (the pedestals). */
	readonly pedestals: ReadonlyArray<DecorPedestalSpot>;
	/** Breakable cells (tiles), for the debug overlay. */
	readonly breakables: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

/** The Forge's brazier spots on the boss room's floor (cells deduplicated), Forge order. */
export function decorBossRing(d: Dungeon): DecorSpot[] {
	const out: DecorSpot[] = [];
	if (d.boss < 0) return out;
	const seen = new Set<number>();
	for (const p of d.props) {
		if (p.kind !== "brazier") continue;
		if (tileAt(d, p.x, p.y) !== TileType.FLOOR) continue;
		const c = p.y * d.W + p.x;
		const room = p.roomId !== undefined && p.roomId >= 0 ? p.roomId : d.roomId[c];
		if (room !== d.boss || seen.has(c)) continue;
		seen.add(c);
		out.push({ x: gridToWorld(p.x), z: gridToWorld(p.y) });
	}
	return out;
}

/** The scene of `plan` (planned from `input`). `bossFloor`: the endless layout's, undefined for M1 / tests. */
export function decorScene(input: DecorPlanInput, plan: DecorPlan, bossFloor?: boolean): DecorScene {
	const d = input.dungeon;
	const rooms = encounterRooms(d);
	const roomCentres: DecorSpot[] = [];
	const pedestals: DecorPedestalSpot[] = [];
	let shrineRoom = -1;
	let shrine: DecorSpot | undefined;
	for (const r of rooms) {
		roomCentres.push({ x: r.cx, z: r.cz });
		if (r.type === "treasure") pedestals.push({ room: r.id, x: r.cx, z: r.cz });
		else if (r.type === "shrine" && shrineRoom < 0) {
			shrineRoom = r.id;
			shrine = { x: r.cx, z: r.cz };
		}
	}
	const bossRoom = d.boss >= 0 && d.boss < rooms.size() ? d.boss : -1;
	const boss = bossRoom >= 0 ? rooms[bossRoom] : undefined;
	const stair: WorldXZ | undefined = input.stairwell ?? (boss !== undefined ? { x: boss.cx, z: boss.cz } : undefined);
	return {
		plan,
		floor: plan.floor,
		bossFloor,
		roomCount: rooms.size(),
		roomCentres,
		bossRoom,
		bossRing: decorBossRing(d),
		stairwell: stair !== undefined ? { x: stair.x, z: stair.z } : undefined,
		shrineRoom,
		shrine,
		pedestals,
		breakables: input.breakables ?? [],
	};
}
