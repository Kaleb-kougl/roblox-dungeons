import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players } from "@rbxts/services";
import { dailyClockNow, dailySeed } from "server/config";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import {
	DAILY,
	DAILY_REQUEST_RATE,
	DAILY_SERVICE,
	dailyDay,
	dailyStatusFor,
	type DailyMine,
	type DailyPodium,
	type DailyStatus,
} from "shared/daily";
import { LEADERBOARD_BOARDS, dailyBoard } from "shared/leaderboard";
import { SlidingWindowLimiter } from "shared/run";
import { LeaderboardService } from "./LeaderboardService";

const log = serverLogger("Daily");

/** A player's board parts of the status, for one day. */
interface PersonalStatus {
	readonly day: number;
	readonly mine?: DailyMine;
	readonly podium?: DailyPodium;
}

/**
 * The Daily's status (docs/DAILY.md DS4, DS5, DS8): today's day, label, seed, ruleset and reset time (shared/daily
 * DailyStatus), from the server's clock (`dailyClockNow`: Workspace:GetServerTimeNow, the clock clients count down with)
 * and the server-only secret seed (src/server/config daily.ts, DSD8: only today's seed is ever sent), plus each
 * player's own board parts: `mine` (their entries today on the solo / co-op daily boards with rank / percentile) and
 * `podium` (yesterday's solo top 3 and their final entry), read through LeaderboardService's caches.
 *
 *   requestDaily   rate limited per player (DAILY_REQUEST_RATE; extra requests are dropped, the push covers them)
 *                  -> `dailyStatus` at once (with the board parts last read for that player today, if any), then
 *                  again once the board parts are read (`refresh`)
 *   day change     checked every DAILY_SERVICE.dayCheckSeconds; when the UTC day turns, every player in the server
 *                  gets the new `dailyStatus` (no entries yet), then their refreshed one (yesterday's podium); the
 *                  client also re-asks once its own clock passes `resetsAt`
 *   verdicts       RunSessionService calls `refresh` for each member after a daily run's verdict
 *
 * A daily run's seed is resolved by RunSessionService at start time from the same clock and secret (RunSessionDeps
 * .dailySeed), so the status and the run agree.
 */
@Service({})
export class DailyService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly limiter = new SlidingWindowLimiter<Player>(
		DAILY_REQUEST_RATE.count,
		DAILY_REQUEST_RATE.windowSeconds,
	);
	/** Today's status (rebuilt when the day turns). */
	private current: DailyStatus | undefined;
	private readonly personal = new Map<Player, PersonalStatus>();
	/** Players whose board parts are being read; `true` = asked again meanwhile (read once more after). */
	private readonly refreshing = new Map<Player, boolean>();

	constructor(private readonly leaderboards: LeaderboardService) {}

	onStart(): void {
		this.janitor.Add(
			Events.requestDaily.connect((player) => {
				if (player.Parent === undefined) return;
				if (!this.limiter.tryAcquire(player, os.clock())) {
					log.warn("RATE_LIMITED", `${player.UserId}: requestDaily dropped`);
					return;
				}
				Events.dailyStatus.fire(player, this.statusFor(player));
				this.refresh(player);
			}),
		);
		this.janitor.Add(
			Players.PlayerRemoving.Connect((player) => {
				this.limiter.forget(player);
				this.personal.delete(player);
				this.refreshing.delete(player);
			}),
		);
		this.status();
		const watch = task.spawn(() => {
			for (;;) {
				task.wait(DAILY_SERVICE.dayCheckSeconds);
				this.checkDay();
			}
		});
		this.janitor.Add(() => task.cancel(watch));
	}

	/** Today's status (the day of the server's clock now). Public so a Studio command bar can read it. */
	status(): DailyStatus {
		const day = dailyDay(dailyClockNow());
		const current = this.current;
		if (current !== undefined && current.day === day) return current;
		const status = dailyStatusFor(day, dailySeed(day));
		this.current = status;
		log.info("DAY", `Daily #${status.label} (day ${day}, ruleset ${status.ruleset})`);
		return status;
	}

	/** Today's status for `player`, with the board parts last read for them today (none after the day turned). */
	statusFor(player: Player): DailyStatus {
		const base = this.status();
		const mineParts = this.personal.get(player);
		if (mineParts === undefined || mineParts.day !== base.day) return base;
		const out: DailyStatus = { ...base };
		if (mineParts.mine !== undefined) out.mine = mineParts.mine;
		if (mineParts.podium !== undefined) out.podium = mineParts.podium;
		return out;
	}

	/**
	 * Reads `player`'s board parts (their entries today, yesterday's podium) in its own thread and sends them the
	 * status. Concurrent calls for one player coalesce into one more read after the current one.
	 */
	refresh(player: Player): void {
		if (this.refreshing.has(player)) {
			this.refreshing.set(player, true);
			return;
		}
		this.refreshing.set(player, false);
		task.spawn(() => {
			for (;;) {
				const [ok, err] = pcall(() => this.readPersonal(player));
				if (!ok) log.warn("REFRESH_FAILED", `${player.UserId}: ${tostring(err)}`);
				if (player.Parent !== undefined) Events.dailyStatus.fire(player, this.statusFor(player));
				if (this.refreshing.get(player) !== true) break;
				this.refreshing.set(player, false);
			}
			this.refreshing.delete(player);
		});
	}

	/** Reads (through LeaderboardService's caches; yields) and stores `player`'s board parts for today. */
	private readPersonal(player: Player): void {
		const day = this.status().day;
		const key = { day, ruleset: DAILY.ruleset };
		let mine: DailyMine | undefined;
		for (const board of LEADERBOARD_BOARDS) {
			const entry = this.leaderboards.dailyMineOf(dailyBoard(board, key), player.UserId);
			if (entry === undefined) continue;
			mine = mine ?? {};
			mine[board] = entry;
		}
		const podium = this.leaderboards.podiumOf(
			dailyBoard("solo", { day: day - 1, ruleset: DAILY.ruleset }),
			player.UserId,
		);
		if (player.Parent === undefined || this.status().day !== day) return;
		this.personal.set(player, { day, mine, podium });
	}

	/** The midnight push: when the UTC day turned since the last status, every player hears the new one. */
	private checkDay(): void {
		const before = this.current;
		const now = this.status();
		if (before === undefined || before.day === now.day) return;
		Events.dailyStatus.broadcast(now);
		for (const player of Players.GetPlayers()) this.refresh(player);
	}
}
