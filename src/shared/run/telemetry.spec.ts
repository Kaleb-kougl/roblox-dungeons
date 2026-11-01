// Run telemetry from sim events (port of the web build's PlaytestTelemetry.observeTick + DEFAULT_TAPS), fed the
// golden fixtures' event streams (every non-default SimEvents field of every tick, recorded by the web build), plus
// the AnalyticsService mapping and the session summary.
import { describe, expect, it } from "@rbxts/jest-globals";
import runBoss from "shared/fixtures-generated/run-boss-1337";
import runFull from "shared/fixtures-generated/run-full-1337";
import runPlayer from "shared/fixtures-generated/run-player";
import runPlayerDungeon from "shared/fixtures-generated/run-player-dungeon-1337";
import {
	KALEB_VALE_MVP_PARAMS,
	actorMover,
	bossDoorSpawn,
	bulletBlocker,
	circleMover,
	generateDungeon,
	placeEncounter,
} from "shared/dungeon";
import { DEFAULT_RUN_LIMITS, RunTelemetry, validateRun, type RunTelemetryRecord } from "shared/run";
import {
	ANALYTICS_EVENT,
	BOSS_PROGRESSION_LEVELS,
	BOSS_PROGRESSION_PATH,
	LOCALE_OTHER,
	RUN_FUNNEL,
	analyticsForRejection,
	analyticsForRun,
	analyticsForSession,
	bossProgressionLevel,
	engagedBossId,
	hitSourceName,
	languageBucket,
	localeAnalytics,
	localeAnalyticsValues,
	localeBucket,
	summarizeRunSession,
} from "shared/run";
import {
	BOSS_ACT1_ID,
	BOSS_DEMONLORD_ID,
	EMPTY_INPUT,
	PLAYER_RADIUS,
	START_HALF_HEARTS,
	archetypeIndex,
	createSimState,
	deserializeRecording,
	encodeRecording,
	step,
	type SimConfig,
	type SimEvents,
} from "shared/sim";

type EventEntry = readonly [number, Partial<SimEvents>];

interface StreamFixture {
	readonly ticks: number;
	readonly recording: string;
	readonly finalHash: string;
	readonly seed: number;
	readonly archetypeIds: ReadonlyArray<string>;
	readonly events: unknown;
	readonly totals: Readonly<Record<string, number>>;
	readonly firstTick: Readonly<Record<string, number>>;
	readonly hitsBySource: Readonly<Record<string, number>>;
}

/** Feeds a fixture's event stream through RunTelemetry: tick t's events are seen with SimState.tick = t + 1. */
function fromStream(f: StreamFixture): RunTelemetryRecord {
	const t = new RunTelemetry(START_HALF_HEARTS, f.archetypeIds);
	const alive = { hearts: START_HALF_HEARTS, dead: 0 };
	for (const [tick, events] of f.events as ReadonlyArray<EventEntry>)
		t.observe({ tick: tick + 1, events, player: alive });
	t.observe({ tick: f.ticks, events: {}, player: alive });
	return t.finish();
}

function asMap(r: Readonly<Record<string, number>>): Map<string, number> {
	const m = new Map<string, number>();
	// eslint-disable-next-line roblox-ts/no-array-pairs
	for (const [k, v] of pairs(r)) m.set(k as string, v as number);
	return m;
}

function checkTotals(rec: RunTelemetryRecord, f: StreamFixture): void {
	const t = f.totals;
	expect(rec.ticks).toBe(f.ticks);
	expect([rec.hitsTaken, rec.flasksUsed, rec.embersUsed, rec.rollsStarted]).toEqual([
		t.playerHits,
		t.flaskUsed,
		t.emberUsed,
		t.rollStarted,
	]);
	expect([rec.shotsFired, rec.kills, rec.enemyHits, rec.bulletsCleared, rec.weaponSwaps]).toEqual([
		t.shotsFired,
		t.enemiesKilled,
		t.enemyHits,
		t.bulletsCleared,
		t.weaponSwapped,
	]);
	// Unmapped fields land in event.<field> counters, exactly the run's totals.
	for (const field of [
		"actorsKilled",
		"telegraphs",
		"meleeSwings",
		"bulletsDeleted",
		"damageDealt",
		"actorsSpawned",
	]) {
		expect(rec.counters.get(`event.${field}`) ?? 0).toBe(t[field]);
	}
	expect(rec.hitsBySource).toEqual(asMap(f.hitsBySource));
	const died = f.firstTick.playerDied;
	expect(rec.deathTick).toBe(died !== undefined ? died + 1 : undefined);
	const engaged = f.firstTick.bossEngaged;
	expect(rec.bossEngagedTick).toBe(engaged !== undefined ? engaged + 1 : undefined);
	expect(rec.bossAttempts).toBe(t.bossEngaged);
	const firstKill = f.firstTick.actorsKilled;
	expect(rec.firstKillTick).toBe(firstKill !== undefined ? firstKill + 1 : undefined);
}

describe("RunTelemetry on the fixture event streams", () => {
	it("run-player.json: debug hits until death (cause unknown), no boss", () => {
		const rec = fromStream(runPlayer as unknown as StreamFixture);
		checkTotals(rec, runPlayer as unknown as StreamFixture);
		expect(rec.endReason).toBe("death");
		expect(rec.deathTick).toBe(976);
		expect(rec.aliveTicks).toBe(976);
		expect(rec.deathCause).toBe("unknown");
		expect(rec.counters.get("hitBy.unknown")).toBe(9);
		expect(rec.bossPhaseReached).toBe(0);
		expect(rec.markers).toEqual([{ tick: 976, name: "player.death" }]);
	});

	it("run-player-dungeon-1337.json: alive at the end -> abandoned", () => {
		const rec = fromStream(runPlayerDungeon as unknown as StreamFixture);
		checkTotals(rec, runPlayerDungeon as unknown as StreamFixture);
		expect(rec.endReason).toBe("abandoned");
		expect(rec.aliveTicks).toBe(600);
		expect(rec.deathCause).toBe(undefined);
	});

	it("run-full-1337.json: 21 kills, boss engaged, killed by the boss (death cause boss.act1)", () => {
		const f = runFull as unknown as StreamFixture;
		const rec = fromStream(f);
		checkTotals(rec, f);
		expect(rec.kills).toBe(21);
		expect(rec.endReason).toBe("death");
		expect(rec.deathTick).toBe(1785);
		expect(rec.deathCause).toBe("boss.act1");
		expect(rec.counters.get("hitBy.boss.act1")).toBe(6);
		expect(rec.counters.get("hitBy.swarmer")).toBe(3);
		expect(rec.bossPhaseReached).toBe(1);
		expect(rec.bossDefeated).toBe(false);
		const names = rec.markers.map((m) => m.name);
		expect(names).toEqual(["boss.phase", "boss.engaged", "player.death"]);
	});

	it("run-boss-1337.json: all three boss phases (markers at the web build's ticks), survived", () => {
		const f = runBoss as unknown as StreamFixture;
		const rec = fromStream(f);
		checkTotals(rec, f);
		expect(rec.endReason).toBe("abandoned");
		expect(rec.bossPhaseReached).toBe(3);
		const phases = rec.markers.filter((m) => m.name === "boss.phase");
		expect(phases.map((m) => [m.tick, m.value])).toEqual([
			[f.firstTick.bossPhase1 + 1, 1],
			[f.firstTick.bossPhase2 + 1, 2],
			[f.firstTick.bossPhase3 + 1, 3],
		]);
	});

	it("the server's own replay gives the same record as the web build's event stream (run-player.json)", () => {
		const v = validateRun(
			{
				seed: runPlayer.seed,
				atBossDoor: false,
				recording: encodeRecording(deserializeRecording(runPlayer.recording)),
				claimedHash: runPlayer.finalHash,
				claimed: { ticks: 996, kills: 0, bossDefeated: false, died: true },
			},
			{ ...DEFAULT_RUN_LIMITS, world: "greybox", allowDebugInput: true },
			{ archetypeNames: runPlayer.archetypeIds },
		);
		expect(v.ok).toBe(true);
		const replayed = v.telemetry!;
		const stream = fromStream(runPlayer as unknown as StreamFixture);
		checkTotals(replayed, runPlayer as unknown as StreamFixture);
		expect(replayed.markers).toEqual(stream.markers);
		expect(replayed.deathCause).toBe(stream.deathCause);
		// Only the replay sees hearts: 9 hits, 2 flasks drunk, dead at the end.
		expect(replayed.heartsLostTotal).toBeGreaterThanOrEqual(START_HALF_HEARTS);
		expect(stream.heartsLostTotal).toBe(0);
	});

	it("hitSourceName: archetype id, unknown for -1, the index as text when unregistered", () => {
		const names = runFull.archetypeIds;
		expect(hitSourceName(0, names)).toBe("boss.act1");
		expect(hitSourceName(3, names)).toBe("swarmer");
		expect(hitSourceName(-1, names)).toBe("unknown");
		expect(hitSourceName(42, names)).toBe("42");
	});
});

describe("AnalyticsService mapping", () => {
	it("run-full-1337: funnel to BossEngaged, boss progression Start + Fail, death at the boss", () => {
		const rec = fromStream(runFull as unknown as StreamFixture);
		const events = analyticsForRun(rec);
		const funnel = events.filter((e) => e.kind === "funnel");
		expect(funnel.map((e) => (e.kind === "funnel" ? [e.funnel, e.step, e.stepName] : []))).toEqual([
			[RUN_FUNNEL, 1, "RunStarted"],
			[RUN_FUNNEL, 2, "FirstKill"],
			[RUN_FUNNEL, 3, "BossEngaged"],
		]);
		const progression = events.filter((e) => e.kind === "progression");
		expect(progression.map((e) => (e.kind === "progression" ? e.status : ""))).toEqual(["Start", "Fail"]);
		const death = events.find((e) => e.kind === "custom" && e.name === ANALYTICS_EVENT.playerDeath);
		expect(death).toEqual({
			kind: "custom",
			name: ANALYTICS_EVENT.playerDeath,
			value: 29.75,
			fields: { field01: "boss.act1", field02: "boss" },
		});
		const ended = events.find((e) => e.kind === "custom" && e.name === ANALYTICS_EVENT.runEnded);
		expect(ended).toEqual({
			kind: "custom",
			name: ANALYTICS_EVENT.runEnded,
			value: 29.75,
			fields: { field01: "death", field02: "phase1", field03: "boss.act1" },
		});
		const hits = events.filter((e) => e.kind === "custom" && e.name === ANALYTICS_EVENT.hitsTaken);
		expect(hits.map((e) => (e.kind === "custom" ? [e.fields?.field01, e.value] : []))).toEqual([
			["boss.act1", 6],
			["swarmer", 3],
		]);
	});

	it("run-boss-1337: funnel through BossPhase3, progression Start only (alive, boss not dead)", () => {
		const events = analyticsForRun(fromStream(runBoss as unknown as StreamFixture));
		const steps = events.filter((e) => e.kind === "funnel").map((e) => (e.kind === "funnel" ? e.step : 0));
		expect(steps).toEqual([1, 2, 3, 4, 5]);
		const progression = events.filter((e) => e.kind === "progression");
		expect(progression.map((e) => (e.kind === "progression" ? e.status : ""))).toEqual(["Start"]);
		expect(events.find((e) => e.kind === "custom" && e.name === ANALYTICS_EVENT.playerDeath)).toBe(undefined);
	});

	it("a boss kill completes the funnel and the progression", () => {
		const t = new RunTelemetry(START_HALF_HEARTS, runFull.archetypeIds);
		const alive = { hearts: START_HALF_HEARTS, dead: 0 };
		t.observe({ tick: 10, events: { enemiesKilled: 1 }, player: alive });
		t.observe({ tick: 20, events: { bossEngaged: 1, bossPhase: 1 }, player: alive });
		t.observe({ tick: 30, events: { bossPhase: 2 }, player: alive });
		t.observe({ tick: 40, events: { bossPhase: 3 }, player: alive });
		t.observe({ tick: 50, events: { bossDefeated: 1 }, player: alive });
		const rec = t.finish();
		expect(rec.endReason).toBe("victory");
		expect(rec.victoryTick).toBe(50);
		const events = analyticsForRun(rec);
		expect(events.filter((e) => e.kind === "funnel").size()).toBe(6);
		const progression = events.filter((e) => e.kind === "progression");
		expect(progression.map((e) => (e.kind === "progression" ? e.status : ""))).toEqual(["Start", "Complete"]);
	});

	it("the boss progression level names the run's first boss; Mother Bramble's event is unchanged", () => {
		const progression = (rec: RunTelemetryRecord) => analyticsForRun(rec).filter((e) => e.kind === "progression");
		// fixture event streams carry no actors: Mother Bramble's level, exactly as before
		const full = fromStream(runFull as unknown as StreamFixture);
		expect(full.bossId).toBe(undefined);
		expect(progression(full)[0]).toEqual({
			kind: "progression",
			status: "Start",
			path: "ActI",
			level: 1,
			levelName: "MotherBramble",
		});
		expect(bossProgressionLevel(BOSS_ACT1_ID)).toEqual({ level: 1, levelName: "MotherBramble" });
		expect(bossProgressionLevel(BOSS_DEMONLORD_ID)).toEqual({ level: 2, levelName: "DemonLord" });
		expect(bossProgressionLevel("boss.unknown")).toEqual(bossProgressionLevel(undefined));
		expect(BOSS_PROGRESSION_LEVELS.size()).toBe(2);
		// the engage tick's actors name the boss (the first engaged one; later engages keep it)
		const demon = archetypeIndex(BOSS_DEMONLORD_ID);
		const t = new RunTelemetry(START_HALF_HEARTS);
		const alive = { hearts: START_HALF_HEARTS, dead: 0 };
		const actors = [
			{ kind: 3, alive: 1, phase: 0 },
			{ kind: demon, alive: 1, phase: 1 },
		];
		t.observe({ tick: 5, events: {}, player: alive, combat: { actors } });
		t.observe({ tick: 20, events: { bossEngaged: 1, bossPhase: 1 }, player: alive, combat: { actors } });
		const later = [{ kind: archetypeIndex(BOSS_ACT1_ID), alive: 1, phase: 1 }];
		t.observe({ tick: 90, events: { bossEngaged: 1, bossPhase: 1 }, player: alive, combat: { actors: later } });
		t.observe({ tick: 99, events: { playerDied: 1 }, player: { hearts: 0, dead: 1 } });
		const rec = t.finish();
		expect(rec.bossId).toBe(BOSS_DEMONLORD_ID);
		expect(progression(rec)).toEqual([
			{ kind: "progression", status: "Start", path: BOSS_PROGRESSION_PATH, level: 2, levelName: "DemonLord" },
			{
				kind: "progression",
				status: "Fail",
				path: BOSS_PROGRESSION_PATH,
				level: 2,
				levelName: "DemonLord",
				fields: { field01: "unknown" },
			},
		]);
		// only an engaged (phase >= 1), live boss counts
		expect(engagedBossId([{ kind: demon, alive: 1, phase: 0 }])).toBe(undefined);
		expect(engagedBossId([{ kind: demon, alive: 0, phase: 2 }])).toBe(undefined);
		expect(engagedBossId([{ kind: 3, alive: 1, phase: 1 }])).toBe(undefined);
		expect(engagedBossId([{ kind: -1, alive: 1, phase: 1 }])).toBe(undefined);
	});

	for (const bossId of [BOSS_ACT1_ID, BOSS_DEMONLORD_ID]) {
		it(`names ${bossId} from the live sim state on its engage tick`, () => {
			const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });
			const config: SimConfig = {
				moveResolver: circleMover(d, PLAYER_RADIUS),
				isBulletBlocked: bulletBlocker(d),
				actorMover: actorMover(d),
				encounter: placeEncounter(d, { boss: bossId }),
			};
			const spawn = bossDoorSpawn(d)!;
			const state = createSimState(1337, spawn.x, spawn.z, config);
			const boss = state.combat.actors[0];
			const t = new RunTelemetry(START_HALF_HEARTS);
			state.player.x = boss.x + 3;
			state.player.z = boss.z;
			for (let i = 0; i < 5; i++) {
				step(state, EMPTY_INPUT, config);
				t.observe(state);
			}
			const rec = t.finish();
			expect(rec.bossEngagedTick).toBe(1);
			expect(rec.bossId).toBe(bossId);
			const start = analyticsForRun(rec).find((e) => e.kind === "progression");
			expect(start).toEqual({
				kind: "progression",
				status: "Start",
				path: "ActI",
				...bossProgressionLevel(bossId),
			});
		});
	}

	it("a rejection is one bucketed event", () => {
		expect(analyticsForRejection("hash_mismatch")).toEqual({
			kind: "custom",
			name: ANALYTICS_EVENT.runRejected,
			value: 1,
			fields: { field01: "hash_mismatch" },
		});
	});
});

describe("summarizeRunSession (aggregate.mjs summarizeSession, per player)", () => {
	const died = fromStream(runPlayer as unknown as StreamFixture); // 976 ticks alive, then dead
	const alive = fromStream(runPlayerDungeon as unknown as StreamFixture); // 600 ticks, alive

	it("counts a death followed by another run as a retry; a final death ends the streak", () => {
		const s = summarizeRunSession([died, died, alive, died]);
		expect(s.runs).toBe(4);
		expect(s.deaths).toBe(3);
		expect(s.retriesAfterDeath).toBe(2);
		expect(s.longestRetryStreak).toBe(2);
		expect(s.retryAfterDeathRate).toBe(0.667);
		expect(s.timeToFirstDeathSec).toBe(16.27);
		expect(s.bestRunSeconds).toBe(16.27);
		expect(s.aliveSeconds).toBe(math.round(((976 * 3 + 600) / 60) * 100) / 100);
	});

	it("session analytics: retried / quitAfterDeath / noDeaths, nothing for an empty session", () => {
		const fields = (runs: RunTelemetryRecord[]) => {
			const first = analyticsForSession(summarizeRunSession(runs))[0];
			return first && first.kind === "custom" ? first.fields?.field01 : undefined;
		};
		expect(fields([died, alive])).toBe("retried");
		expect(fields([alive, died])).toBe("quitAfterDeath");
		expect(fields([alive])).toBe("noDeaths");
		expect(analyticsForSession(summarizeRunSession([]))).toEqual([]);
	});
});

describe("locale analytics (docs/LOCALIZATION.md L14)", () => {
	/** Roblox AnalyticsService: combinations of the custom field values per experience; this feature's share. */
	const ROBLOX_MAX_FIELD_COMBINATIONS = 8000;
	const LOCALE_COMBINATION_BUDGET = 400;

	it("buckets the shown locale to a live code or other", () => {
		expect(localeBucket("en")).toBe("en");
		expect(localeBucket("de")).toBe(LOCALE_OTHER); // hidden until its go-live (LD12)
		expect(localeBucket("en-XA")).toBe(LOCALE_OTHER);
		expect(localeBucket("xx")).toBe(LOCALE_OTHER);
	});

	it("buckets the Roblox language as the locale it would pick with every locale live", () => {
		expect(languageBucket(["es-mx"])).toBe("es");
		expect(languageBucket(["pt-br"])).toBe("pt-BR");
		expect(languageBucket(["en-us"])).toBe("en");
		expect(languageBucket(["en-au"])).toBe("en");
		expect(languageBucket(["sw-ke"])).toBe(LOCALE_OTHER);
		expect(languageBucket([])).toBe(LOCALE_OTHER);
		expect(languageBucket(["en-xa"])).toBe("en"); // never the pseudo-locale
	});

	it("a player's fields: hidden picks only for developers, and they bucket as other", () => {
		expect(localeAnalytics(["de-de"], undefined, false)).toEqual({ shown: "en", language: "de" });
		expect(localeAnalytics(["de-de"], undefined, true)).toEqual({ shown: LOCALE_OTHER, language: "de" });
		expect(localeAnalytics(["ja-jp"], "en-XA", true)).toEqual({ shown: LOCALE_OTHER, language: "ja" });
		expect(localeAnalytics(["ja-jp"], "en", false)).toEqual({ shown: "en", language: "ja" });
	});

	it("every value comes from small fixed sets, within Roblox's field limits", () => {
		const values = localeAnalyticsValues();
		const shown = new Set(values.shown);
		const language = new Set(values.language);
		for (const ids of [["de-de"], ["ja-jp"], ["en-us"], ["xx-yy"], []] as string[][]) {
			for (const override of [undefined, "en", "de", "en-XA"]) {
				for (const dev of [false, true]) {
					const f = localeAnalytics(ids, override, dev);
					expect(shown.has(f.shown)).toBe(true);
					expect(language.has(f.language)).toBe(true);
				}
			}
		}
		const n = values.shown.size() * values.language.size();
		expect(n <= LOCALE_COMBINATION_BUDGET).toBe(true);
		expect(n < ROBLOX_MAX_FIELD_COMBINATIONS).toBe(true);
	});

	it("rides on the RunStarted funnel step only, and only when given", () => {
		const rec = fromStream(runFull as unknown as StreamFixture);
		const plain = analyticsForRun(rec);
		const tagged = analyticsForRun(rec, { shown: "en", language: "es" });
		expect(tagged.size()).toBe(plain.size());
		expect(tagged[0]).toEqual({
			kind: "funnel",
			funnel: RUN_FUNNEL,
			step: 1,
			stepName: "RunStarted",
			fields: { field01: "en", field02: "es" },
		});
		expect(plain[0]).toEqual({ kind: "funnel", funnel: RUN_FUNNEL, step: 1, stepName: "RunStarted" });
		for (let i = 1; i < plain.size(); i++) expect(tagged[i]).toEqual(plain[i]);
	});
});
