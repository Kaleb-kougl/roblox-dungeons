// The rollback spike's summary intake (docs/ROLLBACK_SPIKE.md R4, RollbackProbeIntake): the gate, the rate limits
// before any reading or logging (refused payloads print a bounded number of warnings), session ids bound to their
// first player, one row per player per minute at most (server-made keys, capped per row), and the analytics budget.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ROLLBACK_ANALYTICS_LIVE_METRICS,
	ROLLBACK_ANALYTICS_RATE,
	ROLLBACK_PROBE_RATE,
	ROLLBACK_PROBE_ROWS,
	ROLLBACK_PROBE_ROW_VERSION,
	RollbackProbeIntake,
} from ".";

const SESSION = "0f8e2a6c-1d3b-4c5e-9a7f-112233445566";
const OTHER_SESSION = "11111111-1d3b-4c5e-9a7f-112233445566";
const CTX = { unixTime: 1767225600, placeVersion: 7 };

function stat(p50: number, p95: number, max: number) {
	return { p50, p95, max };
}

function cpu(sessionId = SESSION, windowIndex = 0): Record<string, unknown> {
	return {
		sessionId,
		windowIndex,
		mode: "parallel",
		horizon: 16,
		case: "room",
		partySize: 2,
		actors: 10,
		enemyBullets: 20,
		clone: stat(1, 1, 1),
		step: stat(2, 2, 2),
		send: stat(0, 0, 0),
		total: stat(3, 3, 3),
		digest: stat(0, 0, 0),
		framesPerPrediction: stat(1, 1, 1),
		live: stat(0, 0, 0),
		liveSamples: 0,
		samples: 600,
		windowSeconds: 10,
		renderFps: 60,
		frameMsP95: 17,
		gcKbPerSec: 0,
		native: false,
		deviceLabel: "kb 1920x1080",
		deviceClass: "pc",
	};
}

function live(sessionId = SESSION, windowIndex = 0): Record<string, unknown> {
	return {
		sessionId,
		windowIndex,
		strategy: "repeatLast",
		horizon: 16,
		partySize: 2,
		playerIndex: 0,
		seconds: 60,
		predictions: 3500,
		mainFrames: 3600,
		lead: { lMean: 11, lMax: 12, dMean: 4, dMax: 5 },
		rooms: { combat: { seconds: 60, counts: { undoneKill: 2 } } },
		deviceLabel: "kb 1920x1080",
		deviceClass: "pc",
	};
}

function newIntake(): RollbackProbeIntake<number> {
	let n = 0;
	return new RollbackProbeIntake<number>(() => `writer-${++n}`);
}

describe("RollbackProbeIntake", () => {
	it("takes an allowed player's summaries: a log line and the analytics of each", () => {
		const intake = newIntake();
		const a = intake.take(1, 101, true, "cpu", cpu(), 0);
		expect(a.taken).toBe(true);
		if (a.taken) {
			expect(a.kind).toBe("cpu");
			expect(a.analytics.size()).toBe(1);
			expect(string.find(a.line, "101 ", 1, true)[0]).toBe(1);
		}
		const b = intake.take(1, 101, true, "live", live(), 1);
		expect(b.taken && b.analytics.size()).toBe(ROLLBACK_ANALYTICS_LIVE_METRICS.size());
		expect(intake.buffered()).toBe(2);
	});

	it("refuses a player the gate does not allow, and bounds every refused path's warnings", () => {
		const intake = newIntake();
		const warned = (out: ReturnType<RollbackProbeIntake<number>["take"]>) => !out.taken && out.warn !== undefined;
		let warnings = 0;
		for (let i = 0; i < 20; i++) if (warned(intake.take(1, 101, false, "cpu", cpu(), i))) warnings++;
		expect(warnings).toBe(ROLLBACK_PROBE_RATE.refused.count);
		expect(intake.buffered()).toBe(0);
		// Unknown kinds and malformed payloads share the same bounded warnings (a new player, a new budget).
		warnings = 0;
		for (let i = 0; i < 10; i++) if (warned(intake.take(2, 102, true, `junk${i}`, undefined, i))) warnings++;
		for (let i = 0; i < 10; i++) if (warned(intake.take(2, 102, true, "cpu", { sessionId: 1 }, i))) warnings++;
		expect(warnings).toBe(ROLLBACK_PROBE_RATE.refused.count);
		// After the window the budget is back.
		expect(warned(intake.take(2, 102, true, "gpu", undefined, 1000))).toBe(true);
	});

	it("rate-limits per kind before reading", () => {
		const intake = newIntake();
		let taken = 0;
		for (let i = 0; i < 30; i++) if (intake.take(1, 101, true, "cpu", cpu(SESSION, i), i).taken) taken++;
		expect(taken).toBe(ROLLBACK_PROBE_RATE.cpu.count);
		taken = 0;
		for (let i = 0; i < 10; i++) if (intake.take(1, 101, true, "live", live(SESSION, i), i).taken) taken++;
		expect(taken).toBe(ROLLBACK_PROBE_RATE.live.count);
	});

	it("binds a session id to its first player", () => {
		const intake = newIntake();
		expect(intake.take(1, 101, true, "cpu", cpu(SESSION), 0).taken).toBe(true);
		const stolen = intake.take(2, 202, true, "cpu", cpu(SESSION, 1), 0);
		expect(stolen.taken).toBe(false);
		expect(!stolen.taken && stolen.warn !== undefined).toBe(true);
		expect(intake.take(2, 202, true, "live", live(SESSION), 0).taken).toBe(false);
		expect(intake.take(2, 202, true, "cpu", cpu(OTHER_SESSION), 0).taken).toBe(true);
		// Still refused after the owner left (rows are server-keyed anyway).
		intake.takeRow(1, CTX);
		expect(intake.take(2, 202, true, "cpu", cpu(SESSION, 2), 1).taken).toBe(false);
	});

	it("writes one row per player per minute, keyed by the server's writer id, capped per row", () => {
		const intake = newIntake();
		const every = ROLLBACK_PROBE_ROWS.writeEverySeconds;
		// Summaries every 10 s over 5 minutes (cpu) and every 60 s (live); rows polled every 5 s.
		const rows: Array<{ at: number; key: string; cpu: number; live: number }> = [];
		for (let t = 0; t <= 300; t += 5) {
			if (t % 10 === 0) intake.take(1, 101, true, "cpu", cpu(SESSION, t / 10), t);
			if (t % 60 === 0) intake.take(1, 101, true, "live", live(SESSION, t / 60), t);
			for (const r of intake.dueRows(t, CTX)) {
				expect(r.userId).toBe(101);
				expect(r.row.v).toBe(ROLLBACK_PROBE_ROW_VERSION);
				rows.push({ at: t, key: r.key, cpu: r.row.cpu.size(), live: r.row.live.size() });
			}
		}
		expect(rows.size()).toBe(4);
		for (let i = 0; i < rows.size(); i++) {
			expect(rows[i].key).toBe(`writer-1/${i}`);
			if (i > 0) expect(rows[i].at - rows[i - 1].at >= every).toBe(true);
		}
		let total = 0;
		for (const r of rows) total += r.cpu;
		const last = intake.takeRow(1, CTX);
		expect(last !== undefined).toBe(true);
		total += last?.row.cpu.size() ?? 0;
		expect(total).toBe(31);
		// A second player has their own writer id; `all` flushes every buffer (the server closing).
		intake.take(2, 202, true, "cpu", cpu(OTHER_SESSION), 400);
		const closing = intake.dueRows(400, CTX, true);
		expect(closing.size()).toBe(1);
		expect(closing[0].key).toBe("writer-2/0");
		expect(intake.buffered()).toBe(0);
		// The cap: more summaries than maxPerRow in one row are dropped and counted (rate limits allow 12 a minute,
		// so this needs several minutes buffered: a row is only written when polled).
		const capped = newIntake();
		for (let t = 0; t < 600; t += 5) capped.take(1, 101, true, "cpu", cpu(SESSION, t / 5), t);
		const r = capped.dueRows(600, CTX)[0];
		expect(r.row.cpu.size()).toBe(ROLLBACK_PROBE_ROWS.maxPerRow.cpu);
		expect(r.row.dropped > 0).toBe(true);
	});

	it("keeps analytics within the per-player budget, a summary's events whole or none", () => {
		const intake = newIntake();
		let events = 0;
		for (let t = 0; t < 60; t += 2) {
			const out = intake.take(1, 101, true, "cpu", cpu(SESSION, t), t);
			if (out.taken) events += out.analytics.size();
		}
		expect(events).toBe(ROLLBACK_ANALYTICS_RATE.cpu.count);
		let liveEvents = 0;
		for (let t = 0; t < 60; t += 15) {
			const out = intake.take(1, 101, true, "live", live(SESSION, t), t);
			if (out.taken) {
				expect(
					out.analytics.size() === 0 || out.analytics.size() === ROLLBACK_ANALYTICS_LIVE_METRICS.size(),
				).toBe(true);
				liveEvents += out.analytics.size();
			}
		}
		expect(liveEvents).toBe(ROLLBACK_ANALYTICS_RATE.live.count * ROLLBACK_ANALYTICS_LIVE_METRICS.size());
		// At most 7 + 2 x 4 = 15 events in any minute per player.
		expect(events + liveEvents).toBe(15);
	});
});
