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
	decodeInputBatch,
	encodeInputBatch,
	outliersOf,
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

interface Message {
	readonly at: number;
	readonly deliver: () => void;
}

/** One-way FIFO channel with random latency (in seconds); order is kept like a RemoteEvent's. */
class Channel {
	private readonly queue: Message[] = [];
	private last = 0;
	constructor(private readonly rng: Rng, private readonly minLatency: number, private readonly maxLatency: number) {}

	send(now: number, deliver: () => void): void {
		const latency = this.minLatency + (this.maxLatency - this.minLatency) * this.rng.next();
		const at = math.max(this.last, now + latency);
		this.last = at;
		this.queue.push({ at, deliver });
	}

	pump(now: number): void {
		while (this.queue.size() > 0 && this.queue[0].at <= now) this.queue.remove(0)!.deliver();
	}
}

const SEED = 31337;
const DT = 1 / 60;
const TUNABLES: LockstepTunables = {
	...DEFAULT_LOCKSTEP,
	segmentTicks: 240,
	checkpointEvery: 120,
	reportTimeoutTicks: 600,
	finalTimeoutTicks: 600,
	allowDebugInput: true,
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

class Net {
	readonly rng = new Rng(7);
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
	result: SegmentedRunResult | undefined;
	now = 0;
	private readonly logDecoder: MergedDecoder;
	private readonly tunables: LockstepTunables;

	constructor(readonly opts: NetOptions) {
		const n = opts.players;
		this.tunables = opts.tunables ?? TUNABLES;
		for (let i = 0; i < n; i++) {
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
			this.down.push(new Channel(this.rng, lo, hi));
			this.up.push(new Channel(this.rng, lo, hi));
		}
	}

	run(): void {
		const maxFrames = this.opts.maxFrames ?? 60 * 120;
		for (let frame = 0; frame < maxFrames && this.result === undefined; frame++) {
			this.now += DT;
			for (const c of this.up) c.pump(this.now);
			const out = this.session.step(this.now);
			for (const b of out.broadcasts) {
				const ticks = this.logDecoder.decode(b.data)!;
				expect(b.firstTick).toBe(this.log.size());
				for (const t of ticks) this.log.push(t);
				const ack = out.ackTick;
				for (let i = 0; i < this.clients.size(); i++) {
					if (this.gone.has(i)) continue;
					const c = this.clients[i];
					this.down[i].send(this.now, () => {
						c.receive(b.firstTick, b.data);
						c.acknowledge(ack);
					});
				}
			}
			if (out.ended !== undefined) {
				this.result = this.validator.getResult();
				break;
			}
			for (let guard = 0; guard < 100 && this.validator.hasWork(); guard++) {
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
				const res = c.pump(DT, () => botInput(c.state, i));
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

for (const [players, lo, hi] of NET_RUNS) {
	describe(`co-op over a simulated network: ${players} players, ${lo * 1000}-${hi * 1000} ms each way`, () => {
		const net = new Net({ players, latency: [lo, hi] });
		net.run();

		it("the run ends (the party is wiped) and the server's replay accepts it", () => {
			const fin = net.finals.get(0)!;
			print(
				`[lockstep ${players}p] final tick ${fin.finalTick} hash ${fin.claimedHash} score ${fin.claimed.score}; leads ` +
					`${net.clients.map((c) => c.inputLead()).join(",")}; misses ${net.clients
						.map((c) => c.misses)
						.join(",")}; relay missed ${net.session
						.getRelay()
						.getStats()
						.missed.join(",")} late ${net.session
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
	});
}

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
