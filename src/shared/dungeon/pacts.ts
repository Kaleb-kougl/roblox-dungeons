/**
 * Pact altars (docs/FORTUNE.md PS1, decisions FD1 / FD3; a Roblox-port feature, no web source): where an endless
 * floor's two altars stand in its shrine room, and the curse the Pact of Greed shows each player. Decided when the floor
 * is built, a PURE function of the floor like the rest of ./endless.ts, so live play, every co-op client, the server's
 * replay and a daily seed see the same altars, and the sim draws no rng for them.
 *
 *   room     the floor's first SHRINE room (encounter order: the one shared/sim progression's placeFloor picks as
 *            the shrine). None: no altars.
 *   cells    from the crystal (the room's centre floor cell, EncounterRoom cx / cz) along the screen-horizontal line
 *            (PACTS.screenRight): Greed `k` steps screen-left, Horde `k` steps screen-right. An altar cell is usable
 *            when every cell within PACTS.clearCells of it is FLOOR of the shrine room (solid decor, the statue and its
 *            candles, are WALL by now), none of them holds a breakable or a pellet, and the cell is reachable on foot
 *            from the entrance spawn (4-neighbour BFS over FLOOR minus the breakables' cells, ./pellets.ts
 *            reachableFloor). Per shift m of PACTS.shiftSteps (the whole pair m steps along PACTS.screenDown; 0, the
 *            crystal's own line, first), the first offset of PACTS.offsetSteps where BOTH sides are usable (a
 *            mirrored pair); none at any shift: per shift, each side on its own first usable offset. Nothing: no
 *            altars (the sim keeps the classic shrine on that floor, the plan's fallback; PS1's census measures how
 *            often).
 *   draws    none. Run after solid decor (in the Forge), breakables and pellets, reading them: the layout, digest,
 *            props, spawns, pieces, loot, affixes, pellets and boss pick never move.
 *
 * The curse (pactCurseIndex, FD3): which of a player's unused curses Greed would give them, one draw from its own stream
 * new EncounterRng(floor seed ^ PACTS.salt ^ imul(player + 1, PACTS.playerMul)), so the view can show it before the
 * pact is taken and the sim's main rng never moves for it.
 */
import { imul, u32 } from "shared/jsmath";
import { TileType, type Dungeon } from "./forge";
import { cellKey, gridToWorld, tileAt, worldToGrid } from "./collision";
import { EncounterRng, type TileXZ } from "./encounter";
import type { EncounterRoom } from "./encounterTypes";
import type { BreakableFloorInput, BreakablePlacement } from "./breakables";
import { reachableFloor, type FloorPellets } from "./pellets";
import { PACTS, PACT_KIND_COUNT, PactKind } from "./pactsData";

/** One floor's altars, as data (EndlessFloorLayout / EndlessFloorWorld.pacts). Never mutated. */
export interface FloorPacts {
	/** The shrine room's encounter id. */
	readonly room: number;
	/** The floor seed (floorSeed(runSeed, floor)): pactCurseIndex's input. */
	readonly seed: number;
	/** Each altar's world tile centre, by PactKind (GREED, HORDE). */
	readonly altars: ReadonlyArray<TileXZ>;
}

/** Seed of the pacts' stream: the floor seed with PACTS.salt mixed in (uint32). */
export function pactSeed(floorSeed: number): number {
	return bit32.bxor(u32(floorSeed), PACTS.salt);
}

/**
 * The index into player `player`'s unused curses (Curse order, `unusedCount` of them) that the Pact of Greed gives them
 * on the floor whose seed is `floorSeed` (see the file comment): one draw, 0 .. unusedCount - 1; -1 when none is left.
 * Pure.
 */
export function pactCurseIndex(floorSeed: number, player: number, unusedCount: number): number {
	if (unusedCount <= 0) return -1;
	const seed = bit32.bxor(pactSeed(floorSeed), imul(player + 1, PACTS.playerMul));
	return new EncounterRng(seed).int(0, unusedCount - 1);
}

/** The floor's first SHRINE room (encounter order), or undefined. */
export function pactShrineRoom(rooms: ReadonlyArray<EncounterRoom>): EncounterRoom | undefined {
	for (const room of rooms) if (room.type === "shrine") return room;
	return undefined;
}

/**
 * The altars of the built endless floor `input` (its placed breakables `pieces` and pellets `pellets`), or undefined
 * when it has no shrine room or an altar does not fit (see the file comment). Pure and deterministic.
 */
export function placePactAltars(
	input: BreakableFloorInput,
	pieces: ReadonlyArray<BreakablePlacement>,
	pellets: FloorPellets | undefined,
): FloorPacts | undefined {
	const room = pactShrineRoom(input.encounter.rooms);
	if (room === undefined) return undefined;
	const d: Dungeon = input.dungeon;
	// solid: what a body cannot cross (the reach); blocked: what no altar zone may hold (pieces and pellets)
	const solid = new Set<number>();
	const blocked = new Set<number>();
	for (const b of pieces) {
		solid.add(cellKey(b.x, b.y));
		blocked.add(cellKey(b.x, b.y));
	}
	if (pellets !== undefined) for (const t of pellets.tiles) blocked.add(cellKey(worldToGrid(t.x), worldToGrid(t.z)));
	const reach = reachableFloor(d, input.spawn.x, input.spawn.z, solid);
	const c = PACTS.clearCells;
	const usable = (gx: number, gy: number): boolean => {
		if (tileAt(d, gx, gy) !== TileType.FLOOR || !reach[gy * d.W + gx]) return false;
		for (let y = gy - c; y <= gy + c; y++)
			for (let x = gx - c; x <= gx + c; x++) {
				if (tileAt(d, x, y) !== TileType.FLOOR || d.roomId[y * d.W + x] !== room.id) return false;
				if (blocked.has(cellKey(x, y))) return false;
			}
		return true;
	};
	const cx = worldToGrid(room.cx);
	const cy = worldToGrid(room.cz);
	const [rx, ry] = PACTS.screenRight;
	const [dx, dy] = PACTS.screenDown;
	// side -1: screen-left (Greed), +1: screen-right (Horde); `m` steps screen-down for the whole pair
	const cellAt = (side: number, k: number, m: number): readonly [number, number] => [
		cx + side * k * rx + m * dx,
		cy + side * k * ry + m * dy,
	];
	const fits = (side: number, k: number, m: number) => {
		const [x, y] = cellAt(side, k, m);
		return usable(x, y);
	};
	let greed = -1;
	let horde = -1;
	let shift = 0;
	// 1. a mirrored pair, on the crystal's line first, then shifted
	for (const m of PACTS.shiftSteps) {
		for (const k of PACTS.offsetSteps) {
			if (fits(-1, k, m) && fits(1, k, m)) {
				greed = k;
				horde = k;
				shift = m;
				break;
			}
		}
		if (greed >= 0) break;
	}
	// 2. else each side on its own first offset, both on one line
	if (greed < 0) {
		for (const m of PACTS.shiftSteps) {
			let g = -1;
			let h = -1;
			for (const k of PACTS.offsetSteps) {
				if (g < 0 && fits(-1, k, m)) g = k;
				if (h < 0 && fits(1, k, m)) h = k;
			}
			if (g >= 0 && h >= 0) {
				greed = g;
				horde = h;
				shift = m;
				break;
			}
		}
	}
	if (greed < 0 || horde < 0) return undefined;
	const altars: TileXZ[] = [];
	for (let kind = 0; kind < PACT_KIND_COUNT; kind++) {
		const [x, y] = kind === PactKind.GREED ? cellAt(-1, greed, shift) : cellAt(1, horde, shift);
		altars.push({ x: gridToWorld(x), z: gridToWorld(y) });
	}
	return { room: room.id, seed: input.seed, altars };
}
