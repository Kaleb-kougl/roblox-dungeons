/**
 * The rollback probe's worker message protocol (docs/ROLLBACK_SPIKE.md Design 5 / 7, tasks R3 / R4b): plain tables
 * (numbers, strings, booleans, flat number arrays and one buffer) between the main thread and the probe's worker (a
 * Parallel Luau Actor, or the same core called on the main thread in serial mode). Pure; every message read on the
 * other side goes through its validator (a new table from the known keys; undefined = dropped).
 *
 * Main -> worker (`Actor:SendMessage(ROLLBACK_WORKER_TOPIC.toWorker, msg)`):
 *   setup    a run started: the inputs the main client built its run from (world kind, seed, party size, the dev run's
 *            options, scoring / stress), the local index, H, the mode, live on / off, the device facts, the session id;
 *            `borrowed` (serial mode): no mirror, the main thread lends its own state each frame
 *   frames   once per rendered frame, BEFORE the main thread steps: T (the confirmed tick), the frame's ms, the merged
 *            frames received since the last message (`truthFirst`, `truth`: n x 5 numbers per tick, index order), the
 *            local player's own frames sent past them (`ownFirst`, `own`: 5 per tick), and `hashTick` (the main state's
 *            hash was taken at T: the worker answers with its mirror's at T; -1 none)
 *   control  `stop` (now) or `end` (step the mirror to `tick`, flush both windows, stop)
 * Worker -> main (a BindableEvent in the Actor, fired in the serial phase; serial mode: a direct call):
 *   cpu         one ProbeSummary (every ROLLBACK_SPIKE.statsWindowSec)
 *   live        one LiveSummary (every ROLLBACK_SPIKE.liveSummarySec; co-op parallel only)
 *   mirrorHash  the mirror's hashState at a requested tick
 *   status      the overlay line's numbers (every probe.statusSec)
 *   digest      the per-prediction digest buffer (what a real rollback would send back; timed at both ends)
 *   error       the probe stopped: why
 *   ready       the worker bound its topics (the main thread holds its messages until then)
 * An input frame packs as [moveX, moveZ, aimX, aimZ, buttons].
 */
import { isCharacterId, type CharacterId } from "shared/characters";
import { MAX_PARTY_SIZE, type InputFrame } from "shared/sim";
import {
	ROLLBACK_DEVICE_CLASSES,
	ROLLBACK_GUESS_STRATEGIES,
	ROLLBACK_PROBE_LIMITS,
	ROLLBACK_PROBE_MODES,
	isRollbackKeyId,
	readLiveSummary,
	readProbeSummary,
	type LiveSummary,
	type ProbeSummary,
	type RollbackDeviceClass,
	type RollbackGuessStrategy,
	type RollbackProbeMode,
} from "shared/spikes";
import { ROLLBACK_SPIKE } from "../config";

/** Message topics / object names (the Actor's SendMessage topic, the reply BindableEvent's name). */
export const ROLLBACK_WORKER_TOPIC = {
	toWorker: "kv.rollback.toWorker",
	facts: "kv.rollback.facts",
	replyEventName: "KV_RollbackReply",
} as const;

/** Numbers per packed input frame. */
export const PACKED_INPUT_FIELDS = 5;
const MAX_WORLD_KIND_CHARS = 32;
const MAX_ERROR_CHARS = 400;
const MAX_HASH_CHARS = 64;
const MAX_SEED = 2 ** 32 - 1;
const MAX_TICK = 2 ** 31;
const MAX_FRAME_MS = 100000;
const MAX_DEV_FLOOR = 999;

/** The dev world's run options (shared/run DevRunOptions, as plain data). */
export interface RollbackDevOptions {
	readonly startFloor: number;
	readonly invulnerable: boolean;
	readonly vault?: { readonly every?: boolean; readonly tier?: number; readonly lock?: number };
	/** docs/ARCHER.md AR4: the dev panel's "Both weapons" (DevRunOptions.bothWeapons). */
	readonly bothWeapons?: boolean;
}

export interface RollbackSetupMsg {
	readonly kind: "setup";
	readonly sessionId: string;
	readonly mode: RollbackProbeMode;
	/** H: ticks each CPU prediction steps. */
	readonly horizon: number;
	readonly worldKind: string;
	readonly seed: number;
	readonly partySize: number;
	readonly localIndex: number;
	/** A party run (LockstepClient; built with `partySize`), else a solo LiveRun (built without it). */
	readonly coop: boolean;
	readonly atBossDoor: boolean;
	/** KV_Scoring on a non-endless solo world (the run's config gains `scoring: {}`). */
	readonly scoring: boolean;
	/** KV_Stress bullets (0 = off). */
	readonly stress: number;
	readonly dev?: RollbackDevOptions;
	/**
	 * docs/ARCHER.md AR5: every player's character in index order, as the main client built its run (RunSetup.characters);
	 * absent for a world without characters. The mirror passes it to buildWorldSetup, or its hashes would differ.
	 */
	readonly characters?: ReadonlyArray<CharacterId>;
	/** Run the live model (Design 7): co-op parallel only. */
	readonly live: boolean;
	readonly strategy: RollbackGuessStrategy;
	/** Serial mode: no mirror; the main thread lends its state (RollbackWorkerCore.lend) before each frame's pump. */
	readonly borrowed: boolean;
	readonly deviceLabel: string;
	readonly deviceClass: RollbackDeviceClass;
	readonly native: boolean;
}

export interface RollbackFramesMsg {
	readonly kind: "frames";
	/** The main state's tick (the confirmed tick T) when the message was built. */
	readonly tick: number;
	/** The rendered frame's length, ms (the window's fps and frame p95). */
	readonly frameMs: number;
	readonly truthFirst: number;
	/** partySize x PACKED_INPUT_FIELDS numbers per tick, ticks truthFirst.. in order. */
	readonly truth: ReadonlyArray<number>;
	readonly ownFirst: number;
	/** PACKED_INPUT_FIELDS numbers per tick, ticks ownFirst.. in order. */
	readonly own: ReadonlyArray<number>;
	/** The main state's hash was taken at this tick (= `tick`): answer with the mirror's; -1 none. */
	readonly hashTick: number;
}

export interface RollbackControlMsg {
	readonly kind: "control";
	readonly op: "stop" | "end";
	/** `end`: the mirror's last tick. */
	readonly tick: number;
}

export type RollbackMainToWorker = RollbackSetupMsg | RollbackFramesMsg | RollbackControlMsg;

export interface RollbackStatusMsg {
	readonly kind: "status";
	/** The confirmed state's tick (the mirror's, or the lent state's). */
	readonly tick: number;
	/** The last prediction's total ms and frames from its start to its end. */
	readonly totalMs: number;
	readonly framesPerPrediction: number;
	/** Predictions in the current CPU window, live frames in the current live window. */
	readonly samples: number;
	readonly liveFrames: number;
	/** Hash checks answered so far. */
	readonly hashes: number;
}

export interface RollbackDigestMsg {
	readonly kind: "digest";
	/** os.clock() when it was sent (the main thread's arrival minus this: the send's latency). */
	readonly sentAt: number;
	readonly data: buffer;
}

export type RollbackWorkerToMain =
	| { readonly kind: "cpu"; readonly summary: ProbeSummary }
	| { readonly kind: "live"; readonly summary: LiveSummary }
	| { readonly kind: "mirrorHash"; readonly tick: number; readonly hash: string }
	| RollbackStatusMsg
	| RollbackDigestMsg
	| { readonly kind: "error"; readonly message: string }
	| { readonly kind: "ready" };

// ---------------------------------------------------------------------------------------------
// Packing

/** Appends `f` packed to `out`. */
export function packInput(f: Readonly<InputFrame>, out: number[]): void {
	out.push(f.moveX, f.moveZ, f.aimX, f.aimZ, f.buttons);
}

/** The frame packed at `offset` (0-based index into `arr`) into `out`. */
export function unpackInput(arr: ReadonlyArray<number>, offset: number, out: InputFrame): InputFrame {
	out.moveX = arr[offset];
	out.moveZ = arr[offset + 1];
	out.aimX = arr[offset + 2];
	out.aimZ = arr[offset + 3];
	out.buttons = arr[offset + 4];
	return out;
}

// ---------------------------------------------------------------------------------------------
// Validators

function asTable(v: unknown): Record<string, unknown> | undefined {
	return typeIs(v, "table") ? (v as Record<string, unknown>) : undefined;
}

function finite(v: unknown, min: number, max: number): number | undefined {
	if (!typeIs(v, "number") || v !== v || v < min || v > max) return undefined;
	return v;
}

function int(v: unknown, min: number, max: number): number | undefined {
	const n = finite(v, min, max);
	return n !== undefined && n % 1 === 0 ? n : undefined;
}

function oneOf<T extends string>(v: unknown, list: ReadonlyArray<T>): T | undefined {
	return typeIs(v, "string") && (list as ReadonlyArray<string>).includes(v) ? (v as T) : undefined;
}

function shortString(v: unknown, max: number): string | undefined {
	return typeIs(v, "string") && v.size() <= max ? v : undefined;
}

/**
 * A packed frame list: an array of finite numbers whose size is a multiple of `width` x PACKED_INPUT_FIELDS, at most
 * maxTicksPerMessage ticks, buttons non-negative integers. A copy, or undefined.
 */
function packedFrames(v: unknown, width: number): number[] | undefined {
	if (!typeIs(v, "table")) return undefined;
	const arr = v as ReadonlyArray<unknown>;
	const n = arr.size();
	const per = width * PACKED_INPUT_FIELDS;
	if (n % per !== 0 || n / per > ROLLBACK_SPIKE.probe.maxTicksPerMessage) return undefined;
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const x = arr[i];
		if (!typeIs(x, "number") || x !== x || x === math.huge || x === -math.huge) return undefined;
		if (i % PACKED_INPUT_FIELDS === PACKED_INPUT_FIELDS - 1 && (x < 0 || x % 1 !== 0)) return undefined;
		out.push(x);
	}
	return out;
}

function readDev(v: unknown): RollbackDevOptions | undefined | false {
	if (v === undefined) return undefined;
	const t = asTable(v);
	if (t === undefined) return false;
	const startFloor = int(t.startFloor, 1, MAX_DEV_FLOOR);
	if (startFloor === undefined || !typeIs(t.invulnerable, "boolean")) return false;
	if (t.bothWeapons !== undefined && !typeIs(t.bothWeapons, "boolean")) return false;
	const bothWeapons = t.bothWeapons === true ? true : undefined;
	if (t.vault === undefined) return { startFloor, invulnerable: t.invulnerable, bothWeapons };
	const vt = asTable(t.vault);
	if (vt === undefined) return false;
	const vault: { every?: boolean; tier?: number; lock?: number } = {};
	if (vt.every !== undefined) {
		if (!typeIs(vt.every, "boolean")) return false;
		vault.every = vt.every;
	}
	if (vt.tier !== undefined) {
		const tier = int(vt.tier, 0, MAX_DEV_FLOOR);
		if (tier === undefined) return false;
		vault.tier = tier;
	}
	if (vt.lock !== undefined) {
		const lock = int(vt.lock, 0, MAX_DEV_FLOOR);
		if (lock === undefined) return false;
		vault.lock = lock;
	}
	return { startFloor, invulnerable: t.invulnerable, vault, bothWeapons };
}

/** The setup's character list: absent, or 1..partySize valid character ids (false: malformed). */
function readCharacters(v: unknown, partySize: number): ReadonlyArray<CharacterId> | undefined | false {
	if (v === undefined) return undefined;
	if (!typeIs(v, "table")) return false;
	const list = v as ReadonlyArray<unknown>;
	const n = list.size();
	if (n < 1 || n > partySize) return false;
	const out: CharacterId[] = [];
	for (let i = 0; i < n; i++) {
		const c = list[i];
		if (!isCharacterId(c)) return false;
		out.push(c);
	}
	return out;
}

function readSetup(t: Record<string, unknown>): RollbackSetupMsg | undefined {
	const L = ROLLBACK_PROBE_LIMITS;
	if (!isRollbackKeyId(t.sessionId, L.maxSessionIdChars)) return undefined;
	const mode = oneOf(t.mode, ROLLBACK_PROBE_MODES);
	const horizon = int(t.horizon, 1, L.maxHorizon);
	const worldKind = shortString(t.worldKind, MAX_WORLD_KIND_CHARS);
	const seed = int(t.seed, 0, MAX_SEED);
	const partySize = int(t.partySize, 1, MAX_PARTY_SIZE);
	if (mode === undefined || horizon === undefined || worldKind === undefined || seed === undefined) return undefined;
	if (partySize === undefined) return undefined;
	const localIndex = int(t.localIndex, 0, partySize - 1);
	const stress = int(t.stress, 0, L.maxBullets);
	const strategy = oneOf(t.strategy, ROLLBACK_GUESS_STRATEGIES);
	const deviceClass = oneOf(t.deviceClass, ROLLBACK_DEVICE_CLASSES);
	const deviceLabel = shortString(t.deviceLabel, L.maxDeviceLabelChars);
	if (localIndex === undefined || stress === undefined || strategy === undefined) return undefined;
	if (deviceClass === undefined || deviceLabel === undefined) return undefined;
	if (!typeIs(t.atBossDoor, "boolean") || !typeIs(t.scoring, "boolean") || !typeIs(t.live, "boolean"))
		return undefined;
	if (!typeIs(t.borrowed, "boolean") || !typeIs(t.native, "boolean") || !typeIs(t.coop, "boolean")) return undefined;
	const dev = readDev(t.dev);
	if (dev === false) return undefined;
	const characters = readCharacters(t.characters, partySize);
	if (characters === false) return undefined;
	return {
		kind: "setup",
		sessionId: t.sessionId,
		mode,
		horizon,
		worldKind,
		seed,
		partySize,
		localIndex,
		coop: t.coop,
		atBossDoor: t.atBossDoor,
		scoring: t.scoring,
		stress,
		dev,
		characters,
		live: t.live,
		strategy,
		borrowed: t.borrowed,
		deviceLabel,
		deviceClass,
		native: t.native,
	};
}

/**
 * A frames message re-read. `partySize` is the setup's (the merged frames' width); undefined before a setup (every
 * frames message is then dropped).
 */
function readFrames(t: Record<string, unknown>, partySize: number | undefined): RollbackFramesMsg | undefined {
	if (partySize === undefined) return undefined;
	const tick = int(t.tick, 0, MAX_TICK);
	const frameMs = finite(t.frameMs, 0, MAX_FRAME_MS);
	const truthFirst = int(t.truthFirst, 0, MAX_TICK);
	const ownFirst = int(t.ownFirst, 0, MAX_TICK);
	const hashTick = int(t.hashTick, -1, MAX_TICK);
	if (tick === undefined || frameMs === undefined || truthFirst === undefined || ownFirst === undefined) {
		return undefined;
	}
	if (hashTick === undefined) return undefined;
	const truth = packedFrames(t.truth, partySize);
	const own = packedFrames(t.own, 1);
	if (truth === undefined || own === undefined) return undefined;
	return { kind: "frames", tick, frameMs, truthFirst, truth, ownFirst, own, hashTick };
}

/**
 * A main -> worker message re-read, or undefined. `partySize`: the current setup's (frames messages need it; pass
 * undefined before a setup).
 */
export function readMainToWorker(v: unknown, partySize: number | undefined): RollbackMainToWorker | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	if (t.kind === "setup") return readSetup(t);
	if (t.kind === "frames") return readFrames(t, partySize);
	if (t.kind === "control") {
		const op = oneOf(t.op, ["stop", "end"] as const);
		const tick = int(t.tick, 0, MAX_TICK);
		if (op === undefined || tick === undefined) return undefined;
		return { kind: "control", op, tick };
	}
	return undefined;
}

/** A worker -> main message re-read, or undefined (summaries through the server's own readers). */
export function readWorkerToMain(v: unknown): RollbackWorkerToMain | undefined {
	const t = asTable(v);
	if (t === undefined) return undefined;
	if (t.kind === "cpu") {
		const summary = readProbeSummary(t.summary);
		return summary !== undefined ? { kind: "cpu", summary } : undefined;
	}
	if (t.kind === "live") {
		const summary = readLiveSummary(t.summary);
		return summary !== undefined ? { kind: "live", summary } : undefined;
	}
	if (t.kind === "mirrorHash") {
		const tick = int(t.tick, 0, MAX_TICK);
		const hash = shortString(t.hash, MAX_HASH_CHARS);
		return tick !== undefined && hash !== undefined ? { kind: "mirrorHash", tick, hash } : undefined;
	}
	if (t.kind === "status") {
		const L = ROLLBACK_PROBE_LIMITS;
		const tick = int(t.tick, 0, MAX_TICK);
		const totalMs = finite(t.totalMs, 0, L.maxMs);
		const fpp = int(t.framesPerPrediction, 0, L.maxFrames);
		const samples = int(t.samples, 0, L.maxSamples);
		const liveFrames = int(t.liveFrames, 0, L.maxSamples);
		const hashes = int(t.hashes, 0, L.maxSamples);
		if (tick === undefined || totalMs === undefined || fpp === undefined || samples === undefined) return undefined;
		if (liveFrames === undefined || hashes === undefined) return undefined;
		return { kind: "status", tick, totalMs, framesPerPrediction: fpp, samples, liveFrames, hashes };
	}
	if (t.kind === "digest") {
		const sentAt = finite(t.sentAt, 0, math.huge - 1);
		if (sentAt === undefined || !typeIs(t.data, "buffer")) return undefined;
		return { kind: "digest", sentAt, data: t.data };
	}
	if (t.kind === "ready") return { kind: "ready" };
	if (t.kind === "error") {
		const message = typeIs(t.message, "string") ? t.message.sub(1, MAX_ERROR_CHARS) : undefined;
		return message !== undefined ? { kind: "error", message } : undefined;
	}
	return undefined;
}
