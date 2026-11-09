// The input echo (docs/FRAME_PACING.md Design 9, FP9): the wire format (round trips, quantization, saturation,
// malformed buffers refused) and the server session's side: each player's lowest-slack input frame since the last
// broadcast (a batch's first frame; across batches the worse one), its slack (how many ticks before its deadline it arrived, the receipt placed inside the tick being finalized), late
// counts, once per broadcast, a stalled server's backlog never counted against the client, and inputStats totals.
import { describe, expect, it } from "@rbxts/jest-globals";
import { EMPTY_INPUT, SIM_HZ, type InputFrame } from "shared/sim";
import { DEFAULT_SEGMENT_LIMITS, SegmentedValidator, buildEndlessRunConfig } from "shared/run";
import {
	DEFAULT_LOCKSTEP,
	INPUT_ECHO_BYTES,
	INPUT_ECHO_SLACK_SCALE,
	LockstepSession,
	decodeInputEcho,
	encodeInputBatch,
	encodeInputEcho,
	type InputEcho,
	type MergedBroadcast,
} from "shared/lockstep";

const QUANTUM = 1 / INPUT_ECHO_SLACK_SCALE;

function roundTrip(echo: InputEcho | undefined, firstTick: number): InputEcho | undefined {
	const b = encodeInputEcho(echo, firstTick);
	expect(buffer.len(b)).toBe(INPUT_ECHO_BYTES);
	return decodeInputEcho(b, firstTick);
}

describe("input echo wire format", () => {
	it("round-trips none, ticks on either side of the batch, slack to 1/16 tick, lates", () => {
		expect(roundTrip(undefined, 100)).toEqual({ tick: undefined, slack: 0, lates: 0 });
		expect(roundTrip({ tick: undefined, slack: 0, lates: 3 }, 100)).toEqual({
			tick: undefined,
			slack: 0,
			lates: 3,
		});
		// A "none" echo carries no slack even if one was passed.
		expect(roundTrip({ tick: undefined, slack: 5, lates: 0 }, 100)).toEqual({
			tick: undefined,
			slack: 0,
			lates: 0,
		});
		expect(roundTrip({ tick: 130, slack: 4.5, lates: 0 }, 100)).toEqual({ tick: 130, slack: 4.5, lates: 0 });
		expect(roundTrip({ tick: 97, slack: -0.25, lates: 2 }, 100)).toEqual({ tick: 97, slack: -0.25, lates: 2 });
		expect(roundTrip({ tick: 0, slack: 1, lates: 0 }, 0)).toEqual({ tick: 0, slack: 1, lates: 0 });
		// Far ticks (i32 offsets).
		expect(roundTrip({ tick: 5, slack: 0, lates: 0 }, 200000)?.tick).toBe(5);
		expect(roundTrip({ tick: 400000, slack: 0, lates: 0 }, 3)?.tick).toBe(400000);
	});

	it("quantizes the slack to the nearest 1/16 tick and saturates it, and the lates at 255", () => {
		for (const s of [0.01, 0.03, 0.97, 2.3, -1.234, 7.77, -0.02]) {
			const got = roundTrip({ tick: 10, slack: s, lates: 0 }, 8)!.slack;
			expect(math.abs(got - s) <= QUANTUM / 2 + 1e-9).toBe(true);
			expect((got * INPUT_ECHO_SLACK_SCALE) % 1).toBe(0);
		}
		expect(roundTrip({ tick: 10, slack: 0.04, lates: 0 }, 8)!.slack).toBe(0.0625); // 0.64 / 16 -> 1 / 16
		expect(roundTrip({ tick: 10, slack: 0.03, lates: 0 }, 8)!.slack).toBe(0); // 0.48 / 16 -> 0
		const max = 32767 / INPUT_ECHO_SLACK_SCALE;
		const min = -32768 / INPUT_ECHO_SLACK_SCALE;
		expect(roundTrip({ tick: 10, slack: 1e6, lates: 0 }, 8)!.slack).toBe(max);
		expect(roundTrip({ tick: 10, slack: -1e6, lates: 0 }, 8)!.slack).toBe(min);
		expect(roundTrip({ tick: 10, slack: math.huge, lates: 0 }, 8)!.slack).toBe(max);
		expect(roundTrip({ tick: 10, slack: 0, lates: 255 }, 8)!.lates).toBe(255);
		expect(roundTrip({ tick: 10, slack: 0, lates: 1000 }, 8)!.lates).toBe(255);
		expect(roundTrip({ tick: undefined, slack: 0, lates: 1000 }, 8)!.lates).toBe(255);
	});

	it("carries the server's catching-up flag (bit 1), with or without a tick", () => {
		const e = decodeInputEcho(encodeInputEcho({ tick: 12, slack: -2, lates: 3, catchingUp: true }, 10), 10);
		expect(e).toEqual({ tick: 12, slack: -2, lates: 3, catchingUp: true });
		const none = decodeInputEcho(
			encodeInputEcho({ tick: undefined, slack: 0, lates: 0, catchingUp: true }, 10),
			10,
		);
		expect(none).toEqual({ tick: undefined, slack: 0, lates: 0, catchingUp: true });
		// Without the flag the field is absent (older echoes decode as before).
		expect(decodeInputEcho(encodeInputEcho({ tick: 12, slack: 1, lates: 0, catchingUp: false }, 10), 10)).toEqual({
			tick: 12,
			slack: 1,
			lates: 0,
		});
	});

	it("refuses a wrong size, a non-buffer, unknown flags, a none echo with offset or slack, a bad firstTick", () => {
		expect(decodeInputEcho(buffer.create(INPUT_ECHO_BYTES - 1), 0)).toBe(undefined);
		expect(decodeInputEcho(buffer.create(INPUT_ECHO_BYTES + 1), 0)).toBe(undefined);
		expect(decodeInputEcho(buffer.create(0), 0)).toBe(undefined);
		expect(decodeInputEcho("echo", 0)).toBe(undefined);
		expect(decodeInputEcho(undefined, 0)).toBe(undefined);
		expect(decodeInputEcho(8, 0)).toBe(undefined);
		expect(decodeInputEcho(buffer.create(INPUT_ECHO_BYTES), 0)).toEqual({ tick: undefined, slack: 0, lates: 0 });
		const flags = buffer.create(INPUT_ECHO_BYTES);
		buffer.writeu8(flags, 0, 4);
		expect(decodeInputEcho(flags, 0)).toBe(undefined);
		buffer.writeu8(flags, 0, 7);
		expect(decodeInputEcho(flags, 0)).toBe(undefined);
		buffer.writeu8(flags, 0, 0x80);
		expect(decodeInputEcho(flags, 0)).toBe(undefined);
		const offset = buffer.create(INPUT_ECHO_BYTES);
		buffer.writei32(offset, 1, 4);
		expect(decodeInputEcho(offset, 0)).toBe(undefined);
		const slack = buffer.create(INPUT_ECHO_BYTES);
		buffer.writei16(slack, 5, -1);
		expect(decodeInputEcho(slack, 0)).toBe(undefined);
		const good = encodeInputEcho({ tick: 12, slack: 1, lates: 0 }, 10);
		expect(decodeInputEcho(good, 0 / 0)).toBe(undefined);
		expect(decodeInputEcho(good, math.huge)).toBe(undefined);
	});
});

// ---------------------------------------------------------------------------------------------
// The session

const SEED = 4242;
const PLAYERS = 2;
const P0 = 1000;
const P1 = 1001;
/** The receipt can only be placed on a real-time tick position: the encoded slack is within this of the true one. */
const SLACK_TOLERANCE = QUANTUM / 2 + 1e-9;

function echoSession(): LockstepSession {
	const setup = buildEndlessRunConfig(SEED, PLAYERS);
	const validator = new SegmentedValidator({
		runId: "echo",
		seed: SEED,
		worldKind: "endless",
		setup,
		createdAt: 0,
		limits: DEFAULT_SEGMENT_LIMITS,
	});
	return new LockstepSession({
		runId: "echo",
		seed: SEED,
		spawn: setup.spawn!,
		members: [P0, P1],
		validator,
		startedAt: 0,
		tunables: { ...DEFAULT_LOCKSTEP, pacing: undefined },
	});
}

/** The session clock at real-time tick position `pos`. */
const at = (pos: number) => pos / SIM_HZ;

/** Steps the session until it finalized floor(pos) ticks, collecting the broadcasts. */
function advanceTo(s: LockstepSession, pos: number): MergedBroadcast[] {
	const out: MergedBroadcast[] = [];
	for (let guard = 0; guard < 1000 && s.finalizedTicks() < math.floor(pos); guard++) {
		for (const b of s.step(at(pos)).broadcasts) out.push(b);
	}
	expect(s.finalizedTicks()).toBe(math.floor(pos));
	return out;
}

function frames(n: number): InputFrame[] {
	const out: InputFrame[] = [];
	for (let k = 0; k < n; k++) out.push({ ...EMPTY_INPUT });
	return out;
}

/** Player `i`'s echo in the next broadcast (steps the session on until one goes out). */
function nextEcho(s: LockstepSession, i: number): InputEcho {
	for (let guard = 0; guard < 10; guard++) {
		const bs = advanceTo(s, s.finalizedTicks() + 1.5);
		if (bs.size() > 0) {
			const b = bs[0];
			expect(b.echoes.size()).toBe(PLAYERS);
			return decodeInputEcho(b.echoes[i], b.firstTick)!;
		}
	}
	error("no broadcast", 0);
}

describe("LockstepSession input echo", () => {
	it("an input sent k ticks before its deadline echoes slack k (to 1/16 tick, the receipt inside its tick)", () => {
		const s = echoSession();
		advanceTo(s, 10.5);
		expect(s.finalizedTicks()).toBe(10);
		for (const k of [1, 3, 6, 12]) {
			const base = s.finalizedTicks();
			const pos = base + 0.3;
			// A two-frame batch whose first tick X (its lowest slack) is k ticks past the tick being finalized:
			// X + 1 - pos = k + 0.7.
			const x = base + k;
			expect(s.submitInput(P0, x, encodeInputBatch(frames(2)), at(pos))?.accepted).toBe(2);
			const e = nextEcho(s, 0);
			expect(e.tick).toBe(x);
			expect(math.abs(e.slack - (x + 1 - pos)) <= SLACK_TOLERANCE).toBe(true);
			expect(e.lates).toBe(0);
		}
	});

	it("without `now` the receipt is finalizedTicks(): slack = X + 1 - finalizedTicks()", () => {
		const s = echoSession();
		advanceTo(s, 4.5);
		s.submitInput(P1, 9, encodeInputBatch(frames(1)));
		const e = nextEcho(s, 1);
		expect(e.tick).toBe(9);
		expect(e.slack).toBe(6);
		expect(nextEcho(s, 0)).toEqual({ tick: undefined, slack: 0, lates: 0 });
	});

	it("a late input echoes slack <= 0 and its late frames; the window keeps the lowest slack, the lates add up", () => {
		const s = echoSession();
		advanceTo(s, 10.5);
		const late = s.submitInput(P0, 8, encodeInputBatch(frames(2)), at(10.5));
		expect(late).toEqual({ accepted: 0, late: 2, refused: 0 });
		const e = nextEcho(s, 0);
		expect(e.tick).toBe(8);
		expect(math.abs(e.slack - (8 + 1 - 10.5)) <= SLACK_TOLERANCE).toBe(true);
		expect(e.lates).toBe(2);

		const base = s.finalizedTicks();
		s.submitInput(P0, base - 2, encodeInputBatch(frames(1)), at(base + 0.5)); // late, slack -1.5
		s.submitInput(P0, base - 1, encodeInputBatch(frames(3)), at(base + 0.5)); // 1 late, 2 on time, slack -0.5
		const e2 = nextEcho(s, 0);
		expect(e2.tick).toBe(base - 2);
		expect(math.abs(e2.slack + 1.5) <= SLACK_TOLERANCE).toBe(true);
		expect(e2.lates).toBe(2);
	});

	it("two batches in one echo window echo the worse one, whichever arrived first", () => {
		const s = echoSession();
		advanceTo(s, 10.5);
		const base = s.finalizedTicks();
		// Sent at a lead that fell: the later batch has the lower slack (base + 3 + 1 - (base + 0.8) = 3.2 < 4.7).
		s.submitInput(P0, base + 4, encodeInputBatch(frames(1)), at(base + 0.3)); // slack 4.7
		s.submitInput(P0, base + 3, encodeInputBatch(frames(2)), at(base + 0.8)); // slack 3.2
		const e = nextEcho(s, 0);
		expect(e.tick).toBe(base + 3);
		expect(math.abs(e.slack - 3.2) <= SLACK_TOLERANCE).toBe(true);
		// The worse one first: a later, better batch does not replace it.
		const b2 = s.finalizedTicks();
		s.submitInput(P0, b2 + 2, encodeInputBatch(frames(1)), at(b2 + 0.5)); // slack 2.5
		s.submitInput(P0, b2 + 6, encodeInputBatch(frames(1)), at(b2 + 0.6)); // slack 6.4
		const e2 = nextEcho(s, 0);
		expect(e2.tick).toBe(b2 + 2);
		expect(math.abs(e2.slack - 2.5) <= SLACK_TOLERANCE).toBe(true);
		expect(e2.lates).toBe(0);
	});

	it("goes into the next broadcast only once; a player with nothing new gets none", () => {
		const s = echoSession();
		advanceTo(s, 6.5);
		s.submitInput(P0, 12, encodeInputBatch(frames(1)), at(6.5));
		const bs = advanceTo(s, 8.5);
		expect(bs.size()).toBe(1);
		const first = bs[0];
		expect(decodeInputEcho(first.echoes[0], first.firstTick)?.tick).toBe(12);
		expect(decodeInputEcho(first.echoes[1], first.firstTick)).toEqual({ tick: undefined, slack: 0, lates: 0 });
		expect(nextEcho(s, 0)).toEqual({ tick: undefined, slack: 0, lates: 0 });
	});

	it("a stalled server (now 3 s ahead, catch-up capped) still echoes positive slack for inputs ahead of finalizedTicks()", () => {
		const s = echoSession();
		advanceTo(s, 10.2);
		const later = at(10.2) + 3;
		// Received before the server steps again: finalized is 10, the real-time position 190.
		s.submitInput(P0, 15, encodeInputBatch(frames(1)), later);
		const out = s.step(later);
		expect(s.finalizedTicks()).toBe(10 + DEFAULT_LOCKSTEP.maxTicksPerStep);
		expect(out.broadcasts.size()).toBe(1);
		const b = out.broadcasts[0];
		const e = decodeInputEcho(b.echoes[0], b.firstTick)!;
		expect(e.tick).toBe(15);
		expect(e.slack).toBe(5); // 15 + 1 - (10 + 1)
		expect(e.lates).toBe(0);
		expect(e.catchingUp).toBe(true); // the step was capped: the window overlapped the catch-up
		// And after that step, an input ahead of the new finalizedTicks() (15) is still early.
		s.submitInput(P0, 20, encodeInputBatch(frames(1)), later);
		const out2 = s.step(later);
		const b2 = out2.broadcasts[0];
		const e2 = decodeInputEcho(b2.echoes[0], b2.firstTick)!;
		expect(e2.tick).toBe(20);
		expect(e2.slack).toBe(5); // 20 + 1 - (15 + 1)
	});

	it("flags catching up: a capped step's window, a receipt far behind real time, a batch from the backlog's tail", () => {
		const s = echoSession();
		// Real time one tick a step (no capped step yet).
		for (let p = 1; p <= 10; p++) s.step(at(p + 0.5));
		expect(s.finalizedTicks()).toBe(10);
		// An ordinary window: no flag.
		s.submitInput(P0, 14, encodeInputBatch(frames(1)), at(10.5));
		expect(nextEcho(s, 0).catchingUp).toBe(undefined);
		// The server stalls 1 s and catches up at maxTicksPerStep a step.
		const pos = s.finalizedTicks() + SIM_HZ;
		const later = at(pos);
		let through = s.finalizedTicks();
		for (let guard = 0; guard < 100 && s.finalizedTicks() < pos; guard++) {
			// A capped step: more due than maxTicksPerStep.
			const capped = pos - s.finalizedTicks() > DEFAULT_LOCKSTEP.maxTicksPerStep;
			s.step(later);
			if (capped) through = s.finalizedTicks();
		}
		// Caught up; a batch sent from the backlog (first tick within the tail of the last capped step's tick): flagged.
		s.submitInput(P0, through + DEFAULT_LOCKSTEP.echoCatchUpTailTicks, encodeInputBatch(frames(1)), later);
		expect(nextEcho(s, 0).catchingUp).toBe(true);
		// Past the tail: an ordinary echo again.
		s.submitInput(P0, through + DEFAULT_LOCKSTEP.echoCatchUpTailTicks + 1, encodeInputBatch(frames(1)), later);
		const e = nextEcho(s, 0);
		expect(e.catchingUp).toBe(undefined);
	});

	it("a malformed, refused or non-member batch records nothing", () => {
		const s = echoSession();
		advanceTo(s, 4.5);
		expect(s.submitInput(P0, 8, "garbage", at(4.5))).toEqual({ accepted: 0, late: 0, refused: 1 });
		expect(s.submitInput(P0, 8, buffer.create(3), at(4.5))?.refused).toBe(1);
		const tooFar = s.finalizedTicks() + DEFAULT_LOCKSTEP.maxInputAhead + 1;
		expect(s.submitInput(P0, tooFar, encodeInputBatch(frames(1)), at(4.5))).toEqual({
			accepted: 0,
			late: 0,
			refused: 1,
		});
		expect(s.submitInput(P0, -1, encodeInputBatch(frames(1)), at(4.5))).toBe(undefined);
		expect(s.submitInput(9999, 8, encodeInputBatch(frames(1)), at(4.5))).toBe(undefined);
		expect(nextEcho(s, 0)).toEqual({ tick: undefined, slack: 0, lates: 0 });
		expect(s.inputStats(0)).toEqual({ samples: 0, lates: 0, slackMin: 0, slackMean: 0 });
		expect(s.inputStats(PLAYERS)).toEqual({ samples: 0, lates: 0, slackMin: 0, slackMean: 0 });
	});

	it("inputStats totals every recorded batch over the run (samples, lates, min and mean slack)", () => {
		const s = echoSession();
		advanceTo(s, 10);
		s.submitInput(P1, 13, encodeInputBatch(frames(1))); // slack 4
		s.submitInput(P1, 11, encodeInputBatch(frames(1))); // slack 2 (replaces the echo, both counted)
		s.submitInput(P1, 8, encodeInputBatch(frames(2))); // late 2, slack -1 (its first frame's)
		advanceTo(s, 20);
		s.submitInput(P1, 25, encodeInputBatch(frames(1))); // slack 6
		const st = s.inputStats(1);
		expect(st.samples).toBe(4);
		expect(st.lates).toBe(2);
		expect(st.slackMin).toBe(-1);
		expect(st.slackMean).toBe(2.75);
		expect(s.inputStats(0).samples).toBe(0);
	});
});
