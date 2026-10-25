import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, UserService } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import type { LeaderboardPostStatus } from "shared/network";
import {
	LEADERBOARD_BOARDS,
	LEADERBOARD_CACHE_SECONDS,
	LEADERBOARD_DETAILS_STORE,
	LEADERBOARD_MINE_CACHE_SECONDS,
	LEADERBOARD_ORDERED_STORES,
	LEADERBOARD_PUMP_SECONDS,
	LEADERBOARD_READ_RETRY,
	LEADERBOARD_REQUEST_RATE,
	LEADERBOARD_SHUTDOWN_FLUSH_SECONDS,
	LEADERBOARD_TOP_COUNT,
	LeaderboardWriteQueue,
	SharedTtlCache,
	decodeDetails,
	detailsKey,
	flushOnShutdown,
	leaderboardEligibility,
	mineFromDetails,
	planPosts,
	postPersonalBest,
	rowsFromEntries,
	userIdFromKey,
	type LeaderboardBoard,
	type LeaderboardEntryDetails,
	type LeaderboardRow,
	type LeaderboardStores,
	type LeaderboardView,
	type OrderedScoreStore,
	type QueuedPost,
	type VerifiedRunPost,
} from "shared/leaderboard";
import { SlidingWindowLimiter } from "shared/run";
import { withRetries } from "shared/settings";
import { DataStoreKeyValue } from "./data/DataStoreKeyValue";
import { OrderedDataStoreScores } from "./data/OrderedDataStoreScores";

const log = serverLogger("Leaderboard");

/** A validated run as RunSessionService hands it over, with what eligibility needs. */
export interface LeaderboardSubmission extends VerifiedRunPost {
	readonly debug: boolean;
	readonly died: boolean;
	readonly bossDefeated: boolean;
}

/**
 * The all-time Solo and Co-op leaderboards (M5; pure rules in shared/leaderboard, docs/SERVER.md "Leaderboards").
 *
 *   post     RunSessionService hands over each ACCEPTED segmented run (score and floor from the server's replay).
 *            Eligibility (world kind in LEADERBOARD_ELIGIBLE_WORLDS, not debug, not Studio, not a VIP server, the
 *            run ended) decides; then one personal-best write per member is queued (coalesced per player + board).
 *   writes   a loop drains the queue under LEADERBOARD_WRITE_RATE; a failed write retries with backoff
 *            (LEADERBOARD_WRITE_RETRY), never blocking the rest. BindToClose waits for runs still validating and drains the queue (flushOnShutdown).
 *   reads    `getLeaderboard(board)`: the top LEADERBOARD_TOP_COUNT rows (one GetSortedAsync per board per
 *            LEADERBOARD_CACHE_SECONDS, shared by every caller; names through UserService, cached), plus the
 *            caller's own best from the details store (cached, dropped when they post). Rank only within the top.
 */
@Service({})
export class LeaderboardService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly queue = new LeaderboardWriteQueue();
	private readonly topCache = new SharedTtlCache<LeaderboardBoard, LeaderboardRow[]>(LEADERBOARD_CACHE_SECONDS, (w) =>
		task.spawn(w),
	);
	private readonly mineCache = new SharedTtlCache<string, LeaderboardEntryDetails | undefined>(
		LEADERBOARD_MINE_CACHE_SECONDS,
		(w) => task.spawn(w),
	);
	private readonly limiter = new SlidingWindowLimiter<Player>(
		LEADERBOARD_REQUEST_RATE.count,
		LEADERBOARD_REQUEST_RATE.windowSeconds,
	);
	private readonly names = new Map<number, string>();
	private readonly ordered = new Map<LeaderboardBoard, OrderedScoreStore>();
	private readonly stores: LeaderboardStores = {
		ordered: (board) => this.orderedStore(board),
		details: new DataStoreKeyValue(LEADERBOARD_DETAILS_STORE),
	};
	private flushing = false;
	/** Runs still validating that may post (RunSessionService registers it): the shutdown flush waits for them. */
	private pendingPosts: () => number = () => 0;

	/** RunSessionService: how many of its runs may still post (finals replaying, party runs collecting claims). */
	setPendingPosts(count: () => number): void {
		this.pendingPosts = count;
	}

	onStart(): void {
		this.janitor.Add(
			Events.getLeaderboard.connect((player, board) => {
				if (player.Parent === undefined || !LEADERBOARD_BOARDS.includes(board)) return;
				if (!this.limiter.tryAcquire(player, os.clock())) return;
				const view = this.view(player, board);
				if (player.Parent !== undefined) Events.leaderboard.fire(player, view);
			}),
		);
		this.janitor.Add(
			Players.PlayerRemoving.Connect((player) => {
				this.limiter.forget(player);
				for (const board of LEADERBOARD_BOARDS) this.mineCache.invalidate(detailsKey(board, player.UserId));
			}),
		);
		const pump = task.spawn(() => this.pumpLoop());
		this.janitor.Add(() => task.cancel(pump));
		game.BindToClose(() => this.flush());
	}

	/** Whether this server may post at all (Studio, VIP servers). */
	private serverFlags(): { studio: boolean; privateServer: boolean } {
		return {
			studio: RunService.IsStudio(),
			privateServer: game.PrivateServerId !== "" && game.PrivateServerOwnerId !== 0,
		};
	}

	/** Queues an accepted run's personal-best writes, or says why it does not post. */
	post(run: LeaderboardSubmission): LeaderboardPostStatus {
		const flags = this.serverFlags();
		const reason = leaderboardEligibility({
			worldKind: run.worldKind,
			partySize: run.partySize ?? run.members.size(),
			contributors: run.members.size(),
			debug: run.debug,
			studio: flags.studio,
			privateServer: flags.privateServer,
			died: run.died,
			bossDefeated: run.bossDefeated,
		});
		if (reason !== undefined) return `ineligible:${reason}`;
		const now = os.clock();
		for (const job of planPosts(run)) {
			this.queue.enqueue(job, now);
			this.mineCache.invalidate(detailsKey(job.board, job.userId));
		}
		for (const m of run.members) this.names.set(m.userId, m.name);
		log.info("QUEUED", `run ${run.runId}: score ${run.score} floor ${run.floor}, ${run.members.size()} member(s)`);
		return "queued";
	}

	/** The board view for `player` (yields on a cache miss). */
	view(player: Player, board: LeaderboardBoard): LeaderboardView {
		const now = os.clock();
		const top = this.topCache.load(board, now, () => this.fetchTop(board));
		if (!top.ok) {
			log.warn("READ_FAILED", `${board}: ${top.error}`);
			return { board, ok: false, stale: false, rows: [], reason: "leaderboard unavailable" };
		}
		const key = detailsKey(board, player.UserId);
		const mine = this.mineCache.load(key, now, () => this.read(() => decodeDetails(this.stores.details.get(key))));
		return {
			board,
			ok: true,
			stale: top.stale,
			rows: top.value,
			mine: mineFromDetails(mine.ok ? mine.value : undefined, top.value, player.UserId),
		};
	}

	private fetchTop(board: LeaderboardBoard): LeaderboardRow[] {
		const entries = this.read(() => this.orderedStore(board).top(LEADERBOARD_TOP_COUNT));
		const ids: number[] = [];
		for (const e of entries) {
			const id = userIdFromKey(e.key);
			if (id !== undefined) ids.push(id);
		}
		this.resolveNames(ids);
		return rowsFromEntries(entries, (id) => this.names.get(id) ?? `#${id}`);
	}

	/** Fills the name cache for ids not in it (one UserService batch; failures leave "#<id>"). */
	private resolveNames(ids: ReadonlyArray<number>): void {
		const missing = ids.filter((id) => !this.names.has(id));
		if (missing.size() === 0) return;
		const [ok, infos] = pcall(() => UserService.GetUserInfosByUserIdsAsync([...missing]));
		if (!ok) {
			log.warn("NAMES_FAILED", tostring(infos));
			return;
		}
		for (const info of infos as UserInfo[]) this.names.set(info.Id, info.DisplayName);
	}

	/** A DataStore read with retries; throws the last error (the cache turns it into a stale / failed load). */
	private read<T>(fn: () => T): T {
		const r = withRetries(fn, LEADERBOARD_READ_RETRY, (s) => task.wait(s));
		if (!r.ok) error(r.error, 0);
		return r.value;
	}

	private orderedStore(board: LeaderboardBoard): OrderedScoreStore {
		let s = this.ordered.get(board);
		if (s === undefined) {
			s = new OrderedDataStoreScores(LEADERBOARD_ORDERED_STORES[board]);
			this.ordered.set(board, s);
		}
		return s;
	}

	private pumpLoop(): void {
		for (;;) {
			task.wait(LEADERBOARD_PUMP_SECONDS);
			if (this.flushing) continue;
			let q = this.queue.take(os.clock());
			while (q !== undefined) {
				this.write(q, true);
				if (this.flushing) break;
				q = this.queue.take(os.clock());
			}
		}
	}

	private write(q: QueuedPost, retry: boolean): void {
		const job = q.job;
		const [ok, outcome] = pcall(() => postPersonalBest(this.stores, job));
		if (ok) {
			const o = outcome as { improved: boolean; detailsWritten: boolean };
			if (o.improved || o.detailsWritten) this.mineCache.invalidate(detailsKey(job.board, job.userId));
			log.info(
				"WRITTEN",
				`${job.board} ${job.userId}: ${o.improved ? "new personal best" : "not a personal best"} (${
					job.value
				})`,
			);
			return;
		}
		const fate = retry ? this.queue.failed(q, os.clock()) : "dropped";
		log.warn(
			"WRITE_FAILED",
			`${job.board} ${job.userId} attempt ${q.attempts + 1} (${fate}): ${tostring(outcome)}`,
		);
	}

	/**
	 * BindToClose (shared/leaderboard flushOnShutdown): within LEADERBOARD_SHUTDOWN_FLUSH_SECONDS, waits for runs still
	 * validating (solo finals, party runs) and drains the queue in a loop until it is empty, so posts that arrive
	 * during the flush are written too; a failed write is retried (rate and backoff ignored).
	 */
	private flush(): void {
		this.flushing = true;
		const r = flushOnShutdown(
			{
				now: () => os.clock(),
				wait: () => task.wait(),
				spawn: (fn) => task.spawn(fn),
				pendingValidations: () => this.pendingPosts(),
				takeAll: () => this.queue.takeAll(),
				queued: () => this.queue.size(),
				write: (q) => this.write(q, true),
			},
			LEADERBOARD_SHUTDOWN_FLUSH_SECONDS,
		);
		const line = `${r.started} write(s) in ${string.format("%.1f", r.seconds)} s`;
		if (r.timedOut) {
			log.warn(
				"FLUSH_INCOMPLETE",
				`${line}; at the deadline ${r.inFlight} in flight, ${r.queued} queued, ${r.validating} run(s) validating`,
			);
		} else if (r.started > 0) {
			log.info("FLUSHED", line);
		}
	}
}
