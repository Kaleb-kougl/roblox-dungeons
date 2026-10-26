import { Controller, OnStart } from "@flamework/core";
import React from "@rbxts/react";
import { ReflexProvider } from "@rbxts/react-reflex";
import { createPortal, createRoot } from "@rbxts/react-roblox";
import { Players, StarterGui } from "@rbxts/services";
import {
	clientStore,
	selectAnyPanelOpen,
	selectCoopOverlay,
	selectGameActive,
	selectMenuScreen,
	selectSnapshot,
	selectTutorialOutroOpen,
} from "client/store";
import {
	GameHud,
	HudActionsContext,
	MenuActionsContext,
	MenuLayer,
	type HudActions,
	type MenuActions,
} from "client/ui";
import { createSelector } from "@rbxts/reflex";
import type { LobbyVisibility } from "shared/lobby";
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
 * A menu that takes the gamepad is open: a menu screen (main menu, lobbies), the pause overlay (paused, run on),
 * the co-op party overlay, the run-over panel (its Again / Main menu buttons), juice settings, leaderboards or the
 * tutorial's outro card.
 */
const selectMenuOpen = createSelector(
	[
		selectSnapshot,
		selectAnyPanelOpen,
		selectMenuScreen,
		selectCoopOverlay,
		selectGameActive,
		selectTutorialOutroOpen,
	] as const,
	(snapshot, panelOpen, screen, coopOverlay, active, outroOpen) =>
		panelOpen ||
		screen !== "none" ||
		coopOverlay ||
		(active && (outroOpen || snapshot.outcome !== "playing" || snapshot.paused)),
);

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
		};

		const menuActions: MenuActions = {
			playSolo: click(() => this.menu.playSolo()),
			openLobbies: click(() => this.menu.openLobbies()),
			openLobbyRoom: click(() => this.menu.openLobbyRoom()),
			openOptions: click(() => this.menu.openOptions()),
			openLeaderboard: click(() => this.menu.openLeaderboard()),
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
			rename: click(() => this.lobby.rename()),
			invite: click((id: number) => this.lobby.invite(id)),
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
