/**
 * docs/LOCAL_PREDICTION.md LP3: the LocalPredictor inside a LockstepClient, against a scripted server.
 *
 * The server's merged log is fixed in advance (two random walkers on M1 without enemies, so nothing but the inputs moves
 * a body); the client samples its own walker's frame for each target tick and is served the log one tick per frame up
 * to a random 0..AHEAD_MAX ticks early, stepping one a pump (so the predictor also replays queued frames). An oracle steps the whole log once and keeps the local player's pose after every tick.
 *
 *   exact       after every pump, the predicted head equals the oracle's pose at state.tick + horizon bit for bit
 *               whenever every replayed tick's input (queued, else sent, else the repeat) is the one the server
 *               finalized; with no misses, always. Misses (the server repeating instead of taking the sent frame) are
 *               the only corrections, and the stats count them.
 *   read only   a twin client without prediction, served and sampled the same, sends the same batches, hashes and
 *               final claim, and every pump leaves both states with the same hash.
 *   horizon     min(last sent - state.tick + 1, maxTicks).
 *   stops       nothing is predicted while the local player is dead or a draft is open.
 *   bench       the rebuild's cost at 10 and 30 ticks on an endless floor (printed; target < 0.1 ms headless).
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AXIS_MAX,
	Button,
	Rng,
	createSimState,
	hashState,
	inputsEqual,
	playerAt,
	quantizeAxis,
	stepParty,
	type InputFrame,
	type PlayerState,
	type SimConfig,
} from "shared/sim";
import { buildEndlessRunConfig, buildRunConfig } from "shared/run";
import {
	DEFAULT_LOCKSTEP,
	LocalPredictor,
	LockstepClient,
	MergedEncoder,
	PREDICTION,
	type LockstepTunables,
	type PredictionSource,
	type PumpResult,
} from ".";

const SEED = 4242;
const PLAYERS = 2;
const LOCAL = 1;
const DT = 1 / 60;
const TICKS = 1500;
const AHEAD_MAX = 3;
/** A long legacy lead, so the horizon reaches maxTicks (the shipped lead at 20-120 ms is 11-17 ticks). */
const LEAD = 12;
/** Ticks whose local input the scripted server repeats instead of taking what was sent (a missed deadline). */
const MISS_EVERY = 97;

const ON: LockstepTunables = {
	...DEFAULT_LOCKSTEP,
	pacing: undefined,
	lead: undefined,
	inputDelay: LEAD,
	maxCatchup: 1,
	prediction: PREDICTION,
};
const OFF: LockstepTunables = { ...ON, prediction: undefined };

/** A random walker, state-independent (frames by tick, generated once). */
function walkerFrames(seed: number, n: number): InputFrame[] {
	const rng = new Rng(seed);
	const out: InputFrame[] = [];
	let mx = 0;
	let mz = 0;
	let left = 0;
	let held = 0;
	let holdLeft = 0;
	for (let t = 0; t < n; t++) {
		if (left <= 0) {
			left = 5 + math.floor(rng.next() * 50);
			const r = rng.next();
			mx = r < 0.2 ? 0 : r < 0.6 ? (math.floor(rng.next() * 3) - 1) * AXIS_MAX : quantizeAxis(rng.next() * 2 - 1);
			mz = r < 0.2 ? 0 : r < 0.6 ? (math.floor(rng.next() * 3) - 1) * AXIS_MAX : quantizeAxis(rng.next() * 2 - 1);
		}
		left--;
		if (holdLeft > 0) holdLeft--;
		else {
			held = 0;
			const r = rng.next();
			if (r < 0.03) held = Button.ROLL;
			else if (r < 0.06) held = Button.FIRE;
			else if (r < 0.08) held = Button.ALT;
			else if (r < 0.09) held = Button.SWAP;
			holdLeft = held === 0 ? 0 : 1 + math.floor(rng.next() * 40);
		}
		const aim = rng.next() < 0.5;
		out.push({
			moveX: mx,
			moveZ: mz,
			aimX: aim ? quantizeAxis(rng.next() * 2 - 1) : 0,
			aimZ: aim ? quantizeAxis(rng.next() * 2 - 1) : 0,
			buttons: held,
		});
	}
	return out;
}

interface Pose {
	x: number;
	z: number;
	prevX: number;
	prevZ: number;
	faceX: number;
	faceZ: number;
	rollTicks: number;
}

function poseOf(p: Readonly<PlayerState>): Pose {
	return { x: p.x, z: p.z, prevX: p.prevX, prevZ: p.prevZ, faceX: p.faceX, faceZ: p.faceZ, rollTicks: p.rollTicks };
}

interface Script {
	readonly setup: { config: SimConfig; spawn: { x: number; z: number } };
	readonly walkers: InputFrame[][];
	/** The server's merged log (its local entries with the misses applied). */
	readonly log: InputFrame[][];
	readonly misses: ReadonlySet<number>;
	/** The local player's pose in state.tick = t (after stepping log[t - 1]). */
	readonly poses: Pose[];
}

function scripted(missEvery: number | undefined): Script {
	const built = buildRunConfig(SEED, { world: "dungeonNoEncounter", partySize: PLAYERS });
	const setup = { config: built.config, spawn: built.spawn! };
	const total = TICKS + 64;
	const walkers: InputFrame[][] = [];
	for (let i = 0; i < PLAYERS; i++) walkers.push(walkerFrames(SEED * 11 + i, total));
	const misses = new Set<number>();
	const log: InputFrame[][] = [];
	for (let t = 0; t < total; t++) {
		const row: InputFrame[] = [];
		for (let i = 0; i < PLAYERS; i++) row.push({ ...walkers[i][t] });
		if (missEvery !== undefined && t > LEAD && t % missEvery === 0) {
			misses.add(t);
			row[LOCAL] = { ...log[t - 1][LOCAL] };
		}
		log.push(row);
	}
	const oracle = createSimState(SEED, setup.spawn.x, setup.spawn.z, setup.config);
	const poses: Pose[] = [poseOf(playerAt(oracle, LOCAL))];
	for (let t = 0; t < total; t++) {
		stepParty(oracle, log[t], setup.config);
		poses.push(poseOf(playerAt(oracle, LOCAL)));
	}
	return { setup, walkers, log, misses, poses };
}

function newClient(s: Script, tunables: LockstepTunables): LockstepClient {
	return new LockstepClient({
		runId: "spec",
		seed: SEED,
		spawn: s.setup.spawn,
		config: s.setup.config,
		players: PLAYERS,
		localIndex: LOCAL,
		tunables,
	});
}

/** The input the predictor replays for `tick` (its rule), to know whether the server will agree with it. */
function resolved(
	c: LockstepClient,
	tick: number,
	previous: Readonly<InputFrame> | undefined,
): Readonly<InputFrame> | undefined {
	const k = tick - c.state.tick;
	if (k < c.backlog()) return c.queuedFrame(k)![LOCAL];
	return c.sentInput(tick) ?? previous;
}

interface Outcome {
	pumps: number;
	exact: number;
	inexact: number;
	/** Predictions before the client's first sent tick was stepped (not judged). */
	warmup: number;
	failures: string[];
	horizons: Map<number, number>;
}

function play(s: Script, check: (c: LockstepClient, twin: LockstepClient, a: PumpResult, b: PumpResult) => void): void {
	const c = newClient(s, ON);
	const twin = newClient(s, OFF);
	const enc = new MergedEncoder(PLAYERS);
	const encTwin = new MergedEncoder(PLAYERS);
	const rng = new Rng(SEED);
	let served = 0;
	for (let f = 0; f < TICKS; f++) {
		// One tick per frame on the server's clock, delivered in bursts (the client steps one a pump: a backlog).
		const through = f + math.floor(rng.next() * (AHEAD_MAX + 1));
		const batch: InputFrame[][] = [];
		while (served <= through) batch.push(s.log[served++]);
		if (batch.size() > 0) {
			expect(c.receive(served - batch.size(), enc.encode(batch))).toBe(true);
			expect(twin.receive(served - batch.size(), encTwin.encode(batch))).toBe(true);
		}
		const a = c.pump(DT, () => s.walkers[LOCAL][c.nextInputTick()]);
		const b = twin.pump(DT, () => s.walkers[LOCAL][twin.nextInputTick()]);
		check(c, twin, a, b);
	}
}

function samePump(a: PumpResult, b: PumpResult): boolean {
	if (a.stepped !== b.stepped || a.inputs.size() !== b.inputs.size() || a.hashes.size() !== b.hashes.size())
		return false;
	for (let k = 0; k < a.inputs.size(); k++) {
		if (a.inputs[k].firstTick !== b.inputs[k].firstTick) return false;
		if (buffer.tostring(a.inputs[k].data) !== buffer.tostring(b.inputs[k].data)) return false;
	}
	for (let k = 0; k < a.hashes.size(); k++) {
		if (a.hashes[k].tick !== b.hashes[k].tick || a.hashes[k].hash !== b.hashes[k].hash) return false;
	}
	return (a.final === undefined) === (b.final === undefined);
}

function run(missEvery: number | undefined): Outcome {
	const s = scripted(missEvery);
	const out: Outcome = { pumps: 0, exact: 0, inexact: 0, warmup: 0, failures: [], horizons: new Map() };
	play(s, (c, twin, a, b) => {
		out.pumps++;
		if (!samePump(a, b) && out.failures.size() < 5) out.failures.push(`pump ${out.pumps}: the twin's pump differs`);
		if (hashState(c.state) !== hashState(twin.state) && out.failures.size() < 5) {
			out.failures.push(`pump ${out.pumps}: the states differ`);
		}
		const head = c.predicted();
		const stats = c.predictionStats()!;
		const h = stats.horizonTicks;
		out.horizons.set(h, (out.horizons.get(h) ?? 0) + 1);
		const wanted = math.min(c.lastSentInputTick() - c.state.tick + 1, PREDICTION.maxTicks);
		if (h !== math.max(wanted, 0) && out.failures.size() < 5)
			out.failures.push(`pump ${out.pumps}: horizon ${h} vs ${wanted}`);
		if (head === undefined) {
			if (out.failures.size() < 5) out.failures.push(`pump ${out.pumps}: nothing predicted`);
			return;
		}
		// Did the server (will it) finalize every replayed tick's input as the predictor resolved it?
		let agrees = true;
		let previous = c.lastSteppedInput();
		for (let k = 0; k < h; k++) {
			const t = c.state.tick + k;
			const r = resolved(c, t, previous);
			previous = r;
			if (r === undefined || !inputsEqual(r, s.log[t][LOCAL])) agrees = false;
		}
		const want = s.poses[c.state.tick + h];
		const got = poseOf(head);
		const same =
			got.x === want.x &&
			got.z === want.z &&
			got.prevX === want.prevX &&
			got.prevZ === want.prevZ &&
			got.faceX === want.faceX &&
			got.faceZ === want.faceZ &&
			got.rollTicks === want.rollTicks;
		// The first ticks were never sent (the lead's start): the server's frames there are not the client's.
		if (c.state.tick <= LEAD) {
			if (!same) out.warmup++;
		} else if (agrees) {
			out.exact++;
			if (!same && out.failures.size() < 5) {
				out.failures.push(
					`pump ${out.pumps} tick ${c.state.tick} h ${h}: x ${got.x} vs ${want.x}, z ${got.z} vs ${want.z}`,
				);
			}
		} else out.inexact++;
	});
	return out;
}

function horizonText(m: ReadonlyMap<number, number>): string {
	const parts: string[] = [];
	for (let h = 0; h <= PREDICTION.maxTicks; h++) if (m.has(h)) parts.push(`${h}:${m.get(h)}`);
	return parts.join(" ");
}

describe("LocalPredictor in LockstepClient (docs/LOCAL_PREDICTION.md LP3)", () => {
	it("predicts the oracle's pose exactly when nothing is missed; the twin without prediction steps the same", () => {
		const o = run(undefined);
		print(
			`[predict] no misses: ${o.pumps} pumps, ${o.exact} exact, ${o.inexact} not; horizons ${horizonText(
				o.horizons,
			)}`,
		);
		expect(o.failures).toEqual([]);
		expect(o.inexact).toBe(0);
		expect(o.horizons.get(PREDICTION.maxTicks) ?? 0).toBeGreaterThan(o.pumps / 2);
	});

	it("with misses, every prediction whose inputs the server takes is exact; the misses are the corrections", () => {
		const o = run(MISS_EVERY);
		print(`[predict] a miss every ${MISS_EVERY}: ${o.pumps} pumps, ${o.exact} exact, ${o.inexact} not`);
		expect(o.failures).toEqual([]);
		expect(o.inexact).toBeGreaterThan(0);
		expect(o.exact).toBeGreaterThan(o.inexact);
	});

	it("the stats compare every stepped tick with its prediction (zero error without misses)", () => {
		const s = scripted(undefined);
		let last: LockstepClient | undefined;
		play(s, (c) => {
			last = c;
		});
		const st = last!.predictionStats()!;
		print(
			`[predict] stats: ${st.totalCompared} compared, mean ${st.meanError} max ${st.maxError}, ${st.totalCorrections} corrections`,
		);
		expect(st.totalCompared).toBeGreaterThan(TICKS / 2);
		expect(st.maxError).toBe(0);
		expect(st.totalCorrections).toBe(0);
		const sm = scripted(MISS_EVERY);
		play(sm, (c) => {
			last = c;
		});
		expect(last!.predictionStats()!.totalCorrections).toBeGreaterThan(0);
	});

	it("predicts nothing while the local player is dead or a draft is open, and never writes the state", () => {
		const setup = buildEndlessRunConfig(SEED, PLAYERS);
		const state = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		const sent = new Map<number, InputFrame>();
		for (let t = 0; t < 20; t++) sent.set(t, { moveX: AXIS_MAX, moveZ: 0, aimX: 0, aimZ: 0, buttons: 0 });
		const src: PredictionSource = {
			state,
			config: setup.config,
			localIndex: LOCAL,
			backlog() {
				return 0;
			},
			queuedFrame() {
				return undefined;
			},
			sentInput(t) {
				return sent.get(t);
			},
			lastSentInputTick() {
				return 19;
			},
			lastSteppedInput() {
				return undefined;
			},
		};
		const pr = new LocalPredictor(PREDICTION);
		const before = hashState(state);
		pr.rebuild(src);
		expect(hashState(state)).toBe(before);
		expect(pr.horizonTicks()).toBe(PREDICTION.maxTicks);
		expect(pr.predicted()!.x).toBeGreaterThan(playerAt(state, LOCAL).x);
		state.run!.players[0].draftOpen = 1;
		pr.rebuild(src);
		expect(pr.predicted()).toBeUndefined();
		state.run!.players[0].draftOpen = 0;
		playerAt(state, LOCAL).dead = 1;
		pr.rebuild(src);
		expect(pr.predicted()).toBeUndefined();
		playerAt(state, LOCAL).dead = 0;
		pr.rebuild(src);
		expect(pr.predicted()).toBeDefined();
	});

	it("bench: a rebuild at 10 and 30 ticks on an endless floor", () => {
		const setup = buildEndlessRunConfig(SEED, PLAYERS);
		const state = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		const frames = walkerFrames(SEED, 64);
		const lines: string[] = [];
		for (const h of [10, 30]) {
			const src: PredictionSource = {
				state,
				config: setup.config,
				localIndex: LOCAL,
				backlog() {
					return 0;
				},
				queuedFrame() {
					return undefined;
				},
				sentInput(t) {
					return frames[t];
				},
				lastSentInputTick() {
					return h - 1;
				},
				lastSteppedInput() {
					return undefined;
				},
			};
			const pr = new LocalPredictor({ ...PREDICTION, maxTicks: h });
			const n = 2000;
			const t0 = os.clock();
			for (let k = 0; k < n; k++) pr.rebuild(src);
			const ms = ((os.clock() - t0) * 1000) / n;
			expect(pr.horizonTicks()).toBe(h);
			lines.push(`${h} ticks ${string.format("%.4f", ms)} ms`);
		}
		print(`[predict] rebuild: ${lines.join(", ")} a rebuild (headless; target < 0.1 ms at 10)`);
	});
});
