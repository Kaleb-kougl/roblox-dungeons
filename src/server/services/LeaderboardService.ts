import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, UserService } from "@rbxts/services";
import { dailyClockNow } from "server/config";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import {
	DAILY,
	DAILY_HIST,
	dailyDay,
	type DailyMineEntry,
	type DailyPodium,
	type DailyRunKey,
	type DailyRunResult,
} from "shared/daily";
import type { LeaderboardPostStatus } from "shared/network";
import {
	LEADERBOARD_BOARDS,
	LEADERBOARD_CACHE_SECONDS,
	LEADERBOARD_DAILY_HIST_STORE,
	LEADERBOARD_DETAILS_STORE,
	LEADERBOARD_MINE_CACHE_SECONDS,
	LEADERBOARD_PUMP_SECONDS,
	LEADERBOARD_READ_RETRY,
	LEADERBOARD_REQUEST_RATE,
	LEADERBOARD_SHUTDOWN_FLUSH_SECONDS,
	LEADERBOARD_TOP_COUNT,
	HistogramBuffer,
	LeaderboardWriteQueue,
	PostWaiters,
	SharedTtlCache,
	addCounts,
	addHistCounts,
	asOrderedValue,
	boardRefKey,
	boardTopOf,
	boardTotal,
	buildPodium,
	dailyBoard,
	dailyMineEntry,
	dailyRunResult,
	dailyStanding,
	decodeDetails,
	detailsKey,
	entryValue,
	flushOnShutdown,
	histDeltas,
	histShardKey,
	histShardOf,
	isDailyBoard,
	jobBoard,
	leaderboardEligibility,
	mergeEntry,
	mineFromDetails,
	mineFromOrderedValue,
	orderedKey,
	orderedStoreOf,
	parseLeaderboardRequest,
	planPosts,
	postJobKey,
	postPersonalBest,
	resolveBoardRequest,
	rowsFromEntries,
	sumHistShards,
	userIdFromKey,
	type BoardRef,
	type BoardTop,
	type LeaderboardBoard,
	type LeaderboardEntryDetails,
	type LeaderboardRequest,
	type LeaderboardStores,
	type LeaderboardView,
	type OrderedScoreStore,
	type PostOutcome,
	type PostWait,
	type PostWaitOutcome,
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

/** DailyFriendsService's friends view (`getLeaderboard` with `friends: true`); may yield. */
export type FriendsViewProvider = (player: Player, request: LeaderboardRequest, ref: BoardRef) => LeaderboardView;

/** Told when this server wrote a daily entry (the friends lookup cache learns it for free). */
export type DailyEntryListener = (ref: BoardRef, userId: number, value: number) => void;

/** The caches of one kind: today / all-time (fresh, 60 s) and yesterday's settled board (DAILY.yesterdayCacheSeconds). */
interface CachePair<V> {
	readonly fresh: SharedTtlCache<string, V>;
	readonly settled: SharedTtlCache<string, V>;
}

function cachePair<V>(freshSeconds: number): CachePair<V> {
	return {
		fresh: new SharedTtlCache<string, V>(freshSeconds, (w) => task.spawn(w)),
		settled: new SharedTtlCache<string, V>(DAILY.yesterdayCacheSeconds, (w) => task.spawn(w)),
	};
}

/**
 * The leaderboards (M5; pure rules in shared/leaderboard, docs/SERVER.md "Leaderboards"): the all-time Solo and
 * Co-op boards and the day-scoped daily boards (docs/DAILY.md DS5-DS8).
 *
 *   post     RunSessionService hands over each ACCEPTED segmented run (score and floor from the server's replay).
 *            Eligibility (an endless run: all-time; a daily run with its session's day and ruleset: that day's daily
 *            board only; never debug, Studio, VIP servers, abandoned) decides; then one personal-best write per
 *            member is queued (coalesced per player, board and scope). A daily run's writes are also waited on
 *            (`awaitDaily`), so its verdict carries improved / previous / rank.
 *   writes   a loop drains the queue under LEADERBOARD_WRITE_RATE; a failed write retries with backoff
 *            (LEADERBOARD_WRITE_RETRY), never blocking the rest. A daily write records its histogram delta (DS6:
 *            buffered, flushed every DAILY_HIST.flushSeconds into this server's shard) and merges the new entry into
 *            the cached top rows. BindToClose waits for runs still validating, drains the queue (flushOnShutdown),
 *            then flushes the histogram buffer.
 *   reads    `getLeaderboard({ board, scope, friends? })` (scope resolved by the server's clock): the top
 *            LEADERBOARD_TOP_COUNT rows (one GetSortedAsync per board and scope per cache period, shared by every
 *            caller; names through UserService, cached), plus the caller's own entry (all-time: the details store;
 *            daily: the ordered value, free when it is in the rows) and, on daily boards, the histogram (8 shard reads
 *            per cache period) for the entrants and percentile. Yesterday's board is cached DAILY.yesterdayCacheSeconds.
 *            The friends view is DailyFriendsService's (`setFriendsView`).
 */
@Service({})
export class LeaderboardService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly queue = new LeaderboardWriteQueue();
	private readonly waiters = new PostWaiters();
	/** Daily runs' waits by runId (one per credited member). */
	private readonly runWaits = new Map<string, Map<number, PostWait>>();
	private readonly top = cachePair<BoardTop>(LEADERBOARD_CACHE_SECONDS);
	/** All-time: the caller's details entry, keyed by detailsKey (as M5). */
	private readonly mineCache = new SharedTtlCache<string, LeaderboardEntryDetails | undefined>(
		LEADERBOARD_MINE_CACHE_SECONDS,
		(w) => task.spawn(w),
	);
	/** Daily: the caller's ordered value, keyed `<boardRefKey>:<userId>`. */
	private readonly dailyMine = cachePair<number | undefined>(LEADERBOARD_MINE_CACHE_SECONDS);
	/** Daily: the summed histogram shards, keyed by boardRefKey. */
	private readonly histCache = cachePair<number[]>(DAILY_HIST.cacheSeconds);
	/** Daily mine keys per player (dropped when they leave). */
	private readonly dailyMineKeys = new Map<number, Set<string>>();
	private readonly hist = new HistogramBuffer();
	private readonly histStore = new DataStoreKeyValue(LEADERBOARD_DAILY_HIST_STORE);
	private readonly histShard = histShardOf(game.JobId);
	private readonly limiter = new SlidingWindowLimiter<Player>(
		LEADERBOARD_REQUEST_RATE.count,
		LEADERBOARD_REQUEST_RATE.windowSeconds,
	);
	private readonly names = new Map<number, string>();
	private readonly ordered = new Map<string, OrderedScoreStore>();
	private readonly stores: LeaderboardStores = {
		ordered: (ref) => this.orderedStore(ref),
		details: new DataStoreKeyValue(LEADERBOARD_DETAILS_STORE),
	};
	private flushing = false;
	/** Runs still validating that may post (RunSessionService registers it): the shutdown flush waits for them. */
	private pendingPosts: () => number = () => 0;
	private friendsView: FriendsViewProvider | undefined;
	private entryListener: DailyEntryListener | undefined;

	/** RunSessionService: how many of its runs may still post (finals replaying, party runs collecting claims). */
	setPendingPosts(count: () => number): void {
		this.pendingPosts = count;
	}

	/** DailyFriendsService: serves `getLeaderboard` requests with `friends: true`. */
	setFriendsView(provider: FriendsViewProvider): void {
		this.friendsView = provider;
	}

	/** DailyFriendsService: hears every daily entry this server wrote. */
	setDailyEntryListener(listener: DailyEntryListener): void {
		this.entryListener = listener;
	}

	onStart(): void {
		this.janitor.Add(
			Events.getLeaderboard.connect((player, raw) => {
				if (player.Parent === undefined) return;
				const request = parseLeaderboardRequest(raw);
				if (request === undefined) return;
				if (!this.limiter.tryAcquire(player, os.clock())) return;
				const ref = resolveBoardRequest(request, this.today());
				const provider = this.friendsView;
				let view: LeaderboardView;
				if (request.friends === true && provider !== undefined) view = provider(player, request, ref);
				else if (request.friends === true) view = this.unavailable(request, ref, "friends unavailable");
				else view = this.view(player, request, ref);
				if (player.Parent !== undefined) Events.leaderboard.fire(player, view);
			}),
		);
		this.janitor.Add(
			Players.PlayerRemoving.Connect((player) => {
				this.limiter.forget(player);
				for (const board of LEADERBOARD_BOARDS) this.mineCache.invalidate(detailsKey(board, player.UserId));
				const keys = this.dailyMineKeys.get(player.UserId);
				if (keys !== undefined) {
					for (const key of keys) {
						this.dailyMine.fresh.invalidate(key);
						this.dailyMine.settled.invalidate(key);
					}
					this.dailyMineKeys.delete(player.UserId);
				}
			}),
		);
		const pump = task.spawn(() => this.pumpLoop());
		this.janitor.Add(() => task.cancel(pump));
		const histLoop = task.spawn(() => {
			for (;;) {
				task.wait(DAILY_HIST.flushSeconds);
				if (!this.flushing) this.flushHistogram();
			}
		});
		this.janitor.Add(() => task.cancel(histLoop));
		game.BindToClose(() => this.flush());
	}

	/** The Daily's day now, by the server's clock (shared/daily dailyDay of dailyClockNow). */
	today(): number {
		return dailyDay(dailyClockNow());
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
			daily: run.daily,
		});
		if (reason !== undefined) return `ineligible:${reason}`;
		const now = os.clock();
		let waits: Map<number, PostWait> | undefined;
		for (const job of planPosts(run)) {
			const ref = jobBoard(job);
			if (isDailyBoard(ref)) {
				waits = waits ?? new Map();
				waits.set(job.userId, this.waiters.add(postJobKey(job), job.value));
				this.invalidateDailyMine(ref, job.userId);
			} else {
				this.mineCache.invalidate(detailsKey(job.board, job.userId));
			}
			this.queue.enqueue(job, now);
		}
		if (waits !== undefined) this.runWaits.set(run.runId, waits);
		for (const m of run.members) this.names.set(m.userId, m.name);
		log.info("QUEUED", `run ${run.runId}: score ${run.score} floor ${run.floor}, ${run.members.size()} member(s)`);
		return "queued";
	}

	/**
	 * A daily run's verdict parts (RunFinishVerdict.daily) for `recipients`: waits (yielding) up to `waitSeconds` for
	 * the run's writes queued by `post`, then reads the board (cached rows with the entry merged in, the histogram)
	 * for each recipient's standing. A recipient without a write (not credited, ineligible run) gets `posted: false`.
	 */
	dailyResults(
		runId: string,
		board: LeaderboardBoard,
		key: DailyRunKey,
		recipients: ReadonlyArray<number>,
		waitSeconds: number,
		pollSeconds: number,
	): Map<number, DailyRunResult> {
		const outcomes = this.awaitWrites(runId, waitSeconds, pollSeconds);
		const ref = dailyBoard(board, key);
		const out = new Map<number, DailyRunResult>();
		for (const userId of recipients) {
			const outcome = outcomes.get(userId);
			if (outcome === undefined || !outcome.posted || outcome.entry === undefined) {
				out.set(userId, dailyRunResult(key, outcome));
				continue;
			}
			const [ok, standing] = pcall(() => this.standing(ref, userId, outcome.entry!));
			out.set(userId, dailyRunResult(key, outcome, ok ? standing : undefined));
		}
		return out;
	}

	/** This player's entry on a daily board with its standing (undefined: no entry, or the board could not be read). */
	dailyMineOf(ref: BoardRef, userId: number): DailyMineEntry | undefined {
		const top = this.loadTop(ref);
		if (top === undefined) return undefined;
		const value = this.dailyEntry(ref, userId, top);
		if (value === undefined) return undefined;
		return dailyMineEntry(userId, value, mergeEntry(top, userId, value), this.histogram(ref));
	}

	/** Yesterday's podium of `ref` (a settled daily board) for `userId`; undefined when the board cannot be read. */
	podiumOf(ref: BoardRef, userId: number): DailyPodium | undefined {
		const top = this.loadTop(ref);
		if (top === undefined || ref.daily === undefined) return undefined;
		const value = this.dailyEntry(ref, userId, top);
		const merged = value !== undefined ? mergeEntry(top, userId, value) : top;
		return buildPodium(ref.daily.day, merged, (id) => this.nameOf(id), userId, value, this.histogram(ref));
	}

	/** The top rows of a board (cached; yields on a miss); undefined when it cannot be read at all. */
	loadTop(ref: BoardRef): BoardTop | undefined {
		const r = this.topCache(ref).load(boardRefKey(ref), os.clock(), () => this.fetchTop(ref));
		if (!r.ok) {
			log.warn("READ_FAILED", `${boardRefKey(ref)}: ${r.error}`);
			return undefined;
		}
		return r.value;
	}

	/** Like loadTop, with whether the rows are a stale copy (the last read failed). */
	loadTopWithStale(ref: BoardRef): { readonly top: BoardTop; readonly stale: boolean } | undefined {
		const r = this.topCache(ref).load(boardRefKey(ref), os.clock(), () => this.fetchTop(ref));
		if (!r.ok) {
			log.warn("READ_FAILED", `${boardRefKey(ref)}: ${r.error}`);
			return undefined;
		}
		return { top: r.value, stale: r.stale };
	}

	/**
	 * `userId`'s ordered value on a daily board: free from the rows (their row, or none on a complete board), else one
	 * cached GetAsync. Undefined: no entry (or the read failed).
	 */
	dailyEntry(ref: BoardRef, userId: number, top: BoardTop | undefined): number | undefined {
		if (top !== undefined) {
			const fromRows = entryValue(top, userId);
			if (fromRows !== undefined || top.complete) return fromRows;
		}
		const key = `${boardRefKey(ref)}:${userId}`;
		let keys = this.dailyMineKeys.get(userId);
		if (keys === undefined) {
			keys = new Set();
			this.dailyMineKeys.set(userId, keys);
		}
		keys.add(key);
		const r = this.cacheFor(this.dailyMine, ref).load(key, os.clock(), () => this.readEntry(ref, userId));
		return r.ok ? r.value : undefined;
	}

	/** One uncached read of `userId`'s entry on a board (the friends queue caches its own); throws on failure. */
	readEntry(ref: BoardRef, userId: number): number | undefined {
		return this.read(() => asOrderedValue(this.orderedStore(ref).get(orderedKey(userId))));
	}

	/** The histogram of a daily board (shards cached, plus this server's unflushed deltas); undefined if unreadable. */
	histogram(ref: BoardRef): number[] | undefined {
		const r = this.cacheFor(this.histCache, ref).load(boardRefKey(ref), os.clock(), () => this.fetchHistogram(ref));
		if (!r.ok) {
			log.warn("HIST_READ_FAILED", `${boardRefKey(ref)}: ${r.error}`);
			return undefined;
		}
		return addCounts(r.value, this.hist.pending(ref));
	}

	/** A player's display name from the cache ("#<id>" when unknown). */
	nameOf(userId: number): string {
		return this.names.get(userId) ?? `#${userId}`;
	}

	/** Names learned elsewhere (the friends list carries them). */
	rememberName(userId: number, name: string): void {
		this.names.set(userId, name);
	}

	/** Fills the name cache for ids not in it (one UserService batch; failures leave "#<id>"). */
	resolveNames(ids: ReadonlyArray<number>): void {
		const missing = ids.filter((id) => id > 0 && !this.names.has(id));
		if (missing.size() === 0) return;
		const [ok, infos] = pcall(() => UserService.GetUserInfosByUserIdsAsync([...missing]));
		if (!ok) {
			log.warn("NAMES_FAILED", tostring(infos));
			return;
		}
		for (const info of infos as UserInfo[]) this.names.set(info.Id, info.DisplayName);
	}

	/** The board view for `player` (yields on a cache miss). */
	view(player: Player, request: LeaderboardRequest, ref: BoardRef): LeaderboardView {
		if (!isDailyBoard(ref)) return this.alltimeView(player, ref.board);
		const loaded = this.loadTopWithStale(ref);
		if (loaded === undefined) return this.unavailable(request, ref, "leaderboard unavailable");
		const top = loaded.top;
		const rows = rowsFromEntries(top.entries, (id) => this.nameOf(id));
		const counts = this.histogram(ref);
		const value = this.dailyEntry(ref, player.UserId, top);
		const view: LeaderboardView = {
			...this.viewHeader(request, ref),
			ok: true,
			stale: loaded.stale,
			rows,
			total: boardTotal(top, counts),
		};
		const mine = mineFromOrderedValue(value, rows, player.UserId);
		if (mine !== undefined && value !== undefined) {
			mine.percentile = dailyStanding(
				player.UserId,
				value,
				mergeEntry(top, player.UserId, value),
				counts,
			).percentile;
			view.mine = mine;
		}
		return view;
	}

	/** The common head of a view: board, scope, and a daily board's day and ruleset. */
	viewHeader(
		request: LeaderboardRequest,
		ref: BoardRef,
	): Pick<LeaderboardView, "board" | "scope" | "day" | "ruleset" | "friends"> {
		const head: Pick<LeaderboardView, "board" | "scope" | "day" | "ruleset" | "friends"> = {
			board: request.board,
			scope: request.scope,
		};
		if (ref.daily !== undefined) {
			head.day = ref.daily.day;
			head.ruleset = ref.daily.ruleset;
		}
		if (request.friends === true) head.friends = true;
		return head;
	}

	/** A view that says the board could not be read. */
	unavailable(request: LeaderboardRequest, ref: BoardRef, reason: string): LeaderboardView {
		return { ...this.viewHeader(request, ref), ok: false, stale: false, rows: [], reason };
	}

	/** The all-time view (M5, unchanged but for `scope`). */
	private alltimeView(player: Player, board: LeaderboardBoard): LeaderboardView {
		const top = this.loadTopWithStale({ board, scope: "alltime" });
		if (top === undefined) {
			return { board, scope: "alltime", ok: false, stale: false, rows: [], reason: "leaderboard unavailable" };
		}
		const rows = rowsFromEntries(top.top.entries, (id) => this.nameOf(id));
		const key = detailsKey(board, player.UserId);
		const now = os.clock();
		const mine = this.mineCache.load(key, now, () => this.read(() => decodeDetails(this.stores.details.get(key))));
		return {
			board,
			scope: "alltime",
			ok: true,
			stale: top.stale,
			rows,
			mine: mineFromDetails(mine.ok ? mine.value : undefined, rows, player.UserId),
		};
	}

	/** The standing of `userId`'s entry `value` after a write (the cached rows with it merged in, the histogram). */
	private standing(ref: BoardRef, userId: number, value: number) {
		const top = this.loadTop(ref);
		if (top === undefined) return undefined;
		return dailyStanding(userId, value, mergeEntry(top, userId, value), this.histogram(ref));
	}

	/** Waits for a daily run's writes (registered by `post`), at most `waitSeconds`; unfinished waits are dropped. */
	private awaitWrites(runId: string, waitSeconds: number, pollSeconds: number): Map<number, PostWaitOutcome> {
		const out = new Map<number, PostWaitOutcome>();
		const waits = this.runWaits.get(runId);
		if (waits === undefined) return out;
		this.runWaits.delete(runId);
		const deadline = os.clock() + waitSeconds;
		const allDone = () => {
			for (const [, w] of waits) if (!w.done) return false;
			return true;
		};
		while (!allDone() && os.clock() < deadline) task.wait(pollSeconds);
		for (const [userId, w] of waits) {
			if (w.done && w.outcome !== undefined) out.set(userId, w.outcome);
			else this.waiters.cancel(w);
		}
		return out;
	}

	private topCache(ref: BoardRef): SharedTtlCache<string, BoardTop> {
		return this.cacheFor(this.top, ref);
	}

	/** Yesterday's (any past day's) daily board is settled: its long-lived cache; everything else the fresh one. */
	private cacheFor<V>(pair: CachePair<V>, ref: BoardRef): SharedTtlCache<string, V> {
		return ref.daily !== undefined && ref.daily.day < this.today() ? pair.settled : pair.fresh;
	}

	private invalidateDailyMine(ref: BoardRef, userId: number): void {
		const key = `${boardRefKey(ref)}:${userId}`;
		this.dailyMine.fresh.invalidate(key);
		this.dailyMine.settled.invalidate(key);
	}

	private fetchTop(ref: BoardRef): BoardTop {
		const entries = this.read(() => this.orderedStore(ref).top(LEADERBOARD_TOP_COUNT));
		const ids: number[] = [];
		for (const e of entries) {
			const id = userIdFromKey(e.key);
			if (id !== undefined) ids.push(id);
		}
		this.resolveNames(ids);
		return boardTopOf(entries, LEADERBOARD_TOP_COUNT);
	}

	/** The board's DAILY_HIST.shards shard documents, summed (one GetAsync each); throws if any read fails. */
	private fetchHistogram(ref: BoardRef): number[] {
		const raws: defined[] = [];
		for (let shard = 0; shard < DAILY_HIST.shards; shard++) {
			const key = histShardKey(ref, shard);
			const raw = this.read(() => this.histStore.get(key));
			if (raw !== undefined) raws.push(raw as defined);
		}
		return sumHistShards(raws);
	}

	/** A DataStore read with retries; throws the last error (the cache turns it into a stale / failed load). */
	private read<T>(fn: () => T): T {
		const r = withRetries(fn, LEADERBOARD_READ_RETRY, (s) => task.wait(s));
		if (!r.ok) error(r.error, 0);
		return r.value;
	}

	private orderedStore(ref: BoardRef): OrderedScoreStore {
		const key = boardRefKey(ref);
		let s = this.ordered.get(key);
		if (s === undefined) {
			const where = orderedStoreOf(ref);
			s = new OrderedDataStoreScores(where.name, where.scope);
			this.ordered.set(key, s);
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
			const o = outcome as PostOutcome;
			const ref = jobBoard(job);
			if (isDailyBoard(ref)) this.dailyWritten(ref, job.userId, job.value, o);
			else if (o.improved || o.detailsWritten) this.mineCache.invalidate(detailsKey(job.board, job.userId));
			log.info(
				"WRITTEN",
				`${boardRefKey(ref)} ${job.userId}: ${o.improved ? "new personal best" : "not a personal best"} (${
					job.value
				})`,
			);
			return;
		}
		const fate = retry ? this.queue.failed(q, os.clock()) : "dropped";
		if (fate === "dropped") this.waiters.dropped(postJobKey(job), job.value);
		log.warn(
			"WRITE_FAILED",
			`${boardRefKey(jobBoard(job))} ${job.userId} attempt ${q.attempts + 1} (${fate}): ${tostring(outcome)}`,
		);
	}

	/** A daily entry write landed: verdict waits, histogram delta, cached rows, the caller's entry, friends. */
	private dailyWritten(ref: BoardRef, userId: number, value: number, o: PostOutcome): void {
		this.waiters.written(postJobKey({ board: ref.board, scope: ref.scope, userId }), value, o.improved, o.previous);
		this.hist.add(ref, histDeltas(o.previous, value, o.improved));
		this.invalidateDailyMine(ref, userId);
		const entry = o.improved ? value : o.previous;
		if (entry === undefined) return;
		const key = boardRefKey(ref);
		this.top.fresh.patch(key, (top) => mergeEntry(top, userId, entry));
		this.top.settled.patch(key, (top) => mergeEntry(top, userId, entry));
		this.entryListener?.(ref, userId, entry);
	}

	/**
	 * Writes this server's buffered histogram deltas: one UpdateAsync per board and scope into this server's shard
	 * (adding counts). A failed write puts its counts back for the next flush. Each written count also goes into the
	 * cached sums, so the server's own entrants do not vanish until the next read.
	 */
	private flushHistogram(): number {
		const batch = this.hist.takeAll();
		for (const item of batch) {
			const key = histShardKey(item.ref, this.histShard);
			const [ok, err] = pcall(() => this.histStore.update(key, (old) => addHistCounts(old, item.counts)));
			if (!ok) {
				this.hist.restore(item.ref, item.counts);
				log.warn("HIST_FLUSH_FAILED", `${key}: ${tostring(err)}`);
				continue;
			}
			const cacheKey = boardRefKey(item.ref);
			this.histCache.fresh.patch(cacheKey, (c) => addCounts(c, item.counts));
			this.histCache.settled.patch(cacheKey, (c) => addCounts(c, item.counts));
		}
		return batch.size();
	}

	/**
	 * BindToClose (shared/leaderboard flushOnShutdown): within LEADERBOARD_SHUTDOWN_FLUSH_SECONDS, waits for runs still
	 * validating (solo finals, party runs) and drains the queue in a loop until it is empty, so posts that arrive
	 * during the flush are written too; a failed write is retried (rate and backoff ignored). Then the histogram
	 * buffer (the flushed writes' deltas included), within DAILY_HIST.shutdownFlushSeconds.
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
		this.flushHistogramOnShutdown();
	}

	/** The histogram buffer at shutdown: flushed in its own thread, waited for at most DAILY_HIST.shutdownFlushSeconds. */
	private flushHistogramOnShutdown(): void {
		if (this.hist.size() === 0) return;
		let done = false;
		let boards = 0;
		task.spawn(() => {
			boards = this.flushHistogram();
			done = true;
		});
		const deadline = os.clock() + DAILY_HIST.shutdownFlushSeconds;
		while (!done && os.clock() < deadline) task.wait();
		if (!done) log.warn("HIST_FLUSH_INCOMPLETE", `cut off after ${DAILY_HIST.shutdownFlushSeconds} s`);
		else if (boards > 0) log.info("HIST_FLUSHED", `${boards} board(s)`);
	}
}
