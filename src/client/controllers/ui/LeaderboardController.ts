import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { UserInputService } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore, selectBindings, selectInputCaptured, selectLeaderboardOpen } from "client/store";
import { leaderboardRequestKey, type LeaderboardBoard, type LeaderboardRequest } from "shared/leaderboard";
import { inputsFor } from "shared/play";
import { LEADERBOARD_VIEW, leaderboardTabRequest, type LeaderboardTabs } from "shared/view/hud";
import { SettingsController } from "./SettingsController";

/**
 * The leaderboard panel (M5): the bound leaderboard key (default B, LEADERBOARD_KEY; N is the endless debug floor
 * skip; rebindable since task L4b) toggles it (not while typing, not during a rebind capture), the pause overlay
 * opens it, pad B (its focus scope: FocusController, docs/GAMEPAD_MENUS.md GM3) or Close closes it. Opening it or
 * switching tabs asks the server for that board (`getLeaderboard`), at most once per LEADERBOARD_VIEW.refreshSeconds
 * per board (the server caches its reads too); `leaderboard` answers fill the store.
 * Only one menu panel is open at a time: opening this closes the juice settings and the other way round. The run is
 * paused while either is open (SettingsController drives SimController.setUiPause from selectAnyPanelOpen).
 */
@Controller({})
export class LeaderboardController implements OnStart {
	private readonly janitor = new Janitor();
	/** Last request time per leaderboardRequestKey. */
	private readonly lastRequest = new Map<string, number>();

	constructor(private readonly settings: SettingsController) {}

	onStart(): void {
		this.janitor.Add(Events.leaderboard.connect((view) => clientStore.setLeaderboardView(view)));
		this.janitor.Add(
			UserInputService.InputBegan.Connect((input, processed) => {
				const state = clientStore.getState();
				if (selectInputCaptured(state)) return; // a rebind capture owns this input
				const open = selectLeaderboardOpen(state);
				if (processed) return;
				// The bound leaderboard key(s) (default B; a slot may hold a mouse button).
				const t = input.UserInputType.Name;
				const name = t === "Keyboard" ? input.KeyCode.Name : t;
				if (!inputsFor(selectBindings(state), "kbm", "leaderboard").includes(name)) return;
				if (UserInputService.GetFocusedTextBox() !== undefined) return;
				this.setOpen(!open);
			}),
		);
	}

	setOpen(open: boolean): void {
		if (open) this.settings.setPanelOpen(false);
		clientStore.setLeaderboardOpen(open);
		if (open) {
			const lb = clientStore.getState().leaderboard;
			this.request(leaderboardTabRequest({ board: lb.board, scope: lb.scope, friends: lb.friends }));
		}
	}

	/** Shows the panel's tabs (docs/DAILY.md DS9: scope x board x Global / Friends) and refreshes that view if due. */
	showTabs(tabs: LeaderboardTabs): void {
		clientStore.setLeaderboardTabs(tabs);
		this.request(leaderboardTabRequest(tabs));
	}

	/** Shows a board (Solo / Co-op tab) and refreshes it if due. */
	showBoard(board: LeaderboardBoard): void {
		const lb = clientStore.getState().leaderboard;
		this.showTabs({ board, scope: lb.scope, friends: lb.friends });
	}

	/**
	 * Asks for a board view (all-time, or a daily scope / friends view: docs/DAILY.md DS5 / DS7), at most once per
	 * LEADERBOARD_VIEW.refreshSeconds per board, scope and friends flag. Daily views land in the store's `scoped`.
	 */
	request(request: LeaderboardRequest): void {
		const key = leaderboardRequestKey(request);
		const now = os.clock();
		const last = this.lastRequest.get(key);
		if (last !== undefined && now - last < LEADERBOARD_VIEW.refreshSeconds) return;
		this.lastRequest.set(key, now);
		clientStore.setLeaderboardLoading(true);
		Events.getLeaderboard.fire(request);
	}
}
