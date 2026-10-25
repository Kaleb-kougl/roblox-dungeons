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
});
