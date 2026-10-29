import { describe, expect, it } from "@rbxts/jest-globals";
import { SCORE_SOURCE_COUNT, ScoreSource, type SimState } from "shared/sim";
import { RoomClearEvents } from "./roomClears";

/** The fields of ActorState / RoomScore / ScoreState that the collector reads, hand-built (no sim run). */
interface FakeActor {
	kind: number;
	id: number;
	alive: number;
	deadTicks: number;
	x: number;
	z: number;
}

interface FakeRoom {
	room: number;
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	parTicks: number;
	engageTick: number;
	hitsAtEngage: number;
	cleared: number;
	memberSlots: number[];
	memberIds: number[];
}

interface Fake {
	tick: number;
	endless?: { floor: number };
	score: { total: number; points: number[]; counts: number[]; rooms: FakeRoom[] };
	combat: { actors: FakeActor[] };
}

function zeros(): number[] {
	const out: number[] = [];
	for (let i = 0; i < SCORE_SOURCE_COUNT; i++) out.push(0);
	return out;
}

function actor(id: number, x: number, z: number): FakeActor {
	return { kind: 0, id, alive: 1, deadTicks: 0, x, z };
}

/** Room 3 (members in slots 0, 1 with ids 11, 12); room 4 (slots 2, 3, ids 13, 14) when `twoRooms`. */
function fakeState(twoRooms = false): Fake {
	const rooms: FakeRoom[] = [
		{
			room: 3,
			minX: 0,
			maxX: 10,
			minZ: 0,
			maxZ: 8,
			parTicks: 600,
			engageTick: -1,
			hitsAtEngage: 0,
			cleared: 0,
			memberSlots: [0, 1],
			memberIds: [11, 12],
		},
	];
	if (twoRooms) {
		rooms.push({
			room: 4,
			minX: 0,
			maxX: 10,
			minZ: 0,
			maxZ: 8,
			parTicks: 600,
			engageTick: -1,
			hitsAtEngage: 0,
			cleared: 0,
			memberSlots: [2, 3],
			memberIds: [13, 14],
		});
	}
	return {
		tick: 0,
		endless: { floor: 1 },
		score: { total: 0, points: zeros(), counts: zeros(), rooms },
		combat: { actors: [actor(11, 2, 3), actor(12, 7, 5), actor(13, 1, 1), actor(14, 9, 9)] },
	};
}

function step(ev: RoomClearEvents, f: Fake, tick: number): void {
	f.tick = tick;
	ev.collect(f as unknown as SimState);
}

function kill(f: Fake, slot: number, deadTicks: number): void {
	f.combat.actors[slot].alive = 0;
	f.combat.actors[slot].deadTicks = deadTicks;
}

/** A collector past its baseline, the room(s) engaged on tick 2, with 100 points scored before that tick. */
function engaged(twoRooms = false): { ev: RoomClearEvents; f: Fake } {
	const ev = new RoomClearEvents();
	const f = fakeState(twoRooms);
	step(ev, f, 0);
	f.score.total = 100;
	step(ev, f, 1);
	for (const r of f.score.rooms) r.engageTick = 2;
	step(ev, f, 2);
	return { ev, f };
}

describe("RoomClearEvents", () => {
	it("takes the first collect as a baseline: no clears, even for a room already cleared", () => {
		const ev = new RoomClearEvents();
		const f = fakeState();
		f.score.rooms[0].cleared = 1;
		f.score.points[ScoreSource.ROOMS] = 250;
		f.score.total = 250;
		step(ev, f, 1);
		expect(ev.clears.size()).toBe(0);
		expect(ev.engaged).toBe(0);
	});

	it("emits one full clear with the exact points, the room's last killed member and the engagement's kill points", () => {
		const { ev, f } = engaged();
		expect(ev.engaged).toBe(1);

		f.score.total = 400;
		kill(f, 0, 5);
		step(ev, f, 3);
		expect(ev.clears.size()).toBe(0);

		kill(f, 1, 0);
		f.score.rooms[0].cleared = 1;
		f.score.points[ScoreSource.ROOMS] += 250;
		f.score.points[ScoreSource.PERFECT] += 500;
		f.score.counts[ScoreSource.PERFECT] += 1;
		f.score.points[ScoreSource.FAST] += 90;
		f.score.total += 840;
		step(ev, f, 4);

		expect(ev.clears.size()).toBe(1);
		const c = ev.clears[0];
		expect(c.room).toBe(3);
		expect(c.rooms).toBe(1);
		expect(c.perfect).toBe(true);
		expect(c.clearPoints).toBe(250);
		expect(c.perfectPoints).toBe(500);
		expect(c.fastPoints).toBe(90);
		expect(c.killPoints).toBe(300);
		expect(c.x).toBe(7);
		expect(c.z).toBe(5);
		expect(c.slot).toBe(1);
		expect(c.actorId).toBe(12);
		expect(c.minX).toBe(0);
		expect(c.maxX).toBe(10);
		expect(c.minZ).toBe(0);
		expect(c.maxZ).toBe(8);
		expect(c.tick).toBe(4);
	});

	it("is not perfect without the PERFECT award, and then has no perfect points", () => {
		const { ev, f } = engaged();
		kill(f, 0, 3);
		kill(f, 1, 1);
		f.score.rooms[0].cleared = 1;
		f.score.points[ScoreSource.ROOMS] += 250;
		f.score.total += 250;
		step(ev, f, 3);

		expect(ev.clears.size()).toBe(1);
		expect(ev.clears[0].perfect).toBe(false);
		expect(ev.clears[0].perfectPoints).toBe(0);
	});

	it("falls back to the room's centre when no member is found", () => {
		const { ev, f } = engaged();
		f.combat.actors[0].id = 99;
		f.combat.actors[1].id = 98;
		f.score.rooms[0].cleared = 1;
		f.score.points[ScoreSource.ROOMS] += 250;
		f.score.total += 250;
		step(ev, f, 3);

		expect(ev.clears.size()).toBe(1);
		expect(ev.clears[0].x).toBe(5);
		expect(ev.clears[0].z).toBe(4);
		expect(ev.clears[0].slot).toBe(-1);
		expect(ev.clears[0].actorId).toBe(0);
	});

	it("makes one clear of two rooms that clear on the same tick, perfect only when both were", () => {
		const one = engaged(true);
		one.f.score.rooms[0].cleared = 1;
		one.f.score.rooms[1].cleared = 1;
		one.f.score.points[ScoreSource.ROOMS] += 500;
		one.f.score.points[ScoreSource.PERFECT] += 500;
		one.f.score.counts[ScoreSource.PERFECT] += 1;
		one.f.score.total += 1000;
		step(one.ev, one.f, 3);
		expect(one.ev.clears.size()).toBe(1);
		expect(one.ev.clears[0].rooms).toBe(2);
		expect(one.ev.clears[0].room).toBe(3);
		expect(one.ev.clears[0].perfect).toBe(false);

		const both = engaged(true);
		both.f.score.rooms[0].cleared = 1;
		both.f.score.rooms[1].cleared = 1;
		both.f.score.points[ScoreSource.ROOMS] += 500;
		both.f.score.points[ScoreSource.PERFECT] += 1000;
		both.f.score.counts[ScoreSource.PERFECT] += 2;
		both.f.score.total += 1500;
		step(both.ev, both.f, 3);
		expect(both.ev.clears.size()).toBe(1);
		expect(both.ev.clears[0].rooms).toBe(2);
		expect(both.ev.clears[0].perfect).toBe(true);
	});

	it("treats a floor change on the same collect as a cleared flip as a baseline", () => {
		const { ev, f } = engaged();
		f.endless = { floor: 2 };
		f.score.rooms[0].cleared = 1;
		f.score.points[ScoreSource.ROOMS] += 250;
		f.score.total += 250;
		step(ev, f, 3);
		expect(ev.clears.size()).toBe(0);
	});

	it("reports zero kill points when the engagement was never seen", () => {
		const ev = new RoomClearEvents();
		const f = fakeState();
		f.score.rooms[0].engageTick = 0;
		step(ev, f, 0);
		f.score.rooms[0].cleared = 1;
		f.score.points[ScoreSource.ROOMS] += 250;
		f.score.total = 300;
		step(ev, f, 1);

		expect(ev.clears.size()).toBe(1);
		expect(ev.clears[0].killPoints).toBe(0);
		expect(ev.clears[0].clearPoints).toBe(250);
	});

	it("reset() forgets the last frame's clears and engagements; a state without scoring never emits", () => {
		const { ev, f } = engaged();
		f.score.rooms[0].cleared = 1;
		f.score.points[ScoreSource.ROOMS] += 250;
		f.score.total += 250;
		step(ev, f, 3);
		expect(ev.clears.size()).toBe(1);

		ev.reset();
		expect(ev.clears.size()).toBe(0);
		expect(ev.engaged).toBe(0);

		const bare = { tick: 1, combat: { actors: [] } } as unknown as SimState;
		ev.collect(bare);
		expect(ev.clears.size()).toBe(0);
		expect(ev.engaged).toBe(0);
	});
});
