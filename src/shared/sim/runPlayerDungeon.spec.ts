// Golden-fixture parity: the player-only run on the seed-1337 floor (fixtures/run-player-dungeon-1337.json): wall
// collision through the dungeon's circleMover, no encounter. Joins the sim core (task 4) to the Forge port (task 5).
import { describe, expect, it } from "@rbxts/jest-globals";
import { KALEB_VALE_MVP_PARAMS, actorMover, bulletBlocker, circleMover, generateDungeon } from "shared/dungeon";
import runPlayerDungeon from "shared/fixtures-generated/run-player-dungeon-1337";
import {
	DEFAULT_SIM_CONFIG,
	PLAYER_RADIUS,
	checkRunFixture,
	type RunDump,
	type RunFixture,
	type SimConfig,
} from "shared/sim";

const run = runPlayerDungeon as unknown as RunFixture;
const dumps = runPlayerDungeon.dumps as unknown as ReadonlyArray<RunDump>;

describe("run-player-dungeon-1337.json parity", () => {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });
	const config: SimConfig = {
		...DEFAULT_SIM_CONFIG,
		moveResolver: circleMover(d, PLAYER_RADIUS),
		isBulletBlocked: bulletBlocker(d),
		actorMover: actorMover(d),
	};
	const report = checkRunFixture(run, config, dumps);

	it("matches the hash after every tick", () => {
		expect(report.hashMismatch).toBe(undefined);
		expect(report.ticksMatched).toBe(runPlayerDungeon.ticks + 1);
	});

	it("matches every per-subsystem hash, every dump and every event", () => {
		expect(report.subsystemMismatches).toEqual([]);
		expect(report.dumpMismatches).toEqual([]);
		expect(report.eventMismatches).toEqual([]);
	});
});
