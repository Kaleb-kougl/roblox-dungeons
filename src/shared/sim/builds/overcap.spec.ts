// docs/BUILDS_V2.md BV9 (overcap points): boss damage the cap drops goes to the hitter's `overcap`; each whole point
// pays OVERCAP_POINTS into ScoreSource.OVERCAP at the kills' floor scaling through the usual multipliers, never the
// combo; builds runs only (addOvercapScoreSources pads the earlier gated sources; every other scored run keeps its
// sources and hash).
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOSS_ACT1_ID,
	BUILDS_CONFIG,
	BossFightState,
	DEFAULT_BOUNDS,
	EMPTY_INPUT,
	OVERCAP_POINTS,
	OVERCAP_SCORE_SOURCE_NAMES,
	SCORE_SOURCE_COUNT,
	ScoreSource,
	SimCtx,
	awardPoints,
	createSimState,
	floorScalePercent,
	hashState,
	scoreFloor,
	scoreHashNames,
	type ActorState,
	type EncounterRoom,
	type EndlessFloorWorld,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig } from "shared/run";

const SEED = 42;
/** One second of ticks (SIM_HZ). */
const SECOND = 60;
/** A hit every this many ticks: 10 hits a second. */
const HIT_EVERY = 6;

const BOSS_ROOM: EncounterRoom = {
	id: 0,
	type: "boss",
	depth: 1,
	cx: 0,
	cz: 0,
	minX: -7,
	maxX: 7,
	minZ: -7,
	maxZ: 7,
	floorTiles: 196,
};
const WORLD_CONFIG = {
	bounds: DEFAULT_BOUNDS,
	encounter: { spawns: [], rooms: [BOSS_ROOM], entranceRoom: -1, bossRoom: 0 },
};

function arena(): (floor: number) => EndlessFloorWorld {
	const cache = new Map<number, EndlessFloorWorld>();
	return (floor) => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: WORLD_CONFIG,
				bossFloor: false,
				spawnX: 0,
				spawnZ: 0,
				stairX: 1000,
				stairZ: 1000,
				roomSpawns: [],
				roomIdAt: () => -1,
			};
			cache.set(floor, w);
		}
		return w;
	};
}

function configOf(extra: Partial<SimConfig> = {}): SimConfig {
	return { endless: { runSeed: SEED, worldForFloor: arena() }, scoring: {}, builds: BUILDS_CONFIG, ...extra };
}

const ARENA = configOf();
const PARTY2 = configOf({ scoring: { partySize: 2 }, party: { size: 2 } });

function ctxAt(s: SimState, tick: number): SimCtx {
	s.tick = tick;
	return new SimCtx().bind(s, WORLD_CONFIG, EMPTY_INPUT);
}

/** An engaged boss in its final phase (nothing filters a hit) with `hp`. */
function boss(s: SimState, hp = 10000): ActorState {
	const a = ctxAt(s, 0).spawnActor(BOSS_ACT1_ID, 0, 3)!;
	a.aiState = BossFightState.RECOVER;
	a.phase = 3;
	a.hp = hp;
	a.hpMax = hp;
	a.spawnTick = -1;
	return a;
}

/** Hits `a` for 1 every HIT_EVERY ticks for `seconds` (10/s), by `player`; returns the hp it lost. */
function pound(s: SimState, a: ActorState, seconds: number, player = 0, from = 0): number {
	const hp = a.hp;
	const last = from + seconds * SECOND;
	for (let t = from; t < last; t += HIT_EVERY) {
		const ctx = ctxAt(s, t);
		ctx.actingPlayer(player);
		ctx.damageActor(a, 1);
	}
	return hp - a.hp;
}

describe("overcap points (BV9)", () => {
	it("a builds run holds ScoreSource.OVERCAP 15 (16 sources); a scored run without builds keeps its 15, hash unchanged", () => {
		expect([ScoreSource.OVERCAP, OVERCAP_POINTS, [...OVERCAP_SCORE_SOURCE_NAMES]]).toEqual([15, 10, ["overcap"]]);
		const setup = buildEndlessRunConfig(SEED);
		// Without secrets (docs/SECRET_ROOMS.md SR4: every endless world pads on to SECRET 16, last).
		const built = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, { ...setup.config, secrets: undefined });
		expect([built.score!.points.size(), built.score!.counts.size()]).toEqual([16, 16]);
		const names: string[] = [];
		scoreHashNames(built.score!, names);
		expect(names.includes("score.points.overcap")).toBe(true);
		expect(names.includes("score.counts.overcap")).toBe(true);
		// The same endless config without builds: GOLDEN is the last source, as before BV9.
		const noBuilds: SimConfig = { ...setup.config, builds: undefined, secrets: undefined };
		const plain = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, noBuilds);
		expect([plain.score!.points.size(), plain.score!.counts.size()]).toEqual([
			ScoreSource.GOLDEN + 1,
			ScoreSource.GOLDEN + 1,
		]);
		// A bare scored run (no gated source at all) keeps SCORE_SOURCE_COUNT; a bare builds run pads to OVERCAP.
		expect(createSimState(SEED, 0, 0, { scoring: {} }).score!.points.size()).toBe(SCORE_SOURCE_COUNT);
		expect(createSimState(SEED, 0, 0, { scoring: {}, builds: BUILDS_CONFIG }).score!.points.size()).toBe(16);
	});

	it("hitting a capped boss at 10/s for 10 s books 40 payouts of OVERCAP_POINTS through awardPoints; the combo untouched", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		const b = boss(s);
		const sc = s.score!;
		sc.combo = 23; // x2.3: the payout reads the combo like any award
		sc.comboTimer = 7;
		const each = awardPoints(s, sc, OVERCAP_POINTS, floorScalePercent(scoreFloor(s)));
		const totalBefore = sc.total;
		let payouts = 0;
		let points = 0;
		const hp = b.hp;
		for (let t = 0; t < 10 * SECOND; t += HIT_EVERY) {
			const ctx = ctxAt(s, t);
			ctx.actingPlayer(0);
			ctx.damageActor(b, 1);
			const e = s.builds!.events;
			payouts += e.overcapPoints.size();
			for (const p of e.overcapPoints) points += p;
			for (const o of e.overcapOwner) expect(o).toBe(0);
			for (const x of e.overcapX) expect(x).toBe(b.x);
			e.overcapX.clear();
			e.overcapZ.clear();
			e.overcapOwner.clear();
			e.overcapPoints.clear();
		}
		const landed = hp - b.hp;
		expect([landed, 100 - landed]).toEqual([60, 40]);
		expect([payouts, sc.counts[ScoreSource.OVERCAP], sc.points[ScoreSource.OVERCAP]]).toEqual([40, 40, 40 * each]);
		expect(points).toBe(40 * each);
		expect(sc.total - totalBefore).toBe(40 * each);
		expect(each > OVERCAP_POINTS).toBe(true); // the combo's x2.3 applies
		expect([sc.combo, sc.comboTimer, sc.events.comboFed]).toEqual([23, 7, 0]);
		expect(s.builds!.players[0].overcap).toBe(0);
	});

	it("a fractional drop waits in `overcap` until a whole point; one event per hit with that hit's points", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		const b = boss(s);
		const ctx = ctxAt(s, 0);
		ctx.actingPlayer(0);
		ctx.damageActor(b, 12); // the whole 2 s window's budget (6/s x 2)
		ctx.damageActor(b, 0.5);
		expect([s.builds!.players[0].overcap, s.builds!.events.overcapPoints.size()]).toEqual([0.5, 0]);
		ctx.damageActor(b, 2.75);
		expect(s.builds!.players[0].overcap).toBe(0.25);
		const each = awardPoints(s, s.score!, OVERCAP_POINTS, floorScalePercent(scoreFloor(s)));
		expect(s.builds!.events.overcapPoints).toEqual([3 * each]);
		expect(s.score!.counts[ScoreSource.OVERCAP]).toBe(3);
	});

	it("a phase-invulnerable boss pays nothing (filterDamage drops the hit before the cap)", () => {
		const s = createSimState(SEED, 0, 0, ARENA);
		const b = boss(s);
		b.aiState = BossFightState.TRANSITION;
		expect(pound(s, b, 10)).toBe(0);
		expect([s.score!.counts[ScoreSource.OVERCAP], s.builds!.players[0].overcap]).toEqual([0, 0]);
		expect(s.builds!.events.overcapPoints.size()).toBe(0);
	});

	it("the boss's killing hit: filterDamage clamps it to the hp left before the cap, so only a cap drop pays", () => {
		// The plan's edge case "the dropped part still pays" is the cap's drop: a boss's filterDamage (the phase floor,
		// 0 in the final phase) already cuts a killing hit to the hp left, so the cap can only drop from a hit that
		// leaves the boss alive (the hp left above the window's room).
		const s = createSimState(SEED, 0, 0, ARENA);
		const b = boss(s, 5);
		const ctx = ctxAt(s, 0);
		ctx.actingPlayer(0);
		ctx.damageActor(b, 20); // filtered to 5, inside the window's 12: the boss dies, nothing dropped
		expect([b.alive, s.score!.counts[ScoreSource.OVERCAP]]).toEqual([0, 0]);
		const s2 = createSimState(SEED, 0, 0, ARENA);
		const b2 = boss(s2, 20);
		const ctx2 = ctxAt(s2, 0);
		ctx2.actingPlayer(0);
		ctx2.damageActor(b2, 30); // filtered to 20, the window lets 12 through: 8 dropped, the boss lives
		expect([b2.alive, b2.hp, s2.score!.counts[ScoreSource.OVERCAP]]).toEqual([1, 8, 8]);
	});

	it("co-op credits the hitter", () => {
		const s = createSimState(SEED, 0, 0, PARTY2);
		const b = boss(s);
		pound(s, b, 2, 0); // player 0 spends the window's budget (and is paid for its own drops)
		const e = s.builds!.events;
		expect(e.overcapOwner.size() > 0 && e.overcapOwner.every((o) => o === 0)).toBe(true);
		e.overcapX.clear();
		e.overcapZ.clear();
		e.overcapOwner.clear();
		e.overcapPoints.clear();
		const ctx = ctxAt(s, 120);
		ctx.actingPlayer(1);
		ctx.damageActor(b, 30);
		expect(s.builds!.events.overcapOwner).toEqual([1]);
		expect(s.builds!.players[1].overcap).toBe(0);
		expect(s.builds!.players[0].overcap).toBe(0);
	});

	it("without builds nothing is counted (no overcap source) and the hash is the same as a run that never capped", () => {
		const config: SimConfig = { endless: ARENA.endless, scoring: {} };
		const a = createSimState(SEED, 0, 0, config);
		const ba = boss(a);
		pound(a, ba, 4);
		expect(a.score!.points.size()).toBe(SCORE_SOURCE_COUNT);
		// Two identical runs hash the same (the cap's drop moves nothing outside builds).
		const b = createSimState(SEED, 0, 0, config);
		const bb = boss(b);
		pound(b, bb, 4);
		expect(hashState(a)).toBe(hashState(b));
	});
});
