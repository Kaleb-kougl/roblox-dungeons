import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { logInfo } from "client/log";
import { Events } from "client/network";
import { clientStore, selectDailyStatus } from "client/store";
import { nextDailyRequestAt } from "shared/daily";

/**
 * The Daily's status on the client (docs/DAILY.md DS4): asks the server (`requestDaily`) on start (the join), keeps
 * every `dailyStatus` answer or midnight push in the Reflex `daily` slice, and asks again when the server clock
 * (Workspace:GetServerTimeNow, the clock the server counts days with) passes the status's `resetsAt`, then while the
 * answer is still the old day, or while no answer came at all (shared/daily nextDailyRequestAt, DAILY_CLIENT pacing).
 * The server rate limits `requestDaily` (DAILY_REQUEST_RATE); this stays well under it.
 */
@Controller({})
export class DailyController implements OnStart {
	private readonly janitor = new Janitor();
	/** Server-clock time of the last `requestDaily`. */
	private askedAt = 0;
	/** Server-clock time of the next `requestDaily`. */
	private nextAt = 0;

	onStart(): void {
		this.janitor.Add(
			Events.dailyStatus.connect((status) => {
				const before = selectDailyStatus(clientStore.getState());
				if (before === undefined || before.day !== status.day) {
					logInfo(`[Daily] Daily #${status.label} (day ${status.day}, seed ${status.seed})`);
				}
				clientStore.setDailyStatus(status);
				this.nextAt = nextDailyRequestAt(status, this.askedAt);
			}),
		);
		this.janitor.Add(
			RunService.Heartbeat.Connect(() => {
				if (Workspace.GetServerTimeNow() >= this.nextAt) this.request();
			}),
		);
		this.request();
	}

	/** Asks for the status now (also the menu's way to refresh it). */
	request(): void {
		this.askedAt = Workspace.GetServerTimeNow();
		this.nextAt = nextDailyRequestAt(selectDailyStatus(clientStore.getState()), this.askedAt);
		Events.requestDaily.fire();
	}
}
