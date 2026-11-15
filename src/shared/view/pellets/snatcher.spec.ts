// docs/NEW_ENEMIES_2.md NX7: pellets and the Snatcher on screen. A carried pellet (taken = PELLET_STOLEN) is not drawn;
// one a dead Snatcher put back flies from its corpse to its cell; the last-few hint and the chomp ladder count the
// pellets ON THE FLOOR (taken 0), never the room's `left`, which still counts carried and swallowed pellets (NXD11);
// the frame's events copy the Snatcher's moments with the swallowed pellets' cells.
import { describe, expect, it } from "@rbxts/jest-globals";
import { NO_POWER_PELLET, type FloorPellets } from "shared/dungeon";
import {
	PELLETS_CONFIG,
	PELLET_DIGESTED,
	PELLET_STOLEN,
	PelletPhase,
	SIM_HZ,
	createSimState,
	type SimState,
} from "shared/sim";
import { PELLET_RETURN_VIEW } from "../newEnemies2Config";
import {
	PELLETS_VIEW,
	PelletFrameEvents,
	PelletViewTracker,
	newPelletLook,
	pelletEatSpeed,
	pelletReturnFlight,
	pelletRoomProgress,
	pelletsOnFloor,
} from ".";

/** `n` pellets in a row (x = 1..n, z = 0), one LIVE hand-made room record (the last the power pellet when `power`). */
function sandbox(n: number, power = false): SimState {
	const tiles: { x: number; z: number }[] = [];
	const room: number[] = [];
	for (let i = 0; i < n; i++) {
		tiles.push({ x: i + 1, z: 0 });
		room.push(0);
	}
	const floor: FloorPellets = { tiles, room, power: power ? n - 1 : NO_POWER_PELLET };
	const s = createSimState(1, 0, 0, { pellets: { ...PELLETS_CONFIG, floor } });
	const p = s.pellets!;
	for (let i = 0; i < n; i++) p.rec[i] = 0;
	const regular = power ? n - 1 : n;
	p.rooms.push({ first: 0, span: n, count: regular, left: regular, phase: PelletPhase.LIVE, swept: 0 });
	return s;
}

describe("pellets and the Snatcher (docs/NEW_ENEMIES_2.md NX7)", () => {
	it("a carried (taken 2) or swallowed (taken 3) pellet is not drawn; back on the floor it is", () => {
		const s = sandbox(4);
		const t = new PelletViewTracker();
		t.sync(s, new PelletFrameEvents());
		const look = newPelletLook();
		const p = s.pellets!;
		expect(t.look(s, 1, 10, 1, look).shown).toBe(true);
		p.taken[1] = PELLET_STOLEN;
		expect(t.look(s, 1, 10, 1, look).shown).toBe(false);
		p.taken[2] = PELLET_DIGESTED;
		expect(t.look(s, 2, 10, 1, look).shown).toBe(false);
		p.taken[1] = 0;
		expect(t.look(s, 1, 10, 1, look).shown).toBe(true);
	});

	it("the last-few hint counts pellets on the floor: carried ones never light it or keep it off", () => {
		const s = sandbox(6);
		const p = s.pellets!;
		const room = p.rooms[0];
		const t = new PelletViewTracker();
		t.sync(s, new PelletFrameEvents());
		const look = newPelletLook();
		const half = PELLETS_VIEW.lastFew.periodSec / 2;
		expect(t.look(s, 0, half, 1, look).glow).toBe(0); // 6 on the floor
		// A Snatcher carries four: `left` is still 6, two lie on the floor, so those two pulse.
		for (const i of [2, 3, 4, 5]) p.taken[i] = PELLET_STOLEN;
		s.tick += 1;
		expect(room.left).toBe(6);
		expect(pelletsOnFloor(s, 0)).toBe(2);
		expect(t.floorLeft(s, 0)).toBe(2);
		expect(t.look(s, 0, half, 1, look).glow).toBeCloseTo(PELLETS_VIEW.lastFew.glowMax, 9);
		// Put back: six on the floor again, no hint.
		for (const i of [2, 3, 4, 5]) p.taken[i] = 0;
		s.tick += 1;
		expect(t.look(s, 0, half, 1, look).glow).toBe(0);
		// The power pellet never counts.
		const w = sandbox(4, true);
		expect(pelletsOnFloor(w, 0)).toBe(3);
	});

	it("the chomp ladder runs over the pellets left on the floor: the last one plays the octave", () => {
		const s = sandbox(8);
		const p = s.pellets!;
		const room = p.rooms[0];
		// Players took four, a Snatcher carries two, two lie on the floor.
		for (const i of [0, 1, 2, 3]) p.taken[i] = 1;
		for (const i of [4, 5]) p.taken[i] = PELLET_STOLEN;
		room.left = 4;
		expect(pelletRoomProgress(s, 3)).toEqual([4, 6]);
		p.taken[6] = 1;
		p.taken[7] = 1;
		room.left = 2;
		expect(pelletRoomProgress(s, 7)).toEqual([6, 6]);
		const [k, n] = pelletRoomProgress(s, 7)!;
		expect(pelletEatSpeed(k, n)).toBe(2);
		// Without a Snatcher it is (count - left, count) exactly.
		const plain = sandbox(8);
		plain.pellets!.taken[0] = 1;
		plain.pellets!.rooms[0].left = 7;
		expect(pelletRoomProgress(plain, 0)).toEqual([1, 8]);
	});

	it("a pellet put back flies from the corpse to its cell (ease-out, a hop); reduced motion: on its cell", () => {
		const look = newPelletLook();
		pelletReturnFlight(0, 10, 4, 2, 0, 1, look);
		expect([look.offX, look.offZ, look.hopTiles]).toEqual([8, 4, 0]);
		pelletReturnFlight(PELLET_RETURN_VIEW.flySec / 2, 10, 4, 2, 0, 1, look);
		expect(look.offX).toBeCloseTo(2, 9);
		expect(look.hopTiles).toBeCloseTo(PELLET_RETURN_VIEW.hopTiles, 9);
		pelletReturnFlight(PELLET_RETURN_VIEW.flySec, 10, 4, 2, 0, 1, look);
		expect([look.offX, look.offZ, look.hopTiles]).toEqual([0, 0, 0]);
		pelletReturnFlight(0, 10, 4, 2, 0, 0, look);
		expect([look.offX, look.offZ, look.hopTiles]).toEqual([0, 0, 0]);

		// Through the tracker: the returned event's tick starts the flight.
		const s = sandbox(3);
		const t = new PelletViewTracker();
		t.sync(s, new PelletFrameEvents());
		const ev = new PelletFrameEvents();
		ev.returned.push({ index: 1, fromX: 7, fromZ: 3, tick: 60 });
		t.sync(s, ev);
		const at = 60 / SIM_HZ;
		t.look(s, 1, at, 1, look);
		expect([look.shown, look.offX, look.offZ]).toEqual([true, 7 - 2, 3]);
		t.look(s, 1, at + PELLET_RETURN_VIEW.flySec, 1, look);
		expect([look.shown, look.offX, look.offZ]).toEqual([true, 0, 0]);
	});

	it("PelletFrameEvents copies the stolen, returned and swallowed events with the swallowed pellets' cells", () => {
		const s = sandbox(5);
		const e = s.pellets!.events;
		e.stolen.push({ index: 2, x: 3, z: 0 });
		e.returned.push({ index: 4, fromX: 9, fromZ: 1 });
		e.swallowed.push({ x: 6, z: 2, indices: [0, 1] });
		const ev = new PelletFrameEvents();
		ev.collect(s);
		const tick = s.tick;
		expect(ev.stolen).toEqual([{ index: 2, x: 3, z: 0, tick }]);
		expect(ev.returned).toEqual([{ index: 4, fromX: 9, fromZ: 1, tick }]);
		expect(ev.swallowed).toEqual([{ x: 6, z: 2, indices: [0, 1], cellX: [1, 2], cellZ: [0, 0], tick }]);
		expect(ev.count()).toBe(3);
		e.swallowed[0].indices.push(3); // a copy: the sim's lists are reused
		expect(ev.swallowed[0].indices).toEqual([0, 1]);
		ev.reset();
		expect(ev.count()).toBe(0);
	});
});
