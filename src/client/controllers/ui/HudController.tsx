import { Controller, OnStart } from "@flamework/core";
import React from "@rbxts/react";
import { ReflexProvider } from "@rbxts/react-reflex";
import { createPortal, createRoot } from "@rbxts/react-roblox";
import { Players, StarterGui } from "@rbxts/services";
import { clientStore, selectMenuOpen } from "client/store";
import {
	GameHud,
	HudActionsContext,
	MenuActionsContext,
	MenuLayer,
	type HudActions,
	type MenuActions,
} from "client/ui";
import type { LobbyVisibility, LobbyWorld } from "shared/lobby";
import { draftColumnForCard } from "shared/play";
import { AudioController } from "../audio/AudioController";
import { InputController } from "../game/InputController";
import { SimController } from "../game/SimController";
import { TutorialController } from "../game/TutorialController";
import { LeaderboardController } from "./LeaderboardController";
import { LobbyController } from "./LobbyController";
import { MenuController } from "./MenuController";
import { RebindController } from "./RebindController";
import { SettingsController } from "./SettingsController";

/** Stock CoreGui that means nothing here (the player is a sim entity: no Humanoid health, no tools). */
const HIDDEN_CORE_GUI = [Enum.CoreGuiType.Health, Enum.CoreGuiType.Backpack];
const ROOT_NAME = "KV_HudRoot";

/**
 * Mounts the game HUD (React + Reflex, client/ui/hud) and the menu shell (client/ui/menu MenuLayer) into PlayerGui
 * through a portal (three ScreenGuis: the HUD, the menu shell and the menu layer), after every other controller
 * started (loadOrder), so the first frame already shows the run's snapshot. Hands the menus their actions (resume /
 * restart / leave run / settings / UI sounds / the tutorial's; the main menu and lobby requests) through
 * HudActionsContext and MenuActionsContext, lets gamepad navigation reach the GUI while a menu is open
 * (InputController.setUiNavigation), and hides the stock Health / Backpack CoreGui (pcall: SetCoreGuiEnabled can
 * throw before the CoreGui scripts exist).
 */
@Controller({ loadOrder: 1000 })
export class HudController implements OnStart {
	constructor(
		private readonly sim: SimController,
		private readonly input: InputController,
		private readonly settings: SettingsController,
		private readonly audio: AudioController,
		private readonly leaderboard: LeaderboardController,
		private readonly menu: MenuController,
		private readonly lobby: LobbyController,
		private readonly rebind: RebindController,
		private readonly tutorial: TutorialController,
	) {}

	onStart(): void {
		for (const t of HIDDEN_CORE_GUI) pcall(() => StarterGui.SetCoreGuiEnabled(t, false));
		const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui");
		/** Every menu button: the click must not also reach the game (no sword swing on Resume). */
		const click =
			<A extends unknown[]>(f: (...args: A) => void) =>
			(...args: A) => {
				this.input.suppressMouseUntilRelease();
				f(...args);
			};

		const actions: HudActions = {
			// Called on the press (PauseButton), so the click never reaches the game as a swing.
			pause: click(() => this.menu.openPauseMenu()),
			resume: click(() => {
				this.menu.closeOverlays();
				this.sim.resume();
			}),
			restart: click(() => this.sim.requestRestart()),
			setSettingsOpen: click((open: boolean) => this.settings.setPanelOpen(open)),
			updateSettings: (patch) => this.settings.update(patch),
			resetSettings: (group) => this.settings.reset(group),
			setOptionsTab: (tab) => {
				this.rebind.cancelCapture();
				clientStore.setOptionsTab(tab);
			},
			setControlsDevice: (device) => {
				this.rebind.cancelCapture();
				clientStore.setControlsDevice(device);
			},
			updateAudio: (patch) => this.settings.updateAudio(patch),
			updateDisplay: (patch) => this.settings.updateDisplay(patch),
			startRebind: (target) => this.rebind.startCapture(target),
			answerConflict: (swap) => this.rebind.answerConflict(swap),
			clearBinding: (action) => this.rebind.clearSecondary(action),
			askResetBindings: (device) => this.rebind.askReset(device),
			confirmResetBindings: () => this.rebind.confirmReset(),
			playUi: (id) => this.audio.playUi(id),
			setLeaderboardOpen: click((open: boolean) => this.leaderboard.setOpen(open)),
			showLeaderboard: (board) => this.leaderboard.showBoard(board),
			showLeaderboardTabs: (tabs) => this.leaderboard.showTabs(tabs),
			setLeaveConfirm: click((open: boolean) => this.menu.setLeaveConfirm(open)),
			leaveRun: click(() => this.menu.leaveRun()),
			exitRun: click(() => this.menu.exitRun()),
			playTutorial: click(() => this.tutorial.playTutorial()),
			// The outro's "Start my first run" is the main menu's Play solo.
			startFirstRun: click(() => {
				this.tutorial.closeOutro();
				this.menu.playSolo();
			}),
			setTutorialSkipConfirm: click((open: boolean) => this.tutorial.setSkipConfirm(open)),
			skipTutorial: click(() => this.tutorial.skipTutorial()),
			// Touch (docs/MOBILE.md MB10) and mouse: a tapped / clicked card is picked by its column, as the stick would push it.
			draftTap: click((index: number) =>
				this.input.queueDraftPick(
					draftColumnForCard(index, clientStore.getState().game.snapshot.draftOffers.size()),
				),
			),
			toggleMap: click(() => {
				// The party overlay closes first: MinimapController.toggle opens the map only over live play.
				if (clientStore.getState().menu.coopOverlay) clientStore.setCoopOverlay(false);
				this.input.emitMapAction();
			}),
		};

		const menuActions: MenuActions = {
			playSolo: click(() => this.menu.playSolo()),
			playDaily: click(() => this.menu.playDaily()),
			playDailyParty: click(() => this.menu.playDailyParty()),
			openLobbies: click(() => this.menu.openLobbies()),
			openLobbyRoom: click(() => this.menu.openLobbyRoom()),
			openOptions: click(() => this.menu.openOptions()),
			openLeaderboard: click(() => this.menu.openLeaderboard()),
			inviteFriends: click(() => this.menu.inviteFriends()),
			playTutorial: click(() => this.tutorial.playTutorial()),
			back: click(() => this.menu.back()),
			refreshLobbies: click(() => this.lobby.requestList()),
			createLobby: click((v: LobbyVisibility) => this.menu.createLobby(v)),
			joinLobby: click((id: string) => this.lobby.join(id)),
			leaveLobby: click(() => this.lobby.leave()),
			setReady: click((ready: boolean) => this.lobby.setReady(ready)),
			startLobby: click(() => this.lobby.start()),
			kick: click((id: number) => this.lobby.kick(id)),
			makeHost: click((id: number) => this.lobby.transferHost(id)),
			setVisibility: click((v: LobbyVisibility) => this.lobby.setVisibility(v)),
			setLobbyWorld: click((w: LobbyWorld) => this.lobby.setWorld(w)),
			rename: click(() => this.lobby.rename()),
			invite: click((id: number) => this.lobby.invite(id)),
			inviteFriendsToLobby: click(() => this.menu.inviteFriendsToLobby()),
			answerInvite: click((inviteId: string, accept: boolean) => this.lobby.answerInvite(inviteId, accept)),
			playUi: (id) => this.audio.playUi(id),
		};

		clientStore.subscribe(selectMenuOpen, (open) => this.input.setUiNavigation(open));
		this.input.setUiNavigation(selectMenuOpen(clientStore.getState()));

		const container = new Instance("Folder");
		container.Name = ROOT_NAME;
		createRoot(container).render(
			createPortal(
				<ReflexProvider producer={clientStore}>
					<HudActionsContext.Provider value={actions}>
						<MenuActionsContext.Provider value={menuActions}>
							<GameHud key="Hud" />
							<MenuLayer key="KV_MenuShell" />
						</MenuActionsContext.Provider>
					</HudActionsContext.Provider>
				</ReflexProvider>,
				playerGui,
			),
		);
	}
}
