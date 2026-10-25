import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { UserInputService } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore, selectLeaderboardOpen } from "client/store";
import type { LeaderboardBoard } from "shared/leaderboard";
import { LEADERBOARD_KEY, LEADERBOARD_VIEW, SETTINGS_PAD_CLOSE_KEY } from "shared/view/hud";
import { SettingsController } from "./SettingsController";

/**
 * The leaderboard panel (M5): B (LEADERBOARD_KEY; N is the endless debug floor skip) toggles it (not while typing),
 * the pause overlay opens it, pad B or Close closes it. Opening it or switching tabs asks the server for that board (`getLeaderboard`), at most once per
 * LEADERBOARD_VIEW.refreshSeconds per board (the server caches its reads too); `leaderboard` answers fill the store.
 * Only one menu panel is open at a time: opening this closes the juice settings and the other way round. The run is
 * paused while either is open (SettingsController drives SimController.setUiPause from selectAnyPanelOpen).
 */
@Controller({})
export class LeaderboardController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly lastRequest = new Map<LeaderboardBoard, number>();

	constructor(private readonly settings: SettingsController) {}

	onStart(): void {
		this.janitor.Add(Events.leaderboard.connect((view) => clientStore.setLeaderboardView(view)));
		this.janitor.Add(
			UserInputService.InputBegan.Connect((input, processed) => {
				const open = selectLeaderboardOpen(clientStore.getState());
				if (open && input.KeyCode.Name === SETTINGS_PAD_CLOSE_KEY) {
					this.setOpen(false);
					return;
				}
				if (processed || input.KeyCode.Name !== LEADERBOARD_KEY) return;
				if (UserInputService.GetFocusedTextBox() !== undefined) return;
				this.setOpen(!open);
			}),
		);
	}

	setOpen(open: boolean): void {
		if (open) this.settings.setPanelOpen(false);
		clientStore.setLeaderboardOpen(open);
		if (open) this.request(clientStore.getState().leaderboard.board);
	}

	/** Shows a board (Solo / Co-op tab) and refreshes it if due. */
	showBoard(board: LeaderboardBoard): void {
		clientStore.setLeaderboardBoard(board);
		this.request(board);
	}

	private request(board: LeaderboardBoard): void {
		const now = os.clock();
		const last = this.lastRequest.get(board);
		if (last !== undefined && now - last < LEADERBOARD_VIEW.refreshSeconds) return;
		this.lastRequest.set(board, now);
		clientStore.setLeaderboardLoading(true);
		Events.getLeaderboard.fire(board);
	}
}
