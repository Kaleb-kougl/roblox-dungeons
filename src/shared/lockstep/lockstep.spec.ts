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
	LOCKSTEP_HASH_RATE,
	LOCKSTEP_INPUT_RATE,
	LockstepClient,
	LockstepRelay,
	LockstepSession,
	MergedDecoder,
	MergedEncoder,
	PACING,
	decodeInputBatch,
	encodeInputBatch,
	outliersOf,
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
 * One-way FIFO channel with random latency (in seconds); order is kept like a RemoteEvent's. The latency is drawn once
 * per DT of the simulated clock from the channel's own generator, so two runs over channels with the same seed see the
 * same network at the same times, whatever (and however much) they send.
 */
class Channel {
	private readonly queue: Message[] = [];
	private readonly latencies: number[] = [];
	private readonly rng: Rng;
	private last = 0;
	constructor(seed: number, private readonly minLatency: number, private readonly maxLatency: number) {
		this.rng = new Rng(seed);
	}

	private latencyAt(now: number): number {
		const slot = math.max(0, math.floor(now / DT + 0.5));
		while (this.latencies.size() <= slot) {
			this.latencies.push(this.minLatency + (this.maxLatency - this.minLatency) * this.rng.next());
		}
		return this.latencies[slot];
	}

	send(now: number, deliver: () => void): void {
		const at = math.max(this.last, now + this.latencyAt(now));
		this.last = at;
		this.queue.push({ at, deliver });
	}

	pump(now: number): void {
		while (this.queue.size() > 0 && this.queue[0].at <= now) this.queue.remove(0)!.deliver();
	}
}

/** Frames per second the Net harness renders at by default (DT). */
const NET_FPS = 60;
// No pacing: these specs assert today's stepping (every received frame at once); Net's `pacing` option turns it on.
const TUNABLES: LockstepTunables = {
	...DEFAULT_LOCKSTEP,
	segmentTicks: 240,
	checkpointEvery: 120,
	reportTimeoutTicks: 600,
	finalTimeoutTicks: 600,
	allowDebugInput: true,
	pacing: undefined,
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
}

/** A client's scripted player: small left / right walks, rolls, swings, and a debug hit (K) every 120 ticks. */
function botInput(s: SimState, i: number): InputFrame {
	const p = playerAt(s, i);
	const t = s.tick + i * 23;
	const dir = math.floor(t / 40) % 2 === 0 ? 1 : -1;
	let buttons = 0;
	if (t % 120 === 60) buttons = bit32.bor(buttons, Button.DEBUG_HIT);
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
	result: SegmentedRunResult | undefined;
	now = 0;
	private readonly logDecoder: MergedDecoder;
	private readonly tunables: LockstepTunables;
	private readonly frameDt: number;

	constructor(readonly opts: NetOptions) {
		const n = opts.players;
		const base = opts.tunables ?? TUNABLES;
		this.tunables = opts.pacing === true ? { ...base, pacing: base.pacing ?? PACING } : base;
		this.frameDt = 1 / (opts.fps ?? NET_FPS);
		for (let i = 0; i < n; i++) {
			this.traces.push({ at: [], stepped: [], alpha: [], holds: [] });
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
			this.down.push(new Channel(NET_CHANNEL_SEED + 2 * i, lo, hi));
			this.up.push(new Channel(NET_CHANNEL_SEED + 2 * i + 1, lo, hi));
		}
	}

	run(): void {
		const fps = this.opts.fps ?? NET_FPS;
		const maxFrames = this.opts.maxFrames ?? fps * 120;
		const paced = this.opts.pacing === true;
		const frameDt = this.frameDt;
		for (let frame = 0; frame < maxFrames && this.result === undefined; frame++) {
			this.now += frameDt;
			const stall = this.opts.serverStall;
			const serverRuns = stall === undefined || this.now < stall.at || this.now >= stall.at + stall.sec;
			if (serverRuns) for (const c of this.up) c.pump(this.now);
			const out = serverRuns ? this.session.step(this.now) : SERVER_STALLED;
			for (const b of out.broadcasts) {
				const ticks = this.logDecoder.decode(b.data)!;
				expect(b.firstTick).toBe(this.log.size());
				for (const t of ticks) this.log.push(t);
				const ack = out.ackTick;
				for (let i = 0; i < this.clients.size(); i++) {
					if (this.gone.has(i)) continue;
					const c = this.clients[i];
					this.down[i].send(this.now, () => {
						c.receive(b.firstTick, b.data, paced ? this.now : undefined);
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
				const res = c.pump(frameDt, () => botInput(c.state, i), paced ? this.now : undefined);
				if (live) {
					const tr = this.traces[i];
					tr.at.push(this.now);
					tr.stepped.push(res.stepped);
					tr.alpha.push(c.getAlpha());
					tr.holds.push(c.pacingStats()?.holds ?? 0);
				}
				for (const inp of res.inputs) {
					this.up[i].send(this.now, () => {
						if (!this.inputLimiter.tryAcquire(user, this.now)) this.inputCallsLimited[i]++;
						else this.session.submitInput(user, inp.firstTick, inp.data);
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
}

class LeadNet {
	readonly client: LockstepClient;
	readonly relay: LockstepRelay;
	/** Every sampled input, in order, with the tick the batches actually carried it for. */
	readonly sends: LeadSend[] = [];
	/** Per pump that stepped: state.tick, inputLead() and the last tick sent so far. */
	readonly reports: Array<{ readonly next: number; readonly lead: number; readonly lastSent: number }> = [];
	/** nextInputTick() as seen inside each sample() (must be the tick that input was sent for). */
	readonly sampledTargets: number[] = [];
	steps = 0;
	private readonly enc = new MergedEncoder(1);
	private readonly down = new DelayQueue();
	private readonly up = new DelayQueue();
	private samples = 0;

	constructor(private readonly tunables: LockstepTunables, private readonly latencyAt: (frame: number) => number) {
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
		for (let frame = 0; frame < frames; frame++) {
			const now = frame * DT;
			const latency = this.latencyAt(frame);
			this.up.pump(now);
			const tick = this.relay.finalizedTicks();
			const data = this.enc.encode([this.relay.finalizeNext()]);
			this.down.send(now + latency, () => c.receive(tick, data));
			this.down.pump(now);
			const pending: Array<{ next: number; misses: number }> = [];
			const res = c.pump(DT, () => {
				pending.push({ next: c.state.tick, misses: c.misses });
				this.sampledTargets.push(c.nextInputTick());
				this.samples++;
				// Aim only (the player stands still); every sample differs, so a repeat-last is a visible miss.
				return { ...EMPTY_INPUT, aimX: 1 + (this.samples % AXIS_MAX) };
			});
			this.steps += res.stepped;
			let k = 0;
			for (const b of res.inputs) {
				const batch = decodeInputBatch(b.data, this.tunables.maxBatchFrames)!;
				for (let j = 0; j < batch.size(); j++) {
					const p = pending[k];
					this.sends.push({ frame, next: p.next, tick: b.firstTick + j, misses: p.misses });
					k++;
				}
				this.up.send(now + latency, () => this.relay.submit(0, b.firstTick, batch));
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
	const tunables: LockstepTunables = { ...DEFAULT_LOCKSTEP, leadDecayTicks: 15 };
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
