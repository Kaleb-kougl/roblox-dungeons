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
 *                              input missed the deadline, -1 after `leadDecayTicks` clean ticks; depth is the pacing
 *                              buffer's, 0 without pacing), reports hashState every
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
import { DEFAULT_LOCKSTEP, type LockstepTunables } from "./config";
import { PlayoutPacer, type PacingStats } from "./pacer";
import { MergedDecoder, encodeInputBatch } from "./wire";

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

export class LockstepClient implements RunView {
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
	/** Deadline misses of this client's own input (diagnostics). */
	misses = 0;
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

	constructor(params: LockstepClientParams) {
		this.runId = params.runId;
		this.players = params.players;
		this.localIndex = params.localIndex;
		this.config = params.config;
		this.tunables = params.tunables ?? DEFAULT_LOCKSTEP;
		this.lead = this.tunables.inputDelay;
		const pacing = this.tunables.pacing;
		this.pacer = pacing !== undefined ? new PlayoutPacer(pacing) : undefined;
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
		return math.max(this.lead + this.depthTicks(), this.lastSentTick - this.state.tick);
	}

	/**
	 * The network part of the lead ("netLead", docs/FRAME_PACING.md Design 5): the internal lead that adapts to misses
	 * (+1 per miss, -1 after `leadDecayTicks` clean ticks), without the pacing buffer's depth. The KV_Debug line.
	 */
	netLead(): number {
		return this.lead;
	}

	/**
	 * The tick an input sampled now goes out for: state.tick (the next tick to step) + lead + the pacing buffer's depth
	 * (0 without pacing). pump samples and sends only when this is past the last tick sent, so inside pump's `sample()`
	 * it is exactly the tick that input is sent for (the KV_Debug latency probe, shared/view latencyProbe.ts), and those
	 * ticks strictly increase.
	 */
	nextInputTick(): number {
		return this.state.tick + this.lead + this.depthTicks();
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
	 * A merged batch (see the file comment). `now`: the local clock at arrival (the pacer's timestamp; ignored without
	 * pacing configured). Returns false when it broke the stream.
	 */
	receive(firstTick: number, data: unknown, now?: number): boolean {
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
		return true;
	}

	/**
	 * Steps queued merged frames (see the file comment). `sample()` is the local input now (read once per tick). `now`:
	 * the local clock (the same one `receive` is given); with pacing configured, passing it turns pacing on.
	 */
	pump(dt: number, sample: () => Readonly<InputFrame>, now?: number): PumpResult {
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
			// covered, nothing is sampled or sent. Past it by more than one (the lead just rose): the ticks between
			// repeat the last input on the server.
			const target = this.nextInputTick();
			if (target <= this.lastSentTick) continue;
			if (outgoing.size() > 0 && target !== outgoingFirst + outgoing.size()) flushInputs();
			if (outgoing.size() === 0) outgoingFirst = target;
			const f = copyInput(sample());
			outgoing.push(f);
			this.sent.set(target, f);
			this.lastSentTick = target;
		}
		flushInputs();
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

	/** Lead adaptation: was the input this client sent for `tick` the one the server finalized? */
	private checkDeadline(tick: number, finalized: Readonly<InputFrame>): void {
		const mine = this.sent.get(tick);
		if (mine === undefined) return;
		this.sent.delete(tick);
		if (inputsEqual(mine, finalized)) {
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
