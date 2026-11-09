// Room edge states (docs/ROOM_EDGES.md RE2) over real runs, update() called after every tick:
//   - endless (seed 1337, floor 1): a fighting bot walks into the nearest enemy rooms and clears one; every room with
//     spawns is WAITING until its roomEntered tick, LIVE from that very tick, SAFE from the tick its record clears;
//     rooms without spawns are SAFE throughout
//   - the boss: the recorded seed-1337 descent (recordEndlessRun) replayed; on floor 5 Mother Mayhem's room is WAITING
//     while she is dormant, LIVE from her phase-1 tick, SAFE from her kill; every other floor obeys the room rules
//   - tutorial floor 1 under the tutorial bot: the lesson rooms go WAITING -> LIVE -> SAFE, in walk order
//   - fallback parity: run-full-1337's recorded inputs unscored (fallback records from buildScoreRooms at tick 0) and
//     scored give identical per-room transition ticks; neither the records nor the sim state are touched
//   - fightOn (docs/COMBO.md CB1), the LIVE rule alone, on a fresh scored / unscored M1 state: a room engaged, cleared,
//     without members; the boss dormant, awake, dead
import { describe, expect, it } from "@rbxts/jest-globals";
import { TUTORIAL } from "shared/config";
import type { EncounterConfig } from "shared/dungeon";
import runFull from "shared/fixtures-generated/run-full-1337";
import {
	TUTORIAL_ROOMS,
	buildEndlessRunConfig,
	buildRunConfig,
	tutorialRoom,
	type EndlessRunSetup,
	PlayerMover,
	setPlayerMover,
} from "shared/run";
import { Driver, distanceField, frame, playTutorial, recordEndlessRun, walkDir, type Field } from "shared/run/testing";
import {
	Button,
	NO_KIND,
	WEB_SWORD_TIMINGS,
	WEB_BOSS_HP,
	WEB_SWARMER_HP,
	archetypeAt,
	buildScoreRooms,
	createSimState,
	deserializeRecording,
	hashState,
	setSwordTimings,
	setBossHp,
	setSwarmerHp,
	step,
	stepRecorded,
	type ActorState,
	type InputFrame,
	type Recording,
	type RoomScore,
	type RunFixture,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { RoomEdgeState, RoomEdgeStates, fightOn } from ".";

const { SAFE, WAITING, LIVE } = RoomEdgeState;
/** One state change: [post-step tick, state]; a room's first entry is the state at the floor's first update. */
type Transition = [number, number];

/** Per-floor traces: each room's transitions, plus the sim's own events and score facts at the same ticks. */
interface FloorTrace {
	readonly floor: number;
	readonly startTick: number;
	readonly encounter: EncounterConfig;
	/** Planned deferred spawns per room (endless floors; M1: none). */
	readonly spawns: ReadonlyArray<number>;
	readonly bossFloor: boolean;
	readonly rooms: Transition[][];
	/** Tick of the room's roomEntered event, of its record's clear; the boss's first phase > 0 and its kill. */
	readonly entered: Map<number, number>;
	readonly cleared: Map<number, number>;
	bossWokeTick: number;
	bossKilledTick: number;
}

/** Calls RoomEdgeStates.update after every tick of a run and traces the result (new states on every floor change). */
class EdgeObserver {
	readonly floors: FloorTrace[] = [];
	private edges: RoomEdgeStates | undefined;
	private cur: FloorTrace | undefined;

	constructor(
		private readonly floorOf: (s: Readonly<SimState>) => {
			encounter: EncounterConfig;
			spawns: ReadonlyArray<number>;
			bossFloor: boolean;
		},
		private readonly fallback?: (s: Readonly<SimState>, e: EncounterConfig) => ReadonlyArray<RoomScore>,
	) {}

	observe(s: Readonly<SimState>): void {
		const floor = s.endless !== undefined ? s.endless.floor : 0;
		let t = this.cur;
		if (t === undefined || t.floor !== floor) {
			const f = this.floorOf(s);
			const n = f.encounter.rooms.size();
			const rooms: Transition[][] = [];
			for (let r = 0; r < n; r++) rooms.push([]);
			t = {
				floor,
				startTick: s.tick,
				encounter: f.encounter,
				spawns: f.spawns,
				bossFloor: f.bossFloor,
				rooms,
				entered: new Map(),
				cleared: new Map(),
				bossWokeTick: -1,
				bossKilledTick: -1,
			};
			this.cur = t;
			this.floors.push(t);
			this.edges = new RoomEdgeStates(n, this.fallback?.(s, f.encounter));
		} else {
			const ev = s.events;
			if (ev.roomEntered > 0) t.entered.set(ev.roomEntered - 1, s.tick);
			if (ev.bossDefeated !== 0 && t.bossKilledTick < 0) t.bossKilledTick = s.tick;
		}
		if (t.bossWokeTick < 0 && livingBossPhase(s) > 0) t.bossWokeTick = s.tick;
		if (s.score !== undefined) {
			for (const rec of s.score.rooms)
				if (rec.cleared === 1 && !t.cleared.has(rec.room)) t.cleared.set(rec.room, s.tick);
		}
		const states = this.edges!.update(s, t.encounter);
		expect(states.size()).toBe(t.rooms.size());
		for (let r = 0; r < states.size(); r++) {
			const tr = t.rooms[r];
			if (tr.size() === 0 || tr[tr.size() - 1][1] !== states[r]) tr.push([s.tick, states[r]]);
		}
	}
}

/** The highest phase of a living boss, -1 without one. */
function livingBossPhase(s: Readonly<SimState>): number {
	let phase = -1;
	for (const a of s.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0 || archetypeAt(a.kind).data.boss !== true) continue;
		phase = math.max(phase, a.phase);
	}
	return phase;
}

/** EdgeObserver's floor facts on an endless run (the current floor's world). */
function endlessFloorOf(setup: EndlessRunSetup) {
	return (s: Readonly<SimState>) => {
		const w = setup.endlessFloor(s.endless!.floor);
		return { encounter: w.config.encounter!, spawns: w.roomSpawns.map((x) => x.size()), bossFloor: w.bossFloor };
	};
}

/**
 * The expected transitions of every room of a traced endless floor: the boss room of a boss floor WAITING, LIVE from
 * the boss's first phase > 0, SAFE from its kill; a room without spawns SAFE throughout; a room with spawns WAITING,
 * LIVE from its roomEntered tick, SAFE from its record's clear tick.
 */
function expectedRooms(t: FloorTrace): Transition[][] {
	const out: Transition[][] = [];
	for (let r = 0; r < t.rooms.size(); r++) {
		const want: Transition[] = [];
		if (t.bossFloor && r === t.encounter.bossRoom) {
			want.push([t.startTick, WAITING]);
			if (t.bossWokeTick >= 0) want.push([t.bossWokeTick, LIVE]);
			if (t.bossKilledTick >= 0) want.push([t.bossKilledTick, SAFE]);
		} else if ((t.spawns[r] ?? 0) === 0) {
			want.push([t.startTick, SAFE]);
		} else {
			want.push([t.startTick, WAITING]);
			const entered = t.entered.get(r);
			if (entered !== undefined) want.push([entered, LIVE]);
			const cleared = t.cleared.get(r);
			if (cleared !== undefined) want.push([cleared, SAFE]);
		}
		out.push(want);
	}
	return out;
}

/** One line per floor and room that changed state (the spec log). */
function describeTrace(floors: ReadonlyArray<FloorTrace>): string {
	const names = ["safe", "waiting", "live"];
	const lines: string[] = [];
	for (const t of floors) {
		const parts: string[] = [];
		for (let r = 0; r < t.rooms.size(); r++) {
			const tr = t.rooms[r];
			if (tr.size() < 2) continue;
			parts.push(`room ${r}: ${tr.map(([tick, st]) => `${names[st]}@${tick}`).join(" ")}`);
		}
		lines.push(`floor ${t.floor} (from tick ${t.startTick}): ${parts.size() > 0 ? parts.join("; ") : "no change"}`);
	}
	return lines.join("\n");
}

/** The endless bot's Driver with an EdgeObserver after every tick. */
class ObservedDriver extends Driver {
	constructor(setup: EndlessRunSetup, seed: number, readonly obs: EdgeObserver) {
		super(setup, seed);
		obs.observe(this.state);
	}

	tick(input: InputFrame): void {
		super.tick(input);
		this.obs.observe(this.state);
	}
}

/** Melee reach the fight bot closes to (SWORD_DATA.reach 1.955 minus a margin, plus the target's radius). */
const MELEE_RANGE = 1.2;
/** Fight bot: re-path to the target every this many ticks; roll every this many. */
const REPATH_TICKS = 10;
const ROLL_EVERY = 45;
const WALK_BUDGET = 3000;
const FIGHT_BUDGET = 3000;

function record(s: Readonly<SimState>, room: number): RoomScore | undefined {
	return s.score!.rooms.find((r) => r.room === room);
}

/** Walks into room `id` (until its roomEntered), then melees its members until its record clears. */
function clearRoomWithBot(drv: ObservedDriver, id: number): void {
	const w = drv.world();
	const room = w.config.encounter!.rooms[id];
	const stair: [number, number] = [w.stairX, w.stairZ];
	const s = drv.state;
	drv.walkTo(room.cx, room.cz, () => s.endless!.roomsEntered[id] === 1, WALK_BUDGET, stair);
	let field: Field | undefined;
	let n = 0;
	while (n < FIGHT_BUDGET && s.player.dead === 0 && record(s, id)!.cleared === 0 && drv.floor() === w.floor) {
		const rec = record(s, id)!;
		const p = s.player;
		let target: ActorState | undefined;
		let best = math.huge;
		for (let k = 0; k < rec.memberSlots.size(); k++) {
			const a = s.combat.actors[rec.memberSlots[k]];
			if (a.kind === NO_KIND || a.alive === 0 || a.id !== rec.memberIds[k]) continue;
			const d2 = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
			if (d2 < best) {
				best = d2;
				target = a;
			}
		}
		if (target === undefined) {
			drv.tick(frame(0, 0));
			n++;
			continue;
		}
		const d = math.sqrt(best);
		const ax = (target.x - p.x) / math.max(d, 1e-6);
		const az = (target.z - p.z) / math.max(d, 1e-6);
		let mx = 0;
		let mz = 0;
		if (d > MELEE_RANGE + target.radius) {
			if (field === undefined || n % REPATH_TICKS === 0)
				field = distanceField(w.dungeon, target.x, target.z, stair);
			[mx, mz] = walkDir(field, p.x, p.z);
		}
		const buttons = n % ROLL_EVERY === ROLL_EVERY - 1 ? Button.ROLL : Button.FIRE;
		drv.tick(frame(mx, mz, drv.assisted(buttons), ax, az));
		n++;
	}
}

/** Replays a recording from a fresh state with an EdgeObserver after every tick. */
function replayObserved(seed: number, setup: EndlessRunSetup, rec: Recording, obs: EdgeObserver): void {
	const spawn = setup.spawn!;
	const s = createSimState(seed, spawn.x, spawn.z, setup.config);
	obs.observe(s);
	for (let t = 0; t < rec.frames.size(); t++) {
		stepRecorded(s, rec, t, setup.config);
		obs.observe(s);
	}
}

const ENDLESS_SEED = 1337;
/** Enemy rooms the fight bot walks into (nearest first); it clears the first one. */
const ROOMS_TO_ENTER = 2;

describe("RoomEdgeStates: endless rooms (fight bot, seed 1337 floor 1)", () => {
	const setup = buildEndlessRunConfig(ENDLESS_SEED);
	const obs = new EdgeObserver(endlessFloorOf(setup));
	const drv = new ObservedDriver(setup, ENDLESS_SEED, obs);
	const w = drv.world();
	const p0 = drv.state.player;
	const order: number[] = [];
	for (let id = 0; id < w.roomSpawns.size(); id++) if (w.roomSpawns[id].size() > 0) order.push(id);
	const dist = (id: number) => {
		const r = w.config.encounter!.rooms[id];
		return (r.cx - p0.x) * (r.cx - p0.x) + (r.cz - p0.z) * (r.cz - p0.z);
	};
	order.sort((a, b) => dist(a) < dist(b));
	clearRoomWithBot(drv, order[0]);
	for (let k = 1; k < math.min(ROOMS_TO_ENTER, order.size()); k++) {
		const r = w.config.encounter!.rooms[order[k]];
		drv.walkTo(r.cx, r.cz, () => drv.state.endless!.roomsEntered[order[k]] === 1, WALK_BUDGET, [
			w.stairX,
			w.stairZ,
		]);
	}
	const t = obs.floors[0];
	print(`[roomEdgeState] endless fight bot\n${describeTrace(obs.floors)}`);

	it("stays on floor 1 with the player alive, enters enemy rooms and clears the first one", () => {
		expect([obs.floors.size(), t.floor, drv.state.player.dead]).toEqual([1, 1, 0]);
		expect(t.entered.size() >= ROOMS_TO_ENTER).toBe(true);
		expect(t.cleared.has(order[0])).toBe(true);
	});

	it("WAITING before entry, LIVE from the roomEntered tick, SAFE from the clear tick; rooms without spawns SAFE", () => {
		expect(t.rooms).toEqual(expectedRooms(t));
		const first = t.rooms[order[0]];
		expect(first.map(([, st]) => st)).toEqual([WAITING, LIVE, SAFE]);
		expect(first[1][0]).toBe(t.entered.get(order[0]));
		expect(first[2][0]).toBe(t.cleared.get(order[0]));
		expect(first[1][0] < first[2][0]).toBe(true);
	});
});

describe("RoomEdgeStates: the boss (recorded seed-1337 descent, floors 1-8)", () => {
	const recorded = recordEndlessRun(ENDLESS_SEED);
	const obs = new EdgeObserver(endlessFloorOf(recorded.setup));
	replayObserved(ENDLESS_SEED, recorded.setup, recorded.recording, obs);
	print(`[roomEdgeState] recorded descent\n${describeTrace(obs.floors)}`);

	it("replays floors 1-8", () => {
		expect(obs.floors.map((f) => f.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it("floor 5's boss room: WAITING while dormant, LIVE from phase 1, SAFE from the kill", () => {
		const t = obs.floors[4];
		expect(t.bossFloor).toBe(true);
		const boss = t.encounter.bossRoom;
		expect(t.bossWokeTick > t.startTick).toBe(true);
		expect(t.bossKilledTick > t.bossWokeTick).toBe(true);
		expect(t.rooms[boss]).toEqual([
			[t.startTick, WAITING],
			[t.bossWokeTick, LIVE],
			[t.bossKilledTick, SAFE],
		]);
	});

	it("every floor's rooms follow the room rules (entered rooms LIVE on their roomEntered tick)", () => {
		for (const t of obs.floors) expect([t.floor, t.rooms]).toEqual([t.floor, expectedRooms(t)]);
		let entered = 0;
		for (const t of obs.floors) for (const [r] of t.entered) if ((t.spawns[r] ?? 0) > 0) entered++;
		expect(entered > 0).toBe(true);
	});
});

describe("RoomEdgeStates: tutorial floor 1 (tutorial bot)", () => {
	const played = playTutorial();
	const obs = new EdgeObserver(endlessFloorOf(played.setup));
	replayObserved(TUTORIAL.runSeed, played.setup, played.run.recorder.getRecording(), obs);
	print(`[roomEdgeState] tutorial\n${describeTrace(obs.floors)}`);
	const t = obs.floors[0];

	it("the lesson rooms with enemies go WAITING -> LIVE -> SAFE, in walk order", () => {
		expect(t.floor).toBe(1);
		let lastSafe = -1;
		let lessons = 0;
		for (const plan of TUTORIAL_ROOMS) {
			const id = tutorialRoom(plan.lesson).roomId;
			const tr = t.rooms[id];
			if (plan.kinds.size() === 0) {
				expect([plan.lesson, tr]).toEqual([plan.lesson, [[0, SAFE]]]);
				continue;
			}
			lessons++;
			expect([plan.lesson, tr.map(([, st]) => st)]).toEqual([plan.lesson, [WAITING, LIVE, SAFE]]);
			expect([plan.lesson, tr[1][0], tr[2][0]]).toEqual([plan.lesson, t.entered.get(id), t.cleared.get(id)]);
			expect(tr[1][0] > lastSafe).toBe(true);
			lastSafe = tr[2][0];
		}
		expect(lessons).toBe(6); // combat A-D, F, G (G: the pellet lesson, docs/PELLETS.md PL11; no E: docs/ARCHER.md AR6)
	});

	it("every tutorial floor's rooms follow the room rules", () => {
		for (const f of obs.floors) expect([f.floor, f.rooms]).toEqual([f.floor, expectedRooms(f)]);
	});
});

describe("RoomEdgeStates: fallback parity (run-full-1337's inputs, unscored vs KV_Scoring)", () => {
	const run = runFull as unknown as RunFixture;
	const recording = deserializeRecording(run.recording);

	/** Steps the recording from a fresh state, observing after every tick (scored run: no fallback). */
	function traceScored(config: SimConfig): EdgeObserver {
		const encounter = config.encounter!;
		const obs = new EdgeObserver(() => ({ encounter, spawns: [], bossFloor: true }));
		const s = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, config);
		obs.observe(s);
		for (let t = 0; t < recording.frames.size(); t++) {
			step(s, recording.frames[t], config);
			obs.observe(s);
		}
		return obs;
	}

	// The web build's mover (port: the slide), read when the config is built: set before buildRunConfig, restored below.
	const portMover = setPlayerMover(PlayerMover.WEB);
	const plain = buildRunConfig(run.seed).config;
	const scored = buildRunConfig(run.seed, { scoring: {} }).config;
	let unscoredTrace: FloorTrace | undefined;
	let scoredTrace: FloorTrace | undefined;
	let touched = 0;
	let fallbackRecords: ReadonlyArray<RoomScore> = [];
	// Recorded with the web build's sword (CLAUDE.md decision log): replay under its timings, restored right after.
	const portSword = setSwordTimings(WEB_SWORD_TIMINGS);
	const portSwarmerHp = setSwarmerHp(WEB_SWARMER_HP); // the web swarmer's 2 hp (port: 1)
	const portBossHp = setBossHp(WEB_BOSS_HP); // the web boss's 540 hp (port: 270)
	try {
		// The fallback records the unscored observer builds at tick 0, kept to prove update() never mutates them.
		const probe = new EdgeObserver(
			() => ({ encounter: plain.encounter!, spawns: [], bossFloor: true }),
			(s, e) => {
				fallbackRecords = buildScoreRooms(s, e);
				return fallbackRecords;
			},
		);
		const s0 = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, plain);
		probe.observe(s0);
		const plainObs = new EdgeObserver(
			() => ({ encounter: plain.encounter!, spawns: [], bossFloor: true }),
			() => fallbackRecords,
		);
		const s = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, plain);
		plainObs.observe(s);
		for (let t = 0; t < recording.frames.size(); t++) {
			step(s, recording.frames[t], plain);
			const before = hashState(s);
			plainObs.observe(s);
			if (hashState(s) !== before) touched++;
		}
		unscoredTrace = plainObs.floors[0];
		scoredTrace = traceScored(scored).floors[0];
	} finally {
		setSwordTimings(portSword);
		setSwarmerHp(portSwarmerHp);
		setPlayerMover(portMover);
		setBossHp(portBossHp);
	}
	print(
		`[roomEdgeState] run-full-1337 unscored\n${describeTrace([unscoredTrace!])}\nscored\n${describeTrace([
			scoredTrace!,
		])}`,
	);

	it("the unscored run has no score state; the scored one does", () => {
		expect(plain.scoring).toBe(undefined);
		expect(scored.scoring).never.toBe(undefined);
	});

	it("identical per-room transition ticks, with at least one room engaged and cleared", () => {
		expect(unscoredTrace!.rooms).toEqual(scoredTrace!.rooms);
		const full = unscoredTrace!.rooms.filter((tr) => tr.size() === 3 && tr[1][1] === LIVE && tr[2][1] === SAFE);
		expect(full.size() > 0).toBe(true);
		// The scored run's transitions are its records' own engage / clear ticks.
		for (const [room, tick] of scoredTrace!.cleared) {
			const tr = scoredTrace!.rooms[room];
			expect(tr[tr.size() - 1]).toEqual([tick, SAFE]);
		}
	});

	it("the boss room: WAITING while dormant, LIVE from phase 1 (the player dies to her: no kill)", () => {
		const t = unscoredTrace!;
		expect(t.bossWokeTick > 0).toBe(true);
		expect(t.rooms[t.encounter.bossRoom]).toEqual([
			[0, WAITING],
			[t.bossWokeTick, LIVE],
		]);
	});

	it("never mutates the sim state or the fallback records", () => {
		expect(touched).toBe(0);
		const s0 = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, plain);
		expect(fallbackRecords).toEqual(buildScoreRooms(s0, plain.encounter));
	});
});

describe("fightOn: the LIVE rule alone (docs/COMBO.md CB1)", () => {
	const SEED = 1337;
	function m1(scored: boolean): SimState {
		const setup = buildRunConfig(SEED, scored ? { scoring: {} } : {});
		return createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
	}
	function boss(s: Readonly<SimState>): ActorState {
		const b = s.combat.actors.find((a) => a.kind !== NO_KIND && archetypeAt(a.kind).data.boss === true);
		if (b === undefined) error("no boss", 0);
		return b;
	}

	it("a fresh run: no room engaged, the boss dormant -> no fight", () => {
		const s = m1(true);
		expect(s.score!.rooms.size() > 0).toBe(true);
		expect(boss(s).phase).toBe(0);
		expect(fightOn(s)).toBe(false);
	});

	it("a room engaged and not cleared is a fight; cleared it is not; a record without members never is", () => {
		const s = m1(true);
		const rec = s.score!.rooms[0];
		rec.engageTick = 3;
		expect(fightOn(s)).toBe(true);
		rec.cleared = 1;
		expect(fightOn(s)).toBe(false);
		rec.cleared = 0;
		const slots = rec.memberSlots;
		rec.memberSlots = [];
		expect(fightOn(s)).toBe(false);
		rec.memberSlots = slots;
		expect(fightOn(s)).toBe(true);
	});

	it("the boss: phase 0 no fight, phase > 0 a fight (scored or not), dead no fight", () => {
		for (const scored of [true, false]) {
			const s = m1(scored);
			const b = boss(s);
			expect([scored, fightOn(s)]).toEqual([scored, false]);
			b.phase = 1;
			expect([scored, fightOn(s)]).toEqual([scored, true]);
			b.phase = 2;
			expect([scored, fightOn(s)]).toEqual([scored, true]);
			b.alive = 0;
			expect([scored, fightOn(s)]).toEqual([scored, false]);
		}
	});
});
