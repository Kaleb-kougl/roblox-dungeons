// Phase B integration (M2 progression x M4 co-op): a scripted 2-player endless run on seed 1337 where the players
// draft different boons after every floor (own offers, own input, the world frozen until both confirmed), player 0
// takes a relic from a TREASURE pedestal and player 1 accepts a curse at the SHRINE. It replays deterministically
// (twice), through the party codec, and through SegmentedValidator (segments cut as the server's log would) to the
// live hash and score; the hash has the run group (two players) before the party group.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AFFIXES_SUBSYSTEM,
	BUILDS_SUBSYSTEM,
	BREAKABLES_SUBSYSTEM,
	DROPS_SUBSYSTEM,
	ENDLESS_HASH_SUBSYSTEM,
	HASH_SUBSYSTEMS,
	PARTY_SUBSYSTEM,
	RUN_SUBSYSTEM,
	SCORE_SUBSYSTEM,
	SHRINE_BUTTON,
	SHRINE_RADIUS,
	cardBoon,
	computeRunMods,
	createSimState,
	decodeRecording,
	encodeRecording,
	hashLayout,
	hashState,
	isPartyWiped,
	playerAt,
	runMods,
	runReplay,
	stepParty,
	type InputFrame,
	type Recording,
} from "shared/sim";
import {
	DEFAULT_SEGMENT_LIMITS,
	RunTelemetry,
	SegmentedValidator,
	buildEndlessRunConfig,
	checkpointCount,
	readRunScore,
	summarizeRun,
	type RunSegment,
	type SegmentLimits,
	type SegmentVerdict,
	type SegmentedRunResult,
} from "shared/run";
import { PartyDriver } from "shared/run/testing";

const SEED = 1337;
const N = 2;
const LATE = 1e9;
const LIMITS = { maxTicks: 1000000, maxRecordingBytes: 100000000 };
/** Ticks per segment (as the server's log would cut a party run) and between checkpoint hashes. */
const SEG = 360;
const SEG_LIMITS: SegmentLimits = { ...DEFAULT_SEGMENT_LIMITS, allowDebugInput: true, checkpointEvery: 120 };

/** The scripted run (see the file comment): floors 1-4 by the debug skip, a relic and a curse on the first floor with both rooms, floor 5 walked. */
function recordRun() {
	const setup = buildEndlessRunConfig(SEED, N);
	const drv = new PartyDriver(setup, SEED);
	const log: string[] = [];
	const note = (what: string) =>
		log.push(
			`${what}: tick ${drv.state.tick} floor ${drv.floor()} hearts ${playerAt(drv.state, 0).hearts},${
				playerAt(drv.state, 1).hearts
			}`,
		);
	const run = drv.state.run!;
	let relicFloor = 0;
	while (drv.floor() < 5 && !isPartyWiped(drv.state)) {
		const rooms = drv.world().config.encounter?.rooms ?? [];
		const t = rooms.find((x) => x.type === "treasure");
		const sh = rooms.find((x) => x.type === "shrine");
		if (relicFloor === 0 && t !== undefined && sh !== undefined) {
			relicFloor = drv.floor();
			const w = drv.world();
			const stair: [number, number] = [w.stairX, w.stairZ]; // open: walking into it would end the floor
			drv.walkOne(0, t.cx, t.cz, () => run.players[0].relics.size() > 0, 3000, stair);
			note("relic");
			const p1 = playerAt(drv.state, 1);
			const near = () => {
				const dx = p1.x - sh.cx;
				const dz = p1.z - sh.cz;
				return dx * dx + dz * dz < SHRINE_RADIUS * SHRINE_RADIUS * 0.25;
			};
			drv.walkOne(1, sh.cx, sh.cz, near, 3000, stair);
			if (near()) drv.press(1, SHRINE_BUTTON);
			note("curse");
		}
		drv.skipFloor();
	}
	const w5 = drv.world();
	drv.walkAll(w5.stairX, w5.stairZ, 900);
	note("floor 5 walked");
	return { setup, drv, log, relicFloor, recording: drv.recorder.getRecording(), finalHash: hashState(drv.state) };
}

const run = recordRun();
const live = run.drv.state;
const TICKS = run.recording.frames.size();

function merged(rec: Recording, t: number, out: InputFrame[]): InputFrame[] {
	out.clear();
	out.push(rec.frames[t]);
	for (const o of rec.others!) out.push(o[t]);
	return out;
}

/** The run's segments of SEG ticks with checkpoint hashes from a replay. */
function segments(rec: Recording): RunSegment[] {
	const config = buildEndlessRunConfig(SEED, N).config;
	const s = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, config);
	const out: RunSegment[] = [];
	const m: InputFrame[] = [];
	let start = 0;
	let cps: string[] = [];
	for (let t = 0; t < TICKS; t++) {
		stepParty(s, merged(rec, t, m), config);
		const stop = s.tick;
		if (stop % SEG_LIMITS.checkpointEvery === 0 && stop % SEG !== 0 && stop < TICKS) cps.push(hashState(s));
		if (stop % SEG === 0 || stop === TICKS) {
			const frames: InputFrame[] = [];
			const others: InputFrame[][] = rec.others!.map(() => []);
			for (let k = start; k < stop; k++) {
				frames.push(rec.frames[k]);
				for (let o = 0; o < others.size(); o++) others[o].push(rec.others![o][k]);
			}
			expect(cps.size()).toBe(checkpointCount(start, stop, SEG_LIMITS.checkpointEvery));
			out.push({
				runId: "coop-progression",
				index: out.size(),
				startTick: start,
				recording: encodeRecording({ seed: rec.seed, spawn: rec.spawn, frames, others }),
				claimedEndHash: hashState(s),
				checkpointHashes: cps,
			});
			start = stop;
			cps = [];
		}
	}
	return out;
}

function telemetryOf(rec: Recording) {
	const config = buildEndlessRunConfig(SEED, N).config;
	const s = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, config);
	const t = new RunTelemetry(6);
	const m: InputFrame[] = [];
	for (let k = 0; k < TICKS; k++) {
		stepParty(s, merged(rec, k, m), config);
		t.observe(s);
	}
	return t.finish();
}

function validate(segs: RunSegment[]): { verdicts: SegmentVerdict[]; result?: SegmentedRunResult } {
	const v = new SegmentedValidator({
		runId: "coop-progression",
		seed: SEED,
		worldKind: "endless",
		setup: buildEndlessRunConfig(SEED, N),
		createdAt: 0,
		limits: SEG_LIMITS,
	});
	const verdicts: SegmentVerdict[] = [];
	for (const seg of segs) {
		const offer = v.offer(seg, LATE);
		if (!offer.ok) {
			verdicts.push(offer.verdict);
			return { verdicts, result: v.getResult() };
		}
		for (let guard = 0; guard < 1000 && v.hasWork(); guard++) {
			const r = v.advance(500);
			for (const x of r.verdicts) verdicts.push(x);
			if (r.result !== undefined) return { verdicts, result: r.result };
		}
	}
	const score = readRunScore(live);
	const claimed = { ...summarizeRun(live, telemetryOf(run.recording)), score: score.score, floor: score.floor };
	let result = v.finish({ runId: "coop-progression", finalTick: TICKS, claimedHash: run.finalHash, claimed }, LATE);
	for (let guard = 0; guard < 1000 && result === undefined; guard++) result = v.advance(500).result;
	return { verdicts, result };
}

describe("a 2-player endless run with per-player progression", () => {
	it("drafts different boons each floor, player 0 takes a relic, player 1 a curse", () => {
		for (const line of run.log) print(`[coop-progression] ${line}`);
		const rp = live.run!.players;
		print(
			`[coop-progression] ${TICKS} ticks, floor ${live.endless!.floor}, score ${
				live.score!.total
			}, floors at ${run.drv.floorTicks.join(",")}; p0 boons ${rp[0].boons.join(",")} relics ${rp[0].relics.join(
				",",
			)} curses ${rp[0].curses.join(",")}; p1 boons ${rp[1].boons.join(",")} relics ${rp[1].relics.join(
				",",
			)} curses ${rp[1].curses.join(",")}`,
		);
		expect(run.relicFloor > 0).toBe(true);
		expect(live.endless!.floor).toBe(5);
		expect(rp.size()).toBe(N);
		// One draft per floor change for each player, a different boon each round.
		const rounds = run.drv.floorTicks.size();
		expect(rounds >= 4).toBe(true);
		expect([run.drv.drafted[0].size(), run.drv.drafted[1].size()]).toEqual([rounds, rounds]);
		for (let k = 0; k < rounds; k++) expect(run.drv.drafted[0][k]).never.toBe(run.drv.drafted[1][k]);
		// Builds (docs/BUILDS.md BU2): a card may level an owned boon, so the owned boons are the distinct ones in the
		// order first taken.
		for (let i = 0; i < N; i++) {
			const distinct: number[] = [];
			for (const card of run.drv.drafted[i]) {
				const b = cardBoon(card);
				if (b >= 0 && !distinct.includes(b)) distinct.push(b);
			}
			expect(rp[i].boons).toEqual(distinct);
		}
		// The relic is player 0's, the curse player 1's; the score multiplier counts the one curse.
		expect([rp[0].relics.size(), rp[1].relics.size()]).toEqual([1, 0]);
		expect([rp[0].curses.size(), rp[1].curses.size()]).toEqual([0, 1]);
		expect(live.score!.curses).toBe(1);
		// Each player's modifiers are their own lists' at their builds levels (and differ).
		for (let i = 0; i < N; i++) expect(runMods(live, i)).toEqual(computeRunMods(rp[i], live.builds!.players[i]));
	});

	it("hashes run (two players) after score, then party, breakables, drops, affixes, then builds last", () => {
		const layout = hashLayout(live, true);
		const names = layout.groups.map((g) => g.name);
		expect(names).toEqual([
			...HASH_SUBSYSTEMS,
			ENDLESS_HASH_SUBSYSTEM,
			SCORE_SUBSYSTEM,
			RUN_SUBSYSTEM,
			PARTY_SUBSYSTEM,
			BREAKABLES_SUBSYSTEM,
			DROPS_SUBSYSTEM,
			AFFIXES_SUBSYSTEM,
			BUILDS_SUBSYSTEM,
		]);
		const runGroup = layout.groups[names.indexOf(RUN_SUBSYSTEM)];
		expect([layout.names[runGroup.start], layout.values[runGroup.start]]).toEqual(["run.players.length", N]);
		// One boost entry per party member (docs/BOOSTS.md: co-op drops are per picker).
		const dropsGroup = layout.groups[names.indexOf(DROPS_SUBSYSTEM)];
		const at = layout.names.indexOf("drops.players.length", dropsGroup.start);
		expect([layout.names[at], layout.values[at]]).toEqual(["drops.players.length", N]);
	});

	it("replays twice to the live hash and score", () => {
		const a = runReplay(run.recording, buildEndlessRunConfig(SEED, N).config);
		const b = runReplay(run.recording, buildEndlessRunConfig(SEED, N).config);
		expect([hashState(a), hashState(b)]).toEqual([run.finalHash, run.finalHash]);
		expect([a.score!.total, b.score!.total]).toEqual([live.score!.total, live.score!.total]);
		expect(a.run!.players.map((p) => p.boons)).toEqual(live.run!.players.map((p) => p.boons));
	});

	it("through the party codec", () => {
		const decoded = decodeRecording(encodeRecording(run.recording), LIMITS);
		expect(decoded.ok).toBe(true);
		if (!decoded.ok) return;
		expect(hashState(runReplay(decoded.recording, buildEndlessRunConfig(SEED, N).config))).toBe(run.finalHash);
	});

	it("through SegmentedValidator: every segment verifies, the final hash and score are the live run's", () => {
		const segs = segments(run.recording);
		print(`[coop-progression] ${TICKS} ticks in ${segs.size()} segments`);
		expect(segs.size() >= 3).toBe(true);
		const { verdicts, result } = validate(segs);
		for (const x of verdicts) expect([x.index, x.ok, x.reason]).toEqual([x.index, true, undefined]);
		expect(result?.reason).toBe(undefined);
		expect(result?.ok).toBe(true);
		expect(result?.serverHash).toBe(run.finalHash);
		expect(result?.score.score).toBe(live.score!.total);
	});
});
