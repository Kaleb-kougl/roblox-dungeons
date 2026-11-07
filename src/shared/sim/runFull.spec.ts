// Golden-fixture parity: the real M1 game on the seed-1337 floor (fixtures/run-full-1337.json, 3600 ticks): the
// path-walker bot fights its way along the BFS path (21 kills), engages the boss at tick 1330 and dies to it at 1784;
// the boss and 3 room enemies keep acting until tick 3600. Every actor archetype but the turrets is on the path.
import { afterAll, describe, expect, it } from "@rbxts/jest-globals";
import { PlayerMover, setPlayerMover } from "shared/run";
import {
	DEFAULT_ENCOUNTER,
	KALEB_VALE_MVP_PARAMS,
	actorMover,
	bulletBlocker,
	circleMover,
	generateDungeon,
	placeEncounter,
} from "shared/dungeon";
import runFull from "shared/fixtures-generated/run-full-1337";
import runFullDumps from "shared/fixtures-generated/run-full-1337_dumps";
import {
	DEFAULT_SIM_CONFIG,
	PLAYER_RADIUS,
	archetypeAt,
	webArchetypeIds,
	checkRunFixture,
	countActors,
	hashState,
	replaySummary,
	weaponIds,
	type RunDump,
	type RunFixture,
	type SimConfig,
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
const portBossHp = setBossHp(WEB_BOSS_HP); // the web boss's 540 hp (port: 270)
afterAll(() => {
	setSwordTimings(portSword);
	setSwarmerHp(portSwarmerHp);
	setPlayerMover(portMover);
	setBossHp(portBossHp);
});

const run = runFull as unknown as RunFixture;
const dumps = runFullDumps.dumps as unknown as ReadonlyArray<RunDump>;

describe("run-full-1337.json parity", () => {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });
	const config: SimConfig = {
		...DEFAULT_SIM_CONFIG,
		moveResolver: circleMover(d, PLAYER_RADIUS),
		isBulletBlocked: bulletBlocker(d),
		actorMover: actorMover(d),
		encounter: placeEncounter(d, DEFAULT_ENCOUNTER),
	};
	const report = checkRunFixture(run, config, dumps);

	it("uses the web build's archetype and weapon index tables", () => {
		expect([...webArchetypeIds()]).toEqual([...runFull.archetypeIds]);
		expect([...weaponIds()]).toEqual([...runFull.weaponIds]);
	});

	it(`matches the hash after every tick (0..${runFull.ticks})`, () => {
		expect(report.hashMismatch).toBe(undefined);
		expect(report.ticksMatched).toBe(runFull.ticks + 1);
	});

	it("matches every per-subsystem hash on every tick", () => {
		expect(runFull.subsystemsEvery).toBe(1);
		expect(report.subsystemMismatches).toEqual([]);
	});

	it("matches the full state dumps at ticks 0, 60, 600 and 3600 field by field", () => {
		expect(report.dumpsChecked).toEqual([0, 60, 600, 3600]);
		expect(report.dumpMismatches).toEqual([]);
	});

	it("produces the same events on the same ticks", () => {
		expect(report.eventMismatches).toEqual([]);
	});

	it("sums to the fixture totals, first ticks and hits by source; ends with the fixture's final summary", () => {
		const s = replaySummary(run, config, runFull.archetypeIds);
		const totals = runFull.totals as unknown as Record<string, number>;
		for (const [f, v] of s.totals) expect([f, v]).toEqual([f, totals[f]]);
		expect(s.totals.get("actorsKilled")).toBe(21);

		const first = new Map<string, number>();
		for (const [k, v] of runFull.firstTick as unknown as ReadonlyMap<string, number>) first.set(k, v);
		expect(s.firstTick).toEqual(first);
		expect([
			s.firstTick.get("actorsKilled"),
			s.firstTick.get("bossEngaged"),
			s.firstTick.get("playerDied"),
		]).toEqual([112, 1330, 1784]);
		const hits = new Map<string, number>();
		for (const [k, v] of runFull.hitsBySource as unknown as ReadonlyMap<string, number>) hits.set(k, v);
		expect(s.hitsBySource).toEqual(hits);

		const last = s.state;
		expect(hashState(last)).toBe(runFull.finalHash);
		const f = runFull.final;
		expect(last.tick).toBe(f.tick);
		const p = last.player;
		expect([p.x, p.z, p.hearts, p.heartsMax, p.flask, p.embers, p.dead]).toEqual([
			f.player.x,
			f.player.z,
			f.player.hearts,
			f.player.heartsMax,
			f.player.flask,
			f.player.embers,
			f.player.dead,
		]);
		const c = last.combat;
		expect(c.weapons.activeSet).toBe(f.activeWeaponSet);
		const counts = countActors(c);
		expect([c.actors.size(), counts.present, counts.alive, c.nextActorId, c.actorsDropped]).toEqual([
			f.actors.slots,
			f.actors.present,
			f.actors.alive,
			f.actors.nextActorId,
			f.actors.dropped,
		]);
		const boss = c.actors[f.boss.slot];
		expect([
			archetypeAt(boss.kind).id,
			boss.hp,
			boss.hpMax,
			boss.phase,
			boss.alive,
			boss.aiState,
			boss.attack,
			boss.x,
			boss.z,
		]).toEqual([
			f.boss.id,
			f.boss.hp,
			f.boss.hpMax,
			f.boss.phase,
			f.boss.alive,
			f.boss.aiState,
			f.boss.attack,
			f.boss.x,
			f.boss.z,
		]);
		expect([
			c.enemyBullets.activeCount,
			c.playerBullets.activeCount,
			c.enemySpawned,
			c.playerSpawned,
			c.dropped,
		]).toEqual([
			f.bullets.enemyLive,
			f.bullets.playerLive,
			f.bullets.enemySpawned,
			f.bullets.playerSpawned,
			f.bullets.dropped,
		]);
	});
});
