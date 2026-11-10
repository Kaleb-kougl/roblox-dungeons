// The KV_Debug co-op arrival log (docs/FRAME_PACING.md FP0 / FP5): nearest-rank gap quantiles, the batch-size
// histogram, render fps over the window, and a clean reset at every take (the last arrival carries over).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ARRIVAL_LOG,
	ArrivalLog,
	formatArrivalLine,
	nearestRank,
	type ArrivalLineInfo,
	type LeadStats,
	type PacingStats,
} from "shared/lockstep";

const MS = 1000;

const INFO_WAITING: ArrivalLineInfo = {
	pacing: undefined,
	pacingOff: false,
	lead: 3,
	netLead: 3,
	misses: 0,
	backlog: 0,
	leadStats: undefined,
	leadOff: true,
};

/** The measured lead's stats: trips 7 / 9 / 11 ticks (117 / 150 / 183 ms). */
/** And Revision 3's parts: base 11, the cover's p99 10.4 ticks (12 with the margin) under its ceiling 16: L* 12. */
const LEAD_STATS: LeadStats = {
	lead: 12,
	target: 12,
	fallTarget: 12,
	baseTarget: 11,
	coverP99: 10.4,
	coverTarget: 12,
	ceiling: 16,
	tripP50: 7,
	tripP95: 9,
	tripMax: 11,
	samples: 150,
	warmingUp: false,
	lates: 9,
	mismatches: 0,
	bumps: 0,
	excused: 0,
	raises: 4,
	falls: 1,
	echoing: true,
};

describe("nearestRank", () => {
	it("picks the smallest value with at least that share at or below it", () => {
		const v: number[] = [];
		for (let i = 1; i <= 100; i++) v.push(i);
		expect(nearestRank(v, 0.5)).toBe(50);
		expect(nearestRank(v, 0.95)).toBe(95);
		expect(nearestRank(v, 1)).toBe(100);
		expect(nearestRank(v, 0)).toBe(1);
		expect(nearestRank([7], 0.95)).toBe(7);
		expect(nearestRank([], 0.5)).toBe(undefined);
	});
});

describe("ArrivalLog", () => {
	it("measures inter-arrival gaps: p50 / p95 / max", () => {
		const log = new ArrivalLog();
		// 101 arrivals with gaps of 1..100 ms (in a scrambled order: the quantiles sort them).
		const gaps: number[] = [];
		for (let i = 1; i <= 100; i++) gaps.push(((i * 37) % 100) + 1);
		let t = 5;
		log.arrived(t, 2);
		for (const g of gaps) {
			t += g / MS;
			log.arrived(t, 2);
		}
		const w = log.take(t);
		expect(w.batches).toBe(101);
		expect(w.ticks).toBe(202);
		expect(w.gapMidMs).toBeCloseTo(50, 6);
		expect(w.gapHighMs).toBeCloseTo(95, 6);
		expect(w.gapMaxMs).toBeCloseTo(100, 6);
	});

	it("counts batch sizes, the last bucket taking every larger size", () => {
		const log = new ArrivalLog();
		const n = ARRIVAL_LOG.sizeBuckets;
		const sizes = [1, 2, 2, 3, n - 1, n, n + 5, 0, -1];
		let t = 0;
		for (const s of sizes) log.arrived((t += 0.03), s);
		const w = log.take(t);
		expect(w.sizes.size()).toBe(n);
		expect(w.sizes[0]).toBe(1);
		expect(w.sizes[1]).toBe(2);
		expect(w.sizes[2]).toBe(1);
		expect(w.sizes[n - 2]).toBe(1);
		expect(w.sizes[n - 1]).toBe(2);
		expect(w.batches).toBe(7); // empty and negative batches are ignored
	});

	it("is due after windowSec and resets on take, keeping the last arrival for the next gap", () => {
		const log = new ArrivalLog();
		expect(log.due(100)).toBe(false); // nothing recorded yet: no window
		log.frame(0, 1 / 60);
		log.arrived(0.01, 2);
		log.arrived(0.04, 2);
		expect(log.due(ARRIVAL_LOG.windowSec - 0.001)).toBe(false);
		expect(log.due(ARRIVAL_LOG.windowSec)).toBe(true);
		const first = log.take(ARRIVAL_LOG.windowSec);
		expect(first.batches).toBe(2);
		expect(first.seconds).toBeCloseTo(ARRIVAL_LOG.windowSec, 9);
		expect(log.due(ARRIVAL_LOG.windowSec + 1)).toBe(false); // a new window from the take

		const empty = log.take(ARRIVAL_LOG.windowSec + 1);
		expect(empty.batches).toBe(0);
		expect(empty.frames).toBe(0);
		expect(empty.gapMaxMs).toBe(undefined);
		expect(empty.worstFrameMs).toBe(undefined);
		for (const s of empty.sizes) expect(s).toBe(0);

		// The first gap of a window runs from the previous window's last batch.
		log.arrived(0.1 + ARRIVAL_LOG.windowSec + 1, 3);
		const later = log.take(ARRIVAL_LOG.windowSec + 2);
		expect(later.batches).toBe(1);
		expect(later.gapMaxMs).toBeCloseTo((ARRIVAL_LOG.windowSec + 1.1 - 0.04) * MS, 6);
	});

	it("reports render fps and the worst frame over the window", () => {
		const log = new ArrivalLog();
		const dt = 1 / 60;
		let t = 0;
		log.frame(t, dt);
		for (let i = 0; i < 600; i++) log.frame((t += dt), i === 300 ? 0.1 : dt);
		const w = log.take(t);
		expect(w.frames).toBe(601);
		expect(w.fps).toBeCloseTo(601 / 10, 6);
		expect(w.worstFrameMs).toBeCloseTo(100, 6);
	});

	it("keeps at most maxGaps gaps in a window", () => {
		const log = new ArrivalLog({ ...ARRIVAL_LOG, maxGaps: 4 });
		for (let i = 0; i < 10; i++) log.arrived(i * 0.01 * (i + 1), 1);
		const w = log.take(1);
		expect(w.batches).toBe(10);
		expect(w.gapMaxMs).toBeCloseTo(80, 6); // gaps 20, 40, 60, 80, 100 ...: only the first 4 kept
	});
});

describe("formatArrivalLine", () => {
	const window = () => {
		const log = new ArrivalLog();
		log.frame(0, 1 / 60);
		log.arrived(0, 2);
		log.arrived(0.033, 2);
		log.arrived(0.07, 3);
		return log.take(10);
	};
	const stats: PacingStats = {
		started: true,
		depthTicks: 4,
		depthMs: 58.4,
		targetTicks: 3.46,
		jitterMs: 9.2,
		holds: 1,
		holding: false,
		catchingUp: false,
		fastForwarding: false,
		hitched: false,
		samples: 3,
		pending: 0,
		committed: 3,
		discarded: 0,
		position: 1,
		phase: 0.5,
		phaseLocked: true,
		phaseShiftTicks: 0,
		offsetSec: 0,
		targetOffsetSec: 0,
		baseSec: 0,
	};

	it("prints the window, the pacer and the leads", () => {
		const line = formatArrivalLine(window(), {
			pacing: stats,
			pacingOff: false,
			lead: 7,
			netLead: 3,
			misses: 2,
			backlog: 3,
			leadStats: LEAD_STATS,
			leadOff: false,
		});
		expect(line).toBe(
			"[Pace] 10.0s batches 3 ticks 7 · gap p50 33 p95 37 max 37 ms · sizes 2:2 3:1" +
				" · pace 4t 58ms target 3.5t jitter p95 9ms holds 1 discarded 0 · lead 7t net 3t miss 2 backlog 3" +
				" · fps 0.1 worst 17ms · trip p50 117 p95 150 max 183 ms · lead 12t target 12t" +
				" (base 11t cover 12t cap 16t) fall 12t · lates 9 bumps 0 falls 1",
		);
	});

	it("prints the lead's base, cover and ceiling: `cap off` without a ceiling (no prediction), '-' before a cover trip", () => {
		const info: ArrivalLineInfo = {
			...INFO_WAITING,
			leadStats: { ...LEAD_STATS, lead: 11, target: 11, ceiling: undefined, bumps: 3 },
			leadOff: false,
		};
		const tail = "lead 11t target 11t (base 11t cover 12t cap off) fall 12t · lates 9 bumps 3 falls 1";
		const line = formatArrivalLine(window(), info);
		expect(line.sub(-tail.size())).toBe(tail);
		const early = formatArrivalLine(window(), {
			...info,
			leadStats: { ...LEAD_STATS, coverP99: undefined, coverTarget: undefined },
		});
		expect(early.find("(base 11t cover - cap 16t)", 1, true)[0]).never.toBe(undefined);
	});

	it("says when the lead is not measured: the legacy counter, or KV_LeadOff", () => {
		const legacy = formatArrivalLine(window(), {
			...INFO_WAITING,
			leadStats: { ...LEAD_STATS, echoing: false },
			leadOff: false,
		});
		expect(legacy.sub(-"lead legacy".size())).toBe("lead legacy");
		expect(legacy.find("trip p50", 1, true)[0]).toBe(undefined);
		const off = formatArrivalLine(window(), INFO_WAITING);
		expect(off.sub(-"lead off (KV_LeadOff)".size())).toBe("lead off (KV_LeadOff)");
		// No trip measured yet while echoing: '-'.
		const empty = formatArrivalLine(window(), {
			...INFO_WAITING,
			leadStats: { ...LEAD_STATS, tripP50: undefined, tripP95: undefined, tripMax: undefined },
			leadOff: false,
		});
		expect(empty.find("trip p50 - p95 - max - ms", 1, true)[0]).never.toBe(undefined);
	});

	it("says when pacing is off or not started", () => {
		expect(
			formatArrivalLine(window(), { ...INFO_WAITING, pacingOff: true }).find(
				"pace off (KV_PacingOff)",
				1,
				true,
			)[0],
		).never.toBe(undefined);
		expect(formatArrivalLine(window(), INFO_WAITING).find("pace waiting", 1, true)[0]).never.toBe(undefined);
		const empty = new ArrivalLog().take(0);
		expect(
			formatArrivalLine(empty, INFO_WAITING).find("gap p50 - p95 - max - ms · sizes - ", 1, true)[0],
		).never.toBe(undefined);
	});
});
