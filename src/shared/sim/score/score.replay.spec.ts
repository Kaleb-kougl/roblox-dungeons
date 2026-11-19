// M2 scoring on a real run: run-full-1337's recording (the M1 game on the seed-1337 floor: 21 kills, the boss fight,
// the player's death) replayed with scoring on. The score is deterministic (same score and hash twice), scoring
// changes no gameplay (every subsystem but the enemy bullets' payload flags matches the golden fixture on every
// tick), and the unscored run still matches its golden hashes in the same module world.
import { afterAll, describe, expect, it } from "@rbxts/jest-globals";
import runFull from "shared/fixtures-generated/run-full-1337";
import { buildRunConfig, PlayerMover, SwordSpacing, setPlayerMover, setSwordSpacing } from "shared/run";
import {
	ScoreSource,
	checkRunFixture,
	createSimState,
	deserializeRecording,
	hashState,
	runReplay,
	step,
	subsystemHashes,
	type RunFixture,
	type SimConfig,
	type SimState,
	WEB_SWORD_TIMINGS,
	WEB_BOSS_HP,
	WEB_SWARMER_HP,
	setSwordTimings,
	setBossHp,
	setSwarmerHp,
	type SwordTimings,
} from "shared/sim";

// The golden runs (and the source's measured tables) were recorded with the web build's sword; the port's is 20%
// slower (CLAUDE.md decision log), so this file replays under WEB_SWORD_TIMINGS. Set at load, not in a beforeAll:
// describe bodies may replay while the specs are collected.
const portSword: SwordTimings = setSwordTimings(WEB_SWORD_TIMINGS);
const portSwarmerHp = setSwarmerHp(WEB_SWARMER_HP); // the web swarmer's 2 hp (port: 1)
const portMover = setPlayerMover(PlayerMover.WEB); // the web build's mover (port: the slide, docs/WALL_SLIDE.md)
const portSpacing = setSwordSpacing(SwordSpacing.WEB); // the web sword: no spacing brake (docs/SWORD_SPACING.md)
const portBossHp = setBossHp(WEB_BOSS_HP); // the web boss's 540 hp (port: 270)
afterAll(() => {
	setSwordTimings(portSword);
	setSwarmerHp(portSwarmerHp);
	setPlayerMover(portMover);
	setSwordSpacing(portSpacing);
	setBossHp(portBossHp);
});

const run = runFull as unknown as RunFixture;
const UNCHANGED = ["core", "combatHeader", "actors", "weapons", "playerBullets"] as const;

describe("scored replay of run-full-1337", () => {
	const plain = buildRunConfig(run.seed).config;
	const scoredConfig: SimConfig = buildRunConfig(run.seed, { scoring: {} }).config;
	const recording = deserializeRecording(run.recording);

	it("the default M1 config stays unscored", () => {
		expect(plain.scoring).toBe(undefined);
		expect(createSimState(run.seed, run.spawn.x, run.spawn.z, plain).score).toBe(undefined);
	});

	let first: SimState | undefined;
	const mismatches: string[] = [];
	it("matches the golden fixture on every non-bullet subsystem, every tick (scoring changes no gameplay)", () => {
		const s = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, scoredConfig);
		const n = math.min(run.ticks, recording.frames.size());
		for (let t = 0; t <= n; t++) {
			if (t > 0) step(s, recording.frames[t - 1], scoredConfig);
			const subs = subsystemHashes(s);
			for (const name of UNCHANGED) {
				const want = run.subsystems[name][t / run.subsystemsEvery];
				if (want !== undefined && subs[name] !== want && mismatches.size() < 5) {
					mismatches.push(`tick ${t}: ${name} ${subs[name]}, expected ${want}`);
				}
			}
			expect(subs.score).never.toBe(undefined);
		}
		first = s;
		expect(mismatches).toEqual([]);
	});

	it("scores the run: every kill, the rooms it cleared, grazes", () => {
		const st = first!.score!;
		expect(st.counts[ScoreSource.KILLS]).toBe(21);
		expect(st.points[ScoreSource.KILLS]).toBeGreaterThan(0);
		expect(st.counts[ScoreSource.BOSS]).toBe(0); // the bot dies to the boss
		let sum = 0;
		for (const p of st.points) sum += p;
		expect(sum).toBe(st.total);
		expect(st.total % 1).toBe(0);
		expect(st.hitsTaken).toBeGreaterThan(0);
		print(
			`[score] run-full-1337 scored: total ${st.total}, points ${st.points.join("/")}, counts ${st.counts.join(
				"/",
			)}, maxCombo ${st.maxCombo}`,
		);
	});

	it("is deterministic: the same score and hash on a second replay", () => {
		const again = runReplay(recording, scoredConfig);
		expect(again.score!.total).toBe(first!.score!.total);
		expect(again.score!.points).toEqual(first!.score!.points);
		expect(hashState(again)).toBe(hashState(first!));
		expect(hashState(again)).never.toBe(run.finalHash);
	});

	it("the unscored replay still matches every golden hash (after scored runs in this module world)", () => {
		const report = checkRunFixture(run, plain);
		expect(report.hashMismatch).toBe(undefined);
		expect(report.subsystemMismatches).toEqual([]);
		expect(report.eventMismatches).toEqual([]);
		expect(report.ticksMatched).toBe(run.ticks + 1);
	});
});
