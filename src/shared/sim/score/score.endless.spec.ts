// M2 scoring on endless floors (slice integration): room records built from a floor's DEFERRED room spawns, members
// attached (and the room engaged) on the tick the player walks in and the enemies spawn, clear / perfect / fast at the
// floor's kill scaling, records rebuilt on every floor change, the floor clear on the way out.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	Button,
	COMBO_MIN,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	FAST_POINTS_PER_TICK,
	FLOOR_CLEAR_POINTS,
	KILL_POINTS,
	NO_KIND,
	ROOM_CLEAR_POINTS,
	ROOM_PAR_BASE_TICKS,
	ROOM_PAR_TICKS_PER_COST,
	ROOM_PERFECT_POINTS,
	ScoreSource,
	SimCtx,
	archetypeAt,
	createSimState,
	floorClearBase,
	floorScalePercent,
	step,
	type ActorState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { encounterCost } from "shared/dungeon";
import { buildEndlessRunConfig, type EndlessRunSetup } from "shared/run";
import { dismissDraft, skipToFloor } from "shared/run/testing";

const SEED = 42;
const SKIP: InputFrame = { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON };

/** A fresh scored endless run on SEED, debug-skipped to `floor` (each boon draft dismissed: no boon changes a score). */
function runOn(floor: number): { setup: EndlessRunSetup; s: SimState } {
	const setup = buildEndlessRunConfig(SEED);
	const spawn = setup.spawn!;
	const s = createSimState(SEED, spawn.x, spawn.z, setup.config);
	skipToFloor(s, setup.config, floor);
	return { setup, s };
}

/** The first room id with deferred spawns on the run's current floor. */
function firstRoom(setup: EndlessRunSetup, s: SimState): number {
	const w = setup.endlessFloor(s.endless!.floor);
	for (let id = 0; id < w.roomSpawns.size(); id++) if (w.roomSpawns[id].size() > 0) return id;
	return error("no room with spawns");
}

/**
 * The first room id with deferred spawns and no Ooze on the run's current floor: an Ooze splits when killed (its
 * slimelets join the room), so a room without one clears on the tick after its members die. Which kinds a room holds
 * is the run's roster (docs/DAILY.md DSD18).
 */
function firstRoomWithoutSplits(setup: EndlessRunSetup, s: SimState): number {
	const w = setup.endlessFloor(s.endless!.floor);
	for (let id = 0; id < w.roomSpawns.size(); id++) {
		const spawns = w.roomSpawns[id];
		if (spawns.size() > 0 && !spawns.some((sp) => sp.kind === "slime")) return id;
	}
	return error("no room with spawns and no Ooze");
}

/** Puts the player on the room's first spawn tile and steps once (`input`): the room's enemies spawn. */
function enter(setup: EndlessRunSetup, s: SimState, id: number, input: InputFrame = EMPTY_INPUT): void {
	const first = setup.endlessFloor(s.endless!.floor).roomSpawns[id][0];
	s.player.x = first.x;
	s.player.z = first.z;
	step(s, input, setup.config);
}

function members(s: SimState, id: number): ActorState[] {
	const r = s.score!.rooms.find((x) => x.room === id)!;
	return r.memberSlots.map((slot) => s.combat.actors[slot]);
}

/** Kills `actors` between ticks, in order (each kill scores and feeds the combo now). */
function killAll(setup: EndlessRunSetup, s: SimState, actors: ReadonlyArray<ActorState>): void {
	const ctx = new SimCtx().bind(s, setup.endlessFloor(s.endless!.floor).config, EMPTY_INPUT);
	for (const a of actors) ctx.killActor(a);
}

describe("endless room records (deferred spawns)", () => {
	it("one record per room with spawns, par from the spawns' encounter cost, no members until entered", () => {
		const { setup, s } = runOn(1);
		const w = setup.endlessFloor(1);
		const want: Array<[number, number]> = [];
		for (let id = 0; id < w.roomSpawns.size(); id++) {
			const spawns = w.roomSpawns[id];
			if (spawns.size() === 0) continue;
			let par = ROOM_PAR_BASE_TICKS;
			for (const sp of spawns) par += ROOM_PAR_TICKS_PER_COST * encounterCost(sp.kind);
			want.push([id, par]);
		}
		expect(want.size()).toBeGreaterThan(0);
		const rooms = s.score!.rooms;
		expect(rooms.map((r): [number, number] => [r.room, r.parTicks])).toEqual(want);
		for (const r of rooms) expect([r.memberSlots.size(), r.engageTick, r.cleared]).toEqual([0, -1, 0]);
		// The boss room and the entrance never get a record.
		expect(rooms.some((r) => r.room === w.dungeon.boss || r.room === w.dungeon.entrance)).toBe(false);
		// Waiting records neither engage nor clear while their enemies are not there.
		for (let k = 0; k < 30; k++) step(s, EMPTY_INPUT, setup.config);
		for (const r of s.score!.rooms) expect([r.engageTick, r.cleared]).toEqual([-1, 0]);
		expect(s.score!.points[ScoreSource.ROOMS]).toBe(0);
	});

	it("walking in attaches the spawned enemies and engages the room on that tick", () => {
		const { setup, s } = runOn(1);
		const id = firstRoom(setup, s);
		const spawns = setup.endlessFloor(1).roomSpawns[id];
		const tick = s.tick;
		enter(setup, s, id);
		expect(s.events.roomEntered).toBe(id + 1);
		const r = s.score!.rooms.find((x) => x.room === id)!;
		expect(r.engageTick).toBe(tick);
		expect(r.hitsAtEngage).toBe(0);
		expect(r.memberSlots.size()).toBe(spawns.size());
		const ms = members(s, id);
		expect(ms.map((a) => archetypeAt(a.kind).id)).toEqual(spawns.map((sp) => sp.kind));
		expect(ms.map((a) => a.id)).toEqual(r.memberIds);
	});

	it("clear + perfect + fast at the clearing tick's combo; kills scaled by the floor (floor 3)", () => {
		const { setup, s } = runOn(3);
		const st = s.score!;
		const id = firstRoomWithoutSplits(setup, s);
		enter(setup, s, id);
		const r = st.rooms.find((x) => x.room === id)!;
		const ms = members(s, id);
		const n = ms.size();
		const killsBefore = st.points[ScoreSource.KILLS];
		killAll(setup, s, ms);
		// Kill k (0-based) at combo 10 + k, x1.16 on floor 3: floor(base x (10 + k) / 10 x 116 / 100).
		let kills = 0;
		for (let k = 0; k < n; k++) {
			const base = KILL_POINTS.get(archetypeAt(ms[k].kind).id)!;
			const num = base * (COMBO_MIN + k) * floorScalePercent(3);
			kills += (num - (num % 1000)) / 1000;
		}
		expect(st.points[ScoreSource.KILLS] - killsBefore).toBe(kills);
		step(s, EMPTY_INPUT, setup.config);
		expect(s.events.playerHits).toBe(0);
		expect(r.cleared).toBe(1);
		const combo = COMBO_MIN + n;
		const at = (base: number) => math.floor((base * combo) / 10);
		expect(st.points[ScoreSource.ROOMS]).toBe(at(ROOM_CLEAR_POINTS));
		expect(st.points[ScoreSource.PERFECT]).toBe(at(ROOM_PERFECT_POINTS));
		// Cleared one tick after the engagement.
		expect(st.points[ScoreSource.FAST]).toBe(at((r.parTicks - 1) * FAST_POINTS_PER_TICK));
		step(s, EMPTY_INPUT, setup.config);
		expect(st.counts[ScoreSource.ROOMS]).toBe(1); // once
	});

	it("a hit on the engagement tick spoils perfect; no fast past par", () => {
		const { setup, s } = runOn(1);
		const st = s.score!;
		const id = firstRoom(setup, s);
		enter(setup, s, id, { ...EMPTY_INPUT, buttons: Button.DEBUG_HIT });
		expect(s.events.playerHits).toBe(1);
		const r = st.rooms.find((x) => x.room === id)!;
		expect(r.engageTick).toBe(s.tick - 1);
		r.parTicks = 1; // test only: the clear below (one tick after the engagement) is then not under par
		killAll(setup, s, members(s, id));
		step(s, EMPTY_INPUT, setup.config);
		expect(r.cleared).toBe(1);
		expect(st.counts[ScoreSource.ROOMS]).toBe(1);
		expect(st.points[ScoreSource.PERFECT]).toBe(0);
		expect(st.points[ScoreSource.FAST]).toBe(0);
	});

	it("the floor clear pays 1000 x floor x (rooms cleared / enemy rooms): one room of n cleared, then skipped", () => {
		const { setup, s } = runOn(1);
		const st = s.score!;
		const total = st.rooms.size();
		expect(total).toBeGreaterThan(1);
		const id = firstRoom(setup, s);
		enter(setup, s, id);
		killAll(setup, s, members(s, id));
		step(s, EMPTY_INPUT, setup.config);
		expect(st.counts[ScoreSource.ROOMS]).toBe(1);
		const combo = st.combo;
		step(s, SKIP, setup.config);
		expect(s.events.floorChanged).toBe(2);
		const base = floorClearBase(1, 1, total);
		expect(base).toBe(math.floor(FLOOR_CLEAR_POINTS / total));
		expect(st.points[ScoreSource.FLOORS]).toBe(math.floor((base * combo) / 10));
	});

	it("a floor change awards the floor clear first, then rebuilds the records for the new floor", () => {
		const { setup, s } = runOn(1);
		const id = firstRoom(setup, s);
		enter(setup, s, id); // floor 1: one room engaged, not cleared
		step(s, SKIP, setup.config);
		expect(s.events.floorChanged).toBe(2);
		const st = s.score!;
		// No room of floor 1 was cleared: the floor clear pays 1000 x 0 / rooms (it counts as a clear, for 0 points).
		expect(st.points[ScoreSource.FLOORS]).toBe(0);
		expect(st.counts[ScoreSource.FLOORS]).toBe(1);
		expect(st.counts[ScoreSource.ROOMS]).toBe(0); // freeing floor 1's actors cleared nothing
		const w2 = setup.endlessFloor(2);
		const ids: number[] = [];
		for (let k = 0; k < w2.roomSpawns.size(); k++) if (w2.roomSpawns[k].size() > 0) ids.push(k);
		expect(st.rooms.map((r) => r.room)).toEqual(ids);
		for (const r of st.rooms) expect([r.memberSlots.size(), r.engageTick]).toEqual([0, -1]);
		for (const a of s.combat.actors) expect(a.kind).toBe(NO_KIND);
		dismissDraft(s); // the boon draft the floor change opened (it freezes the world)
		step(s, SKIP, setup.config); // held: nothing; release + press: floor 2 -> 3, nothing entered or cleared
		step(s, EMPTY_INPUT, setup.config);
		step(s, SKIP, setup.config);
		expect(s.events.floorChanged).toBe(3);
		expect(st.points[ScoreSource.FLOORS]).toBe(0);
		expect(st.counts[ScoreSource.FLOORS]).toBe(2);
	});
});
