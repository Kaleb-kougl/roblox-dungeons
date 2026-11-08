/**
 * Lockstep tunables (M4 co-op). Data only: relay.ts / session.ts / client.ts read these; nothing is inlined in logic.
 * docs/SERVER.md "Co-op lockstep (M4)" has the protocol.
 */
import { SIM_HZ } from "shared/sim";
import { SEGMENT_CHECKPOINT_TICKS, SEGMENT_FALLBACK_TICKS } from "shared/run";

/** A client sends its input for tick T + INPUT_DELAY_TICKS when it steps tick T (its starting lead). */
export const INPUT_DELAY_TICKS = 3;
/** The client raises its lead (one tick per miss) up to this when its inputs keep missing the server's deadline. */
export const MAX_INPUT_LEAD_TICKS = 30;
/** After this many ticks without a miss the client lowers its lead by one (never below INPUT_DELAY_TICKS). */
export const INPUT_LEAD_DECAY_TICKS = SIM_HZ * 10;
/** The relay refuses inputs for ticks further than this past the last finalized one (a flood / a broken clock). */
export const MAX_INPUT_AHEAD_TICKS = SIM_HZ * 2;
/** Most frames one input batch may carry. */
export const MAX_INPUT_BATCH_FRAMES = SIM_HZ;

/** Clients report hashState after every tick that is a multiple of this (the server compares them). */
export const HASH_REPORT_EVERY_TICKS = SIM_HZ;
/**
 * A player who has not reported tick T's hash once the server is this many ticks past T is stalled: they are dropped
 * from the run (marked left, like a player who quit), so one frozen client cannot hold the validation back.
 */
export const HASH_REPORT_TIMEOUT_TICKS = SIM_HZ * 20;
/** The server broadcasts finalized frames in batches of this many ticks (2 = 30 remote calls / s per client). */
export const BROADCAST_EVERY_TICKS = 2;
/** At most this many ticks finalized per server step (a hitch never bursts more; the server clock lags instead). */
export const MAX_SERVER_TICKS_PER_STEP = 5;
/** Most merged frames a client steps in one rendered frame (bounded catch-up). */
export const MAX_CATCHUP_TICKS_PER_FRAME = 8;
/**
 * The server feeds its merged log into the SegmentedValidator in segments of this many ticks (and the rest at the
 * run's end). A multiple of HASH_REPORT_EVERY_TICKS and SEGMENT_CHECKPOINT_TICKS.
 */
export const PARTY_SEGMENT_TICKS = SEGMENT_FALLBACK_TICKS;
/** Once the first final claim arrives the other players have this long (ticks of server time) to send theirs. */
export const FINAL_CLAIM_TIMEOUT_TICKS = SIM_HZ * 20;
/**
 * Once the first final claim arrived, every checkpoint below the final tick must reach consensus within this long
 * (server ticks), else the run ends unranked ("desync", logged) instead of waiting for the session's idle expiry.
 * Stall detection (HASH_REPORT_TIMEOUT_TICKS) normally resolves a missing report first: this is the backstop.
 */
export const FINAL_CHECKPOINT_TIMEOUT_TICKS = FINAL_CLAIM_TIMEOUT_TICKS + HASH_REPORT_TIMEOUT_TICKS;

/**
 * Client hash reports: every report stays pending until the server's ack (the highest decided tick, carried by every
 * `lockstepFrames`) covers it, and is sent again every HASH_RESEND_SECONDS meanwhile (a dropped call is recovered).
 * One `lockstepHash` call carries every report due (at most MAX_HASH_BATCH, oldest first), and the client makes at
 * most one such call per HASH_SEND_MIN_SECONDS however fast it steps (catch-up, high frame rates).
 */
export const HASH_RESEND_SECONDS = 2;
export const HASH_SEND_MIN_SECONDS = 0.25;
export const MAX_HASH_BATCH = 32;

/** Per player: lockstepInput calls allowed per window (a client sends ~30-60 per second); extra calls are dropped. */
export const LOCKSTEP_INPUT_RATE = table.freeze({ count: SIM_HZ * 3, windowSeconds: 1 });
/**
 * Per player: lockstepHash calls per window. A client sends at most 1 / HASH_SEND_MIN_SECONDS = 4 calls per second
 * (catch-up at MAX_CATCHUP_TICKS_PER_FRAME included: its reports are batched, not sent one call each), so 60 per 10 s
 * is 1.5x headroom; anything past it is a broken or hostile client (and a dropped batch is resent anyway).
 */
export const LOCKSTEP_HASH_RATE = table.freeze({ count: 60, windowSeconds: 10 });
/**
 * Per player: lockstepFinal calls per window, a limiter of its own (an honest client sends ONE per run, so hash
 * traffic can never starve it). Extra calls are dropped and logged.
 */
export const LOCKSTEP_FINAL_RATE = table.freeze({ count: 4, windowSeconds: 10 });
/** Per player: lockstepLeave calls per window (an honest client sends one per run; the leave is idempotent). */
export const LOCKSTEP_LEAVE_RATE = table.freeze({ count: 4, windowSeconds: 10 });

/**
 * Co-op frame pacing (docs/FRAME_PACING.md, Design 1-3): the client's PlayoutPacer (pacer.ts) steps received merged
 * frames on a steady playout clock from a small jitter buffer. Depths are in ticks of SIM_DT. All provisional until
 * FP0 / FP6 measure a real session.
 */
export interface PacingTunables {
	/** Buffer depth before any arrival is measured (the first batch places the playout clock this deep). */
	readonly startDepthTicks: number;
	/** The buffer is never shallower: one broadcast batch plus a tick of margin (FPD6). */
	readonly minDepthTicks: number;
	/**
	 * The target depth never goes past this (200 ms): beyond it a hold is better than the delay. Also the most the input
	 * lead adds for the buffer (depthTicks), so MAX_INPUT_LEAD_TICKS + this stays inside MAX_INPUT_AHEAD_TICKS.
	 */
	readonly maxDepthTicks: number;
	/**
	 * Added to the measured jitter: rounding and Heartbeat granularity. Arrivals are handled on a rendered frame, so an
	 * offset can read a whole frame (one tick at 60 fps) later than any measured; 0.5 held about once a second on the
	 * 20-120 ms spec network (lockstep.spec FP4), 1.5 not once after the warm-up.
	 */
	readonly marginTicks: number;
	/** The jitter is measured over the arrivals of this many seconds (follows a changing network within seconds). */
	readonly jitterWindowSec: number;
	/** The jitter is this quantile of the arrival offsets (not the max: one outlier is one hold, not a lasting delay). */
	readonly jitterPercentile: number;
	/** The best-case path (the smallest arrival offset) is taken over this many seconds (follows a route change). */
	readonly floorWindowSec: number;
	/** The playout clock moves toward its target at most this share of real time (runs at 1 +/- this speed). */
	readonly slewShare: number;
	/** The faster share used while the clock is more than fastSlewTicks past its target (after a long hold, FPD7). */
	readonly fastSlewShare: number;
	/** How far past its target (ticks) the playout clock must be for the fast slew. */
	readonly fastSlewTicks: number;
	/**
	 * Past its target by more than this (ticks; a long hold: a server stall, a long network hiccup) the playout clock is
	 * not slewed back (10 % would take ten times the hold) but reset to the target + fastForwardMarginTicks, never past
	 * the newest queued frame: the frames due step at maxCatchup per frame, a bounded fast-forward.
	 */
	readonly fastForwardTicks: number;
	/** The fast-forward stops this far (ticks) above the target; the slew does the rest. */
	readonly fastForwardMarginTicks: number;
	/**
	 * A rendered frame longer than this (seconds), or this much clock since the last frame (a stall inside the render
	 * step before the pump), is a client hitch: P is not moved, and the arrivals of that frame and the next are left out
	 * of the windows.
	 */
	readonly hitchFrameSec: number;
	/**
	 * The lead's depth (depthTicks) rises at once when the buffer depth passes it, but falls only once the depth is this
	 * many ticks at or below the next whole tick down: a depth hovering at a tick boundary does not flicker the input
	 * target. Just under half a tick, so a depth sitting mid-tick (where the phase shift tends to put it) is never on the
	 * threshold.
	 */
	readonly leadHysteresisTicks: number;
	/** The frames' phase on the tick grid and its spread are smoothed by this share per frame. */
	readonly phaseSmoothing: number;
	/**
	 * The phase is locked (and the mid-tick phase shift applied) while the frames' mean distance from the smoothed phase
	 * is under this (ticks): frames at or below about the sim rate with ordinary jitter (~0.03 at 60 fps +/- 1 ms); 120 /
	 * 144 fps walk round the tick (~0.25) and are left unshifted.
	 */
	readonly phaseLockSpread: number;
	/** The phase shift keeps its whole-tick choice while it stays within 0.5 + this (ticks): P* wobbling at a boundary. */
	readonly phaseHysteresisTicks: number;
}

export const PACING: PacingTunables = table.freeze({
	startDepthTicks: 3,
	minDepthTicks: 3,
	maxDepthTicks: 12,
	marginTicks: 1.5,
	jitterWindowSec: 4,
	jitterPercentile: 0.95,
	floorWindowSec: 10,
	slewShare: 0.05,
	fastSlewShare: 0.1,
	fastSlewTicks: 6,
	fastForwardTicks: 12,
	fastForwardMarginTicks: 1,
	hitchFrameSec: 0.1,
	leadHysteresisTicks: 0.4,
	phaseSmoothing: 0.1,
	phaseLockSpread: 0.12,
	phaseHysteresisTicks: 0.25,
});

/**
 * The KV_Debug co-op arrival log (docs/FRAME_PACING.md FP0 / FP5; arrivalLog.ts): SimController prints one line per
 * window with the batches' inter-arrival times and sizes, the pacer's numbers and the render fps. Diagnostics only:
 * nothing here reaches the sim, the wire or a replay.
 */
export interface ArrivalLogTunables {
	/** One line per this many seconds of local clock. */
	readonly windowSec: number;
	/** Batch-size histogram buckets: sizes 1 .. sizeBuckets - 1 alone, sizeBuckets or more in the last one. */
	readonly sizeBuckets: number;
	/** At most this many inter-arrival gaps kept per window (a window never reported cannot grow without bound). */
	readonly maxGaps: number;
	/** The two gap quantiles printed (nearest rank). */
	readonly midPercentile: number;
	readonly highPercentile: number;
}

export const ARRIVAL_LOG: ArrivalLogTunables = table.freeze({
	windowSec: 10,
	sizeBuckets: 8,
	maxGaps: 2048,
	midPercentile: 0.5,
	highPercentile: 0.95,
});

export interface LockstepTunables {
	readonly inputDelay: number;
	readonly maxInputLead: number;
	readonly leadDecayTicks: number;
	readonly maxInputAhead: number;
	readonly maxBatchFrames: number;
	readonly hashEvery: number;
	readonly reportTimeoutTicks: number;
	readonly broadcastEvery: number;
	readonly maxTicksPerStep: number;
	readonly maxCatchup: number;
	readonly segmentTicks: number;
	/** The validator's checkpoint spacing (SegmentLimits.checkpointEvery): a multiple of hashEvery. */
	readonly checkpointEvery: number;
	readonly finalTimeoutTicks: number;
	/** After the first final claim: the deadline for consensus on every checkpoint below the final tick. */
	readonly finalCheckpointTimeoutTicks: number;
	/** Client: resend unacknowledged hash reports this often (seconds). */
	readonly hashResendSeconds: number;
	/** Client: at most one hash call per this many seconds. */
	readonly hashSendMinSeconds: number;
	/** Most hash reports per call (client and server). */
	readonly maxHashBatch: number;
	/** Debug input bits survive the relay (Studio tooling); otherwise they are stripped from every frame. */
	readonly allowDebugInput: boolean;
	/**
	 * Client: co-op frame pacing (docs/FRAME_PACING.md). Defined: the client owns a PlayoutPacer and paces once its
	 * caller passes a clock (`receive` / `pump`'s `now`); undefined: it steps every received frame at once, as before.
	 * The server ignores it.
	 */
	readonly pacing: PacingTunables | undefined;
}

export const DEFAULT_LOCKSTEP: LockstepTunables = table.freeze({
	inputDelay: INPUT_DELAY_TICKS,
	maxInputLead: MAX_INPUT_LEAD_TICKS,
	leadDecayTicks: INPUT_LEAD_DECAY_TICKS,
	maxInputAhead: MAX_INPUT_AHEAD_TICKS,
	maxBatchFrames: MAX_INPUT_BATCH_FRAMES,
	hashEvery: HASH_REPORT_EVERY_TICKS,
	reportTimeoutTicks: HASH_REPORT_TIMEOUT_TICKS,
	broadcastEvery: BROADCAST_EVERY_TICKS,
	maxTicksPerStep: MAX_SERVER_TICKS_PER_STEP,
	maxCatchup: MAX_CATCHUP_TICKS_PER_FRAME,
	segmentTicks: PARTY_SEGMENT_TICKS,
	checkpointEvery: SEGMENT_CHECKPOINT_TICKS,
	finalTimeoutTicks: FINAL_CLAIM_TIMEOUT_TICKS,
	finalCheckpointTimeoutTicks: FINAL_CHECKPOINT_TIMEOUT_TICKS,
	hashResendSeconds: HASH_RESEND_SECONDS,
	hashSendMinSeconds: HASH_SEND_MIN_SECONDS,
	maxHashBatch: MAX_HASH_BATCH,
	allowDebugInput: false,
	pacing: PACING,
});
