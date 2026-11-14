// The vertical slice end to end (M1 endless + M2 scoring and in-run progression + M3 segmented validation + M5 board
// eligibility): the recorded seed-1337 endless run (shared/run/testing recordEndlessRun: debug skips, a relic and a
// curse on floor 2 (the Pact of Greed: floor 2 has pact altars, docs/FORTUNE.md; and the Horde, which lapses), a boon
// draft after every floor, a boss kill at Depth 1, two stairwells walked) is scored, replays
// to the same hash and score, and, played through a ranked LiveRun that cuts a segment on every floor change,
// validates through the server's SegmentedValidator with the same final hash and score.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOSS_FINAL_PHASE,
	BOSS_NO_HIT_BONUS,
	BOSS_ACT1_ID,
	cardBoon,
	COMBO_DENOMINATOR,
	CURSE_BASE,
	CURSE_DENOMINATOR,
	CURSE_STEP,
	DRAFT_MIN_OPEN_TICKS,
	PERCENT,
	SOLO_PLAYER,
	FLOOR_CLEAR_POINTS,
	KILL_POINTS,
	SIM_DT,
	ScoreSource,
	createSimState,
	floorClearBase,
	floorRoomTally,
	decodeRecording,
	encodeRecording,
	hashState,
	runReplay,
	step,
	runMods,
	type Recording,
	type SimState,
	PactKind,
} from "shared/sim";
import { LiveRun, RANKED_WORLD_KIND } from "shared/play";
import { LEADERBOARD_ELIGIBLE_WORLDS } from "shared/leaderboard";
import {
	DEFAULT_SEGMENT_LIMITS,
	ENDLESS_SCORING,
	MAX_SEGMENT_BYTES,
	MAX_SEGMENT_TICKS,
	SEGMENT_CHECKPOINT_TICKS,
	SegmentedValidator,
	buildEndlessRunConfig,
	buildWorldSetup,
	isRunWorldKind,
	readRunScore,
	type RunSegment,
	type SegmentVerdict,
	type SegmentedRunResult,
} from "shared/run";
import { recordEndlessRun } from "shared/run/testing";

const { seed, drv, recording, finalHash, relicFloor } = recordEndlessRun(1337);
const N = recording.frames.size();
/** Far past every segment's sim time (the validator's clock check is not under test here). */
const LATE = 1e9;

/**
 * floor(base x combo / 10 x depth x curse / 4 x bonus / 100): an award with no floor scaling, `curses` curses taken
 * and `bonusPercent` (Bounty's kill bonus; 100 without it). Every product is an exact integer below 2^53.
 */
function awardAt(base: number, combo: number, depth: number, curses: number, bonusPercent: number = PERCENT): number {
	const curse = CURSE_BASE + curses * CURSE_STEP;
	return math.floor(
		(base * combo * depth * curse * bonusPercent) / (COMBO_DENOMINATOR * CURSE_DENOMINATOR * PERCENT),
	);
}

interface TickRow {
	readonly tick: number;
	readonly floorBefore: number;
	readonly depthBefore: number;
	readonly comboStart: number;
	readonly comboEnd: number;
	readonly floorsDelta: number;
	readonly bossDelta: number;
	readonly killsDelta: number;
	readonly grazeCount: number;
	readonly floorChanged: number;
	readonly depthChanged: number;
	readonly comboCut: number;
	readonly comboBroken: number;
	readonly bossDefeated: number;
	readonly playerHits: number;
	readonly hitsBefore: number;
	readonly bossFinalHitsBefore: number;
	readonly cursesBefore: number;
	readonly killPercentBefore: number;
	/** The floor's enemy rooms cleared / with enemies before the tick (what its floor clear pays by). */
	readonly roomsClearedBefore: number;
	readonly roomsBefore: number;
	/** A boss floor (the boss is one more room), and whether its boss was dead by the floor change. */
	readonly bossFloor: boolean;
	readonly bossCleared: boolean;
}

/** Replays the recording tick by tick on a fresh config, keeping the score deltas of every tick. */
function replayRows(rec: Recording): { state: SimState; rows: TickRow[] } {
	const setup = buildEndlessRunConfig(rec.seed);
	const state = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, setup.config);
	const rows: TickRow[] = [];
	const sc = state.score!;
	for (const f of rec.frames) {
		const e = state.endless!;
		const floorBefore = e.floor;
		const depthBefore = e.depth;
		const floorsBefore = sc.points[ScoreSource.FLOORS];
		const bossBefore = sc.points[ScoreSource.BOSS];
		const killsBefore = sc.counts[ScoreSource.KILLS];
		const grazesBefore = sc.counts[ScoreSource.GRAZES];
		const hitsBefore = sc.hitsTaken;
		const bossFinalHitsBefore = sc.bossFinalHits;
		const cursesBefore = sc.curses;
		const killPercentBefore = runMods(state, SOLO_PLAYER).killPointsPercent;
		const [roomsClearedBefore, roomsBefore] = floorRoomTally(sc);
		const bossFloor = setup.endlessFloor(floorBefore).bossFloor;
		const stairsBefore = e.stairsOpen;
		const tick = state.tick;
		step(state, f, setup.config);
		rows.push({
			tick,
			floorBefore,
			depthBefore,
			comboStart: sc.events.comboStart,
			comboEnd: sc.combo,
			floorsDelta: sc.points[ScoreSource.FLOORS] - floorsBefore,
			bossDelta: sc.points[ScoreSource.BOSS] - bossBefore,
			killsDelta: sc.counts[ScoreSource.KILLS] - killsBefore,
			grazeCount: sc.counts[ScoreSource.GRAZES] - grazesBefore,
			floorChanged: state.events.floorChanged,
			depthChanged: state.events.depthChanged,
			comboCut: sc.events.comboCut,
			comboBroken: sc.events.comboBroken,
			bossDefeated: state.events.bossDefeated,
			playerHits: state.events.playerHits,
			hitsBefore,
			bossFinalHitsBefore,
			cursesBefore,
			killPercentBefore,
			roomsClearedBefore,
			roomsBefore,
			bossFloor,
			bossCleared: bossFloor && (stairsBefore !== 0 || state.events.bossDefeated !== 0),
		});
	}
	return { state, rows };
}

describe("an endless run is scored", () => {
	const a = replayRows(recording);
	const b = replayRows(recording);

	it("is scored solo by its own config, on client and server alike", () => {
		expect(buildEndlessRunConfig(seed).config.scoring).toBe(ENDLESS_SCORING);
		expect(ENDLESS_SCORING.partySize).toBe(1);
		expect(buildWorldSetup("endless", seed, { atBossDoor: false }).config.scoring).toBe(ENDLESS_SCORING);
		expect(drv.state.score).never.toBe(undefined);
	});

	it("replays twice to the live hash and score", () => {
		expect(hashState(a.state)).toBe(finalHash);
		expect(hashState(b.state)).toBe(finalHash);
		expect(hashState(runReplay(recording, buildEndlessRunConfig(seed).config))).toBe(finalHash);
		expect(a.state.score!.total).toBe(drv.state.score!.total);
		expect(b.state.score!.total).toBe(drv.state.score!.total);
		expect(a.state.score!.points).toEqual(drv.state.score!.points);
		expect(readRunScore(a.state)).toEqual({ score: drv.state.score!.total, floor: 8 });
		print(
			`[slice] ${N} ticks, score ${a.state.score!.total}, points ${a.state.score!.points.join(",")}, ` +
				`max combo ${a.state.score!.maxCombo}`,
		);
		expect(a.state.score!.total).toBeGreaterThan(0);
	});

	it("takes a boon after every floor, a relic and a curse on floor 2", () => {
		const me = drv.state.run!.players[SOLO_PLAYER];
		print(
			`[slice] boons ${drv.drafted.join(",")} (owned ${me.boons.join(",")}), relics ${me.relics.join(",")}, ` +
				`curses ${me.curses.join(",")}`,
		);
		expect(relicFloor).toBe(2);
		// Builds (docs/BUILDS.md BU2): seven floor drafts, the one after the floor 5 boss dealt twice (BUD4); a card may
		// level an owned boon, so the owned boons are the distinct ones in the order first taken, at their pick counts.
		// Pacts (docs/FORTUNE.md PS5): floor 2's shrine has altars, so the curse is the Pact of Greed's, and its
		// Legendary deal is one more pick.
		expect(drv.state.pacts!.taken[PactKind.GREED]).toBe(1);
		expect(drv.drafted.size()).toBe(7 + 1 + 1);
		const distinct: number[] = [];
		for (const card of drv.drafted) {
			const b = cardBoon(card);
			if (b >= 0 && !distinct.includes(b)) distinct.push(b);
		}
		expect(me.boons).toEqual(distinct);
		const levels = drv.state.builds!.players[SOLO_PLAYER].levels;
		for (const b of distinct) expect([b, levels[b]]).toEqual([b, drv.drafted.filter((c) => c === b).size()]);
		expect(me.relics.size()).toBe(1);
		expect(me.curses.size()).toBe(1);
		expect(drv.state.score!.curses).toBe(1);
		expect(me.draftOpen).toBe(0);
	});

	it("awards 1000 x floor x (rooms cleared / enemy rooms) per floor, at the Depth and curses in force", () => {
		const changes = a.rows.filter((r) => r.floorChanged !== 0);
		expect(changes.map((r) => r.floorChanged)).toEqual([2, 3, 4, 5, 6, 7, 8]);
		print(
			`[slice] floor clears: ${changes
				.map(
					(r) =>
						`f${r.floorBefore} ${r.roomsClearedBefore}/${r.roomsBefore}${
							r.bossFloor ? ` boss ${r.bossCleared}` : ""
						} -> ${r.floorsDelta}`,
				)
				.join(", ")}`,
		);
		// Floor 1 was debug-skipped before any room was cleared: no floor bonus at all (was 1000 before the
		// rooms-cleared ratio). Floor 2 was walked (kills fed the combo) and its shrine taken, so the later clears carry
		// the combo and x1.25.
		expect([changes[0].roomsClearedBefore, changes[0].roomsBefore > 0]).toEqual([0, true]);
		expect(changes[0].floorsDelta).toBe(0);
		expect(changes.map((r) => r.cursesBefore)).toEqual([0, 1, 1, 1, 1, 1, 1]);
		for (const r of changes) {
			// Nothing in stepScore changed the combo on these ticks, so the award's combo is the end-of-tick one.
			expect([r.tick, r.comboCut, r.comboBroken]).toEqual([r.tick, 0, 0]);
			const base = floorClearBase(
				r.floorBefore,
				r.roomsClearedBefore + (r.bossCleared ? 1 : 0),
				r.roomsBefore + (r.bossFloor ? 1 : 0),
			);
			expect(base <= FLOOR_CLEAR_POINTS * r.floorBefore).toBe(true);
			expect([r.tick, r.floorsDelta]).toEqual([r.tick, awardAt(base, r.comboEnd, r.depthBefore, r.cursesBefore)]);
		}
		// The boss floor (5): the boss counts as a cleared room.
		const boss = changes.find((r) => r.bossFloor)!;
		expect([boss.floorBefore, boss.bossCleared]).toEqual([5, true]);
		const floor5 = changes.find((r) => r.floorBefore === 5)!;
		expect(floor5.depthBefore).toBe(2);
		expect(a.state.score!.counts[ScoreSource.FLOORS]).toBe(7);
	});

	it("scores the boss kill at Depth 1 (5000 x combo, + the no-hit bonus rule), before Depth becomes 2", () => {
		const kills = a.rows.filter((r) => r.bossDefeated !== 0);
		expect(kills.size()).toBe(1);
		const k = kills[0];
		expect([k.depthBefore, k.depthChanged]).toEqual([1, 2]);
		// No graze fed the combo on the kill tick, and the boss scores in killActor BEFORE its onDeath takes the summoned
		// swarmers with it (their kills come after), so it scored at the tick's starting combo.
		expect(k.grazeCount).toBe(0);
		expect(k.killsDelta).toBeGreaterThan(0);
		const c = k.comboStart;
		const base = KILL_POINTS.get(BOSS_ACT1_ID)!;
		expect(base).toBe(5000);
		expect(BOSS_FINAL_PHASE.get(BOSS_ACT1_ID)).toBe(3);
		// The bonus: no landed hit since the final phase began (this tick's hits included).
		const noHit = k.bossFinalHitsBefore >= 0 && k.hitsBefore + k.playerHits === k.bossFinalHitsBefore;
		// The boss's own points carry the curse and Bounty's kill bonus (if drafted); the no-hit bonus only the curse.
		const want =
			awardAt(base, c, 1, k.cursesBefore, k.killPercentBefore) +
			(noHit ? awardAt(BOSS_NO_HIT_BONUS, c, 1, k.cursesBefore) : 0);
		print(`[slice] boss kill at tick ${k.tick}: combo ${c}, no-hit ${noHit}, ${k.bossDelta} points`);
		expect(k.bossDelta).toBe(want);
		expect(a.state.score!.points[ScoreSource.BOSS]).toBe(want);
	});
});

// ---------------------------------------------------------------------------------------------
// Segmented validation

const TEST_LIMITS = { ...DEFAULT_SEGMENT_LIMITS, allowDebugInput: true };

// docs/ARCHER.md AR4: the recorded run (recordEndlessRun) was played without characters (both weapons), as every tool's
// buildEndlessRunConfig is; the world registry now builds a character's run (the Knight by default), so the live run
// and the validator get the recording's own config. The registry's character configs are checked in characterRuns.spec.
function validator(runId: string): SegmentedValidator {
	return new SegmentedValidator({
		runId,
		seed,
		worldKind: RANKED_WORLD_KIND,
		setup: buildEndlessRunConfig(seed),
		createdAt: 0,
		limits: TEST_LIMITS,
	});
}

/** Drains the validator's queue; returns the segment verdicts and the run's result (if decided). */
function drain(v: SegmentedValidator): { verdicts: SegmentVerdict[]; result?: SegmentedRunResult } {
	const verdicts: SegmentVerdict[] = [];
	let result: SegmentedRunResult | undefined = v.getResult();
	while (v.hasWork()) {
		const r = v.advance(500);
		for (const x of r.verdicts) verdicts.push(x);
		result = r.result ?? result;
	}
	return { verdicts, result: result ?? v.getResult() };
}

function segmentEnd(s: RunSegment): number {
	const r = decodeRecording(s.recording, { maxTicks: MAX_SEGMENT_TICKS, maxRecordingBytes: MAX_SEGMENT_BYTES });
	if (!r.ok) error(r.reason);
	return s.startTick + r.recording.frames.size();
}

describe("the endless run, segmented per floor, validates on the server", () => {
	const setup = buildEndlessRunConfig(seed); // the recording's config (see validator above)
	const run = new LiveRun({
		seed,
		spawnX: setup.spawn!.x,
		spawnZ: setup.spawn!.z,
		config: setup.config,
		atBossDoor: false,
		runId: "slice-run",
		// SimController.makeRun's hook: one segment per floor.
		segmentCutAfterTick: (s) => s.events.floorChanged !== 0,
	});
	const v = validator("slice-run");
	const sent: RunSegment[] = [];
	const verdicts: SegmentVerdict[] = [];
	let released = 0;
	/** Hands the cut segments to the server and, like SimController.onSegmentVerified, trims verified frames. */
	const pump = () => {
		for (const seg of run.takeSegments()) {
			sent.push(seg);
			expect(v.offer(seg, LATE).ok).toBe(true);
		}
		for (const x of drain(v).verdicts) {
			verdicts.push(x);
			if (x.ok) released += run.releaseVerifiedFrames(x.endTick);
		}
	};
	for (const f of recording.frames) {
		run.frame(SIM_DT, f);
		pump();
	}
	const final = run.final()!;
	pump();
	const finished = v.finish(final, LATE);
	const result = finished ?? drain(v).result;

	it("the ranked world is endless, registered and board-eligible", () => {
		expect(RANKED_WORLD_KIND).toBe("endless");
		expect(isRunWorldKind(RANKED_WORLD_KIND)).toBe(true);
		expect(LEADERBOARD_ELIGIBLE_WORLDS).toEqual(["endless"]);
	});

	it("the live run cuts a segment on each floor change and matches the recorded run", () => {
		expect(run.state.tick).toBe(N);
		expect(hashState(run.state)).toBe(finalHash);
		expect(run.ticks()).toBe(N); // released frames still count
		const ends = sent.map(segmentEnd);
		const floorTicks = drv.floorTicks;
		expect(ends.filter((_, i) => i < floorTicks.size())).toEqual([...floorTicks]);
		expect(ends[ends.size() - 1]).toBe(N);
		expect(sent.map((s) => s.index)).toEqual(sent.map((_, i) => i));
	});

	it("every segment is verified and its frames released; the server's score is the replayed one", () => {
		expect(verdicts.size()).toBe(sent.size());
		for (const x of verdicts) expect([x.index, x.ok, x.code]).toEqual([x.index, true, undefined]);
		expect(run.releasedFrameCount()).toBe(N);
		expect(released).toBe(N);
		expect(run.recorder.size()).toBe(0);
		expect(result?.reason).toBe(undefined);
		expect(result?.ok).toBe(true);
		expect(result?.serverHash).toBe(finalHash);
		expect(result?.verifiedTicks).toBe(N);
		expect(result?.score).toEqual({ score: drv.state.score!.total, floor: 8 });
		expect(final.claimed.score).toBe(drv.state.score!.total);
		expect(final.claimed.floor).toBe(8);
		// A released recording cannot be submitted whole or replay-checked any more.
		expect(() => run.submission()).toThrow();
	});

	it("edited frames in a later segment reject the run at that segment", () => {
		// The floor-6 walk (the segment ending at the floor-7 change).
		const k = sent.findIndex((s) => segmentEnd(s) === drv.floorTicks[5]);
		expect(k).toBeGreaterThan(3);
		const seg = sent[k];
		const decoded = decodeRecording(seg.recording, {
			maxTicks: MAX_SEGMENT_TICKS,
			maxRecordingBytes: MAX_SEGMENT_BYTES,
		});
		if (!decoded.ok) error(decoded.reason);
		const frames = [...decoded.recording.frames];
		// The segment opens with floor 5's boon draft (the stick centred, then a FIRE press): edit the walking frames
		// right after it, stick reversed for EDITED_FRAMES ticks. (D5: since floor 5 holds the Demon Lord the recorded run
		// differs from floor 5 on, and reversing only the first walking frame of floor 6 is absorbed: the player creeps
		// along at 2 u/s from the spawn and the segment still ends on the same hash.)
		const at = frames.findIndex((f, i) => i > DRAFT_MIN_OPEN_TICKS && (f.moveX !== 0 || f.moveZ !== 0));
		expect(at).toBeGreaterThan(DRAFT_MIN_OPEN_TICKS);
		const EDITED_FRAMES = 30;
		for (let i = at; i < at + EDITED_FRAMES && i < frames.size(); i++) {
			frames[i] = { ...frames[i], moveX: -frames[i].moveX, moveZ: -frames[i].moveZ };
		}
		expect(frames[at]).never.toEqual(decoded.recording.frames[at]);
		const edited: RunSegment = { ...seg, recording: encodeRecording({ ...decoded.recording, frames }) };

		const w = validator("slice-run"); // a fresh server session for the same run
		const got: SegmentVerdict[] = [];
		let res: SegmentedRunResult | undefined;
		for (let i = 0; i < sent.size() && res === undefined; i++) {
			const offer = w.offer(i === k ? edited : sent[i], LATE);
			expect([i, offer.ok ? "ok" : offer.verdict.reason]).toEqual([i, "ok"]);
			const d = drain(w);
			for (const x of d.verdicts) got.push(x);
			res = d.result;
		}
		expect(res?.ok).toBe(false);
		expect(res?.code).toBe("hash_mismatch");
		expect(res?.failedSegment).toBe(k);
		expect(got.filter((x) => x.ok).size()).toBe(k);
		const bad = got[got.size() - 1];
		expect([bad.index, bad.ok]).toEqual([k, false]);
		// Located to the checkpoint window of the first edited tick: the last checkpoint at or before it, or the segment
		// start. (Wall slide, docs/WALL_SLIDE.md WS4: the re-recorded run's floor-6 segment starts at tick 2953 and its
		// first walking frame comes after the tick-3000 checkpoint, so that checkpoint still matches; before, the
		// edit fell in the segment's first window and this pinned seg.startTick.) Re-recorded for docs/NEW_ENEMIES_2.md
		// NX6: the bot's floors 1-5 buy other kinds (four more room kinds, a reshuffled roster), so the floor-6 segment
		// starts at tick 2962 (was 2953); its first walking frame still follows the tick-3000 checkpoint.
		const lastGood = math.max(
			seg.startTick,
			math.floor((seg.startTick + at) / SEGMENT_CHECKPOINT_TICKS) * SEGMENT_CHECKPOINT_TICKS,
		);
		expect([seg.startTick, lastGood]).toEqual([2962, 3000]);
		expect(bad.matchedThroughTick).toBe(lastGood);
		// Further segments are refused.
		expect(w.offer(sent[k + 1], LATE).ok).toBe(false);
	});
});
