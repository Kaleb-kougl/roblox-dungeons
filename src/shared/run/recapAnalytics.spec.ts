// The run-over recap's telemetry (docs/RUN_RECAP.md RR9): readRunRecapReport's accept / reject / clamp cases, the
// near-miss kinds pinned to the recap's own order, the events of a solo and a party report, and RunRecapGate's one
// report per issued run session. The catalog's budget is analyticsCatalog.spec.ts's.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ANALYTICS_EVENT,
	RUN_RECAP_NEAR_MISS_KINDS,
	RUN_RECAP_TELEMETRY,
	RunRecapGate,
	analyticsForRunRecap,
	readRunRecapReport,
	runRecapFlags,
	type RunRecapReport,
} from "shared/run";
import { RECAP_NEAR_MISS_ORDER } from "shared/view/hud";

const SOLO = {
	runId: "6B29FC40-CA47-1067-B31D-00DD010662DA",
	close: "retry",
	seconds: 1.234,
	nearMiss: "stairs",
	record: false,
	skipped: true,
};

const TEAM = { teamPerfects: 5, bestTeamStreak: 3, syncParries: 2 };

function withField(key: string, value: unknown): Record<string, unknown> {
	const out: Record<string, unknown> = { ...SOLO };
	out[key] = value;
	return out;
}

describe("readRunRecapReport", () => {
	it("accepts a solo report, rounding seconds to tenths", () => {
		const r = readRunRecapReport(SOLO);
		expect(r).toEqual({ ...SOLO, seconds: 1.2 });
	});

	it("accepts every near-miss kind of the recap and `none`", () => {
		for (const kind of [...RECAP_NEAR_MISS_ORDER, "none"]) {
			expect(readRunRecapReport(withField("nearMiss", kind))?.nearMiss).toBe(kind);
		}
	});

	it("accepts every close", () => {
		for (const close of ["retry", "exit", "lobby"]) {
			expect(readRunRecapReport(withField("close", close))?.close).toBe(close);
		}
	});

	it("clamps seconds to 0..maxSeconds", () => {
		expect(readRunRecapReport(withField("seconds", -3))?.seconds).toBe(0);
		expect(readRunRecapReport(withField("seconds", 1e9))?.seconds).toBe(RUN_RECAP_TELEMETRY.maxSeconds);
		expect(readRunRecapReport(withField("seconds", 0.35))?.seconds).toBe(0.4);
	});

	it("keeps a party report's team, clamped (counts to maxTeamCount, the streak to the perfects)", () => {
		const party = { ...SOLO, close: "lobby", team: TEAM };
		expect(readRunRecapReport(party)?.team).toEqual(TEAM);
		const big = { ...party, team: { teamPerfects: 1e6, bestTeamStreak: 2, syncParries: 5000 } };
		const max = RUN_RECAP_TELEMETRY.maxTeamCount;
		expect(readRunRecapReport(big)?.team).toEqual({ teamPerfects: max, bestTeamStreak: 2, syncParries: max });
		const long = { ...party, team: { teamPerfects: 2, bestTeamStreak: 7, syncParries: 0 } };
		expect(readRunRecapReport(long)?.team?.bestTeamStreak).toBe(2);
		// A lobby close without moments stays valid (no team rows).
		const bare = readRunRecapReport({ ...SOLO, close: "lobby" });
		expect(bare?.close).toBe("lobby");
		expect(bare?.team).toBe(undefined);
	});

	it("drops a team on a solo close", () => {
		const r = readRunRecapReport({ ...SOLO, team: TEAM });
		expect(r).never.toBe(undefined);
		expect(r?.team).toBe(undefined);
	});

	it("rejects malformed payloads", () => {
		const nan = 0 / 0;
		const bad: unknown[] = [
			undefined,
			"retry",
			42,
			withField("runId", undefined),
			withField("runId", ""),
			withField("runId", 7),
			withField("runId", string.rep("x", RUN_RECAP_TELEMETRY.maxRunIdChars + 1)),
			withField("close", "again"),
			withField("close", undefined),
			withField("nearMiss", "nearly"),
			withField("nearMiss", undefined),
			withField("nearMiss", 1),
			withField("seconds", nan),
			withField("seconds", math.huge),
			withField("seconds", -math.huge),
			withField("seconds", "2"),
			withField("record", 1),
			withField("record", undefined),
			withField("skipped", "yes"),
			{ ...SOLO, close: "lobby", team: "lots" },
			{ ...SOLO, close: "lobby", team: { ...TEAM, teamPerfects: -1 } },
			{ ...SOLO, close: "lobby", team: { ...TEAM, bestTeamStreak: 1.5 } },
			{ ...SOLO, close: "lobby", team: { ...TEAM, syncParries: nan } },
			{ ...SOLO, close: "lobby", team: { teamPerfects: 1, bestTeamStreak: 1 } },
		];
		for (const v of bad) expect(readRunRecapReport(v)).toBe(undefined);
		// A malformed team rejects even on a solo close (the payload is not what the client sends).
		expect(readRunRecapReport({ ...SOLO, team: { ...TEAM, syncParries: -2 } })).toBe(undefined);
	});
});

describe("near-miss kinds", () => {
	it("mirror shared/view/hud RECAP_NEAR_MISS_ORDER exactly, in order", () => {
		expect([...RUN_RECAP_NEAR_MISS_KINDS]).toEqual([...RECAP_NEAR_MISS_ORDER]);
	});
});

describe("analyticsForRunRecap", () => {
	it("a solo close: one RunRecap row valued in seconds", () => {
		const r = readRunRecapReport(SOLO)!;
		expect(analyticsForRunRecap(r)).toEqual([
			{
				kind: "custom",
				name: ANALYTICS_EVENT.runRecap,
				value: 1.2,
				fields: { field01: "retry", field02: "stairs", field03: "plainSkipped" },
			},
		]);
	});

	it("a party close adds one row per team total", () => {
		const r: RunRecapReport = { ...readRunRecapReport(SOLO)!, close: "lobby", skipped: false, team: TEAM };
		const specs = analyticsForRunRecap(r);
		expect(specs.size()).toBe(4);
		expect(specs[0].kind === "custom" && specs[0].fields?.field03).toBe("plain");
		const rows = new Map<string, number>();
		for (let i = 1; i < specs.size(); i++) {
			const s = specs[i];
			if (s.kind !== "custom") continue;
			expect(s.name).toBe(ANALYTICS_EVENT.runRecap);
			expect(s.fields?.field02).toBe(undefined);
			rows.set(s.fields?.field01 ?? "", s.value);
		}
		expect(rows.get("teamPerfects")).toBe(5);
		expect(rows.get("bestTeamStreak")).toBe(3);
		expect(rows.get("syncParries")).toBe(2);
	});

	it("flags: record x skipped", () => {
		expect(runRecapFlags(false, false)).toBe("plain");
		expect(runRecapFlags(false, true)).toBe("plainSkipped");
		expect(runRecapFlags(true, false)).toBe("record");
		expect(runRecapFlags(true, true)).toBe("recordSkipped");
	});
});

describe("RunRecapGate", () => {
	it("takes one report per issued run, per player", () => {
		const g = new RunRecapGate<string>();
		expect(g.take("a", "r1")).toBe(false); // never issued
		g.issue("a", "r1");
		g.issue("b", "r1"); // a party run: every member
		expect(g.take("a", "r1")).toBe(true);
		expect(g.take("a", "r1")).toBe(false); // once
		expect(g.take("b", "r1")).toBe(true);
		expect(g.take("a", "r2")).toBe(false); // another player's or a forged id
		g.issue("a", "r1"); // issuing again does not re-open it
		expect(g.take("a", "r1")).toBe(false);
	});

	it("a report may arrive after the next run started (within runsRemembered)", () => {
		const g = new RunRecapGate<string>(2);
		g.issue("a", "r1");
		g.issue("a", "r2");
		expect(g.take("a", "r1")).toBe(true);
		g.issue("a", "r3"); // r1 falls out
		expect(g.take("a", "r2")).toBe(true);
		g.issue("a", "r4");
		expect(g.take("a", "r1")).toBe(false);
		expect(g.take("a", "r3")).toBe(true);
	});

	it("forget drops a player", () => {
		const g = new RunRecapGate<string>();
		g.issue("a", "r1");
		expect(g.size()).toBe(1);
		g.forget("a");
		expect(g.size()).toBe(0);
		expect(g.take("a", "r1")).toBe(false);
	});
});
