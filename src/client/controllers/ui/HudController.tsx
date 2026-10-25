import { Controller, OnStart } from "@flamework/core";
import React from "@rbxts/react";
import { ReflexProvider } from "@rbxts/react-reflex";
import { createPortal, createRoot } from "@rbxts/react-roblox";
import { Players, StarterGui } from "@rbxts/services";
import { clientStore, selectAnyPanelOpen, selectSnapshot } from "client/store";
import { GameHud, HudActionsContext, type HudActions } from "client/ui";
import { createSelector } from "@rbxts/reflex";
import { AudioController } from "../audio/AudioController";
import { InputController } from "../game/InputController";
import { SimController } from "../game/SimController";
import { LeaderboardController } from "./LeaderboardController";
import { SettingsController } from "./SettingsController";

/** Stock CoreGui that means nothing here (the player is a sim entity: no Humanoid health, no tools). */
const HIDDEN_CORE_GUI = [Enum.CoreGuiType.Health, Enum.CoreGuiType.Backpack];
const ROOT_NAME = "KV_HudRoot";

/** A menu that takes the controls is open: the pause overlay (paused, run on), juice settings or leaderboards. */
const selectMenuOpen = createSelector(
	[selectSnapshot, selectAnyPanelOpen] as const,
	(snapshot, panelOpen) => panelOpen || (snapshot.paused && snapshot.outcome === "playing"),
);

/**
 * Mounts the game HUD (React + Reflex, client/ui/hud) into PlayerGui through a portal (its two ScreenGuis: the HUD
 * and the menu layer), after every other controller started (loadOrder), so the first frame already shows the run's
 * snapshot. Hands the menus their actions (resume / restart / settings / UI sounds) through HudActionsContext, lets
 * gamepad navigation reach the GUI while a menu is open (InputController.setUiNavigation), and hides the stock
 * Health / Backpack CoreGui (pcall: SetCoreGuiEnabled can throw before the CoreGui scripts exist).
 */
@Controller({ loadOrder: 1000 })
export class HudController implements OnStart {
	constructor(
		private readonly sim: SimController,
		private readonly input: InputController,
		private readonly settings: SettingsController,
		private readonly audio: AudioController,
		private readonly leaderboard: LeaderboardController,
	) {}

	onStart(): void {
		for (const t of HIDDEN_CORE_GUI) pcall(() => StarterGui.SetCoreGuiEnabled(t, false));
		const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui");

		const actions: HudActions = {
			resume: () => {
				this.input.suppressMouseUntilRelease();
				this.sim.resume();
			},
			restart: () => {
				this.input.suppressMouseUntilRelease();
				this.sim.requestRestart();
			},
			setSettingsOpen: (open) => {
				this.input.suppressMouseUntilRelease();
				this.settings.setPanelOpen(open);
			},
			updateSettings: (patch) => this.settings.update(patch),
			resetSettings: () => this.settings.reset(),
			playUi: (id) => this.audio.playUi(id),
			setLeaderboardOpen: (open) => {
				this.input.suppressMouseUntilRelease();
				this.leaderboard.setOpen(open);
			},
			showLeaderboard: (board) => this.leaderboard.showBoard(board),
			answerPartyInvite: (accept) => {
				this.input.suppressMouseUntilRelease();
				this.sim.answerPartyInvite(accept);
			},
		};

		clientStore.subscribe(selectMenuOpen, (open) => this.input.setUiNavigation(open));
		this.input.setUiNavigation(selectMenuOpen(clientStore.getState()));

		const container = new Instance("Folder");
		container.Name = ROOT_NAME;
		createRoot(container).render(
			createPortal(
				<ReflexProvider producer={clientStore}>
					<HudActionsContext.Provider value={actions}>
						<GameHud />
					</HudActionsContext.Provider>
				</ReflexProvider>,
				playerGui,
			),
		);
	}
}
