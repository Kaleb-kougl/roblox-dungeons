/**
 * Lockstep tunables (M4 co-op). Data only: relay.ts / session.ts / client.ts read these; nothing is inlined in logic.
 * docs/SERVER.md "Co-op lockstep (M4)" has the protocol.
 *
 * @module
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
/** A client makes at most one `lockstepHash` call per this many seconds, however fast it steps. */
export const HASH_SEND_MIN_SECONDS = 0.25;
/** Most hash reports one `lockstepHash` call carries (oldest first). */
export const MAX_HASH_BATCH = 32;

/**
 * The input echo (docs/FRAME_PACING.md Design 9, wire.ts `encodeInputEcho`): every `lockstepFrames` carries, for its
 * recipient only, how early that member's input with the lowest slack since the last echo reached the server. Its slack is sent in 1/this of a tick.
 */
export const INPUT_ECHO_SLACK_SCALE = 16;
/** Bytes of one input echo: u8 flags, i32 tick offset, i16 slack, u8 lates. */
export const INPUT_ECHO_BYTES = 8;

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

/** The frame pacing values the game runs with (PlayoutPacer; docs/FRAME_PACING.md). */
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
	/** The high one of the two (0..1). */
	readonly highPercentile: number;
}

/** The arrival log's values (ArrivalLog; KV_Debug co-op runs only). */
export const ARRIVAL_LOG: ArrivalLogTunables = table.freeze({
	windowSec: 10,
	sizeBuckets: 8,
	maxGaps: 2048,
	midPercentile: 0.5,
	highPercentile: 0.95,
});

/**
 * The co-op input lead from measured trips (docs/FRAME_PACING.md Revision 2, Design 10; Revision 3, Design 13; lead.ts
 * LeadController): the net lead is the slowest `percentile` of the last `windowSec` of the server-echoed net trips plus
 * `marginTicks` (the base), or more, the slowest `coverPercentile` of the last `coverWindowSec` plus the margin (the
 * cover), but the cover only up to the prediction cap less the buffer's depth (the ceiling LockstepClient passes from
 * PREDICTION.maxTicks; no prediction, no cover); raised at once, lowered a tick at a time once the fall target (with
 * `fallSlackTicks` more) has been below it for `fallHoldSec`. A late never bumps it (FPD15) unless `lateBump`. A long
 * spike's trips are kept out of the cover (`episodes`, FPD20). Trips are in ticks of SIM_DT, without the pacing
 * buffer's depth (the lead adds that separately, Design 5). All provisional until FP0 / FP6 / FP21 measure a real
 * session.
 */
export interface LeadTunables {
	/** The trips of this many seconds are kept (~150 at 30 echoes a second): follows a changing network within seconds. */
	readonly windowSec: number;
	/** The target covers this quantile of the window's trips (nearest rank): one outlier is one late, not a lasting delay. */
	readonly percentile: number;
	/** Added to the quantile (ticks): the server's receipt and the client's send both fall on whole frames. */
	readonly marginTicks: number;
	/**
	 * The lead falls only toward the quantile + margin + this (ticks): a quantile wobbling round a tick boundary sits
	 * inside the band and never moves the lead.
	 */
	readonly fallSlackTicks: number;
	/** The fall target must stay below the lead this long (seconds) before the first tick down; a late restarts it. */
	readonly fallHoldSec: number;
	/** Then one tick down per this many seconds while it holds (each fall skips one sample, FP1). */
	readonly fallStepSec: number;
	/**
	 * Fewer trips than this in the window is the warm-up: the target is the window's max + margin, and nothing falls
	 * (~0.7 s of echoes before the quantile is trusted).
	 */
	readonly minSamples: number;
	/** No echo for this long (seconds of batches arriving, `received`): an old server; the legacy miss counter runs. */
	readonly echoTimeoutSec: number;
	/**
	 * Send records (sentAt / depth per target tick, waiting for their echo) are kept for the newest this many targets
	 * (a fixed ring). An echo comes one trip after its send (lead + depth stays under 42 ticks), so 2 s of sends is far
	 * past any echo still useful; a server that never echoes cannot grow the store.
	 */
	readonly recordTicks: number;
	/**
	 * An echoed late (not excused) bumps the lead at once to that late's own trip + margin, at least a tick past the lead
	 * it was sent with, and restarts the fall hold: Revision 2's rule. False (FPD15, owner 2026-11-10): a late is only
	 * counted; its trip is in both windows like any other, so it raises the lead only by moving the base's or the cover's
	 * quantile. The bump came a round trip after the late, after the burst, and cost churn and felt delay for about the
	 * same lates (docs/FRAME_PACING.md Revision 3, the census). True: KV_LeadBump's A/B.
	 */
	readonly lateBump: boolean;
	/**
	 * The cover's window (seconds; ~450 trips at 30 echoes a second): long enough that the bursts of the last seconds are
	 * still in it when the next comes (a 5 s window forgets them first). FPD16.
	 */
	readonly coverWindowSec: number;
	/**
	 * The cover covers this quantile of its window's trips (nearest rank). Under the ceiling the p99 and the max measure
	 * the same on the census's owner-like links, but the max keeps a one-off hold's trip for the whole window. FPD16.
	 */
	readonly coverPercentile: number;
	/**
	 * The long-spike episode detector (FPD20, owner 2026-11-10; docs/FRAME_PACING.md FP23): a long spike's slow trips are
	 * taken out of the cover and kept out while it lasts (the base window keeps them), so the cover forgets a spike as fast
	 * as the base does instead of holding the lead for its whole window; bursts on top of it still enter. Only with the
	 * cover (a ceiling) and without `lateBump`; false: Revision 3's cover exactly (the census's `rule3` / `cov20`).
	 */
	readonly episodes: boolean;
	/**
	 * A trip is slow when it is more than max(this, `episodeIqrK` x the cover window's IQR) over the base window's median
	 * (milliseconds; 2.4 ticks): the floor under the spread on a clean link, where the IQR is a tick or less.
	 */
	readonly episodeGapMs: number;
	/** The slow threshold's spread term: this many interquartile ranges (p75 - p25) of the cover window, nearest rank. */
	readonly episodeIqrK: number;
	/** Up to this many measured trips in a row that are not slow do not end a run of slow trips (the next one does). */
	readonly episodeGapSamples: number;
	/**
	 * A run is an episode once its slow trips span more than this (seconds, arrival clocks, first to newest) and it holds
	 * `episodeMinSlow` of them: a 0.35 s spike is caught; a shorter one is remembered by the cover like a burst.
	 */
	readonly episodeMinSec: number;
	/** The slow trips a run needs to be an episode (a head-of-line clump is 1-2, two merged ones 2-3, a 0.25 s spike ~8). */
	readonly episodeMinSlow: number;
}

/** The measured input lead's values the game runs with (LeadController; docs/FRAME_PACING.md Revision 2 / 3). */
export const LEAD: LeadTunables = table.freeze({
	windowSec: 5,
	percentile: 0.95,
	marginTicks: 1.5,
	fallSlackTicks: 0.75,
	fallHoldSec: 1,
	fallStepSec: 0.25,
	minSamples: 20,
	echoTimeoutSec: 2,
	recordTicks: SIM_HZ * 2,
	lateBump: false,
	coverWindowSec: 15,
	coverPercentile: 0.99,
	episodes: true,
	episodeGapMs: 40,
	episodeIqrK: 3,
	episodeGapSamples: 2,
	episodeMinSec: 0.25,
	episodeMinSlow: 6,
});

/**
 * Local prediction (docs/LOCAL_PREDICTION.md Design 2 / 7, predict.ts): the client draws its own player's body ahead of
 * the merged state, replayed from its own inputs. Presentation only: nothing predicted reaches the sim, a hash, a
 * recording or a remote. Set at LP8 (2026-11-10).
 */
export interface PredictionTunables {
	/**
	 * The most ticks the body is replayed past the merged state (LPD4: 20 = 333 ms, the owner's; was 10). Also the
	 * measured lead's ceiling for its cover (docs/FRAME_PACING.md Design 13: LockstepClient passes it to LeadController).
	 */
	readonly maxTicks: number;
	/** The error statistics (predictionStats) cover this many stepped ticks (10 s, like the pacing windows). */
	readonly statsWindowTicks: number;
	/** A stepped tick whose merged pose is farther than this (tiles) from its prediction counts as a correction. */
	readonly correctionTiles: number;
}

/** Local prediction's values the game runs with (LocalPredictor; docs/LOCAL_PREDICTION.md). */
export const PREDICTION: PredictionTunables = table.freeze({
	maxTicks: 20,
	statsWindowTicks: SIM_HZ * 10,
	correctionTiles: 0.01,
});

/**
 * Every lockstep tunable in one object, handed to the relay, the session and the client (their params' optional
 * `tunables`), so a spec can run them with its own values. The game uses DEFAULT_LOCKSTEP.
 */
export interface LockstepTunables {
	/** A client sends its input for tick T + this when it steps tick T: its starting lead, ticks. */
	readonly inputDelay: number;
	/** The most the lead rises to, ticks. */
	readonly maxInputLead: number;
	/** The miss counter lowers the lead by one after this many ticks without a miss. */
	readonly leadDecayTicks: number;
	/** The relay refuses inputs for ticks further than this past the last finalized one. */
	readonly maxInputAhead: number;
	/** Most frames one input batch may carry. */
	readonly maxBatchFrames: number;
	/** Clients report hashState after every tick that is a multiple of this. */
	readonly hashEvery: number;
	/**
	 * A player who has not reported a tick's hash once the server is this many ticks past it is stalled and dropped.
	 */
	readonly reportTimeoutTicks: number;
	/** Server: finalized frames are broadcast in batches of this many ticks. */
	readonly broadcastEvery: number;
	/** Server: at most this many ticks finalized per step. */
	readonly maxTicksPerStep: number;
	/** Client: most merged frames stepped in one rendered frame. */
	readonly maxCatchup: number;
	/** Server: the merged log goes to the validator in segments of this many ticks. */
	readonly segmentTicks: number;
	/** The validator's checkpoint spacing (SegmentLimits.checkpointEvery): a multiple of hashEvery. */
	readonly checkpointEvery: number;
	/** After the first final claim, the other players have this many server ticks to send theirs. */
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
	/**
	 * Client: the net input lead from measured trips (docs/FRAME_PACING.md Revision 2, Design 10; LeadController).
	 * Defined: the lead follows the server's input echoes (and falls back to the miss counter while none arrive);
	 * undefined: the legacy miss counter only (+1 per missed deadline, -1 after `leadDecayTicks` clean ticks), which
	 * every spec that pins today's lead keeps. The server ignores it (it always echoes).
	 */
	readonly lead: LeadTunables | undefined;
	/**
	 * Server: after a catch-up (a step capped at maxTicksPerStep), an input batch whose first tick is at most this many
	 * ticks past the last tick a capped step finalized is flagged in its echo as the server catching up: it was sent
	 * from a client still stepping the backlog (behind real time), so its slack and lateness measure the catch-up, not
	 * the network. The most an input reaches past the tick it was sent from: the largest lead plus the largest depth.
	 */
	readonly echoCatchUpTailTicks: number;
	/**
	 * Client: local prediction (docs/LOCAL_PREDICTION.md, predict.ts). Defined: the client replays its own player's body
	 * past the merged state after every pump that stepped (`predicted()`, `predictionStats()`); undefined: nothing is
	 * predicted. Read only: it never changes what is stepped, sent or hashed. The server ignores it.
	 */
	readonly prediction: PredictionTunables | undefined;
}

/** The tunables the game runs with: the constants of this file, with pacing, the measured lead and prediction on. */
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
	lead: LEAD,
	echoCatchUpTailTicks: MAX_INPUT_LEAD_TICKS + PACING.maxDepthTicks,
	prediction: PREDICTION,
});
