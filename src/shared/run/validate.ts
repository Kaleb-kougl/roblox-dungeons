/**
 * Server-side run validation by replay (PLAN.md task 9). The client plays the run with the deterministic sim and, at
 * the end, submits seed + spawn flag + its input recording + the hash and summary it claims. The server rebuilds the
 * world from the seed alone, replays the recording, and accepts the run only if the replay's `hashState` equals the
 * claim. The summary it reports is recomputed from its own replay; the client's summary is only compared.
 *
 * Pure and Roblox-API-free (headless tests run it on the golden fixtures). Every failure, including errors thrown by
 * the sim (e.g. a path still marked `TODO(task N)`), comes back as `{ ok: false, reason }`; validateRun never throws.
 * docs/SERVER.md has the flow, the limits and what this does NOT prevent.
 *
 * @module
 */
import { isCharacterId } from "shared/characters";
import {
	Button,
	PORT_BUTTONS,
	decodeRecording,
	hashState,
	isPartyWiped,
	type Recording,
	type SimState,
	runStartHalfHearts,
} from "shared/sim";
import { buildRunConfig, isValidRunSeed, type RunSetup } from "./config";
import { DEFAULT_RUN_LIMITS, MAX_CHARACTER_ID_CHARS, MAX_REJECT_REASON_CHARS, type RunLimits } from "./limits";
import { replayObserved, type ReplayHooks } from "./replay";
import { RunTelemetry, type RunTelemetryRecord } from "./telemetry";

/** What the client claims about its finished run. Recomputed by the server, never trusted. */
export interface RunSummary {
	/** Sim ticks in the run (= recording frames). */
	ticks: number;
	/** Enemies killed (sum of events.enemiesKilled). */
	kills: number;
	/** A boss died during the run. */
	bossDefeated: boolean;
	/** The player died during the run. */
	died: boolean;
}

/** One finished run, as the client sends it (shared/network.ts `submitRun`). */
export interface RunSubmission {
	/** The run's seed (also inside the recording; both must agree). */
	seed: number;
	/** The run started at the boss door (debug `?spawn=boss`); rejected unless the limits allow it. */
	atBossDoor: boolean;
	/**
	 * encodeRecording() of the whole run (shared/sim recordingCodec.ts): the compact binary form, never the JSON one.
	 */
	recording: buffer;
	/** hashState() of the client's final state (8 lowercase hex digits). */
	claimedHash: string;
	claimed: RunSummary;
	/**
	 * docs/ARCHER.md AR5: the character the run was built with (shared/characters CharacterId; the client sends its
	 * run's RunSetup.characters[0]). The replay's world is built with it (worlds with characters: endless). Absent: the
	 * world as built without characters (endless: both weapons, every recording tool's config). Unknown:
	 * `bad_submission`.
	 */
	characterId?: string;
}

/** Why a run was rejected: a small, fixed set (analytics breakdowns need bounded values). */
export type RunRejectCode =
	| "bad_submission"
	| "too_large"
	| "too_long"
	| "malformed"
	| "seed_mismatch"
	| "debug_input"
	| "debug_spawn"
	| "config_error"
	| "spawn_mismatch"
	| "replay_error"
	| "hash_mismatch"
	| "summary_mismatch";

export interface RunValidation {
	ok: boolean;
	/** Human-readable reason when rejected. */
	reason?: string;
	code?: RunRejectCode;
	/** hashState of the server's replay ("" when rejected before replaying). */
	serverHash: string;
	/** Summary of the server's replay (zeros when rejected before replaying). */
	summary: RunSummary;
	/** Telemetry of the server's replay (undefined when rejected before replaying). */
	telemetry?: RunTelemetryRecord;
}

export interface ValidateOptions {
	/** Checkpoint hook for long replays (the server checks its time budget there and yields). */
	hooks?: ReplayHooks;
	/** Archetype index -> id for telemetry (default: the sim registry). */
	archetypeNames?: ReadonlyArray<string>;
}

const EMPTY_SUMMARY: Readonly<RunSummary> = table.freeze({ ticks: 0, kills: 0, bossDefeated: false, died: false });
const HASH_PATTERN = "^%x%x%x%x%x%x%x%x$";

/** An 8-hex-digit state hash (hashState's format). */
export function isStateHash(v: unknown): v is string {
	return typeIs(v, "string") && string.match(v, HASH_PATTERN)[0] !== undefined;
}
/** Every debug bit: K, J and the port's endless floor skip (PORT_BUTTONS = DEBUG_FLOOR_BUTTON). */
const DEBUG_BUTTONS = bit32.bor(Button.DEBUG_HIT, Button.DEBUG_BOSS, PORT_BUTTONS);
const ELLIPSIS = "...";

/**
 * A reject reason cut to MAX_REJECT_REASON_CHARS (ending in "..." when cut). Every reason a client can influence
 * (sim errors, decoder messages) passes through here before it reaches a log, analytics or the client.
 */
export function truncateReason(reason: string): string {
	if (reason.size() <= MAX_REJECT_REASON_CHARS) return reason;
	return reason.sub(1, MAX_REJECT_REASON_CHARS - ELLIPSIS.size()) + ELLIPSIS;
}

function reject(code: RunRejectCode, reason: string, partial?: Partial<RunValidation>): RunValidation {
	return {
		ok: false,
		code,
		reason: truncateReason(reason),
		serverHash: partial?.serverHash ?? "",
		summary: partial?.summary ?? { ...EMPTY_SUMMARY },
		telemetry: partial?.telemetry,
	};
}

/** The message of a caught error, without the `file:line:` prefix Luau adds to `error(string)`. */
export function errorMessage(err: unknown): string {
	const text = tostring(err);
	const [stripped] = string.gsub(text, "^[^\n]-:%d+: ", "");
	return stripped;
}

/** A finite number (not NaN or +/-inf). */
export function isFiniteValue(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
}

/**
 * Largest |UserId| accepted from the wire or a report (2^53 - 1: every integer up to it is exact in a float64), so a
 * forged 1e300 never reaches `Players:GetPlayerByUserId` in a flush. Negative ids stay valid (Studio test players).
 */
export const MAX_USER_ID_MAGNITUDE = 2 ** 53 - 1;

/** A UserId as the wire carries it: a nonzero integer of magnitude at most MAX_USER_ID_MAGNITUDE. */
export function isWireUserId(v: unknown): v is number {
	return isFiniteValue(v) && v % 1 === 0 && v !== 0 && math.abs(v) <= MAX_USER_ID_MAGNITUDE;
}

/** Shape check of a submission that came over the wire (Flamework's guard checks types; this checks values). */
function checkShape(s: RunSubmission): string | undefined {
	if (!typeIs(s, "table")) return "submission is not an object";
	if (!isValidRunSeed(s.seed)) return "seed must be an integer in [0, 2^32)";
	if (!typeIs(s.atBossDoor, "boolean")) return "atBossDoor must be a boolean";
	if (!typeIs(s.recording, "buffer")) return "recording must be a buffer";
	if (!isStateHash(s.claimedHash)) return "claimedHash must be 8 hex digits";
	const c = s.claimed;
	if (!typeIs(c, "table")) return "claimed summary missing";
	if (!isFiniteValue(c.ticks) || !isFiniteValue(c.kills)) return "claimed ticks / kills must be numbers";
	if (!typeIs(c.bossDefeated, "boolean") || !typeIs(c.died, "boolean")) return "claimed flags must be booleans";
	const id = s.characterId;
	if (id !== undefined && (!typeIs(id, "string") || id.size() > MAX_CHARACTER_ID_CHARS)) {
		return "characterId must be a short string";
	}
	if (id !== undefined && !isCharacterId(id)) return `unknown character ${id}`;
	return undefined;
}

/**
 * The first tick whose input has a debug button bit (DEBUG_HIT / DEBUG_BOSS / DEBUG_FLOOR_BUTTON), or undefined.
 * Co-op recordings: in any player's stream.
 */
export function hasDebugInput(recording: Readonly<Recording>): number | undefined {
	let first = firstDebugFrame(recording.frames);
	const others = recording.others;
	if (others !== undefined) {
		for (const stream of others) {
			const t = firstDebugFrame(stream);
			if (t !== undefined && (first === undefined || t < first)) first = t;
		}
	}
	return first;
}

function firstDebugFrame(frames: ReadonlyArray<{ buttons: number }>): number | undefined {
	for (let i = 0; i < frames.size(); i++) if (bit32.band(frames[i].buttons, DEBUG_BUTTONS) !== 0) return i;
	return undefined;
}

/** The run summary of a replayed state and its telemetry (what the server reports; the claim is only compared). */
export function summarizeRun(state: Readonly<SimState>, telemetry: Readonly<RunTelemetryRecord>): RunSummary {
	return {
		ticks: state.tick,
		kills: telemetry.kills,
		bossDefeated: telemetry.bossDefeated,
		// Co-op: the run "died" when the whole party is down (one member's death does not end it).
		died:
			state.party !== undefined
				? isPartyWiped(state)
				: telemetry.deathTick !== undefined || state.player.dead !== 0,
	};
}

/** The first field where a claimed summary differs from the replay's, as a reason, or undefined when they agree. */
export function summaryDiff(claimed: Readonly<RunSummary>, actual: Readonly<RunSummary>): string | undefined {
	if (claimed.ticks !== actual.ticks) return `ticks claimed ${claimed.ticks}, replay ${actual.ticks}`;
	if (claimed.kills !== actual.kills) return `kills claimed ${claimed.kills}, replay ${actual.kills}`;
	if (claimed.bossDefeated !== actual.bossDefeated) {
		return `bossDefeated claimed ${claimed.bossDefeated}, replay ${actual.bossDefeated}`;
	}
	if (claimed.died !== actual.died) return `died claimed ${claimed.died}, replay ${actual.died}`;
	return undefined;
}

/** Why the recording's spawn is not the run's (undefined when it is). */
export function spawnProblem(recording: Readonly<Recording>, setup: Readonly<RunSetup>): string | undefined {
	const s = recording.spawn;
	const want = setup.spawn;
	if (want !== undefined) {
		if (s.x !== want.x || s.z !== want.z)
			return `spawn (${s.x}, ${s.z}) is not the run's spawn (${want.x}, ${want.z})`;
		return undefined;
	}
	const b = setup.config.bounds;
	if (b && (s.x < b.minX || s.x > b.maxX || s.z < b.minZ || s.z > b.maxZ)) {
		return `spawn (${s.x}, ${s.z}) is outside the arena`;
	}
	return undefined;
}

/**
 * Validates one submitted run (see the file comment). Order: shape, size, tick bound (before expanding frames),
 * decode, seed, debug input, debug spawn, world rebuild, spawn, replay, hash, summary.
 */
export function validateRun(
	submission: RunSubmission,
	limits: RunLimits = DEFAULT_RUN_LIMITS,
	options: ValidateOptions = {},
): RunValidation {
	const shape = checkShape(submission);
	if (shape !== undefined) return reject("bad_submission", `bad submission: ${shape}`);

	// Size cap, then the frame count against maxTicks, both before a single frame is built (recordingCodec.ts).
	const decoded = decodeRecording(submission.recording, limits);
	if (!decoded.ok) return reject(decoded.code, decoded.reason);
	const recording: Recording = decoded.recording;
	if (recording.others !== undefined) {
		return reject("malformed", "malformed recording: party recordings are validated from the server's own log");
	}

	if (recording.seed !== submission.seed) {
		return reject("seed_mismatch", `seed mismatch: submitted ${submission.seed}, recording ${recording.seed}`);
	}
	const debugFrame = hasDebugInput(recording);
	if (debugFrame !== undefined && !limits.allowDebugInput) {
		return reject("debug_input", `debug input: debug button bits at tick ${debugFrame}`);
	}
	if (submission.atBossDoor && !limits.allowBossDoorSpawn) {
		return reject("debug_spawn", "debug spawn: runs from the boss door are not accepted");
	}

	const characterId = submission.characterId;
	const [setupOk, setupOrErr] = pcall(() =>
		buildRunConfig(submission.seed, {
			atBossDoor: submission.atBossDoor,
			world: limits.world,
			characters: characterId !== undefined && isCharacterId(characterId) ? [characterId] : undefined,
		}),
	);
	if (!setupOk) return reject("config_error", `config error: ${errorMessage(setupOrErr)}`);
	const setup = setupOrErr as RunSetup;
	const badSpawn = spawnProblem(recording, setup);
	if (badSpawn !== undefined) return reject("spawn_mismatch", `spawn mismatch: ${badSpawn}`);

	const [replayOk, replayed] = pcall(() => {
		const telemetry = new RunTelemetry(
			runStartHalfHearts(setup.config),
			options.archetypeNames,
			setup.characters?.[0],
		);
		const state = replayObserved(recording, setup.config, (s) => telemetry.observe(s), options.hooks);
		return { state, telemetry: telemetry.finish() };
	});
	if (!replayOk) return reject("replay_error", `replay error: ${errorMessage(replayed)}`);
	const { state, telemetry } = replayed as { state: SimState; telemetry: RunTelemetryRecord };

	const serverHash = hashState(state);
	const summary = summarizeRun(state, telemetry);
	const done = { serverHash, summary, telemetry };
	if (serverHash !== submission.claimedHash) {
		return reject("hash_mismatch", `hash mismatch: claimed ${submission.claimedHash}, replay ${serverHash}`, done);
	}
	const diff = summaryDiff(submission.claimed, summary);
	if (diff !== undefined) return reject("summary_mismatch", `summary mismatch: ${diff}`, done);
	return { ok: true, serverHash, summary, telemetry };
}
