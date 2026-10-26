// Golden-fixture parity: the web build's player-only run (fixtures/run-player.json, 996 ticks, greybox config).
import { describe, expect, it } from "@rbxts/jest-globals";
import runPlayer from "shared/fixtures-generated/run-player";
import {
	DEFAULT_SIM_CONFIG,
	checkRunFixture,
	countActors,
	deserializeRecording,
	firstFieldMismatch,
	describeMismatch,
	hashState,
	runReplay,
	weaponIds,
	webArchetypeIds,
	type RunDump,
	type RunFixture,
} from "shared/sim";

const run = runPlayer as unknown as RunFixture;
const dumps = runPlayer.dumps as unknown as ReadonlyArray<RunDump>;

describe("run-player.json parity", () => {
	const report = checkRunFixture(run, DEFAULT_SIM_CONFIG, dumps);

	it("matches the hash after every tick (0..996)", () => {
		expect(report.hashMismatch).toBe(undefined);
		expect(report.ticksMatched).toBe(runPlayer.ticks + 1);
	});

	it("matches every per-subsystem hash on every tick", () => {
		expect(runPlayer.subsystemsEvery).toBe(1);
		expect(report.subsystemMismatches).toEqual([]);
	});

	it("matches the full state dumps at ticks 0, 1, 60 and 600 field by field", () => {
		expect(report.dumpsChecked).toEqual([0, 1, 60, 600]);
		expect(report.dumpMismatches).toEqual([]);
	});

	it("produces the same events on the same ticks", () => {
		expect(report.eventMismatches).toEqual([]);
	});

	it("runReplay gives the final hash and the final summary", () => {
		const recording = deserializeRecording(runPlayer.recording);
		const last = runReplay(recording, DEFAULT_SIM_CONFIG);
		expect(hashState(last)).toBe(runPlayer.finalHash);
		const f = runPlayer.final;
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
		expect(last.combat.enemyBullets.activeCount).toBe(f.bullets.enemyLive);
		expect(last.combat.playerBullets.activeCount).toBe(f.bullets.playerLive);
	});

	it("uses the web build's weapon and archetype index tables", () => {
		expect([...weaponIds()]).toEqual([...runPlayer.weaponIds]);
		expect([...webArchetypeIds()]).toEqual([...runPlayer.archetypeIds]);
	});

	it("the checker reports a divergence (no bounds clamp: the run leaves the room)", () => {
		const bad = checkRunFixture(run, {}, dumps);
		expect(bad.hashMismatch).never.toBe(undefined);
		expect(bad.ticksMatched).toBeGreaterThan(1);
		expect(bad.ticksMatched).toBeLessThan(runPlayer.ticks + 1);
		expect(bad.subsystemMismatches.size()).toBeGreaterThan(0);
		expect(bad.subsystemMismatches[0].find(": core ", 1, true)[0]).never.toBe(undefined);
	});

	it("the field-diff helper names the first differing field", () => {
		const recording = deserializeRecording(runPlayer.recording);
		const s = runReplay(recording, DEFAULT_SIM_CONFIG, 60);
		s.player.flask += 1;
		const m = firstFieldMismatch(s, dumps[2].fields);
		expect(m).never.toBe(undefined);
		expect(m!.expectedName).toBe("player.flask");
		expect(describeMismatch(m!)).toBe(
			`field #12: expected player.flask = ${m!.expectedHex}, got player.flask = ${m!.actualHex} (4)`,
		);
	});
});
