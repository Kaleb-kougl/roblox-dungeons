/**
 * The rollback probe's worker core (docs/ROLLBACK_SPIKE.md R3 / R4b), headless: a recorded bot party run fed through
 * the main-side feed (RollbackFeed) and the core frame by frame as a client would, on a fixed network (L, D) like the
 * R2 harness, the "main state" a plain replay of the same log:
 *
 *   1. synchronous slices (the yields return at once): the mirror's hash equals the plain replay's at every check, the
 *      CPU and live windows come out and pass the server's readers (through readWorkerToMain), and the live windows'
 *      counts summed equal the R2 harness's offline counts for the same run and (L, D) exactly (seconds within
 *      rounding), the CPU probe running beside the live model the whole time;
 *   2. the perfect-guess hook (teammates' true future frames): every glitch metric is zero;
 *   3. one slice per rendered frame (each yield delivers the next frame's message, as a worker that resumes once a
 *      frame): the mirror still matches, predictions span several frames (framesPerPrediction > 1), the worker
 *      coalesces frames (fewer predictions than frames) and the live counts differ from the offline ones only through
 *      that (printed);
 *   4. serial mode (a lent state): the CPU windows come out and the lent state's hash is unchanged.
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import { ROLLBACK_LIVE_METRICS, type LiveSummary, type ProbeSummary, type RollbackLiveMetric } from "shared/spikes";
import {
	createSimState,
	hashState,
	partyFrameAt,
	recordingPartySize,
	stepRecorded,
	type InputFrame,
	type Recording,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { recordPartyRun, type RecordedPartyRun } from "shared/run/testing";
import { ROLLBACK_GLITCH_METRICS, ROLLBACK_SPIKE, recordedFrame, runModelOverRecording } from "..";
import {
	RollbackFeed,
	RollbackWorkerCore,
	readMainToWorker,
	readWorkerToMain,
	type RollbackFrameSource,
	type RollbackSetupMsg,
	type RollbackWorkerHost,
	type RollbackWorkerToMain,
} from ".";

const SEED = 4242;
const PLAYERS = 3;
const WALK_TICKS = 900;
const OBSERVER = 1;
const L = 11;
const D = 4;
/** H in these specs (the CPU probe's ticks, and the live model's cap: it predicts min(D + L, H) = 8 ahead). */
const H = 8;
/** Simulated seconds per rendered frame: CPU windows every 100 frames, live windows every 600. */
const FRAME_SEC = 0.1;
const FRAME_MS = 16.7;
/** Hash checks every this many ticks (the client's ROLLBACK_SPIKE.mirrorHashTicks is 600). */
const HASH_EVERY = 120;
/** Frames of the one-slice-per-frame pass (from tick 0). */
const YIELD_FRAMES = 360;

let cached: RecordedPartyRun | undefined;
function run(): RecordedPartyRun {
	if (cached === undefined) cached = recordPartyRun(SEED, PLAYERS, { walkTicks: WALK_TICKS, boss: false });
	return cached;
}

/** The recording seen by player `i` at confirmed tick T: merged frames through T + D - 1, own through T + D + L - 1. */
class FixedNetSource implements RollbackFrameSource {
	T = 0;
	private readonly merged: Array<Readonly<InputFrame>> = [];
	constructor(private readonly rec: Readonly<Recording>, private readonly i: number) {}
	tick(): number {
		return this.T;
	}
	truthEnd(): number {
		return math.min(this.T + D, this.rec.frames.size());
	}
	truthAt(tick: number, out: InputFrame[]): boolean {
		if (tick >= this.truthEnd()) return false;
		partyFrameAt(this.rec, tick, this.merged);
		for (let k = 0; k < out.size(); k++) {
			const f = this.merged[k];
			out[k].moveX = f.moveX;
			out[k].moveZ = f.moveZ;
			out[k].aimX = f.aimX;
			out[k].aimZ = f.aimZ;
			out[k].buttons = f.buttons;
		}
		return true;
	}
	ownEnd(): number {
		return math.min(this.T + D + L, this.rec.frames.size());
	}
	ownAt(tick: number): Readonly<InputFrame> | undefined {
		return tick < this.rec.frames.size() ? recordedFrame(this.rec, this.i, tick) : undefined;
	}
}

/**
 * The clock: simulated seconds (FRAME_SEC per delivered frame: the windows' boundaries) plus the real time since the
 * frame was delivered (the probe's measured durations).
 */
class SpecHost implements RollbackWorkerHost {
	sim = 0;
	frame = 0;
	frameReal = os.clock();
	yields = 0;
	digests = 0;
	readonly posts: RollbackWorkerToMain[] = [];
	onYield: (() => void) | undefined;
	clock(): number {
		return this.sim + (os.clock() - this.frameReal);
	}
	nextFrame(): void {
		this.frame++;
		this.sim += FRAME_SEC;
		this.frameReal = os.clock();
	}
	frameIndex(): number {
		return this.frame;
	}
	gcKb(): number {
		return gcinfo();
	}
	post(msg: RollbackWorkerToMain): void {
		// Through the main side's validator, as the client reads it.
		const back = readWorkerToMain(msg);
		if (back === undefined) error(`worker posted a message its reader refuses: ${msg.kind}`, 0);
		this.posts.push(back);
	}
	sendDigest(data: buffer): number {
		this.digests++;
		expect(buffer.len(data)).toBeGreaterThan(0);
		return 0;
	}
	yieldSlice(): void {
		this.yields++;
		this.onYield?.();
	}
	profileBegin(): void {}
	profileEnd(): void {}
}

function setupMsg(n: number, live: boolean, borrowed = false): RollbackSetupMsg {
	const msg = {
		kind: "setup",
		sessionId: "spec-0000-session",
		mode: borrowed ? "serial" : "parallel",
		horizon: H,
		worldKind: "endless",
		seed: SEED,
		partySize: n,
		localIndex: OBSERVER,
		coop: true,
		atBossDoor: false,
		scoring: false,
		stress: 0,
		live,
		strategy: "repeatLast",
		borrowed,
		deviceLabel: "headless spec",
		deviceClass: "pc",
		native: false,
	};
	// The worker re-reads every message (the validator is part of the path).
	const read = readMainToWorker(msg, undefined);
	if (read === undefined || read.kind !== "setup") error("setup refused by its reader", 0);
	return read;
}

interface PassResult {
	readonly host: SpecHost;
	readonly core: RollbackWorkerCore;
	readonly feed: RollbackFeed;
	readonly last: number;
	readonly checks: number;
	readonly cpu: ProbeSummary[];
	readonly live: LiveSummary[];
	readonly frames: number;
}

/**
 * Feeds the run's ticks [0, frames) through the feed and the core, the plain replay stepping after each message; then
 * `control end`. `perFrameYield`: the core's yields deliver the next frame instead (pass 3).
 */
function pass(options: { frames?: number; perFrameYield?: boolean; oracle?: boolean }): PassResult {
	const r = run();
	const rec = r.recording;
	const config: Readonly<SimConfig> = r.setup.config;
	const n = recordingPartySize(rec);
	const total = rec.frames.size();
	const last = math.min(options.frames ?? total, total - D - L);
	const host = new SpecHost();
	const core = new RollbackWorkerCore(host, {
		oracle: options.oracle === true ? (t, k) => (t < total ? recordedFrame(rec, k, t) : undefined) : undefined,
	});
	const feed = new RollbackFeed(n, HASH_EVERY);
	const src = new FixedNetSource(rec, OBSERVER);
	const main: SimState = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, config);
	let checks = 0;
	const deliver = (): boolean => {
		if (src.T >= last) return false;
		const msg = feed.next(src, FRAME_MS, () => hashState(main));
		if (typeIs(msg, "string")) error(msg, 0);
		const read = readMainToWorker(msg, core.partySize());
		if (read === undefined) error(`frames message refused at ${src.T}`, 0);
		core.receive(read);
		stepRecorded(main, rec, src.T, config);
		src.T++;
		host.nextFrame();
		return true;
	};
	core.receive(setupMsg(n, true));
	if (options.perFrameYield === true) host.onYield = () => deliver();
	while (deliver()) core.pump();
	core.receive({ kind: "control", op: "end", tick: last });
	core.pump();
	expect(core.stopReason()).toBe("ended");
	expect(core.mirrorState()!.tick).toBe(last);
	expect(hashState(core.mirrorState()!)).toBe(hashState(main));
	const cpu: ProbeSummary[] = [];
	const live: LiveSummary[] = [];
	for (const p of host.posts) {
		if (p.kind === "mirrorHash") {
			const res = feed.checkMirrorHash(p.tick, p.hash);
			if (res.kind !== "ok") error(`mirror hash ${res.kind} at tick ${p.tick}`, 0);
			checks++;
		} else if (p.kind === "cpu") cpu.push(p.summary);
		else if (p.kind === "live") live.push(p.summary);
		else if (p.kind === "error") error(`worker error: ${p.message}`, 0);
	}
	return { host, core, feed, last, checks, cpu, live, frames: src.T };
}

/**
 * A window per `windowSec` of simulated time plus the partial one at the end (a boundary can land a frame late: the
 * clock carries the frame's real time too).
 */
function expectWindows(count: number, frames: number, windowSec: number): void {
	const per = windowSec / FRAME_SEC;
	expect(count).toBeGreaterThanOrEqual(math.floor(frames / (per + 1)));
	expect(count).toBeLessThanOrEqual(math.ceil(frames / per) + 1);
}

/** Every metric summed over the live windows. */
function liveTotals(windows: ReadonlyArray<LiveSummary>): Map<RollbackLiveMetric, number> {
	const out = new Map<RollbackLiveMetric, number>();
	for (const m of ROLLBACK_LIVE_METRICS) out.set(m, 0);
	for (const w of windows) {
		for (const [, room] of pairs(w.rooms as unknown as Map<string, { counts: Map<RollbackLiveMetric, number> }>)) {
			for (const [m, c] of pairs(room.counts)) out.set(m, out.get(m)! + c);
		}
	}
	return out;
}

function liveSeconds(windows: ReadonlyArray<LiveSummary>): number {
	let s = 0;
	for (const w of windows) s += w.seconds;
	return s;
}

function countsLine(m: ReadonlyMap<RollbackLiveMetric, number>): string {
	const parts: string[] = [];
	for (const name of ROLLBACK_LIVE_METRICS) {
		const c = m.get(name) ?? 0;
		if (c !== 0) parts.push(`${name}=${c}`);
	}
	return parts.join(" ");
}

describe("rollback probe worker core (R3 / R4b)", () => {
	it("mirrors the run, posts valid windows, and its live counts equal the offline harness's", () => {
		const t0 = os.clock();
		const r = run();
		const p = pass({});
		const t1 = os.clock();
		// Mirror: every hash check answered and equal to the plain replay's.
		expect(p.checks).toBe(math.floor((p.last - 1) / HASH_EVERY));
		expect(p.feed.pendingChecks()).toBe(0);
		// CPU windows: one per 100 frames plus the partial one at the end, each with samples and H.
		expectWindows(p.cpu.size(), p.frames, ROLLBACK_SPIKE.statsWindowSec);
		for (let k = 0; k < p.cpu.size(); k++) {
			const w = p.cpu[k];
			expect(w.windowIndex).toBe(k);
			expect(w.horizon).toBe(H);
			expect(w.samples).toBeGreaterThan(0);
			expect(w.framesPerPrediction.max).toBe(1);
			expect(w.partySize).toBe(PLAYERS);
		}
		let samples = 0;
		for (const w of p.cpu) samples += w.samples;
		expect(samples).toBe(p.frames);
		expect(p.host.digests).toBe(p.frames);
		// Live windows: the same numbers as R2's harness over the same run and (L, D).
		expectWindows(p.live.size(), p.frames, ROLLBACK_SPIKE.liveSummarySec);
		const offline = runModelOverRecording(r.setup.config, r.recording, {
			playerIndex: OBSERVER,
			L,
			D,
			H,
			toTick: p.last,
		});
		const t2 = os.clock();
		const live = liveTotals(p.live);
		let any = 0;
		for (const m of ROLLBACK_LIVE_METRICS) {
			expect(`${m}=${live.get(m)}`).toBe(`${m}=${offline.metrics.total(m)}`);
			any += live.get(m)!;
		}
		expect(any).toBeGreaterThan(0);
		expect(math.abs(liveSeconds(p.live) - offline.seconds)).toBeLessThan(1e-6);
		const cpu0 = p.cpu[1] ?? p.cpu[0];
		print(
			`[R3] worker core: ${p.frames} frames, ${p.checks} mirror hash checks equal, ${p.cpu.size()} CPU and ` +
				`${p.live.size()} live windows; window 1: clone ${string.format("%.2f", cpu0.clone.p50)} ms p50 step ` +
				`${string.format("%.2f", cpu0.step.p50)} ms p50 (H ${H}) case ${cpu0.case} actors ${cpu0.actors}; ` +
				`core pass ${string.format("%.1f", t1 - t0)} s, offline ${string.format("%.1f", t2 - t1)} s`,
		);
		print(`[R4b] live = offline (L ${L}, D ${D}, player ${OBSERVER}): ${countsLine(live)}`);
	});

	it("perfect guesses through the core: every glitch metric is zero", () => {
		const p = pass({ frames: YIELD_FRAMES, oracle: true });
		const live = liveTotals(p.live);
		for (const m of ROLLBACK_GLITCH_METRICS) expect(`${m}=${live.get(m)}`).toBe(`${m}=0`);
		expect(p.checks).toBeGreaterThan(0);
	});

	it("one slice per frame: the mirror still matches, predictions span frames, frames coalesce", () => {
		const p = pass({ frames: YIELD_FRAMES, perFrameYield: true });
		expect(p.checks).toBe(math.floor((p.last - 1) / HASH_EVERY));
		let predictions = 0;
		let maxFrames = 0;
		for (const w of p.cpu) {
			predictions += w.samples;
			maxFrames = math.max(maxFrames, w.framesPerPrediction.max);
		}
		expect(maxFrames).toBeGreaterThan(1);
		expect(predictions).toBeLessThan(p.frames);
		const r = run();
		const offline = runModelOverRecording(r.setup.config, r.recording, {
			playerIndex: OBSERVER,
			L,
			D,
			H,
			toTick: p.last,
		});
		const live = liveTotals(p.live);
		print(
			`[R3] one slice per frame: ${p.frames} frames, ${predictions} CPU predictions, frames/prediction max ` +
				`${maxFrames}, ${p.host.yields} yields, ${p.checks} hash checks equal (offline: ${offline.metrics.predictions} ` +
				`predictions, one per frame)`,
		);
		print(`[R4b] one slice per frame, live: ${countsLine(live)} | offline: ${countsLine(totals(offline.metrics))}`);
	});

	it("serial mode: CPU windows on a lent state, which stays unchanged", () => {
		const r = run();
		const rec = r.recording;
		const config = r.setup.config;
		const n = recordingPartySize(rec);
		const host = new SpecHost();
		const core = new RollbackWorkerCore(host);
		const feed = new RollbackFeed(n, HASH_EVERY);
		const src = new FixedNetSource(rec, OBSERVER);
		const main = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, config);
		core.receive(setupMsg(n, false, true));
		const frames = 120;
		for (let f = 0; f < frames; f++) {
			const msg = feed.next(src, FRAME_MS, () => hashState(main));
			if (typeIs(msg, "string")) error(msg, 0);
			core.receive(msg);
			const before = hashState(main);
			core.lend(main, config);
			core.pump();
			expect(hashState(main)).toBe(before);
			stepRecorded(main, rec, src.T, config);
			src.T++;
			host.nextFrame();
		}
		expect(core.mirrorState()).toBeUndefined();
		const cpu = host.posts.filter((p) => p.kind === "cpu");
		expect(cpu.size()).toBeGreaterThanOrEqual(math.floor(frames / (ROLLBACK_SPIKE.statsWindowSec / FRAME_SEC)) - 1);
		expect(cpu.size()).toBeGreaterThan(0);
		expect(host.posts.filter((p) => p.kind === "live").size()).toBe(0);
		expect(host.posts.filter((p) => p.kind === "mirrorHash").size()).toBe(0);
	});
});

/** Every metric's total of a metrics object. */
function totals(m: { total(metric: RollbackLiveMetric): number }): Map<RollbackLiveMetric, number> {
	const out = new Map<RollbackLiveMetric, number>();
	for (const name of ROLLBACK_LIVE_METRICS) out.set(name, m.total(name));
	return out;
}
