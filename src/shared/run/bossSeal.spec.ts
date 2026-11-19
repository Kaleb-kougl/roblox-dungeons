/**
 * The boss room's seal in co-op (boss/shared.ts sealArena): a teammate outside the arena when the fight starts is pulled
 * in, and must land on the arena's floor, never in a wall. On endless floors the room's bounds hold walls (the throne's
 * dais, candle stands, door braziers, solid pillars, ragged edges), so the bare clamp onto the bounds could put a
 * straggler inside one (stuck for the whole fight).
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	circleOverlapsWall,
	gridToWorld,
	roomIdAt,
	tileAt,
	TileType,
	type Dungeon,
	type EncounterRoom,
} from "shared/dungeon";
import {
	AXIS_MAX,
	EMPTY_INPUT,
	PLAYER_RADIUS,
	createSimState,
	playerAt,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig } from "shared/run";
import { sameFrames, skipPartyToFloor, tickAll } from "shared/run/testing";

const PARTY = 2;
const BOSS_FLOOR = 5;
/** Ticks to let the room engage, the boss spawn and wake, and the seal run. */
const ENGAGE_TICKS = 120;
/** Stragglers this close to the arena (clamp distance, tiles) are the ones that matter in play: waiting in the corridor. */
const NEAR_TILES = 6;
/** The fight starter stands this far (Manhattan, tiles) from the boss's tile. */
const BOSS_GAP_TILES = 3;

function place(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/** FLOOR cells outside the arena whose bare clamp lands the body in a wall, nearest first. */
function stuckCells(d: Dungeon, room: EncounterRoom): Array<{ x: number; z: number }> {
	const r = PLAYER_RADIUS;
	const out: Array<{ x: number; z: number; far: number }> = [];
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			if (tileAt(d, gx, gy) !== TileType.FLOOR) continue;
			const x = gridToWorld(gx);
			const z = gridToWorld(gy);
			const cx = clamp(x, room.minX + r, room.maxX - r);
			const cz = clamp(z, room.minZ + r, room.maxZ - r);
			if (cx === x && cz === z) continue;
			const far = math.max(math.abs(cx - x), math.abs(cz - z));
			if (far > NEAR_TILES) continue;
			if (circleOverlapsWall(d, cx, cz, r)) out.push({ x, z, far });
		}
	out.sort((a, b) => a.far < b.far);
	return out;
}

/**
 * The arena's FLOOR cell nearest its centre but off the boss's tile (BOSS_GAP_TILES away): the boss binds the nearest
 * player and wakes when that player is well inside, so the player standing here, not the straggler, starts the fight.
 */
function insideCell(d: Dungeon, room: EncounterRoom): { x: number; z: number } {
	let best: { x: number; z: number } | undefined;
	let bestD = math.huge;
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			const x = gridToWorld(gx);
			const z = gridToWorld(gy);
			if (tileAt(d, gx, gy) !== TileType.FLOOR || roomIdAt(d, x, z) !== room.id) continue;
			const dd = math.abs(x - room.cx) + math.abs(z - room.cz);
			if (dd < BOSS_GAP_TILES || dd >= bestD) continue;
			bestD = dd;
			best = { x, z };
		}
	if (best === undefined) error("no inside cell", 0);
	return best;
}

describe("boss seal: stragglers land on the arena floor", () => {
	for (const seed of [1, 2, 3, 4, 5, 6]) {
		it(`seed ${seed}, floor ${BOSS_FLOOR}: a teammate pulled in from a stuck spot stands clear in the arena`, () => {
			const setup = buildEndlessRunConfig(seed, PARTY);
			const config: SimConfig = { ...setup.config, dev: { invulnerable: true } };
			const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, config);
			skipPartyToFloor(s, config, BOSS_FLOOR);
			const w = setup.endlessFloor(BOSS_FLOOR);
			expect(w.bossFloor).toBe(true);
			const d = w.layout.secret?.dungeon ?? w.dungeon;
			const room = w.config.encounter!.rooms[w.config.encounter!.bossRoom];
			const stuck = stuckCells(d, room);
			// The bug's precondition: on this floor the bare clamp would put someone in a wall.
			expect(stuck.size() > 0).toBe(true);
			const from = stuck[0];
			const inside = insideCell(d, room);
			place(s, 0, inside.x, inside.z);
			place(s, 1, from.x, from.z);
			let engaged = -1;
			for (let t = 0; t < ENGAGE_TICKS; t++) {
				tickAll(s, config, sameFrames(PARTY, EMPTY_INPUT));
				if (s.events.bossEngaged !== 0 && engaged < 0) engaged = t;
			}
			const p = playerAt(s, 1);
			expect(engaged >= 0).toBe(true);
			expect(p.x !== from.x || p.z !== from.z).toBe(true); // the seal pulled it in
			expect(circleOverlapsWall(d, p.x, p.z, PLAYER_RADIUS)).toBe(false);
			expect(roomIdAt(d, p.x, p.z)).toBe(room.id);
			// And it can still move (not wedged): walking back toward where it came from keeps it clear and in the arena.
			const dx = from.x - p.x;
			const dz = from.z - p.z;
			const len = math.sqrt(dx * dx + dz * dz);
			const walk = {
				...EMPTY_INPUT,
				moveX: math.round((dx / len) * AXIS_MAX),
				moveZ: math.round((dz / len) * AXIS_MAX),
			};
			for (let t = 0; t < 60; t++) tickAll(s, config, [EMPTY_INPUT, walk]);
			const q = playerAt(s, 1);
			expect(circleOverlapsWall(d, q.x, q.z, PLAYER_RADIUS)).toBe(false);
		});
	}
});
