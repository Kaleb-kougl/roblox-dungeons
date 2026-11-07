import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, Workspace } from "@rbxts/services";
import { clientStore, selectDailyStatus, selectMyLobby, selectScopedLeaderboard, type ClientState } from "client/store";
import { fetchHeadshot, onLocaleChanged } from "client/ui";
import { DAILY_WORLD_KIND } from "shared/daily";
import {
	LEADERBOARD_TOP_COUNT,
	leaderboardRequestKey,
	type LeaderboardBoard,
	type LeaderboardRequest,
} from "shared/leaderboard";
import { isDraftOpen } from "shared/sim";
import type { ColorRole, StringVars, ThemePack } from "shared/theme";
import {
	DAILY_RANK,
	DAILY_RANK_ROLE,
	DAILY_RANK_STRINGS,
	FLOOR_SHOUT_PRIORITY,
	NO_DAILY_RANK_CUES,
	PROGRESSION_VIEW,
	DailyRankTracker,
	dailyRankBaselineFrom,
	dailyRankRowText,
	dailyRankShoutKey,
	debugRankBaseline,
	parseDailyRankDebug,
	type DailyRankBaseline,
	type DailyRankCueSource,
	type DailyRankEntry,
	type DailyRankFrame,
	type DailyRankRow,
	type NewBestFrame,
	type NewBestInput,
	type RunBaseline,
} from "shared/view/hud";
import { AudioController } from "../audio/AudioController";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { LeaderboardController } from "../ui/LeaderboardController";
import { ComboController } from "./ComboController";
import { NewBestController, type NewBestRankLayer, type NewBestRowOverride } from "./NewBestController";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The two views of a board the baseline reads: today's top rows and the friends view. */
function todayRequests(board: LeaderboardBoard): LeaderboardRequest[] {
	return [
		{ board, scope: "today" },
		{ board, scope: "today", friends: true },
	];
}

/**
 * The Daily's in-run rank layer (docs/DAILY.md DS10). Presentation only, read-only on the sim.
 *
 *   boards     asks for today's views through LeaderboardController.request (its per-key refresh limit dedupes them with
 *              the menu's and the leaderboard panel's): the solo board's top rows and friends view whenever a daily
 *              status arrives and on every run exit (the menu), the co-op board's too while in a daily lobby, and the
 *              run's own board at a daily run's start (fresh for the next run: the server pushes the friends view as
 *              its lookups fill). The answers land in the store's `scoped` map.
 *   baseline   a NewBestRankLayer: NewBestController hands it each daily run's start with the frozen best-today
 *              baseline (unknown -> the rank layer is unknown too), and it freezes the rank baseline from the store as it
 *              is then (shared/view/hud dailyRankBaselineFrom: the run's board by party size, co-op runs on today's
 *              co-op board, the status day, the local player's own row dropped; KV_DailyRankDebug forces one in Studio).
 *              Headshots of the nearest friends still ahead are fetched at once (client/ui fetchHeadshot).
 *   frame      stepped by NewBestController right after its tracker (inside RoomClearController's scoreRoll frame, so
 *              before AudioController's cue mapper and ComboController's shout): the shown score (the team score in
 *              co-op, spectating included), the cover (as new best: an edge held under the stage cover fires on the
 *              reveal) and run over. It returns the target row once best today is passed (the next rung, #1, the next
 *              friend or the cut-off; text rebuilt only on a change), asks the floor shout for the highest threshold
 *              crossed (FLOOR_SHOUT_PRIORITY.rankThreshold: under new best's NEW BEST TODAY!, over a combo tier), and
 *              queues a toast per friend passed (ToastPanel, headshot by user id, `Beat Alex's high score (21900)`),
 *              shown one at a time (DAILY_RANK.toastSeconds + toastGapSec apart), waiting while the solo run is paused
 *              or a boon draft is open, dropped at run over. The friends passed go to the store's dailyRank slice for
 *              the run-over row (DailyPassedRow). Each friend toast also throws new best's gold edge confetti
 *              (wantsConfetti -> NewBestTracker.burstConfetti; skipped while a burst is still falling).
 *   sound      its frame is AudioController's DailyRankCueSource (setRankCues): rankUp on a threshold frame, friendPassed
 *              on a frame a friend toast shows; the mapper keeps one celebration sound per frame (new best first).
 * Reduced motion: nothing here moves (no confetti; the toast and the row are text; the shout's slide is
 * ComboController's, which already fades in place under reduced motion); text and sound stay.
 */
@Controller({})
export class DailyRankController implements OnStart, NewBestRankLayer {
	private readonly janitor = new Janitor();
	private tracker: DailyRankTracker | undefined;
	private topCount = LEADERBOARD_TOP_COUNT;
	private run = 0;
	private pack: ThemePack | undefined;
	private readonly rankCues: Mutable<DailyRankCueSource> = { rankUp: false, friendPassed: false };
	private cues: DailyRankCueSource = NO_DAILY_RANK_CUES;
	/** Friends passed this run (the run-over row) and the toasts still to show. */
	private readonly passed = new Array<DailyRankEntry>();
	private readonly toastQueue = new Array<DailyRankEntry>();
	private nextToastAt = 0;
	private toastSerial = 0;
	// --- what the row's strings were last built from ---
	private rowKind: DailyRankRow = "none";
	private rowFrom = -1;
	private rowTo = -1;
	private rowGap = -1;
	private rowFriend = -1;
	private row: NewBestRowOverride | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly newBest: NewBestController,
		private readonly combo: ComboController,
		private readonly audio: AudioController,
		private readonly leaderboard: LeaderboardController,
	) {}

	onStart(): void {
		this.pack = this.theme.getPack();
		this.newBest.setRankLayer(this);
		this.audio.setRankCues(() => this.cues);
		this.janitor.Add(
			clientStore.subscribe(
				(st: ClientState) => selectDailyStatus(st)?.day,
				(day) => {
					if (day !== undefined) this.requestMenuBoards();
				},
			),
		);
		this.janitor.Add(
			clientStore.subscribe(
				(st: ClientState) => selectMyLobby(st)?.worldKind,
				(world) => {
					if (world === DAILY_WORLD_KIND) this.requestMenuBoards();
				},
			),
		);
		this.sim.onRunExited(() => this.requestMenuBoards());
		// A locale switch (docs/LOCALIZATION.md L6): the target row's strings are rebuilt on the next frame (NaN never
		// equals the frame's gap). Toasts store their key and render in React; shouts read str when asked.
		this.janitor.Add(onLocaleChanged(() => (this.rowGap = 0 / 0)));
		if (selectDailyStatus(clientStore.getState()) !== undefined) this.requestMenuBoards();
	}

	// --- boards -----------------------------------------------------------------------------------------

	/** The menu's: solo always, co-op while in a daily lobby (its party run reads today's co-op board). */
	private requestMenuBoards(): void {
		if (selectDailyStatus(clientStore.getState()) === undefined) return;
		this.requestBoard("solo");
		if (selectMyLobby(clientStore.getState())?.worldKind === DAILY_WORLD_KIND) this.requestBoard("coop");
	}

	private requestBoard(board: LeaderboardBoard): void {
		for (const req of todayRequests(board)) this.leaderboard.request(req);
	}

	// --- NewBestRankLayer -------------------------------------------------------------------------------

	newRun(ctx: RunContext, baseline: RunBaseline): void {
		this.endRun();
		if (baseline.kind === "unranked") return;
		const board = baseline.board;
		this.run = ctx.counter;
		this.topCount = LEADERBOARD_TOP_COUNT;
		const rank = this.baselineOf(ctx, baseline);
		const tracker = new DailyRankTracker(rank);
		this.tracker = tracker;
		clientStore.setDailyPassed(ctx.counter, []);
		const ahead = tracker.friendsAhead();
		for (let i = 0; i < ahead.size() && i < DAILY_RANK.headshotPrefetch; i++) fetchHeadshot(ahead[i].userId);
		this.requestBoard(board);
		print(
			rank.kind === "known"
				? `[DailyRank] run ${ctx.counter} on ${board}: best ${rank.best}, ` +
						`${rank.rows?.size() ?? "no"} rows, ${rank.friends?.size() ?? "no"} friends`
				: `[DailyRank] run ${ctx.counter} on ${board}: baseline unknown (nothing in-run)`,
		);
	}

	/** The run's frozen rank baseline: KV_DailyRankDebug in Studio, else the store's board answers now. */
	private baselineOf(ctx: RunContext, baseline: RunBaseline): DailyRankBaseline {
		if (baseline.kind === "unranked" || baseline.kind === "unknown") return { kind: "unknown" };
		const debug = parseDailyRankDebug(Workspace.GetAttribute(DAILY_RANK.debugAttribute));
		if (debug !== undefined) return debugRankBaseline(debug, baseline.board, LEADERBOARD_TOP_COUNT);
		const st = clientStore.getState();
		const status = selectDailyStatus(st);
		if (status === undefined || status.seed !== ctx.seed) return { kind: "unknown" };
		const [top, friends] = todayRequests(baseline.board);
		return dailyRankBaselineFrom({
			board: baseline.board,
			best: baseline.score,
			day: status.day,
			top: selectScopedLeaderboard(leaderboardRequestKey(top))(st),
			friends: selectScopedLeaderboard(leaderboardRequestKey(friends))(st),
			selfUserId: Players.LocalPlayer.UserId,
			topCount: LEADERBOARD_TOP_COUNT,
		});
	}

	endRun(): void {
		this.tracker = undefined;
		this.cues = NO_DAILY_RANK_CUES;
		this.passed.clear();
		this.toastQueue.clear();
		this.nextToastAt = 0;
		this.row = undefined;
		this.rowKind = "none";
		this.rowFrom = -1;
		this.rowTo = -1;
		this.rowGap = -1;
		this.rowFriend = -1;
	}

	frame(_look: Readonly<NewBestFrame>, input: Readonly<NewBestInput>): NewBestRowOverride | undefined {
		const tracker = this.tracker;
		if (tracker === undefined) {
			this.cues = NO_DAILY_RANK_CUES;
			return undefined;
		}
		const f = tracker.frame({ shownScore: input.shownScore, underCover: input.underCover, runOver: input.runOver });
		const cues = this.rankCues;
		cues.rankUp = false;
		cues.friendPassed = false;
		if (f.threshold > 0) this.shout(f.threshold);
		if (f.passed.size() > 0) {
			for (const friend of f.passed) {
				this.passed.push(friend);
				this.toastQueue.push(friend);
				fetchHeadshot(friend.userId);
			}
			const copy = new Array<DailyRankEntry>();
			for (const friend of this.passed) copy.push(friend);
			clientStore.setDailyPassed(this.run, copy);
		}
		if (input.runOver) this.toastQueue.clear();
		else if (!input.underCover) this.showToast();
		this.cues = cues;
		return this.rowOf(f);
	}

	/** A friend toast showed this frame: NewBestController throws the in-run confetti with it. */
	wantsConfetti(): boolean {
		return this.cues.friendPassed;
	}

	// --- beats ------------------------------------------------------------------------------------------

	/** The threshold's floor shout (under new best's, over a tier shout) and its sting. */
	private shout(threshold: number): void {
		const key = dailyRankShoutKey(threshold);
		if (key === undefined) return;
		this.combo.requestShout(
			this.str(key),
			this.color(DAILY_RANK_ROLE),
			DAILY_RANK.shoutLifeSec,
			FLOOR_SHOUT_PRIORITY.rankThreshold,
		);
		this.rankCues.rankUp = true;
	}

	/** The next queued friend toast, when its turn came and nothing holds it (the solo pause, an open boon draft). */
	private showToast(): void {
		if (this.toastQueue.size() === 0) return;
		const now = os.clock();
		if (now < this.nextToastAt) return;
		const ctx = this.sim.getContext();
		if (ctx === undefined || ctx.live?.isPaused() === true || isDraftOpen(ctx.run.state)) return;
		const friend = this.toastQueue.remove(0)!;
		this.toastSerial++;
		clientStore.pushToast(
			{
				id: DAILY_RANK.toastIdBase - this.toastSerial,
				key: DAILY_RANK_STRINGS.passed,
				args: { name: friend.name, score: tostring(friend.score) },
				headshotUserId: friend.userId,
				until: now + DAILY_RANK.toastSeconds,
			},
			PROGRESSION_VIEW.maxToasts,
		);
		this.nextToastAt = now + DAILY_RANK.toastSeconds + DAILY_RANK.toastGapSec;
		this.rankCues.friendPassed = true;
	}

	// --- the row ----------------------------------------------------------------------------------------

	/** The target row past best today (rebuilt only when what it shows changed), or undefined (new best's text). */
	private rowOf(f: Readonly<DailyRankFrame>): NewBestRowOverride | undefined {
		const friendId = f.friend?.userId ?? -1;
		if (
			f.row === this.rowKind &&
			f.fromRank === this.rowFrom &&
			f.toRank === this.rowTo &&
			f.gap === this.rowGap &&
			friendId === this.rowFriend
		) {
			return this.row;
		}
		this.rowKind = f.row;
		this.rowFrom = f.fromRank;
		this.rowTo = f.toRank;
		this.rowGap = f.gap;
		this.rowFriend = friendId;
		const s = (key: string, vars?: StringVars) => this.str(key, vars);
		const text = dailyRankRowText(f, false, this.topCount, s);
		const compact = dailyRankRowText(f, true, this.topCount, s);
		this.row =
			text !== undefined && compact !== undefined
				? { text, compact, color: this.color(DAILY_RANK_ROLE) }
				: undefined;
		return this.row;
	}

	private str(key: string, vars?: StringVars): string {
		return this.pack?.str(key, vars) ?? key;
	}

	private color(roleName: string): Color3 {
		return this.pack?.color(roleName as ColorRole) ?? new Color3();
	}
}
