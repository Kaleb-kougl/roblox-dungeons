import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players } from "@rbxts/services";
import { dailyClockNow, dailySeed } from "server/config";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import { DAILY_REQUEST_RATE, DAILY_SERVICE, dailyDay, dailyStatusFor, type DailyStatus } from "shared/daily";
import { SlidingWindowLimiter } from "shared/run";

const log = serverLogger("Daily");

/**
 * The Daily's status (docs/DAILY.md DS4): today's day, label, seed, ruleset and reset time (shared/daily DailyStatus),
 * from the server's clock (`dailyClockNow`: Workspace:GetServerTimeNow, the clock clients count down with) and the
 * server-only secret seed (src/server/config daily.ts, DSD8: only today's seed is ever sent).
 *
 *   requestDaily   rate limited per player (DAILY_REQUEST_RATE; extra requests are dropped, the push covers them)
 *                  -> `dailyStatus` to that player
 *   day change     checked every DAILY_SERVICE.dayCheckSeconds; when the UTC day turns, every player in the server
 *                  gets the new `dailyStatus` (the client also re-asks once its own clock passes `resetsAt`)
 *
 * A daily run's seed is resolved by RunSessionService at start time from the same clock and secret (RunSessionDeps
 * .dailySeed), so the status and the run agree. Later phases add the player's best today and yesterday's podium to
 * the status (optional fields).
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

	onStart(): void {
		this.janitor.Add(
			Events.requestDaily.connect((player) => {
				if (player.Parent === undefined) return;
				if (!this.limiter.tryAcquire(player, os.clock())) {
					log.warn("RATE_LIMITED", `${player.UserId}: requestDaily dropped`);
					return;
				}
				Events.dailyStatus.fire(player, this.status());
			}),
		);
		this.janitor.Add(Players.PlayerRemoving.Connect((player) => this.limiter.forget(player)));
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

	/** The midnight push: when the UTC day turned since the last status, every player hears the new one. */
	private checkDay(): void {
		const before = this.current;
		const now = this.status();
		if (before === undefined || before.day === now.day) return;
		Events.dailyStatus.broadcast(now);
	}
}
