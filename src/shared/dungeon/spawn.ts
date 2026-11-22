/**
 * Player spawn points (Roblox port of the web build's src/boss/spawn.ts @ 42897e2). The web build's
 * `?spawn=boss` URL switch becomes a plain boolean here (a debug attribute decides it on Roblox). Pure functions of
 * the dungeon: the spawn goes into the recording (seed + spawn + inputs), so replays rebuild the same run.
 *
 * @module
 */
import { entranceSpawn, gridToWorld, tileAt, type WorldXZ } from "./collision";
import { TileType, type Dungeon } from "./forge";

const SIDES: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];

function isBossFloor(d: Dungeon, gx: number, gy: number): boolean {
	return tileAt(d, gx, gy) === TileType.FLOOR && d.roomId[gy * d.W + gx] === d.boss;
}

/** A floor tile outside the boss room touching a boss-room floor tile (a doorway tile); the outward step or undefined. */
function doorStep(d: Dungeon, gx: number, gy: number): readonly [number, number] | undefined {
	if (tileAt(d, gx, gy) !== TileType.FLOOR || d.roomId[gy * d.W + gx] === d.boss) return undefined;
	for (const [ox, oy] of SIDES) if (isBossFloor(d, gx + ox, gy + oy)) return [-ox, -oy];
	return undefined;
}

interface Door {
	gx: number;
	gy: number;
	out: readonly [number, number];
}

/**
 * World position just outside the boss room's door: the middle tile of a doorway (scan order: the first doorway tile
 * whose two side neighbours are doorway tiles too, else the first doorway tile), one more tile out into the corridor
 * when that is floor. Undefined when the floor has no boss room or no doorway.
 */
export function bossDoorSpawn(d: Dungeon): WorldXZ | undefined {
	if (d.boss < 0 || d.boss >= d.rooms.size()) return undefined;
	let first: Door | undefined;
	let middle: Door | undefined;
	for (let gy = 0; gy < d.H && !middle; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			const out = doorStep(d, gx, gy);
			if (!out) continue;
			if (!first) first = { gx, gy, out };
			// Side neighbours run across the outward direction.
			const sx = out[1] !== 0 ? 1 : 0;
			const sy = out[0] !== 0 ? 1 : 0;
			if (doorStep(d, gx + sx, gy + sy) && doorStep(d, gx - sx, gy - sy)) {
				middle = { gx, gy, out };
				break;
			}
		}
	const door = middle ?? first;
	if (!door) return undefined;
	const ox = door.gx + door.out[0];
	const oy = door.gy + door.out[1];
	const outside = tileAt(d, ox, oy) === TileType.FLOOR && d.roomId[oy * d.W + ox] !== d.boss;
	return outside ? { x: gridToWorld(ox), z: gridToWorld(oy) } : { x: gridToWorld(door.gx), z: gridToWorld(door.gy) };
}

/** The run's player spawn: the boss door when `atBossDoor` (debug only) and the floor has one, else the entrance. */
export function runSpawn(d: Dungeon, atBossDoor: boolean): WorldXZ {
	if (atBossDoor) {
		const door = bossDoorSpawn(d);
		if (door) return door;
	}
	return entranceSpawn(d);
}
