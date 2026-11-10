// M4 lockstep: the relay (deadlines -> repeat last, late / ahead / invalid inputs, leavers, debug bits), the wire
// formats, the hash ledger (agreement, desync, stalls), and whole co-op runs over a simulated network with random
// latency and jitter: every client reaches the identical state, the merged log the server broadcast is exactly what
// they stepped, the server's own segmented replay of that log validates to the clients' hash and score; a client
// that diverges is caught at the next hash report; leavers and stalled clients are dropped without breaking the run.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AXIS_MAX,
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	PARTY_LEFT_BUTTON,
	Rng,
	SIM_HZ,
	createSimState,
	hashState,
	inputsEqual,
	isPartyWiped,
	playerAt,
	stepParty,
	type InputFrame,
	type SimState,
} from "shared/sim";
import {
	DEFAULT_SEGMENT_LIMITS,
	SegmentedValidator,
	SlidingWindowLimiter,
	buildEndlessRunConfig,
	type RunFinal,
	type SegmentLimits,
	type SegmentedRunResult,
} from "shared/run";
import {
	DEFAULT_LOCKSTEP,
	HASH_REPORT_TIMEOUT_TICKS,
	HashLedger,
	INPUT_FRAME_BYTES,
	LEFT_FRAME,
	LEAD,
	LOCKSTEP_HASH_RATE,
	LOCKSTEP_INPUT_RATE,
	LockstepClient,
	LockstepRelay,
	LockstepSession,
	MergedDecoder,
	MergedEncoder,
	PACING,
	PREDICTION,
	decodeInputBatch,
	decodeInputEcho,
	encodeInputBatch,
	encodeInputEcho,
	nearestRank,
	outliersOf,
	type LeadStats,
	type LockstepStepResult,
	type LockstepTunables,
} from "shared/lockstep";
import { HitstopClock, simPacerFor } from "shared/view/fx";

function f(moveX: number, buttons = 0, aimX = 0): InputFrame {
	return { moveX, moveZ: 0, aimX, aimZ: 0, buttons };
}

const H = (n: number) => string.format("%08x", n);

describe("LockstepRelay", () => {
	it("an input that misses its deadline repeats the player's last finalized input", () => {
		const r = new LockstepRelay(2);
		r.submit(0, 0, [f(100), f(200)]);
		r.submit(1, 1, [f(-5)]);
		const t0 = r.finalizeNext();
		expect([t0[0].moveX, t0[1].moveX]).toEqual([100, 0]); // player 1 had nothing for tick 0: EMPTY_INPUT
		const t1 = r.finalizeNext();
		expect([t1[0].moveX, t1[1].moveX]).toEqual([200, -5]);
		const t2 = r.finalizeNext();
		expect([t2[0].moveX, t2[1].moveX]).toEqual([200, -5]); // both missed tick 2: repeats
		expect(r.getStats().missed).toEqual([1, 2]);
		expect(r.finalizedTicks()).toBe(3);
	});

	it("late inputs are dropped, too-early ones refused, the latest submit for a tick wins, order does not matter", () => {
		const r = new LockstepRelay(1);
		r.finalizeNext();
		r.finalizeNext();
		const late = r.submit(0, 0, [f(1), f(2), f(3)]);
		expect([late.accepted, late.late, late.refused]).toEqual([1, 2, 0]);
		r.submit(0, 5, [f(50)]);
		r.submit(0, 3, [f(30), f(40)]);
		r.submit(0, 2, [f(33)]); // replaces the 3 queued for tick 2
		const ahead = r.submit(0, 2 + DEFAULT_LOCKSTEP.maxInputAhead + 1, [f(9)]);
		expect(ahead.refused).toBe(1);
		const got: number[] = [];
		for (let t = 2; t < 7; t++) got.push(r.finalizeNext()[0].moveX);
		expect(got).toEqual([33, 30, 40, 50, 50]);
	});

	it("refuses invalid frames and strips debug bits unless allowed", () => {
		const r = new LockstepRelay(1);
		const bad = r.submit(0, 0, [{ ...EMPTY_INPUT, moveX: AXIS_MAX + 1 }, f(0, PARTY_LEFT_BUTTON), f(0, 1 << 20)]);
		expect(bad.refused).toBe(3);
		r.submit(0, 0, [f(0, bit32.bor(Button.FIRE, Button.DEBUG_HIT, DEBUG_FLOOR_BUTTON))]);
		expect(r.finalizeNext()[0].buttons).toBe(Button.FIRE);
		const dbg = new LockstepRelay(1, { ...DEFAULT_LOCKSTEP, allowDebugInput: true });
		dbg.submit(0, 0, [f(0, bit32.bor(Button.FIRE, Button.DEBUG_HIT))]);
		expect(dbg.finalizeNext()[0].buttons).toBe(bit32.bor(Button.FIRE, Button.DEBUG_HIT));
	});

	it("a leaver sends the leave bit alone from the next tick on, forever; their queued inputs are dropped", () => {
		const r = new LockstepRelay(3);
		r.submit(1, 0, [f(1), f(2), f(3), f(4)]);
		r.finalizeNext();
		r.leave(1);
		expect(r.isPresent(1)).toBe(false);
		expect(r.presentCount()).toBe(2);
		expect(r.leftFromTick(1)).toBe(1);
		for (let t = 1; t < 5; t++) expect(r.finalizeNext()[1]).toEqual({ ...LEFT_FRAME });
		expect(r.submit(1, 6, [f(5)]).refused).toBe(1);
	});
});

describe("wire formats", () => {
	it("input batches round-trip; ragged, oversized or out-of-range buffers are refused", () => {
		const frames = [f(1000, Button.FIRE, -1000), { moveX: -7, moveZ: 3, aimX: 0, aimZ: 999, buttons: 16383 }];
		const buf = encodeInputBatch(frames);
		expect(buffer.len(buf)).toBe(2 * INPUT_FRAME_BYTES);
		expect(decodeInputBatch(buf, 10)).toEqual(frames);
		expect(decodeInputBatch(buf, 1)).toBe(undefined);
		expect(decodeInputBatch(buffer.create(7), 10)).toBe(undefined);
		expect(decodeInputBatch("nope", 10)).toBe(undefined);
		const over = encodeInputBatch([f(0)]);
		buffer.writei16(over, 0, AXIS_MAX + 1);
		expect(decodeInputBatch(over, 10)).toBe(undefined);
		expect(decodeInputBatch(encodeInputBatch([f(0, PARTY_LEFT_BUTTON)]), 10)).toBe(undefined);
	});

	it("merged batches round-trip across batches (per-player deltas); a malformed one changes nothing", () => {
		const enc = new MergedEncoder(3);
		const dec = new MergedDecoder(3);
		const rng = new Rng(9);
		const all: InputFrame[][] = [];
		for (let b = 0; b < 20; b++) {
			const ticks: InputFrame[][] = [];
			for (let t = 0; t < 1 + (b % 3); t++) {
				const row: InputFrame[] = [];
				for (let i = 0; i < 3; i++) {
					row.push(
						rng.next() < 0.5
							? { ...(all[all.size() - 1]?.[i] ?? EMPTY_INPUT) }
							: {
									moveX: rng.int(-AXIS_MAX, AXIS_MAX),
									moveZ: rng.int(-AXIS_MAX, AXIS_MAX),
									aimX: 0,
									aimZ: rng.int(-AXIS_MAX, AXIS_MAX),
									buttons: i === 2 && b > 15 ? PARTY_LEFT_BUTTON : rng.int(0, 15),
							  },
					);
				}
				ticks.push(row);
				all.push(row);
			}
			const buf = enc.encode(ticks);
			if (b === 7) {
				expect(dec.decode(buffer.create(1))).toBe(undefined); // garbage between two good batches
				const cut = buffer.create(buffer.len(buf) - 1);
				buffer.copy(cut, 0, buf, 0, buffer.len(buf) - 1);
				expect(dec.decode(cut)).toBe(undefined);
			}
			expect(dec.decode(buf)).toEqual(ticks);
		}
		// Idle players cost one byte per tick.
		const idle = new MergedEncoder(8).encode([[...new Array<InputFrame>(8, EMPTY_INPUT)]]);
		expect(buffer.len(idle)).toBe(2 + 8);
	});
});

describe("HashLedger", () => {
	const all = () => true;

	it("agrees ticks in order once every present player reported", () => {
		const l = new HashLedger(3, 60, 600);
		expect(l.report(0, 60, H(1))).toBe(undefined);
		expect(l.report(1, 60, H(1))).toBe(undefined);
		expect(l.decide(all, 200).agreed.size()).toBe(0);
		l.report(2, 120, H(2));
		l.report(2, 60, H(1));
		const d = l.decide(all, 200);
		expect(d.agreed).toEqual([{ tick: 60, hash: H(1) }]);
		expect(l.consensus(60)).toBe(H(1));
		expect(l.decidedThrough()).toBe(60);
		expect(l.report(0, 60, H(1))).toBe("already_decided");
		expect(l.report(0, 61, H(1))).toBe("bad_tick");
		expect(l.report(0, 120, "xyz")).toBe("bad_hash");
		expect(l.report(2, 120, H(2))).toBe("duplicate");
	});

	it("a disagreement is a desync at that tick, with the odd one out", () => {
		const l = new HashLedger(3, 60, 600);
		for (const i of [0, 1, 2]) l.report(i, 60, H(1));
		l.report(0, 120, H(2));
		l.report(1, 120, H(3));
		l.report(2, 120, H(2));
		const d = l.decide(all, 500);
		expect(d.agreed.size()).toBe(1);
		expect(d.desync?.tick).toBe(120);
		expect(d.desync?.outliers).toEqual([1]);
		expect(outliersOf([H(1), H(2)])).toEqual([0, 1]); // two players: no majority
		expect(outliersOf([H(1), "", H(1)])).toEqual([]);
	});

	it("decides no tick past `through` (a claimed final), but stall detection keeps the real clock", () => {
		const l = new HashLedger(2, 60, 100);
		for (const t of [60, 120]) {
			l.report(0, t, H(t));
			l.report(1, t, H(t));
		}
		expect(l.decide(all, 500, 90).agreed).toEqual([{ tick: 60, hash: H(60) }]);
		expect(l.decidedThrough()).toBe(60);
		l.report(0, 180, H(180));
		expect(l.decide(all, 500, 200).stalled).toEqual([1]); // 180 + 100 <= 500
	});

	it("a silent player is stalled after the timeout; leavers do not count", () => {
		const l = new HashLedger(3, 60, 100);
		l.report(0, 60, H(1));
		l.report(1, 60, H(1));
		expect(l.decide(all, 159).stalled).toEqual([]);
		expect(l.decide(all, 160).stalled).toEqual([2]);
		const d = l.decide((i) => i !== 2, 160);
		expect(d.agreed).toEqual([{ tick: 60, hash: H(1) }]);
	});
});

// ---------------------------------------------------------------------------------------------
// Whole runs over a simulated network

const SEED = 31337;
/** Channel i's latencies come from seeds NET_CHANNEL_SEED + 2i (down) and + 2i + 1 (up). */
const NET_CHANNEL_SEED = 7;
const DT = 1 / 60;

interface Message {
	readonly at: number;
	readonly deliver: () => void;
}

/**
 * Scheduled network trouble on a Channel (docs/FRAME_PACING.md FP12), on the simulated clock (seconds): a latency spike
 * (`extra` seconds more for every message sent in [at, at + sec)) and a head-of-line hold (nothing delivered in
 * [at, at + sec), then everything due in order, as one lost packet holds a reliable stream).
 */
interface ChannelEvents {
	readonly spike?: { readonly at: number; readonly sec: number; readonly extra: number };
	readonly hold?: { readonly at: number; readonly sec: number };
}

/**
 * One-way FIFO channel with random latency (in seconds); order is kept like a RemoteEvent's. The latency is drawn once
 * per DT of the simulated clock from the channel's own generator, so two runs over channels with the same seed see the
 * same network at the same times, whatever (and however much) they send. `events` adds a scheduled spike / hold on top
 * (the draws stay the same).
 */
class Channel {
	private readonly queue: Message[] = [];
	private readonly latencies: number[] = [];
	private readonly rng: Rng;
	private last = 0;
	constructor(
		seed: number,
		private readonly minLatency: number,
		private readonly maxLatency: number,
		private readonly events: ChannelEvents = {},
	) {
		this.rng = new Rng(seed);
	}

	private latencyAt(now: number): number {
		const slot = math.max(0, math.floor(now / DT + 0.5));
		while (this.latencies.size() <= slot) {
			this.latencies.push(this.minLatency + (this.maxLatency - this.minLatency) * this.rng.next());
		}
		const spike = this.events.spike;
		const extra = spike !== undefined && now >= spike.at && now < spike.at + spike.sec ? spike.extra : 0;
		return this.latencies[slot] + extra;
	}

	send(now: number, deliver: () => void): void {
		const at = math.max(this.last, now + this.latencyAt(now));
		this.last = at;
		this.queue.push({ at, deliver });
	}

	pump(now: number): void {
		const hold = this.events.hold;
		if (hold !== undefined && now >= hold.at && now < hold.at + hold.sec) return;
		while (this.queue.size() > 0 && this.queue[0].at <= now) this.queue.remove(0)!.deliver();
	}
}

/** Frames per second the Net harness renders at by default (DT). */
const NET_FPS = 60;
// No pacing and the legacy lead: these specs assert today's stepping (every received frame at once) and today's miss
// counter; Net's `pacing` and `measured` options turn them on.
const TUNABLES: LockstepTunables = {
	...DEFAULT_LOCKSTEP,
	segmentTicks: 240,
	checkpointEvery: 120,
	reportTimeoutTicks: 600,
	finalTimeoutTicks: 600,
	allowDebugInput: true,
	pacing: undefined,
	lead: undefined,
	prediction: undefined,
};
const SEG_LIMITS: SegmentLimits = { ...DEFAULT_SEGMENT_LIMITS, checkpointEvery: 120, allowDebugInput: true };

interface NetOptions {
	readonly players: number;
	readonly latency: readonly [number, number];
	/** Called on every frame before the clients pump (sabotage, leaving, freezing). */
	readonly onFrame?: (net: Net, frame: number) => void;
	readonly maxFrames?: number;
	readonly tunables?: LockstepTunables;
	/** Return true to lose this hash call of player `i` on the way up (a dropped remote). */
	readonly dropHashCall?: (i: number, ticks: ReadonlyArray<number>) => boolean;
	/**
	 * Frame pacing (docs/FRAME_PACING.md FP4): the clients get `PACING` and the simulated clock on `receive` (at
	 * delivery) and `pump`. Off by default: every client steps each received frame at once, as before.
	 */
	readonly pacing?: boolean;
	/** The rendered frame rate (default NET_FPS); maxFrames defaults to 120 s of frames at it. */
	readonly fps?: number;
	/**
	 * A server stall (a long Heartbeat, the server's GC): from `at` for `sec` seconds the session neither steps nor
	 * handles remotes (inputs and hashes queue up on the way); it then catches up at maxTicksPerStep per step.
	 */
	readonly serverStall?: { readonly at: number; readonly sec: number };
	/**
	 * The measured lead (docs/FRAME_PACING.md Revision 2, FP11): the clients get `LEAD` (unless `tunables.lead` sets
	 * other values), their own input echo and the simulated clock on `receive` and `pump`. Off by default: the legacy
	 * miss counter (TUNABLES' lead: undefined), as before.
	 */
	readonly measured?: boolean;
	/** Scheduled trouble on every client's up (client -> server) / down channel (FP12). */
	readonly upEvents?: ChannelEvents;
	readonly downEvents?: ChannelEvents;
	/**
	 * The stage cover (docs/STAGE_LOADER.md SL7): the bots send neutral input while their client's state.tick is below
	 * this many seconds of ticks, as the real client does under the run start's cover. 0 by default (as before).
	 */
	readonly coverSec?: number;
	/** The bots never press the debug hit (K): the party lives until maxFrames (FP12's spikes). */
	readonly harmless?: boolean;
	/** Client `client`'s echoes are not delivered from `at` for `sec` seconds (an old server's silence; review fix 5c). */
	readonly echoOff?: { readonly client: number; readonly at: number; readonly sec: number };
}

/** The first ticks of a run are its warm-up for the lead's numbers (FP11): no trip is measured yet. */
const LEAD_WARMUP_SEC = 2;
const LEAD_WARMUP_TICKS = LEAD_WARMUP_SEC * SIM_HZ;
/** The measured lead and its oracle are sampled every this many frames. */
const ORACLE_EVERY_FRAMES = 6;
/** Absorbs float rounding in the oracle's ceil (as lead.ts). */
const ORACLE_EPSILON = 1e-9;
const MS_PER_SEC = 1000;
/** An OracleTrace sample with no trip in the window (a lead is never negative). */
const NO_ORACLE = -1;

/**
 * Ground-truth net trips (ticks) by the server clock at receipt, oldest first, and the oracle lead over the last
 * `windowSec` of them: clamp(ceil(nearest-rank `percentile` + marginTicks)), the LeadController's target rule.
 */
class TripWindow {
	readonly at: number[] = [];
	readonly trip: number[] = [];
	private from = 0;
	private readonly scratch: number[] = [];

	push(at: number, trip: number): void {
		this.at.push(at);
		this.trip.push(trip);
	}

	oracle(now: number, t: LockstepTunables): number {
		const lead = t.lead ?? LEAD;
		while (this.from < this.at.size() && this.at[this.from] <= now - lead.windowSec) this.from++;
		const scratch = this.scratch;
		scratch.clear();
		for (let k = this.from; k < this.trip.size(); k++) scratch.push(this.trip[k]);
		if (scratch.size() === 0) return NO_ORACLE;
		scratch.sort((a, b) => a < b);
		const p = nearestRank(scratch, lead.percentile)!;
		return math.clamp(math.ceil(p + lead.marginTicks - ORACLE_EPSILON), t.inputDelay, t.maxInputLead);
	}

	/** The largest trip received in [from, to). */
	maxBetween(from: number, to: number): number {
		let m = -math.huge;
		for (let k = 0; k < this.at.size(); k++)
			if (this.at[k] >= from && this.at[k] < to) m = math.max(m, this.trip[k]);
		return m;
	}
}

/** One client's rendered frames while its run was on (docs/FRAME_PACING.md FP4): per frame, ticks stepped and more. */
interface FrameTrace {
	/** The simulated clock of each frame. */
	readonly at: number[];
	readonly stepped: number[];
	/** getAlpha() after the pump. */
	readonly alpha: number[];
	/** pacingStats().holds after the pump (0 unpaced). */
	readonly holds: number[];
	/** netLead() after the pump. */
	readonly lead: number[];
	/** isLeadMeasured() after the pump. */
	readonly measured: boolean[];
}

/**
 * One client's measured lead next to its oracles (FP11), every ORACLE_EVERY_FRAMES frames: the simulated clock, the
 * net lead, and the oracle lead (TripWindow.oracle; NO_ORACLE while no trip is in the window) over every input frame the
 * server received (`all`), and over the frames the server echoed (`echoed`: per broadcast, the lowest-slack frame received
 * since the previous one, the one LockstepSession's echo reports).
 */
interface OracleTrace {
	readonly at: number[];
	readonly lead: number[];
	readonly all: number[];
	readonly echoed: number[];
}

/** Per player, after the warm-up: ticks the client never sent an input for (target jumps), and their causes. */
interface GapCount {
	readonly gaps: number;
	/** Gap ticks of a net lead rise, and of a pacing depth rise (the rest). */
	readonly leadRise: number;
	readonly depthRise: number;
}

/**
 * A client's scripted player: small left / right walks, rolls, swings, and a debug hit (K) every 120 ticks unless
 * `harmless`; neutral while state.tick is below `coverTicks` (the stage cover).
 */
function botInput(s: SimState, i: number, coverTicks = 0, harmless = false): InputFrame {
	if (s.tick < coverTicks) return { ...EMPTY_INPUT };
	const p = playerAt(s, i);
	const t = s.tick + i * 23;
	const dir = math.floor(t / 40) % 2 === 0 ? 1 : -1;
	let buttons = 0;
	if (t % 120 === 60 && !harmless) buttons = bit32.bor(buttons, Button.DEBUG_HIT);
	if (t % 77 === 0) buttons = bit32.bor(buttons, Button.ROLL);
	if (t % 9 < 3) buttons = bit32.bor(buttons, Button.FIRE);
	return { moveX: p.dead !== 0 ? 0 : dir * 600, moveZ: ((i % 3) - 1) * 300, aimX: dir * AXIS_MAX, aimZ: 0, buttons };
}

/** A stalled server's step: nothing finalized, broadcast or decided. */
const SERVER_STALLED: LockstepStepResult = {
	broadcasts: [],
	segmentsOffered: 0,
	submitted: false,
	dropped: [],
	ackTick: 0,
};

class Net {
	readonly members: number[] = [];
	readonly session: LockstepSession;
	readonly validator: SegmentedValidator;
	readonly clients: LockstepClient[] = [];
	readonly down: Channel[] = [];
	readonly up: Channel[] = [];
	/** Every merged frame the server broadcast, decoded independently. */
	readonly log: InputFrame[][] = [];
	readonly finals = new Map<number, RunFinal>();
	readonly frozen = new Set<number>();
	readonly gone = new Set<number>();
	/** The dt of a client's next pump (a hitch: the frame that took that long), consumed by that pump. */
	readonly nextDt = new Map<number, number>();
	/** Per player: the server clock of every broadcast whose echo for them carried a tick. */
	readonly echoTickAt: number[][] = [];
	/** The service's per-player limiters, on the simulated clock (RunSessionService applies the same rates). */
	readonly hashLimiter = new SlidingWindowLimiter<number>(LOCKSTEP_HASH_RATE.count, LOCKSTEP_HASH_RATE.windowSeconds);
	readonly inputLimiter = new SlidingWindowLimiter<number>(
		LOCKSTEP_INPUT_RATE.count,
		LOCKSTEP_INPUT_RATE.windowSeconds,
	);
	/** Per player: hash calls sent, refused by the limiter, lost on the way (dropHashCall), and the ticks each carried. */
	readonly hashCalls: number[] = [];
	readonly hashCallsLimited: number[] = [];
	readonly hashCallsLost: number[] = [];
	readonly inputCallsLimited: number[] = [];
	readonly hashTicksSent: number[][] = [];
	/** Per client, every frame it pumped while its run was on (not over before the pump). */
	readonly traces: FrameTrace[] = [];
	/**
	 * Ground truth for the measured lead (FP11), from the harness's own records: per client, every input frame the
	 * server received (the server clock at receipt) and its true net trip in ticks: the receipt position R (as the
	 * session computes it: finalizedTicks() + clamp(pos - finalizedTicks(), 0, 1)) - 1 - the client's state.tick when
	 * it sampled that frame for sending - the pacer's raw depth then (Design 9's netTrip, for every frame). `echoed`
	 * keeps only the frames the session's echo reports (the lowest-slack one received before each broadcast).
	 */
	readonly truth: TripWindow[] = [];
	readonly echoedTruth: TripWindow[] = [];
	/** Per client: every frame it sent, by target tick, and the net lead it was sent with. */
	readonly sentFrames: Array<Map<number, InputFrame>> = [];
	readonly sentNet: Array<Map<number, number>> = [];
	/** Per client (measured runs): the lead next to the oracle. */
	readonly oracles: OracleTrace[] = [];
	/** The relay's missed / late per player, and finalizedTicks(), once LEAD_WARMUP_TICKS were finalized. */
	missedAtWarmup: number[] | undefined;
	lateAtWarmup: number[] = [];
	warmupTick = 0;
	private readonly sendTick: Array<Map<number, number>> = [];
	private readonly sendDepth: Array<Map<number, number>> = [];
	/** Per client: the lowest-slack frame received since the last broadcast, its slack and true trip (its echo's). */
	private readonly echoPending: boolean[] = [];
	private readonly echoSlack: number[] = [];
	private readonly echoTrip: number[] = [];
	result: SegmentedRunResult | undefined;
	now = 0;
	private readonly logDecoder: MergedDecoder;
	private readonly tunables: LockstepTunables;
	private readonly frameDt: number;

	constructor(readonly opts: NetOptions) {
		const n = opts.players;
		const base = opts.tunables ?? TUNABLES;
		const paced = opts.pacing === true ? { ...base, pacing: base.pacing ?? PACING } : base;
		this.tunables = opts.measured === true ? { ...paced, lead: paced.lead ?? LEAD } : paced;
		this.frameDt = 1 / (opts.fps ?? NET_FPS);
		for (let i = 0; i < n; i++) {
			this.traces.push({ at: [], stepped: [], alpha: [], holds: [], lead: [], measured: [] });
			this.echoTickAt.push([]);
			this.truth.push(new TripWindow());
			this.echoedTruth.push(new TripWindow());
			this.sentFrames.push(new Map());
			this.sentNet.push(new Map());
			this.oracles.push({ at: [], lead: [], all: [], echoed: [] });
			this.sendTick.push(new Map());
			this.sendDepth.push(new Map());
			this.echoPending.push(false);
			this.echoSlack.push(0);
			this.echoTrip.push(0);
			this.hashCalls.push(0);
			this.hashCallsLimited.push(0);
			this.hashCallsLost.push(0);
			this.inputCallsLimited.push(0);
			this.hashTicksSent.push([]);
		}
		const setup = buildEndlessRunConfig(SEED, n);
		for (let i = 0; i < n; i++) this.members.push(1000 + i);
		this.validator = new SegmentedValidator({
			runId: "coop",
			seed: SEED,
			worldKind: "endless",
			setup,
			createdAt: 0,
			limits: SEG_LIMITS,
		});
		this.session = new LockstepSession({
			runId: "coop",
			seed: SEED,
			spawn: setup.spawn!,
			members: this.members,
			validator: this.validator,
			startedAt: 0,
			tunables: this.tunables,
		});
		this.logDecoder = new MergedDecoder(n);
		const [lo, hi] = opts.latency;
		for (let i = 0; i < n; i++) {
			// Each client builds its own world from the seed, as a real client does.
			const own = buildEndlessRunConfig(SEED, n);
			this.clients.push(
				new LockstepClient({
					runId: "coop",
					seed: SEED,
					spawn: own.spawn!,
					config: own.config,
					players: n,
					localIndex: i,
					tunables: this.tunables,
				}),
			);
			this.down.push(new Channel(NET_CHANNEL_SEED + 2 * i, lo, hi, opts.downEvents));
			this.up.push(new Channel(NET_CHANNEL_SEED + 2 * i + 1, lo, hi, opts.upEvents));
		}
	}

	run(): void {
		const fps = this.opts.fps ?? NET_FPS;
		const maxFrames = this.opts.maxFrames ?? fps * 120;
		const paced = this.opts.pacing === true;
		const measured = this.opts.measured === true;
		// The clock reaches the clients when they pace or measure the lead (unpaced legacy runs: as before, none).
		const clocked = paced || measured;
		const frameDt = this.frameDt;
		const coverTicks = math.floor((this.opts.coverSec ?? 0) * SIM_HZ + 0.5);
		const harmless = this.opts.harmless === true;
		for (let frame = 0; frame < maxFrames && this.result === undefined; frame++) {
			this.now += frameDt;
			const stall = this.opts.serverStall;
			const serverRuns = stall === undefined || this.now < stall.at || this.now >= stall.at + stall.sec;
			if (serverRuns) for (const c of this.up) c.pump(this.now);
			const out = serverRuns ? this.session.step(this.now) : SERVER_STALLED;
			for (const b of out.broadcasts) {
				for (let i = 0; i < this.clients.size(); i++) {
					if (!this.echoPending[i]) continue;
					this.echoPending[i] = false;
					this.echoedTruth[i].push(this.now, this.echoTrip[i]);
				}
				const ticks = this.logDecoder.decode(b.data)!;
				expect(b.firstTick).toBe(this.log.size());
				// One input echo per player, each well-formed; each client gets its own (ignored on the legacy lead).
				expect(b.echoes.size()).toBe(this.clients.size());
				for (let i = 0; i < b.echoes.size(); i++) {
					const e = decodeInputEcho(b.echoes[i], b.firstTick);
					expect(e).toBeDefined();
					if (e?.tick !== undefined) this.echoTickAt[i].push(this.now);
				}
				const echoOff = this.opts.echoOff;
				for (const t of ticks) this.log.push(t);
				const ack = out.ackTick;
				for (let i = 0; i < this.clients.size(); i++) {
					if (this.gone.has(i)) continue;
					const c = this.clients[i];
					const silent =
						echoOff !== undefined &&
						echoOff.client === i &&
						this.now >= echoOff.at &&
						this.now < echoOff.at + echoOff.sec;
					const echo = silent ? undefined : b.echoes[i];
					this.down[i].send(this.now, () => {
						c.receive(b.firstTick, b.data, clocked ? this.now : undefined, echo);
						c.acknowledge(ack);
					});
				}
			}
			if (out.ended !== undefined) {
				this.result = this.validator.getResult();
				break;
			}
			for (let guard = 0; serverRuns && guard < 100 && this.validator.hasWork(); guard++) {
				const r = this.validator.advance(1000);
				if (r.result !== undefined) this.result = r.result;
			}
			if (this.missedAtWarmup === undefined && this.session.finalizedTicks() >= LEAD_WARMUP_TICKS) {
				const st = this.session.getRelay().getStats();
				this.missedAtWarmup = [...st.missed];
				this.lateAtWarmup = [...st.late];
				this.warmupTick = this.session.finalizedTicks();
			}
			if (this.result === undefined && this.session.getStatus() === "submitted") {
				this.result = this.validator.getResult();
			}
			this.opts.onFrame?.(this, frame);
			for (let i = 0; i < this.clients.size(); i++) {
				this.down[i].pump(this.now);
				if (this.frozen.has(i) || this.gone.has(i)) continue;
				const c = this.clients[i];
				const user = this.members[i];
				const live = !c.isOver();
				const sendTick = this.sendTick[i];
				const sendDepth = this.sendDepth[i];
				const pumpDt = this.nextDt.get(i) ?? frameDt;
				this.nextDt.delete(i);
				const res = c.pump(
					pumpDt,
					(sending) => {
						if (sending) {
							// The ground truth's send record: the target, the tick it was computed from, the raw depth.
							const target = c.nextInputTick();
							const pace = c.pacingStats();
							sendTick.set(target, c.state.tick);
							sendDepth.set(target, (pace?.depthMs ?? 0) / MS_PER_SEC / DT);
							this.sentNet[i].set(target, c.netLead());
						}
						return botInput(c.state, i, coverTicks, harmless);
					},
					clocked ? this.now : undefined,
				);
				if (live) {
					const tr = this.traces[i];
					tr.at.push(this.now);
					tr.stepped.push(res.stepped);
					tr.alpha.push(c.getAlpha());
					tr.holds.push(c.pacingStats()?.holds ?? 0);
					tr.lead.push(c.netLead());
					tr.measured.push(c.isLeadMeasured());
					if (measured && frame % ORACLE_EVERY_FRAMES === 0) {
						const o = this.oracles[i];
						o.at.push(this.now);
						o.lead.push(c.netLead());
						o.all.push(this.truth[i].oracle(this.now, this.tunables));
						o.echoed.push(this.echoedTruth[i].oracle(this.now, this.tunables));
					}
				}
				for (const inp of res.inputs) {
					const frames = decodeInputBatch(inp.data, this.tunables.maxBatchFrames)!;
					for (let j = 0; j < frames.size(); j++) this.sentFrames[i].set(inp.firstTick + j, frames[j]);
					this.up[i].send(this.now, () => {
						if (!this.inputLimiter.tryAcquire(user, this.now)) {
							this.inputCallsLimited[i]++;
							return;
						}
						this.recordReceipt(i, inp.firstTick, frames.size());
						this.session.submitInput(user, inp.firstTick, inp.data, this.now);
					});
				}
				if (res.hashes.size() > 0) {
					// One call per pump, as SimController sends it.
					const ticks = res.hashes.map((h) => h.tick);
					const hashes = res.hashes.map((h) => h.hash);
					expect(ticks.size() <= this.tunables.maxHashBatch).toBe(true);
					this.hashCalls[i]++;
					for (const t of ticks) this.hashTicksSent[i].push(t);
					if (this.opts.dropHashCall?.(i, ticks) === true) {
						this.hashCallsLost[i]++;
					} else {
						this.up[i].send(this.now, () => {
							if (!this.hashLimiter.tryAcquire(user, this.now)) this.hashCallsLimited[i]++;
							else this.session.reportHashes(user, ticks, hashes);
						});
					}
				}
				if (res.final !== undefined) {
					const fin = res.final;
					this.finals.set(i, fin);
					this.up[i].send(this.now, () => this.session.reportFinal(user, fin));
				}
			}
		}
	}

	/** The ground-truth trips of client i's batch, received now (before the session handles it, as it does). */
	private recordReceipt(i: number, firstTick: number, count: number): void {
		const fin = this.session.finalizedTicks();
		const receipt = fin + math.clamp(this.now * SIM_HZ - fin, 0, 1);
		for (let j = 0; j < count; j++) {
			const target = firstTick + j;
			const sentAt = this.sendTick[i].get(target);
			if (sentAt === undefined) continue;
			const depth = this.sendDepth[i].get(target) ?? 0;
			this.sendTick[i].delete(target);
			this.sendDepth[i].delete(target);
			const trip = receipt - 1 - sentAt - depth;
			this.truth[i].push(this.now, trip);
			// As the session picks its echo: the lowest slack (target + 1 - receipt) since the last broadcast.
			const slack = target + 1 - receipt;
			if (!this.echoPending[i] || slack < this.echoSlack[i]) {
				this.echoPending[i] = true;
				this.echoSlack[i] = slack;
				this.echoTrip[i] = trip;
			}
		}
	}

	/** Per player, the ticks after the warm-up (through the last finalized) the client sent no input for. */
	gapsAfterWarmup(): GapCount[] {
		const out: GapCount[] = [];
		const last = this.session.finalizedTicks() - 1;
		for (let i = 0; i < this.clients.size(); i++) {
			const sent = this.sentFrames[i];
			let gaps = 0;
			let leadRise = 0;
			let prev: number | undefined;
			for (let t = this.warmupTick; t <= last; t++) {
				if (sent.has(t)) {
					if (prev !== undefined && t - prev > 1) {
						// A target jump: as much of it as the net lead rose is the lead's, the rest the depth's.
						const rise = (this.sentNet[i].get(t) ?? 0) - (this.sentNet[i].get(prev) ?? 0);
						leadRise += math.clamp(rise, 0, t - prev - 1);
					}
					prev = t;
					continue;
				}
				gaps++;
			}
			out.push({ gaps, leadRise, depthRise: gaps - leadRise });
		}
		return out;
	}

	/** Per player: the relay's missed and late after the warm-up, and the ticks finalized since. */
	afterWarmup(): { missed: number[]; late: number[]; ticks: number } {
		const st = this.session.getRelay().getStats();
		const m0 = this.missedAtWarmup ?? st.missed.map(() => 0);
		const missed: number[] = [];
		const late: number[] = [];
		for (let i = 0; i < st.missed.size(); i++) {
			missed.push(st.missed[i] - m0[i]);
			late.push(st.late[i] - (this.lateAtWarmup[i] ?? 0));
		}
		return { missed, late, ticks: this.session.finalizedTicks() - this.warmupTick };
	}

	/** Replays the broadcast log's first `ticks` ticks from scratch. */
	replayLog(ticks: number): SimState {
		const setup = buildEndlessRunConfig(SEED, this.opts.players);
		const s = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		for (let t = 0; t < ticks; t++) stepParty(s, this.log[t], setup.config);
		return s;
	}
}

const NET_RUNS: ReadonlyArray<readonly [number, number, number]> = [
	// players, min / max one-way latency (s)
	[3, 0.02, 0.12],
	[8, 0, 0.2],
];

/** The whole-run checks of a finished Net run: ranked, identical on every client, the log is what they stepped. */
function itRanAndValidated(net: Net, label: string): void {
	const players = net.opts.players;
	it("the run ends (the party is wiped) and the server's replay accepts it", () => {
		const fin = net.finals.get(0)!;
		print(
			`[lockstep ${label}] final tick ${fin.finalTick} hash ${fin.claimedHash} score ${fin.claimed.score}; leads ` +
				`${net.clients.map((c) => c.inputLead()).join(",")}; misses ${net.clients
					.map((c) => c.misses)
					.join(",")}; relay missed ${net.session.getRelay().getStats().missed.join(",")} late ${net.session
					.getRelay()
					.getStats()
					.late.join(",")} of ${net.session.finalizedTicks()} ticks`,
		);
		expect(net.result?.reason).toBe(undefined);
		expect(net.result?.ok).toBe(true);
		expect(net.result?.serverHash).toBe(fin.claimedHash);
		expect(net.result?.score.score).toBe(fin.claimed.score);
		expect(net.result?.verifiedTicks).toBe(fin.finalTick);
		expect(fin.finalTick > 600).toBe(true);
	});

	it("every client reached the identical state at the same tick", () => {
		const fin = net.finals.get(0)!;
		for (let i = 0; i < players; i++) {
			const c = net.clients[i];
			expect(isPartyWiped(c.state)).toBe(true);
			expect(c.state.tick).toBe(fin.finalTick);
			expect(hashState(c.state)).toBe(fin.claimedHash);
			expect(net.finals.get(i)).toEqual(fin);
			expect(c.brokenReason()).toBe(undefined);
		}
	});

	it("the merged log the server broadcast is exactly what the clients stepped", () => {
		const fin = net.finals.get(0)!;
		expect(hashState(net.replayLog(fin.finalTick))).toBe(fin.claimedHash);
	});

	it("players' own inputs made it into the log (the lead adapts to the latency)", () => {
		const stats = net.session.getRelay().getStats();
		const ticks = net.session.finalizedTicks();
		for (let i = 0; i < players; i++) expect(stats.missed[i] < ticks / 4).toBe(true);
		let moved = 0;
		for (const row of net.log) if (row[1].moveX !== 0) moved++;
		expect(moved > ticks / 2).toBe(true);
	});
}

/**
 * The finished NET_RUNS nets, unpaced and paced (docs/FRAME_PACING.md FP3: the same networks pass with pacing on), each
 * built and run once on first use: every describe below that reads one asks for it here, so none depends on another
 * describe having run first (describe bodies run in file order while the suite is collected).
 */
const finishedNets = new Map<string, Net>();
function finishedNet(run: number, paced: boolean): Net {
	const key = `${run}:${paced}`;
	const cached = finishedNets.get(key);
	if (cached !== undefined) return cached;
	const [players, lo, hi] = NET_RUNS[run];
	const net = new Net({ players, latency: [lo, hi], pacing: paced });
	net.run();
	finishedNets.set(key, net);
	return net;
}

/** Relay-refused input frames over every player (too far ahead, invalid, or after a leave). */
function refusedInputs(net: Net): number {
	let n = 0;
	for (const r of net.session.getRelay().getStats().refused) n += r;
	return n;
}

for (let run = 0; run < NET_RUNS.size(); run++) {
	const [players, lo, hi] = NET_RUNS[run];
	describe(`co-op over a simulated network: ${players} players, ${lo * 1000}-${hi * 1000} ms each way`, () => {
		itRanAndValidated(finishedNet(run, false), `${players}p`);
	});
	describe(`co-op over a simulated network, paced: ${players} players, ${lo * 1000}-${hi * 1000} ms each way`, () => {
		const net = finishedNet(run, true);
		const unpaced = finishedNet(run, false);
		itRanAndValidated(net, `${players}p paced`);
		it("every client paced", () => {
			for (const c of net.clients) expect(c.isPacing()).toBe(true);
		});
		it("the input lead covers the buffer: no more misses per player than unpaced on the same network, none refused", () => {
			// The client's own deadline misses (an input sent but finalized late). Paced, the lead adds the buffer's depth
			// (rising at once), so a deeper buffer costs no misses; the ticks a rise skips are never sent, so never missed.
			print(
				`[lockstep ${players}p misses] paced ${net.clients
					.map((c) => c.misses)
					.join(",")} unpaced ${unpaced.clients
					.map((c) => c.misses)
					.join(",")}; relay refused paced ${refusedInputs(net)} unpaced ${refusedInputs(unpaced)}`,
			);
			for (let i = 0; i < players; i++) expect(net.clients[i].misses <= unpaced.clients[i].misses).toBe(true);
			expect(refusedInputs(net)).toBe(0);
			expect(refusedInputs(unpaced)).toBe(0);
		});
	});
}

// The measured lead (docs/FRAME_PACING.md Revision 2, FP11) on the NET_RUNS networks, paced (the shipped default) and
// with the stage cover's neutral first second (a real run starts under it), next to the legacy miss counter on the
// same network, seeds and cover. The oracle is computed from the harness's own timestamps (Net.truth): the lead should
// sit at ceil(p95 + margin) of the trips over the last window, or one above (the fall's slack band).

/** The bots' neutral start (the stage cover) in the measured-lead runs and their legacy comparison. */
const STAGE_COVER_SEC = 1;
/**
 * After the warm-up, the relay's late frames per player stay under this share of the ticks finalized (FPD11's lates
 * target; met at LEAD.marginTicks 1.5: no late after the warm-up on either network).
 */
const MEASURED_LATE_SHARE = 0.005;
/**
 * After the warm-up, the relay's missed ticks per player (lates plus the ticks never sent: target jumps when the lead or
 * the pacing depth rises: FP1's rule leaves them to repeat-last) stay under this share. The plan's target is 0.5 %
 * (measured at most 0.43 %, all never sent); the legacy rule measures 0.52-0.93 % (all never sent) on the same network.
 */
const MEASURED_MISSED_SHARE = 0.01;
/**
 * After the warm-up, at least this share of a client's samples has the lead in [oracle, oracle + 1], and at most
 * ORACLE_BELOW_SHARE below it. Above the band: the lead's fall hold (fallHoldSec, then fallStepSec a tick) after the
 * oracle dropped or after a late's bump, by design.
 */
const ORACLE_BAND_SHARE = 0.8;
const ORACLE_BELOW_SHARE = 0.02;
/**
 * The independent check (review fix 5a): against the oracle of EVERY frame the server received (not only the ones it
 * echoed), at most this share of a client's samples after the warm-up has the lead more than a tick below it. Measured
 * 0 % on both networks; 2 % leaves room for a single sample burst without hiding a systematic shortfall.
 */
const ORACLE_FAR_BELOW_SHARE = 0.02;

const coveredNets = new Map<string, Net>();
/** NET_RUNS[run] paced, with the stage cover, measured or legacy (built and run once on first use). */
function coveredNet(run: number, measured: boolean): Net {
	const key = `${run}:${measured}`;
	const cached = coveredNets.get(key);
	if (cached !== undefined) return cached;
	const [players, lo, hi] = NET_RUNS[run];
	const net = new Net({ players, latency: [lo, hi], pacing: true, measured, coverSec: STAGE_COVER_SEC });
	net.run();
	coveredNets.set(key, net);
	return net;
}

/** Per client after `from` seconds: the net lead's mean, min and max over its frames. */
function leadSummary(net: Net, from = LEAD_WARMUP_SEC): string {
	const parts: string[] = [];
	for (const tr of net.traces) {
		let sum = 0;
		let n = 0;
		let lo = math.huge;
		let hi = -math.huge;
		for (let k = 0; k < tr.at.size(); k++) {
			if (tr.at[k] < from) continue;
			const v = tr.lead[k];
			sum += v;
			n++;
			lo = math.min(lo, v);
			hi = math.max(hi, v);
		}
		parts.push(n > 0 ? string.format("%.1f [%d-%d]", sum / n, lo, hi) : "-");
	}
	return parts.join(", ");
}

interface Band {
	/** Shares of the samples after the warm-up: the lead in [oracle, oracle + 1], below it, above oracle + 1. */
	readonly inBand: number;
	readonly below: number;
	readonly above: number;
	/** The lead more than a tick below the oracle. */
	readonly farBelow: number;
	readonly samples: number;
}

/** Per client: the lead against its oracle over every received frame, or over the echoed ones only. */
function oracleBand(net: Net, echoed: boolean): Band[] {
	return net.oracles.map((o) => {
		let inBand = 0;
		let below = 0;
		let above = 0;
		let farBelow = 0;
		let samples = 0;
		for (let k = 0; k < o.at.size(); k++) {
			const want = echoed ? o.echoed[k] : o.all[k];
			if (o.at[k] < LEAD_WARMUP_SEC || want === NO_ORACLE) continue;
			samples++;
			const lead = o.lead[k];
			if (lead < want - 1) farBelow++;
			if (lead < want) below++;
			else if (lead > want + 1) above++;
			else inBand++;
		}
		const d = math.max(samples, 1);
		return { inBand: inBand / d, below: below / d, above: above / d, farBelow: farBelow / d, samples };
	});
}

function pct(x: number): string {
	return string.format("%.2f%%", x * 100);
}

function bandText(b: Band[]): string {
	return (
		`in ${b.map((x) => pct(x.inBand)).join(",")} below ${b.map((x) => pct(x.below)).join(",")} above ` +
		`${b.map((x) => pct(x.above)).join(",")} more than a tick below ${b.map((x) => pct(x.farBelow)).join(",")}`
	);
}

/** The relay's missed (and late) per player after the warm-up, as shares of the ticks finalized since, and the gaps. */
function missedText(net: Net): string {
	const w = net.afterWarmup();
	const g = net.gapsAfterWarmup();
	return (
		`missed ${w.missed.join(",")} (${w.missed.map((m) => pct(m / math.max(w.ticks, 1))).join(",")}) = late ` +
		`${w.late.join(",")} + never sent ${g.map((x) => x.gaps).join(",")} (lead rise ${g
			.map((x) => x.leadRise)
			.join(",")}, depth rise ${g.map((x) => x.depthRise).join(",")}) of ${
			w.ticks
		} ticks after ${LEAD_WARMUP_SEC} s`
	);
}

function leadStatsText(net: Net): string {
	const each = (f: (st: LeadStats) => number, fmt = "%d") =>
		net.clients
			.map((c) => {
				const st = c.leadStats();
				return st !== undefined ? string.format(fmt, f(st)) : "-";
			})
			.join(",");
	return (
		`trip p95 ${each((st) => st.tripP95 ?? -1, "%.1f")} t; lates ${each((st) => st.lates)} bumps ` +
		`${each((st) => st.bumps)} excused ${each((st) => st.excused)} raises ${each((st) => st.raises)} falls ${each(
			(st) => st.falls,
		)}`
	);
}

for (let run = 0; run < NET_RUNS.size(); run++) {
	const [players, lo, hi] = NET_RUNS[run];
	describe(`co-op over a simulated network, paced, measured lead: ${players} players, ${lo * 1000}-${
		hi * 1000
	} ms each way`, () => {
		const net = coveredNet(run, true);
		const legacy = coveredNet(run, false);
		const echoedBand = oracleBand(net, true);
		const allBand = oracleBand(net, false);
		const tag = `[lockstep ${players}p lead]`;
		itRanAndValidated(net, `${players}p measured`);
		print(`${tag} measured lead after ${LEAD_WARMUP_SEC} s, mean [min-max]: ${leadSummary(net)}`);
		print(`${tag} legacy   lead after ${LEAD_WARMUP_SEC} s, mean [min-max]: ${leadSummary(legacy)}`);
		print(`${tag} measured relay ${missedText(net)}`);
		print(`${tag} legacy   relay ${missedText(legacy)}`);
		print(
			`${tag} client misses measured ${net.clients.map((c) => c.misses).join(",")} (mismatches ${net.clients
				.map((c) => c.mismatches)
				.join(",")}) legacy ${legacy.clients.map((c) => c.misses).join(",")}; measured ${leadStatsText(net)}`,
		);
		print(`${tag} oracle of the echoed frames: lead ${bandText(echoedBand)}`);
		print(`${tag} oracle of every frame:       lead ${bandText(allBand)}`);
		it("every client measures its lead from the echoes; the legacy clients do not", () => {
			for (const c of net.clients) {
				expect(c.isLeadMeasured()).toBe(true);
				expect(c.leadStats()!.echoing).toBe(true);
				expect(c.leadStats()!.samples > 0).toBe(true);
			}
			for (const c of legacy.clients) {
				expect(c.isLeadMeasured()).toBe(false);
				expect(c.leadStats()).toBe(undefined);
			}
		});

		it("plumbing: the lead follows its rule on the echoed trips ([L*, L* + 1] of their oracle)", () => {
			// A plumbing check, not an independent one: this oracle takes the same frames the session echoes with the
			// session's own receipt formula, so it checks that the echoes reach the controller and the rule is applied
			// (the shares above the band are the fall hold after a drop or a bump).
			for (const b of echoedBand) {
				expect(b.samples > 0).toBe(true);
				expect(b.inBand >= ORACLE_BAND_SHARE).toBe(true);
				expect(b.below <= ORACLE_BELOW_SHARE).toBe(true);
			}
		});

		it("independent: never more than a tick below the oracle of every frame the server received", () => {
			// The independent checks are this one (every frame, not only the echoed ones) and the relay's own lates
			// below (the server's deadline, nothing of the client's model).
			for (const b of allBand) {
				expect(b.samples > 0).toBe(true);
				expect(b.farBelow <= ORACLE_FAR_BELOW_SHARE).toBe(true);
			}
		});

		it("after the first 2 s the relay counts under 0.5 % of each player's ticks late (missed: under 1 %)", () => {
			const w = net.afterWarmup();
			expect(w.ticks > 0).toBe(true);
			for (const l of w.late) expect(l < MEASURED_LATE_SHARE * w.ticks).toBe(true);
			for (const m of w.missed) expect(m < MEASURED_MISSED_SHARE * w.ticks).toBe(true);
			expect(refusedInputs(net)).toBe(0);
		});
	});
}

// Spikes (docs/FRAME_PACING.md FP12): NET_RUNS' first network (3 players, 20-120 ms each way), paced, with the stage
// cover and harmless bots (no debug hit, so the party lives through the whole run), with scheduled trouble on every
// client's up channel (client -> server, where inputs are lost): a 1 s spike of +200 ms one way, and separately a
// 300 ms head-of-line hold. The measured lead against the legacy rule on the same seeds and network.
//
// Asserted: both runs play the log; the measured lead peaks at most ceil(the trouble's longest trip + margin) + 1 (the
// hysteresis tick) and is back within one tick of its pre-trouble lead within the fall's own bound, windowSec +
// fallHoldSec + fallStepSec x (peak - before) + 0.5 s after the trouble ended; the legacy rule never comes back within
// the watch. Printed with a met / NOT met verdict, not asserted: dropped changed inputs at most the legacy rule's (the
// legacy lead never came down after the warm-up, so it meets the hold 5-7 ticks higher).

const SPIKE_AT = 7;
const SPIKE_SEC = 1;
const SPIKE_EXTRA = 0.2;
const HOLD_SEC = 0.3;
/** The lead is back when within this many ticks of its pre-trouble value. */
const RECOVER_TICKS = 1;
/** The recovery is watched this long after the trouble ended (seconds); the run lasts a second more. */
const WATCH_SEC = 12;
/** Dropped inputs are counted over the trouble and this long after it (the queued messages still land late). */
const DROP_TAIL_SEC = 2;
/** Slack on the fall's own bound (seconds): the echoes' way down and the window's last trouble trips. */
const TROUBLE_FALL_SLACK_SEC = 0.5;

interface TroubleNumbers {
	/** Per player: the sent frames the relay dropped that differed from the frame finalized (repeat-last). */
	readonly dropped: number[];
	/** Per player: the net lead just before the trouble, and its peak from the trouble to the end of the watch. */
	readonly before: number[];
	readonly peak: number[];
	/** Seconds after the trouble ended until the lead stayed within RECOVER_TICKS of `before` (math.huge: never). */
	readonly backSec: number[];
	/** Per player: the longest ground-truth net trip the server received from the trouble's start until it cleared. */
	readonly trip: number[];
}

function troubleNumbers(net: Net, at: number, sec: number, extra: number): TroubleNumbers {
	const ends = at + sec;
	const fromTick = math.floor(at * SIM_HZ);
	const toTick = math.min(math.floor((ends + DROP_TAIL_SEC) * SIM_HZ), net.log.size());
	const watchEnd = ends + WATCH_SEC;
	const [, , hi] = NET_RUNS[0];
	const out: TroubleNumbers = { dropped: [], before: [], peak: [], backSec: [], trip: [] };
	for (let i = 0; i < net.clients.size(); i++) {
		let dropped = 0;
		for (let t = fromTick; t < toTick; t++) {
			const mine = net.sentFrames[i].get(t);
			if (mine !== undefined && !inputsEqual(mine, net.log[t][i])) dropped++;
		}
		const tr = net.traces[i];
		let before = 0;
		let peak = 0;
		/** The last frame of the watch with the lead outside the band (back from the next one). */
		let lastOut = ends;
		let watched = false;
		for (let k = 0; k < tr.at.size(); k++) {
			const t = tr.at[k];
			const lead = tr.lead[k];
			if (t < at) before = lead;
			else if (t <= watchEnd) peak = math.max(peak, lead);
			if (t >= ends && t <= watchEnd) {
				watched = true;
				if (math.abs(lead - before) > RECOVER_TICKS) lastOut = t;
			}
		}
		out.dropped.push(dropped);
		out.before.push(before);
		out.peak.push(peak);
		out.backSec.push(watched && lastOut + DT < watchEnd ? lastOut - ends : math.huge);
		// Sent from the trouble's start until it cleared, received at most a full up trip (plus the spike) later.
		out.trip.push(net.truth[i].maxBetween(at, ends + extra + 2 * hi));
	}
	return out;
}

function sum(xs: ReadonlyArray<number>): number {
	let n = 0;
	for (const x of xs) n += x;
	return n;
}

function secText(s: number): string {
	return s === math.huge ? "never" : string.format("%.2f s", s);
}

function troubleText(n: TroubleNumbers): string {
	return (
		`dropped changed inputs ${n.dropped.join(",")} (${sum(n.dropped)}); lead before ${n.before.join(",")} peak ` +
		`${n.peak.join(",")} back after ${n.backSec.map(secText).join(",")}`
	);
}

function verdict(met: boolean): string {
	return met ? "met" : "NOT met";
}

for (const kind of ["spike", "hold"] as const) {
	const isSpike = kind === "spike";
	const events: ChannelEvents = isSpike
		? { spike: { at: SPIKE_AT, sec: SPIKE_SEC, extra: SPIKE_EXTRA } }
		: { hold: { at: SPIKE_AT, sec: HOLD_SEC } };
	const sec = isSpike ? SPIKE_SEC : HOLD_SEC;
	const extra = isSpike ? SPIKE_EXTRA : HOLD_SEC;
	const title = isSpike
		? `a ${SPIKE_SEC} s +${SPIKE_EXTRA * 1000} ms spike`
		: `a ${HOLD_SEC * 1000} ms head-of-line hold`;
	describe(`co-op over a simulated network with ${title} on the way up: 3 players, 20-120 ms each way (FP12)`, () => {
		const [players, lo, hi] = NET_RUNS[0];
		const nets: Net[] = [];
		const netOf = (measured: boolean, tunables?: LockstepTunables) => {
			const net = new Net({
				players,
				latency: [lo, hi],
				pacing: true,
				measured,
				tunables,
				coverSec: STAGE_COVER_SEC,
				harmless: true,
				upEvents: events,
				maxFrames: NET_FPS * (SPIKE_AT + sec + WATCH_SEC + 1),
			});
			net.run();
			return net;
		};
		for (const measured of [true, false]) nets.push(netOf(measured));
		const [measured, legacy] = nets;
		// Revision 2's rule (the late bump, KV_LeadBump), printed beside Revision 3's (FP19).
		const bumped = netOf(true, { ...TUNABLES, lead: { ...LEAD, lateBump: true } });
		const m = troubleNumbers(measured, SPIKE_AT, sec, extra);
		const l = troubleNumbers(legacy, SPIKE_AT, sec, extra);
		const r2 = troubleNumbers(bumped, SPIKE_AT, sec, extra);
		/** FP12's peak bound: ceil(the trouble's longest trip + margin) plus the fall's hysteresis tick. */
		const peakBounds = m.trip.map((t) => math.ceil(t + LEAD.marginTicks - ORACLE_EPSILON) + 1);
		/** The fall's own bound: the window, the hold, a step per tick of excess, and slack. */
		const fallBounds = m.peak.map(
			(p, i) =>
				LEAD.windowSec +
				LEAD.fallHoldSec +
				LEAD.fallStepSec * math.max(0, p - m.before[i]) +
				TROUBLE_FALL_SLACK_SEC,
		);
		const tag = `[lockstep ${kind}]`;
		print(
			`${tag} measured ${troubleText(m)}; peak bound ${peakBounds.join(",")} (trip max ${m.trip
				.map((t) => string.format("%.1f", t))
				.join(",")} t); fall bound ${fallBounds.map((b) => string.format("%.2f s", b)).join(",")}`,
		);
		print(`${tag} rev2     ${troubleText(r2)}; ${leadStatsText(bumped)}`);
		print(`${tag} legacy   ${troubleText(l)}`);
		print(
			`${tag} relay missed measured ${measured.session
				.getRelay()
				.getStats()
				.missed.join(",")} legacy ${legacy.session
				.getRelay()
				.getStats()
				.missed.join(",")}; measured ${leadStatsText(measured)}`,
		);
		let peaksMet = true;
		let backMet = true;
		for (let i = 0; i < players; i++) {
			if (m.peak[i] > peakBounds[i]) peaksMet = false;
			if (m.backSec[i] > fallBounds[i]) backMet = false;
		}
		print(
			`${tag} FP12 criteria: dropped <= legacy ${verdict(sum(m.dropped) <= sum(l.dropped))} (${sum(
				m.dropped,
			)} vs ${sum(l.dropped)}; Revision 2's bump ${sum(r2.dropped)}); peak <= ceil(trip + ${
				LEAD.marginTicks
			}) + 1 ${verdict(peaksMet)} (legacy peak ${l.peak.join(
				",",
			)}); back within ${RECOVER_TICKS} tick within the fall bound ${verdict(backMet)}`,
		);

		it("both runs play through and step exactly the server's log; the measured clients echo", () => {
			for (const net of nets) {
				expect(net.session.finalizedTicks() > (SPIKE_AT + sec + WATCH_SEC) * SIM_HZ).toBe(true);
				expect(refusedInputs(net)).toBe(0);
				for (const c of net.clients) {
					expect(c.brokenReason()).toBe(undefined);
					expect(isPartyWiped(c.state)).toBe(false);
					expect(hashState(c.state)).toBe(hashState(net.replayLog(c.state.tick)));
				}
			}
			for (const c of measured.clients) expect(c.isLeadMeasured()).toBe(true);
		});

		it("the trouble raised the measured lead to at most ceil(its trip + margin) + 1", () => {
			for (let i = 0; i < players; i++) {
				// Revision 3 (FPD15): a late never bumps, so the 300 ms hold (a few echoes, under the top 5 % of the
				// window's ~150) does not raise the lead at all; Revision 2's bump did. The 1 s spike still moves the p95.
				if (isSpike) expect(m.peak[i] > m.before[i]).toBe(true);
				else expect(m.peak[i] >= m.before[i]).toBe(true);
				expect(m.peak[i] <= peakBounds[i]).toBe(true);
			}
		});

		it("the lead is back within one tick within windowSec + fallHoldSec + fallStepSec x excess + 0.5 s", () => {
			for (let i = 0; i < players; i++) expect(m.backSec[i] <= fallBounds[i]).toBe(true);
		});

		it("the legacy rule never comes back within the watch (10 s a tick)", () => {
			for (let i = 0; i < players; i++) expect(l.backSec[i]).toBe(math.huge);
		});
	});
}

// Review fixes (frame-pacing-lead review): an unpaced client's own hitch, the server's catch-up after a stall, an old
// server's silence and back, a player leaving. NET_RUNS' first network, with the stage cover and harmless bots.

/** The lead after a disturbance: its value just before `at`, its peak after, and seconds it stayed above before + 1. */
interface Disturbance {
	readonly before: number;
	readonly target: number;
	readonly peak: number;
	readonly upSec: number;
	readonly after: number;
}

/** Client `i`'s lead around a disturbance from `at` to `ends` (watched to the run's end). */
function disturbance(net: Net, i: number, at: number, ends: number, target: number): Disturbance {
	const tr = net.traces[i];
	let before = 0;
	let peak = 0;
	let up = 0;
	let after = 0;
	for (let k = 0; k < tr.at.size(); k++) {
		const t = tr.at[k];
		const lead = tr.lead[k];
		if (t < at) {
			before = lead;
			continue;
		}
		peak = math.max(peak, lead);
		after = lead;
		if (t >= ends && lead > before + 1) up += DT;
	}
	return { before, target, peak, upSec: up, after };
}

function disturbanceText(d: ReadonlyArray<Disturbance>): string {
	return (
		`lead before ${d.map((x) => x.before).join(",")} (target ${d.map((x) => x.target).join(",")}) peak ` +
		`${d.map((x) => x.peak).join(",")} above before + 1 for ${d
			.map((x) => string.format("%.2f s", x.upSec))
			.join(",")} after the end, at the end ${d.map((x) => x.after).join(",")}`
	);
}

const HITCH_AT = 7;
const HITCH_CLIENT = 1;
/** Seconds the run goes on after the disturbance. */
const HITCH_WATCH_SEC = 8;
/** An unsteady catch-up excused, the lead stays put: at most this far above its pre-hitch value, at most this long. */
const HITCH_PEAK_TICKS = 1;

for (const [kind, sec] of [
	["3 s hitch (one 3 s frame)", 3],
	["300 ms stall between pumps (dt normal)", 0.3],
] as const) {
	describe(`an unpaced measured client's ${kind}: catch-up is not a trip (review fix 1)`, () => {
		const [players, lo, hi] = NET_RUNS[0];
		const start = math.floor(HITCH_AT * NET_FPS + 0.5);
		const endFrame = start + math.floor(sec * NET_FPS + 0.5);
		const longFrame = sec > PACING.hitchFrameSec * 10;
		const nets: Net[] = [];
		const targets: number[] = [];
		for (const measured of [true, false]) {
			const net = new Net({
				players,
				latency: [lo, hi],
				pacing: false,
				measured,
				coverSec: STAGE_COVER_SEC,
				harmless: true,
				maxFrames: NET_FPS * (HITCH_AT + sec + HITCH_WATCH_SEC),
				onFrame: (n, frame) => {
					if (frame === start) {
						if (measured) targets.push(n.clients[HITCH_CLIENT].leadStats()!.target);
						n.frozen.add(HITCH_CLIENT);
					}
					if (frame === endFrame) {
						n.frozen.delete(HITCH_CLIENT);
						// A long frame (dt = the hitch) or a stall the frame's dt does not show (the clock moved on).
						n.nextDt.set(HITCH_CLIENT, longFrame ? sec + DT : DT);
					}
				},
			});
			net.run();
			nets.push(net);
		}
		const [measured, legacy] = nets;
		const m = disturbance(measured, HITCH_CLIENT, HITCH_AT, HITCH_AT + sec, targets[0] ?? 0);
		const l = disturbance(legacy, HITCH_CLIENT, HITCH_AT, HITCH_AT + sec, 0);
		const st = measured.clients[HITCH_CLIENT].leadStats()!;
		print(
			`[lockstep client ${kind}] measured ${disturbanceText([m])}; lates ${st.lates} excused ${
				st.excused
			} bumps ` + `${st.bumps}; legacy ${disturbanceText([l])}`,
		);

		it("both runs play through and step exactly the server's log", () => {
			for (const net of nets) {
				expect(net.session.finalizedTicks() > (HITCH_AT + sec + HITCH_WATCH_SEC - 1) * SIM_HZ).toBe(true);
				for (const c of net.clients) {
					expect(c.brokenReason()).toBe(undefined);
					expect(hashState(c.state)).toBe(hashState(net.replayLog(c.state.tick)));
				}
			}
		});

		it("the hitch's late inputs are excused: the lead does not jump past ceil(pre-hitch target) + 1", () => {
			expect(measured.clients[HITCH_CLIENT].isLeadMeasured()).toBe(true);
			expect(m.peak <= math.max(m.before, m.target) + HITCH_PEAK_TICKS).toBe(true);
		});
	});
}

describe("co-op over a simulated network with a 3 s server stall, measured lead (review fix 2)", () => {
	const [players, lo, hi] = NET_RUNS[0];
	const STALL_AT = 7;
	const STALL_SEC = 3;
	const WATCH_SEC = 8;
	/** The trips right after the catch-up are really about 2 ticks longer for ~2 s (printed): the lead may follow. */
	const AFTER_STALL_TICKS = 2;
	const nets: Net[] = [];
	/** Per net (measured paced, legacy paced, measured unpaced): each client's bumps when the stall began. */
	const bumpsBefore: number[][] = [];
	for (const [measured, pacing] of [
		[true, true],
		[false, true],
		[true, false],
	]) {
		const before: number[] = [];
		bumpsBefore.push(before);
		const net = new Net({
			players,
			latency: [lo, hi],
			pacing,
			measured,
			coverSec: STAGE_COVER_SEC,
			harmless: true,
			maxFrames: NET_FPS * (STALL_AT + STALL_SEC + WATCH_SEC),
			serverStall: { at: STALL_AT, sec: STALL_SEC },
			onFrame: (n, frame) => {
				if (!measured || frame !== math.floor(STALL_AT * NET_FPS + 0.5)) return;
				for (const c of n.clients) before.push(c.leadStats()!.bumps);
			},
		});
		net.run();
		nets.push(net);
	}
	const [measured, legacy, unpaced] = nets;
	/** Client 0's ground-truth trips (every frame the server received) before the stall and after its catch-up. */
	const truthText = (from: number, to: number) => {
		const w = measured.truth[0];
		const xs: number[] = [];
		for (let k = 0; k < w.at.size(); k++) if (w.at[k] >= from && w.at[k] < to) xs.push(w.trip[k]);
		xs.sort((p, q) => p < q);
		return `${from}-${to} s p50 ${string.format("%.1f", nearestRank(xs, 0.5) ?? -1)} p95 ${string.format(
			"%.1f",
			nearestRank(xs, 0.95) ?? -1,
		)}`;
	};
	print(
		`[lockstep server stall, measured] client 0 true trips: ${truthText(STALL_AT - 2, STALL_AT)}, ` +
			`${truthText(STALL_AT + STALL_SEC + 1, STALL_AT + STALL_SEC + 2)}, ${truthText(
				STALL_AT + STALL_SEC + 2,
				STALL_AT + STALL_SEC + 3,
			)}, ${truthText(STALL_AT + STALL_SEC + 3, STALL_AT + STALL_SEC + 5)} (the catch-up itself excused)`,
	);
	const m: Disturbance[] = [];
	const l: Disturbance[] = [];
	const u: Disturbance[] = [];
	for (let i = 0; i < players; i++) {
		m.push(disturbance(measured, i, STALL_AT, STALL_AT + STALL_SEC, 0));
		l.push(disturbance(legacy, i, STALL_AT, STALL_AT + STALL_SEC, 0));
		u.push(disturbance(unpaced, i, STALL_AT, STALL_AT + STALL_SEC, 0));
	}
	print(
		`[lockstep server stall, measured] ${disturbanceText(m)}; ${leadStatsText(
			measured,
		)}; bumps before the stall ${bumpsBefore[0].join(",")}; refused ${refusedInputs(measured)}`,
	);
	print(`[lockstep server stall, legacy]   ${disturbanceText(l)}; refused ${refusedInputs(legacy)}`);
	print(
		`[lockstep server stall, measured unpaced] ${disturbanceText(u)}; ${leadStatsText(
			unpaced,
		)}; bumps before the ` +
			`stall ${bumpsBefore[2].join(",")} (no pacer fast-forward: only the server's catching-up flag excuses)`,
	);

	it("the catch-up's lates are counted and excused (no bump); the lead ends within a tick of its pre-stall value", () => {
		for (const [net, d, before] of [
			[measured, m, bumpsBefore[0]],
			[unpaced, u, bumpsBefore[2]],
		] as const) {
			for (let i = 0; i < players; i++) {
				const st = net.clients[i].leadStats()!;
				expect(st.echoing).toBe(true);
				expect(st.lates > 0).toBe(true);
				expect(st.excused > 0).toBe(true);
				expect(st.bumps).toBe(before[i]);
				expect(d[i].peak <= d[i].before + AFTER_STALL_TICKS).toBe(true);
				expect(math.abs(d[i].after - d[i].before) <= 1).toBe(true);
			}
			expect(refusedInputs(net)).toBe(0);
		}
	});

	it("every client still steps exactly the server's log", () => {
		for (const net of nets) {
			for (const c of net.clients) expect(hashState(c.state)).toBe(hashState(net.replayLog(c.state.tick)));
		}
	});
});

describe("the measured lead switches legacy -> measured -> legacy -> measured with the echoes (review fix 5c)", () => {
	const [players, lo, hi] = NET_RUNS[0];
	const OFF_AT = 6;
	const OFF_SEC = 4;
	const RUN_SEC = 14;
	const who = 0;
	const net = new Net({
		players,
		latency: [lo, hi],
		pacing: true,
		measured: true,
		coverSec: STAGE_COVER_SEC,
		harmless: true,
		maxFrames: NET_FPS * RUN_SEC,
		echoOff: { client: who, at: OFF_AT, sec: OFF_SEC },
	});
	net.run();
	const tr = net.traces[who];
	/** The clock of every switch of isLeadMeasured(), and the state after it. */
	const switches: Array<{ at: number; on: boolean }> = [];
	let state = false;
	for (let k = 0; k < tr.at.size(); k++) {
		if (tr.measured[k] === state) continue;
		state = tr.measured[k];
		switches.push({ at: tr.at[k], on: state });
	}
	print(
		`[lockstep echo switch] client ${who}: ${switches
			.map((s) => `${s.on ? "measured" : "legacy"} at ${string.format("%.2f", s.at)} s`)
			.join(", ")}; echoes withheld ${OFF_AT}-${OFF_AT + OFF_SEC} s (timeout ${LEAD.echoTimeoutSec} s)`,
	);

	it("on with the first echo, off echoTimeoutSec after the last, on again with the next", () => {
		expect(switches.size()).toBe(3);
		expect(switches[0].on).toBe(true);
		expect(switches[0].at < OFF_AT).toBe(true);
		expect(switches[1].on).toBe(false);
		// The last echo delivered left before OFF_AT and arrived up to a down trip later.
		expect(switches[1].at >= OFF_AT + LEAD.echoTimeoutSec - hi - DT).toBe(true);
		expect(switches[1].at <= OFF_AT + LEAD.echoTimeoutSec + hi + DT).toBe(true);
		expect(switches[2].on).toBe(true);
		expect(switches[2].at >= OFF_AT + OFF_SEC).toBe(true);
		expect(switches[2].at <= OFF_AT + OFF_SEC + 2 * hi + 2 * DT).toBe(true);
	});

	it("the run plays through on every client; the others never stop measuring", () => {
		expect(net.session.finalizedTicks() > (RUN_SEC - 1) * SIM_HZ).toBe(true);
		for (let i = 0; i < players; i++) {
			const c = net.clients[i];
			expect(hashState(c.state)).toBe(hashState(net.replayLog(c.state.tick)));
			if (i === who) continue;
			const t = net.traces[i];
			let off = 0;
			for (let k = 0; k < t.at.size(); k++) if (t.at[k] >= OFF_AT - 1 && !t.measured[k]) off++;
			expect(off).toBe(0);
		}
	});
});

describe("a player who leaves a measured-lead run (review fix 5c)", () => {
	const [players, lo, hi] = NET_RUNS[0];
	const LEAVE_AT = 6;
	const RUN_SEC = 14;
	const who = 1;
	const leaveFrame = math.floor(LEAVE_AT * NET_FPS + 0.5);
	const base = { players, latency: [lo, hi] as const, pacing: true, measured: true, coverSec: STAGE_COVER_SEC };
	const net = new Net({
		...base,
		harmless: true,
		maxFrames: NET_FPS * RUN_SEC,
		onFrame: (n, frame) => {
			if (frame !== leaveFrame) return;
			n.session.leave(n.members[who]);
			n.gone.add(who);
		},
	});
	net.run();
	const stay = new Net({ ...base, harmless: true, maxFrames: NET_FPS * RUN_SEC });
	stay.run();
	/** Per remaining client: the mean lead after the leave, with and without it. */
	const means: Array<{ left: number; stayed: number }> = [];
	for (let i = 0; i < players; i++) {
		if (i === who) continue;
		const mean = (n: Net) => {
			const t = n.traces[i];
			let sum = 0;
			let count = 0;
			for (let k = 0; k < t.at.size(); k++) {
				if (t.at[k] < LEAVE_AT) continue;
				sum += t.lead[k];
				count++;
			}
			return count > 0 ? sum / count : 0;
		};
		means.push({ left: mean(net), stayed: mean(stay) });
	}
	const lastEcho = net.echoTickAt[who].size() > 0 ? net.echoTickAt[who][net.echoTickAt[who].size() - 1] : 0;
	print(
		`[lockstep leave] player ${who} left at ${LEAVE_AT} s, last echo with a tick at ${string.format(
			"%.2f",
			lastEcho,
		)} s; remaining clients' mean lead after it ${means
			.map((x) => string.format("%.2f (without the leave %.2f)", x.left, x.stayed))
			.join(", ")}`,
	);

	it("the left player's echoes carry no tick once its last inputs are in", () => {
		// Its inputs already on the way land within one up trip.
		expect(lastEcho <= LEAVE_AT + hi + DT).toBe(true);
	});

	it("the remaining clients keep measuring, their leads within a tick of the same run without the leave", () => {
		for (let i = 0; i < players; i++) {
			if (i === who) continue;
			expect(net.clients[i].isLeadMeasured()).toBe(true);
		}
		for (const x of means) expect(math.abs(x.left - x.stayed) <= 1).toBe(true);
		expect(net.result === undefined || net.result.ok).toBe(true);
	});
});

describe("co-op over a simulated network with a 3 s server stall: 3 players, 20-120 ms each way", () => {
	const [players, lo, hi] = NET_RUNS[0];
	const STALL_AT = 6;
	const STALL_SEC = 3;
	const RUN_SEC = 16;
	/** After the stall the paced depth is back within this many ticks of its target... */
	const NEAR_TICKS = 1.5;
	/** ...this long after the server resumed (seconds; the server's own catch-up plus the round trip). */
	const RECOVER_SEC = 1.25;
	const nets: Net[] = [];
	const depthOff: number[] = [];
	for (const paced of [false, true]) {
		const net = new Net({
			players,
			latency: [lo, hi],
			pacing: paced,
			maxFrames: NET_FPS * RUN_SEC,
			serverStall: { at: STALL_AT, sec: STALL_SEC },
			onFrame: (n) => {
				if (!paced || math.abs(n.now - (STALL_AT + STALL_SEC + RECOVER_SEC)) >= DT / 2) return;
				for (const c of n.clients) {
					const st = c.pacingStats()!;
					depthOff.push(st.depthMs / 1000 / DT - (st.targetTicks + st.phaseShiftTicks));
				}
			},
		});
		net.run();
		nets.push(net);
	}
	const [unpaced, paced] = nets;
	print(
		`[lockstep server stall] refused paced ${refusedInputs(paced)} unpaced ${refusedInputs(
			unpaced,
		)}; misses paced ` +
			`${paced.clients.map((c) => c.misses).join(",")} unpaced ${unpaced.clients
				.map((c) => c.misses)
				.join(",")}; ` +
			`net leads paced ${paced.clients.map((c) => c.netLead()).join(",")}; depth off target after ` +
			`${RECOVER_SEC} s ${depthOff.map((d) => string.format("%.2f", d)).join(",")} ticks`,
	);

	it("a paced client sees no refused inputs across the stall (the lead's depth is capped)", () => {
		expect(refusedInputs(paced)).toBe(0);
		expect(refusedInputs(unpaced)).toBe(0);
		for (const c of paced.clients) {
			expect(c.isPacing()).toBe(true);
			expect(c.brokenReason()).toBe(undefined);
			expect(c.pacingStats()!.depthTicks <= PACING.maxDepthTicks).toBe(true);
		}
		expect(DEFAULT_LOCKSTEP.maxInputLead + PACING.maxDepthTicks <= DEFAULT_LOCKSTEP.maxInputAhead).toBe(true);
	});

	it("the paced depth is back near its target soon after the server resumed (a fast-forward, not a slew)", () => {
		expect(depthOff.size()).toBe(players);
		for (const d of depthOff) expect(math.abs(d) <= NEAR_TICKS).toBe(true);
	});

	it("every client still steps exactly the server's log", () => {
		for (const net of nets) {
			expect(net.session.finalizedTicks() > (RUN_SEC - STALL_SEC - 1) * SIM_HZ).toBe(true);
			for (const c of net.clients) expect(hashState(c.state)).toBe(hashState(net.replayLog(c.state.tick)));
		}
	});
});

// Smoothness (docs/FRAME_PACING.md FP4): the same 3-player 20-120 ms network with frame pacing on and off. Paced, a
// client steps one tick per 16.7 ms whatever the arrivals do; unpaced it steps whatever arrived that frame.

/** Frames before this (simulated seconds) are the warm-up: the pacer is still measuring and slewing to its depth. */
const PACING_WARMUP_SEC = 2;
/** Paced at 60 fps, at least this share of frames after the warm-up step exactly one tick. */
const PACED_ONE_TICK_SHARE = 0.99;
/** Paced, holds stay under this many per client per 10 s of run. */
const PACED_HOLDS_PER_10_SEC = 1;
const TEN_SEC = 10;
/** The step-count buckets printed: 0, 1, 2, 3 or more ticks in one frame. */
const STEP_BUCKETS = 4;
/** The high-refresh run: frames per second, and how long it plays (seconds; cut by maxFrames, no wipe needed). */
const HIGH_FPS = 144;
const HIGH_FPS_RUN_SEC = 8;

interface StepShares {
	/** Frames after the warm-up, over every client. */
	readonly frames: number;
	/** Share of those frames stepping 0, 1, 2, 3+ ticks. */
	readonly shares: number[];
	/** Per client: holds after the warm-up, and the length (s) of the run after it. */
	readonly holds: number[];
	readonly seconds: number[];
}

function stepShares(net: Net): StepShares {
	const counts: number[] = [];
	for (let b = 0; b < STEP_BUCKETS; b++) counts.push(0);
	let frames = 0;
	const holds: number[] = [];
	const seconds: number[] = [];
	for (const tr of net.traces) {
		const n = tr.at.size();
		for (let k = 0; k < n; k++) {
			if (tr.at[k] < PACING_WARMUP_SEC) continue;
			counts[math.min(tr.stepped[k], STEP_BUCKETS - 1)]++;
			frames++;
		}
		let first = 0;
		while (first < n && tr.at[first] < PACING_WARMUP_SEC) first++;
		const before = first > 0 ? tr.holds[first - 1] : 0;
		holds.push(n > 0 ? tr.holds[n - 1] - before : 0);
		seconds.push(n > first ? tr.at[n - 1] - tr.at[first] : 0);
	}
	return { frames, shares: counts.map((c) => (frames > 0 ? c / frames : 0)), holds, seconds };
}

function sharesText(s: StepShares): string {
	const pct = s.shares.map((x) => string.format("%.1f%%", x * 100));
	return `0: ${pct[0]}, 1: ${pct[1]}, 2: ${pct[2]}, 3+: ${pct[3]} of ${s.frames} frames; holds ${s.holds.join(",")}`;
}

describe("co-op frame pacing over a simulated network: 3 players, 20-120 ms each way, 60 fps", () => {
	// NET_RUNS' first network with pacing on and off (built once, shared with the describes above).
	const [players] = NET_RUNS[0];
	const paced = finishedNet(0, true);
	const unpaced = finishedNet(0, false);
	const pacedShares = stepShares(paced);
	const unpacedShares = stepShares(unpaced);
	print(`[lockstep pacing] paced   ${sharesText(pacedShares)}`);
	print(`[lockstep pacing] unpaced ${sharesText(unpacedShares)}`);
	print(
		`[lockstep pacing] paced net leads ${paced.clients.map((c) => c.netLead()).join(",")}, depths ${paced.clients
			.map((c) => c.pacingStats()?.depthTicks ?? 0)
			.join(",")}, jitter p95 ${paced.clients
			.map((c) => string.format("%.0f", c.pacingStats()?.jitterMs ?? 0))
			.join(",")} ms`,
	);

	it("pacing is on for every paced client, off for the others", () => {
		for (const c of paced.clients) {
			expect(c.isPacing()).toBe(true);
			expect(c.pacingStats()?.started).toBe(true);
		}
		for (const c of unpaced.clients) {
			expect(c.isPacing()).toBe(false);
			expect(c.pacingStats()).toBe(undefined);
		}
	});

	it("after the warm-up at least 99 % of frames step exactly one tick", () => {
		expect(pacedShares.frames > 0).toBe(true);
		expect(pacedShares.shares[1] >= PACED_ONE_TICK_SHARE).toBe(true);
	});

	it("holds stay under 1 per 10 s after the warm-up", () => {
		for (let i = 0; i < players; i++) {
			expect(pacedShares.seconds[i] > TEN_SEC).toBe(true);
			expect(pacedShares.holds[i] * TEN_SEC < PACED_HOLDS_PER_10_SEC * pacedShares.seconds[i]).toBe(true);
		}
	});
});

describe(`co-op frame pacing at ${HIGH_FPS} fps: 3 players, 20-120 ms each way`, () => {
	const [players, lo, hi] = NET_RUNS[0];
	const net = new Net({
		players,
		latency: [lo, hi],
		pacing: true,
		fps: HIGH_FPS,
		maxFrames: HIGH_FPS * HIGH_FPS_RUN_SEC,
	});
	net.run();
	const shares = stepShares(net);
	print(`[lockstep pacing ${HIGH_FPS} fps] ${sharesText(shares)}`);

	it("alpha stays in [0, 1) and every frame after the warm-up steps 0 or 1 tick", () => {
		let checked = 0;
		for (const tr of net.traces) {
			for (let k = 0; k < tr.at.size(); k++) {
				const a = tr.alpha[k];
				expect(a >= 0 && a < 1).toBe(true);
				if (tr.at[k] < PACING_WARMUP_SEC) continue;
				expect(tr.stepped[k] <= 1).toBe(true);
				checked++;
			}
		}
		expect(checked > 0).toBe(true);
		expect(shares.shares[2] + shares.shares[3]).toBe(0);
	});

	it("every client stepped the same ticks as the server's log", () => {
		const ticks = net.clients[0].state.tick;
		expect(ticks > (HIGH_FPS_RUN_SEC - PACING_WARMUP_SEC) * SIM_HZ).toBe(true);
		for (const c of net.clients) {
			expect(c.brokenReason()).toBe(undefined);
			expect(hashState(c.state)).toBe(hashState(net.replayLog(c.state.tick)));
		}
	});
});

// The input lead over a latency that changes (docs/FRAME_PACING.md FP1): one client against the server's relay, one
// tick finalized per frame, every tick broadcast at once; the latency each way is picked per frame.

/** One-way FIFO delivery at a time the sender picks (a latency that falls never reorders, like a RemoteEvent). */
class DelayQueue {
	private readonly queue: Message[] = [];
	private last = 0;

	send(at: number, deliver: () => void): void {
		const due = math.max(this.last, at);
		this.last = due;
		this.queue.push({ at: due, deliver });
	}

	pump(now: number): void {
		while (this.queue.size() > 0 && this.queue[0].at <= now) this.queue.remove(0)!.deliver();
	}
}

/** One sampled input: the frame, state.tick when it was sampled (the next tick to step), the tick it was sent for. */
interface LeadSend {
	readonly frame: number;
	readonly next: number;
	readonly tick: number;
	/** client.misses when it was sampled (this step's deadline check included). */
	readonly misses: number;
	/** The buttons the batch carried for it (a latched tap included). */
	readonly buttons: number;
}

interface LeadNetOptions {
	/**
	 * The server echoes (docs/FRAME_PACING.md FP11's measured variant): each frame's broadcast carries the client's input
	 * echo computed as LockstepSession does (the lowest-slack frame received since the last broadcast, X + 1 - R with
	 * the receipt R at finalizedTicks(), the late frames since), and the client gets the clock on receive and pump.
	 * Off: no clock and no echo reach the client, as before.
	 */
	readonly echo?: boolean;
	/** A sample on a step that sends nothing (sample(false): a fall's skipped tick) presses FIRE: a one-frame tap. */
	readonly tapOnSkip?: boolean;
}

class LeadNet {
	readonly client: LockstepClient;
	readonly relay: LockstepRelay;
	/** Every sampled input, in order, with the tick the batches actually carried it for. */
	readonly sends: LeadSend[] = [];
	/** Per pump that stepped: state.tick, inputLead() and the last tick sent so far. */
	readonly reports: Array<{ readonly next: number; readonly lead: number; readonly lastSent: number }> = [];
	/** nextInputTick() as seen inside each sample() that sends (must be the tick that input was sent for). */
	readonly sampledTargets: number[] = [];
	/** Per frame: netLead() and client.misses after the pump. */
	readonly leads: number[] = [];
	readonly missesAt: number[] = [];
	/** The frames of the samples not sent (sample(false)), in order. */
	readonly skippedAt: number[] = [];
	/** Every merged frame the relay finalized (the log). */
	readonly log: InputFrame[] = [];
	steps = 0;
	private readonly enc = new MergedEncoder(1);
	private readonly down = new DelayQueue();
	private readonly up = new DelayQueue();
	private samples = 0;
	/** The echo pending for the next broadcast (as LockstepSession keeps it). */
	private echoTick: number | undefined;
	private echoSlack = 0;
	private echoLates = 0;
	/** The frame's clock while the down queue delivers. */
	private clock = 0;

	constructor(
		private readonly tunables: LockstepTunables,
		private readonly latencyAt: (frame: number) => number,
		private readonly opts: LeadNetOptions = {},
	) {
		const setup = buildEndlessRunConfig(SEED, 1);
		this.client = new LockstepClient({
			runId: "lead",
			seed: SEED,
			spawn: setup.spawn!,
			config: setup.config,
			players: 1,
			localIndex: 0,
			tunables,
		});
		this.relay = new LockstepRelay(1, tunables);
	}

	run(frames: number): void {
		const c = this.client;
		const echoing = this.opts.echo === true;
		for (let frame = 0; frame < frames; frame++) {
			const now = frame * DT;
			const latency = this.latencyAt(frame);
			this.up.pump(now);
			const tick = this.relay.finalizedTicks();
			const row = this.relay.finalizeNext();
			this.log.push(row[0]);
			const data = this.enc.encode([row]);
			if (echoing) {
				const echo = encodeInputEcho(
					{
						tick: this.echoTick,
						slack: this.echoTick !== undefined ? this.echoSlack : 0,
						lates: this.echoLates,
					},
					tick,
				);
				this.echoTick = undefined;
				this.echoLates = 0;
				// Delivered at the frame's clock (the down queue is pumped once per frame, below).
				this.down.send(now + latency, () => c.receive(tick, data, this.clock, echo));
			} else {
				this.down.send(now + latency, () => c.receive(tick, data));
			}
			this.clock = now;
			this.down.pump(now);
			const pending: Array<{ next: number; misses: number }> = [];
			const res = c.pump(
				DT,
				(sending) => {
					if (!sending) {
						this.skippedAt.push(frame);
						return { ...EMPTY_INPUT, buttons: this.opts.tapOnSkip === true ? Button.FIRE : 0 };
					}
					pending.push({ next: c.state.tick, misses: c.misses });
					this.sampledTargets.push(c.nextInputTick());
					this.samples++;
					// Aim only (the player stands still); every sample differs, so a repeat-last is a visible miss.
					return { ...EMPTY_INPUT, aimX: 1 + (this.samples % AXIS_MAX) };
				},
				echoing ? now : undefined,
			);
			this.steps += res.stepped;
			this.leads.push(c.netLead());
			this.missesAt.push(c.misses);
			let k = 0;
			for (const b of res.inputs) {
				const batch = decodeInputBatch(b.data, this.tunables.maxBatchFrames)!;
				for (let j = 0; j < batch.size(); j++) {
					const p = pending[k];
					this.sends.push({
						frame,
						next: p.next,
						tick: b.firstTick + j,
						misses: p.misses,
						buttons: batch[j].buttons,
					});
					k++;
				}
				this.up.send(now + latency, () => {
					// The receipt R: one tick finalized per frame at the frame's start, so R = finalizedTicks().
					const receipt = this.relay.finalizedTicks();
					const r = this.relay.submit(0, b.firstTick, batch);
					if (r.accepted + r.late === 0) return;
					// A batch's lowest slack is its first frame's; the window keeps the lowest.
					const slack = b.firstTick + 1 - receipt;
					if (this.echoTick === undefined || slack < this.echoSlack) {
						this.echoTick = b.firstTick;
						this.echoSlack = slack;
					}
					this.echoLates += r.late;
				});
			}
			expect(k).toBe(pending.size());
			if (res.stepped > 0) {
				const lastSent = this.sends.size() > 0 ? this.sends[this.sends.size() - 1].tick : -1;
				this.reports.push({ next: c.state.tick, lead: c.inputLead(), lastSent });
			}
		}
	}
}

/** The effective lead of a send: the tick it went out for minus the next tick to step when it was sampled. */
function leadOf(s: LeadSend): number {
	return s.tick - s.next;
}

describe("the input lead follows the latency both ways (FP1)", () => {
	// The legacy lead (the miss counter this describe pins) and no pacing (no clock is passed).
	const tunables: LockstepTunables = { ...DEFAULT_LOCKSTEP, leadDecayTicks: 15, pacing: undefined, lead: undefined };
	const floor = tunables.inputDelay;
	const CALM_LATENCY = 0.005;
	const SPIKE_LATENCY = 0.15;
	const SPIKE1_START = 60;
	const SPIKE1_END = 240;
	const SPIKE2_START = 760;
	const SPIKE2_END = 880;
	const FRAMES = 940;
	const net = new LeadNet(tunables, (frame) =>
		(frame >= SPIKE1_START && frame < SPIKE1_END) || (frame >= SPIKE2_START && frame < SPIKE2_END)
			? SPIKE_LATENCY
			: CALM_LATENCY,
	);
	net.run(FRAMES);
	const sends = net.sends;
	// The calm stretch between the spikes: from the first send after spike 1's last miss to the last send before
	// spike 2 starts.
	let calmEnd = 0;
	while (calmEnd < sends.size() && sends[calmEnd].frame < SPIKE2_START) calmEnd++;
	const calmMisses = sends[calmEnd - 1].misses;
	let calmStart = 0;
	while (sends[calmStart].misses < calmMisses) calmStart++;
	const peak = leadOf(sends[calmStart]);
	print(
		`[lockstep lead] steps ${net.steps} sends ${sends.size()} misses ${net.client.misses}; ` +
			`peak ${peak}, calm sends ${calmStart}..${calmEnd - 1}, lead at spike 2 ${leadOf(sends[calmEnd - 1])}`,
	);

	it("after a spike the effective lead falls back to inputDelay, one tick per leadDecayTicks clean ticks", () => {
		expect(net.client.brokenReason()).toBe(undefined);
		expect(isPartyWiped(net.client.state)).toBe(false);
		expect(calmMisses > 0).toBe(true);
		expect(peak >= floor + 10).toBe(true); // the spike raised it well above the floor
		// Measured in stepped ticks (state.tick when each send was sampled): every level after the first holds for at
		// least leadDecayTicks steps (clean deadline checks), and the whole fall takes no more than that per level plus
		// the ticks already in flight at the first drop (sent at the old lead, never checked: the spike's gaps).
		let level = peak;
		let levelFrom = sends[calmStart].next;
		let firstDrop = -1;
		let drops = 0;
		for (let k = calmStart; k < calmEnd; k++) {
			const s = sends[k];
			const lead = leadOf(s);
			if (lead === level) continue;
			expect(lead).toBe(level - 1); // down by exactly one at a time
			if (drops === 0) firstDrop = s.next;
			else expect(s.next - levelFrom >= tunables.leadDecayTicks).toBe(true);
			level = lead;
			levelFrom = s.next;
			drops++;
		}
		expect(level).toBe(floor);
		expect(drops).toBe(peak - floor);
		expect(levelFrom - firstDrop <= (drops - 1) * tunables.leadDecayTicks + peak).toBe(true);
		// inputLead() reports the effective lead: how far the sent inputs reach past the next tick to step.
		for (const r of net.reports) {
			if (r.lastSent >= 0) expect(r.lead).toBe(r.lastSent - r.next);
		}
		expect(net.reports[net.reports.size() - 1].lead).toBe(leadOf(sends[sends.size() - 1]));
	});

	it("after the lead decayed, a new spike's first miss raises the effective lead at once (no silent misses)", () => {
		expect(leadOf(sends[calmEnd - 1])).toBe(floor);
		let raised = 0;
		for (let k = calmEnd; k < sends.size(); k++) {
			const prev = sends[k - 1];
			const cur = sends[k];
			const missed = cur.misses - prev.misses;
			if (missed === 0) continue;
			// Every miss counts: the very next send goes out that many ticks further ahead.
			expect(leadOf(cur) - leadOf(prev)).toBe(missed);
			raised += missed;
		}
		expect(raised).toBe(net.client.misses - calmMisses);
		expect(raised >= 10).toBe(true);
	});

	it("a step whose target was already sent sends nothing; no tick is ever sent twice", () => {
		// The batches carry exactly the sampled inputs, each for the tick nextInputTick() named inside sample().
		expect(net.sampledTargets.size()).toBe(sends.size());
		for (let k = 0; k < sends.size(); k++) expect(sends[k].tick).toBe(net.sampledTargets[k]);
		let skipped = 0;
		for (let k = 1; k < sends.size(); k++) {
			const prev = sends[k - 1];
			const cur = sends[k];
			expect(cur.tick > prev.tick).toBe(true);
			const gap = cur.next - prev.next - 1;
			if (gap === 0) continue;
			// One step between them sent nothing: the lead had just fallen by one, so its target was prev.tick.
			expect(gap).toBe(1);
			expect(leadOf(cur)).toBe(leadOf(prev) - 1 + (cur.misses - prev.misses));
			skipped++;
		}
		// Every decay of the lead is one step that sent nothing (decays = misses - the net rise); every other step
		// sent once.
		expect(skipped > 0).toBe(true);
		expect(skipped).toBe(net.client.misses - (leadOf(sends[sends.size() - 1]) - floor));
		expect(net.steps).toBe(sends.size() + skipped);
	});
});

describe("the measured input lead follows the latency both ways (FP1's scenario with echoes, FP11)", () => {
	// FP1's one-client relay, now echoing like LockstepSession; a longer calm so the fall is measured end to end. The
	// legacy rule (lead undefined, its real leadDecayTicks) on the same schedule for comparison.
	const CALM_LATENCY = 0.005;
	const SPIKE_LATENCY = 0.15;
	const SPIKE1_START = 60;
	const SPIKE1_END = 240;
	const SPIKE2_START = 1500;
	const SPIKE2_END = 1620;
	const FRAMES = 1700;
	/** Slack on the fall bound (seconds): the down trip and the frames between the window's expiry and the next echo. */
	const FALL_SLACK_SEC = 0.5;
	const latency = (frame: number) =>
		(frame >= SPIKE1_START && frame < SPIKE1_END) || (frame >= SPIKE2_START && frame < SPIKE2_END)
			? SPIKE_LATENCY
			: CALM_LATENCY;
	const measured = new LeadNet({ ...DEFAULT_LOCKSTEP, pacing: undefined, lead: LEAD }, latency, {
		echo: true,
		tapOnSkip: true,
	});
	measured.run(FRAMES);
	const legacyTunables: LockstepTunables = { ...DEFAULT_LOCKSTEP, pacing: undefined, lead: undefined };
	const legacy = new LeadNet(legacyTunables, latency, { tapOnSkip: true });
	legacy.run(FRAMES);

	/** Spike 1's peak net lead, the calm lead just before spike 2, and the frame it fell to that for good. */
	function fallOf(net: LeadNet): { peak: number; calm: number; at: number } {
		const calm = net.leads[SPIKE2_START - 1];
		let peak = 0;
		for (let f = SPIKE1_START; f < SPIKE2_START; f++) peak = math.max(peak, net.leads[f]);
		let at = SPIKE2_START - 1;
		while (at > SPIKE1_END && net.leads[at - 1] <= calm) at--;
		return { peak, calm, at };
	}
	const m = fallOf(measured);
	const l = fallOf(legacy);
	const fallSec = (m.at - SPIKE1_END) * DT;
	// DEFAULT_LOCKSTEP has prediction, so the lead has its ceiling (Revision 3, Design 13): unpaced (depth 0) the cover's
	// room is the whole prediction cap, and the spike's trips hold the lead until they leave the cover's window, not the
	// base's (Revision 2's bound used windowSec).
	const fallWindowSec = DEFAULT_LOCKSTEP.prediction !== undefined ? LEAD.coverWindowSec : LEAD.windowSec;
	const bound = fallWindowSec + LEAD.fallHoldSec + LEAD.fallStepSec * (m.peak - m.calm) + FALL_SLACK_SEC;
	const legacyPerTick = legacyTunables.leadDecayTicks / SIM_HZ;
	const spikeMisses = (net: LeadNet) =>
		`spike 1 ${net.missesAt[SPIKE2_START - 1]}, spike 2 ${
			net.missesAt[FRAMES - 1] - net.missesAt[SPIKE2_START - 1]
		}`;
	print(`[lockstep lead] misses measured ${spikeMisses(measured)}; legacy ${spikeMisses(legacy)}`);
	print(
		`[lockstep lead measured] spike 1 peak ${m.peak}, calm ${m.calm}: back ${string.format("%.2f", fallSec)} s ` +
			`after the latency dropped (bound ${string.format("%.2f", bound)} s); falls ${
				measured.client.leadStats()!.falls
			} skipped samples ${measured.skippedAt.size()}; misses ${measured.client.misses} (spike 2 lead ${
				measured.leads[SPIKE2_END - 1]
			})`,
	);
	print(
		`[lockstep lead legacy]   spike 1 peak ${l.peak}: ${l.peak - legacy.leads[SPIKE2_START - 1]} ticks down in ` +
			`${string.format("%.1f", (SPIKE2_START - SPIKE1_END) * DT)} s, ${string.format(
				"%.0f",
				legacyPerTick,
			)} s a tick: ` +
			`back to ${legacyTunables.inputDelay} after ~${string.format(
				"%.0f",
				(l.peak - legacyTunables.inputDelay) * legacyPerTick,
			)} s; misses ${legacy.client.misses}`,
	);

	it("is measured, and falls back within the cover's window + fallHoldSec + fallStepSec x excess + 0.5 s", () => {
		expect(measured.client.brokenReason()).toBe(undefined);
		expect(isPartyWiped(measured.client.state)).toBe(false);
		expect(measured.client.isLeadMeasured()).toBe(true);
		expect(m.peak >= m.calm + 10).toBe(true); // the spike raised it well above the calm lead
		expect(m.calm <= LEAD.marginTicks + 2 + DEFAULT_LOCKSTEP.inputDelay).toBe(true);
		expect(fallSec <= bound).toBe(true);
		// The legacy rule has barely started down by then.
		expect(legacy.leads[SPIKE2_START - 1] > m.calm).toBe(true);
	});

	it("a tap sampled on a fall's skipped tick reaches the log (the next frame sent carries it)", () => {
		const sends = measured.sends;
		let latched = 0;
		let logged = 0;
		for (let k = 1; k < sends.size(); k++) {
			const skipped = sends[k].next - sends[k - 1].next - 1;
			if (skipped === 0) {
				expect(sends[k].buttons).toBe(0);
				continue;
			}
			expect(bit32.band(sends[k].buttons, Button.FIRE)).toBe(Button.FIRE);
			latched++;
			// Finalized before the run's end: the server's log has the tap at the tick it was sent for.
			if (sends[k].tick >= measured.log.size()) continue;
			expect(bit32.band(measured.log[sends[k].tick].buttons, Button.FIRE)).toBe(Button.FIRE);
			logged++;
		}
		print(
			`[lockstep lead measured] taps on skipped ticks: ${latched} sent with the next frame, ${logged} in the log`,
		);
		expect(logged > 0).toBe(true);
		expect(latched).toBe(measured.skippedAt.size());
		// The legacy rule never samples a skipped tick: the tap is never seen.
		expect(legacy.skippedAt.size()).toBe(0);
	});

	it("no tick is ever sent twice; every sample that is sent goes out for nextInputTick()", () => {
		const sends = measured.sends;
		expect(measured.sampledTargets.size()).toBe(sends.size());
		for (let k = 0; k < sends.size(); k++) expect(sends[k].tick).toBe(measured.sampledTargets[k]);
		for (let k = 1; k < sends.size(); k++) expect(sends[k].tick > sends[k - 1].tick).toBe(true);
	});
});

describe("LockstepClient.end (the server decided the run before the wipe)", () => {
	function client(): { c: LockstepClient; enc: MergedEncoder } {
		const setup = buildEndlessRunConfig(SEED, 2);
		const c = new LockstepClient({
			runId: "coop",
			seed: SEED,
			spawn: setup.spawn!,
			config: setup.config,
			players: 2,
			localIndex: 0,
			tunables: TUNABLES,
		});
		return { c, enc: new MergedEncoder(2) };
	}
	const idle = (n: number) => {
		const ticks: InputFrame[][] = [];
		for (let t = 0; t < n; t++) ticks.push([{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }]);
		return ticks;
	};

	it("ends the run on this client: over, nothing more stepped or sent", () => {
		const { c, enc } = client();
		expect(c.receive(0, enc.encode(idle(TUNABLES.hashEvery)))).toBe(true);
		for (let k = 0; k < 10 && c.backlog() > 0; k++) c.pump(DT, () => EMPTY_INPUT);
		expect(c.state.tick).toBe(TUNABLES.hashEvery);
		expect(c.isOver()).toBe(false);
		expect(c.endReason()).toBe(undefined);
		c.end("desync");
		expect(c.isOver()).toBe(true);
		expect(c.endReason()).toBe("desync");
		expect(c.unacknowledged()).toBe(0);
		// Frames already on the way are not stepped: no inputs, hashes or final go out.
		expect(c.receive(TUNABLES.hashEvery, enc.encode(idle(TUNABLES.hashEvery)))).toBe(true);
		const res = c.pump(DT, () => EMPTY_INPUT);
		expect([res.stepped, res.inputs.size(), res.hashes.size(), res.final]).toEqual([0, 0, 0, undefined]);
		expect(c.state.tick).toBe(TUNABLES.hashEvery);
	});

	it("does nothing to the reason once the party is down (a wipe's verdict)", () => {
		const { c, enc } = client();
		// Both players leave at tick 0: the party is down at once.
		const left: InputFrame[][] = [[{ ...LEFT_FRAME }, { ...LEFT_FRAME }]];
		expect(c.receive(0, enc.encode(left))).toBe(true);
		const res = c.pump(DT, () => EMPTY_INPUT);
		expect(res.final).never.toBe(undefined);
		expect(c.isOver()).toBe(true);
		c.end("desync");
		expect(c.endReason()).toBe(undefined);
		expect(c.isOver()).toBe(true);
	});
});

describe("LockstepClient pacing activation (docs/FRAME_PACING.md FP3)", () => {
	const ONE_IDLE: InputFrame[][] = [[{ ...EMPTY_INPUT }]];
	function client(tunables: LockstepTunables): { c: LockstepClient; enc: MergedEncoder } {
		const setup = buildEndlessRunConfig(SEED, 1);
		const c = new LockstepClient({
			runId: "pace",
			seed: SEED,
			spawn: setup.spawn!,
			config: setup.config,
			players: 1,
			localIndex: 0,
			tunables,
		});
		return { c, enc: new MergedEncoder(1) };
	}

	it("without pacing configured, `now` changes nothing: every queued frame at once, today's alpha", () => {
		const { c, enc } = client(TUNABLES);
		for (let t = 0; t < 5; t++) expect(c.receive(t, enc.encode(ONE_IDLE), t * DT)).toBe(true);
		const res = c.pump(DT, () => EMPTY_INPUT, DT);
		expect(res.stepped).toBe(5);
		expect(c.isPacing()).toBe(false);
		expect(c.pacingStats()).toBe(undefined);
		expect(c.getAlpha()).toBe(0);
		expect(c.nextInputTick()).toBe(c.state.tick + c.netLead());
	});

	it("with pacing configured but no `now`, it behaves as before (not pacing)", () => {
		const { c, enc } = client({ ...TUNABLES, pacing: PACING });
		for (let t = 0; t < 5; t++) expect(c.receive(t, enc.encode(ONE_IDLE))).toBe(true);
		expect(c.pump(DT, () => EMPTY_INPUT).stepped).toBe(5);
		expect(c.isPacing()).toBe(false);
		expect(c.pacingStats()).toBe(undefined);
	});

	it("paced: one tick per frame from a startDepthTicks buffer; the lead covers the depth; it never turns off", () => {
		const { c, enc } = client({ ...TUNABLES, pacing: PACING });
		const FRAMES = 120;
		const NO_CLOCK_FROM = 60;
		const NO_CLOCK_TO = 70;
		for (let frame = 0; frame < FRAMES; frame++) {
			const now = frame * DT;
			// One tick arrives per frame; frames 60-69 pass no clock at all (a caller mistake): the client keeps pacing
			// on its last clock + dt and stamps those arrivals with it.
			const clockless = frame >= NO_CLOCK_FROM && frame < NO_CLOCK_TO;
			expect(c.receive(frame, enc.encode(ONE_IDLE), clockless ? undefined : now)).toBe(true);
			const res = c.pump(DT, () => EMPTY_INPUT, clockless ? undefined : now);
			expect(c.isPacing()).toBe(true);
			// Frame k is due startDepthTicks ticks after it arrived.
			expect(res.stepped).toBe(frame < PACING.startDepthTicks ? 0 : 1);
			const stats = c.pacingStats()!;
			expect(stats.holds).toBe(0);
			expect(stats.depthTicks).toBe(PACING.startDepthTicks);
			expect(c.backlog()).toBe(math.min(frame + 1, PACING.startDepthTicks));
			const a = c.getAlpha();
			expect(a >= 0 && a < 1).toBe(true);
			expect(c.nextInputTick()).toBe(c.state.tick + c.netLead() + stats.depthTicks);
			if (c.state.tick > 0) expect(c.inputLead()).toBe(c.netLead() + stats.depthTicks);
		}
	});
});

describe("LockstepClient measured lead wiring (docs/FRAME_PACING.md FP11)", () => {
	const ONE_IDLE: InputFrame[][] = [[{ ...EMPTY_INPUT }]];
	const MEASURED: LockstepTunables = { ...TUNABLES, lead: LEAD };
	function client(tunables: LockstepTunables): { c: LockstepClient; enc: MergedEncoder } {
		const setup = buildEndlessRunConfig(SEED, 1);
		const c = new LockstepClient({
			runId: "lead-wiring",
			seed: SEED,
			spawn: setup.spawn!,
			config: setup.config,
			players: 1,
			localIndex: 0,
			tunables,
		});
		return { c, enc: new MergedEncoder(1) };
	}
	/** Tick 0 arrives at `now` and is stepped: the first input goes out for 1 + inputDelay. */
	function firstStep(c: LockstepClient, enc: MergedEncoder, now: number | undefined): number {
		expect(c.receive(0, enc.encode(ONE_IDLE), now)).toBe(true);
		expect(c.pump(DT, () => EMPTY_INPUT, now).stepped).toBe(1);
		return 1 + TUNABLES.inputDelay;
	}

	it("an echo with a clock turns the measured lead on; its lates are the misses", () => {
		const { c, enc } = client(MEASURED);
		const target = firstStep(c, enc, 0);
		expect(c.isLeadMeasured()).toBe(false);
		expect(c.netLead()).toBe(TUNABLES.inputDelay);
		expect(c.receive(1, enc.encode(ONE_IDLE), DT, encodeInputEcho({ tick: target, slack: 2, lates: 0 }, 1))).toBe(
			true,
		);
		expect(c.isLeadMeasured()).toBe(true);
		const st = c.leadStats()!;
		expect(st.samples).toBe(1);
		expect(st.tripMax).toBe(target - 1 - 2); // sent at state.tick 1, 2 ticks to spare, no buffer
		// The next input arrives a tick late (as the session echoes it: its tick, slack <= 0, the late frame counted):
		// a miss (no mismatch is counted for it again) and a bump.
		const res = c.pump(DT, () => EMPTY_INPUT, DT);
		expect(res.stepped).toBe(1);
		expect(res.inputs.size()).toBe(1);
		const late = res.inputs[0].firstTick;
		expect(
			c.receive(2, enc.encode(ONE_IDLE), 2 * DT, encodeInputEcho({ tick: late, slack: -1, lates: 1 }, 2)),
		).toBe(true);
		// Revision 3 (FPD15): counted, never bumped (the bump is Revision 2's, below).
		expect([c.misses, c.mismatches, c.leadStats()!.lates, c.leadStats()!.bumps]).toEqual([1, 0, 1, 0]);
	});

	it("with lateBump (KV_LeadBump, Revision 2's rule) the same late bumps", () => {
		const { c, enc } = client({ ...MEASURED, lead: { ...LEAD, lateBump: true } });
		const target = firstStep(c, enc, 0);
		c.receive(1, enc.encode(ONE_IDLE), DT, encodeInputEcho({ tick: target, slack: 2, lates: 0 }, 1));
		const late = c.pump(DT, () => EMPTY_INPUT, DT).inputs[0].firstTick;
		c.receive(2, enc.encode(ONE_IDLE), 2 * DT, encodeInputEcho({ tick: late, slack: -1, lates: 1 }, 2));
		expect([c.misses, c.leadStats()!.lates, c.leadStats()!.bumps]).toEqual([1, 1, 1]);
	});

	it("the lead's ceiling is the prediction cap (FP19): none without prediction", () => {
		const off = client(MEASURED).c;
		expect(off.leadStats()!.ceiling).toBe(undefined);
		const { c, enc } = client({ ...MEASURED, prediction: PREDICTION });
		expect(c.leadStats()!.ceiling).toBe(PREDICTION.maxTicks);
		firstStep(c, enc, 0);
		// Unpaced: the send added no depth, so C is the whole cap.
		expect(c.leadStats()!.ceiling).toBe(PREDICTION.maxTicks);
	});

	it("a malformed echo is ignored: the stream goes on, the lead stays on the legacy rule", () => {
		const { c, enc } = client(MEASURED);
		firstStep(c, enc, 0);
		expect(c.receive(1, enc.encode(ONE_IDLE), DT, buffer.create(3))).toBe(true);
		expect(c.receive(2, enc.encode(ONE_IDLE), 2 * DT, "junk")).toBe(true);
		expect(c.brokenReason()).toBe(undefined);
		expect(c.isLeadMeasured()).toBe(false);
		expect(c.pump(DT, () => EMPTY_INPUT, 3 * DT).stepped).toBe(2);
	});

	it("without any clock no echo is fed: the legacy rule, as before", () => {
		const { c, enc } = client(MEASURED);
		const target = firstStep(c, enc, undefined);
		const echo = encodeInputEcho({ tick: target, slack: 2, lates: 1 }, 1);
		expect(c.receive(1, enc.encode(ONE_IDLE), undefined, echo)).toBe(true);
		expect(c.isLeadMeasured()).toBe(false);
		expect(c.leadStats()!.samples).toBe(0);
		expect(c.misses).toBe(0);
	});

	it("with lead undefined an echo changes nothing (no controller)", () => {
		const { c, enc } = client(TUNABLES);
		const target = firstStep(c, enc, 0);
		expect(c.receive(1, enc.encode(ONE_IDLE), DT, encodeInputEcho({ tick: target, slack: -1, lates: 3 }, 1))).toBe(
			true,
		);
		expect(c.leadStats()).toBe(undefined);
		expect(c.isLeadMeasured()).toBe(false);
		expect([c.misses, c.netLead(), c.latchedButtons()]).toEqual([0, TUNABLES.inputDelay, 0]);
	});

	it("once the run is over (end) echoes no longer reach the controller", () => {
		const { c, enc } = client(MEASURED);
		const target = firstStep(c, enc, 0);
		c.end("desync");
		expect(c.receive(1, enc.encode(ONE_IDLE), DT, encodeInputEcho({ tick: target, slack: 2, lates: 4 }, 1))).toBe(
			true,
		);
		expect(c.leadStats()!.lates).toBe(0);
		expect(c.misses).toBe(0);
	});
});

describe("LockstepClient pacing after the run (docs/FRAME_PACING.md)", () => {
	it("once nothing more will be stepped (end), arrivals no longer reach the pacer: nothing grows", () => {
		const setup = buildEndlessRunConfig(SEED, 1);
		const c = new LockstepClient({
			runId: "pace-end",
			seed: SEED,
			spawn: setup.spawn!,
			config: setup.config,
			players: 1,
			localIndex: 0,
			tunables: { ...TUNABLES, pacing: PACING },
		});
		const enc = new MergedEncoder(1);
		const idle: InputFrame[][] = [[{ ...EMPTY_INPUT }]];
		const LIVE = 30;
		const AFTER = 300;
		for (let frame = 0; frame < LIVE; frame++) {
			c.receive(frame, enc.encode(idle), frame * DT);
			c.pump(DT, () => EMPTY_INPUT, frame * DT);
		}
		const before = c.pacingStats()!;
		expect(before.pending).toBe(0);
		c.end("desync");
		for (let frame = LIVE; frame < LIVE + AFTER; frame++) {
			// Every tenth batch without a clock (stamped by the next pump, were it still pacing).
			const now = frame % 10 === 0 ? undefined : frame * DT;
			expect(c.receive(frame, enc.encode(idle), now)).toBe(true);
			expect(c.pump(DT, () => EMPTY_INPUT, frame * DT).stepped).toBe(0);
		}
		const s = c.pacingStats()!;
		expect(s.pending).toBe(0);
		expect(s.committed).toBe(before.committed);
		expect(s.discarded).toBe(before.discarded);
		expect(c.getAlpha()).toBe(1);
	});
});

describe("co-op failure cases", () => {
	it("a client that diverges is caught at its next hash report: the run ends unranked (desync)", () => {
		let sabotaged = -1;
		const net = new Net({
			players: 3,
			latency: [0.01, 0.06],
			onFrame: (n) => {
				const c = n.clients[2];
				if (sabotaged < 0 && c.state.tick >= 300) {
					playerAt(c.state, 0).hearts -= 1; // a hit only this client saw
					sabotaged = c.state.tick;
				}
			},
		});
		net.run();
		const ending = net.session.getEnd();
		print(`[lockstep] sabotage at tick ${sabotaged}: ${ending?.reason}`);
		expect(ending?.code).toBe("desync");
		const every = TUNABLES.hashEvery;
		expect(ending?.tick).toBe((math.floor(sabotaged / every) + 1) * every);
		expect(ending?.desync?.outliers).toEqual([2]);
		expect(net.result?.ok).toBe(false);
		expect(net.result?.code).toBe("desync");
	});

	it("a player who leaves is dead for the rest of the run on every client; the run still validates", () => {
		const net = new Net({
			players: 3,
			latency: [0.02, 0.08],
			onFrame: (n, frame) => {
				if (frame === 200) {
					n.session.leave(n.members[1]);
					n.gone.add(1);
				}
			},
		});
		net.run();
		expect(net.result?.reason).toBe(undefined);
		expect(net.result?.ok).toBe(true);
		const leftAt = net.session.getRelay().leftFromTick(1)!;
		expect(net.log[leftAt][1]).toEqual({ ...LEFT_FRAME });
		expect(net.log[leftAt - 1][1].buttons !== PARTY_LEFT_BUTTON).toBe(true);
		for (const i of [0, 2]) {
			const c = net.clients[i];
			expect(c.state.party!.left[1]).toBe(1);
			expect(hashState(c.state)).toBe(net.result?.serverHash);
		}
	});

	it("a client that stops reporting is dropped after the timeout; the others carry on", () => {
		const net = new Net({
			players: 3,
			latency: [0.02, 0.08],
			onFrame: (n, frame) => {
				if (frame === 150) n.frozen.add(2);
			},
		});
		net.run();
		expect(net.session.isPresent(2)).toBe(false);
		expect(net.result?.ok).toBe(true);
		expect(hashState(net.clients[0].state)).toBe(net.result?.serverHash);
		expect(net.clients[0].state.party!.left[2]).toBe(1);
	});

	it("everyone leaving abandons the run", () => {
		const net = new Net({
			players: 2,
			latency: [0.01, 0.02],
			onFrame: (n, frame) => {
				if (frame === 100) for (const u of n.members) n.session.leave(u);
			},
		});
		net.run();
		expect(net.session.getEnd()?.code).toBe("abandoned");
		expect(net.result?.code).toBe("abandoned");
	});

	it("final claims that disagree end the run unranked", () => {
		const net = new Net({
			players: 2,
			latency: [0.01, 0.03],
			onFrame: (n) => {
				// Player 1 lies about its final as soon as it has stepped 200 ticks.
				const c = n.clients[1];
				if (c.state.tick === 200 && !n.finals.has(1)) {
					const lie: RunFinal = {
						runId: "coop",
						finalTick: 200,
						claimedHash: hashState(c.state),
						claimed: { ticks: 200, kills: 0, bossDefeated: false, died: true, score: 999999, floor: 9 },
					};
					n.finals.set(1, lie);
					n.session.reportFinal(n.members[1], lie);
				}
			},
		});
		net.run();
		expect(net.session.getEnd()?.code).toBe("desync");
		expect(net.result?.ok).toBe(false);
	});
});

describe("co-op report reliability", () => {
	it("catch-up after a 15 s hitch completes ranked: batched reports, nothing dropped by the limiters", () => {
		const HITCH_FRAMES = 60 * 15;
		const net = new Net({
			players: 3,
			latency: [0.02, 0.08],
			// The production stall timeout (20 s): a 15 s hitch must not get the player dropped.
			tunables: { ...TUNABLES, reportTimeoutTicks: HASH_REPORT_TIMEOUT_TICKS },
			onFrame: (n, frame) => {
				if (frame === 240) n.frozen.add(1);
				if (frame === 240 + HITCH_FRAMES) n.frozen.delete(1);
			},
		});
		net.run();
		print(
			`[lockstep hitch] hash calls ${net.hashCalls.join(",")} (limited ${net.hashCallsLimited.join(",")}), ` +
				`input calls limited ${net.inputCallsLimited.join(",")}, final tick ${net.finals.get(0)?.finalTick}`,
		);
		expect(net.result?.reason).toBe(undefined);
		expect(net.result?.ok).toBe(true);
		expect(net.session.isPresent(1)).toBe(true);
		expect(net.hashCallsLimited).toEqual([0, 0, 0]);
		expect(net.inputCallsLimited).toEqual([0, 0, 0]);
		expect(hashState(net.clients[1].state)).toBe(net.result?.serverHash);
		expect(net.clients[1].state.party!.left[1]).toBe(0);
	});

	it("a lost hash call is recovered by the resend (the player is not dropped, the run validates)", () => {
		let lost = 0;
		const net = new Net({
			players: 3,
			latency: [0.02, 0.06],
			dropHashCall: (i, ticks) => {
				if (i !== 2 || lost > 0 || !ticks.includes(300)) return false;
				lost++;
				return true;
			},
		});
		net.run();
		expect(lost).toBe(1);
		expect(net.hashCallsLost[2]).toBe(1);
		// Tick 300 went up again with the next resend.
		expect(net.hashTicksSent[2].filter((t) => t === 300).size() >= 2).toBe(true);
		expect(net.session.isPresent(2)).toBe(true);
		expect(net.result?.reason).toBe(undefined);
		expect(net.result?.ok).toBe(true);
	});

	it("acknowledged reports are not resent; unacknowledged ones are, in one batch, at the resend interval", () => {
		const setup = buildEndlessRunConfig(SEED, 2);
		const c = new LockstepClient({
			runId: "coop",
			seed: SEED,
			spawn: setup.spawn!,
			config: setup.config,
			players: 2,
			localIndex: 0,
			tunables: TUNABLES,
		});
		const enc = new MergedEncoder(2);
		const idle: InputFrame[][] = [];
		for (let t = 0; t < 180; t++) idle.push([{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }]);
		expect(c.receive(0, enc.encode(idle))).toBe(true);
		const sent: number[][] = [];
		const pump = (dt: number) => {
			const r = c.pump(dt, () => EMPTY_INPUT);
			if (r.hashes.size() > 0) sent.push(r.hashes.map((h) => h.tick));
		};
		for (let k = 0; k < 30; k++) pump(DT); // 8 ticks per frame: all 180 stepped (reports 60, 120, 180), then idle
		expect(c.state.tick).toBe(180);
		// New reports go out as soon as the throttle allows; every call carries all unacknowledged ones.
		expect(sent.size() >= 1).toBe(true);
		expect(sent[sent.size() - 1]).toEqual([60, 120, 180]);
		c.acknowledge(120);
		expect(c.unacknowledged()).toBe(1);
		sent.clear();
		for (let k = 0; k < 60 * 3; k++) pump(DT); // 3 s, nothing new
		expect(sent).toEqual([[180]]); // one resend at 2 s
		c.acknowledge(180);
		sent.clear();
		for (let k = 0; k < 60 * 3; k++) pump(DT);
		expect(sent).toEqual([]);
	});

	it("a checkpoint below the final that never reaches consensus times out to desync (not a 30-minute hang)", () => {
		const net = new Net({
			players: 3,
			latency: [0.01, 0.04],
			// Stall detection effectively off, so only the final checkpoint deadline can end the wait.
			tunables: { ...TUNABLES, reportTimeoutTicks: 1e6, finalCheckpointTimeoutTicks: 300 },
			dropHashCall: (i, ticks) => i === 2 && ticks.includes(480),
		});
		net.run();
		const ending = net.session.getEnd();
		print(`[lockstep] missing checkpoint: ${ending?.reason}`);
		expect(net.finals.size()).toBe(3); // every client claimed the same final
		expect(ending?.code).toBe("desync");
		expect(ending?.reason?.find("no hash consensus")[0] !== undefined).toBe(true);
		expect(net.result?.ok).toBe(false);
		expect(net.result?.code).toBe("desync");
	});

	it("a player silent below a claimed final is still dropped as stalled; the others' run validates", () => {
		const net = new Net({
			players: 3,
			latency: [0.01, 0.04],
			dropHashCall: (i, ticks) => i === 2 && ticks.some((t) => t >= 480),
		});
		net.run();
		expect(net.session.isPresent(2)).toBe(false);
		expect(net.result?.reason).toBe(undefined);
		expect(net.result?.ok).toBe(true);
	});

	it("a malformed final claim (NaN / fractional / negative numbers) is refused and never recorded", () => {
		const net = new Net({ players: 2, latency: [0.01, 0.02], maxFrames: 1 });
		net.run();
		const good: RunFinal = {
			runId: "coop",
			finalTick: 1,
			claimedHash: H(1),
			claimed: { ticks: 1, kills: 0, bossDefeated: false, died: true, score: 0, floor: 1 },
		};
		const bad: RunFinal[] = [
			{ ...good, finalTick: 0 / 0 },
			{ ...good, finalTick: 0.5 },
			{ ...good, finalTick: -1 },
			{ ...good, claimed: { ...good.claimed, score: 0 / 0 } },
			{ ...good, claimed: { ...good.claimed, floor: -2 } },
			{ ...good, claimed: { ...good.claimed, kills: math.huge } },
		];
		for (const f of bad) {
			const why = net.session.reportFinal(net.members[0], f);
			expect(why?.find("bad final")[0] !== undefined).toBe(true);
		}
		expect(net.session.getStatus()).toBe("running");
	});
});

describe("hitstop stays out of the co-op sim", () => {
	it("simPacerFor gives no pacer to a party", () => {
		const clock = new HitstopClock();
		expect(simPacerFor(1, clock)).toBe(clock);
		expect(simPacerFor(2, clock)).toBe(undefined);
		expect(simPacerFor(8, clock)).toBe(undefined);
	});
});
