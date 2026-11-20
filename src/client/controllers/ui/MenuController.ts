import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, TextChatService, UserInputService, Workspace } from "@rbxts/services";
import {
	clientStore,
	selectAnyPanelOpen,
	selectMenuScreen,
	selectMyLobby,
	selectMyLobbyId,
	selectPlayableCharacter,
	selectSnapshot,
	selectStageCovered,
	type ClientState,
} from "client/store";
import { isCharacterId, type CharacterId } from "shared/characters";
import { DAILY_WORLD_KIND } from "shared/daily";
import type { LobbyVisibility } from "shared/lobby";
import type { FirstRunDecision } from "shared/tutorial";
import { FIXED_INPUTS, RUN_ATTRIBUTES } from "shared/play";
import {
	DAILY_MENU,
	LOBBY_ROOM_PATH,
	MENU_BACK_KEYS,
	PAD_KEYS,
	afterRunPath,
	characterBackAction,
	characterPickAllowed,
	characterConfirmPlan,
	characterFocusStep,
	characterInitialFocus,
	characterKeyAction,
	lobbyChangePath,
	lobbyPickToSend,
	type CharacterScreenOrigin,
} from "shared/view/menu";
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
 *   screens    main / lobbies / lobby with a back stack (Reflex `menu`, shared/view/menu menuNavReduce); Backspace
 *              goes back (not while a juice settings / leaderboard panel is open), and closes the Leave run confirm and
 *              the party overlay first. Pad B goes through the owning focus scope instead (FocusController,
 *              docs/GAMEPAD_MENUS.md GM3; a screen's B calls screenBack)
 *   runs       any run start closes the menu; leaving a run (run-over Main menu / Back to lobby) opens the lobby
 *              room while in a lobby, else the main menu (SimController.onRunExited); Leave run (solo or party)
 *              first shows the run's run-over panel with its stats (Again / Main menu / Back to lobby go on from there)
 *   lobby      joining or creating a lobby opens its room, and so does a lobby the server put this player in (an
 *              invite / party arrival) while a menu screen is up; leaving it (or being kicked) goes back to the
 *              browser (shared/view/menu lobbyChangePath). Never during a run, the tutorial or the first-run wait.
 *   invites    a menu screen opening (from none) asks for Roblox invite eligibility again when the cached answer
 *              is old (LobbyController.refreshEligibility)
 *   co-op      party runs never pause, so the pause key (P / Start) opens the non-pausing party overlay instead
 *              (Resume / Leave run / settings / leaderboards; Leave run -> lockstepLeave and the run's run-over panel,
 *              then Back to lobby: the lobby room, which shows "Run in progress" until the lobby is back to forming)
 *   character  (docs/ARCHER.md AR7 / AR8, owner answers 2 and 8) every run start from the menu opens the character
 *              screen first (MenuScreen `character`, shared/view/menu character.ts): Play solo and the Daily card over
 *              the main menu, the tutorial outro's Start my first run, the dev panel's Go (DevModeController; over the
 *              menu, or over no menu: a run under it pauses), a lobby member's Ready over the lobby room, and the
 *              run-over panel's Character (Again never: it keeps the run's character). The last pick is focused;
 *              arrows / A-D move it, Enter / Space confirm (here), taps and the pad's selection too (the screen).
 *              Confirm remembers the pick (SettingsController.setSelectedCharacter) and does the origin's start
 *              (characterConfirmPlan); Back (and Backspace / pad B) goes one screen back, or closes the menu when the
 *              screen opened over none (characterBackAction): the panel, the outro or the run under it show again. When
 *              the lobby room opens, a member who is not ready sends their remembered pick with an un-ready
 *              (lobbyPickToSend), so the others see it before they ready.
 */
@Controller({ loadOrder: 900 })
export class MenuController implements OnStart {
	private readonly janitor = new Janitor();
	/**
	 * A menu panel was open at the end of the last frame: a Backspace that lands as a panel closes (its Close button,
	 * O, the leaderboard key) must not also go back a screen.
	 */
	private panelOpenLastFrame = false;
	/** The dev panel's start waiting for the character screen's Confirm (origin `dev`). */
	private pendingDev: ((character: CharacterId) => void) | undefined;
	/** The last lobby pick sent by syncLobbyPick (`<lobbyId>|<pick>`): never sent twice for the same lobby. */
	private pickSent = "";

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
				// The character screen went away (Back, Confirm, a run start, a lobby move): its request goes with it.
				if (prev === "character" && screen !== "character") this.dropCharacter();
				if (screen === "lobby") this.syncLobbyPick();
			}),
		);
		this.janitor.Add(clientStore.subscribe(selectMyLobby, () => this.syncLobbyPick()));
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

	/** Play solo: the character screen, then a solo run (KV_Daily: the Daily). */
	playSolo(): void {
		this.openCharacter(this.soloOrigin());
	}

	/** The Daily (docs/DAILY.md): the character screen, then a ranked solo run in world "daily" (the server's seed). */
	playDaily(): void {
		this.openCharacter("daily");
	}

	/** The tutorial outro's Start my first run (docs/ARCHER.md AR6 / AR7): the character screen over the outro. */
	startFirstRun(): void {
		this.openCharacter("outro");
	}

	/** The run-over panel's Character (owner answer 8): the character screen over the finished run. */
	runOverCharacter(): void {
		const g = clientStore.getState().game;
		if (!g.active || g.run.coop || g.snapshot.outcome === "playing") return;
		this.openCharacter("runOver");
	}

	/**
	 * The dev panel's Go (DevModeController): the character screen, then `start` with the pick (its options, seed and
	 * "Both weapons" are the panel's). Over a solo run still being played the run pauses first (Back leaves it paused:
	 * the pause overlay). Nothing while a party run is on (startDev ignores it too).
	 */
	devStart(start: (character: CharacterId) => void): void {
		const g = clientStore.getState().game;
		if (g.active && g.run.coop && g.snapshot.outcome === "playing") return;
		if (g.active && g.snapshot.outcome === "playing") this.sim.pause();
		this.openCharacter("dev", start);
	}

	/**
	 * The lobby room's Ready toggle (docs/ARCHER.md AR8): a ready member un-readies at once (keeping the pick); one who
	 * is not ready picks first (the character screen; its Confirm readies with the pick, Back stays unready).
	 */
	toggleReady(): void {
		const mine = clientStore.getState().lobby.mine;
		if (mine === undefined) return;
		if (mine.ready.includes(Players.LocalPlayer.UserId)) {
			this.lobby.setReady(false);
			return;
		}
		if (mine.phase !== "forming") return;
		this.openCharacter("lobby");
	}

	/**
	 * The character screen (docs/ARCHER.md AR7): a card focused (a tap, a click, the pad's selection, a key). Silent:
	 * the screen clicks on a tap, the keys here, and the pad's selection has its own tick (AudioController).
	 */
	focusCharacter(id: CharacterId): void {
		if (!isCharacterId(id)) return;
		const cs = clientStore.getState().menu.character;
		if (cs === undefined || cs.focus === id) return;
		clientStore.setCharacterFocus(id);
	}

	/**
	 * The character screen's Confirm (Start / Ready, Enter / Space, the pad's A on a card): remembers the pick, leaves
	 * the screen (characterConfirmPlan: closed, or back to the lobby room) and starts what opened it.
	 */
	confirmCharacter(id?: CharacterId): void {
		const st = clientStore.getState();
		const cs = st.menu.character;
		if (cs === undefined || st.menu.nav.screen !== "character") return;
		const pick = id !== undefined && isCharacterId(id) ? id : cs.focus;
		// docs/SILVER.md SV18: a locked character is never started or readied (the server would refuse it); the card's
		// own button buys it in place.
		if (!characterPickAllowed(pick, st.wallet.status)) {
			this.audio.playUi(SFX.shopDeny);
			return;
		}
		const plan = characterConfirmPlan(cs.origin);
		const dev = this.pendingDev;
		this.audio.playUi(SFX.uiConfirm);
		this.settings.setSelectedCharacter(pick);
		clientStore.setCharacterFocus(pick);
		print(`[Menu] character ${pick} (${cs.origin})`);
		// The lobby room opening again must not send this pick with an un-ready after the Ready (syncLobbyPick).
		const mine = st.lobby.mine;
		if (plan.start === "ready" && mine !== undefined) this.pickSent = `${mine.lobbyId}|${pick}`;
		clientStore.menuNav({ kind: plan.after === "back" ? "back" : "close" });
		if (plan.closeOutro) this.tutorial.closeOutro();
		if (plan.start === "solo") {
			// KV_Daily (Studio): Play solo, and so the outro's first run, is the Daily.
			this.sim.startSolo(undefined, this.dailyAttribute() ? DAILY_WORLD_KIND : undefined, pick);
		} else if (plan.start === "daily") this.sim.startSolo(undefined, DAILY_WORLD_KIND, pick);
		else if (plan.start === "dev") dev?.(pick);
		else if (plan.start === "restart") this.sim.restartAs(pick);
		else this.lobby.setReady(true, pick);
	}

	/** The character screen's Back (and Backspace / pad B there): characterBackAction. */
	characterBack(): void {
		const nav = clientStore.getState().menu.nav;
		if (nav.screen !== "character") return;
		this.audio.playUi(SFX.uiBack);
		clientStore.menuNav({ kind: characterBackAction(nav) === "back" ? "back" : "close" });
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

	/** The Codex (claude/codex-plan.md CX7): a menu screen over the main menu (Back returns to it). */
	openCodex(): void {
		clientStore.menuNav({ kind: "open", screen: "codex" });
	}

	/** The Armory (docs/SILVER.md SV9): a menu screen over the main menu (Back returns to it). */
	openArmory(): void {
		clientStore.menuNav({ kind: "open", screen: "armory" });
	}

	back(): void {
		clientStore.menuNav({ kind: "back" });
	}

	/**
	 * Backspace / pad B on a menu screen: one screen back, with sfx.ui.back (at the root back changes nothing, so it
	 * makes no sound either).
	 */
	screenBack(): void {
		if (clientStore.getState().menu.nav.screen === "none") return;
		if (clientStore.getState().menu.nav.screen === "character") {
			this.characterBack();
			return;
		}
		if (clientStore.getState().menu.nav.stack.size() > 0) this.audio.playUi(SFX.uiBack);
		this.back();
	}

	createLobby(visibility: LobbyVisibility): void {
		this.lobby.create(visibility);
	}

	setLeaveConfirm(open: boolean): void {
		clientStore.setLeaveConfirm(open);
	}

	/** Leave run (after the confirm): solo forfeits (a death), co-op sends lockstepLeave; then its run-over panel. */
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

	/** KV_Daily (Studio): Play solo starts the Daily. */
	private dailyAttribute(): boolean {
		return Workspace.GetAttribute(RUN_ATTRIBUTES.daily) === true;
	}

	private soloOrigin(): CharacterScreenOrigin {
		if (!this.dailyAttribute()) return "solo";
		print(`[Menu] ${RUN_ATTRIBUTES.daily}: Play solo starts the Daily`);
		return "daily";
	}

	/** Opens the character screen for `origin`, the last pick focused (`dev`: the panel's start waits for Confirm). */
	private openCharacter(origin: CharacterScreenOrigin, dev?: (character: CharacterId) => void): void {
		const st = clientStore.getState();
		this.pendingDev = origin === "dev" ? dev : undefined;
		const cs = st.menu.character;
		if (st.menu.nav.screen === "character" && cs !== undefined) {
			// Already up (the dev panel's Go over Play solo's screen): the newer request, the focus kept.
			clientStore.setCharacterScreen({ origin, focus: cs.focus });
			return;
		}
		clientStore.setCharacterScreen({ origin, focus: characterInitialFocus(selectPlayableCharacter(st)) });
		clientStore.menuNav({ kind: "open", screen: "character" });
	}

	private dropCharacter(): void {
		this.pendingDev = undefined;
		clientStore.setCharacterScreen(undefined);
	}

	/**
	 * docs/ARCHER.md AR8: on the lobby room, a member who is not ready sends their remembered pick with an un-ready
	 * (lobbyPickToSend), once per lobby and pick, so the others see it on their row.
	 */
	private syncLobbyPick(): void {
		const st = clientStore.getState();
		const view = st.lobby.mine;
		if (view === undefined) {
			this.pickSent = "";
			return;
		}
		if (st.menu.nav.screen !== "lobby") return;
		const pick = lobbyPickToSend(view, Players.LocalPlayer.UserId, selectPlayableCharacter(st));
		if (pick === undefined) return;
		const key = `${view.lobbyId}|${pick}`;
		if (this.pickSent === key) return;
		this.pickSent = key;
		this.lobby.setReady(false, pick);
	}

	/**
	 * Joined / created a lobby, or put in one by an arrival: its room. Left or kicked: back to the browser. Only while
	 * a menu screen is up (lobbyChangePath); a panel over it (Options, Leaderboard) stays open.
	 */
	private onLobbyChanged(id: string | undefined, prev: string | undefined): void {
		const nav = clientStore.getState().menu.nav;
		const path = lobbyChangePath(nav.screen, id, prev, nav.stack);
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
		if (state.menu.nav.screen === "character" && !this.panelOpenLastFrame && !selectAnyPanelOpen(state)) {
			// docs/ARCHER.md AR7: arrows / A-D move the focused card, Enter / Space confirm it (the pad: its selection).
			const key = characterKeyAction(name);
			const cs = state.menu.character;
			if (key !== undefined && cs !== undefined) {
				if (key === "confirm") this.confirmCharacter();
				else {
					const step = characterFocusStep(cs.focus, key === "prev" ? -1 : 1);
					if (step !== cs.focus) this.audio.playUi(SFX.uiClick);
					this.focusCharacter(step);
				}
				return;
			}
		}
		// Pad B is FocusController's (the owning scope's back, docs/GAMEPAD_MENUS.md GM3): only the keyboard's here.
		if (!MENU_BACK_KEYS.includes(name) || name === PAD_KEYS.b) return;
		if (this.panelOpenLastFrame || selectAnyPanelOpen(state)) return; // nothing goes back under (or out of) a panel
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
		this.screenBack();
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
