import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, HttpService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore } from "client/store";
import { ROLLBACK_SPIKE_ATTRIBUTES, ROLLBACK_SPIKE_MODE_NAMES, type RollbackSpikeModeName } from "shared/config";
import {
	ROLLBACK_SPIKE,
	ROLLBACK_WORKER_TOPIC,
	RollbackFeed,
	RollbackWorkerCore,
	buildFactsRun,
	bufferAfter,
	busyWait,
	factsBufferProbe,
	factsLine,
	factsTableProbe,
	frameLine,
	lockstepFrameSource,
	readWorkerToMain,
	rollbackDeviceClass,
	rollbackDeviceLabel,
	soloFrameSource,
	stepFactsRun,
	tableAfter,
	type RollbackDeviceFacts,
	type RollbackFrameSource,
	type RollbackMainToWorker,
	type RollbackSetupMsg,
	type RollbackStatusMsg,
	type RollbackWorkerHost,
	type TableArrival,
} from "shared/lockstep";
import { RUN_ATTRIBUTES } from "shared/play";
import { hashState, type SimConfig, type SimState } from "shared/sim";
import { ROLLBACK_PROBE_LIMITS, describeLiveSummary, describeProbeSummary, type ProbeSummary } from "shared/spikes";
import { RENDER_ORDER } from "shared/view";
import { SimController, type RunContext } from "../game/SimController";

const PROBE = ROLLBACK_SPIKE.probe;
const FACTS = PROBE.facts;
const RENDER_STEP = "KV_RollbackProbe";
const ACTOR_NAME = "KV_RollbackWorker";
const REPLY_ACTOR_NAME = "KV_RollbackFactsReply";
/** The disabled worker template: StarterPlayerScripts.TS.rollbackWorker.worker (out/client/rollbackWorker). */
const TEMPLATE_FOLDER = "rollbackWorker";
const TEMPLATE_SCRIPT = "worker";
const MS = 1000;
const TAG = "[Rollback]";

type ProbeMode = "parallel" | "serial";

function readHorizon(): number {
	const raw = Workspace.GetAttribute(ROLLBACK_SPIKE_ATTRIBUTES.horizon);
	if (!typeIs(raw, "number") || raw !== raw) return 0;
	return math.clamp(math.floor(raw), 0, ROLLBACK_PROBE_LIMITS.maxHorizon);
}

function readMode(): RollbackSpikeModeName {
	const raw = Workspace.GetAttribute(ROLLBACK_SPIKE_ATTRIBUTES.mode);
	return typeIs(raw, "string") && (ROLLBACK_SPIKE_MODE_NAMES as ReadonlyArray<string>).includes(raw)
		? (raw as RollbackSpikeModeName)
		: "parallel";
}

function deviceFacts(): RollbackDeviceFacts {
	const viewport = Workspace.CurrentCamera?.ViewportSize ?? new Vector2(0, 0);
	return {
		tenFoot: GuiService.IsTenFootInterface(),
		touch: UserInputService.TouchEnabled,
		keyboard: UserInputService.KeyboardEnabled,
		gamepad: UserInputService.GamepadEnabled,
		viewportX: viewport.X,
		viewportY: viewport.Y,
	};
}

/** The template's folder (PlayerScripts.TS.rollbackWorker), found from this module's place in the same tree. */
function workerTemplate(): LocalScript | undefined {
	const tsRoot = script.Parent?.Parent?.Parent;
	const t = tsRoot?.FindFirstChild(TEMPLATE_FOLDER)?.FindFirstChild(TEMPLATE_SCRIPT);
	return t !== undefined && t.IsA("LocalScript") ? t : undefined;
}

/** An Actor under PlayerScripts with the reply event and an enabled clone of the worker (janitor-owned). */
function spawnWorker(janitor: Janitor): { actor: Actor; reply: BindableEvent } | string {
	const template = workerTemplate();
	if (template === undefined) return `worker template ${TEMPLATE_FOLDER}.${TEMPLATE_SCRIPT} not found`;
	const actor = new Instance("Actor");
	actor.Name = ACTOR_NAME;
	const reply = new Instance("BindableEvent");
	reply.Name = ROLLBACK_WORKER_TOPIC.replyEventName;
	reply.Parent = actor;
	const worker = template.Clone();
	worker.Enabled = false;
	worker.Parent = actor;
	janitor.Add(actor);
	actor.Parent = Players.LocalPlayer.WaitForChild("PlayerScripts");
	worker.Enabled = true;
	return { actor, reply };
}

/** Serial mode: the core on the main thread, its posts handled at once, no yields. */
class SerialHost implements RollbackWorkerHost {
	constructor(private readonly frames: () => number, private readonly onPost: (msg: unknown) => void) {}

	clock(): number {
		return os.clock();
	}

	frameIndex(): number {
		return this.frames();
	}

	gcKb(): number {
		return gcinfo();
	}

	post(msg: unknown): void {
		this.onPost(msg);
	}

	sendDigest(data: buffer, sentAt: number): number {
		const t0 = os.clock();
		this.onPost({ kind: "digest", sentAt, data });
		return os.clock() - t0;
	}

	yieldSlice(): void {}

	profileBegin(label: string): void {
		debug.profilebegin(label);
	}

	profileEnd(): void {
		debug.profileend();
	}
}

/** One run's probe (a new session per run start; see RollbackSpikeController). */
class ProbeSession {
	readonly janitor = new Janitor();
	readonly feed: RollbackFeed;
	private actor: Actor | undefined;
	private core: RollbackWorkerCore | undefined;
	private ready = false;
	private readonly pending: RollbackMainToWorker[] = [];
	private readonly createdAt = os.clock();
	private ended = false;
	private dead = false;
	private lastTick = 0;
	private frames = 0;
	private lastCheck = 0;
	private status: RollbackStatusMsg | undefined;
	private lastCpu: ProbeSummary | undefined;
	private digestMs = 0;

	constructor(
		readonly ctx: RunContext,
		private readonly src: RollbackFrameSource,
		private readonly runConfig: Readonly<SimConfig>,
		readonly mode: ProbeMode,
		private readonly setup: RollbackSetupMsg,
		private readonly debugChecks: boolean,
	) {
		this.feed = new RollbackFeed(setup.partySize);
		if (mode === "serial") {
			const host = new SerialHost(
				() => this.frames,
				(m) => this.onWorker(m),
			);
			this.core = new RollbackWorkerCore(host);
			this.core.receive(setup);
			this.ready = true;
		} else {
			const spawned = spawnWorker(this.janitor);
			if (typeIs(spawned, "string")) {
				this.fail(spawned);
				return;
			}
			this.actor = spawned.actor;
			this.janitor.Add(spawned.reply.Event.Connect((raw: unknown) => this.onWorker(raw)));
			this.pending.push(setup);
		}
		print(
			`${TAG} session ${setup.sessionId}: ${mode} H${setup.horizon}, ${setup.worldKind} seed ${setup.seed}, ` +
				`party ${setup.partySize} (player ${setup.localIndex + 1}), live ${setup.live}, ` +
				`${setup.deviceClass} "${setup.deviceLabel}"`,
		);
		this.line("starting");
	}

	isDead(): boolean {
		return this.dead;
	}

	/** Once per rendered frame, before the sim steps. */
	frame(dt: number): void {
		if (this.dead || this.ended) return;
		this.frames++;
		if (!this.ready && os.clock() - this.createdAt > PROBE.readyTimeoutSec) {
			this.fail(
				`the worker did not start within ${PROBE.readyTimeoutSec} s (Actor / LocalScript; see the report)`,
			);
			return;
		}
		const state = this.ctx.run.state;
		const msg = this.feed.next(this.src, dt * MS, () => hashState(state));
		if (typeIs(msg, "string")) {
			this.fail(msg);
			return;
		}
		this.lastTick = msg.tick;
		const now = os.clock();
		const check = this.debugChecks && now - this.lastCheck >= PROBE.mainHashCheckSec;
		const before = check ? hashState(state) : "";
		this.send(msg, state);
		if (check) {
			this.lastCheck = now;
			const after = hashState(state);
			if (after !== before) {
				this.fail(`the main state's hash changed under the probe at tick ${state.tick}: ${before} -> ${after}`);
				return;
			}
		}
		const coop = this.ctx.coop;
		const over = coop !== undefined ? coop.isOver() : this.ctx.live?.outcome() !== "playing";
		if (over) this.end("run over");
	}

	/** The run ended or was left: the worker flushes its windows (`end`), the Actor goes after a grace period. */
	end(reason: string): void {
		if (this.ended || this.dead) return;
		this.ended = true;
		this.send({ kind: "control", op: "end", tick: this.lastTick }, this.ctx.run.state);
		print(`${TAG} session ${this.setup.sessionId} ended (${reason}) at tick ${this.lastTick}`);
	}

	/** Cleans up: the Actor now, or after endGraceSec when `grace` (its last posts). */
	destroy(grace: boolean): void {
		this.dead = true;
		if (!grace || this.actor === undefined) {
			this.janitor.Destroy();
			return;
		}
		const j = this.janitor;
		task.delay(PROBE.endGraceSec, () => j.Destroy());
	}

	private send(msg: RollbackMainToWorker, state: SimState): void {
		if (this.mode === "serial") {
			const core = this.core!;
			core.receive(msg);
			core.lend(state, this.runConfig);
			core.pump();
			return;
		}
		if (!this.ready) {
			this.pending.push(msg);
			return;
		}
		this.actor!.SendMessage(ROLLBACK_WORKER_TOPIC.toWorker, msg);
	}

	private fail(reason: string): void {
		if (this.dead) return;
		warn(`${TAG} probe stopped: ${reason}`);
		this.line(`stopped: ${reason}`);
		this.destroy(false);
	}

	private onWorker(raw: unknown): void {
		if (this.dead && !this.ended) return;
		const m = readWorkerToMain(raw);
		if (m === undefined) {
			if (typeIs(raw, "table") && (raw as { kind?: unknown }).kind === "facts") return;
			warn(`${TAG} a worker message its reader refused`);
			return;
		}
		if (m.kind === "ready") {
			this.ready = true;
			for (const p of this.pending) this.actor!.SendMessage(ROLLBACK_WORKER_TOPIC.toWorker, p);
			this.pending.clear();
			print(`${TAG} worker ready after ${string.format("%.2f", os.clock() - this.createdAt)} s`);
		} else if (m.kind === "cpu") {
			this.lastCpu = m.summary;
			print(`${TAG} ${describeProbeSummary(m.summary)}`);
			Events.rollbackProbe.fire("cpu", m.summary);
			this.line();
		} else if (m.kind === "live") {
			print(`${TAG} live ${describeLiveSummary(m.summary)}`);
			Events.rollbackProbe.fire("live", m.summary);
		} else if (m.kind === "mirrorHash") {
			const r = this.feed.checkMirrorHash(m.tick, m.hash);
			if (r.kind === "mismatch") {
				this.fail(`mirror hash mismatch at tick ${r.tick}: main ${r.main}, mirror ${r.mirror}`);
			} else if (r.kind === "unknown") {
				warn(`${TAG} a mirror hash for tick ${m.tick}, which the main thread did not ask for`);
			}
		} else if (m.kind === "status") {
			this.status = m;
			this.line();
		} else if (m.kind === "digest") {
			this.digestMs = (os.clock() - m.sentAt) * MS;
		} else if (m.kind === "error") {
			this.fail(`worker: ${m.message}`);
		}
	}

	/** The overlay's one line. */
	private line(note?: string): void {
		const s = this.status;
		const c = this.lastCpu;
		let text = `ROLLBACK ${this.mode} H${this.setup.horizon}`;
		if (note !== undefined) text += ` ${note}`;
		if (s !== undefined) {
			text +=
				` | tick ${s.tick} total ${string.format("%.2f", s.totalMs)} ms over ${s.framesPerPrediction} fr` +
				` | hash ok ${this.feed.matched}` +
				(this.setup.live ? ` | live fr ${s.liveFrames}` : "");
		}
		if (c !== undefined) {
			text += ` | 10s p95 total ${string.format("%.2f", c.total.p95)} clone ${string.format(
				"%.2f",
				c.clone.p95,
			)}`;
			text += ` ${string.format("%.0f", c.renderFps)} fps`;
		}
		if (this.mode === "parallel" && this.digestMs > 0) text += ` | send ${string.format("%.1f", this.digestMs)} ms`;
		clientStore.setRollbackSpikeLine(text);
	}
}

/**
 * The rollback probe's client glue (docs/ROLLBACK_SPIKE.md Design 5 / 7, tasks R3a / R3 / R4b), thin over the shared
 * worker core (shared/lockstep rollbackSpike/worker). Off by default: with Workspace `KV_RollbackSpike` 0 or absent
 * nothing is created (no Actor, no render step; only the two attribute watches). On (a number H 1..64):
 *
 *   parallel (KV_RollbackSpikeMode absent / "parallel")  every run start (co-op or solo; a solo run picked up mid-run
 *       replays its recorded frames into the mirror) spawns an Actor under PlayerScripts with a clone of the disabled
 *       worker LocalScript (client/rollbackWorker) and sends it the run's setup; then once per rendered frame, before the
 *       sim steps (RENDER_ORDER.rollbackProbeBeforeSim), the frames the worker has not seen (RollbackFeed over the
 *       LockstepClient's queued merged frames and sent inputs, or the LiveRun's recorded frames) with a hash request
 *       every ROLLBACK_SPIKE.mirrorHashTicks. The worker mirrors the run, runs the CPU probe (and in co-op the live
 *       model) desynchronized, and posts windows back: printed as `[Rollback]` lines, fired to the server
 *       (`Events.rollbackProbe("cpu" | "live", summary)`), shown on the spike HUD's line. A mirror hash that differs
 *       from the main state's stops the probe and prints both.
 *   serial ("serial")  the same core on the main thread, on the main state itself (lent, never stepped by it): the
 *       comparison, which costs frames. Never with other players. No mirror, no live model.
 *   facts ("facts")  R3a once: the Parallel Luau facts printed as `[RollbackFacts]` lines (facts.ts).
 * Under KV_Debug, once a second, the main state's hash is taken before and after the probe's frame work: a change
 * stops it. Device label: what the game knows plus Workspace `KV_RollbackDeviceTag` (the dev panel sets it).
 * Changing an attribute restarts the probe; a co-op run already under way is skipped (its early merged frames are
 * gone): set the attribute before the run starts.
 */
@Controller({})
export class RollbackSpikeController implements OnStart {
	private readonly janitor = new Janitor();
	private on = false;
	private horizon = 0;
	private mode: RollbackSpikeModeName = "parallel";
	private session: ProbeSession | undefined;
	/** The run counter last seen (a session per run). */
	private counter = -1;

	constructor(private readonly sim: SimController) {}

	onStart(): void {
		Workspace.GetAttributeChangedSignal(ROLLBACK_SPIKE_ATTRIBUTES.horizon).Connect(() => this.refresh());
		Workspace.GetAttributeChangedSignal(ROLLBACK_SPIKE_ATTRIBUTES.mode).Connect(() => this.refresh());
		this.refresh();
	}

	private refresh(): void {
		const horizon = readHorizon();
		const mode = readMode();
		if (this.on && (horizon !== this.horizon || mode !== this.mode)) this.stop();
		if (horizon <= 0 || this.on) return;
		this.on = true;
		this.horizon = horizon;
		this.mode = mode;
		this.counter = -1;
		print(`${TAG} probe on: H ${horizon}, ${mode}`);
		if (mode === "facts") {
			clientStore.setRollbackSpikeLine("ROLLBACK facts: running (see the [RollbackFacts] lines)");
			const thread = task.spawn(() => this.runFacts());
			this.janitor.Add(() => {
				if (coroutine.status(thread) !== "dead") task.cancel(thread);
			});
			return;
		}
		clientStore.setRollbackSpikeLine(`ROLLBACK ${mode} H${horizon}: waiting for a run`);
		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Input.Value + RENDER_ORDER.rollbackProbeBeforeSim,
			(dt) => this.frame(dt),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP));
	}

	private stop(): void {
		this.session?.end("probe off");
		this.session?.destroy(false);
		this.session = undefined;
		this.janitor.Cleanup();
		this.on = false;
		clientStore.setRollbackSpikeLine(undefined);
		print(`${TAG} probe off`);
	}

	private frame(dt: number): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			this.endSession("run left");
			this.counter = -1;
			return;
		}
		if (ctx.counter !== this.counter) {
			this.endSession("next run");
			this.counter = ctx.counter;
			this.session = this.beginSession(ctx);
		}
		const s = this.session;
		if (s === undefined) return;
		if (s.isDead()) {
			this.session = undefined;
			return;
		}
		s.frame(dt);
	}

	private endSession(reason: string): void {
		const s = this.session;
		if (s === undefined) return;
		s.end(reason);
		s.destroy(true);
		this.session = undefined;
	}

	private beginSession(ctx: RunContext): ProbeSession | undefined {
		const mode: ProbeMode = this.mode === "serial" ? "serial" : "parallel";
		const coop = ctx.coop;
		const live = ctx.live;
		let src: RollbackFrameSource;
		let config: Readonly<SimConfig>;
		if (coop !== undefined) {
			if (coop.state.tick > 0) {
				print(
					`${TAG} co-op run ${ctx.counter} already at tick ${coop.state.tick}: waiting for the next run start`,
				);
				clientStore.setRollbackSpikeLine(`ROLLBACK ${mode}: waiting for the next run start`);
				return undefined;
			}
			src = lockstepFrameSource(coop);
			config = coop.config;
		} else if (live !== undefined) {
			if (mode === "parallel" && live.releasedFrameCount() > 0) {
				print(`${TAG} run ${ctx.counter}: early frames released; waiting for the next run start`);
				return undefined;
			}
			src = soloFrameSource(live);
			config = live.setup.config;
		} else {
			return undefined;
		}
		const facts = deviceFacts();
		const tag = Workspace.GetAttribute(ROLLBACK_SPIKE_ATTRIBUTES.deviceTag);
		const isCoop = coop !== undefined;
		const dev = ctx.dev ? this.sim.getDevRunOptions() : undefined;
		const setup: RollbackSetupMsg = {
			kind: "setup",
			// HttpService:GenerateGUID(false): 36 characters of the server reader's set (letters, digits, '-').
			sessionId: HttpService.GenerateGUID(false),
			mode,
			horizon: this.horizon,
			worldKind: ctx.world,
			seed: ctx.seed,
			partySize: isCoop ? coop.players : 1,
			localIndex: ctx.localIndex,
			coop: isCoop,
			atBossDoor: ctx.atBossDoor,
			scoring: ctx.scoring,
			stress: ctx.stress,
			dev:
				dev !== undefined
					? { startFloor: dev.startFloor, invulnerable: dev.invulnerable, vault: dev.vault }
					: undefined,
			live: mode === "parallel" && isCoop,
			strategy: "repeatLast",
			borrowed: mode === "serial",
			deviceLabel: rollbackDeviceLabel(facts, typeIs(tag, "string") ? tag : undefined),
			deviceClass: rollbackDeviceClass(facts),
			native: false,
		};
		const debugOn = Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		return new ProbeSession(ctx, src, config, mode, setup, debugOn);
	}

	// ---- R3a: the facts -----------------------------------------------------------------------------

	/** R3a (see facts.ts): every step in order, each printed as a `[RollbackFacts]` line. */
	private runFacts(): void {
		const say = (key: string, value: string) => print(factsLine(key, value));
		const spawned = spawnWorker(this.janitor);
		if (typeIs(spawned, "string")) {
			say("worker", spawned);
			return;
		}
		const { actor, reply } = spawned;
		const answers = new Map<string, Record<string, unknown>>();
		let ready = false;
		this.janitor.Add(
			reply.Event.Connect((raw: unknown) => {
				if (!typeIs(raw, "table")) return;
				const t = raw as Record<string, unknown>;
				if (t.kind === "ready") ready = true;
				else if (t.kind === "facts" && typeIs(t.step, "string")) answers.set(t.step, t);
			}),
		);
		const waitFor = (step: string): Record<string, unknown> | undefined => {
			const t0 = os.clock();
			while (!answers.has(step) && os.clock() - t0 < FACTS.replyTimeoutSec) task.wait();
			return answers.get(step);
		};
		const t0 = os.clock();
		while (!ready && os.clock() - t0 < FACTS.replyTimeoutSec) task.wait();
		if (!ready) {
			say(
				"worker",
				`no ready within ${FACTS.replyTimeoutSec} s: the cloned LocalScript did not run in the Actor`,
			);
			return;
		}
		say(
			"worker",
			`ready ${string.format("%.2f", os.clock() - t0)} s after the Actor was parented (modules required)`,
		);

		// 1. The sim in the worker, desynchronized, against the main thread's same steps.
		const mainRun = buildFactsRun();
		const main = stepFactsRun(mainRun, FACTS.stepTicks, () => os.clock());
		actor.SendMessage(ROLLBACK_WORKER_TOPIC.facts, "sim");
		const sim = waitFor("sim");
		if (sim?.ok === true) {
			say(
				"sim stepped desynchronized in the Actor",
				`${FACTS.stepTicks} ticks of a ${FACTS.partySize}-player endless run in ` +
					`${string.format("%.1f", sim.ms as number)} ms (main thread ${string.format(
						"%.1f",
						main.ms,
					)} ms); ` +
					`hash ${sim.hash === main.hash ? "equal to" : "DIFFERENT from"} the main thread's`,
			);
		} else {
			say("sim stepped desynchronized in the Actor", `failed: ${tostring(sim?.error ?? "no answer")}`);
		}

		// 2. What SendMessage carries.
		const probe = factsTableProbe();
		actor.SendMessage(ROLLBACK_WORKER_TOPIC.facts, "table", probe);
		const tableSeen = waitFor("table")?.seen as TableArrival | undefined;
		if (tableSeen !== undefined) {
			say(
				"SendMessage(table)",
				`arrived ${tableSeen.arrived}, nested ${tableSeen.nested}, list ${tableSeen.list}, one table referenced ` +
					`twice stays one: ${tableSeen.aliasKept}, metatable kept: ${tableSeen.metaKept}; the worker's write: ` +
					tableAfter(probe),
			);
		} else say("SendMessage(table)", "no answer");
		const buf = factsBufferProbe();
		actor.SendMessage(ROLLBACK_WORKER_TOPIC.facts, "buffer", buf);
		const bufAnswer = waitFor("buffer");
		say(
			"SendMessage(buffer)",
			bufAnswer !== undefined
				? `${tostring(bufAnswer.seen)}; the worker's write: ${bufferAfter(buf)}; a buffer back through the ` +
						`BindableEvent arrives as ${typeOf(bufAnswer.back)}`
				: "no answer",
		);
		const shared = new SharedTable({ marker: FACTS.marker });
		actor.SendMessage(ROLLBACK_WORKER_TOPIC.facts, "shared", shared);
		const sharedAnswer = waitFor("shared");
		say(
			"SendMessage(SharedTable)",
			sharedAnswer !== undefined
				? `${tostring(sharedAnswer.seen)}; the worker's write: ${
						shared.marker === FACTS.mutated ? "shared (the worker's write shows here)" : "copied"
				  }`
				: "no answer",
		);
		// Can the main thread bind to a second Actor's messages (a reply path the worker could use while parallel)?
		const replyActor = new Instance("Actor");
		replyActor.Name = REPLY_ACTOR_NAME;
		this.janitor.Add(replyActor);
		replyActor.Parent = Players.LocalPlayer.WaitForChild("PlayerScripts");
		let fromWorker = false;
		const [bound, bindErr] = pcall(() =>
			replyActor.BindToMessage(ROLLBACK_WORKER_TOPIC.facts, () => {
				fromWorker = true;
			}),
		);
		if (bound) this.janitor.Add(bindErr as RBXScriptConnection);
		actor.SendMessage(ROLLBACK_WORKER_TOPIC.facts, "replyActor", replyActor);
		const sent = waitFor("replyActor");
		task.wait(1);
		say(
			"main thread BindToMessage on another Actor",
			`bind ${bound ? "ok" : `refused (${tostring(bindErr)})`}; the worker's SendMessage while desynchronized ` +
				`${
					sent?.ok === true ? "ok" : `failed (${tostring(sent?.error)})`
				}; arrived on the main thread: ${fromWorker}`,
		);

		// 3. MicroProfiler labels from the worker.
		say(
			"MicroProfiler",
			`for the next ${FACTS.profileSec} s the worker runs '${PROBE.profileLabels.facts}' each frame ` +
				`(${FACTS.taskMs[0]} ms): open the MicroProfiler (Ctrl+F6 / Settings), pause it and look for that label ` +
				`on a worker thread; record whether it shows`,
		);
		actor.SendMessage(ROLLBACK_WORKER_TOPIC.facts, "profile");
		waitFor("profile");

		// 4. The main thread's frame time with a parallel task, against a baseline and the same task on the main thread.
		const sample = (seconds: number, onFrame?: () => void): number[] => {
			const out: number[] = [];
			const conn = RunService.Heartbeat.Connect((dt) => {
				out.push(dt * MS);
				onFrame?.();
			});
			task.wait(seconds);
			conn.Disconnect();
			return out;
		};
		say("frame time, baseline", frameLine(sample(FACTS.phaseSec)));
		for (const ms of FACTS.taskMs) {
			actor.SendMessage(ROLLBACK_WORKER_TOPIC.facts, "busy", ms);
			say(`frame time, a ${ms} ms parallel task per frame`, frameLine(sample(FACTS.phaseSec)));
			waitFor("busy");
			answers.delete("busy");
		}
		for (const ms of FACTS.taskMs) {
			say(
				`frame time, the same ${ms} ms on the main thread`,
				frameLine(sample(FACTS.phaseSec, () => busyWait(ms, () => os.clock()))),
			);
		}
		say("done", "paste these lines into docs/ROLLBACK_SPIKE.md (R3a)");
		clientStore.setRollbackSpikeLine("ROLLBACK facts: done (see the output)");
	}
}
