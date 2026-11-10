/**
 * The client side of a co-op lockstep run (M4), pure: the SimController owns one per party run.
 *
 *   receive(firstTick, data, now?)  a merged batch from the server (wire.ts), queued in tick order. Batches arrive in
 *                              order (reliable ordered remotes); a gap or a malformed batch is fatal (`broken`). With
 *                              pacing configured, `now` (the local clock) timestamps the arrival for the pacer.
 *   pump(dt, sample, now?)     steps queued merged frames, at most `maxCatchup` per call (bounded catch-up), and ONLY
 *                              those: the sim never runs ahead of the server's log, never on local input. HOW MANY is
 *                              the pacing below; today's rule without it is "every queued frame, up to the cap". After
 *                              each stepped tick it samples the local input once and sends it for tick state.tick +
 *                              lead + depth (`nextInputTick`; lead starts at INPUT_DELAY_TICKS, +1 each time its own
 *                              input missed the deadline, -1 after `leadDecayTicks` clean ticks, or the measured lead
 *                              below; depth is the pacing buffer's, 0 without pacing), reports hashState every
 *                              `hashEvery` ticks (batched: one call per pump at most, throttled; resent until the
 *                              server's ack covers them, `acknowledge`), and once the whole party is down returns the
 *                              RunFinal claim and stops stepping. Sends follow the lead both ways: a step whose target
 *                              is at or below the last tick sent (the lead just fell by one) samples and sends NOTHING,
 *                              that tick is already covered, so the delay really falls; a target past the last sent
 *                              tick + 1 (the lead just rose) leaves the ticks between to the server's repeat-last.
 *                              No tick is ever sent twice.
 *   end(reason)                the server decided the run before the party went down (desync, expiry, an error):
 *                              over here too, nothing more is stepped or sent.
 *
 * Frame pacing (docs/FRAME_PACING.md, Design 1-6). With `tunables.pacing` defined the client owns a PlayoutPacer
 * (pacer.ts), and pacing turns on at the first `pump` given a `now`: from then on each pump steps exactly
 * `pacer.frame(now, dt, state.tick, backlog, maxCatchup)` frames (a steady one tick per SIM_DT from a small jitter
 * buffer; none on a hold; up to the cap after a client hitch or in a fast-forward), `getAlpha()` is the pacer's (in
 * [0, 1)), and the input lead covers the buffer: `nextInputTick()` = state.tick + lead + pacer.depthTicks() (Design 5;
 * the pacer's lead depth: whole ticks with half a tick of hysteresis, capped at maxDepthTicks, so lead + depth stays
 * inside the relay's maxInputAhead even while P is far past its target). When the depth rises the target jumps and the
 * skipped ticks fall to the server's repeat-last (never sent, so never counted as misses); when it falls the FP1 rule
 * above sends nothing until the target passes the last tick sent. Once nothing more will be stepped (final claim,
 * `end`, broken) arrivals are no longer handed to the pacer. Pacing is never half on:
 * once on it stays on for the run (`isPacing`). A later pump without `now` is a caller mistake, not an error: it runs
 * on the last clock + dt. A batch received without `now` is timestamped by the next paced pump's clock (late, so it
 * can only deepen the buffer). Pacing changes WHEN frames are stepped, never which: the sim still steps exactly the
 * merged log, and the inputs it sends are the only thing the client influences. Without pacing configured, or until a
 * pump passes `now`, everything behaves exactly as before.
 *
 * The measured lead (docs/FRAME_PACING.md Revision 2, Design 9-10). With `tunables.lead` defined the client owns a
 * LeadController (lead.ts) and the net lead (`netLead()`, so `nextInputTick()` and `inputLead()`) is its `lead()`:
 * every send is recorded (`sent(target, state.tick, the pacer's raw depth, unsteady frame)`), every batch is
 * `received`, the server's echo (`receive`'s trailing `echo`, wire.ts `decodeInputEcho`; a malformed one is ignored,
 * never fatal) is `echoed`, every deadline check goes to `deadline(matched, now)` and every pump calls `frame(now)`.
 * The clock is the pacer's: `receive`'s / `pump`'s `now`, and a pump without one runs on the last clock + dt. Until a
 * clock was ever given nothing is timed: no echo is fed, so the controller stays on its legacy rule (exactly
 * `checkDeadline`'s miss counter below) and the run behaves as before. A send is "unsteady" (its trip is left out of
 * the window, its late never bumps) when the pacer's frame was hitched, catching up or fast-forwarding, or, unpaced,
 * when dt or the clock since the last pump is over PACING.hitchFrameSec, or the pump (or the one before) started with
 * more frames queued than maxCatchup (catch-up after a hitch). Each send also records the depth the lead added
 * (`depthTicks()`), so a late caused by the buffer's lead cap is not bumped. The tap latch (FPD13): a step whose target was already sent still samples
 * (`sample(false)`), and that sample's buttons are OR-ed into the next frame actually sent (axes from the newer sample),
 * so a one-frame tap on a fall's skipped tick becomes a one-tick hold one tick later instead of nothing. `misses`
 * counts every input known to have missed: echoed lates while echoing, plus `inputsEqual` mismatches while not (no
 * double count: the echo that turns echoing on adds only its lates beyond the mismatches already counted);
 * `mismatches` counts every mismatch. Nothing here reaches the sim: only which tick an input is sent for
 * (and a latched button) changes. With `tunables.lead` undefined: the legacy miss counter only, exactly as before
 * (`sample` is called only when sending; an echo is ignored).
 *
 * Local prediction (docs/LOCAL_PREDICTION.md, predict.ts). With `tunables.prediction` defined the client owns a
 * LocalPredictor: after every stepped tick it compares the merged pose with its prediction (`observe`), and after every
 * pump that stepped (or while nothing is predicted) it rebuilds the prediction from the merged state, the queued frames
 * and the inputs it sent (`predicted()`: the local player's body up to `maxTicks` ticks ahead; `predictionStats()`).
 * Read only: it changes nothing that is stepped, sent, hashed or claimed. Undefined: nothing is predicted.
 *
 * Hitstop is never applied here: a co-op sim is paced by the server's frames alone (shared/view/fx freezeRules
 * `simPacerFor`); presentation may freeze sprites or the camera instead. The local player's character may be drawn
 * predicted (presentation only); nothing predicted ever reaches the sim.
 */
import {
	SIM_DT,
	copyInput,
	createSimState,
	hashState,
	inputsEqual,
	isFiniteNumber,
	isPartyWiped,
	stepParty,
	type InputFrame,
	type PlayerState,
	type SimConfig,
	type SimState,
	runStartHalfHearts,
} from "shared/sim";
import { RunTelemetry, readRunScore, summarizeRun, type RunFinal } from "shared/run";
import {
	accumulateEvents,
	collectRunEvents,
	newFrameEvents,
	resetFrameEvents,
	type FrameEvents,
	type RunEventRecord,
	type RunView,
	type ScorePop,
} from "shared/play";
import { BoostFrameEvents } from "shared/view/boosts";
import { PelletFrameEvents } from "shared/view/pellets";
import { TreasureFrameEvents } from "shared/view/treasure";
import { PactFrameEvents } from "shared/view/pacts";
import { GoldenFrameEvents } from "shared/view/golden";
import {
	BuildFxEvents,
	ComboEvents,
	NearMissEvents,
	RecapTally,
	RoomClearEvents,
	VariantCueEvents,
} from "shared/view/fx";
import { DEFAULT_LOCKSTEP, PACING, type LockstepTunables } from "./config";
import { LeadController, type LeadStats } from "./lead";
import { PlayoutPacer, type PacingStats } from "./pacer";
import { LocalPredictor, type PredictionSource, type PredictionStats } from "./predict";
import { MergedDecoder, decodeInputEcho, encodeInputBatch } from "./wire";

/** Not a clock: what the lead controller gets before any was given (its legacy rule needs none). */
const NO_CLOCK = 0 / 0;

/**
 * pump's input callback: the local input now, read once per stepped tick. `sending`: false when that tick's target
 * was already sent (the lead just fell; only with the measured lead, for the tap latch): the sample is not sent itself,
 * only its buttons are carried into the next frame sent.
 */
export type InputSampler = (sending: boolean) => Readonly<InputFrame>;

export interface LockstepClientParams {
	readonly runId: string;
	readonly seed: number;
	readonly spawn: { readonly x: number; readonly z: number };
	/** The party run's SimConfig (config.party.size = players). */
	readonly config: Readonly<SimConfig>;
	readonly players: number;
	/** This client's player index. */
	readonly localIndex: number;
	readonly tunables?: LockstepTunables;
}

export interface OutgoingInputs {
	readonly firstTick: number;
	readonly data: buffer;
}

export interface PumpResult {
	readonly stepped: number;
	/** Input batches to send (consecutive ticks each). */
	readonly inputs: ReadonlyArray<OutgoingInputs>;
	/**
	 * Hash reports to send now, in ONE `lockstepHash` call (empty: no call this pump): the new ones and any
	 * unacknowledged ones due for a resend, oldest first, at most `maxHashBatch`.
	 */
	readonly hashes: ReadonlyArray<{ readonly tick: number; readonly hash: string }>;
	/** The final claim, on the tick the party went down (send once). */
	readonly final?: RunFinal;
}

export class LockstepClient implements RunView, PredictionSource {
	readonly state: SimState;
	readonly runId: string;
	readonly players: number;
	readonly localIndex: number;
	/** Events of the ticks the last pump stepped (presentation). */
	readonly frameEvents: FrameEvents = newFrameEvents();
	/** Score pops of the ticks the last pump stepped (presentation). */
	readonly scorePops: ScorePop[] = [];
	/** The local player's M2 progression events of the ticks the last pump stepped (toasts). */
	readonly runEvents: RunEventRecord[] = [];
	/** Boost-drop events of the ticks the last pump stepped (drop renderer, audio; docs/BOOSTS.md B6). */
	readonly boostEvents = new BoostFrameEvents();
	/** Room clears of the ticks the last pump stepped (docs/ROOM_CLEAR.md RC1; reset every pump). */
	readonly roomClears = new RoomClearEvents();
	/** Combo events of the ticks the last pump stepped (docs/COMBO.md CB1; reset every pump). */
	readonly combo = new ComboEvents();
	/** Grazes and guard erases of the ticks the last pump stepped (docs/GRAZE_PARRY.md GP2; reset every pump). */
	readonly nearMiss = new NearMissEvents();
	/** Enemy-variant sound events of the ticks the last pump stepped (docs/ENEMY_VARIANTS.md; reset every pump). */
	readonly variantCues = new VariantCueEvents();
	/** Build effects of the ticks the last pump stepped (docs/BUILDS.md BU8; reset every pump). */
	readonly builds = new BuildFxEvents();
	/** The pellet events of the ticks run by the last frame (docs/PELLETS.md PL7; reset every frame). */
	readonly pellets = new PelletFrameEvents();
	/** Parries and grazes per player over the whole run (docs/RUN_RECAP.md RR1; collected every tick, never reset). */
	readonly recapTally = new RecapTally();
	/** The vault events of the ticks run by the last frame (docs/TREASURE.md TR7; reset every frame). */
	readonly treasure = new TreasureFrameEvents();
	/** The pact events of the ticks run by the last frame (docs/FORTUNE.md FO7; reset every frame). */
	readonly pacts = new PactFrameEvents();
	/** The Goldling events of the ticks the last pump stepped (docs/FORTUNE.md FO8; reset every pump). */
	readonly golden = new GoldenFrameEvents();
	/** Run totals for the HUD (kills, landed hits on the party). */
	kills = 0;
	hitsTaken = 0;
	/** The party run's SimConfig (the HUD's shrine hint reads the floor's rooms from it). */
	readonly config: Readonly<SimConfig>;
	private readonly tunables: LockstepTunables;
	private readonly decoder: MergedDecoder;
	private readonly telemetry: RunTelemetry;
	private readonly queue: InputFrame[][] = [];
	private queueHead = 0;
	private received = 0;
	private lead: number;
	private cleanTicks = 0;
	private lastSentTick = -1;
	private readonly sent = new Map<number, InputFrame>();
	private finalSent = false;
	private broken: string | undefined;
	private sinceStep = 0;
	/** Hash reports not acknowledged yet (tick order) and the ticks sent since the last resend. */
	private readonly unackedTicks: number[] = [];
	private readonly unackedHashes: string[] = [];
	private ackedThrough = 0;
	private sinceHashSend = math.huge;
	private sinceResend = 0;
	private freshHashes = false;
	private stopped = false;
	private endedReason: string | undefined;
	/**
	 * Inputs of this client's own known to have missed the deadline (diagnostics): with the measured lead, the echoed
	 * lates while echoing plus the `inputsEqual` mismatches while not; otherwise the mismatches.
	 */
	misses = 0;
	/** Deadline checks where the server finalized a frame other than the one this client sent (`inputsEqual`). */
	mismatches = 0;
	/** The measured net lead (docs/FRAME_PACING.md Revision 2), when `tunables.lead` is defined. */
	private readonly leadCtl: LeadController | undefined;
	/** The lead controller's clock: the last `now` given to receive / pump, a clockless pump adding its dt. */
	private leadClock: number | undefined;
	/** Buttons of samples not sent (a fall's skipped tick), OR-ed into the next frame sent (the tap latch). */
	private latched = 0;
	/**
	 * Mismatches counted as misses while not echoing that no echoed late has matched yet: the echo that turns echoing
	 * on reports lates of inputs whose mismatches may already be counted, so it adds only its lates beyond these.
	 */
	private unmatchedMisses = 0;
	/** The clock of the last pump given one (an unpaced pump's hitch test: a stall between pumps). */
	private lastPumpClock: number | undefined;
	/** The last pump started with more queued than one pump steps (unpaced catch-up). */
	private wasCatchingUp = false;
	/** The playout clock (docs/FRAME_PACING.md), when `tunables.pacing` is defined. */
	private readonly pacer: PlayoutPacer | undefined;
	/** A pump passed `now` with a pacer: pacing is on for the rest of the run. */
	private pacing = false;
	/** The clock of the last paced pump (a later pump without `now` continues from it). */
	private paceClock = 0;
	/** The newest tick of batches received without `now`, stamped by the next paced pump. */
	private unstampedNewest: number | undefined;
	/**
	 * Before pacing is on, the stamped arrival with the smallest offset (the best-case path), handed to the pacer when a
	 * pump turns pacing on: a caller that never paces keeps nothing growing.
	 */
	private earlyAt: number | undefined;
	private earlyNewest = 0;
	/** Local prediction (docs/LOCAL_PREDICTION.md), when `tunables.prediction` is defined. */
	private readonly predictor: LocalPredictor | undefined;
	/** The own input in the last merged frame stepped (the relay's repeat-last, for the predictor). */
	private lastLocal: InputFrame | undefined;

	constructor(params: LockstepClientParams) {
		this.runId = params.runId;
		this.players = params.players;
		this.localIndex = params.localIndex;
		this.config = params.config;
		this.tunables = params.tunables ?? DEFAULT_LOCKSTEP;
		this.lead = this.tunables.inputDelay;
		const pacing = this.tunables.pacing;
		this.pacer = pacing !== undefined ? new PlayoutPacer(pacing) : undefined;
		const t = this.tunables;
		this.leadCtl =
			t.lead !== undefined
				? new LeadController(t.lead, t.inputDelay, t.maxInputLead, t.leadDecayTicks)
				: undefined;
		this.predictor = t.prediction !== undefined ? new LocalPredictor(t.prediction) : undefined;
		this.decoder = new MergedDecoder(params.players);
		this.state = createSimState(params.seed, params.spawn.x, params.spawn.z, params.config);
		this.telemetry = new RunTelemetry(runStartHalfHearts(params.config));
	}

	/** Ticks received from the server so far. */
	receivedTicks(): number {
		return this.received;
	}

	/** Received ticks not stepped yet. */
	backlog(): number {
		return this.queue.size() - this.queueHead;
	}

	/**
	 * The effective input lead, in ticks: how far this client's inputs already reach past the next tick to step
	 * (the last tick sent - state.tick), or the lead the next send would use when that is more (before the first
	 * send; after a miss on the wiping tick, which sends nothing). A press sampled now is stepped inputLead() + 1 ticks
	 * later. Since a step whose target was already sent sends nothing (see pump), this equals the internal lead
	 * whenever a send happens.
	 */
	inputLead(): number {
		return math.max(this.netLead() + this.depthTicks(), this.lastSentTick - this.state.tick);
	}

	/**
	 * The network part of the lead ("netLead", docs/FRAME_PACING.md Design 5), without the pacing buffer's depth: the
	 * measured lead's (LeadController.lead()) with `tunables.lead`, else the internal lead that adapts to misses (+1 per
	 * miss, -1 after `leadDecayTicks` clean ticks). The KV_Debug line.
	 */
	netLead(): number {
		const ctl = this.leadCtl;
		return ctl !== undefined ? ctl.lead() : this.lead;
	}

	/** The measured lead's numbers (trips, target, lates, bumps, falls); undefined without `tunables.lead`. */
	leadStats(): LeadStats | undefined {
		return this.leadCtl?.stats();
	}

	/** The server's echoes are steering the lead (LeadController.echoing()); false without `tunables.lead`. */
	isLeadMeasured(): boolean {
		return this.leadCtl?.echoing() === true;
	}

	/**
	 * Buttons latched from samples not sent (a fall's skipped tick), going out with the next frame sent: inside pump's
	 * `sample(true)` the frame sent is that sample's buttons OR these (the KV_Debug latency probe). 0 without the measured
	 * lead.
	 */
	latchedButtons(): number {
		return this.latched;
	}

	/**
	 * The tick an input sampled now goes out for: state.tick (the next tick to step) + lead + the pacing buffer's depth
	 * (0 without pacing). pump samples and sends only when this is past the last tick sent, so inside pump's `sample()`
	 * it is exactly the tick that input is sent for (the KV_Debug latency probe, shared/view latencyProbe.ts), and those
	 * ticks strictly increase.
	 */
	nextInputTick(): number {
		return this.state.tick + this.netLead() + this.depthTicks();
	}

	/** Pacing is on (see the file comment): a pacer is configured and a pump passed `now`. Stays on for the run. */
	isPacing(): boolean {
		return this.pacing;
	}

	/** The pacer's numbers (depth, holds, jitter...) while pacing is on; undefined otherwise. */
	pacingStats(): PacingStats | undefined {
		return this.pacing && this.pacer !== undefined ? this.pacer.stats() : undefined;
	}

	/** The pacing buffer's lead depth (PlayoutPacer.depthTicks: whole ticks, hysteresis, capped) while pacing, else 0. */
	private depthTicks(): number {
		return this.pacing && this.pacer !== undefined ? this.pacer.depthTicks() : 0;
	}

	/**
	 * Local prediction (predict.ts PredictionSource), read-only: the queued merged frame `k` ticks after the next tick
	 * to step (tick state.tick + k, 0 <= k < backlog(); index order), or undefined. Read it, never keep or write it.
	 */
	queuedFrame(k: number): ReadonlyArray<Readonly<InputFrame>> | undefined {
		if (k < 0 || k >= this.backlog() || k % 1 !== 0) return undefined;
		return this.queue[this.queueHead + k];
	}

	/** Local prediction, read-only: the last tick an own input was sent for (-1 before any). */
	lastSentInputTick(): number {
		return this.lastSentTick;
	}

	/**
	 * Local prediction, read-only: the own input sent for `tick` while that tick is not stepped
	 * yet (undefined once stepped, or never sent: a tick the lead jumped over, which the server fills with the previous
	 * input). Never keep or write it.
	 */
	sentInput(tick: number): Readonly<InputFrame> | undefined {
		return this.sent.get(tick);
	}

	/** The own input in the last merged frame stepped (undefined before the first step). Read it, never keep or write it. */
	lastSteppedInput(): Readonly<InputFrame> | undefined {
		return this.lastLocal;
	}

	/**
	 * The local player's predicted body (docs/LOCAL_PREDICTION.md Design 2): up to `prediction.maxTicks` ticks past the
	 * merged state, rebuilt after every pump that stepped; prevX / prevZ are the pose a tick before the head (lerp with
	 * getAlpha()). Undefined without `tunables.prediction`, while the local player is dead or left, while a draft is
	 * open, and once the run is over here. Presentation only: read it, never keep or write it.
	 */
	predicted(): Readonly<PlayerState> | undefined {
		return this.predictor?.predicted();
	}

	/** The predictor's numbers (horizon, error, corrections); undefined without `tunables.prediction`. */
	predictionStats(): PredictionStats | undefined {
		return this.predictor?.stats();
	}

	/** Nothing more will be stepped: broken, ended by the server, or the final claim made. */
	private steppingDone(): boolean {
		return this.broken !== undefined || this.endedReason !== undefined || this.finalSent;
	}

	/** Why the stream broke (a gap or a malformed batch), if it did. */
	brokenReason(): string | undefined {
		return this.broken;
	}

	/** The party is down, or the server ended the run first (`end`): the run is over on this client. */
	isOver(): boolean {
		return this.endedReason !== undefined || isPartyWiped(this.state);
	}

	/**
	 * The server decided the run while the party was still up (desync, an error, expiry: its `runFinished`): the run
	 * is over here too (`isOver`), nothing more is stepped or sent. No effect once the party is down.
	 */
	end(reason: string): void {
		if (!this.isOver()) this.endedReason = reason;
		this.stop();
	}

	/** Why the server ended the run before the party went down (`end`); undefined otherwise. */
	endReason(): string | undefined {
		return this.endedReason;
	}

	/**
	 * Interpolation alpha for rendering prev -> current. Paced: the pacer's, in [0, 1) (1 once nothing more will be
	 * stepped: the views show the final state). Otherwise: time since the last step, in ticks, clamped to [0, 1].
	 */
	getAlpha(): number {
		if (this.pacing && this.pacer !== undefined) return this.steppingDone() ? 1 : this.pacer.alpha();
		const a = this.sinceStep / SIM_DT;
		return a < 0 ? 0 : a > 1 ? 1 : a;
	}

	/** The server's hash ack (every report at or below `tick` is decided): those reports are not resent. */
	acknowledge(tick: unknown): void {
		if (!typeIs(tick, "number") || tick <= this.ackedThrough) return;
		this.ackedThrough = tick;
		let drop = 0;
		while (drop < this.unackedTicks.size() && this.unackedTicks[drop] <= tick) drop++;
		for (let k = 0; k < drop; k++) {
			this.unackedTicks.remove(0);
			this.unackedHashes.remove(0);
		}
	}

	/** Hash reports still waiting for the server's ack. */
	unacknowledged(): number {
		return this.unackedTicks.size();
	}

	/** The run is decided (runFinished): nothing more is sent. */
	stop(): void {
		this.stopped = true;
		this.unackedTicks.clear();
		this.unackedHashes.clear();
	}

	/**
	 * A merged batch (see the file comment). `now`: the local clock at arrival (the pacer's timestamp and the measured
	 * lead's; ignored without either configured). `echo`: the server's input echo for this client (wire.ts
	 * `encodeInputEcho`; ignored without `tunables.lead`, when malformed, or before any clock was given). Returns false
	 * when it broke the stream.
	 */
	receive(firstTick: number, data: unknown, now?: number, echo?: unknown): boolean {
		if (this.broken !== undefined) return false;
		if (firstTick !== this.received) {
			this.broken = `merged batch for tick ${firstTick}, expected ${this.received}`;
			return false;
		}
		const ticks = this.decoder.decode(data);
		if (ticks === undefined) {
			this.broken = `malformed merged batch at tick ${firstTick}`;
			return false;
		}
		for (const t of ticks) this.queue.push(t);
		this.received += ticks.size();
		// Once nothing more will be stepped the pacer never runs another frame: nothing is handed to it (or kept).
		if (this.pacer !== undefined && ticks.size() > 0 && !this.steppingDone()) {
			const newest = firstTick + ticks.size() - 1;
			if (now === undefined || !isFiniteNumber(now)) this.unstampedNewest = newest;
			else if (this.pacing) this.pacer.arrived(now, newest);
			else if (this.earlyAt === undefined || now - newest * SIM_DT < this.earlyAt - this.earlyNewest * SIM_DT) {
				this.earlyAt = now;
				this.earlyNewest = newest;
			}
		}
		const ctl = this.leadCtl;
		if (ctl !== undefined && !this.steppingDone()) {
			if (now !== undefined && isFiniteNumber(now)) {
				const last = this.leadClock;
				this.leadClock = last === undefined ? now : math.max(last, now);
			}
			const clock = this.leadClock;
			if (clock !== undefined) {
				const e = echo !== undefined ? decodeInputEcho(echo, firstTick) : undefined;
				if (e !== undefined) {
					const was = ctl.echoing();
					ctl.echoed(e, clock);
					if (ctl.echoing()) {
						// While echoing the echo's lates are the misses (their mismatches are not counted again); the
						// echo that turns it on skips the lates already counted as mismatches.
						this.misses += was ? e.lates : math.max(0, e.lates - this.unmatchedMisses);
						this.unmatchedMisses = 0;
					} else {
						// Not echoing (a "none" echo): its lates match mismatches counted, or still to come.
						this.unmatchedMisses = math.max(0, this.unmatchedMisses - e.lates);
					}
				}
				ctl.received(clock);
			}
		}
		return true;
	}

	/**
	 * Steps queued merged frames (see the file comment). `sample(sending)` is the local input now (read once per tick
	 * that sends; with the measured lead also on a tick that does not, `sending` false). `now`: the local clock (the same
	 * one `receive` is given); with pacing configured, passing it turns pacing on.
	 */
	pump(dt: number, sample: InputSampler, now?: number): PumpResult {
		resetFrameEvents(this.frameEvents);
		this.scorePops.clear();
		this.runEvents.clear();
		this.boostEvents.reset();
		this.roomClears.reset();
		this.combo.reset();
		this.nearMiss.reset();
		this.variantCues.reset();
		this.builds.reset();
		this.pellets.reset();
		this.treasure.reset();
		this.pacts.reset();
		this.golden.reset();
		const inputs: OutgoingInputs[] = [];
		const hashes: Array<{ tick: number; hash: string }> = [];
		let final: RunFinal | undefined;
		let stepped = 0;
		this.sinceStep += dt;
		const outgoing: InputFrame[] = [];
		let outgoingFirst = 0;
		const flushInputs = () => {
			if (outgoing.size() === 0) return;
			inputs.push({ firstTick: outgoingFirst, data: encodeInputBatch(outgoing) });
			outgoing.clear();
		};
		const state = this.state;
		const budget = this.stepBudget(dt, now);
		const ctl = this.leadCtl;
		let depthRaw = 0;
		let depthUsed = 0;
		let unsteady = false;
		if (ctl !== undefined) {
			const hitchSec = (this.tunables.pacing ?? PACING).hitchFrameSec;
			const pumpClock = now !== undefined && isFiniteNumber(now) ? now : undefined;
			if (now !== undefined && isFiniteNumber(now)) {
				const last = this.leadClock;
				this.leadClock = last === undefined ? now : math.max(last, now);
			} else if (this.leadClock !== undefined) {
				this.leadClock += math.max(dt, 0);
			}
			if (this.leadClock !== undefined) ctl.frame(this.leadClock);
			const pacer = this.pacer;
			// Unpaced catch-up: more queued than one pump steps (the frames that piled up in a hitch), and the pump
			// right after one (its first steps are still behind).
			const catchingUp = this.backlog() > this.tunables.maxCatchup;
			if (this.pacing && pacer !== undefined) {
				depthRaw = pacer.rawDepthTicks();
				depthUsed = pacer.depthTicks();
				unsteady = pacer.unsteady();
			} else {
				// A long frame, a stall inside the render step before the pump (in the clock, not in dt), or catch-up.
				const elapsed =
					pumpClock !== undefined && this.lastPumpClock !== undefined ? pumpClock - this.lastPumpClock : dt;
				unsteady = dt > hitchSec || elapsed > hitchSec || catchingUp || this.wasCatchingUp;
			}
			this.wasCatchingUp = catchingUp;
			if (pumpClock !== undefined) this.lastPumpClock = pumpClock;
		}
		while (
			this.broken === undefined &&
			this.endedReason === undefined &&
			!this.finalSent &&
			stepped < budget &&
			this.queueHead < this.queue.size()
		) {
			const merged = this.queue[this.queueHead];
			this.queueHead++;
			const tick = state.tick;
			this.checkDeadline(tick, merged[this.localIndex]);
			stepParty(state, merged, this.config);
			this.lastLocal = merged[this.localIndex];
			this.predictor?.observe(state, this.localIndex);
			this.telemetry.observe(state);
			accumulateEvents(this.frameEvents, state.events);
			this.kills += state.events.enemiesKilled;
			this.hitsTaken += state.events.playerHits;
			const se = state.score?.events;
			if (se !== undefined) {
				for (let k = 0; k < se.popPoints.size(); k++) {
					this.scorePops.push({ x: se.popX[k], z: se.popZ[k], points: se.popPoints[k] });
				}
			}
			collectRunEvents(state, this.localIndex, this.runEvents);
			this.boostEvents.collect(state);
			this.roomClears.collect(state);
			this.combo.collect(state);
			this.nearMiss.collect(state);
			this.variantCues.collect(state);
			this.builds.collect(state);
			this.pellets.collect(state);
			this.recapTally.collect(state);
			this.treasure.collect(state);
			this.pacts.collect(state);
			this.golden.collect(state);
			stepped++;
			if (state.tick % this.tunables.hashEvery === 0 && !this.stopped) {
				this.unackedTicks.push(state.tick);
				this.unackedHashes.push(hashState(state));
				this.freshHashes = true;
			}
			if (isPartyWiped(state)) {
				final = this.finalClaim();
				this.finalSent = true;
				break;
			}
			// The local input for tick (next tick + lead). At or below the last tick sent (the lead just fell): already
			// covered, nothing is sent (legacy: nothing sampled; measured: the sample's buttons are latched into the next
			// frame sent). Past it by more than one (the lead just rose): the ticks between repeat the last input on the
			// server.
			const target = this.nextInputTick();
			if (target <= this.lastSentTick) {
				if (ctl !== undefined) this.latched = bit32.bor(this.latched, sample(false).buttons);
				continue;
			}
			if (outgoing.size() > 0 && target !== outgoingFirst + outgoing.size()) flushInputs();
			if (outgoing.size() === 0) outgoingFirst = target;
			const f = copyInput(sample(true));
			if (this.latched !== 0) {
				f.buttons = bit32.bor(f.buttons, this.latched);
				this.latched = 0;
			}
			outgoing.push(f);
			this.sent.set(target, f);
			this.lastSentTick = target;
			ctl?.sent(target, state.tick, depthRaw, unsteady, depthUsed);
		}
		flushInputs();
		const predictor = this.predictor;
		if (predictor !== undefined) {
			if (this.steppingDone() || this.isOver()) predictor.stop();
			else if (stepped > 0 || predictor.predicted() === undefined) predictor.rebuild(this);
		}
		this.collectHashes(dt, hashes);
		if (stepped > 0) this.sinceStep = 0;
		// Release stepped frames now and then (the queue is read from queueHead).
		if (this.queueHead > this.tunables.maxCatchup * 2 && this.queueHead * 2 > this.queue.size()) this.compact();
		return { stepped, inputs, hashes, final };
	}

	/**
	 * How many frames this pump may step: `maxCatchup` without pacing; paced, what the pacer says is due (it turns
	 * pacing on at the first pump given `now`, and keeps it on).
	 */
	private stepBudget(dt: number, now: number | undefined): number {
		const pacer = this.pacer;
		const cap = this.tunables.maxCatchup;
		const given = now !== undefined && isFiniteNumber(now) ? now : undefined;
		if (pacer === undefined || (given === undefined && !this.pacing)) return cap;
		// A missing (or broken) clock continues from the last one; the pacer itself never lets its clock go back.
		const clock = given ?? this.paceClock + (dt > 0 ? dt : 0);
		const done = this.steppingDone();
		if (!this.pacing && this.earlyAt !== undefined && !done) pacer.arrived(this.earlyAt, this.earlyNewest);
		this.earlyAt = undefined;
		this.pacing = true;
		this.paceClock = clock;
		if (this.unstampedNewest !== undefined && !done) pacer.arrived(clock, this.unstampedNewest);
		this.unstampedNewest = undefined;
		// Nothing more will be stepped: leave the playout clock alone (no hold is counted for the run's end).
		if (done) return 0;
		return pacer.frame(clock, dt, this.state.tick, this.backlog(), cap);
	}

	/**
	 * The hash reports to send this pump (see PumpResult.hashes): new reports as soon as the send throttle allows,
	 * every unacknowledged one again each `hashResendSeconds`. A dropped call (rate limit, a lost packet) is therefore
	 * recovered by the next resend, and catch-up never sends more than one call per `hashSendMinSeconds`.
	 */
	private collectHashes(dt: number, out: Array<{ tick: number; hash: string }>): void {
		const t = this.tunables;
		const step = math.max(dt, 0);
		this.sinceHashSend += step;
		this.sinceResend += step;
		if (this.stopped || this.unackedTicks.size() === 0) {
			this.sinceResend = 0;
			return;
		}
		if (this.sinceHashSend < t.hashSendMinSeconds) return;
		const resend = this.sinceResend >= t.hashResendSeconds;
		if (!this.freshHashes && !resend) return;
		const n = math.min(this.unackedTicks.size(), t.maxHashBatch);
		for (let k = 0; k < n; k++) out.push({ tick: this.unackedTicks[k], hash: this.unackedHashes[k] });
		this.freshHashes = false;
		this.sinceHashSend = 0;
		this.sinceResend = 0;
	}

	/**
	 * Lead adaptation: was the input this client sent for `tick` the one the server finalized? The measured lead's
	 * `deadline` (its legacy rule while not echoing is exactly the counter below), else the counter.
	 */
	private checkDeadline(tick: number, finalized: Readonly<InputFrame>): void {
		const mine = this.sent.get(tick);
		if (mine === undefined) return;
		this.sent.delete(tick);
		const matched = inputsEqual(mine, finalized);
		if (!matched) this.mismatches++;
		const ctl = this.leadCtl;
		if (ctl !== undefined) {
			// While echoing the echo's lates are the misses: a mismatch then is not counted again.
			if (!matched && !ctl.echoing()) {
				this.misses++;
				this.unmatchedMisses++;
			}
			ctl.deadline(matched, this.leadClock ?? NO_CLOCK);
			return;
		}
		if (matched) {
			this.cleanTicks++;
			if (this.cleanTicks >= this.tunables.leadDecayTicks && this.lead > this.tunables.inputDelay) {
				this.lead--;
				this.cleanTicks = 0;
			}
			return;
		}
		this.misses++;
		this.cleanTicks = 0;
		if (this.lead < this.tunables.maxInputLead) this.lead++;
	}

	private finalClaim(): RunFinal {
		const state = this.state;
		const summary = summarizeRun(state, this.telemetry.finish());
		const score = readRunScore(state);
		return {
			runId: this.runId,
			finalTick: state.tick,
			claimedHash: hashState(state),
			claimed: { ...summary, score: score.score, floor: score.floor },
		};
	}

	private compact(): void {
		const kept: InputFrame[][] = [];
		for (let k = this.queueHead; k < this.queue.size(); k++) kept.push(this.queue[k]);
		this.queue.clear();
		for (const t of kept) this.queue.push(t);
		this.queueHead = 0;
	}
}
