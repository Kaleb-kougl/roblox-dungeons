import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, TextChatService, UserInputService, Workspace } from "@rbxts/services";
import {
	clientStore,
	selectAnyPanelOpen,
	selectMenuScreen,
	selectMyLobbyId,
	selectSnapshot,
	selectStageCovered,
	type ClientState,
} from "client/store";
import { DAILY_WORLD_KIND } from "shared/daily";
import type { LobbyVisibility } from "shared/lobby";
import type { FirstRunDecision } from "shared/tutorial";
import { FIXED_INPUTS, RUN_ATTRIBUTES } from "shared/play";
import { DAILY_MENU, LOBBY_ROOM_PATH, MENU_BACK_KEYS, afterRunPath, lobbyChangePath } from "shared/view/menu";
import { SFX } from "shared/view/audio";
import { AudioController } from "../audio/AudioController";
import { SimController } from "../game/SimController";
import { TutorialController } from "../game/TutorialController";
import { LeaderboardController } from "./LeaderboardController";
import { LobbyController } from "./LobbyController";
import { SettingsController } from "./SettingsController";

/** A TextBox has focus, or the TextChatService chat bar (CoreGui, invisible to GetFocusedTextBox): typing, not keys. */
function typing(): boolean {
	if (UserInputService.GetFocusedTextBox() !== undefined) return true;
	const bar = TextChatService.FindFirstChildOfClass("ChatInputBarConfiguration");
	return bar !== undefined && bar.IsFocused;
}

/**
 * The menu shell (task L3) and the client half of Leave run (task L6).
 *
 *   join       once the first-run gate decided (TutorialController.onFirstRunDecided; nothing shows but the backdrop
 *              until then): a first-time player goes straight into the tutorial (no menu); everyone else gets the
 *              MAIN MENU instead of a run, or the lobby room when an invite / party arrival already put them in a
 *              lobby (docs/INVITES.md ID1 / ID6) (KV_SkipMenu = true: a solo run starts at once, as before)
 *   screens    main / lobbies / lobby with a back stack (Reflex `menu`, shared/view/menu menuNavReduce); pad B and
 *              Backspace go back (not while a juice settings / leaderboard panel is open: B closes those)
 *   runs       any run start closes the menu; leaving a run (Leave run, run-over Main menu / Back to lobby)
 *              opens the lobby room while in a lobby, else the main menu (SimController.onRunExited)
 *   lobby      joining or creating a lobby opens its room, and so does a lobby the server put this player in (an
 *              invite / party arrival) while a menu screen is up; leaving it (or being kicked) goes back to the
 *              browser (shared/view/menu lobbyChangePath). Never during a run, the tutorial or the first-run wait.
 *   invites    a menu screen opening (from none) asks for Roblox invite eligibility again when the cached answer
 *              is old (LobbyController.refreshEligibility)
 *   co-op      party runs never pause, so the pause key (P / Start) opens the non-pausing party overlay instead
 *              (Resume / Leave run / settings / leaderboards; Leave run -> lockstepLeave, then the lobby room, which
 *              shows "Run in progress" until the lobby is back to forming)
 */
@Controller({ loadOrder: 900 })
export class MenuController implements OnStart {
	private readonly janitor = new Janitor();
	/** A menu panel was open at the end of the last frame (its pad B close must not also go back a screen). */
	private panelOpenLastFrame = false;

	constructor(
		private readonly sim: SimController,
		private readonly lobby: LobbyController,
		private readonly settings: SettingsController,
		private readonly leaderboard: LeaderboardController,
		private readonly tutorial: TutorialController,
		private readonly audio: AudioController,
	) {}

	onStart(): void {
		this.sim.onRunStarted(() => {
			clientStore.menuNav({ kind: "close" });
			this.closeOverlays();
		});
		this.sim.onRunExited((how) => {
			this.closeOverlays();
			clientStore.menuNav({ kind: "reset", path: afterRunPath(this.inLobby()) });
			print(
				`[Menu] run ${how === "left" ? "left" : "over"}: back to the ${this.inLobby() ? "lobby" : "main menu"}`,
			);
		});
		this.janitor.Add(clientStore.subscribe(selectMyLobbyId, (id, prev) => this.onLobbyChanged(id, prev)));
		this.janitor.Add(
			clientStore.subscribe(selectMenuScreen, (screen, prev) => {
				if (screen === "lobbies") this.lobby.requestList();
				if (prev === "none" && screen !== "none") this.lobby.refreshEligibility();
			}),
		);
		this.janitor.Add(
			clientStore.subscribe(selectSnapshot, (s) => {
				const menu = clientStore.getState().menu;
				// The run ended (or resumed): the overlays and the Leave run confirm close with it.
				if (s.outcome !== "playing") this.closeOverlays();
				else if (!s.paused && !menu.coopOverlay && menu.leaveConfirm) clientStore.setLeaveConfirm(false);
			}),
		);
		this.janitor.Add(
			RunService.RenderStepped.Connect(() => {
				this.panelOpenLastFrame = selectAnyPanelOpen(clientStore.getState());
			}),
		);
		this.janitor.Add(UserInputService.InputBegan.Connect((input) => this.onInput(input)));

		this.tutorial.onFirstRunDecided((choice) => this.onFirstRunDecided(choice));
	}

	/** The join flow, once the first-run gate decided: the tutorial (started by TutorialController), else the menu. */
	private onFirstRunDecided(choice: FirstRunDecision): void {
		clientStore.setAwaitingFirstRun(false);
		if (choice === "tutorial") return; // straight into the tutorial: no main menu first
		if (Workspace.GetAttribute(RUN_ATTRIBUTES.skipMenu) === true) {
			print(`[Menu] ${RUN_ATTRIBUTES.skipMenu}: no main menu, starting a solo run`);
			const daily = Workspace.GetAttribute(RUN_ATTRIBUTES.daily) === true;
			this.sim.startSolo(undefined, daily ? DAILY_WORLD_KIND : undefined);
		} else {
			// An invite / party arrival may already have put them in a lobby: its room (else the main menu).
			clientStore.menuNav({ kind: "reset", path: afterRunPath(this.inLobby()) });
		}
	}

	/** The main menu's "Invite friends": Roblox's invite prompt without a lobby (docs/INVITES.md ID7). */
	inviteFriends(): void {
		this.lobby.invitePrompt(false);
	}

	/** The lobby room's "Invite friends (Roblox)": the prompt with this player's lobby attached. */
	inviteFriendsToLobby(): void {
		this.lobby.invitePrompt(true);
	}

	// --- actions (client/ui/menu MenuActions, the pause overlay, the run-over panel) -------------

	playSolo(): void {
		if (Workspace.GetAttribute(RUN_ATTRIBUTES.daily) === true) {
			print(`[Menu] ${RUN_ATTRIBUTES.daily}: Play solo starts the Daily`);
			this.playDaily();
			return;
		}
		this.sim.startSolo();
		clientStore.menuNav({ kind: "close" }); // "Starting run..." shows while the server answers
	}

	/** The Daily (docs/DAILY.md): a ranked solo run in world "daily"; the server picks the day's seed. */
	playDaily(): void {
		this.sim.startSolo(undefined, DAILY_WORLD_KIND);
		clientStore.menuNav({ kind: "close" });
	}

	/**
	 * "Daily with friends" (docs/DAILY.md DS9): already in a lobby -> its room, switched to the Daily when this player
	 * hosts it and it is forming (others cannot change it: the room shows its world); else a new lobby on the daily world
	 * (DAILY_MENU.partyVisibility: the host's friends see it), whose room opens when the server confirms it.
	 */
	playDailyParty(): void {
		const mine = clientStore.getState().lobby.mine;
		if (mine === undefined) {
			this.lobby.create(DAILY_MENU.partyVisibility, DAILY_WORLD_KIND);
			return;
		}
		if (
			mine.hostId === Players.LocalPlayer.UserId &&
			mine.phase === "forming" &&
			mine.worldKind !== DAILY_WORLD_KIND
		) {
			this.lobby.setWorld(DAILY_WORLD_KIND);
		}
		this.openLobbyRoom();
	}

	openLobbies(): void {
		clientStore.menuNav({ kind: "open", screen: "lobbies" });
		this.lobby.requestList();
	}

	openLobbyRoom(): void {
		clientStore.menuNav({ kind: "reset", path: LOBBY_ROOM_PATH });
	}

	/** Options: the juice settings panel for now (a full Options screen replaces it later). */
	openOptions(): void {
		this.settings.setPanelOpen(true);
	}

	openLeaderboard(): void {
		this.leaderboard.setOpen(true);
	}

	/** Credits: a menu screen over the main menu (Back returns to it). */
	openCredits(): void {
		clientStore.menuNav({ kind: "open", screen: "credits" });
	}

	back(): void {
		clientStore.menuNav({ kind: "back" });
	}

	createLobby(visibility: LobbyVisibility): void {
		this.lobby.create(visibility);
	}

	setLeaveConfirm(open: boolean): void {
		clientStore.setLeaveConfirm(open);
	}

	/** Leave run (after the confirm): solo forfeits (a death, submitted), co-op sends lockstepLeave; then the menu. */
	leaveRun(): void {
		this.closeOverlays();
		this.sim.leaveRun();
	}

	/** Run-over "Main menu" / "Back to lobby". */
	exitRun(): void {
		this.closeOverlays();
		this.sim.exitRun();
	}

	/**
	 * The on-screen pause button: a solo run pauses (the pause overlay shows), a co-op run opens the party overlay
	 * (it never pauses). Same rules as P / Start.
	 */
	openPauseMenu(): void {
		const state = clientStore.getState();
		if (state.game.run.coop) {
			if (!state.menu.coopOverlay) this.toggleCoopOverlay(state);
			return;
		}
		if (state.menu.nav.screen !== "none" || selectAnyPanelOpen(state)) return;
		this.sim.pause();
	}

	/** The party overlay's Resume (and the solo overlay's: the confirm closes with it). */
	closeOverlays(): void {
		clientStore.setCoopOverlay(false);
		clientStore.setLeaveConfirm(false);
	}

	// --- internals ------------------------------------------------------------------------------

	private inLobby(): boolean {
		return clientStore.getState().lobby.mine !== undefined;
	}

	/**
	 * Joined / created a lobby, or put in one by an arrival: its room. Left or kicked: back to the browser. Only while
	 * a menu screen is up (lobbyChangePath); a panel over it (Options, Leaderboard) stays open.
	 */
	private onLobbyChanged(id: string | undefined, prev: string | undefined): void {
		const path = lobbyChangePath(clientStore.getState().menu.nav.screen, id, prev);
		if (path === undefined) return;
		if (id !== undefined) print(`[Menu] in lobby ${id}: its room`);
		clientStore.menuNav({ kind: "reset", path });
	}

	private onInput(input: InputObject): void {
		// The game's keys are sunk by ContextActionService, so `processed` is set for them: it is not read here.
		if (typing()) return;
		const name = input.KeyCode.Name;
		const state = clientStore.getState();
		if (name === FIXED_INPUTS.pause || name === FIXED_INPUTS.padPause) {
			this.toggleCoopOverlay(state);
			return;
		}
		if (!MENU_BACK_KEYS.includes(name)) return;
		if (this.panelOpenLastFrame || selectAnyPanelOpen(state)) return; // B closed that panel
		if (state.menu.leaveConfirm) {
			this.audio.playUi(SFX.uiBack);
			clientStore.setLeaveConfirm(false);
			return;
		}
		if (state.menu.coopOverlay) {
			this.audio.playUi(SFX.uiBack);
			clientStore.setCoopOverlay(false);
			return;
		}
		if (state.menu.nav.screen !== "none") {
			// At the root back changes nothing, so it makes no sound either.
			if (state.menu.nav.stack.size() > 0) this.audio.playUi(SFX.uiBack);
			this.back();
		}
	}

	/**
	 * Co-op only (a solo run pauses through the sim's PAUSE bit): the pause key toggles the party overlay. Not under the
	 * stage loader's cover (docs/STAGE_LOADER.md SL5: pause input is ignored while covered).
	 */
	private toggleCoopOverlay(state: ClientState): void {
		const g = state.game;
		if (!g.active || !g.run.coop || g.snapshot.outcome !== "playing") return;
		if (selectStageCovered(state)) return;
		if (state.menu.nav.screen !== "none" || selectAnyPanelOpen(state)) return;
		clientStore.setCoopOverlay(!state.menu.coopOverlay);
	}
}
