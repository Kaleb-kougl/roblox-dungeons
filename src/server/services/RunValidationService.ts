import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { HttpService, Players, RunService, Workspace } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import {
	ACCEPTED_RUNS_KEPT_PER_PLAYER,
	LIVE_RUN_LIMITS,
	REPLAY_BUDGET_SECONDS,
	REPLAY_CONCURRENCY,
	RUNS_DATASTORE_ENABLED,
	RUNS_DATASTORE_KEPT,
	RUNS_DATASTORE_NAME,
	RUN_PENDING_PER_PLAYER,
	RUN_SUBMIT_RATE,
	ReplayBudget,
	SlidingWindowLimiter,
	WorkQueue,
	truncateReason,
	validateRun,
	type RunLimits,
	type RunRejectCode,
	type RunSubmission,
	type RunSummary,
	type RunTelemetryRecord,
	type RunValidation,
	type RunWorld,
	type SegmentRejectCode,
} from "shared/run";
import type { RunVerdict } from "shared/network";
import { SETTINGS_RETRY, playerDataKey, withRetries } from "shared/settings";
import { DataStoreKeyValue } from "./data/DataStoreKeyValue";

const log = serverLogger("RunValidation");
const MS_PER_SECOND = 1000;

/**
 * Studio-only switch (Workspace attribute, off by default): accept debug input bits and boss-door starts, so runs
 * played with the debug keys (K / J, `?spawn=boss`) can be validated while developing. Ignored on live servers.
 */
export const ALLOW_DEBUG_RUNS_ATTRIBUTE = "KV_AllowDebugRuns";

/**
 * Studio-only switch (Workspace attribute, unset by default): the RunWorld to validate in ("game", "endless",
 * "dungeonNoEncounter" or "greybox"), so the player-only fixtures can be pushed through the real service before the
 * actors exist (task 7). Ignored on live servers, which always use LIVE_RUN_WORLD (shared/config PLAY_MODE).
 */
export const RUN_WORLD_ATTRIBUTE = "KV_RunValidationWorld";

const STUDIO_WORLDS: ReadonlyArray<RunWorld> = ["game", "endless", "dungeonNoEncounter", "greybox"];

/** One run the server accepted. */
export interface AcceptedRun {
	/** Server-generated GUID (also the analytics funnel session id). */
	runId: string;
	seed: number;
	serverHash: string;
	summary: RunSummary;
	telemetry: RunTelemetryRecord;
	/** os.time() at acceptance. */
	acceptedAt: number;
}

/**
 * A subscriber to `onRunAccepted`: called with the player and the accepted run each time a submission passes validation
 * (the reward seam).
 */
export type RunAcceptedListener = (player: Player, run: Readonly<AcceptedRun>) => void;
/**
 * A subscriber to `onRunRejected`: called with the player, the reject code and its reason each time a submission is
 * refused (telemetry).
 */
export type RunRejectedListener = (player: Player, code: RunRejectCode | SegmentRejectCode, reason: string) => void;

/** Compact record kept in the optional "Runs" DataStore entry. */
interface StoredRun {
	id: string;
	seed: number;
	hash: string;
	ticks: number;
	kills: number;
	boss: boolean;
	died: boolean;
	at: number;
}

/**
 * Validates finished runs by replay (shared/run `validateRun`, docs/SERVER.md).
 *
 * The client plays the whole run locally (PLAN.md "Single-player first") and submits seed + binary recording at the
 * end. This service ignores players who already left, allows RUN_PENDING_PER_PLAYER submissions per player validating
 * or queued (one more answers `busy`, free), then rate-limits (RUN_SUBMIT_RATE), queues the replay server-wide
 * (REPLAY_CONCURRENCY at once, FIFO), replays under a CPU time budget (yielding a frame whenever REPLAY_BUDGET_SECONDS
 * of work piled up), logs the verdict, keeps accepted runs in memory (and in the "Runs" DataStore when
 * RUNS_DATASTORE_ENABLED), and answers with `runVerdict`.
 *
 * A validation can finish after its player left: the listeners still fire (the run counts for the session), and
 * `waitUntilIdle(player)` lets TelemetryService hold the session summary until then.
 *
 * It grants NOTHING: there is no loot yet. `onRunAccepted` is the seam where rewards, leaderboards or progression
 * hook in; TelemetryService is its first listener.
 */
@Service({})
export class RunValidationService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly limiter = new SlidingWindowLimiter<Player>(RUN_SUBMIT_RATE.count, RUN_SUBMIT_RATE.windowSeconds);
	/** Server-wide replay queue: REPLAY_CONCURRENCY replays at once, the rest in arrival order. */
	private readonly queue = new WorkQueue(REPLAY_CONCURRENCY, (waiter) => task.spawn(waiter));
	/** Submissions validating or queued, per player (entries removed at 0). */
	private readonly pending = new Map<Player, number>();
	/** Threads in waitUntilIdle, per player. */
	private readonly idleWaiters = new Map<Player, thread[]>();
	private readonly accepted = new Map<Player, AcceptedRun[]>();
	private readonly acceptedListeners = new Set<RunAcceptedListener>();
	private readonly rejectedListeners = new Set<RunRejectedListener>();
	private runsStore?: DataStoreKeyValue;

	onStart(): void {
		this.janitor.Add(
			Events.submitRun.connect((player, submission) => {
				// A remote that arrives after PlayerRemoving would recreate the limiter entry: drop it.
				if (player.Parent === undefined) return;
				this.reply(player, this.submit(player, submission));
			}),
		);
		this.janitor.Add(
			Players.PlayerRemoving.Connect((player) => {
				this.limiter.forget(player);
				this.accepted.delete(player);
			}),
		);
		if (RUNS_DATASTORE_ENABLED) this.runsStore = new DataStoreKeyValue(RUNS_DATASTORE_NAME);
	}

	/** Subscribes to accepted runs (the reward seam). Returns the unsubscribe function. */
	onRunAccepted(listener: RunAcceptedListener): () => void {
		this.acceptedListeners.add(listener);
		return () => this.acceptedListeners.delete(listener);
	}

	/** Subscribes to rejected submissions (telemetry). Returns the unsubscribe function. */
	onRunRejected(listener: RunRejectedListener): () => void {
		this.rejectedListeners.add(listener);
		return () => this.rejectedListeners.delete(listener);
	}

	/** This session's accepted runs for `player`, oldest first. */
	getAcceptedRuns(player: Player): ReadonlyArray<Readonly<AcceptedRun>> {
		return this.accepted.get(player) ?? [];
	}

	/** Submissions of `player` validating or queued. */
	pendingCount(player: Player): number {
		return this.pending.get(player) ?? 0;
	}

	/**
	 * Yields until `player` has no submission validating or queued (returns at once when there is none). After
	 * PlayerRemoving no new submission is taken, so once this returns no listener fires for that player again.
	 */
	waitUntilIdle(player: Player): void {
		if (this.pendingCount(player) === 0) return;
		let waiters = this.idleWaiters.get(player);
		if (waiters === undefined) {
			waiters = [];
			this.idleWaiters.set(player, waiters);
		}
		waiters.push(coroutine.running());
		coroutine.yield(); // resumed by finishPending
	}

	/**
	 * Segmented runs (RunSessionService) validate elsewhere but share this service's bookkeeping: `trackExternal`
	 * counts a validation in progress for `waitUntilIdle` (call the returned function when it is done, exactly once),
	 * and `reportAccepted` / `reportRejected` keep the run and fire the same listeners as `submit` (TelemetryService).
	 */
	trackExternal(player: Player): () => void {
		this.pending.set(player, this.pendingCount(player) + 1);
		let done = false;
		return () => {
			if (done) return;
			done = true;
			this.finishPending(player);
		};
	}

	/** A run accepted outside `submit` (a segmented run): kept for the session, listeners fired. */
	reportAccepted(player: Player, run: AcceptedRun): void {
		if (player.Parent !== undefined) {
			let list = this.accepted.get(player);
			if (list === undefined) {
				list = [];
				this.accepted.set(player, list);
			}
			list.push(run);
			while (list.size() > ACCEPTED_RUNS_KEPT_PER_PLAYER) list.remove(0);
		}
		for (const listener of this.acceptedListeners) task.spawn(listener, player, run);
	}

	/** A run rejected outside `submit` (a segmented run): listeners fired. */
	reportRejected(player: Player, code: RunRejectCode | SegmentRejectCode, reason: string): void {
		const cut = truncateReason(reason);
		for (const listener of this.rejectedListeners) task.spawn(listener, player, code, cut);
	}

	/** Monotonic seconds (a seam for tests that subclass the service). */
	protected now(): number {
		return os.clock();
	}

	/**
	 * Runs replay work through the server-wide replay queue (REPLAY_CONCURRENCY at once, FIFO), so segmented replays
	 * and whole-run replays never stack their CPU time. Returns / rethrows what `work` does.
	 */
	runInReplayQueue<T>(work: () => T): T {
		return this.queue.run(work);
	}

	/** The limits in force: LIVE_RUN_LIMITS; in Studio, the debug / world attributes may relax them. */
	limits(): RunLimits {
		if (!RunService.IsStudio()) return LIVE_RUN_LIMITS;
		let limits: RunLimits = LIVE_RUN_LIMITS;
		if (Workspace.GetAttribute(ALLOW_DEBUG_RUNS_ATTRIBUTE) === true) {
			limits = { ...limits, allowDebugInput: true, allowBossDoorSpawn: true };
		}
		const world = Workspace.GetAttribute(RUN_WORLD_ATTRIBUTE);
		if (typeIs(world, "string") && STUDIO_WORLDS.includes(world as RunWorld)) {
			limits = { ...limits, world: world as RunWorld };
		}
		return limits;
	}

	/**
	 * Validates one submission and returns the verdict (the remote handler fires it back to the player). Public so a
	 * Studio command bar can push a fixture through the real service (docs/SERVER.md "Testing").
	 */
	submit(player: Player, submission: RunSubmission): RunVerdict {
		const claimedHash = typeIs(submission.claimedHash, "string") ? submission.claimedHash.sub(1, 8) : "";
		// Busy first, so a submission that cannot run does not use up the rate budget.
		if (this.pendingCount(player) >= RUN_PENDING_PER_PLAYER) {
			return this.gateVerdict(claimedHash, "busy", "previous runs are still being checked");
		}
		if (!this.limiter.tryAcquire(player, this.now())) {
			log.warn(
				"RATE_LIMITED",
				`${player.UserId}: submission over ${RUN_SUBMIT_RATE.count} per ${RUN_SUBMIT_RATE.windowSeconds} s dropped`,
			);
			return this.gateVerdict(claimedHash, "rate_limited", "too many submissions; try again later");
		}
		this.pending.set(player, this.pendingCount(player) + 1);
		const limits = this.limits();
		const queued = this.queue.size();
		const submitted = this.now();
		let started = submitted;
		let yields = 0;
		const [ok, resultOrErr] = pcall(() =>
			this.queue.run(() => {
				started = this.now();
				const budget = new ReplayBudget(
					REPLAY_BUDGET_SECONDS,
					() => this.now(),
					() => task.wait(),
				);
				const r = validateRun(submission, limits, { hooks: { onCheckpoint: () => budget.checkpoint() } });
				yields = budget.yields;
				return r;
			}),
		);
		// validateRun never throws; this guards the service against a bug in it.
		const result: RunValidation = ok
			? (resultOrErr as RunValidation)
			: {
					ok: false,
					code: "replay_error",
					reason: truncateReason(`internal error: ${tostring(resultOrErr)}`),
					serverHash: "",
					summary: { ticks: 0, kills: 0, bossDefeated: false, died: false },
			  };
		const timing =
			`${math.floor((this.now() - started) * MS_PER_SECOND)} ms, ${yields} yields, ` +
			`queued ${math.floor((started - submitted) * MS_PER_SECOND)} ms behind ${queued}`;
		// Listeners fire inside accept / reject, before the pending count drops (waitUntilIdle relies on it). The count
		// drops even if they throw, so a waiting session summary is never stuck.
		const [done, verdict] = pcall(() =>
			result.ok
				? this.accept(player, submission, result, claimedHash, timing)
				: this.reject(player, result, claimedHash, timing),
		);
		this.finishPending(player);
		if (!done) error(verdict, 0);
		return verdict as RunVerdict;
	}

	private finishPending(player: Player): void {
		const left = this.pendingCount(player) - 1;
		if (left > 0) {
			this.pending.set(player, left);
			return;
		}
		this.pending.delete(player);
		const waiters = this.idleWaiters.get(player);
		this.idleWaiters.delete(player);
		if (waiters !== undefined) for (const waiter of waiters) task.spawn(waiter);
	}

	private accept(
		player: Player,
		submission: RunSubmission,
		result: RunValidation,
		claimedHash: string,
		timing: string,
	): RunVerdict {
		const run: AcceptedRun = {
			runId: HttpService.GenerateGUID(false),
			seed: submission.seed,
			serverHash: result.serverHash,
			summary: result.summary,
			telemetry: result.telemetry!,
			acceptedAt: os.time(),
		};
		const s = run.summary;
		log.info(
			"ACCEPTED",
			`${player.UserId} seed ${run.seed} hash ${run.serverHash} ticks ${s.ticks} kills ${s.kills} ` +
				`boss ${s.bossDefeated} died ${s.died} (${timing}) run ${run.runId}`,
		);
		if (player.Parent !== undefined) {
			let list = this.accepted.get(player);
			if (list === undefined) {
				list = [];
				this.accepted.set(player, list);
			}
			list.push(run);
			while (list.size() > ACCEPTED_RUNS_KEPT_PER_PLAYER) list.remove(0);
		}
		if (this.runsStore) task.spawn(() => this.storeRun(player.UserId, run));
		for (const listener of this.acceptedListeners) task.spawn(listener, player, run);
		return { ok: true, claimedHash, serverHash: run.serverHash, summary: run.summary, runId: run.runId };
	}

	private reject(player: Player, result: RunValidation, claimedHash: string, timing: string): RunVerdict {
		const code = result.code ?? "replay_error";
		const reason = truncateReason(result.reason ?? code);
		log.warn("REJECTED", `${player.UserId} ${code}: ${reason} (${timing})`);
		for (const listener of this.rejectedListeners) task.spawn(listener, player, code, reason);
		return { ok: false, claimedHash, code, reason, serverHash: result.serverHash, summary: result.summary };
	}

	private gateVerdict(claimedHash: string, code: "rate_limited" | "busy", reason: string): RunVerdict {
		return {
			ok: false,
			claimedHash,
			code,
			reason,
			serverHash: "",
			summary: { ticks: 0, kills: 0, bossDefeated: false, died: false },
		};
	}

	private reply(player: Player, verdict: RunVerdict): void {
		if (player.Parent !== undefined) Events.runVerdict.fire(player, verdict);
	}

	/** Appends to the player's "Runs" entry (UpdateAsync, newest last, capped). Stub: nothing reads it yet. */
	private storeRun(userId: number, run: AcceptedRun): void {
		const store = this.runsStore;
		if (!store) return;
		const entry: StoredRun = {
			id: run.runId,
			seed: run.seed,
			hash: run.serverHash,
			ticks: run.summary.ticks,
			kills: run.summary.kills,
			boss: run.summary.bossDefeated,
			died: run.summary.died,
			at: run.acceptedAt,
		};
		const result = withRetries(
			() =>
				store.update(
					playerDataKey(userId),
					(old) => {
						const list: StoredRun[] = typeIs(old, "table") ? [...(old as StoredRun[])] : [];
						list.push(entry);
						while (list.size() > RUNS_DATASTORE_KEPT) list.remove(0);
						return list;
					},
					[userId],
				),
			SETTINGS_RETRY,
			(s) => task.wait(s),
		);
		if (!result.ok) log.warn("RUNS_STORE_FAILED", `${userId}: ${result.error}`);
	}
}
