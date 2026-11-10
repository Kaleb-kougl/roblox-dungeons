/**
 * docs/LOCAL_PREDICTION.md LP3: local prediction on simulated networks (the shipped client: paced, measured lead).
 *
 * The same co-op run is played twice over the same channels (random latency, ordered delivery, drawn per tick of the
 * simulated clock, so both runs see the same network), once with prediction on and once off: the merged log, every
 * client's final claim and the server's verdict are identical (the predictor is read only). Since Revision 3 of
 * docs/FRAME_PACING.md (FPD19) the prediction cap is also the measured lead's ceiling, so a client built without
 * prediction sends with another lead: the "off" run's clients get the shipped controller with the same ceiling
 * (`PREDICTION.maxTicks`), so the predictor alone differs. With it on, every client's
 * prediction statistics are printed: on real endless floors (the record for LP8), and on M1 without enemies, where
 * nothing but the inputs moves a body, so a client whose sent inputs all made their deadlines has zero error.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import { AXIS_MAX, Button, EMPTY_INPUT, Rng, hashState, playerAt, type InputFrame, type SimState } from "shared/sim";
import {
	DEFAULT_SEGMENT_LIMITS,
	SegmentedValidator,
	buildEndlessRunConfig,
	buildRunConfig,
	type RunFinal,
	type RunSetup,
	type SegmentedRunResult,
} from "shared/run";
import {
	DEFAULT_LOCKSTEP,
	LeadController,
	LockstepClient,
	LockstepSession,
	MergedDecoder,
	PREDICTION,
	type LockstepTunables,
} from ".";

const SEED = 31337;
const DT = 1 / 60;
const MAX_FRAMES = 60 * 120;
/** The bots' debug hit (K): the party is down in about a minute. */
const DEBUG_HIT_TICKS = 400;
const TUNABLES: LockstepTunables = {
	...DEFAULT_LOCKSTEP,
	segmentTicks: 240,
	checkpointEvery: 120,
	reportTimeoutTicks: 600,
	finalTimeoutTicks: 600,
	allowDebugInput: true,
};
const SEG_LIMITS = { ...DEFAULT_SEGMENT_LIMITS, checkpointEvery: 120, allowDebugInput: true };

interface Message {
	readonly at: number;
	readonly deliver: () => void;
}

/** One-way FIFO channel; the latency is drawn once per DT of the simulated clock from its own generator. */
class Channel {
	private readonly queue: Message[] = [];
	private readonly latencies: number[] = [];
	private readonly rng: Rng;
	private last = 0;
	constructor(seed: number, private readonly lo: number, private readonly hi: number) {
		this.rng = new Rng(seed);
	}
	send(now: number, deliver: () => void): void {
		const slot = math.max(0, math.floor(now / DT + 0.5));
		while (this.latencies.size() <= slot) this.latencies.push(this.lo + (this.hi - this.lo) * this.rng.next());
		const at = math.max(this.last, now + this.latencies[slot]);
		this.last = at;
		this.queue.push({ at, deliver });
	}
	pump(now: number): void {
		while (this.queue.size() > 0 && this.queue[0].at <= now) this.queue.remove(0)!.deliver();
	}
}

/** lockstep.spec's scripted player (walks, rolls, swings) with a guard, and a debug hit every DEBUG_HIT_TICKS. */
function botInput(s: SimState, i: number): InputFrame {
	const p = playerAt(s, i);
	const t = s.tick + i * 23;
	const dir = math.floor(t / 40) % 2 === 0 ? 1 : -1;
	let buttons = 0;
	if (t % DEBUG_HIT_TICKS === DEBUG_HIT_TICKS / 2) buttons = bit32.bor(buttons, Button.DEBUG_HIT);
	if (t % 77 === 0) buttons = bit32.bor(buttons, Button.ROLL);
	if (t % 9 < 3) buttons = bit32.bor(buttons, Button.FIRE);
	if (t % 150 < 20) buttons = bit32.bor(buttons, Button.ALT);
	return { moveX: p.dead !== 0 ? 0 : dir * 600, moveZ: ((i % 3) - 1) * 300, aimX: dir * AXIS_MAX, aimZ: 0, buttons };
}

interface NetRun {
	readonly log: string[];
	readonly finals: Map<number, RunFinal>;
	readonly result: SegmentedRunResult | undefined;
	readonly clients: LockstepClient[];
}

function play(
	setupOf: () => RunSetup,
	worldKind: string,
	players: number,
	latency: readonly [number, number],
	prediction: boolean,
): NetRun {
	const tunables: LockstepTunables = prediction ? TUNABLES : { ...TUNABLES, prediction: undefined };
	const setup = setupOf();
	const members: number[] = [];
	for (let i = 0; i < players; i++) members.push(1000 + i);
	const validator = new SegmentedValidator({
		runId: "coop",
		seed: SEED,
		worldKind,
		setup,
		createdAt: 0,
		limits: SEG_LIMITS,
	});
	const session = new LockstepSession({
		runId: "coop",
		seed: SEED,
		spawn: setup.spawn!,
		members,
		validator,
		startedAt: 0,
		tunables,
	});
	const clients: LockstepClient[] = [];
	const down: Channel[] = [];
	const up: Channel[] = [];
	for (let i = 0; i < players; i++) {
		const own = setupOf();
		const c = new LockstepClient({
			runId: "coop",
			seed: SEED,
			spawn: own.spawn!,
			config: own.config,
			players,
			localIndex: i,
			tunables,
		});
		const lead = TUNABLES.lead;
		if (!prediction && lead !== undefined) {
			// The lead's ceiling with prediction on (FPD19), so only the predictor differs between the two runs.
			const t = TUNABLES;
			(c as unknown as { leadCtl: LeadController }).leadCtl = new LeadController(
				lead,
				t.inputDelay,
				t.maxInputLead,
				t.leadDecayTicks,
				PREDICTION.maxTicks,
			);
		}
		clients.push(c);
		down.push(new Channel(7 + 2 * i, latency[0], latency[1]));
		up.push(new Channel(8 + 2 * i, latency[0], latency[1]));
	}
	const decoder = new MergedDecoder(players);
	const log: string[] = [];
	const finals = new Map<number, RunFinal>();
	let result: SegmentedRunResult | undefined;
	let now = 0;
	for (let frame = 0; frame < MAX_FRAMES && result === undefined; frame++) {
		now += DT;
		for (const c of up) c.pump(now);
		const out = session.step(now);
		for (const b of out.broadcasts) {
			for (const row of decoder.decode(b.data)!) {
				let line = "";
				for (const f of row) line += `${f.moveX},${f.moveZ},${f.aimX},${f.aimZ},${f.buttons};`;
				log.push(line);
			}
			for (let i = 0; i < players; i++) {
				const c = clients[i];
				const echo = b.echoes[i];
				down[i].send(now, () => {
					c.receive(b.firstTick, b.data, now, echo);
					c.acknowledge(out.ackTick);
				});
			}
		}
		if (out.ended !== undefined) {
			result = validator.getResult();
			break;
		}
		for (let guard = 0; guard < 100 && validator.hasWork(); guard++) {
			const r = validator.advance(1000);
			if (r.result !== undefined) result = r.result;
		}
		if (result === undefined && session.getStatus() === "submitted") result = validator.getResult();
		for (let i = 0; i < players; i++) {
			down[i].pump(now);
			const c = clients[i];
			const user = members[i];
			const res = c.pump(DT, (sending) => (sending ? botInput(c.state, i) : { ...EMPTY_INPUT }), now);
			for (const inp of res.inputs)
				up[i].send(now, () => session.submitInput(user, inp.firstTick, inp.data, now));
			if (res.hashes.size() > 0) {
				const ticks = res.hashes.map((h) => h.tick);
				const hashes = res.hashes.map((h) => h.hash);
				up[i].send(now, () => session.reportHashes(user, ticks, hashes));
			}
			if (res.final !== undefined) {
				const fin = res.final;
				finals.set(i, fin);
				up[i].send(now, () => session.reportFinal(user, fin));
			}
		}
	}
	return { log, finals, result, clients };
}

function statsLine(clients: ReadonlyArray<LockstepClient>): string {
	const parts: string[] = [];
	for (let i = 0; i < clients.size(); i++) {
		const c = clients[i];
		const s = c.predictionStats()!;
		parts.push(
			`p${i}: ${s.totalCompared} ticks, ${s.totalCorrections} corrections (max ${string.format(
				"%.3f",
				s.totalMaxError,
			)}; last 10 s: mean ${string.format("%.4f", s.meanError)} max ${string.format("%.3f", s.maxError)}), ` +
				`lead ${c.inputLead()}, mismatches ${c.mismatches}`,
		);
	}
	return parts.join("; ");
}

const WORLDS: ReadonlyArray<{ name: string; kind: string; setupOf: (n: number) => RunSetup }> = [
	{ name: "endless", kind: "endless", setupOf: (n) => buildEndlessRunConfig(SEED, n) },
	{
		name: "M1 without enemies",
		kind: "dungeonNoEncounter",
		setupOf: (n) => buildRunConfig(SEED, { world: "dungeonNoEncounter", partySize: n }),
	},
];

const NETS: ReadonlyArray<readonly [number, number, number]> = [
	[3, 0.02, 0.12],
	[2, 0, 0.2],
];

for (const world of WORLDS) {
	for (const [players, lo, hi] of NETS) {
		describe(`local prediction, ${world.name}: ${players} players, ${lo * 1000}-${hi * 1000} ms each way`, () => {
			let on: NetRun | undefined;
			let off: NetRun | undefined;
			const runs = () => {
				if (on === undefined) on = play(() => world.setupOf(players), world.kind, players, [lo, hi], true);
				if (off === undefined) off = play(() => world.setupOf(players), world.kind, players, [lo, hi], false);
				return [on, off] as const;
			};

			it("prediction on and off: the same log, final claims and verdict", () => {
				const [a, b] = runs();
				expect(a.result?.ok).toBe(true);
				expect(b.result?.ok).toBe(true);
				expect(a.result?.serverHash).toBe(b.result?.serverHash);
				expect(a.log.size()).toBe(b.log.size());
				let same = true;
				for (let t = 0; t < a.log.size(); t++) if (a.log[t] !== b.log[t]) same = false;
				expect(same).toBe(true);
				for (let i = 0; i < players; i++) {
					expect(a.finals.get(i)).toEqual(b.finals.get(i));
					expect(hashState(a.clients[i].state)).toBe(hashState(b.clients[i].state));
					expect(b.clients[i].predictionStats()).toBeUndefined();
				}
			});

			it("every client predicted; the error record", () => {
				const [a] = runs();
				print(`[predict.net] ${world.name} ${players}p ${lo * 1000}-${hi * 1000} ms: ${statsLine(a.clients)}`);
				for (const c of a.clients) expect(c.predictionStats()!.totalCompared).toBeGreaterThan(0);
				if (world.kind === "dungeonNoEncounter") {
					// Nothing but the inputs moves a body: only a missed input makes a head wrong, and each miss makes at most
					// the heads of the ticks it was replayed in wrong (one per tick of the horizon).
					for (const c of a.clients) {
						const st = c.predictionStats()!;
						expect(st.totalCorrections).toBeLessThanOrEqual(c.mismatches * PREDICTION.maxTicks);
					}
				}
			});
		});
	}
}
