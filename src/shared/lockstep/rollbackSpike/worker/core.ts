/**
 * The rollback probe's worker core (docs/ROLLBACK_SPIKE.md Design 5 / 7, tasks R3 / R4b, RBD6): everything the
 * Parallel Luau worker does, Roblox-API-free (the host injects the clock, the frame counter, gcinfo, the posts, the
 * yields and the MicroProfiler labels), so the headless specs drive it exactly as the client does.
 *
 * ## The mirror
 *
 * A `setup` message builds the mirror (setup.ts: the main client's own world builder, seed and party size) at tick 0.
 * Each `frames` message hands it the merged frames received since the last one (the truth) and the local player's own
 * frames sent past them, and names T, the main state's tick when it was sent. The core steps the mirror to T (every
 * tick with its merged frame, `stepParty`, the live model's `confirm` after each), answers a hash request at T with the
 * mirror's `hashState`, then predicts once on the mirror at T. In serial mode (`borrowed`) there is no mirror: the
 * main thread lends its own state (`lend`) before each pump and the core only runs the CPU probe on it.
 *
 * ## Per prediction
 *
 *   CPU probe  copy the confirmed state (a PooledStateCopier: R1b), step the copy H ticks with every player repeating
 *              their newest merged frame (solo: the local frame for the first tick, then neutral), discard it; fill
 *              the digest buffer (rollbackDigestBytes) from the copy and send it (host.sendDigest). Timed (host clock):
 *              copy, step (yields excluded), send, total, and the rendered frames from its start to its end.
 *   live       (co-op, parallel, `live`) the RollbackModel (Design 7) with horizonCap H: beginPredict(mirror) ->
 *              stepPredict(sliceTicks) until done -> finishPredict (the drawn tick T + min(D + L, H)); its metrics are
 *              the live window's.
 * Both step in slices of ROLLBACK_SPIKE.sliceTicks with `host.yieldSlice()` between slices (the worker yields to a
 * later parallel phase there; messages that arrive meanwhile wait in the inbox until the round ends: a new setup never
 * lands mid-prediction), and the mirror catches up in slices of
 * probe.mirrorSliceTicks. One prediction per pump round, after the inbox was drained: a worker that falls behind
 * coalesces frames (it predicts on the newest T), as a real sliced rollback would.
 *
 * ## Windows
 *
 * CPU: every ROLLBACK_SPIKE.statsWindowSec of host clock, one ProbeSummary (p50 / p95 / max of the samples, the
 * frames messages' frame ms as fps and p95, gcinfo growth, the case from the confirmed state); live: every
 * liveSummarySec one LiveSummary from the model's metrics (`toLiveSummaryCounts`, `leadSeen`, `totalSeconds`, then
 * `metrics.reset()`). A `control end` steps the mirror to its tick, posts both partial windows and stops. A window
 * with nothing in it is not posted.
 *
 * Errors (a gap in the merged frames, a frame missing, an unknown world) stop the core: `fail(message)` posts `error`.
 */
import {
	EMPTY_INPUT,
	copyInput,
	hashState,
	partySize,
	playerAt,
	stepParty,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import type { LiveSummary, ProbeSummary, RollbackProbeStat } from "shared/spikes";
import { ROLLBACK_PROBE_LIMITS } from "shared/spikes";
import { ROLLBACK_SPIKE, rollbackDigestBytes } from "../config";
import { RollbackModel, type RollbackGuessOracle } from "../model";
import { PooledStateCopier } from "../pooledCopy";
import { aliveActors, rollbackProbeCase } from "./device";
import {
	PACKED_INPUT_FIELDS,
	unpackInput,
	type RollbackFramesMsg,
	type RollbackMainToWorker,
	type RollbackSetupMsg,
	type RollbackWorkerToMain,
} from "./protocol";
import { buildRollbackMirror } from "./setup";
import { WindowSamples } from "./stats";

const PROBE = ROLLBACK_SPIKE.probe;
const LABELS = PROBE.profileLabels;
const MS = 1000;
const P95 = 0.95;
const BYTE_MAX = 255;
const U16_MAX = 65535;

/** What the core needs from where it runs (the Actor's script, the serial controller, a spec). */
export interface RollbackWorkerHost {
	/** Seconds (os.clock in the client). */
	clock(): number;
	/** Rendered frames so far (the worker: its Heartbeat count; serial: the main frame; a spec: frames delivered). */
	frameIndex(): number;
	/** The VM's gcinfo(), KB. */
	gcKb(): number;
	/** A message to the main thread (the worker flushes them in the serial phase). */
	post(msg: RollbackWorkerToMain): void;
	/** Sends the digest buffer to the main thread; returns the seconds the send itself took (waits excluded). */
	sendDigest(data: buffer, sentAt: number): number;
	/** Between two slices of work. */
	yieldSlice(): void;
	profileBegin(label: string): void;
	profileEnd(): void;
}

export interface RollbackWorkerCoreOptions {
	/** Test hook (R4b): the live model's teammates' true future inputs (the perfect-guess rule). */
	readonly oracle?: RollbackGuessOracle;
}

/** The CPU window's samples (seconds; frames as counts). */
class CpuWindow {
	readonly copy = new WindowSamples();
	readonly step = new WindowSamples();
	readonly send = new WindowSamples();
	readonly total = new WindowSamples();
	readonly frames = new WindowSamples();
	readonly frameMs = new WindowSamples();
	start = 0;
	gcStart = 0;

	clear(now: number, gc: number): void {
		this.copy.clear();
		this.step.clear();
		this.send.clear();
		this.total.clear();
		this.frames.clear();
		this.frameMs.clear();
		this.start = now;
		this.gcStart = gc;
	}
}

function clampStat(s: RollbackProbeStat, max: number): RollbackProbeStat {
	return { p50: math.min(s.p50, max), p95: math.min(s.p95, max), max: math.min(s.max, max) };
}

/**
 * Writes the digest of `state` into `buf` (rollbackDigestBytes): header (tick u32, actors u8, bullets u16, players
 * u8), up to digestActors actors (id u32, kind i16, alive u8, pad, x / z / hp f32), up to digestBullets enemy bullets
 * by slot (x / z f32, payload low u16, emitter u16), up to digestPlayers players (x / z f32, hearts u8, dead u8, pad).
 * What a real rollback would hand the main thread to draw (Design 5); the probe only times it.
 */
export function fillDigestBuffer(buf: buffer, state: Readonly<SimState>): void {
	const s = ROLLBACK_SPIKE;
	let o = PROBE.digestHeaderBytes;
	let actors = 0;
	for (const a of state.combat.actors) {
		if (actors >= s.digestActors) break;
		if (a.kind < 0) continue;
		buffer.writeu32(buf, o, a.id % (U16_MAX * U16_MAX));
		buffer.writei16(buf, o + 4, a.kind);
		buffer.writeu8(buf, o + 6, a.alive !== 0 ? 1 : 0);
		buffer.writef32(buf, o + 8, a.x);
		buffer.writef32(buf, o + 12, a.z);
		buffer.writef32(buf, o + 16, a.hp);
		o += PROBE.digestActorBytes;
		actors++;
	}
	o = PROBE.digestHeaderBytes + s.digestActors * PROBE.digestActorBytes;
	const pool = state.combat.enemyBullets;
	let bullets = 0;
	const top = pool.highWater();
	for (let i = 0; i < top && bullets < s.digestBullets; i++) {
		if (!pool.isLive(i)) continue;
		const p = pool.positionAt(i);
		buffer.writef32(buf, o, p.x);
		buffer.writef32(buf, o + 4, p.z);
		buffer.writeu16(buf, o + 8, pool.payloadAt(i) % (U16_MAX + 1));
		buffer.writeu16(buf, o + 10, pool.emitterIdAt(i) % (U16_MAX + 1));
		o += PROBE.digestBulletBytes;
		bullets++;
	}
	o = PROBE.digestHeaderBytes + s.digestActors * PROBE.digestActorBytes + s.digestBullets * PROBE.digestBulletBytes;
	const n = math.min(partySize(state), s.digestPlayers);
	for (let k = 0; k < n; k++) {
		const p = playerAt(state, k);
		buffer.writef32(buf, o, p.x);
		buffer.writef32(buf, o + 4, p.z);
		buffer.writeu8(buf, o + 8, math.clamp(p.hearts, 0, BYTE_MAX));
		buffer.writeu8(buf, o + 9, p.dead !== 0 ? 1 : 0);
		o += PROBE.digestPlayerBytes;
	}
	buffer.writeu32(buf, 0, state.tick);
	buffer.writeu8(buf, 4, actors);
	buffer.writeu16(buf, 5, bullets);
	buffer.writeu8(buf, 7, n);
}

/** The worker's core (see the file comment). */
export class RollbackWorkerCore {
	private readonly inbox: RollbackMainToWorker[] = [];
	private receivedPartySize: number | undefined;
	private running = false;
	private stopped = false;
	private reason: string | undefined;

	private setup: RollbackSetupMsg | undefined;
	private config: Readonly<SimConfig> | undefined;
	private mirror: SimState | undefined;
	private lent: SimState | undefined;
	private lentConfig: Readonly<SimConfig> | undefined;
	private n = 0;
	/** Merged frames not stepped by the mirror yet: truth[k] is tick truthBase + k (read from truthHead). */
	private truth: InputFrame[][] = [];
	private truthHead = 0;
	private truthBase = 0;
	/** One past the newest merged frame received. */
	private truthEnd = 0;
	/** The newest merged frame per player (the CPU probe's repeat-last guess). */
	private readonly lastTruth: InputFrame[] = [];
	private readonly guess: Array<Readonly<InputFrame>> = [];
	private readonly soloNeutral: Array<Readonly<InputFrame>> = [EMPTY_INPUT];
	private readonly scratchFrame: InputFrame = copyInput(EMPTY_INPUT);
	/** The main state's tick of the newest frames message (the mirror's target). */
	private target = 0;
	private endTick: number | undefined;
	private readonly hashRequests: number[] = [];
	private hashesAnswered = 0;
	private framesSince = false;

	private model: RollbackModel | undefined;
	private readonly copier = new PooledStateCopier();
	private readonly digest = buffer.create(rollbackDigestBytes());
	private readonly cpu = new CpuWindow();
	private cpuIndex = 0;
	private liveStart = 0;
	private liveIndex = 0;
	private lastStatus = -math.huge;
	private lastTotal = 0;
	private lastFrames = 0;

	constructor(private readonly host: RollbackWorkerHost, private readonly options: RollbackWorkerCoreOptions = {}) {}

	/** The newest setup's party size (the frames validator needs it), or undefined before any setup was received. */
	partySize(): number | undefined {
		return this.receivedPartySize;
	}

	isStopped(): boolean {
		return this.stopped;
	}

	stopReason(): string | undefined {
		return this.reason;
	}

	/** The mirror state (undefined in serial mode or before a setup). Read only: specs and debug. */
	mirrorState(): Readonly<SimState> | undefined {
		return this.mirror;
	}

	/** The live model (co-op parallel with `live`), if any. Read only: specs. */
	liveModel(): RollbackModel | undefined {
		return this.model;
	}

	/** Queues a message (validated by the caller: readMainToWorker). The next pump applies it. */
	receive(msg: RollbackMainToWorker): void {
		if (msg.kind === "setup") this.receivedPartySize = msg.partySize;
		this.inbox.push(msg);
	}

	/** Serial mode: the main thread's own state and run config, for this frame's pump (never stepped by the core). */
	lend(state: SimState, config: Readonly<SimConfig>): void {
		this.lent = state;
		this.lentConfig = config;
	}

	/** Stops the core with an error posted to the main thread. */
	fail(message: string): void {
		if (this.stopped) return;
		this.stopped = true;
		this.reason = message;
		this.host.post({ kind: "error", message });
	}

	/**
	 * Applies the inbox, catches the mirror up, predicts once; repeats while messages arrived during the work (yields).
	 * Returns when caught up with nothing new. Re-entrant calls (a message handler while the pump is suspended in a
	 * yield) return at once: the running pump picks their messages up.
	 */
	pump(): void {
		if (this.running) return;
		this.running = true;
		while (!this.stopped) {
			this.drain();
			if (this.stopped || this.setup === undefined) break;
			if (!this.catchUp()) break;
			if (this.endTick !== undefined && this.confirmedTick() >= this.endTick) {
				this.flush();
				this.stopped = true;
				this.reason = "ended";
				break;
			}
			if (!this.framesSince) break;
			this.framesSince = false;
			this.predict();
			this.windows();
		}
		this.running = false;
	}

	// ---- inbox ------------------------------------------------------------------------------------

	private drain(): void {
		while (this.inbox.size() > 0 && !this.stopped) {
			const msg = this.inbox.remove(0)!;
			if (msg.kind === "setup") this.start(msg);
			else if (msg.kind === "frames") this.frames(msg);
			else if (msg.op === "stop") {
				this.stopped = true;
				this.reason = "stopped";
			} else {
				this.endTick = msg.tick;
				if (msg.tick > this.target) this.target = msg.tick;
			}
		}
	}

	private start(msg: RollbackSetupMsg): void {
		this.setup = msg;
		this.n = msg.partySize;
		this.truth = [];
		this.truthHead = 0;
		this.truthBase = 0;
		this.truthEnd = 0;
		this.target = 0;
		this.endTick = undefined;
		this.hashRequests.clear();
		this.framesSince = false;
		this.lastTruth.clear();
		this.guess.clear();
		for (let k = 0; k < this.n; k++) {
			this.lastTruth.push(copyInput(EMPTY_INPUT));
			this.guess.push(this.lastTruth[k]);
		}
		this.model = undefined;
		this.mirror = undefined;
		this.config = undefined;
		if (!msg.borrowed) {
			const run = buildRollbackMirror(msg);
			this.mirror = run.state;
			this.config = run.config;
			if (msg.live && msg.coop) {
				const model = new RollbackModel({
					playerIndex: msg.localIndex,
					config: run.config,
					strategy: msg.strategy,
					// H caps the live prediction too (the gate's question is "at horizon H"): drawn tick T + min(D + L, H).
					horizonCap: msg.horizon,
					oracle: this.options.oracle,
				});
				model.reset(run.state);
				this.model = model;
			}
		}
		const now = this.host.clock();
		this.cpu.clear(now, this.host.gcKb());
		this.cpuIndex = 0;
		this.liveStart = now;
		this.liveIndex = 0;
		this.lastStatus = -math.huge;
	}

	private frames(msg: RollbackFramesMsg): void {
		const n = this.n;
		const per = n * PACKED_INPUT_FIELDS;
		const ticks = msg.truth.size() / per;
		const model = this.model;
		for (let k = 0; k < ticks; k++) {
			const tick = msg.truthFirst + k;
			if (tick < this.truthEnd) continue;
			if (tick > this.truthEnd) {
				this.fail(`merged frames gap: tick ${tick} after ${this.truthEnd}`);
				return;
			}
			const row: InputFrame[] = [];
			for (let i = 0; i < n; i++) {
				const f = unpackInput(msg.truth, k * per + i * PACKED_INPUT_FIELDS, copyInput(EMPTY_INPUT));
				row.push(f);
				copyInput(f, this.lastTruth[i]);
			}
			if (this.mirror !== undefined) this.truth.push(row);
			model?.putTruth(tick, row);
			this.truthEnd = tick + 1;
		}
		if (model !== undefined) {
			const own = msg.own.size() / PACKED_INPUT_FIELDS;
			for (let k = 0; k < own; k++) {
				model.putOwn(msg.ownFirst + k, unpackInput(msg.own, k * PACKED_INPUT_FIELDS, this.scratchFrame));
			}
		}
		if (msg.tick > this.target) this.target = msg.tick;
		if (msg.hashTick >= 0 && this.mirror !== undefined) this.hashRequests.push(msg.hashTick);
		this.cpu.frameMs.add(msg.frameMs);
		this.framesSince = true;
	}

	// ---- the mirror -------------------------------------------------------------------------------

	/** The confirmed state's tick: the mirror's, or the lent state's. */
	private confirmedTick(): number {
		return this.mirror?.tick ?? this.lent?.tick ?? 0;
	}

	/** Steps the mirror to the target (slices with yields). False when the core failed. */
	private catchUp(): boolean {
		const mirror = this.mirror;
		if (mirror === undefined) return true;
		const config = this.config!;
		const host = this.host;
		let sliced = 0;
		this.answerHashes(mirror);
		while (mirror.tick < this.target && !this.stopped) {
			const t = mirror.tick;
			const k = t - this.truthBase;
			if (k < this.truthHead || k >= this.truth.size()) {
				this.fail(`mirror: no merged frame for tick ${t} (received through ${this.truthEnd - 1})`);
				return false;
			}
			if (sliced === 0) host.profileBegin(LABELS.mirror);
			stepParty(mirror, this.truth[k], config);
			this.truthHead = k + 1;
			this.model?.confirm(mirror);
			this.answerHashes(mirror);
			sliced++;
			if (sliced >= PROBE.mirrorSliceTicks && mirror.tick < this.target) {
				host.profileEnd();
				sliced = 0;
				host.yieldSlice();
			}
		}
		if (sliced > 0) host.profileEnd();
		this.compact();
		return !this.stopped;
	}

	private answerHashes(mirror: SimState): void {
		const req = this.hashRequests;
		while (req.size() > 0 && req[0] <= mirror.tick) {
			const tick = req.remove(0)!;
			if (tick !== mirror.tick) continue; // passed (never: a request comes with the target it names)
			this.hashesAnswered++;
			this.host.post({ kind: "mirrorHash", tick, hash: hashState(mirror) });
		}
	}

	/** Drops stepped merged frames now and then. */
	private compact(): void {
		const head = this.truthHead;
		if (head < PROBE.mirrorSliceTicks * 2 || head * 2 < this.truth.size()) return;
		const kept: InputFrame[][] = [];
		for (let k = head; k < this.truth.size(); k++) kept.push(this.truth[k]);
		this.truth = kept;
		this.truthBase += head;
		this.truthHead = 0;
	}

	// ---- predictions ------------------------------------------------------------------------------

	private predict(): void {
		const setup = this.setup!;
		const state = this.mirror ?? this.lent;
		const config = this.mirror !== undefined ? this.config : this.lentConfig;
		if (state === undefined || config === undefined) return;
		this.cpuProbe(state, config, setup.horizon);
		const model = this.model;
		if (model === undefined || this.stopped) return;
		const host = this.host;
		host.yieldSlice();
		model.beginPredict(state);
		const slice = ROLLBACK_SPIKE.sliceTicks;
		while (model.isPredicting()) {
			host.profileBegin(LABELS.live);
			const done = model.stepPredict(slice);
			host.profileEnd();
			if (done) {
				model.finishPredict();
				break;
			}
			host.yieldSlice();
		}
	}

	/** One CPU prediction: copy, H steps of repeat-last guesses, the digest send (see the file comment). */
	private cpuProbe(state: SimState, config: Readonly<SimConfig>, H: number): void {
		const host = this.host;
		const startFrame = host.frameIndex();
		host.profileBegin(LABELS.copy);
		const c0 = host.clock();
		const copy = this.copier.copyInto(state);
		const c1 = host.clock();
		host.profileEnd();
		const solo = this.n === 1 && partySize(state) === 1;
		const slice = ROLLBACK_SPIKE.sliceTicks;
		let stepSec = 0;
		let inSlice = 0;
		for (let i = 0; i < H; i++) {
			if (inSlice === 0) host.profileBegin(LABELS.step);
			const s0 = host.clock();
			stepParty(copy, solo && i > 0 ? this.soloNeutral : this.guess, config);
			stepSec += host.clock() - s0;
			inSlice++;
			if (inSlice >= slice || i === H - 1) {
				host.profileEnd();
				inSlice = 0;
				if (i < H - 1) host.yieldSlice();
			}
		}
		host.profileBegin(LABELS.send);
		const d0 = host.clock();
		fillDigestBuffer(this.digest, copy);
		const fillSec = host.clock() - d0;
		const postSec = host.sendDigest(this.digest, host.clock());
		host.profileEnd();
		const sendSec = fillSec + postSec;
		const copySec = c1 - c0;
		const total = copySec + stepSec + sendSec;
		const frames = host.frameIndex() - startFrame + 1;
		const w = this.cpu;
		w.copy.add(copySec);
		w.step.add(stepSec);
		w.send.add(sendSec);
		w.total.add(total);
		w.frames.add(frames);
		this.lastTotal = total;
		this.lastFrames = frames;
	}

	// ---- windows ----------------------------------------------------------------------------------

	private windows(): void {
		const now = this.host.clock();
		if (now - this.cpu.start >= ROLLBACK_SPIKE.statsWindowSec) this.postCpu(now);
		if (this.model !== undefined && now - this.liveStart >= ROLLBACK_SPIKE.liveSummarySec) this.postLive(now);
		if (now - this.lastStatus >= PROBE.statusSec) {
			this.lastStatus = now;
			this.host.post({
				kind: "status",
				tick: this.confirmedTick(),
				totalMs: math.min(this.lastTotal * MS, ROLLBACK_PROBE_LIMITS.maxMs),
				framesPerPrediction: math.min(this.lastFrames, ROLLBACK_PROBE_LIMITS.maxFrames),
				samples: this.cpu.total.count(),
				liveFrames: this.model?.metrics.frames ?? 0,
				hashes: this.hashesAnswered,
			});
		}
	}

	/** Both windows as they are (the end of a run). */
	private flush(): void {
		const now = this.host.clock();
		this.postCpu(now);
		if (this.model !== undefined) this.postLive(now);
	}

	/** The CPU window's summary (if it holds a sample), then a new window. */
	private postCpu(now: number): void {
		const setup = this.setup!;
		const w = this.cpu;
		const state = this.mirror ?? this.lent;
		const gc = this.host.gcKb();
		if (w.total.count() > 0 && state !== undefined) {
			const L = ROLLBACK_PROBE_LIMITS;
			const seconds = math.min(now - w.start, L.maxWindowSeconds);
			const frameSec = w.frameMs.total() / MS;
			const summary: ProbeSummary = {
				sessionId: setup.sessionId,
				windowIndex: math.min(this.cpuIndex, L.maxWindowIndex),
				mode: setup.mode,
				horizon: setup.horizon,
				case: rollbackProbeCase(state),
				partySize: this.n,
				actors: math.min(aliveActors(state), L.maxActors),
				enemyBullets: math.min(state.combat.enemyBullets.activeCount, L.maxBullets),
				clone: clampStat(w.copy.stat(MS), L.maxMs),
				step: clampStat(w.step.stat(MS), L.maxMs),
				send: clampStat(w.send.stat(MS), L.maxMs),
				total: clampStat(w.total.stat(MS), L.maxMs),
				framesPerPrediction: clampStat(w.frames.stat(), L.maxFrames),
				samples: math.min(w.total.count(), L.maxSamples),
				windowSeconds: seconds,
				renderFps: frameSec > 0 ? math.min(w.frameMs.count() / frameSec, L.maxFps) : 0,
				frameMsP95: math.min(w.frameMs.quantile(P95), L.maxMs),
				gcKbPerSec: seconds > 0 ? math.clamp((gc - w.gcStart) / seconds, -L.maxGcKbPerSec, L.maxGcKbPerSec) : 0,
				native: setup.native,
				deviceLabel: setup.deviceLabel,
				deviceClass: setup.deviceClass,
			};
			this.cpuIndex++;
			this.host.post({ kind: "cpu", summary });
		}
		w.clear(now, gc);
	}

	/** The live window's summary (if any frame was predicted), then the model's metrics reset. */
	private postLive(now: number): void {
		const setup = this.setup!;
		const model = this.model!;
		const m = model.metrics;
		if (m.frames > 0) {
			const L = ROLLBACK_PROBE_LIMITS;
			const summary: LiveSummary = {
				sessionId: setup.sessionId,
				windowIndex: math.min(this.liveIndex, L.maxWindowIndex),
				strategy: model.strategy,
				horizon: math.clamp(model.horizonCap, 1, L.maxHorizon),
				partySize: this.n,
				playerIndex: setup.localIndex,
				seconds: math.min(m.totalSeconds(), L.maxWindowSeconds),
				lead: m.leadSeen(),
				rooms: m.toLiveSummaryCounts(),
				deviceLabel: setup.deviceLabel,
				deviceClass: setup.deviceClass,
			};
			this.liveIndex++;
			this.host.post({ kind: "live", summary });
		}
		m.reset();
		this.liveStart = now;
	}
}
