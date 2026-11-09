/**
 * Server-side run validation tunables (task 9). Data only: validate.ts and the server services read these; nothing
 * here is inlined in logic (CLAUDE.md "No magic numbers").
 */
import { BINARY_RECORDING_HEADER_BYTES, MAX_PARTY_SIZE as SIM_MAX_PARTY_SIZE, SIM_HZ } from "shared/sim";
import { PLAY_MODE } from "shared/config";

/** Longest run the server will replay: 20 minutes of sim time (the M1 run is a few minutes). */
export const MAX_RUN_TICKS = SIM_HZ * 60 * 20;

/**
 * Byte budget per tick of a binary recording (shared/sim recordingCodec.ts). Measured: run-boss-1337 (a bot that moves
 * and aims on every tick, all four axes changing) costs 5.08 bytes per tick, run-full-1337 1.15; mouse aim alone is
 * ~3. 6 leaves ~18 % headroom over the worst measured input. Only pathological input (every axis jumping by 64+
 * units on every tick for 20 minutes) needs more: up to 11 bytes per tick.
 */
export const RECORDING_BYTES_PER_TICK_BUDGET = 6;

/**
 * Largest binary recording accepted, in bytes: the header plus MAX_RUN_TICKS x RECORDING_BYTES_PER_TICK_BUDGET =
 * 21 + 72,000 x 6 = 432,021 bytes. Checked BEFORE decoding, by the client before sending too (a 3-minute
 * keyboard-and-mouse run is ~30 KB).
 */
export const MAX_RECORDING_BYTES = BINARY_RECORDING_HEADER_BYTES + MAX_RUN_TICKS * RECORDING_BYTES_PER_TICK_BUDGET;

/** Reject reasons are cut to this many characters (they can quote sim errors; they go to logs and the client). */
export const MAX_REJECT_REASON_CHARS = 200;

/**
 * Which world a run is validated in. A live server uses LIVE_RUN_WORLD ("endless", or "game" with PLAY_MODE "m1");
 * the other two exist for headless tests and tooling while the actors (task 7) are not ported:
 *   game                the M1 run: dungeon collision + DEFAULT_ENCOUNTER + default loadout (App.tsx's config)
 *   endless             endless mode: floor after floor from the run seed (buildEndlessRunConfig, shared/run endless.ts)
 *   dungeonNoEncounter  the same floor without enemies (fixtures/run-player-dungeon-1337.json)
 *   greybox             DEFAULT_SIM_CONFIG, the 16x16 bounds arena (fixtures/run-player.json); any spawn in bounds
 */
export type RunWorld = "game" | "endless" | "dungeonNoEncounter" | "greybox";

export interface RunLimits {
	/** Reject recordings with more ticks than this (checked before the run-length encoding is expanded). */
	readonly maxTicks: number;
	/** Reject binary recordings longer than this many bytes (checked before decoding). */
	readonly maxRecordingBytes: number;
	/** Accept DEBUG_HIT / DEBUG_BOSS input bits (dev tooling only; never on a live server). */
	readonly allowDebugInput: boolean;
	/** Accept runs that start at the boss door (the web build's debug `?spawn=boss`). */
	readonly allowBossDoorSpawn: boolean;
	/** The world the run is rebuilt in. */
	readonly world: RunWorld;
}

/** What a live server enforces. */
export const DEFAULT_RUN_LIMITS: RunLimits = table.freeze({
	maxTicks: MAX_RUN_TICKS,
	maxRecordingBytes: MAX_RECORDING_BYTES,
	allowDebugInput: false,
	allowBossDoorSpawn: false,
	world: "game" as RunWorld,
});

/**
 * The world a live server validates in and the client plays by default: shared/config PLAY_MODE ("endless" ->
 * "endless", "m1" -> "game").
 */
export const LIVE_RUN_WORLD: RunWorld = PLAY_MODE === "endless" ? "endless" : "game";

/** What a live server enforces for the place's PLAY_MODE: DEFAULT_RUN_LIMITS in LIVE_RUN_WORLD. */
export const LIVE_RUN_LIMITS: RunLimits = table.freeze({ ...DEFAULT_RUN_LIMITS, world: LIVE_RUN_WORLD });

/** Generated dungeons kept in memory (buildRunConfig's per-seed cache; least recently used goes first). */
export const DUNGEON_CACHE_SIZE = 8;

/** Generated endless floors kept in memory, server-wide (endlessDungeon's cache keyed by seed and room count). */
export const ENDLESS_DUNGEON_CACHE_SIZE = 8;

/**
 * Built floor worlds kept per endless run config (collision callbacks, encounter, deferred room spawns): the current
 * floor plus the last ones, so a replay or a live run never rebuilds the floor it stands on.
 */
export const ENDLESS_FLOOR_CACHE_SIZE = 3;

/**
 * CPU time a server replay may take before it yields (task.wait) for a frame: 4 ms of the ~16.7 ms heartbeat, so a
 * replay never holds the server for long (the 2,000-tick blocks it replaced took ~160 ms each). At ~80 us per tick a
 * 20-minute run then takes ~25 s of wall time.
 */
export const REPLAY_BUDGET_SECONDS = 0.004;

/** Replays running at once, server-wide (RunValidationService's queue); the rest wait their turn in order. */
export const REPLAY_CONCURRENCY = 1;

/**
 * Submissions per player that may be validating or queued at once. 2 = one replaying plus the next run (a long run's
 * replay can outlast a short follow-up run). One more answers `busy`, without charging the rate limit.
 */
export const RUN_PENDING_PER_PLAYER = 2;

/**
 * Per-player submission budget: at most `count` submissions per `windowSeconds` (sliding window). The client never
 * submits an abandoned run shorter than MIN_ABANDONED_SUBMIT_TICKS (10 s) unless it is the retry right after a death
 * (shared/play config.ts), so honest play stays under 6 a minute; each submission costs one replay.
 */
export const RUN_SUBMIT_RATE = table.freeze({ count: 6, windowSeconds: 60 });

/** Accepted runs kept in memory per player (RunValidationService; oldest dropped first). */
export const ACCEPTED_RUNS_KEPT_PER_PLAYER = 20;

/** Optional "Runs" DataStore stub: off until there is something (loot, leaderboards) that needs it. */
export const RUNS_DATASTORE_ENABLED = false;
export const RUNS_DATASTORE_NAME = "Runs";
/** Accepted runs kept per player in the Runs DataStore entry (oldest dropped first). */
export const RUNS_DATASTORE_KEPT = 50;

// ---------------------------------------------------------------------------------------------
// Segmented validation (M3: endless runs). docs/SERVER.md "Segmented runs".

/**
 * Longest segment the server takes: 10 minutes of sim time. The client cuts one per floor (at the stairwell) and,
 * as a fallback, every SEGMENT_FALLBACK_TICKS, so an honest segment is always well under this.
 */
export const MAX_SEGMENT_TICKS = SIM_HZ * 60 * 10;

/** Largest binary segment recording: header + MAX_SEGMENT_TICKS x RECORDING_BYTES_PER_TICK_BUDGET (216,021 bytes). */
export const MAX_SEGMENT_BYTES = BINARY_RECORDING_HEADER_BYTES + MAX_SEGMENT_TICKS * RECORDING_BYTES_PER_TICK_BUDGET;

/** Sanity cap on a whole segmented run: 6 hours of sim time (each segment is replayed as it arrives). */
export const MAX_SEGMENTED_RUN_TICKS = SIM_HZ * 60 * 60 * 6;

/** The client cuts a segment at least this often (sim time), even without a floor change: 5 minutes. */
export const SEGMENT_FALLBACK_TICKS = SIM_HZ * 60 * 5;

/**
 * Inside a segment the client also sends hashState after every tick that is a multiple of this (10 s), so a
 * mismatch is located to a 10 s window instead of a whole segment. Costs one hash per 600 ticks on both sides.
 */
export const SEGMENT_CHECKPOINT_TICKS = SIM_HZ * 10;

/**
 * Received but not yet replayed ticks per run. Past this the run is rejected (`backlog_full`): an honest client
 * cannot outrun a server that replays faster than real time, so this only bounds memory against a flood.
 */
export const MAX_PENDING_SEGMENT_TICKS = MAX_SEGMENT_TICKS * 2;

/**
 * A segment may not end later in sim time than the session's wall-clock age plus this (`clock_ahead`): the live loop
 * cannot run faster than real time, so a run "played" faster than that was not played live. Covers latency.
 */
export const SEGMENT_CLOCK_SLACK_SECONDS = 30;

/** An open run session with no segment for this long is dropped (`expired`). Covers long pauses (30 min). */
export const RUN_SESSION_IDLE_SECONDS = 60 * 30;

/** An open run session older than this is dropped (`expired`): MAX_SEGMENTED_RUN_TICKS plus 2 h of pauses. */
export const RUN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

/** How often the server sweeps expired sessions. */
export const RUN_SESSION_SWEEP_SECONDS = 30;

/** The largest seed the server picks (seeds are integers in [0, 2^32), like the web build's). */
export const MAX_RUN_SEED = 4294967295;

/** Ticks a session replays per call between WorkQueue turns (one segment at most per turn). */
export const SEGMENT_REPLAY_SLICE_TICKS = SIM_HZ * 10;

/**
 * Most ticks one session replays per WorkQueue turn (the server's replay pump): a long segment (up to
 * MAX_SEGMENT_TICKS, 10 min) is replayed over several turns, so one run never holds the shared queue for its whole
 * segment while other players' segments wait. 30 s of play: 0.36-2 s of replay CPU per turn at the measured
 * 0.2-1.1 ms per tick (headless, docs/SERVER.md "Replay capacity"), spread over frames by the ReplayBudget.
 */
export const REPLAY_TURN_MAX_TICKS = SIM_HZ * 30;

/**
 * Ticks between ReplayBudget checkpoints inside a segment replay. A check can overshoot the 4 ms budget by up to this
 * many ticks: at the measured worst case (~1.1 ms per tick headless, an 8-player party on a full floor 15, docs/SERVER.md
 * "Replay capacity") 4 ticks keep a frame's replay under ~9 ms (was 16: up to ~18 ms).
 */
export const SEGMENT_BUDGET_CHECK_TICKS = 4;

/** Run starts per player (sliding window); every start builds a world. */
export const RUN_START_RATE = table.freeze({ count: 10, windowSeconds: 60 });

/** Segments per player (sliding window). An honest client sends one per floor; going over rejects the run. */
export const SEGMENT_SUBMIT_RATE = table.freeze({ count: 30, windowSeconds: 60 });

/** Largest party (co-op) a run session accepts: the sim's (shared/sim partyData.ts). */
export const MAX_PARTY_SIZE = SIM_MAX_PARTY_SIZE;

/** Longest world kind name accepted on the wire. */
export const MAX_WORLD_KIND_CHARS = 32;

/**
 * Longest character id accepted on the wire (`StartRunRequest.characterId`, `RunSubmission.characterId`; stored with
 * leaderboard entries as `classId`). docs/ARCHER.md AR5: the old class id's limit.
 */
export const MAX_CHARACTER_ID_CHARS = 48;

/** Longest runId accepted on the wire (server GUIDs are 36). */
export const MAX_RUN_ID_CHARS = 64;

export interface SegmentLimits {
	readonly maxSegmentTicks: number;
	readonly maxSegmentBytes: number;
	readonly maxRunTicks: number;
	readonly checkpointEvery: number;
	readonly maxPendingTicks: number;
	readonly clockSlackSeconds: number;
	/** Accept DEBUG_HIT / DEBUG_BOSS input bits (Studio tooling only). */
	readonly allowDebugInput: boolean;
}

/** What a live server enforces on segments. */
export const DEFAULT_SEGMENT_LIMITS: SegmentLimits = table.freeze({
	maxSegmentTicks: MAX_SEGMENT_TICKS,
	maxSegmentBytes: MAX_SEGMENT_BYTES,
	maxRunTicks: MAX_SEGMENTED_RUN_TICKS,
	checkpointEvery: SEGMENT_CHECKPOINT_TICKS,
	maxPendingTicks: MAX_PENDING_SEGMENT_TICKS,
	clockSlackSeconds: SEGMENT_CLOCK_SLACK_SECONDS,
	allowDebugInput: false,
});

export interface RunSessionLimits {
	readonly idleSeconds: number;
	readonly maxAgeSeconds: number;
	/** Finished sessions still validating per player; one more start answers `busy`. */
	readonly maxFinishingPerPlayer: number;
	readonly maxPartySize: number;
}

export const DEFAULT_RUN_SESSION_LIMITS: RunSessionLimits = table.freeze({
	idleSeconds: RUN_SESSION_IDLE_SECONDS,
	maxAgeSeconds: RUN_SESSION_MAX_AGE_SECONDS,
	maxFinishingPerPlayer: RUN_PENDING_PER_PLAYER,
	maxPartySize: MAX_PARTY_SIZE,
});
