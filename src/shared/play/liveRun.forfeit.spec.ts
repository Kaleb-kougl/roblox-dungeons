// L6a "Leave run counts as a death", the client half that stays pure: LiveRun.requestForfeit() makes the next frame()
// step one tick with FORFEIT_BUTTON (paused or not), so the run ends as a death in the recording itself; the server's
// validators (whole-run validateRun and the ranked SegmentedValidator) replay it and report died = true, and the
// endless board's death-only rule then posts it.
import { afterAll, describe, expect, it } from "@rbxts/jest-globals";
import runFull from "shared/fixtures-generated/run-full-1337";
import {
	DEFAULT_RUN_LIMITS,
	DEFAULT_SEGMENT_LIMITS,
	FORFEIT_DEATH_CAUSE,
	SegmentedValidator,
	buildRunConfig,
	buildWorldSetup,
	validateRun,
	type SegmentedRunResult,
	PlayerMover,
	setPlayerMover,
} from "shared/run";
import {
	Button,
	DEFAULT_SIM_CONFIG,
	EMPTY_INPUT,
	FORFEIT_BUTTON,
	SIM_DT,
	copyInput,
	deserializeRecording,
	hashState,
	quantizeInput,
	type InputFrame,
	type RunFixture,
	WEB_SWORD_TIMINGS,
	WEB_BOSS_HP,
	WEB_SWARMER_HP,
	setSwordTimings,
	setBossHp,
	setSwarmerHp,
	type SwordTimings,
} from "shared/sim";
import { leaderboardEligibility } from "shared/leaderboard";
import { LiveRun, RANKED_WORLD_KIND } from "shared/play";

// The golden runs (and the source's measured tables) were recorded with the web build's sword; the port's is 20%
// slower (CLAUDE.md decision log), so this file replays under WEB_SWORD_TIMINGS. Set at load, not in a beforeAll:
// describe bodies may replay while the specs are collected.
const portSword: SwordTimings = setSwordTimings(WEB_SWORD_TIMINGS);
const portSwarmerHp = setSwarmerHp(WEB_SWARMER_HP); // the web swarmer's 2 hp (port: 1)
const portMover = setPlayerMover(PlayerMover.WEB); // the web build's mover (port: the slide, docs/WALL_SLIDE.md)
const portBossHp = setBossHp(WEB_BOSS_HP); // the web boss's 540 hp (port: 270)
afterAll(() => {
	setSwordTimings(portSword);
	setSwarmerHp(portSwarmerHp);
	setPlayerMover(portMover);
	setBossHp(portBossHp);
});

const LATE = 1e9;

function greyboxRun(): LiveRun {
	return new LiveRun({ seed: 9, spawnX: 0, spawnZ: 0, config: DEFAULT_SIM_CONFIG, atBossDoor: false });
}

/** Walks in a slow circle, one tick per frame. */
function walk(run: LiveRun, frames: number): void {
	const input: InputFrame = { ...EMPTY_INPUT };
	for (let n = 0; n < frames; n++) {
		quantizeInput(math.cos(n * 0.01), math.sin(n * 0.01), 0, 0, 0, input);
		run.frame(SIM_DT, input);
	}
}

describe("LiveRun.requestForfeit", () => {
	it("the next frame steps exactly one tick with the bit, even paused; the run is over as a death", () => {
		const run = greyboxRun();
		walk(run, 90);
		run.setPaused(true);
		expect(run.frame(SIM_DT, EMPTY_INPUT)).toBe(0);
		expect(run.requestForfeit()).toBe(true);
		expect(run.isForfeitPending()).toBe(true);
		expect(run.requestForfeit()).toBe(true); // again before the frame: still one forfeit tick
		const input = quantizeInput(1, 0, 0, 1, Button.FIRE);
		const before = copyInput(input);
		expect(run.frame(SIM_DT * 4, input)).toBe(1);
		expect(input).toEqual(before); // the caller's frame is never written
		expect(run.isForfeitPending()).toBe(false);
		expect([run.state.tick, run.ticks(), run.state.player.dead]).toEqual([91, 91, 1]);
		expect(run.frameEvents.playerDied).toBe(1);
		expect(run.outcome()).toBe("dead");
		expect(run.endTick()).toBe(91);
		expect(run.summary().died).toBe(true);
		const last = run.recorder.frames[90];
		expect(last).toEqual({ ...input, buttons: bit32.bor(Button.FIRE, FORFEIT_BUTTON) });
		expect(run.recorder.frames[89].buttons).toBe(0); // only the forfeit tick carries it
		expect(run.replayCheck().match).toBe(true);
		// Over: refused, and nothing changes.
		expect(run.requestForfeit()).toBe(false);
		expect(run.isForfeitPending()).toBe(false);
		expect(run.isPaused()).toBe(true);
	});

	it("unpaused: the forfeit tick replaces the frame's loop ticks; later frames run as before", () => {
		const run = greyboxRun();
		walk(run, 10);
		run.requestForfeit();
		expect(run.frame(SIM_DT * 3 + 1e-6, EMPTY_INPUT)).toBe(1);
		expect(run.state.tick).toBe(11);
		const ran = run.frame(SIM_DT * 2 + 1e-6, EMPTY_INPUT);
		expect(ran).toBeGreaterThanOrEqual(2);
		expect(run.state.tick).toBe(11 + ran);
		expect(run.recorder.frames.filter((f) => bit32.band(f.buttons, FORFEIT_BUTTON) !== 0).size()).toBe(1);
		expect(run.replayCheck().match).toBe(true);
	});
});

describe("a forfeited run on the server", () => {
	it("validateRun (the M1 game, run-full-1337's inputs up to a forfeit): accepted, died = true, a death", () => {
		const fixture = runFull as unknown as RunFixture;
		const recording = deserializeRecording(fixture.recording);
		const setup = buildRunConfig(fixture.seed);
		const run = new LiveRun({
			seed: fixture.seed,
			spawnX: recording.spawn.x,
			spawnZ: recording.spawn.z,
			config: setup.config,
			atBossDoor: false,
		});
		const k = runFull.firstTick.playerDied - 300; // alive, with kills behind it (it dies to the boss 300 ticks on)
		for (let t = 0; t < k; t++) run.frame(SIM_DT, recording.frames[t]);
		expect(run.state.player.dead).toBe(0);
		expect(run.kills).toBeGreaterThan(0);
		run.requestForfeit();
		run.frame(SIM_DT, recording.frames[k]);
		const v = validateRun(run.submission(), DEFAULT_RUN_LIMITS);
		expect(v.reason).toBe(undefined);
		expect(v.ok).toBe(true);
		expect(v.serverHash).toBe(hashState(run.state));
		expect(v.summary).toEqual({ ticks: k + 1, kills: run.kills, bossDefeated: false, died: true });
		expect(v.telemetry!.endReason).toBe("death");
		expect(v.telemetry!.deathTick).toBe(k + 1);
		expect(v.telemetry!.deathCause).toBe(FORFEIT_DEATH_CAUSE);
		expect(v.telemetry!.hitsTaken).toBe(run.hitsTaken); // the forfeit is not a hit
	});

	it("SegmentedValidator (the ranked endless world, no debug bits allowed): accepted, died = true, board-eligible", () => {
		const setup = buildWorldSetup(RANKED_WORLD_KIND, 1337, { atBossDoor: false });
		const run = new LiveRun({
			seed: 1337,
			spawnX: setup.spawn!.x,
			spawnZ: setup.spawn!.z,
			config: setup.config,
			atBossDoor: false,
			runId: "forfeit-run",
			segmentFallbackTicks: 250,
		});
		walk(run, 600);
		expect(run.state.player.dead).toBe(0);
		expect(run.requestForfeit()).toBe(true);
		run.frame(SIM_DT, EMPTY_INPUT);
		expect(run.outcome()).toBe("dead");
		const final = run.final()!;
		expect(final.claimed.died).toBe(true);
		expect(final.finalTick).toBe(601);

		const v = new SegmentedValidator({
			runId: "forfeit-run",
			seed: 1337,
			worldKind: RANKED_WORLD_KIND,
			setup: buildWorldSetup(RANKED_WORLD_KIND, 1337, { atBossDoor: false }),
			createdAt: 0,
			limits: DEFAULT_SEGMENT_LIMITS,
		});
		expect(DEFAULT_SEGMENT_LIMITS.allowDebugInput).toBe(false);
		for (const seg of run.takeSegments()) {
			const offer = v.offer(seg, LATE);
			expect(offer.ok ? "ok" : offer.verdict.reason).toBe("ok");
		}
		let result: SegmentedRunResult | undefined = v.finish(final, LATE);
		while (v.hasWork()) result = v.advance(500).result ?? result;
		result = result ?? v.getResult();
		expect(result?.reason).toBe(undefined);
		expect(result?.ok).toBe(true);
		expect(result?.serverHash).toBe(final.claimedHash);
		expect(result?.summary.died).toBe(true);
		expect(result?.summary).toEqual(run.summary());
		expect(result?.score.score).toBe(final.claimed.score);
		expect(
			leaderboardEligibility({
				worldKind: RANKED_WORLD_KIND,
				partySize: 1,
				debug: false,
				studio: false,
				privateServer: false,
				died: result!.summary.died,
				bossDefeated: result!.summary.bossDefeated,
			}),
		).toBe(undefined);
		// The same run without the forfeit would not post on the endless board (abandoned).
		expect(
			leaderboardEligibility({
				worldKind: RANKED_WORLD_KIND,
				partySize: 1,
				debug: false,
				studio: false,
				privateServer: false,
				died: false,
				bossDefeated: false,
			}),
		).toBe("abandoned");
	});
});
