// The decor director (docs/DECOR.md Phase 2 part 3, R10) over the recorded seed-1337 endless descent
// (shared/run/testing recordEndlessRun: floors 1-4 skipped with a relic and a curse on the way, floor 5's Mother Bramble
// fought and killed, floor 6 walked to its stairwell): rooms dark until entered, the ignition sweep from the entering
// player, braziers on the clear, the flat boss ring by phase, the stairwell glow, the pedestal glint and the shrine dim;
// the same room facts with 1-5 ticks per frame; drafts freeze it; restarts, scene mismatches, the Ember gutter, reduced
// motion and the run-over fade (solo and a 2-player party).
import { describe, expect, it } from "@rbxts/jest-globals";
import { accumulateEvents, newFrameEvents, resetFrameEvents, type FrameEvents } from "shared/play";
import { buildEndlessRunConfig, type EndlessRunSetup } from "shared/run";
import { recordEndlessRun, type RecordedEndlessRun } from "shared/run/testing";
import {
	EMPTY_INPUT,
	SIM_DT,
	SIM_HZ,
	cloneSimState,
	createSimState,
	isDraftOpen,
	killPlayerState,
	playerAt,
	stepParty,
	stepRecorded,
	type SimState,
} from "shared/sim";
import {
	DECOR_REACT,
	DecorDirector,
	decorBossRing,
	decorInputOfLayout,
	decorScene,
	planDecor,
	type DecorScene,
	type DecorView,
} from ".";

const SEED = 1337;
let recorded: RecordedEndlessRun | undefined;
function run(): RecordedEndlessRun {
	if (recorded === undefined) recorded = recordEndlessRun(SEED);
	return recorded;
}

/** Scenes per floor of a run setup (planned once, at the Depth the floor was first seen with). */
function sceneCache(setup: EndlessRunSetup): (state: Readonly<SimState>) => DecorScene {
	const scenes = new Map<number, DecorScene>();
	return (state) => {
		const floor = state.endless!.floor;
		let s = scenes.get(floor);
		if (s === undefined) {
			const layout = setup.endlessFloor(floor).layout;
			const input = decorInputOfLayout(layout, state.endless!.depth);
			s = decorScene(input, planDecor(input), layout.bossFloor);
			scenes.set(floor, s);
		}
		return s;
	};
}

interface FrameInfo {
	readonly tick: number;
	readonly state: Readonly<SimState>;
	readonly view: Readonly<DecorView>;
	readonly scene: DecorScene;
	readonly frameNo: number;
}

/**
 * Replays the recorded run through a fresh state, `ticksPerFrame(frameNo)` ticks per rendered frame (events summed as
 * LiveRun does, or only the last tick's with `lastTickEvents`), the director updated after each frame with dt = the
 * frame's ticks x SIM_DT.
 */
function replay(
	r: RecordedEndlessRun,
	ticksPerFrame: (frameNo: number) => number,
	observe: (f: FrameInfo) => void,
	opts: { motion?: number; lastTickEvents?: boolean } = {},
): DecorDirector {
	const setup = r.setup;
	const state = createSimState(r.seed, setup.spawn!.x, setup.spawn!.z, setup.config);
	const sceneOf = sceneCache(setup);
	const director = new DecorDirector();
	const events: FrameEvents = newFrameEvents();
	const total = r.recording.frames.size();
	let t = 0;
	let frameNo = 0;
	while (t < total) {
		const k = math.max(1, ticksPerFrame(frameNo));
		resetFrameEvents(events);
		let ran = 0;
		while (ran < k && t < total) {
			stepRecorded(state, r.recording, t, setup.config);
			if (opts.lastTickEvents === true) resetFrameEvents(events);
			accumulateEvents(events, state.events);
			t++;
			ran++;
		}
		const scene = sceneOf(state);
		const view = director.update({
			state,
			config: setup.config,
			events,
			scene,
			dt: ran * SIM_DT,
			motion: opts.motion,
		});
		observe({ tick: state.tick, state, view, scene, frameNo });
		frameNo++;
	}
	return director;
}

/** The state-derived facts of a view (identical whatever the frame pacing). */
function facts(v: Readonly<DecorView>): string {
	const parts: string[] = [];
	for (let r = 0; r < v.roomEntered.size(); r++)
		parts.push(`${v.roomEntered[r] ? 1 : 0}${v.roomEngaged[r] ? 1 : 0}${v.roomCleared[r] ? 1 : 0}`);
	let ignited = "";
	for (const b of v.ignited) ignited += b ? "1" : "0";
	parts.push(ignited, v.bossDefeated ? "D" : "-", v.stairOpen ? "S" : "-", v.bossFloor ? "B" : "-");
	return parts.join(" ");
}

/** Per floor and room: the first tick it was entered, its torches' first lit tick, and the entering player spot. */
interface RoomTrace {
	enteredTick: number;
	snapped: boolean;
	px: number;
	pz: number;
	readonly firstLit: Map<number, number>;
	readonly fullTick: Map<number, number>;
}

interface Census {
	readonly rooms: Map<string, RoomTrace>;
	darkViolations: number;
	darkChecks: number;
	brazierViolations: number;
	brazierChecks: number;
	maxFlare: number;
	ringBeforeEngage: number;
	ringLitByPhase: Map<number, number>;
	ringAfterKill: number;
	ringSize: number;
	stairBeforeKill: number;
	stairAfterKill: number;
	stairFloor6First: number;
	glintDropped: boolean;
	glintSeen: boolean;
	shrineDimmed: boolean;
	draftFrames: number;
	draftTimeMoved: number;
	revisions: number;
	readonly floorsSeen: Set<number>;
	notReady: number;
}

function census(r: RecordedEndlessRun): Census {
	const c: Census = {
		rooms: new Map(),
		darkViolations: 0,
		darkChecks: 0,
		brazierViolations: 0,
		brazierChecks: 0,
		maxFlare: 0,
		ringBeforeEngage: 0,
		ringLitByPhase: new Map(),
		ringAfterKill: -1,
		ringSize: -1,
		stairBeforeKill: 0,
		stairAfterKill: 0,
		stairFloor6First: -1,
		glintDropped: false,
		glintSeen: false,
		shrineDimmed: false,
		draftFrames: 0,
		draftTimeMoved: 0,
		revisions: 0,
		floorsSeen: new Set(),
		notReady: 0,
	};
	let lastTime = -1;
	let lastRevision = -1;
	let wasDraft = false;
	replay(
		r,
		() => 1,
		(f) => {
			const v = f.view;
			const plan = f.scene.plan;
			const floor = f.scene.floor;
			runSceneByFloor.set(floor, f.scene);
			c.floorsSeen.add(floor);
			if (!v.ready) c.notReady++;
			if (v.revision !== lastRevision) {
				c.revisions++;
				lastRevision = v.revision;
			}
			const draft = isDraftOpen(f.state);
			if (draft && wasDraft) {
				c.draftFrames++;
				if (v.time !== lastTime) c.draftTimeMoved++;
			}
			wasDraft = draft;
			lastTime = v.time;
			for (let room = 0; room < f.scene.roomCount; room++) {
				const bossDark = room === f.scene.bossRoom && v.bossFloor;
				const key = `${floor}/${room}`;
				let trace = c.rooms.get(key);
				if (v.roomEntered[room] && trace === undefined && !bossDark) {
					const p = f.state.player;
					trace = {
						enteredTick: f.tick,
						snapped: v.snapped,
						px: p.x,
						pz: p.z,
						firstLit: new Map(),
						fullTick: new Map(),
					};
					c.rooms.set(key, trace);
				}
				for (const i of plan.lightsByRoom[room]) {
					const e = plan.entries[i];
					if (!v.roomEntered[room] && !bossDark) {
						c.darkChecks++;
						if (v.lit[i] !== 0) c.darkViolations++;
					}
					if (e.kind === "brazier" && e.lit) {
						c.brazierChecks++;
						if (!v.roomCleared[room] && v.lit[i] !== 0) c.brazierViolations++;
						if (v.flare[i] > c.maxFlare) c.maxFlare = v.flare[i];
					}
					if (trace !== undefined && e.kind === "torch" && e.lit) {
						if (v.lit[i] > 0 && !trace.firstLit.has(i)) trace.firstLit.set(i, f.tick);
						if (v.lit[i] >= 1 && !trace.fullTick.has(i)) trace.fullTick.set(i, f.tick);
					}
				}
			}
			// boss floor 5
			if (floor === 5) {
				c.ringSize = v.ring.size();
				let on = 0;
				for (const x of v.ring) if (x > 0) on++;
				if (!v.bossEngaged && !v.bossDefeated) c.ringBeforeEngage = math.max(c.ringBeforeEngage, on);
				if (v.bossEngaged && !v.bossDefeated) {
					const was = c.ringLitByPhase.get(v.bossPhase) ?? 0;
					let full = 0;
					for (const x of v.ring) if (x >= 1) full++;
					c.ringLitByPhase.set(v.bossPhase, math.max(was, full));
				}
				if (v.bossDefeated) {
					let full = 0;
					for (const x of v.ring) if (x >= 1) full++;
					c.ringAfterKill = math.max(c.ringAfterKill, full);
					c.stairAfterKill = math.max(c.stairAfterKill, v.stairGlow);
				} else c.stairBeforeKill = math.max(c.stairBeforeKill, v.stairGlow);
			}
			if (floor === 6 && c.stairFloor6First < 0) c.stairFloor6First = v.stairGlow;
			if (floor === r.relicFloor) {
				for (const g of v.glint) if (g >= 1) c.glintSeen = true;
				if (c.glintSeen && v.glint.size() > 0 && v.glint[0] === 0) c.glintDropped = true;
				if (v.shrineDim > 0) c.shrineDimmed = true;
			}
		},
	);
	return c;
}

let censusResult: Census | undefined;
/** The census replay's scene of `floor` (the same objects the director saw). */
function sceneOfRun(floor: number): DecorScene {
	return runSceneByFloor.get(floor)!;
}
const runSceneByFloor = new Map<number, DecorScene>();
function getCensus(): Census {
	if (censusResult === undefined) censusResult = census(run());
	return censusResult;
}

describe("DecorDirector over the recorded endless run", () => {
	it("keeps the torches of every room not yet entered out, and braziers dark until their room is cleared", () => {
		const c = getCensus();
		print(
			`[decor director] ${c.darkChecks} dark checks, ${
				c.brazierChecks
			} brazier checks, ${c.rooms.size()} rooms entered, ${c.revisions} resets`,
		);
		expect(c.darkChecks > 1000).toBe(true);
		expect(c.darkViolations).toBe(0);
		expect(c.brazierViolations).toBe(0);
		expect(c.notReady).toBe(0);
		expect(c.revisions).toBe(c.floorsSeen.size()); // a reset per floor
		expect(c.floorsSeen.size() >= 7).toBe(true);
	});

	it("lights a room's torches in a sweep from the entering player, igniteStepSeconds apart, nearest first", () => {
		const c = getCensus();
		const stepTicks = DECOR_REACT.igniteStepSeconds * SIM_HZ;
		const fadeTicks = DECOR_REACT.igniteFadeSeconds * SIM_HZ;
		let swept = 0;
		for (const [key, trace] of c.rooms) {
			const floor = tonumber(key.split("/")[0])!;
			const lit = trace.firstLit.size();
			if (lit < 2 || trace.snapped) continue; // a reset's snap lights everything at once
			// every torch lit, all within (count - 1) steps + the fade
			let first = math.huge;
			let last = -math.huge;
			let firstEntry = -1;
			for (const [i, tk] of trace.firstLit) {
				if (tk < first || (tk === first && i < firstEntry)) {
					first = tk;
					firstEntry = i;
				}
				last = math.max(last, tk);
			}
			expect(last - first).toBeGreaterThanOrEqual(math.floor((lit - 1) * stepTicks) - 1);
			expect(last - first).toBeLessThanOrEqual(math.ceil((lit - 1) * stepTicks) + 1);
			for (const [i, tk] of trace.fullTick) {
				expect(tk - trace.firstLit.get(i)!).toBeLessThanOrEqual(math.ceil(fadeTicks) + 1);
			}
			// the first one lit is the nearest to where the player stood when the room was entered
			const plan = sceneOfRun(floor).plan;
			const d2 = (i: number) => {
				const e = plan.entries[i];
				return (e.x - trace.px) * (e.x - trace.px) + (e.z - trace.pz) * (e.z - trace.pz);
			};
			for (const [i] of trace.firstLit) expect(d2(firstEntry) <= d2(i) + 1e-9).toBe(true);
			swept++;
		}
		print(`[decor director] ${swept} rooms swept live`);
		expect(swept > 0).toBe(true);
	});

	it("lights the flat boss ring a third per phase, all of it after the kill, and the braziers with a flare", () => {
		const c = getCensus();
		const parts: string[] = [];
		for (const [p, n] of c.ringLitByPhase) parts.push(`phase ${p}: ${n}`);
		print(`[decor director] boss ring ${c.ringSize} spots; ${parts.join(", ")}; after the kill ${c.ringAfterKill}`);
		expect(c.ringSize > 0).toBe(true);
		expect(c.ringBeforeEngage).toBe(0);
		for (const [phase, n] of c.ringLitByPhase) {
			expect(n).toBe(math.min(c.ringSize, math.ceil((c.ringSize * phase) / DECOR_REACT.bossPhases)));
		}
		expect(c.ringLitByPhase.size() >= 2).toBe(true);
		expect(c.ringAfterKill).toBe(c.ringSize);
		if (c.brazierChecks > 0) expect(c.maxFlare > 0.9).toBe(true);
	});

	it("opens the stairwell glow after the kill on the boss floor and at once on a normal floor", () => {
		const c = getCensus();
		expect(c.stairBeforeKill).toBe(0);
		expect(c.stairAfterKill).toBe(1);
		expect(c.stairFloor6First).toBe(1);
	});

	it("stops the pedestal glint once the relic is taken, and dims the used shrine", () => {
		const c = getCensus();
		expect(run().relicFloor > 0).toBe(true);
		expect(c.glintSeen).toBe(true);
		expect(c.glintDropped).toBe(true);
		expect(c.shrineDimmed).toBe(true);
	});

	it("stands still while a draft is open", () => {
		const c = getCensus();
		expect(c.draftFrames > 100).toBe(true);
		expect(c.draftTimeMoved).toBe(0);
	});

	it("reads the same room facts with 1-5 ticks per frame, even from the last tick's events only", () => {
		const r = run();
		const pattern = (n: number) => 1 + ((n * 7) % 5);
		const ticks = new Set<number>();
		{
			let t = 0;
			let n = 0;
			while (t < r.recording.frames.size()) {
				t = math.min(r.recording.frames.size(), t + pattern(n++));
				ticks.add(t);
			}
		}
		const single = new Map<number, string>();
		replay(
			r,
			() => 1,
			(f) => {
				if (ticks.has(f.tick)) single.set(f.tick, facts(f.view));
			},
		);
		let compared = 0;
		let mismatches = 0;
		for (const lastTickEvents of [false, true]) {
			replay(
				r,
				pattern,
				(f) => {
					const want = single.get(f.tick);
					if (want === undefined) return;
					compared++;
					if (want !== facts(f.view)) mismatches++;
				},
				{ lastTickEvents },
			);
		}
		print(`[decor director] ${compared} multi-tick frames compared`);
		expect(compared > 1000).toBe(true);
		expect(mismatches).toBe(0);
	});

	it("lights a room's torches together under reduced motion (no sweep, no flare)", () => {
		const r = run();
		const first = new Map<string, Map<number, number>>();
		let maxFlare = 0;
		replay(
			r,
			() => 1,
			(f) => {
				const v = f.view;
				const plan = f.scene.plan;
				for (let room = 0; room < f.scene.roomCount; room++) {
					for (const i of plan.lightsByRoom[room]) {
						maxFlare = math.max(maxFlare, v.flare[i]);
						if (plan.entries[i].kind !== "torch" || v.lit[i] <= 0) continue;
						const key = `${f.scene.floor}/${room}`;
						let m = first.get(key);
						if (m === undefined) {
							m = new Map();
							first.set(key, m);
						}
						if (!m.has(i)) m.set(i, f.tick);
					}
				}
			},
			{ motion: 0 },
		);
		let rooms = 0;
		for (const [, m] of first) {
			let lo = math.huge;
			let hi = -math.huge;
			for (const [, tk] of m) {
				lo = math.min(lo, tk);
				hi = math.max(hi, tk);
			}
			if (m.size() > 1) rooms++;
			expect(hi - lo).toBe(0);
		}
		expect(rooms > 0).toBe(true);
		expect(maxFlare).toBe(0);
	});
});

describe("DecorDirector: resets, mismatches, Ember, run over", () => {
	function setupAt(partySize = 1) {
		const setup = buildEndlessRunConfig(SEED, partySize);
		const state = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		const sceneOf = sceneCache(setup);
		return { setup, state, sceneOf };
	}
	const noEvents = { emberUsed: 0 };

	it("is not ready for a scene of another floor or without one, and resets on a new state", () => {
		const { setup, state, sceneOf } = setupAt();
		const director = new DecorDirector();
		const scene = sceneOf(state);
		let v = director.update({ state, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		expect(v.ready).toBe(true);
		const rev = v.revision;
		expect(v.roomEntered.size()).toBe(scene.roomCount);
		v = director.update({ state, config: setup.config, events: noEvents, scene: undefined, dt: SIM_DT });
		expect(v.ready).toBe(false);
		const other = setup.endlessFloor(2).layout;
		const input = decorInputOfLayout(other, 1);
		const scene2 = decorScene(input, planDecor(input), other.bossFloor);
		v = director.update({ state, config: setup.config, events: noEvents, scene: scene2, dt: SIM_DT });
		expect(v.ready).toBe(false);
		expect(v.revision).toBe(rev); // nothing reset by a mismatch
		const fresh = cloneSimState(state);
		v = director.update({ state: fresh, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		expect(v.ready).toBe(true);
		expect(v.revision).toBe(rev + 1);
	});

	it("gutters every flame for emberGutterSeconds on an Ember (scaled by motion), from the event or a drop in Embers", () => {
		const { setup, state, sceneOf } = setupAt();
		const scene = sceneOf(state);
		const director = new DecorDirector();
		director.update({ state, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		let v = director.update({ state, config: setup.config, events: { emberUsed: 1 }, scene, dt: SIM_DT });
		expect(v.gutter).toBe(1);
		const steps = math.ceil(DECOR_REACT.emberGutterSeconds / SIM_DT) + 1;
		for (let i = 0; i < steps; i++)
			v = director.update({ state, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		expect(v.gutter).toBe(0);
		state.player.embers -= 1; // a used Ember the events missed (a lossy frame)
		v = director.update({ state, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		expect(v.gutter).toBe(1);
		v = director.update({ state, config: setup.config, events: { emberUsed: 1 }, scene, dt: SIM_DT, motion: 0 });
		expect(v.gutter).toBe(0);
	});

	it("fades to the cold palette once the run is over, solo", () => {
		const { setup, state, sceneOf } = setupAt();
		const scene = sceneOf(state);
		const director = new DecorDirector();
		let v = director.update({ state, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		expect(v.cold).toBe(0);
		killPlayerState(state.player);
		v = director.update({ state, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		expect(v.cold).toBe(0); // starts now
		const steps = math.ceil(DECOR_REACT.coldFadeSeconds / SIM_DT);
		for (let i = 0; i < steps / 2; i++)
			v = director.update({ state, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		expect(v.cold > 0.3 && v.cold < 0.7).toBe(true);
		for (let i = 0; i < steps; i++)
			v = director.update({ state, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		expect(v.cold).toBe(1);
	});

	it("fades to cold only when every player of a party is down, reading the shared state", () => {
		const { setup, state, sceneOf } = setupAt(2);
		const scene = sceneOf(state);
		const director = new DecorDirector();
		const steps = math.ceil(DECOR_REACT.coldFadeSeconds / SIM_DT) + 1;
		stepParty(state, [EMPTY_INPUT, EMPTY_INPUT], setup.config); // both stand in the entrance: it is entered
		killPlayerState(playerAt(state, 0));
		let v = director.update({ state, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		for (let i = 0; i < steps; i++)
			v = director.update({ state, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		expect(v.cold).toBe(0);
		// the entrance (where both stand) is entered and lit for every client alike
		const entrance = state.endless!.roomsEntered.indexOf(1);
		expect(entrance >= 0).toBe(true);
		expect(v.roomEntered[entrance]).toBe(true);
		killPlayerState(playerAt(state, 1));
		for (let i = 0; i < steps + 2; i++)
			v = director.update({ state, config: setup.config, events: noEvents, scene, dt: SIM_DT });
		expect(v.cold).toBe(1);
	});

	it("puts the boss ring on the boss room's floor, Forge order, deterministic", () => {
		const setup = buildEndlessRunConfig(SEED);
		for (const floor of [5, 10]) {
			const layout = setup.endlessFloor(floor).layout;
			const d = layout.dungeon;
			const ring = decorBossRing(d);
			expect(ring.size() > 0).toBe(true);
			for (const s of ring) {
				const c = s.z * d.W + s.x;
				expect(d.roomId[c]).toBe(d.boss);
			}
			expect(decorBossRing(d)).toEqual(ring);
		}
	});
});
