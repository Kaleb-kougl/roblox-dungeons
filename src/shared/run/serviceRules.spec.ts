// docs/SERVER_CENSUS.md SE3: the run services' pure rules moved out of RunValidationService / RunSessionService: the
// limits a Studio session validates under, the verdict of a submission that was never replayed, and one recipient's
// copy of a run's verdict.
import { describe, expect, it } from "@rbxts/jest-globals";
import type { DailyRunResult } from "shared/daily";
import type { RunFinishVerdict } from "shared/network";
import type { RunRecordsResult } from "shared/records";
import {
	DEFAULT_RUN_SCORE,
	LIVE_RUN_LIMITS,
	STUDIO_RUN_WORLDS,
	forRecipient,
	gateVerdict,
	studioRunLimits,
} from "shared/run";
import type { SilverGrantBreakdown } from "shared/wallet";

describe("studioRunLimits", () => {
	it("no attribute set: exactly the live limits (the same object)", () => {
		expect(studioRunLimits(undefined, undefined)).toBe(LIVE_RUN_LIMITS);
		expect(LIVE_RUN_LIMITS.allowDebugInput).toBe(false);
		expect(LIVE_RUN_LIMITS.allowBossDoorSpawn).toBe(false);
	});

	it("only the boolean true allows debug input and boss-door starts", () => {
		const debug = studioRunLimits(true, undefined);
		expect([debug.allowDebugInput, debug.allowBossDoorSpawn]).toEqual([true, true]);
		expect([debug.world, debug.maxTicks, debug.maxRecordingBytes]).toEqual([
			LIVE_RUN_LIMITS.world,
			LIVE_RUN_LIMITS.maxTicks,
			LIVE_RUN_LIMITS.maxRecordingBytes,
		]);
		const junk: unknown[] = [false, "true", 1, 0, {}, 0 / 0];
		for (const v of junk) expect(studioRunLimits(v, undefined)).toBe(LIVE_RUN_LIMITS);
	});

	it("the world attribute selects one of the four known worlds and nothing else", () => {
		expect(STUDIO_RUN_WORLDS).toEqual(["game", "endless", "dungeonNoEncounter", "greybox"]);
		for (const world of STUDIO_RUN_WORLDS) {
			const l = studioRunLimits(undefined, world);
			expect(l.world).toBe(world);
			expect([l.allowDebugInput, l.allowBossDoorSpawn]).toEqual([false, false]);
		}
		const junk: unknown[] = ["tutorial", "daily", "dev", "Greybox", "", 3, true, {}];
		for (const v of junk) expect(studioRunLimits(undefined, v)).toBe(LIVE_RUN_LIMITS);
	});

	it("both attributes compose; the size limits never move", () => {
		const l = studioRunLimits(true, "greybox");
		expect(l).toEqual({ ...LIVE_RUN_LIMITS, allowDebugInput: true, allowBossDoorSpawn: true, world: "greybox" });
	});

	it("never mutates the live limits", () => {
		studioRunLimits(true, "greybox");
		expect([LIVE_RUN_LIMITS.allowDebugInput, LIVE_RUN_LIMITS.allowBossDoorSpawn]).toEqual([false, false]);
	});
});

describe("gateVerdict", () => {
	it("refuses with the gate's code, no server hash, an empty summary and no run id", () => {
		for (const code of ["busy", "rate_limited"] as const) {
			const v = gateVerdict("0badf00d", code, "why");
			expect(v).toEqual({
				ok: false,
				claimedHash: "0badf00d",
				code,
				reason: "why",
				serverHash: "",
				summary: { ticks: 0, kills: 0, bossDefeated: false, died: false },
			});
			expect(v.runId).toBe(undefined);
		}
	});

	it("each verdict has its own summary object", () => {
		const a = gateVerdict("", "busy", "");
		const b = gateVerdict("", "busy", "");
		a.summary.kills = 9;
		expect(b.summary.kills).toBe(0);
	});
});

describe("forRecipient", () => {
	const verdict: RunFinishVerdict = {
		runId: "run-1",
		ok: true,
		verifiedTicks: 600,
		serverHash: "0badf00d",
		summary: { ticks: 600, kills: 4, bossDefeated: false, died: true },
		score: { ...DEFAULT_RUN_SCORE },
		leaderboard: "queued",
	};
	const records: RunRecordsResult = {
		board: "solo",
		scoreImproved: true,
		floorImproved: false,
		previous: { score: 10, floor: 2 },
	};
	const daily = { day: 303, ruleset: 1, posted: true, improved: true } as DailyRunResult;
	const silver = { runId: "run-1", total: 46, balance: 146 } as SilverGrantBreakdown;

	it("a recipient with no parts gets the verdict itself", () => {
		expect(forRecipient(verdict, undefined, undefined, undefined)).toBe(verdict);
	});

	it("each part present is attached to a copy; the shared verdict is never changed", () => {
		const all = forRecipient(verdict, records, daily, silver);
		expect(all).never.toBe(verdict);
		expect([all.records, all.daily, all.silver]).toEqual([records, daily, silver]);
		expect([all.runId, all.ok, all.serverHash, all.leaderboard]).toEqual(["run-1", true, "0badf00d", "queued"]);
		expect([verdict.records, verdict.daily, verdict.silver]).toEqual([undefined, undefined, undefined]);
	});

	it("only the parts given are attached (another member's Silver never rides along)", () => {
		const onlySilver = forRecipient(verdict, undefined, undefined, silver);
		expect([onlySilver.records, onlySilver.daily, onlySilver.silver]).toEqual([undefined, undefined, silver]);
		const onlyRecords = forRecipient(verdict, records, undefined, undefined);
		expect([onlyRecords.records, onlyRecords.daily, onlyRecords.silver]).toEqual([records, undefined, undefined]);
		const onlyDaily = forRecipient(verdict, undefined, daily, undefined);
		expect([onlyDaily.records, onlyDaily.daily, onlyDaily.silver]).toEqual([undefined, daily, undefined]);
	});

	it("two recipients of one verdict get separate copies", () => {
		const a = forRecipient(verdict, undefined, undefined, silver);
		const b = forRecipient(verdict, records, undefined, undefined);
		expect(a).never.toBe(b);
		expect(b.silver).toBe(undefined);
	});
});
