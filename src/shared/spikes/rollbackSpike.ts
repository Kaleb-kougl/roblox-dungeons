/**
 * The rollback measurement spike's shared contract (docs/ROLLBACK_SPIKE.md Design 5-7, task R4): the debug remote's
 * two payloads (a CPU probe window, `ProbeSummary`, and a live-metric window, `LiveSummary`), their strict server-side
 * readers, the `[Rollback]` log lines, the AnalyticsService events they become (`RollbackCpu`, `RollbackProbe`), the
 * DataStore names and keys, and who may be captured. The capture codec is rollbackCapture.ts.
 *
 * Every reader re-reads a client payload the way shared/run readRunRecapReport does: a table, every field typed and
 * bounded, enums from their own lists, a NEW object built from the known keys only (nothing else the client sent is
 * kept). A payload that fails any check is dropped whole (undefined). Pure and Roblox-API-free; nothing here is ever
 * read by the sim, a hash, a recording or a score.
 */
import { SPIKE_ATTRIBUTES } from "shared/config";
import { devModeAllowed, type DevAccessPolicy } from "shared/devmode";
import type { AnalyticsEventSpec } from "shared/run";
import { MAX_PARTY_SIZE } from "shared/sim";

/**
 * Captures and probe rows (docs/ROLLBACK_SPIKE.md Design 5, 6). The Studio plugin (plugin/RollbackCapturePlugin.server
 * .lua) and the receiver (scripts/rollback/receive-captures.js) repeat the store names and the port as literals;
 * scripts/rollback/receive-captures.test.js checks they match these.
 */
export const ROLLBACK_CAPTURE = table.freeze({
	/**
	 * Workspace attribute (boolean, server): captures co-op runs and takes probe / live summaries (Studio included).
	 * Off by default.
	 */
	attribute: SPIKE_ATTRIBUTES.rollbackCapture,
	/**
	 * Player attribute the server sets (true) on every player whose summaries it takes (rollbackProbeAllowed, while the
	 * switch is on); the client's probe runs only for such a player.
	 */
	probeAllowedAttribute: "KV_RollbackAllowed",
	/** DataStore of captured co-op runs: `<runId>/meta` (RollbackCaptureMeta) and `<runId>/<i>` (chunk i, a string). */
	captureStore: "KV_RollbackCapture_v1",
	/**
	 * DataStore of probe rows: `<writerId>/<n>` (RollbackProbeRow, one per player per minute at most: that minute's
	 * summaries). The writer id is the server's (one GUID per player per server), never the client's session id.
	 */
	probeStore: "KV_RollbackProbe_v1",
	/**
	 * Characters per chunk. A DataStore value is at most 4 MB (4,194,304 bytes, JSON encoded); a chunk is base64 text
	 * (no character needs escaping), so 3,000,000 leaves over a megabyte of margin.
	 */
	chunkChars: 3000000,
	/**
	 * Ticks per encoded block (10 s at 60 Hz): the server encodes each finished block in its own thread step (one
	 * encodeRecording of this many ticks x the party, then its base64) and keeps it as text, not as frames.
	 */
	blockTicks: 600,
	/** The longest capture kept (two hours at 60 Hz); the recorder stops there and marks the capture truncated. */
	maxTicks: 432000,
	/** Chunks per capture at most (the decoder refuses more; a real capture has one or two, specs use tiny chunks). */
	maxChunks: 4096,
	/** Encoded bytes per capture at most (the decoder refuses more; two hours of 8 players is far below). */
	maxBytes: 50000000,
	/** The receiver's default port on 127.0.0.1 (Rojo's is 34872). */
	receiverPort: 34880,
	/** Key part separator; the meta key's last part. */
	keySeparator: "/",
	metaKey: "meta",
	/** Run ids / session ids in keys: 1..maxIdChars of [A-Za-z0-9_-{}] (DataStore keys are at most 50 chars). */
	maxIdChars: 38,
	/** A run's end reason is cut to this many characters in the meta. */
	maxReasonChars: 200,
	/** World kind of a capture setup: at most this many characters. */
	maxWorldKindChars: 32,
	/** After a party run's lockstep part ends, the capture waits this long for the validator's verdict (its hash). */
	verdictWaitSeconds: 60,
	verdictPollSeconds: 0.5,
	/** BindToClose: captures still open are written, and the writes waited for, at most this long. */
	shutdownWaitSeconds: 20,
	/** Capture meta format version. */
	version: 1,
});

/** The debug remote's payload kinds (`rollbackProbe(kind, payload)`). */
export type RollbackProbeKind = "cpu" | "live";
export const ROLLBACK_PROBE_KINDS: ReadonlyArray<RollbackProbeKind> = ["cpu", "live"];

/**
 * Per player, sliding windows (shared/run SlidingWindowLimiter), checked before anything is read or logged: a CPU
 * window every 10 s and a live one a minute (with slack), and `refused`: the warnings a player's refused payloads may
 * print (unknown kind, malformed, not allowed, a session id another player owns), the rest dropped silently.
 */
export const ROLLBACK_PROBE_RATE = table.freeze({
	cpu: table.freeze({ count: 12, windowSeconds: 60 }),
	live: table.freeze({ count: 3, windowSeconds: 60 }),
	refused: table.freeze({ count: 3, windowSeconds: 60 }),
});

/**
 * The analytics budget per player (published places only), in summaries a sliding window, each logged whole or not at
 * all: a CPU window logs 1 event (RollbackCpu), a live window ROLLBACK_ANALYTICS_LIVE_METRICS.size() (4: RollbackProbe).
 * So at most 7 x 1 + 2 x 4 = 15 events in any minute and about 6 + 4 = 10 a minute sustained per player.
 */
export const ROLLBACK_ANALYTICS_RATE = table.freeze({
	cpu: table.freeze({ count: 7, windowSeconds: 60 }),
	live: table.freeze({ count: 2, windowSeconds: 120 }),
});

/**
 * Probe rows (KV_RollbackProbe_v1): a player's summaries are buffered and written as ONE row (SetAsync of a new key)
 * once the oldest has waited writeEverySeconds, so a player writes at most one row a minute (plus one when they leave
 * or the server closes). A row holds at most maxPerRow summaries of each kind (more are dropped and counted). A write
 * is skipped (the row dropped, logged) while the server's SetIncrementAsync budget is under budgetReserve, which keeps
 * the game's own saves (records, settings, onboarding) first. The service polls for due rows every pollSeconds.
 */
export const ROLLBACK_PROBE_ROWS = table.freeze({
	writeEverySeconds: 60,
	pollSeconds: 5,
	maxPerRow: table.freeze({ cpu: 24, live: 6 }),
	budgetReserve: 20,
});

/** The readers' bounds. Numbers outside them (or not finite) drop the whole payload. */
export const ROLLBACK_PROBE_LIMITS = table.freeze({
	/** Session ids: HttpService:GenerateGUID(false) is 36. */
	maxSessionIdChars: 36,
	maxWindowIndex: 99999,
	/** H (ticks predicted ahead). */
	maxHorizon: 64,
	maxMs: 10000,
	/** Frames from the start to the end of one prediction. */
	maxFrames: 600,
	maxFps: 1000,
	/** gcinfo() growth, KB per second, either sign (a collection shrinks it). */
	maxGcKbPerSec: 1000000,
	maxActors: 4096,
	maxBullets: 100000,
	maxSamples: 1000000,
	/** A window's length, seconds (10 s CPU windows, 60 s live windows, with slack for a hitch). */
	maxWindowSeconds: 600,
	maxDeviceLabelChars: 48,
	/** L and D, ticks. */
	maxLeadTicks: 600,
	/** One metric's count in one room type of one window. */
	maxCount: 1000000,
});

/** Device classes (analytics field), from what the client knows (touch / gamepad / keyboard, viewport, ten-foot UI). */
export type RollbackDeviceClass = "pc" | "phone" | "tablet" | "console";
export const ROLLBACK_DEVICE_CLASSES: ReadonlyArray<RollbackDeviceClass> = ["pc", "phone", "tablet", "console"];

/** Where the CPU probe's work ran (Design 5). */
export type RollbackProbeMode = "parallel" | "serial";
export const ROLLBACK_PROBE_MODES: ReadonlyArray<RollbackProbeMode> = ["parallel", "serial"];

/** The CPU case, from the state: a one-room fight, the whole floor entered, a boss fight, walking (no fight). */
export type RollbackProbeCase = "room" | "floor" | "boss" | "walk";
export const ROLLBACK_PROBE_CASES: ReadonlyArray<RollbackProbeCase> = ["room", "floor", "boss", "walk"];

/** Room types the live metrics are split by (Design 3). */
export type RollbackRoomType = "combat" | "boss" | "walk";
export const ROLLBACK_ROOM_TYPES: ReadonlyArray<RollbackRoomType> = ["combat", "boss", "walk"];

/** Teammate input guesses (Design 2). */
export type RollbackGuessStrategy = "repeatLast" | "repeatLastAxesOnly" | "neutral";
export const ROLLBACK_GUESS_STRATEGIES: ReadonlyArray<RollbackGuessStrategy> = [
	"repeatLast",
	"repeatLastAxesOnly",
	"neutral",
];

/**
 * The live metrics (Design 3), counted per window and room type; `RollbackProbe`'s field01. Correction buckets
 * (>= 0.1 / 0.25 / 0.5 / 1.0 tiles) for enemies and teammates, truth error >= 0.5 / 1.0 tiles for enemies, undone
 * events, late events, phantom bullets, your hearts both ways, and the cheap plan's phantom / late bullets.
 */
export const ROLLBACK_LIVE_METRICS = [
	"enemyCorr010",
	"enemyCorr025",
	"enemyCorr050",
	"enemyCorr100",
	"mateCorr010",
	"mateCorr025",
	"mateCorr050",
	"mateCorr100",
	"enemyErr050",
	"enemyErr100",
	"undoneKill",
	"undoneDeath",
	"undonePickup",
	"undoneErase",
	"lateEvent",
	"phantomBullet",
	"heartPhantom",
	"heartMissed",
	"cheapPhantomBullet",
	"cheapLateBullet",
] as const;
export type RollbackLiveMetric = (typeof ROLLBACK_LIVE_METRICS)[number];

/**
 * The live metrics a live window logs to AnalyticsService (RollbackProbe's field01): the four the proposed gates read
 * (docs/ROLLBACK_SPIKE.md Gates: enemy corrections >= 0.5 tile, undone kills, phantom bullets, teammate corrections
 * >= 1 tile). Every metric stays in the server log line and the probe row.
 */
export const ROLLBACK_ANALYTICS_LIVE_METRICS: ReadonlyArray<RollbackLiveMetric> = [
	"enemyCorr050",
	"undoneKill",
	"phantomBullet",
	"mateCorr100",
];

/** Custom event names (two of Roblox's 100; shared/onboarding analyticsCatalog lists them). */
export const ROLLBACK_ANALYTICS_EVENT = {
	/** One CPU window: value = total ms p95; device class, mode + H bucket, case. */
	cpu: "RollbackCpu",
	/** One gate metric of one live window: value = per minute; metric, device class, H bucket. */
	probe: "RollbackProbe",
} as const;

/** H buckets of the analytics fields: H up to 8, 16, 24, 32, and over 32. */
export const ROLLBACK_HORIZON_BUCKETS: ReadonlyArray<number> = [8, 16, 24, 32];
export const ROLLBACK_HORIZON_OVER = "More";
/** Prefix of `RollbackProbe`'s H field (`h16`). */
export const ROLLBACK_HORIZON_PREFIX = "h";
/** Per-minute analytics values are rounded to this many steps per unit. */
const ANALYTICS_STEPS = 100;
const SECONDS_PER_MINUTE = 60;

// ---------------------------------------------------------------------------------------------
// Payloads

/** p50 / p95 / max over one window. */
export interface RollbackProbeStat {
	readonly p50: number;
	readonly p95: number;
	readonly max: number;
}

/** One CPU window of the device probe (Design 5 "Logged, not only shown"). */
export interface ProbeSummary {
	/** One per probe start (HttpService:GenerateGUID(false)); rows of a session share it. */
	readonly sessionId: string;
	/** 0, 1, 2, ... within the session. */
	readonly windowIndex: number;
	readonly mode: RollbackProbeMode;
	/** H: ticks stepped per prediction. */
	readonly horizon: number;
	readonly case: RollbackProbeCase;
	readonly partySize: number;
	/** Actors and enemy bullets alive (the window's last sample). */
	readonly actors: number;
	readonly enemyBullets: number;
	/**
	 * Milliseconds per CPU prediction, the worker's own work (yields excluded): clone, step H ticks, send the digest
	 * (fill + post, timed where it is sent), and their total. The live model's work in the same rounds is NOT in them
	 * (see `live`).
	 */
	readonly clone: RollbackProbeStat;
	readonly step: RollbackProbeStat;
	readonly send: RollbackProbeStat;
	readonly total: RollbackProbeStat;
	/**
	 * Milliseconds from the digest's send to its arrival on the main thread (the main thread's clock; the client
	 * fills it from the digests that arrived since its previous CPU window; zeros when none did).
	 */
	readonly digest: RollbackProbeStat;
	/** Rendered frames from the start to the end of one CPU prediction (1 in serial mode). */
	readonly framesPerPrediction: RollbackProbeStat;
	/**
	 * Co-op parallel: the live model's work per round (milliseconds, yields excluded) and its predictions in the
	 * window. Each round runs the CPU prediction, then the live one, on the same worker: the CPU stats above are the CPU
	 * prediction alone, while frame rate, frame time, gc and frames per prediction carry both loads. liveSamples 0 (solo,
	 * serial): no live model ran, the window is the CPU probe alone.
	 */
	readonly live: RollbackProbeStat;
	readonly liveSamples: number;
	/** CPU predictions in the window, and its length in seconds. */
	readonly samples: number;
	readonly windowSeconds: number;
	readonly renderFps: number;
	readonly frameMsP95: number;
	/** gcinfo() growth per second over the window, KB. */
	readonly gcKbPerSec: number;
	/** The sim ran with `--!native` code generation. */
	readonly native: boolean;
	/** What the game knows about the device, plus the tester's tag (e.g. "touch 2400x1080 Pixel 6a"). */
	readonly deviceLabel: string;
	readonly deviceClass: RollbackDeviceClass;
}

/** The net lead seen over a live window, ticks (Design 7): L = guessed span, D = playout depth. */
export interface RollbackLeadSeen {
	readonly lMean: number;
	readonly lMax: number;
	readonly dMean: number;
	readonly dMax: number;
}

/** One metric's count in a room type over a window (absent = 0). */
export type RollbackMetricCounts = { readonly [K in RollbackLiveMetric]?: number };

/** Play seconds in one room type and the metrics counted there. */
export interface RollbackLiveRoom {
	readonly seconds: number;
	readonly counts: RollbackMetricCounts;
}

/** One live-metric window (Design 7): the prediction model run on the real network and the real inputs. */
export interface LiveSummary {
	readonly sessionId: string;
	readonly windowIndex: number;
	readonly strategy: RollbackGuessStrategy;
	readonly horizon: number;
	readonly partySize: number;
	/** The predicting player's index in the party. */
	readonly playerIndex: number;
	/** The window's play seconds (the per-minute rates divide by it; counted from confirmed ticks). */
	readonly seconds: number;
	/**
	 * Predictions the live model made in the window (rounds with something to predict), and the main thread's rendered
	 * frames the worker saw (one frames message each). The worker predicts once a round on the newest confirmed tick,
	 * so when it falls behind it coalesces frames: predictions < mainFrames. Then corrections are undercounted (only
	 * drawn ticks two consecutive predictions both drew are compared) and late events overcounted (a tick never drawn
	 * is "late"): read the window's rates with predictions / mainFrames beside them.
	 */
	readonly predictions: number;
	readonly mainFrames: number;
	readonly lead: RollbackLeadSeen;
	/** Per room type (absent: none of the window was spent there). */
	readonly rooms: { readonly [K in RollbackRoomType]?: RollbackLiveRoom };
	readonly deviceLabel: string;
	readonly deviceClass: RollbackDeviceClass;
}

/**
 * One `KV_RollbackProbe_v1` row: one player's re-read summaries of up to a minute, in arrival order, and when / where
 * the server wrote them. The receiver (scripts/rollback/receive-captures.js) turns each summary into its own line.
 */
export interface RollbackProbeRow {
	readonly v: number;
	/** Unix seconds of the write. */
	readonly at: number;
	/** game.PlaceVersion (0 in Studio). */
	readonly placeVersion: number;
	readonly cpu: ReadonlyArray<ProbeSummary>;
	readonly live: ReadonlyArray<LiveSummary>;
	/** Summaries over maxPerRow that were dropped from this row. */
	readonly dropped: number;
}

/** The probe row format version (1: one row per window keyed by the client's session id; 2: rows per minute). */
export const ROLLBACK_PROBE_ROW_VERSION = 2;

// ---------------------------------------------------------------------------------------------
// Readers

function asTable(v: unknown): Record<string, unknown> | undefined {
	return typeIs(v, "table") ? (v as Record<string, unknown>) : undefined;
}

/** A finite number in [min, max], or undefined. */
function bounded(v: unknown, min: number, max: number): number | undefined {
	if (!typeIs(v, "number") || v !== v || v < min || v > max) return undefined;
	return v;
}

/** An integer in [min, max], or undefined. */
function integer(v: unknown, min: number, max: number): number | undefined {
	const n = bounded(v, min, max);
	return n !== undefined && n % 1 === 0 ? n : undefined;
}

function oneOf<T extends string>(v: unknown, list: ReadonlyArray<T>): T | undefined {
	return typeIs(v, "string") && (list as ReadonlyArray<string>).includes(v) ? (v as T) : undefined;
}

/** A key id (run id, session id): 1..max characters of letters, digits, `-`, `_`, `{`, `}`. */
export function isRollbackKeyId(v: unknown, max: number = ROLLBACK_CAPTURE.maxIdChars): v is string {
	return typeIs(v, "string") && v.size() > 0 && v.size() <= max && string.match(v, "^[%w%-_{}]+$")[0] !== undefined;
}

/** A label: at most maxDeviceLabelChars bytes of valid UTF-8, no control characters (it is printed and stored). */
function label(v: unknown): string | undefined {
	if (!typeIs(v, "string") || v.size() > ROLLBACK_PROBE_LIMITS.maxDeviceLabelChars) return undefined;
	if (!typeIs(utf8.len(v)[0], "number")) return undefined;
	return string.find(v, "%c")[0] === undefined ? v : undefined;
}

function stat(v: unknown, max: number): RollbackProbeStat | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	const p50 = bounded(t.p50, 0, max);
	const p95 = bounded(t.p95, 0, max);
	const top = bounded(t.max, 0, max);
	if (p50 === undefined || p95 === undefined || top === undefined || p50 > p95 || p95 > top) return undefined;
	return { p50, p95, max: top };
}

/**
 * A `rollbackProbe("cpu", payload)` payload re-read, or undefined (dropped). Rejects: not a table, a session id that
 * is not a key id of at most maxSessionIdChars, an unknown mode / case / device class, H outside 1..maxHorizon, a
 * party size outside 1..MAX_PARTY_SIZE, counts that are not non-negative integers within their bounds, a stat whose
 * p50 > p95 > max order is broken or that is negative / not finite / over maxMs (frames: maxFrames), a non-boolean
 * `native`, a device label that is too long or has control characters. Only the listed keys are kept.
 */
export function readProbeSummary(v: unknown): ProbeSummary | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	const L = ROLLBACK_PROBE_LIMITS;
	if (!isRollbackKeyId(t.sessionId, L.maxSessionIdChars)) return undefined;
	const windowIndex = integer(t.windowIndex, 0, L.maxWindowIndex);
	const mode = oneOf(t.mode, ROLLBACK_PROBE_MODES);
	const horizon = integer(t.horizon, 1, L.maxHorizon);
	const probeCase = oneOf(t.case, ROLLBACK_PROBE_CASES);
	const partySize = integer(t.partySize, 1, MAX_PARTY_SIZE);
	const actors = integer(t.actors, 0, L.maxActors);
	const enemyBullets = integer(t.enemyBullets, 0, L.maxBullets);
	if (windowIndex === undefined || mode === undefined || horizon === undefined || probeCase === undefined) {
		return undefined;
	}
	if (partySize === undefined || actors === undefined || enemyBullets === undefined) return undefined;
	const clone = stat(t.clone, L.maxMs);
	const stepStat = stat(t.step, L.maxMs);
	const send = stat(t.send, L.maxMs);
	const total = stat(t.total, L.maxMs);
	const digest = stat(t.digest, L.maxMs);
	const frames = stat(t.framesPerPrediction, L.maxFrames);
	if (clone === undefined || stepStat === undefined || send === undefined || total === undefined) return undefined;
	if (digest === undefined || frames === undefined) return undefined;
	const liveStat = stat(t.live, L.maxMs);
	const liveSamples = integer(t.liveSamples, 0, L.maxSamples);
	if (liveStat === undefined || liveSamples === undefined) return undefined;
	const samples = integer(t.samples, 0, L.maxSamples);
	const windowSeconds = bounded(t.windowSeconds, 0, L.maxWindowSeconds);
	const renderFps = bounded(t.renderFps, 0, L.maxFps);
	const frameMsP95 = bounded(t.frameMsP95, 0, L.maxMs);
	const gcKbPerSec = bounded(t.gcKbPerSec, -L.maxGcKbPerSec, L.maxGcKbPerSec);
	if (samples === undefined || windowSeconds === undefined || renderFps === undefined) return undefined;
	if (frameMsP95 === undefined || gcKbPerSec === undefined || !typeIs(t.native, "boolean")) return undefined;
	const deviceLabel = label(t.deviceLabel);
	const deviceClass = oneOf(t.deviceClass, ROLLBACK_DEVICE_CLASSES);
	if (deviceLabel === undefined || deviceClass === undefined) return undefined;
	return {
		sessionId: t.sessionId,
		windowIndex,
		mode,
		horizon,
		case: probeCase,
		partySize,
		actors,
		enemyBullets,
		clone,
		step: stepStat,
		send,
		total,
		digest,
		framesPerPrediction: frames,
		live: liveStat,
		liveSamples,
		samples,
		windowSeconds,
		renderFps,
		frameMsP95,
		gcKbPerSec,
		native: t.native,
		deviceLabel,
		deviceClass,
	};
}

function readLead(v: unknown): RollbackLeadSeen | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	const max = ROLLBACK_PROBE_LIMITS.maxLeadTicks;
	const lMean = bounded(t.lMean, 0, max);
	const lMax = bounded(t.lMax, 0, max);
	const dMean = bounded(t.dMean, 0, max);
	const dMax = bounded(t.dMax, 0, max);
	if (lMean === undefined || lMax === undefined || dMean === undefined || dMax === undefined) return undefined;
	if (lMean > lMax || dMean > dMax) return undefined;
	return { lMean, lMax, dMean, dMax };
}

const METRIC_SET = new Set<string>(ROLLBACK_LIVE_METRICS);

/** A counts table: only known metric names, each a non-negative integer up to maxCount. */
function readCounts(v: unknown): RollbackMetricCounts | undefined {
	if (!typeIs(v, "table")) return undefined;
	const out: { [K in RollbackLiveMetric]?: number } = {};
	for (const [k, n] of pairs(v as unknown as ReadonlyMap<unknown, unknown>)) {
		if (!typeIs(k, "string") || !METRIC_SET.has(k)) return undefined;
		const count = integer(n, 0, ROLLBACK_PROBE_LIMITS.maxCount);
		if (count === undefined) return undefined;
		out[k as RollbackLiveMetric] = count;
	}
	return out;
}

function readRoom(v: unknown): RollbackLiveRoom | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	const seconds = bounded(t.seconds, 0, ROLLBACK_PROBE_LIMITS.maxWindowSeconds);
	const counts = readCounts(t.counts);
	if (seconds === undefined || counts === undefined) return undefined;
	return { seconds, counts };
}

const ROOM_SET = new Set<string>(ROLLBACK_ROOM_TYPES);

function readRooms(v: unknown): { [K in RollbackRoomType]?: RollbackLiveRoom } | undefined {
	if (!typeIs(v, "table")) return undefined;
	const out: { [K in RollbackRoomType]?: RollbackLiveRoom } = {};
	for (const [k, room] of pairs(v as unknown as ReadonlyMap<unknown, unknown>)) {
		if (!typeIs(k, "string") || !ROOM_SET.has(k)) return undefined;
		const r = readRoom(room);
		if (r === undefined) return undefined;
		out[k as RollbackRoomType] = r;
	}
	return out;
}

/**
 * A `rollbackProbe("live", payload)` payload re-read, or undefined (dropped). Rejects: not a table, a bad session id
 * or window index, an unknown strategy / device class, H outside 1..maxHorizon, a party size outside
 * 1..MAX_PARTY_SIZE, a player index outside the party, window seconds outside 0..maxWindowSeconds, a lead whose mean
 * exceeds its max or leaves 0..maxLeadTicks, a `rooms` key that is not a room type, a counts key that is not a metric
 * name (ROLLBACK_LIVE_METRICS), a count that is not a non-negative integer up to maxCount, a bad device label. Only the
 * listed keys are kept.
 */
export function readLiveSummary(v: unknown): LiveSummary | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	const L = ROLLBACK_PROBE_LIMITS;
	if (!isRollbackKeyId(t.sessionId, L.maxSessionIdChars)) return undefined;
	const windowIndex = integer(t.windowIndex, 0, L.maxWindowIndex);
	const strategy = oneOf(t.strategy, ROLLBACK_GUESS_STRATEGIES);
	const horizon = integer(t.horizon, 1, L.maxHorizon);
	const partySize = integer(t.partySize, 1, MAX_PARTY_SIZE);
	if (windowIndex === undefined || strategy === undefined || horizon === undefined || partySize === undefined) {
		return undefined;
	}
	const playerIndex = integer(t.playerIndex, 0, partySize - 1);
	const seconds = bounded(t.seconds, 0, L.maxWindowSeconds);
	const predictions = integer(t.predictions, 0, L.maxSamples);
	const mainFrames = integer(t.mainFrames, 0, L.maxSamples);
	const lead = readLead(t.lead);
	const rooms = readRooms(t.rooms);
	if (playerIndex === undefined || seconds === undefined || lead === undefined || rooms === undefined) {
		return undefined;
	}
	if (predictions === undefined || mainFrames === undefined) return undefined;
	const deviceLabel = label(t.deviceLabel);
	const deviceClass = oneOf(t.deviceClass, ROLLBACK_DEVICE_CLASSES);
	if (deviceLabel === undefined || deviceClass === undefined) return undefined;
	return {
		sessionId: t.sessionId,
		windowIndex,
		strategy,
		horizon,
		partySize,
		playerIndex,
		seconds,
		predictions,
		mainFrames,
		lead,
		rooms,
		deviceLabel,
		deviceClass,
	};
}

/** A metric's count over every room type of the window. */
export function liveMetricCount(s: Readonly<LiveSummary>, metric: RollbackLiveMetric): number {
	let n = 0;
	for (const room of ROLLBACK_ROOM_TYPES) n += s.rooms[room]?.counts[metric] ?? 0;
	return n;
}

/** A metric per minute of the window's play (0 for an empty window). */
export function liveMetricPerMinute(s: Readonly<LiveSummary>, metric: RollbackLiveMetric): number {
	if (s.seconds <= 0) return 0;
	return (liveMetricCount(s, metric) * SECONDS_PER_MINUTE) / s.seconds;
}

// ---------------------------------------------------------------------------------------------
// Keys

/** `<writerId>/<n>`: a player's n-th probe row on one server (a writer's rows list by the `<writerId>/` prefix). */
export function rollbackProbeRowKey(writerId: string, n: number): string {
	return `${writerId}${ROLLBACK_CAPTURE.keySeparator}${n}`;
}

/** `<runId>/meta`: a capture's meta (written last, so its presence means every chunk is in). */
export function rollbackCaptureMetaKey(runId: string): string {
	return `${runId}${ROLLBACK_CAPTURE.keySeparator}${ROLLBACK_CAPTURE.metaKey}`;
}

/** `<runId>/<i>`: chunk i (0-based) of a capture. */
export function rollbackCaptureChunkKey(runId: string, i: number): string {
	return `${runId}${ROLLBACK_CAPTURE.keySeparator}${i}`;
}

// ---------------------------------------------------------------------------------------------
// Who is captured

/** What the capture gate reads about the server and the party. */
export interface RollbackCaptureFacts {
	/** RunService:IsStudio(). */
	readonly studio: boolean;
	/** The party's UserIds. */
	readonly memberIds: ReadonlyArray<number>;
	/** game.PrivateServerOwnerId (0: not a private server, or a reserved one). */
	readonly privateServerOwnerId: number;
	readonly creatorId: number;
	readonly creatorIsUser: boolean;
}

/** What the probe intake's gate reads about the server and one player. */
export interface RollbackProbeFacts {
	readonly studio: boolean;
	readonly userId: number;
	readonly privateServerOwnerId: number;
	readonly creatorId: number;
	readonly creatorIsUser: boolean;
}

/**
 * The capture policy for one player (the probe intake, and the client probe through the server's
 * probeAllowedAttribute): Studio, a player who may use developer mode, or anyone in a private server whose owner may.
 * The same rule as rollbackCaptureAllowed, which takes a party when every member passes it (or the owner does).
 */
export function rollbackProbeAllowed(facts: Readonly<RollbackProbeFacts>, policy?: Readonly<DevAccessPolicy>): boolean {
	return rollbackCaptureAllowed(
		{
			studio: facts.studio,
			memberIds: [facts.userId],
			privateServerOwnerId: facts.privateServerOwnerId,
			creatorId: facts.creatorId,
			creatorIsUser: facts.creatorIsUser,
		},
		policy,
	);
}

/**
 * Design 6: a party run is captured (with the switch on) in Studio, when every member may use developer mode
 * (shared/devmode devModeAllowed: a listed UserId or the user-owned place's creator), or in a private server whose
 * owner may (deliberately: R5's playtest is a developer's private server with friends on their own connections, whose
 * inputs are the answer; every capture and probe row is written with its players' UserIds for erasure).
 */
export function rollbackCaptureAllowed(
	facts: Readonly<RollbackCaptureFacts>,
	policy?: Readonly<DevAccessPolicy>,
): boolean {
	if (facts.studio) return true;
	const allowed = (userId: number) =>
		devModeAllowed(
			{ studio: false, userId, creatorId: facts.creatorId, creatorIsUser: facts.creatorIsUser },
			policy,
		);
	if (facts.privateServerOwnerId > 0 && allowed(facts.privateServerOwnerId)) return true;
	return facts.memberIds.size() > 0 && facts.memberIds.every(allowed);
}

// ---------------------------------------------------------------------------------------------
// Analytics

/** H's bucket: "8", "16", "24", "32" (the first bucket at or above H) or "More". */
export function rollbackHorizonBucket(horizon: number): string {
	for (const b of ROLLBACK_HORIZON_BUCKETS) if (horizon <= b) return tostring(b);
	return ROLLBACK_HORIZON_OVER;
}

/** Every H bucket, in order. */
export function rollbackHorizonBuckets(): string[] {
	const out = ROLLBACK_HORIZON_BUCKETS.map((b) => tostring(b));
	out.push(ROLLBACK_HORIZON_OVER);
	return out;
}

/** `RollbackCpu`'s field02: mode + H bucket (`parallel16`). */
export function rollbackModeHorizon(mode: RollbackProbeMode, horizon: number): string {
	return `${mode}${rollbackHorizonBucket(horizon)}`;
}

/** `RollbackProbe`'s field03: `h` + H bucket (`h16`). */
export function rollbackHorizonLabel(horizon: number): string {
	return `${ROLLBACK_HORIZON_PREFIX}${rollbackHorizonBucket(horizon)}`;
}

/** Every `RollbackCpu` field02 value. */
export function rollbackModeHorizonValues(): string[] {
	const out: string[] = [];
	for (const m of ROLLBACK_PROBE_MODES) for (const b of rollbackHorizonBuckets()) out.push(`${m}${b}`);
	return out;
}

/** Every `RollbackProbe` field03 value. */
export function rollbackHorizonLabels(): string[] {
	return rollbackHorizonBuckets().map((b) => `${ROLLBACK_HORIZON_PREFIX}${b}`);
}

function rounded(v: number): number {
	return math.round(v * ANALYTICS_STEPS) / ANALYTICS_STEPS;
}

/** One CPU window's event: `RollbackCpu` = total ms p95; device class, mode + H bucket, case. */
export function analyticsForProbeSummary(s: Readonly<ProbeSummary>): AnalyticsEventSpec[] {
	return [
		{
			kind: "custom",
			name: ROLLBACK_ANALYTICS_EVENT.cpu,
			value: rounded(s.total.p95),
			fields: { field01: s.deviceClass, field02: rollbackModeHorizon(s.mode, s.horizon), field03: s.case },
		},
	];
}

/**
 * One live window's events: `RollbackProbe` per gate metric (ROLLBACK_ANALYTICS_LIVE_METRICS, zeros included, so a
 * dashboard's mean is over every window), value = per minute of the window's play; metric, device class, H label. An
 * empty window logs none.
 */
export function analyticsForLiveSummary(s: Readonly<LiveSummary>): AnalyticsEventSpec[] {
	const out: AnalyticsEventSpec[] = [];
	if (s.seconds <= 0) return out;
	const h = rollbackHorizonLabel(s.horizon);
	for (const metric of ROLLBACK_ANALYTICS_LIVE_METRICS) {
		out.push({
			kind: "custom",
			name: ROLLBACK_ANALYTICS_EVENT.probe,
			value: rounded(liveMetricPerMinute(s, metric)),
			fields: { field01: metric, field02: s.deviceClass, field03: h },
		});
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Log lines

const MS = "%.2f";

function fmtStat(s: Readonly<RollbackProbeStat>): string {
	return `${string.format(MS, s.p50)}/${string.format(MS, s.p95)}/${string.format(MS, s.max)}`;
}

function shortId(id: string): string {
	const keep = 8;
	return id.size() > keep ? id.sub(1, keep) : id;
}

/**
 * One CPU window as a `[Rollback]` line (ms as p50/p95/max): `s1a2b3c4d#12 parallel H16 room party 4 actors 37
 * bullets 120 | clone .. step .. send .. total .. digest .. | frames/pred .. live .. n 590 | n 590 in 10.0 s | 59.8 fps
 * frame p95 18.10 ms gc 120 KB/s native | pc "label"`.
 */
export function describeProbeSummary(s: Readonly<ProbeSummary>): string {
	return (
		`${shortId(s.sessionId)}#${s.windowIndex} ${s.mode} H${s.horizon} ${s.case} party ${s.partySize} ` +
		`actors ${s.actors} bullets ${s.enemyBullets} | clone ${fmtStat(s.clone)} step ${fmtStat(s.step)} ` +
		`send ${fmtStat(s.send)} total ${fmtStat(s.total)} digest ${fmtStat(s.digest)} | ` +
		`frames/pred ${fmtStat(s.framesPerPrediction)} live ${fmtStat(s.live)} n ${s.liveSamples} | ` +
		`n ${s.samples} in ${string.format("%.1f", s.windowSeconds)} s | ${string.format("%.1f", s.renderFps)} fps ` +
		`frame p95 ${string.format(MS, s.frameMsP95)} ms gc ${string.format("%.0f", s.gcKbPerSec)} KB/s ` +
		`${s.native ? "native" : "interpreted"} | ${s.deviceClass} "${s.deviceLabel}"`
	);
}

/**
 * One live window as a `[Rollback]` line: header, play seconds, predictions over the main frames seen, the lead seen,
 * the room seconds, then every metric with a non-zero count as `name=<per minute>/min`.
 */
export function describeLiveSummary(s: Readonly<LiveSummary>): string {
	const rooms: string[] = [];
	for (const room of ROLLBACK_ROOM_TYPES) {
		const r = s.rooms[room];
		if (r !== undefined) rooms.push(`${room} ${string.format("%.0f", r.seconds)}s`);
	}
	const metrics: string[] = [];
	for (const metric of ROLLBACK_LIVE_METRICS) {
		if (liveMetricCount(s, metric) > 0) {
			metrics.push(`${metric}=${string.format("%.2f", liveMetricPerMinute(s, metric))}`);
		}
	}
	const l = s.lead;
	return (
		`${shortId(s.sessionId)}#${s.windowIndex} ${s.strategy} H${s.horizon} p${s.playerIndex}/${s.partySize} ` +
		`${string.format("%.1f", s.seconds)} s pred ${s.predictions}/${s.mainFrames} fr | ` +
		`L ${string.format("%.1f", l.lMean)}/${l.lMax} ` +
		`D ${string.format("%.1f", l.dMean)}/${l.dMax} | ${rooms.size() > 0 ? rooms.join(" ") : "no rooms"} | ` +
		`${metrics.size() > 0 ? `${metrics.join(" ")} /min` : "no glitches"} | ${s.deviceClass} "${s.deviceLabel}"`
	);
}
