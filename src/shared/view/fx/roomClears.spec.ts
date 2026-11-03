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

/** The fields of PelletsState the collector reads: each pellet's record, the power pellet, the tick's events. */
interface FakePellets {
	rec: number[];
	power: number;
	events: { eaten: { index: number; points: number }[]; power?: { points: number } };
}

interface Fake {
	tick: number;
	endless?: { floor: number };
	score: { total: number; points: number[]; counts: number[]; rooms: FakeRoom[] };
	combat: { actors: FakeActor[] };
	pellets?: FakePellets;
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

/** One tick collected; then the tick's pellet events are cleared (the sim clears them at the start of every tick). */
function step(ev: RoomClearEvents, f: Fake, tick: number): void {
	f.tick = tick;
	ev.collect(f as unknown as SimState);
	if (f.pellets !== undefined) {
		f.pellets.events.eaten.clear();
		f.pellets.events.power = undefined;
	}
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

/** A pellet run's score sources: the nine, Jackpot (padded), Pellets 10 and Sweep 11. */
function withPelletSources(f: Fake): void {
	while (f.score.points.size() <= ScoreSource.SWEEP) {
		f.score.points.push(0);
		f.score.counts.push(0);
	}
}

/** Gives the fake state pellets in the given records (and a power pellet index, -1 none). Events start empty. */
function pellets(f: Fake, rec: number[], power: number): FakePellets {
	const p: FakePellets = { rec, power, events: { eaten: [] } };
	f.pellets = p;
	return p;
}

/** Points scored to `source` (and the total), as an award does. */
function award(f: Fake, source: number, points: number): void {
	f.score.points[source] += points;
	f.score.counts[source] += 1;
	f.score.total += points;
}

/** Pellet `index` taken on the coming tick for `points` (its eaten event and the PELLETS award). */
function eat(f: Fake, p: FakePellets, index: number, points: number): void {
	p.events.eaten.push({ index, points });
	award(f, ScoreSource.PELLETS, points);
}

/** The power pellet taken on the coming tick, paying `points` in bullets. */
function power(f: Fake, p: FakePellets, points: number): void {
	p.events.power = { points };
	award(f, ScoreSource.PELLETS, points);
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
		// No pellet sources in this run: no pellet or sweep points.
		expect([c.pelletPoints, c.sweepPoints]).toEqual([0, 0]);
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

	it("a pellet run: the room's own pellet points leave the kills, the clear tick's Sweep is a bonus (PL7)", () => {
		const ev = new RoomClearEvents();
		const f = fakeState(true);
		withPelletSources(f);
		// Pellets 0-2 in room 3's record (0), 3-5 in room 4's (1); pellet 5 is the power pellet.
		const p = pellets(f, [0, 0, 0, 1, 1, 1], 5);
		step(ev, f, 0);
		// Room 4 engages first; its pellets taken before room 3's engagement never count for room 3.
		f.score.rooms[1].engageTick = 1;
		step(ev, f, 1);
		eat(f, p, 3, 40);
		step(ev, f, 2);
		f.score.rooms[0].engageTick = 3;
		step(ev, f, 3);

		eat(f, p, 0, 60);
		eat(f, p, 1, 60);
		f.score.total += 300; // kills
		step(ev, f, 4);
		// The clear tick: the last pellet (a pickup before the clear, it counts), the clear and the Sweep.
		eat(f, p, 2, 60);
		kill(f, 0, 1);
		kill(f, 1, 0);
		f.score.rooms[0].cleared = 1;
		award(f, ScoreSource.ROOMS, 250);
		award(f, ScoreSource.SWEEP, 250);
		step(ev, f, 5);

		expect(ev.clears.size()).toBe(1);
		const c = ev.clears[0];
		expect(c.room).toBe(3);
		expect([c.killPoints, c.pelletPoints, c.clearPoints, c.sweepPoints]).toEqual([300, 180, 250, 250]);
		expect([c.perfectPoints, c.fastPoints]).toEqual([0, 0]);
	});

	it("two rooms live at once: each clear's pellets are its own room's, the other room's stay in its room points", () => {
		const ev = new RoomClearEvents();
		const f = fakeState(true);
		withPelletSources(f);
		const p = pellets(f, [0, 0, 1, 1, 1], 4);
		step(ev, f, 0);
		f.score.rooms[0].engageTick = 1;
		f.score.rooms[1].engageTick = 1;
		step(ev, f, 1);

		// Room 3's two pellets, room 4's two pellets and its power pellet (30 points in bullets), and kills.
		eat(f, p, 0, 10);
		eat(f, p, 2, 20);
		step(ev, f, 2);
		eat(f, p, 1, 10);
		eat(f, p, 3, 20);
		power(f, p, 30);
		f.score.total += 400; // kills in both rooms
		step(ev, f, 3);

		// Room 3 clears: its own 20 in pellets; room 4's 70 are in its room points, so in its kill points.
		kill(f, 0, 1);
		kill(f, 1, 0);
		f.score.rooms[0].cleared = 1;
		award(f, ScoreSource.ROOMS, 250);
		step(ev, f, 4);
		expect(ev.clears.size()).toBe(1);
		const a = ev.clears[0];
		expect(a.room).toBe(3);
		expect([a.pelletPoints, a.killPoints, a.clearPoints]).toEqual([20, 400 + 70, 250]);

		// Room 4 clears later: its own 70 (two pellets and the power pellet's bullets).
		ev.reset();
		f.score.total += 100;
		step(ev, f, 5);
		kill(f, 2, 1);
		kill(f, 3, 0);
		f.score.rooms[1].cleared = 1;
		award(f, ScoreSource.ROOMS, 250);
		step(ev, f, 6);
		expect(ev.clears.size()).toBe(1);
		const b = ev.clears[0];
		expect(b.room).toBe(4);
		// Room points since its engagement: 20 + 400 + 70 + 250 (room 3's clear) + 100 + 250; less its 70 and the bonus.
		expect([b.pelletPoints, b.killPoints, b.clearPoints]).toEqual([70, 20 + 400 + 250 + 100, 250]);
	});

	it("two rooms clearing on one tick: one clear with both rooms' own pellets", () => {
		const ev = new RoomClearEvents();
		const f = fakeState(true);
		withPelletSources(f);
		const p = pellets(f, [0, 1], -1);
		step(ev, f, 0);
		for (const r of f.score.rooms) r.engageTick = 1;
		step(ev, f, 1);
		eat(f, p, 0, 10);
		eat(f, p, 1, 15);
		f.score.total += 200;
		for (let slot = 0; slot < 4; slot++) kill(f, slot, slot);
		for (const r of f.score.rooms) r.cleared = 1;
		award(f, ScoreSource.ROOMS, 500);
		step(ev, f, 2);
		expect(ev.clears.size()).toBe(1);
		const c = ev.clears[0];
		expect([c.rooms, c.pelletPoints, c.killPoints, c.clearPoints]).toEqual([2, 25, 200, 500]);
	});
});
