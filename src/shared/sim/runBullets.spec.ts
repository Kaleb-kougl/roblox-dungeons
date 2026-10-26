// Golden-fixture parity: the web build's bullet run (fixtures/run-bullets.json, 499 ticks, greybox + ?stress=200):
// stress rings, bow stream, heavy piercing arrow, half charge, Ember clear of 240 bullets, sword combo / finisher /
// guard deleting 14 bullets, roll, SWAP back, then bullets ageing out.
import { afterAll, describe, expect, it } from "@rbxts/jest-globals";
import runBullets from "shared/fixtures-generated/run-bullets";
import {
	DEFAULT_BOUNDS,
	SIM_EVENT_FIELDS,
	checkRunFixture,
	countActors,
	createSimState,
	deserializeRecording,
	hashState,
	runReplay,
	step,
	weaponIds,
	type RunDump,
	type RunFixture,
	type SimConfig,
	type SimEvents,
	WEB_SWORD_TIMINGS,
	setSwordTimings,
	type SwordTimings,
} from "shared/sim";

// The golden runs (and the source's measured tables) were recorded with the web build's sword; the port's is 20%
// slower (CLAUDE.md decision log), so this file replays under WEB_SWORD_TIMINGS. Set at load, not in a beforeAll:
// describe bodies may replay while the specs are collected.
const portSword: SwordTimings = setSwordTimings(WEB_SWORD_TIMINGS);
afterAll(() => {
	setSwordTimings(portSword);
});

const run = runBullets as unknown as RunFixture;
const dumps = runBullets.dumps as unknown as ReadonlyArray<RunDump>;

/** `{ bounds: DEFAULT_BOUNDS, stress: { bullets: 200, x: 0, z: 0 }, loadout: ['weapon.bow', 'weapon.sword'] }`. */
const CONFIG: SimConfig = {
	bounds: DEFAULT_BOUNDS,
	stress: {
		bullets: runBullets.config.stress.bullets,
		x: runBullets.config.stress.x,
		z: runBullets.config.stress.z,
	},
	loadout: ["weapon.bow", "weapon.sword"],
};

describe("run-bullets.json parity", () => {
	const report = checkRunFixture(run, CONFIG, dumps);

	it("uses the documented config", () => {
		expect(runBullets.config.stress.bullets).toBe(200);
		expect([runBullets.config.stress.x, runBullets.config.stress.z]).toEqual([0, 0]);
		expect([...weaponIds()]).toEqual([...runBullets.weaponIds]);
	});

	it(`matches the hash after every tick (0..${runBullets.ticks})`, () => {
		expect(report.hashMismatch).toBe(undefined);
		expect(report.ticksMatched).toBe(runBullets.ticks + 1);
	});

	it("matches every per-subsystem hash on every tick", () => {
		expect(runBullets.subsystemsEvery).toBe(1);
		expect(report.subsystemMismatches).toEqual([]);
	});

	it("matches the full state dumps at ticks 0, 1, 60 and 300 field by field (every live bullet)", () => {
		expect(report.dumpsChecked).toEqual([0, 1, 60, 300]);
		expect(report.dumpMismatches).toEqual([]);
	});

	it("produces the same events on the same ticks", () => {
		expect(report.eventMismatches).toEqual([]);
	});

	it("sums the events to the fixture totals (Ember clear 240, 14 bullets deleted, 15 shots, 7 swings)", () => {
		const recording = deserializeRecording(runBullets.recording);
		const s = createSimState(recording.seed, recording.spawn.x, recording.spawn.z, CONFIG);
		const totals = new Map<keyof SimEvents, number>();
		// Every field but lastHitSource (an archetype index, not a count; the exporter does not total it).
		const summed = SIM_EVENT_FIELDS.filter((f) => f !== "lastHitSource");
		for (const f of summed) totals.set(f, 0);
		for (const frame of recording.frames) {
			step(s, frame, CONFIG);
			for (const f of summed) totals.set(f, totals.get(f)! + s.events[f]);
		}
		const t = runBullets.totals as unknown as Record<string, number>;
		for (const f of summed) expect([f, totals.get(f)]).toEqual([f, t[f]]);
		expect(t.bulletsCleared).toBe(240);
		expect(t.bulletsDeleted).toBe(14);
	});

	it("runReplay gives the final hash and the final summary", () => {
		const recording = deserializeRecording(runBullets.recording);
		const last = runReplay(recording, CONFIG);
		expect(hashState(last)).toBe(runBullets.finalHash);
		const f = runBullets.final;
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
		expect(last.combat.weapons.activeSet).toBe(f.activeWeaponSet);
		const counts = countActors(last.combat);
		expect([last.combat.actors.size(), counts.present, counts.alive]).toEqual([
			f.actors.slots,
			f.actors.present,
			f.actors.alive,
		]);
		const c = last.combat;
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

	it("the checker catches a bullet-only divergence (stress rings from elsewhere)", () => {
		const moved: SimConfig = { ...CONFIG, stress: { bullets: 200, x: 0, z: 1e-9 } };
		const bad = checkRunFixture(run, moved, dumps);
		expect(bad.hashMismatch).never.toBe(undefined);
		expect(bad.subsystemMismatches.size()).toBeGreaterThan(0);
	});
});
