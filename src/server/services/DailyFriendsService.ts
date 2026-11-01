import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, Workspace } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import { DAILY_FRIENDS } from "shared/daily";
import {
	FriendLookupQueue,
	dailyStanding,
	friendsRows,
	mergeEntry,
	mineFromOrderedValue,
	orderFriends,
	parseFakeFriends,
	type BoardRef,
	type FriendLookup,
	type LeaderboardRequest,
	type LeaderboardView,
} from "shared/leaderboard";
import { LeaderboardService } from "./LeaderboardService";

const log = serverLogger("DailyFriends");

/** A player's friends list (fetched once per session). */
interface FriendsList {
	ids?: number[];
	loading: boolean;
	/** os.clock of the last failed fetch (retried after DAILY_FRIENDS.listRetrySeconds). */
	failedAt?: number;
}

/** A friends view still filling in: pushed again as its lookups resolve. */
interface Watch {
	readonly request: LeaderboardRequest;
	readonly ref: BoardRef;
	readonly ids: number[];
	readonly since: number;
	lastPush: number;
	lastPending: number;
}

/**
 * Friends on the daily boards (docs/DAILY.md "6. Friends", DS7, DSD16; pure rules in shared/leaderboard friends.ts).
 *
 *   friends list   `Players:GetFriendsAsync` once per player per session, paged up to DAILY_FRIENDS.max (names kept
 *                  for the rows). Studio: the Workspace attribute KV_FakeFriends (UserIds) instead, since the friends
 *                  API does not work there.
 *   lookups        a friend in the board's top rows is free (or known absent on a complete board); every other friend
 *                  is one GetAsync on the day's ordered store through ONE queue per server, friends in this server
 *                  first, then list order, under DAILY_FRIENDS.readsPerMinute, cached per (board, scope, userId) and
 *                  shared by every player here (FriendLookupQueue); an answer older than DAILY_FRIENDS.refreshSeconds
 *                  keeps showing while it is re-read behind every never-read friend; a leaver's queued lookups nobody
 *                  else needs are dropped. Entries this server writes are learned for free
 *                  (LeaderboardService.setDailyEntryListener).
 *   the view       `getLeaderboard({ board, scope: "today" | "yesterday", friends: true })` (LeaderboardService hands
 *                  it here): the caller's friends with an entry, ranked among themselves, the caller included, with
 *                  `pending` = friends never read yet. While it fills in, an updated view is pushed at most every
 *                  DAILY_FRIENDS.progressPushSeconds (and when it is complete), for DAILY_FRIENDS.watchSeconds.
 */
@Service({})
export class DailyFriendsService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly queue = new FriendLookupQueue();
	private readonly lists = new Map<number, FriendsList>();
	private readonly watches = new Map<Player, Watch>();

	constructor(private readonly leaderboards: LeaderboardService) {}

	onStart(): void {
		this.leaderboards.setFriendsView((player, request, ref) => this.view(player, request, ref));
		this.leaderboards.setDailyEntryListener((ref, userId, value) =>
			this.queue.learn(ref, userId, value, os.clock()),
		);
		this.janitor.Add(
			Players.PlayerRemoving.Connect((player) => {
				this.lists.delete(player.UserId);
				this.watches.delete(player);
				// Their queued lookups nobody else here needs are dropped (answers they shared stay until stale).
				this.queue.forget(player.UserId, os.clock());
			}),
		);
		const pump = task.spawn(() => {
			for (;;) {
				task.wait(DAILY_FRIENDS.pumpSeconds);
				this.pump();
			}
		});
		this.janitor.Add(() => task.cancel(pump));
	}

	/** The friends view of `ref` for `player` (yields: the friends list on first use, the board's cached reads). */
	view(player: Player, request: LeaderboardRequest, ref: BoardRef): LeaderboardView {
		const friendIds = this.friendsOf(player);
		if (friendIds === undefined) return this.leaderboards.unavailable(request, ref, "friends unavailable");
		const loaded = this.leaderboards.loadTopWithStale(ref);
		if (loaded === undefined) return this.leaderboards.unavailable(request, ref, "leaderboard unavailable");
		const now = os.clock();
		const ids = orderFriends(friendIds, (id) => Players.GetPlayerByUserId(id) !== undefined, player.UserId);
		let inServer = 0;
		for (const id of ids) if (Players.GetPlayerByUserId(id) !== undefined) inServer++;
		this.queue.learnFromTop(ref, loaded.top, ids, now);
		const pending = this.queue.request(ref, ids, inServer, now, player.UserId);
		const view = this.build(player, request, ref, ids, pending);
		if (pending > 0) {
			this.watches.set(player, { request, ref, ids, since: now, lastPush: now, lastPending: pending });
		} else {
			this.watches.delete(player);
		}
		return view;
	}

	/** The view from what is known now (cached reads only, apart from the caller's own entry on a miss). */
	private build(
		player: Player,
		request: LeaderboardRequest,
		ref: BoardRef,
		ids: ReadonlyArray<number>,
		pending: number,
	): LeaderboardView {
		const loaded = this.leaderboards.loadTopWithStale(ref);
		if (loaded === undefined) return this.leaderboards.unavailable(request, ref, "leaderboard unavailable");
		const top = loaded.top;
		const callerValue = this.leaderboards.dailyEntry(ref, player.UserId, top);
		const rows = friendsRows(
			player.UserId,
			callerValue,
			ids,
			(id) => {
				const a = this.queue.answer(ref, id);
				return a.known ? a.value : undefined;
			},
			(id) => this.leaderboards.nameOf(id),
		);
		const view: LeaderboardView = {
			...this.leaderboards.viewHeader(request, ref),
			ok: true,
			stale: loaded.stale,
			rows,
			pending,
		};
		// The caller's own line keeps their GLOBAL standing (rank in the top rows, percentile); `rows` rank friends.
		if (callerValue !== undefined) {
			const merged = mergeEntry(top, player.UserId, callerValue);
			const standing = dailyStanding(player.UserId, callerValue, merged, this.leaderboards.histogram(ref));
			const mine = mineFromOrderedValue(callerValue, [], player.UserId)!;
			mine.rank = standing.rank;
			mine.percentile = standing.percentile;
			view.mine = mine;
			view.total = standing.total;
		}
		return view;
	}

	/** Starts every lookup the budget allows now (each read in its own thread) and pushes filling-in views. */
	private pump(): void {
		let lookup = this.queue.take(os.clock());
		while (lookup !== undefined) {
			const l = lookup;
			task.spawn(() => this.lookUp(l));
			lookup = this.queue.take(os.clock());
		}
		const now = os.clock();
		for (const [player, w] of this.watches) {
			if (player.Parent === undefined || now - w.since > DAILY_FRIENDS.watchSeconds) {
				this.watches.delete(player);
				continue;
			}
			const pending = this.queue.pending(w.ref, w.ids);
			if (pending === w.lastPending) continue;
			if (pending > 0 && now - w.lastPush < DAILY_FRIENDS.progressPushSeconds) continue;
			w.lastPending = pending;
			w.lastPush = now;
			if (pending === 0) this.watches.delete(player);
			task.spawn(() => {
				const view = this.build(player, w.request, w.ref, w.ids, pending);
				if (player.Parent !== undefined) Events.leaderboard.fire(player, view);
			});
		}
	}

	private lookUp(lookup: FriendLookup): void {
		const [ok, value] = pcall(() => this.leaderboards.readEntry(lookup.ref, lookup.userId));
		if (ok) this.queue.resolve(lookup, value as number | undefined, os.clock());
		else {
			this.queue.failed(lookup);
			log.warn("LOOKUP_FAILED", `${lookup.userId}: ${tostring(value)}`);
		}
	}

	/**
	 * `player`'s friends (UserIds, list order), fetched once per session (yields on the first call; concurrent callers
	 * wait for it); undefined when the list cannot be had (a failed fetch is retried after listRetrySeconds).
	 */
	private friendsOf(player: Player): number[] | undefined {
		let list = this.lists.get(player.UserId);
		if (list === undefined) {
			list = { loading: false };
			this.lists.set(player.UserId, list);
		}
		while (list.loading) task.wait();
		if (list.ids !== undefined) return list.ids;
		if (list.failedAt !== undefined && os.clock() - list.failedAt < DAILY_FRIENDS.listRetrySeconds)
			return undefined;
		list.loading = true;
		const [ok, ids] = pcall(() => this.fetchFriends(player));
		list.loading = false;
		if (!ok) {
			list.failedAt = os.clock();
			log.warn("LIST_FAILED", `${player.UserId}: ${tostring(ids)}`);
			return undefined;
		}
		list.ids = ids as number[];
		return list.ids;
	}

	/** Studio: KV_FakeFriends (none when unset). Live: GetFriendsAsync, paged, up to DAILY_FRIENDS.max. */
	private fetchFriends(player: Player): number[] {
		if (RunService.IsStudio()) {
			const fake = parseFakeFriends(Workspace.GetAttribute(DAILY_FRIENDS.fakeAttribute)) ?? [];
			this.leaderboards.resolveNames(fake);
			return fake;
		}
		const ids: number[] = [];
		// The typings take the `User` datatype; the engine takes the numeric UserId (as LobbyService's asUserParam).
		const pages = Players.GetFriendsAsync(player.UserId as unknown as User);
		for (;;) {
			for (const item of pages.GetCurrentPage()) {
				if (ids.size() >= DAILY_FRIENDS.max) break;
				ids.push(item.Id);
				const display = (item as unknown as { DisplayName?: unknown }).DisplayName;
				this.leaderboards.rememberName(item.Id, typeIs(display, "string") ? display : item.Username);
			}
			if (pages.IsFinished || ids.size() >= DAILY_FRIENDS.max) break;
			pages.AdvanceToNextPageAsync();
		}
		return ids;
	}
}
