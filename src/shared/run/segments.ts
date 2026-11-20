/**
 * Segmented run validation (M3 / M5): the server keeps its OWN SimState per active run and advances it segment by
 * segment while the run is still being played, instead of replaying one whole recording at the end. Endless runs can
 * then last far longer than MAX_RUN_TICKS, and every leaderboard score comes from a state the server reproduced.
 *
 * Protocol (docs/SERVER.md "Segmented runs"):
 *
 *   startRun     -> the server picks the seed and creates the session (runSessions.ts), building the world with
 *                   the world registry (worlds.ts). The validator below is that session's replay.
 *   segment k    -> { runId, index k, startTick, recording, claimedEndHash, checkpointHashes }: the input frames of
 *                   ticks [startTick, endTick), as an ordinary binary recording (shared/sim recordingCodec.ts: same
 *                   seed and spawn header, frames = the slice; its delta coding restarts at each segment).
 *                   Indices are 0, 1, 2, ... and ticks contiguous (startTick = previous endTick).
 *   final        -> { runId, finalTick, claimedHash, claimed summary incl. score and floor }.
 *
 * A segment is checked cheaply on arrival (`offer`: order, contiguity, caps, decode, debug bits, clock), queued, and
 * replayed later in budgeted slices (`advance`), on the one live state: cloneSimState throws once bullets exist, so
 * the server can never rewind; every check happens on the way forward. The first problem rejects the whole run and
 * frees its state. A replay mismatch is located to segment k and, with the checkpoint hashes, to a window of
 * SEGMENT_CHECKPOINT_TICKS ticks (`matchedThroughTick` .. `mismatchAtTick`).
 *
 * Co-op party runs (M4): the segments come from the SERVER's own merged lockstep log (shared/lockstep PartyRunLog), not
 * from a client; their recordings are the codec's party variant (one stream per player) and replay with stepParty.
 * The recording's player count must be the run config's (`party.size`), and the byte cap scales with it.
 *
 * Pure and Roblox-API-free: time is passed in (`now`, seconds, any monotonic clock), the budget arrives through
 * ReplayHooks (the server's ReplayBudget yields there), the score through an injectable reader (score.ts).
 *
 * @module
 */
import {
	SIM_HZ,
	configPartySize,
	createSimState,
	decodeRecording,
	hashState,
	recordingPartySize,
	stepRecorded,
	type Recording,
	type SimState,
	runStartHalfHearts,
} from "shared/sim";
import { runSilver, silverRunInputOf, type RunSilver } from "shared/silver";
import type { RunSetup } from "./config";
import { DEFAULT_SEGMENT_LIMITS, MAX_RUN_ID_CHARS, type SegmentLimits } from "./limits";
import type { ReplayHooks } from "./replay";
import { DEFAULT_RUN_SCORE, readRunScore, type RunScore, type RunScoreReader } from "./score";
import { RunTelemetry, type RunTelemetryRecord } from "./telemetry";
import {
	errorMessage,
	hasDebugInput,
	isFiniteValue,
	isStateHash,
	spawnProblem,
	summarizeRun,
	summaryDiff,
	truncateReason,
	type RunSummary,
} from "./validate";

/** One segment of a live run, as the client uploads it (shared/network `submitSegment`). */
export interface RunSegment {
	runId: string;
	/** 0 for the first segment, then +1 each. */
	index: number;
	/** The run tick this segment starts at (= the previous segment's end tick; 0 for the first). */
	startTick: number;
	/**
	 * encodeRecording({ seed, spawn, frames }) where frames are the run's input for ticks [startTick, endTick).
	 * The header's seed and spawn are the run's; endTick = startTick + the frame count.
	 */
	recording: buffer;
	/** hashState() after tick endTick (8 lowercase hex digits). */
	claimedEndHash: string;
	/**
	 * hashState() after every tick T with startTick < T < endTick and T % SEGMENT_CHECKPOINT_TICKS === 0, in order
	 * (exactly that many). Lets the server locate a mismatch inside the segment.
	 */
	checkpointHashes: string[];
}

/** The client's claim about its finished run: the replay summary plus the score. Only compared, never trusted. */
export interface FinalRunSummary extends RunSummary {
	score: number;
	floor: number;
}

/** The end of a segmented run (shared/network `finishRun`), sent after its last segment. */
export interface RunFinal {
	runId: string;
	/** The run's last tick (= the last segment's end tick). */
	finalTick: number;
	/** hashState() of the final state (= the last segment's claimedEndHash). */
	claimedHash: string;
	claimed: FinalRunSummary;
}

/** Why a segment or a segmented run was rejected: a small fixed set (analytics breakdowns need bounded values). */
export type SegmentRejectCode =
	// segment shape and protocol
	| "bad_segment"
	| "out_of_order"
	| "tick_gap"
	| "segment_too_large"
	| "segment_too_long"
	| "malformed"
	| "empty_segment"
	| "seed_mismatch"
	| "spawn_mismatch"
	| "run_too_long"
	| "debug_input"
	| "clock_ahead"
	| "backlog_full"
	// the run is not taking segments
	| "run_rejected"
	| "run_closed"
	// replay
	| "replay_error"
	| "hash_mismatch"
	// final
	| "bad_final"
	| "empty_run"
	| "final_tick_mismatch"
	| "summary_mismatch"
	| "score_mismatch"
	// session (runSessions.ts / the service)
	| "unknown_run"
	| "expired"
	| "abandoned"
	| "rate_limited"
	// co-op lockstep (shared/lockstep session.ts): the clients' hashes or final claims disagree
	| "desync";

/** The verdict on one segment (shared/network `segmentVerdict`). */
export interface SegmentVerdict {
	runId: string;
	index: number;
	ok: boolean;
	code?: SegmentRejectCode;
	reason?: string;
	startTick: number;
	endTick: number;
	/** hashState after the segment's replay ("" when it was not replayed to its end). */
	serverHash: string;
	/** On a replay mismatch: the last tick known to match (a checkpoint or the segment start). */
	matchedThroughTick?: number;
	/** On a replay mismatch: the first tick known to differ (a checkpoint or the segment end). */
	mismatchAtTick?: number;
}

/**
 * Where a segmented run stands on the server: `open` (taking segments), `finishing` (the final submit arrived, queued
 * segments are still being replayed), then `accepted` or `rejected` for good. A run that is not `open` refuses further
 * segments.
 */
export type SegmentedRunStatus = "open" | "finishing" | "accepted" | "rejected";

/** The verdict on a whole segmented run. Every number is the server's replay; the claim was only compared. */
export interface SegmentedRunResult {
	runId: string;
	ok: boolean;
	code?: SegmentRejectCode;
	reason?: string;
	/** The segment that failed (rejections during a segment). */
	failedSegment?: number;
	matchedThroughTick?: number;
	mismatchAtTick?: number;
	/** Ticks the server replayed and verified. */
	verifiedTicks: number;
	/** hashState of the final replayed state ("" unless the run reached its final check). */
	serverHash: string;
	summary: RunSummary;
	score: RunScore;
	/** Telemetry of the replay (accepted runs, and runs rejected at the final check). */
	telemetry?: RunTelemetryRecord;
	/**
	 * Endless runs: the tick whose step changed floor 1 -> 2 in the server's replay (undefined: never left floor 1).
	 * Co-op credit uses it (shared/leaderboard partyContributors: present through one full floor).
	 */
	firstFloorChangeTick?: number;
	/**
	 * Accepted runs only (docs/SILVER.md SV4, SVD28): the run's Silver rows read from the final replayed state
	 * (readSilver). Every world gets them; whether they pay is shared/silver silverEligibility's call at the grant.
	 * Undefined on every rejection.
	 */
	silver?: RunSilver;
}

/**
 * What `SegmentedValidator.offer` returns: the queued segment's index and tick range `[startTick, endTick)`, or the
 * verdict that rejected it (and with it the whole run).
 */
export type SegmentOffer =
	| { readonly ok: true; readonly index: number; readonly startTick: number; readonly endTick: number }
	| { readonly ok: false; readonly verdict: SegmentVerdict };

/**
 * What one `SegmentedValidator.advance` call did. `stepped` is 0 when nothing was queued, the run was already decided,
 * or the replay raised an error (which rejects the run and comes back as `result`).
 */
export interface AdvanceResult {
	/** Ticks stepped by this call. */
	readonly stepped: number;
	/** Segments finished (accepted or rejected) by this call, in order. */
	readonly verdicts: ReadonlyArray<SegmentVerdict>;
	/** The run's verdict, when this call decided it. */
	readonly result?: SegmentedRunResult;
}

/**
 * What a `SegmentedValidator` is created with: the run's identity and the world the server built for it. Run sessions
 * (runSessions.ts) fill it in at `startRun`; nothing here comes from the client.
 */
export interface SegmentedRunParams {
	readonly runId: string;
	readonly seed: number;
	/** The world registry kind the setup was built from (worlds.ts). */
	readonly worldKind: string;
	/** The run's world (built by the SERVER from the seed it picked). */
	readonly setup: RunSetup;
	/** Session start, on the same clock as every `now` passed later (seconds). */
	readonly createdAt: number;
	readonly limits?: SegmentLimits;
	/** Score of the final replayed state (default: score.ts readRunScore). */
	readonly readScore?: RunScoreReader;
	/** Archetype index -> id for telemetry (default: the sim registry). */
	readonly archetypeNames?: ReadonlyArray<string>;
}

interface PendingSegment {
	readonly index: number;
	readonly startTick: number;
	readonly endTick: number;
	/** The decoded slice (co-op: every player's stream). */
	readonly recording: Recording;
	/** Frames in the slice. */
	readonly frameCount: number;
	readonly claimedEndHash: string;
	readonly checkpoints: ReadonlyArray<string>;
	/** Frames stepped so far. */
	cursor: number;
	/** Next checkpoint hash to compare. */
	nextCheckpoint: number;
	/** The last tick known to match. */
	matchedThroughTick: number;
}

interface Mismatch {
	readonly tick: number;
	readonly claimed: string;
	readonly actual: string;
}

const EMPTY_SUMMARY: Readonly<RunSummary> = table.freeze({ ticks: 0, kills: 0, bossDefeated: false, died: false });

/**
 * The run's Silver rows from its final replayed state (docs/SILVER.md SV4): shared/silver runSilver over
 * silverRunInputOf, the summary's kills and the run config (a dev run's start floor and Depth). Read beside the score in
 * the validator's final check, so nothing keeps the replay state alive for the verdict.
 */
export function readSilver(
	state: Readonly<SimState>,
	summary: Readonly<RunSummary>,
	config: RunSetup["config"],
): RunSilver {
	return runSilver(silverRunInputOf(state, summary, config));
}

/** Multiples of `every` strictly between `startTick` and `endTick` (the checkpoint hashes a segment carries). */
export function checkpointCount(startTick: number, endTick: number, every: number): number {
	if (every <= 0 || endTick <= startTick + 1) return 0;
	return math.floor((endTick - 1) / every) - math.floor(startTick / every);
}

function isNonNegativeInteger(v: unknown): v is number {
	return isFiniteValue(v) && v >= 0 && math.floor(v) === v;
}

function isRunId(v: unknown): v is string {
	return typeIs(v, "string") && v.size() > 0 && v.size() <= MAX_RUN_ID_CHARS;
}

function segmentShape(s: RunSegment, limits: SegmentLimits): string | undefined {
	if (!typeIs(s, "table")) return "segment is not an object";
	if (!isRunId(s.runId)) return "runId must be a non-empty string";
	if (!isNonNegativeInteger(s.index)) return "index must be a non-negative integer";
	if (!isNonNegativeInteger(s.startTick)) return "startTick must be a non-negative integer";
	if (!typeIs(s.recording, "buffer")) return "recording must be a buffer";
	if (!isStateHash(s.claimedEndHash)) return "claimedEndHash must be 8 hex digits";
	const hashes = s.checkpointHashes;
	if (!typeIs(hashes, "table")) return "checkpointHashes must be an array";
	const most = checkpointCount(0, limits.maxSegmentTicks + 1, limits.checkpointEvery) + 1;
	const size = (hashes as unknown as ReadonlyArray<unknown>).size();
	if (size > most) return `more than ${most} checkpoint hashes`;
	for (let i = 0; i < size; i++) if (!isStateHash(hashes[i])) return `checkpoint hash ${i} must be 8 hex digits`;
	return undefined;
}

/**
 * Why a RunFinal is malformed (undefined when its shape is good): runId, finalTick (a non-negative integer: NaN, inf,
 * fractions and negatives are refused), the hash, and the claimed summary (ticks, kills, score, floor non-negative
 * integers; flags booleans). Used by finish() and by the co-op session before a claim is recorded.
 */
export function runFinalProblem(f: RunFinal): string | undefined {
	if (!typeIs(f, "table")) return "final is not an object";
	if (!isRunId(f.runId)) return "runId must be a non-empty string";
	if (!isNonNegativeInteger(f.finalTick)) return "finalTick must be a non-negative integer";
	if (!isStateHash(f.claimedHash)) return "claimedHash must be 8 hex digits";
	const c = f.claimed;
	if (!typeIs(c, "table")) return "claimed summary missing";
	if (!isNonNegativeInteger(c.ticks) || !isNonNegativeInteger(c.kills)) {
		return "claimed ticks / kills must be non-negative integers";
	}
	if (!typeIs(c.bossDefeated, "boolean") || !typeIs(c.died, "boolean")) return "claimed flags must be booleans";
	if (!isNonNegativeInteger(c.score) || !isNonNegativeInteger(c.floor)) {
		return "claimed score / floor must be non-negative integers";
	}
	return undefined;
}

/**
 * The server's replay of one segmented run (see the file comment). Never throws: every problem, including errors
 * raised inside the sim, becomes a rejection.
 *
 *   offer(segment, now)    cheap checks on arrival; queues the segment or rejects the run
 *   advance(ticks, hooks)  replays up to `ticks` queued ticks (stopping at the end of a segment), returns verdicts
 *   finish(final, now)     the client's final claim; decided at once if nothing is queued, else by advance
 *   abort(code, reason)    rejects the run from outside (expiry, the player left)
 */
export class SegmentedValidator {
	readonly runId: string;
	readonly seed: number;
	readonly worldKind: string;
	readonly createdAt: number;

	private readonly setup: RunSetup;
	private readonly limits: SegmentLimits;
	private readonly readScore: RunScoreReader;
	private readonly archetypeNames: ReadonlyArray<string> | undefined;
	private status: SegmentedRunStatus = "open";
	private state: SimState | undefined;
	private telemetry: RunTelemetry | undefined;
	private spawn: { x: number; z: number } | undefined;
	private nextIndex = 0;
	private nextTick = 0;
	private verified = 0;
	private pendingTicks = 0;
	private pending: PendingSegment[] = [];
	private final: RunFinal | undefined;
	private result: SegmentedRunResult | undefined;
	private firstFloorChange: number | undefined;

	constructor(params: SegmentedRunParams) {
		this.runId = params.runId;
		this.seed = params.seed;
		this.worldKind = params.worldKind;
		this.createdAt = params.createdAt;
		this.setup = params.setup;
		this.limits = params.limits ?? DEFAULT_SEGMENT_LIMITS;
		this.readScore = params.readScore ?? readRunScore;
		this.archetypeNames = params.archetypeNames;
		const s = params.setup.spawn;
		this.spawn = s !== undefined ? { x: s.x, z: s.z } : undefined;
	}

	getStatus(): SegmentedRunStatus {
		return this.status;
	}

	/** The run's verdict once decided (accepted or rejected). */
	getResult(): SegmentedRunResult | undefined {
		return this.result;
	}

	/** Ticks replayed and verified. */
	verifiedTicks(): number {
		return this.verified;
	}

	/** Ticks received (the next segment's startTick). */
	receivedTicks(): number {
		return this.nextTick;
	}

	/** The next segment index expected. */
	expectedIndex(): number {
		return this.nextIndex;
	}

	/** Received ticks not replayed yet. */
	pendingTickCount(): number {
		return this.pendingTicks;
	}

	/** Queued work to replay (advance makes progress). */
	hasWork(): boolean {
		return this.result === undefined && this.pending.size() > 0;
	}

	/** The run's spawn: the world's, or (worlds without a fixed spawn) the first segment's. */
	getSpawn(): { x: number; z: number } | undefined {
		return this.spawn !== undefined ? { ...this.spawn } : undefined;
	}

	/** Checks one segment on arrival and queues it; the first problem rejects the whole run. */
	offer(segment: RunSegment, now: number): SegmentOffer {
		const index = typeIs(segment, "table") && isNonNegativeInteger(segment.index) ? segment.index : -1;
		const startTick = typeIs(segment, "table") && isNonNegativeInteger(segment.startTick) ? segment.startTick : -1;
		if (this.status === "rejected") {
			return this.refuse(index, startTick, "run_rejected", "run already rejected", false);
		}
		if (this.status !== "open") return this.refuse(index, startTick, "run_closed", "run already finished", false);

		const shape = segmentShape(segment, this.limits);
		if (shape !== undefined) return this.refuse(index, startTick, "bad_segment", `bad segment: ${shape}`, true);
		if (segment.runId !== this.runId) {
			return this.refuse(index, startTick, "bad_segment", "bad segment: runId is not this run's", true);
		}
		if (segment.index !== this.nextIndex) {
			return this.refuse(
				index,
				startTick,
				"out_of_order",
				`out of order: segment ${segment.index}, expected ${this.nextIndex}`,
				true,
			);
		}
		if (segment.startTick !== this.nextTick) {
			return this.refuse(
				index,
				startTick,
				"tick_gap",
				`tick gap: segment starts at ${segment.startTick}, expected ${this.nextTick}`,
				true,
			);
		}

		const players = configPartySize(this.setup.config.party);
		const decoded = decodeRecording(segment.recording, {
			maxTicks: this.limits.maxSegmentTicks,
			maxRecordingBytes: this.limits.maxSegmentBytes * players,
		});
		if (!decoded.ok) {
			const code =
				decoded.code === "too_large"
					? "segment_too_large"
					: decoded.code === "too_long"
					? "segment_too_long"
					: "malformed";
			return this.refuse(index, startTick, code, `segment: ${decoded.reason}`, true);
		}
		const recording: Recording = decoded.recording;
		const n = recording.frames.size();
		const endTick = startTick + n;
		if (n === 0) return this.refuse(index, startTick, "empty_segment", "empty segment: no frames", true);
		if (recordingPartySize(recording) !== players) {
			return this.refuse(
				index,
				startTick,
				"malformed",
				`segment: ${recordingPartySize(recording)} player streams for a party of ${players}`,
				true,
			);
		}
		if (recording.seed !== this.seed) {
			return this.refuse(
				index,
				startTick,
				"seed_mismatch",
				`seed mismatch: run ${this.seed}, segment ${recording.seed}`,
				true,
			);
		}
		const badSpawn = this.spawnCheck(recording);
		if (badSpawn !== undefined) {
			return this.refuse(index, startTick, "spawn_mismatch", `spawn mismatch: ${badSpawn}`, true);
		}
		if (endTick > this.limits.maxRunTicks) {
			return this.refuse(
				index,
				startTick,
				"run_too_long",
				`run too long: ${endTick} ticks (max ${this.limits.maxRunTicks})`,
				true,
			);
		}
		const debugFrame = hasDebugInput(recording);
		if (debugFrame !== undefined && !this.limits.allowDebugInput) {
			return this.refuse(
				index,
				startTick,
				"debug_input",
				`debug input: debug button bits at tick ${startTick + debugFrame}`,
				true,
			);
		}
		const age = now - this.createdAt;
		if (endTick / SIM_HZ > age + this.limits.clockSlackSeconds) {
			return this.refuse(
				index,
				startTick,
				"clock_ahead",
				`clock ahead: ${endTick} ticks after ${math.floor(age)} s of session`,
				true,
			);
		}
		const want = checkpointCount(startTick, endTick, this.limits.checkpointEvery);
		if (segment.checkpointHashes.size() !== want) {
			return this.refuse(
				index,
				startTick,
				"bad_segment",
				`bad segment: ${segment.checkpointHashes.size()} checkpoint hashes, expected ${want}`,
				true,
			);
		}
		if (this.pendingTicks + n > this.limits.maxPendingTicks) {
			return this.refuse(
				index,
				startTick,
				"backlog_full",
				`backlog full: ${this.pendingTicks + n} ticks waiting (max ${this.limits.maxPendingTicks})`,
				true,
			);
		}

		if (this.spawn === undefined) this.spawn = { x: recording.spawn.x, z: recording.spawn.z };
		this.pending.push({
			index,
			startTick,
			endTick,
			recording,
			frameCount: n,
			claimedEndHash: segment.claimedEndHash,
			checkpoints: [...segment.checkpointHashes],
			cursor: 0,
			nextCheckpoint: 0,
			matchedThroughTick: startTick,
		});
		this.nextIndex++;
		this.nextTick = endTick;
		this.pendingTicks += n;
		return { ok: true, index, startTick, endTick };
	}

	/**
	 * The client's final claim. Returns the run's verdict when it can be decided now (nothing left to replay, or the
	 * claim is already wrong); otherwise the verdict comes from the advance call that replays the last tick.
	 */
	finish(final: RunFinal, now: number): SegmentedRunResult | undefined {
		if (this.result !== undefined) return this.result;
		if (this.status !== "open") return undefined; // a second finish while draining: the first one stands
		const shape = runFinalProblem(final);
		if (shape !== undefined) return this.rejectRun("bad_final", `bad final: ${shape}`);
		if (final.runId !== this.runId) return this.rejectRun("bad_final", "bad final: runId is not this run's");
		if (final.finalTick !== this.nextTick) {
			return this.rejectRun(
				"final_tick_mismatch",
				`final tick ${final.finalTick}, segments end at ${this.nextTick}`,
			);
		}
		if (this.nextTick === 0) return this.rejectRun("empty_run", "empty run: no segments");
		const age = now - this.createdAt;
		if (final.finalTick / SIM_HZ > age + this.limits.clockSlackSeconds) {
			return this.rejectRun("clock_ahead", `clock ahead: ${final.finalTick} ticks after ${math.floor(age)} s`);
		}
		this.final = final;
		this.status = "finishing";
		if (this.pending.size() === 0) return this.decide();
		return undefined;
	}

	/**
	 * Replays up to `maxTicks` queued ticks, stopping early at the end of a segment (one segment per call at most, so
	 * a server queue can interleave runs fairly). `hooks.onCheckpoint` runs every `hooks.checkpointEvery` ticks (the
	 * server's ReplayBudget yields there). Slicing never changes the outcome (segments.spec.ts).
	 */
	advance(maxTicks: number, hooks: ReplayHooks = {}): AdvanceResult {
		const verdicts: SegmentVerdict[] = [];
		if (this.result !== undefined || this.pending.size() === 0 || maxTicks <= 0) {
			return { stepped: 0, verdicts };
		}
		const seg = this.pending[0];
		if (this.state === undefined) {
			const spawn = this.spawn ?? { x: 0, z: 0 };
			const [ok, err] = pcall(() => {
				this.state = createSimState(this.seed, spawn.x, spawn.z, this.setup.config);
				this.telemetry = new RunTelemetry(
					runStartHalfHearts(this.setup.config),
					this.archetypeNames,
					this.setup.characters?.[0],
				);
			});
			if (!ok) {
				const result = this.rejectSegment(seg, "replay_error", `replay error: ${errorMessage(err)}`, verdicts);
				return { stepped: 0, verdicts, result };
			}
		}

		const [ok, outcome] = pcall(() => this.stepSegment(seg, maxTicks, hooks));
		if (!ok) {
			const result = this.rejectSegment(seg, "replay_error", `replay error: ${errorMessage(outcome)}`, verdicts);
			return { stepped: 0, verdicts, result };
		}
		const { stepped, mismatch } = outcome as { stepped: number; mismatch?: Mismatch };
		// Aborted (expiry, player left) while a hook yielded mid-slice: the state is gone, nothing more to report.
		if (this.result !== undefined) return { stepped, verdicts };
		if (mismatch !== undefined) {
			const result = this.rejectSegment(
				seg,
				"hash_mismatch",
				`hash mismatch in segment ${seg.index} at tick ${mismatch.tick}: claimed ${mismatch.claimed}, ` +
					`replay ${mismatch.actual}`,
				verdicts,
				mismatch.tick,
			);
			return { stepped, verdicts, result };
		}
		if (seg.cursor < seg.frameCount) return { stepped, verdicts };

		const serverHash = hashState(this.state!);
		if (serverHash !== seg.claimedEndHash) {
			const result = this.rejectSegment(
				seg,
				"hash_mismatch",
				`hash mismatch at the end of segment ${seg.index} (tick ${seg.endTick}): claimed ` +
					`${seg.claimedEndHash}, replay ${serverHash}`,
				verdicts,
				seg.endTick,
			);
			return { stepped, verdicts, result };
		}
		this.pending.remove(0);
		this.pendingTicks -= seg.frameCount;
		this.verified = seg.endTick;
		verdicts.push({
			runId: this.runId,
			index: seg.index,
			ok: true,
			startTick: seg.startTick,
			endTick: seg.endTick,
			serverHash,
		});
		if (this.status === "finishing" && this.pending.size() === 0) {
			return { stepped, verdicts, result: this.decide() };
		}
		return { stepped, verdicts };
	}

	/** Rejects the run from outside (session expiry, the player left mid-run). No-op once decided. */
	abort(code: SegmentRejectCode, reason: string): SegmentedRunResult {
		if (this.result !== undefined) return this.result;
		return this.rejectRun(code, reason);
	}

	// --- internals -------------------------------------------------------------------------------

	private stepSegment(
		seg: PendingSegment,
		maxTicks: number,
		hooks: ReplayHooks,
	): { stepped: number; mismatch?: Mismatch } {
		const state = this.state!;
		const telemetry = this.telemetry!;
		const config = this.setup.config;
		const recording = seg.recording;
		const n = seg.frameCount;
		const every = this.limits.checkpointEvery;
		const checkEvery = hooks.checkpointEvery ?? 1;
		const onCheckpoint = hooks.onCheckpoint;
		let stepped = 0;
		while (seg.cursor < n && stepped < maxTicks && this.result === undefined) {
			stepRecorded(state, recording, seg.cursor, config);
			seg.cursor++;
			stepped++;
			telemetry.observe(state);
			const tick = state.tick;
			if (this.firstFloorChange === undefined && state.events.floorChanged !== 0)
				this.firstFloorChange = tick - 1;
			if (every > 0 && tick % every === 0 && tick < seg.endTick) {
				const claimed = seg.checkpoints[seg.nextCheckpoint];
				seg.nextCheckpoint++;
				const actual = hashState(state);
				if (actual !== claimed) return { stepped, mismatch: { tick, claimed, actual } };
				seg.matchedThroughTick = tick;
			}
			if (onCheckpoint !== undefined && checkEvery > 0 && stepped % checkEvery === 0) onCheckpoint();
		}
		return { stepped };
	}

	/** The final check (every segment verified, final claim in hand). */
	private decide(): SegmentedRunResult {
		const final = this.final!;
		const state = this.state!;
		const [ok, out] = pcall(() => {
			const telemetry = this.telemetry!.finish();
			const summary = summarizeRun(state, telemetry);
			const silver = readSilver(state, summary, this.setup.config);
			return { telemetry, summary, score: this.readScore(state), silver };
		});
		if (!ok) return this.rejectRun("replay_error", `replay error: ${errorMessage(out)}`);
		const { telemetry, summary, score, silver } = out as {
			telemetry: RunTelemetryRecord;
			summary: RunSummary;
			score: RunScore;
			silver: RunSilver;
		};
		const serverHash = hashState(state);
		const done = { serverHash, summary, score, telemetry };
		if (serverHash !== final.claimedHash) {
			return this.rejectRun(
				"hash_mismatch",
				`hash mismatch: claimed ${final.claimedHash}, replay ${serverHash}`,
				done,
			);
		}
		const diff = summaryDiff(final.claimed, summary);
		if (diff !== undefined) return this.rejectRun("summary_mismatch", `summary mismatch: ${diff}`, done);
		if (final.claimed.score !== score.score || final.claimed.floor !== score.floor) {
			return this.rejectRun(
				"score_mismatch",
				`score mismatch: claimed ${final.claimed.score} on floor ${final.claimed.floor}, replay ` +
					`${score.score} on floor ${score.floor}`,
				done,
			);
		}
		this.status = "accepted";
		this.result = {
			runId: this.runId,
			ok: true,
			verifiedTicks: this.verified,
			serverHash,
			summary,
			score: { score: score.score, floor: score.floor },
			telemetry,
			firstFloorChangeTick: this.firstFloorChange,
			silver,
		};
		this.release();
		return this.result;
	}

	private spawnCheck(recording: Readonly<Recording>): string | undefined {
		const s = recording.spawn;
		const fixed = this.spawn;
		if (fixed !== undefined) {
			if (s.x !== fixed.x || s.z !== fixed.z)
				return `spawn (${s.x}, ${s.z}) is not the run's (${fixed.x}, ${fixed.z})`;
			return undefined;
		}
		return spawnProblem(recording, this.setup);
	}

	/** A segment verdict for a refused offer; rejects the run when `fatal`. */
	private refuse(
		index: number,
		startTick: number,
		code: SegmentRejectCode,
		reason: string,
		fatal: boolean,
	): SegmentOffer {
		const cut = truncateReason(reason);
		if (fatal) this.rejectRun(code, cut, undefined, index >= 0 ? index : undefined);
		return {
			ok: false,
			verdict: {
				runId: this.runId,
				index,
				ok: false,
				code,
				reason: cut,
				startTick,
				endTick: startTick,
				serverHash: "",
			},
		};
	}

	private rejectSegment(
		seg: PendingSegment,
		code: SegmentRejectCode,
		reason: string,
		verdicts: SegmentVerdict[],
		mismatchAtTick?: number,
	): SegmentedRunResult {
		const cut = truncateReason(reason);
		const matched = mismatchAtTick !== undefined ? seg.matchedThroughTick : undefined;
		verdicts.push({
			runId: this.runId,
			index: seg.index,
			ok: false,
			code,
			reason: cut,
			startTick: seg.startTick,
			endTick: seg.endTick,
			serverHash: "",
			matchedThroughTick: matched,
			mismatchAtTick,
		});
		const result = this.rejectRun(code, cut, undefined, seg.index);
		result.matchedThroughTick = matched;
		result.mismatchAtTick = mismatchAtTick;
		return result;
	}

	private rejectRun(
		code: SegmentRejectCode,
		reason: string,
		done?: { serverHash: string; summary: RunSummary; score: RunScore; telemetry: RunTelemetryRecord },
		failedSegment?: number,
	): SegmentedRunResult {
		this.status = "rejected";
		this.result = {
			runId: this.runId,
			ok: false,
			code,
			reason: truncateReason(reason),
			failedSegment,
			verifiedTicks: this.verified,
			serverHash: done?.serverHash ?? "",
			summary: done?.summary ?? { ...EMPTY_SUMMARY },
			score: done?.score ?? { score: DEFAULT_RUN_SCORE.score, floor: DEFAULT_RUN_SCORE.floor },
			telemetry: done?.telemetry,
			firstFloorChangeTick: this.firstFloorChange,
		};
		this.release();
		return this.result;
	}

	/** Frees the replay state and queued frames once the run is decided. */
	private release(): void {
		this.state = undefined;
		this.telemetry = undefined;
		this.pending = [];
		this.pendingTicks = 0;
	}
}

/** One replay-queue turn of a session (replayTurn). */
export interface ReplayTurn {
	/** Segment verdicts of this turn, in order. */
	readonly verdicts: ReadonlyArray<SegmentVerdict>;
	/** The run's verdict, when this turn decided it. */
	readonly result?: SegmentedRunResult;
	/** Ticks replayed by this turn. */
	readonly stepped: number;
}

/**
 * One fair turn in the server's shared replay queue: advances `v` in slices of `sliceTicks` until a segment finished
 * (one segment per turn), the run was decided, nothing is left to replay, or `maxTurnTicks` ticks were replayed (a long
 * segment then continues on the session's next turn, after the others queued meanwhile). Slicing never changes the
 * outcome (segments.spec.ts). Pure; the hooks carry the server's ReplayBudget.
 */
export function replayTurn(
	v: SegmentedValidator,
	sliceTicks: number,
	maxTurnTicks: number,
	hooks: ReplayHooks = {},
): ReplayTurn {
	const verdicts: SegmentVerdict[] = [];
	let stepped = 0;
	while (v.hasWork() && stepped < maxTurnTicks) {
		const r = v.advance(math.min(sliceTicks, maxTurnTicks - stepped), hooks);
		stepped += r.stepped;
		for (const x of r.verdicts) verdicts.push(x);
		if (r.result !== undefined) return { verdicts, result: r.result, stepped };
		if (r.verdicts.size() > 0) break; // one segment per turn
		if (r.stepped === 0) break; // aborted from outside while a hook yielded
	}
	return { verdicts, result: v.getResult(), stepped };
}
