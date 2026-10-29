/**
 * One live run, Roblox-API-free: the client's fixed-step loop (port of the core of project-kaleb-vale
 * src/sim/SimDriver.tsx @ 42897e2). The SimController owns one and calls `frame(dt, input)` once per rendered frame
 * with the input it sampled ONCE for that frame; every tick of the frame records that same frame and steps the sim
 * with it, so `runReplay(recording, config)` reproduces the live state bit for bit (liveRun.spec.ts).
 *
 * Pause (web SimDriver): the PAUSE bit's press edge toggles; paused frames (and the edge frame itself) run no ticks
 * and record nothing; the first unpaused frame clears the accumulator. External pauses (the Roblox menu, the pause
 * overlay, the juice panel) use setPaused.
 *
 * Hitstop (web SimDriver + src/fx/hitstop.ts): an optional FramePacer (the client's HitstopClock) turns each unpaused
 * frame's real delta into the sim delta it feeds the loop. A fully frozen frame skips the loop like a paused one (no
 * step, nothing recorded, accumulator and alpha untouched); slow motion feeds less time. It only changes WHEN ticks
 * run, never what a tick does: every tick still records the frame's input, so the recording replays to the same hash
 * whether hitstop was on or off (liveRun.hitstop.spec.ts). Paused frames never reach the pacer (a pending freeze
 * waits out a pause).
 *
 * Segments (M3, ranked runs): when the setup carries the server's `runId`, the run also cuts its recording into
 * segments for shared/network `submitSegment` (shared/run segments.ts): `cutSegment()` at any tick boundary (the
 * endless floors call it on a floor change, or set `segmentCutAfterTick`), and a time fallback every
 * `segmentFallbackTicks` so a run without floor changes segments too. `takeSegments()` drains the cut segments for
 * sending; `final()` cuts the rest and returns the `finishRun` claim.
 *
 * Leave run (L6a): `requestForfeit()` makes the next frame() step exactly one tick with the frame's input plus
 * FORFEIT_BUTTON, paused or not (the menu that offers "Leave run" pauses the run) and whatever the pacer says; the sim
 * kills the player at that tick (shared/sim forfeitSoloRun), so outcome() becomes "dead" and the run ends through the
 * ordinary death path (summary died = true, segments / final as for any death). The bit is in the recording, so the
 * server's replay reproduces the death without trusting the client.
 *
 * Restart = a new LiveRun from the same setup (fresh state, fresh recording).
 */
import {
	ALL_EVENT_FIELDS,
	Button,
	EMPTY_INPUT,
	FORFEIT_BUTTON,
	FixedStepLoop,
	Recorder,
	SOLO_PLAYER,
	copyInput,
	createSimState,
	dropsEvents,
	encodeRecording,
	eventDefault,
	hashState,
	runReplay,
	step,
	type InputFrame,
	type SimConfig,
	type SimEvents,
	type SimState,
	runStartHalfHearts,
} from "shared/sim";
import {
	RunTelemetry,
	SEGMENT_CHECKPOINT_TICKS,
	SEGMENT_FALLBACK_TICKS,
	readRunScore,
	type RunFinal,
	type RunSegment,
	type RunSubmission,
	type RunSummary,
} from "shared/run";
import { BoostFrameEvents, type BoostEventSource } from "shared/view/boosts";
import {
	RoomClearEvents,
	newFrameAdvance,
	type FrameAdvance,
	type FramePacer,
	type RoomClearSource,
} from "shared/view/fx";

export interface LiveRunSetup {
	readonly seed: number;
	readonly spawnX: number;
	readonly spawnZ: number;
	/** The run's SimConfig (buildRunConfig): read at creation, passed to every step. Never changed mid-run. */
	readonly config: Readonly<SimConfig>;
	/** Started at the boss door (debug): submitted as such. */
	readonly atBossDoor: boolean;
	/** The server's run session (startRun): turns segment cutting on. Absent: an unranked run (submitRun only). */
	readonly runId?: string;
	/**
	 * Called after every tick of a segmented run: true cuts a segment at that tick (e.g. the endless floors'
	 * floor-change event: `(s) => s.events.floorChanged !== 0`). Optional; `cutSegment()` works too.
	 */
	readonly segmentCutAfterTick?: (state: Readonly<SimState>) => boolean;
	/** Cut at least every this many ticks (default SEGMENT_FALLBACK_TICKS; must stay under MAX_SEGMENT_TICKS). */
	readonly segmentFallbackTicks?: number;
}

export type RunOutcome = "playing" | "dead" | "victory";

/**
 * M2 in-run progression events (endless runs) a frame's ticks produced, for toasts / audio, and the boost pickups
 * (docs/BOOSTS.md B7). Presentation only.
 */
export type RunEventKind = "boon" | "relic" | "curse" | "secondWind" | "fang" | "boost";

export interface RunEventRecord {
	readonly kind: RunEventKind;
	/** The boon / relic / curse index; 1 for secondWind; half hearts healed for fang; the Boost index for boost. */
	readonly index: number;
}

/**
 * Appends player `playerIndex`'s progression events of the tick just stepped to `out` (a solo run: player 0; co-op:
 * the local player's, so the toasts are about what THIS player took), then that player's boost pickups (runs with
 * drops, shared/sim dropsEvents). No-op outside endless runs without drops.
 */
export function collectRunEvents(state: Readonly<SimState>, playerIndex: number, out: RunEventRecord[]): void {
	const re = state.run?.players[playerIndex]?.events;
	if (re !== undefined) {
		if (re.draftChosen !== 0) out.push({ kind: "boon", index: re.draftChosen - 1 });
		if (re.relicCollected !== 0) out.push({ kind: "relic", index: re.relicCollected - 1 });
		if (re.curseAccepted !== 0) out.push({ kind: "curse", index: re.curseAccepted - 1 });
		if (re.secondWind !== 0) out.push({ kind: "secondWind", index: re.secondWind });
		if (re.fangHealed !== 0) out.push({ kind: "fang", index: re.fangHealed });
	}
	const de = dropsEvents(state);
	if (de === undefined) return;
	for (const c of de.collected) if (c.player === playerIndex) out.push({ kind: "boost", index: c.kind });
}

/**
 * What the views read of the run being played (LiveRun for a solo run, shared/lockstep LockstepClient for a co-op
 * one): the state, the last frame's events and score pops, the interpolation alpha. Read-only for views.
 */
export interface RunView {
	readonly state: SimState;
	readonly frameEvents: FrameEvents;
	readonly scorePops: ReadonlyArray<ScorePop>;
	/** The local player's M2 progression events of the last frame (toasts). */
	readonly runEvents: ReadonlyArray<RunEventRecord>;
	/** The boost-drop events of the last frame's ticks, every player's (docs/BOOSTS.md B6 / B7). */
	readonly boostEvents: BoostEventSource;
	/** The room clears of the last frame's ticks (docs/ROOM_CLEAR.md RC1). */
	readonly roomClears: RoomClearSource;
	getAlpha(): number;
}

/** A kill's score pop (scored runs): where the actor died and the points that kill scored. */
export interface ScorePop {
	readonly x: number;
	readonly z: number;
	readonly points: number;
}

/**
 * Per-frame event totals: counts summed over the frame's ticks; lastHitSource, bossPhase and the endless "new value"
 * events (floorChanged, depthChanged, roomEntered) keep the last set value.
 */
export type FrameEvents = { [K in keyof SimEvents]: number };

/** Events whose value is a number to keep (last set wins), not a count. lastHitSource is handled apart (-1 default). */
const LAST_VALUE_EVENTS: ReadonlyArray<keyof SimEvents> = ["bossPhase", "floorChanged", "depthChanged", "roomEntered"];

export interface ReplayCheck {
	readonly match: boolean;
	readonly liveHash: string;
	readonly replayHash: string;
	readonly ticks: number;
}

/** takeSegments() with nothing cut (every frame of most runs): no allocation. */
const NO_SEGMENTS: ReadonlyArray<RunSegment> = table.freeze([]);

/** Fresh per-frame event totals (every field at its default). */
export function newFrameEvents(): FrameEvents {
	const e = {} as FrameEvents;
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
	return e;
}

/** Adds one tick's events into the frame totals. */
export function accumulateEvents(into: FrameEvents, e: Readonly<SimEvents>): void {
	for (const f of ALL_EVENT_FIELDS) {
		const v = e[f];
		if (f === "lastHitSource") {
			if (v !== -1) into[f] = v;
		} else if (LAST_VALUE_EVENTS.includes(f)) {
			if (v !== 0) into[f] = v;
		} else {
			into[f] += v;
		}
	}
}

export function resetFrameEvents(e: FrameEvents): void {
	for (const f of ALL_EVENT_FIELDS) e[f] = eventDefault(f);
}

/**
 * Cuts a run's recording into segments (shared/run segments.ts): keeps the start tick of the open segment and the
 * checkpoint hashes inside it. `observe` after every tick, `cut` at a tick boundary. Pure; LiveRun owns one.
 */
export class SegmentCutter {
	private startTick = 0;
	private index = 0;
	private checkpoints: string[] = [];
	private lastCheckpointTick = -1;

	constructor(readonly runId: string, private readonly checkpointEvery: number = SEGMENT_CHECKPOINT_TICKS) {}

	/** After every tick: records the checkpoint hash when the tick is a multiple of checkpointEvery. */
	observe(state: Readonly<SimState>): void {
		const every = this.checkpointEvery;
		if (every > 0 && state.tick % every === 0 && state.tick > this.startTick) {
			this.checkpoints.push(hashState(state));
			this.lastCheckpointTick = state.tick;
		}
	}

	/** The open segment's start tick (every earlier tick is in a segment already cut). */
	openStartTick(): number {
		return this.startTick;
	}

	/** Ticks in the open segment at `tick`. */
	openTicks(tick: number): number {
		return tick - this.startTick;
	}

	/** Segments cut so far. */
	cutCount(): number {
		return this.index;
	}

	/**
	 * The open segment, ending after `state.tick`, built from `frames` (index = tick - firstFrameTick: the Recorder's
	 * frames, of which the first `firstFrameTick` may have been released), or undefined when it is empty. Starts the
	 * next segment.
	 */
	cut(
		state: Readonly<SimState>,
		frames: ReadonlyArray<InputFrame>,
		seed: number,
		spawn: { x: number; z: number },
		firstFrameTick = 0,
	): RunSegment | undefined {
		const endTick = state.tick;
		if (endTick <= this.startTick) return undefined;
		const slice: InputFrame[] = [];
		const last = endTick - 1;
		for (let t = this.startTick; t <= last; t++) slice.push(frames[t - firstFrameTick]);
		const checkpoints = this.checkpoints;
		// A checkpoint ON the end tick is not sent: claimedEndHash covers it.
		if (this.lastCheckpointTick === endTick && checkpoints.size() > 0) checkpoints.pop();
		const segment: RunSegment = {
			runId: this.runId,
			index: this.index,
			startTick: this.startTick,
			recording: encodeRecording({ seed, spawn: { x: spawn.x, z: spawn.z }, frames: slice }),
			claimedEndHash: hashState(state),
			checkpointHashes: checkpoints,
		};
		this.index++;
		this.startTick = endTick;
		this.checkpoints = [];
		this.lastCheckpointTick = -1;
		return segment;
	}
}

export class LiveRun implements RunView {
	readonly setup: LiveRunSetup;
	readonly state: SimState;
	readonly loop = new FixedStepLoop();
	readonly recorder: Recorder;
	/** Events of the ticks run by the last frame() (render / audio read them; reset every frame). */
	readonly frameEvents: FrameEvents = newFrameEvents();
	/** Ticks run by the last frame(). */
	ticksThisFrame = 0;
	/** Scored runs (SimConfig.scoring): the kills' score pops of the ticks run by the last frame() (reset every frame). */
	readonly scorePops: ScorePop[] = [];
	/** Endless runs: the progression events (boon taken, relic, curse, Second Wind, Fang heal) of the last frame(). */
	readonly runEvents: RunEventRecord[] = [];
	/** Runs with drops: the boost-drop events of the ticks run by the last frame() (docs/BOOSTS.md B6 / B7). */
	readonly boostEvents = new BoostFrameEvents();
	/** The room clears of the ticks run by the last frame() (docs/ROOM_CLEAR.md RC1; reset every frame). */
	readonly roomClears = new RoomClearEvents();
	/** What the pacer made of the last unpaused frame (frozen, time scale); a plain pass-through without a pacer. */
	readonly lastAdvance: FrameAdvance = newFrameAdvance();
	/** Run totals for the HUD's post-run panel (the telemetry's kill / hit counts, read without finishing it). */
	kills = 0;
	hitsTaken = 0;

	private readonly telemetry: RunTelemetry;
	private paused = false;
	private wasPaused = false;
	private prevButtons = 0;
	private alpha = 0;
	private deathTick: number | undefined;
	private victoryTick: number | undefined;
	private readonly cutter: SegmentCutter | undefined;
	private readonly fallbackTicks: number;
	private readonly cutSegments: RunSegment[] = [];
	/** Ticks whose recorded frames were released (releaseVerifiedFrames): recorder.frames[0] is this tick's. */
	private releasedTicks = 0;
	/** requestForfeit() was called: the next frame() steps the forfeit tick. */
	private forfeitPending = false;
	/** Scratch for the forfeit tick's frame (the caller's input is never written). */
	private readonly forfeitFrame: InputFrame = { ...EMPTY_INPUT };

	/** Throws whatever createSimState throws (e.g. an encounter naming an unregistered archetype). */
	constructor(setup: LiveRunSetup) {
		this.setup = setup;
		this.state = createSimState(setup.seed, setup.spawnX, setup.spawnZ, setup.config);
		this.recorder = new Recorder(setup.seed, setup.spawnX, setup.spawnZ);
		this.telemetry = new RunTelemetry(runStartHalfHearts(setup.config));
		this.cutter = setup.runId !== undefined ? new SegmentCutter(setup.runId) : undefined;
		this.fallbackTicks = setup.segmentFallbackTicks ?? SEGMENT_FALLBACK_TICKS;
	}

	/**
	 * One rendered frame: `input` was sampled once for this frame. Handles the pause edge, then (through `pacer`, if
	 * any: hitstop / slow motion) runs 0..5 ticks of SIM_DT (FixedStepLoop), recording `input` for each. Returns the
	 * number of ticks run.
	 */
	frame(deltaSeconds: number, input: Readonly<InputFrame>, pacer?: FramePacer): number {
		const pauseEdge =
			bit32.band(input.buttons, Button.PAUSE) !== 0 && bit32.band(this.prevButtons, Button.PAUSE) === 0;
		this.prevButtons = input.buttons;
		if (pauseEdge) this.paused = !this.paused;

		resetFrameEvents(this.frameEvents);
		this.scorePops.clear();
		this.runEvents.clear();
		this.boostEvents.reset();
		this.roomClears.reset();
		this.ticksThisFrame = 0;
		if (this.forfeitPending) {
			this.forfeitPending = false;
			this.stepForfeit(input);
			return this.ticksThisFrame;
		}
		if (this.paused || pauseEdge) {
			this.wasPaused = true;
			return 0;
		}
		if (this.wasPaused) {
			this.loop.clearAccumulator();
			this.wasPaused = false;
		}
		let simDelta = deltaSeconds;
		const adv = this.lastAdvance;
		if (pacer !== undefined) {
			pacer.frame(deltaSeconds, adv);
			if (adv.frozen) return 0; // a true still: no step, nothing recorded, accumulator and alpha untouched
			simDelta = adv.simDelta;
		} else {
			adv.simDelta = deltaSeconds;
			adv.frozen = false;
			adv.timeScale = 1;
			adv.frozenMs = 0;
		}
		const state = this.state;
		const config = this.setup.config;
		this.alpha = this.loop.advance(simDelta, () => {
			this.recorder.record(input);
			step(state, input, config);
			this.observeTick();
		});
		return this.ticksThisFrame;
	}

	/**
	 * "Leave run" (L6a): the next frame() steps one tick with its input plus FORFEIT_BUTTON (see the file comment), in
	 * which the player dies. Returns false (and does nothing) once the run is over (dead, or an M1 victory): a forfeit
	 * can only end a run that is still being played. Calling it again before that frame changes nothing.
	 */
	requestForfeit(): boolean {
		if (this.outcome() !== "playing" || this.state.player.dead !== 0) return false;
		this.forfeitPending = true;
		return true;
	}

	/** requestForfeit() was accepted and the forfeit tick has not been stepped yet. */
	isForfeitPending(): boolean {
		return this.forfeitPending;
	}

	/** The forfeit tick: `input` with FORFEIT_BUTTON, recorded and stepped like any tick (outside the loop's timing). */
	private stepForfeit(input: Readonly<InputFrame>): void {
		const f = copyInput(input, this.forfeitFrame);
		f.buttons = bit32.bor(f.buttons, FORFEIT_BUTTON);
		this.recorder.record(f);
		step(this.state, f, this.setup.config);
		this.observeTick();
	}

	private observeTick(): void {
		const state = this.state;
		const e = state.events;
		this.telemetry.observe(state);
		accumulateEvents(this.frameEvents, e);
		this.kills += e.enemiesKilled;
		this.hitsTaken += e.playerHits;
		this.ticksThisFrame++;
		const score = state.score;
		if (score !== undefined) {
			const se = score.events;
			for (let i = 0; i < se.popPoints.size(); i++) {
				this.scorePops.push({ x: se.popX[i], z: se.popZ[i], points: se.popPoints[i] });
			}
		}
		collectRunEvents(state, SOLO_PLAYER, this.runEvents);
		this.boostEvents.collect(state);
		this.roomClears.collect(state);
		if (this.victoryTick === undefined && e.bossDefeated !== 0) this.victoryTick = state.tick;
		if (this.deathTick === undefined && (e.playerDied !== 0 || state.player.dead !== 0)) {
			this.deathTick = state.tick;
		}
		const cutter = this.cutter;
		if (cutter !== undefined) {
			cutter.observe(state);
			const hook = this.setup.segmentCutAfterTick;
			if ((hook !== undefined && hook(state)) || cutter.openTicks(state.tick) >= this.fallbackTicks) {
				this.cutSegment();
			}
		}
	}

	// --- segments (ranked runs) ----------------------------------------------------------------

	/** The server's runId (segments on), or undefined for an unranked run. */
	runId(): string | undefined {
		return this.setup.runId;
	}

	/**
	 * Cuts the open segment at the current tick (between ticks, or from `segmentCutAfterTick`) and queues it for
	 * `takeSegments()`. Returns it, or undefined when segments are off or no tick ran since the last cut.
	 */
	cutSegment(): RunSegment | undefined {
		const cutter = this.cutter;
		if (cutter === undefined) return undefined;
		const s = this.setup;
		const segment = cutter.cut(
			this.state,
			this.recorder.frames,
			s.seed,
			{ x: s.spawnX, z: s.spawnZ },
			this.releasedTicks,
		);
		if (segment !== undefined) this.cutSegments.push(segment);
		return segment;
	}

	/** The segments cut since the last call, oldest first (the SimController uploads them). */
	takeSegments(): ReadonlyArray<RunSegment> {
		if (this.cutSegments.size() === 0) return NO_SEGMENTS;
		const out = [...this.cutSegments];
		this.cutSegments.clear();
		return out;
	}

	/**
	 * Ranked runs: releases the recorded frames of the ticks before `throughTick` once the server has verified them
	 * (a `segmentVerdict` with ok), so a long endless run's recording does not grow without bound. Only frames of
	 * segments already cut are released. Afterwards the whole recording is gone: submission() and replayCheck()
	 * throw, so call this only where neither can apply (SimController: ranked runs, which never fall back to
	 * submitRun, outside debug, where F8 needs the full recording). No-op for an unranked run. Returns the frames
	 * released.
	 */
	releaseVerifiedFrames(throughTick: number): number {
		const cutter = this.cutter;
		if (cutter === undefined) return 0;
		const limit = math.min(throughTick, cutter.openStartTick());
		const drop = limit - this.releasedTicks;
		if (drop <= 0) return 0;
		const old = this.recorder.frames;
		const kept: InputFrame[] = [];
		for (let i = drop; i < old.size(); i++) kept.push(old[i]);
		this.recorder.frames = kept;
		this.releasedTicks = limit;
		return drop;
	}

	/** Ticks whose frames releaseVerifiedFrames released (0: the recording is whole). */
	releasedFrameCount(): number {
		return this.releasedTicks;
	}

	/** Segments cut so far. */
	segmentCount(): number {
		return this.cutter?.cutCount() ?? 0;
	}

	/**
	 * The `finishRun` claim: cuts the open segment (take it with takeSegments and send it first), then returns the
	 * final tick, hash and summary with the score (shared/run readRunScore). Undefined when segments are off.
	 */
	final(): RunFinal | undefined {
		const runId = this.setup.runId;
		if (runId === undefined) return undefined;
		this.cutSegment();
		const score = readRunScore(this.state);
		return {
			runId,
			finalTick: this.state.tick,
			claimedHash: hashState(this.state),
			claimed: { ...this.summary(), score: score.score, floor: score.floor },
		};
	}

	/** Interpolation alpha from the last frame that ran the loop, in [0, 1). */
	getAlpha(): number {
		return this.alpha;
	}

	isPaused(): boolean {
		return this.paused;
	}

	/** External pause / resume (e.g. while the Roblox menu is open). Resuming clears the carried time. */
	setPaused(paused: boolean): void {
		if (this.paused === paused) return;
		this.paused = paused;
		if (paused) this.wasPaused = true;
	}

	/**
	 * Victory when the boss died before (or on the tick of) the player's death; the telemetry's end-reason rule.
	 * Endless runs (config.endless) have no victory: a boss kill opens the stairwell, only death ends the run.
	 */
	outcome(): RunOutcome {
		const v = this.setup.config.endless !== undefined ? undefined : this.victoryTick;
		const d = this.deathTick;
		if (v !== undefined && (d === undefined || v <= d)) return "victory";
		if (d !== undefined) return "dead";
		return "playing";
	}

	/** The tick the run ended on (the boss kill or the death, per outcome()), or undefined while playing. */
	endTick(): number | undefined {
		const o = this.outcome();
		return o === "victory" ? this.victoryTick : o === "dead" ? this.deathTick : undefined;
	}

	/** Recorded ticks (= state.tick: every tick is recorded), released frames included. */
	ticks(): number {
		return this.recorder.size() + this.releasedTicks;
	}

	private requireWholeRecording(what: string): void {
		if (this.releasedTicks > 0)
			error(`${what}: the recording's first ${this.releasedTicks} ticks were released`, 0);
	}

	/** The summary the server recomputes from its replay (validateRun's `summarize`). */
	summary(): RunSummary {
		const t = this.telemetry.finish();
		return {
			ticks: this.state.tick,
			kills: t.kills,
			bossDefeated: t.bossDefeated,
			died: t.deathTick !== undefined || this.state.player.dead !== 0,
		};
	}

	/**
	 * The submission for shared/network `submitRun`: seed, spawn flag, the whole recording (binary, shared/sim
	 * recordingCodec.ts), hash and summary now. Throws what encodeRecording throws (never for a live run).
	 */
	submission(): RunSubmission {
		this.requireWholeRecording("submission");
		return {
			seed: this.setup.seed,
			atBossDoor: this.setup.atBossDoor,
			recording: encodeRecording(this.recorder.getRecording()),
			claimedHash: hashState(this.state),
			claimed: this.summary(),
		};
	}

	/** F8 (web checkReplay): re-simulates the recording from scratch and compares state hashes. */
	replayCheck(): ReplayCheck {
		this.requireWholeRecording("replayCheck");
		const recording = this.recorder.getRecording();
		const replayed = runReplay(recording, this.setup.config);
		const liveHash = hashState(this.state);
		const replayHash = hashState(replayed);
		return { match: liveHash === replayHash, liveHash, replayHash, ticks: recording.frames.size() };
	}
}
