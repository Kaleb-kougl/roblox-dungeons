import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, UserInputService } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore, selectAnyPanelOpen, selectPanelOpen } from "client/store";
import { sanitizeJuiceOverrides, type JuiceOverrides } from "shared/settings";
import { SETTINGS_KEY, SETTINGS_PAD_CLOSE_KEY } from "shared/view/hud";
import { SimController } from "../game/SimController";

/**
 * The player's juice settings (port of the store + O key of project-kaleb-vale src/fx/settings.ts and
 * JuiceSettingsPanel.tsx @ 42897e2, persisted by the server instead of localStorage: docs/SERVER.md):
 *
 *   load     `requestSettings` at start; every `settingsChanged` (also sent once after join) replaces the overrides.
 *            Until the server answers, the game runs on the defaults (works offline / in a server-less test place).
 *   change   applied locally at once (Reflex `patchOverrides`), then sent with `updateSettings`; the server's answer
 *            confirms or corrects it. Reset clears the overrides (reducedMotion follows the system again).
 *   system   GuiService.ReducedMotionEnabled (and its changes) is the default for reducedMotion.
 *   panel    O toggles the juice settings panel (not while typing); the pause overlay opens it too (gamepad route).
 *            While it is open the run is paused (SimController.setUiPause) so its clicks never reach the game.
 */
@Controller({})
export class SettingsController implements OnStart {
	private readonly janitor = new Janitor();

	constructor(private readonly sim: SimController) {}

	onStart(): void {
		clientStore.setSystemReducedMotion(GuiService.ReducedMotionEnabled);
		this.janitor.Add(
			GuiService.GetPropertyChangedSignal("ReducedMotionEnabled").Connect(() =>
				clientStore.setSystemReducedMotion(GuiService.ReducedMotionEnabled),
			),
		);
		this.janitor.Add(
			Events.settingsChanged.connect((overrides) =>
				clientStore.setOverrides(sanitizeJuiceOverrides(overrides), true),
			),
		);
		Events.requestSettings.fire();

		this.janitor.Add(
			UserInputService.InputBegan.Connect((input, processed) => {
				const open = selectPanelOpen(clientStore.getState());
				// B (GUI "back") closes the panel; the GUI may have processed it already, so `processed` is ignored.
				if (open && input.KeyCode.Name === SETTINGS_PAD_CLOSE_KEY) {
					this.setPanelOpen(false);
					return;
				}
				if (processed || input.KeyCode.Name !== SETTINGS_KEY) return;
				if (UserInputService.GetFocusedTextBox() !== undefined) return;
				this.setPanelOpen(!open);
			}),
		);
		this.janitor.Add(
			// Either menu panel (juice settings, leaderboards) pauses the run while open.
			clientStore.subscribe(selectAnyPanelOpen, (open) => {
				this.sim.setUiPause(open);
			}),
		);
	}

	setPanelOpen(open: boolean): void {
		if (open) clientStore.setLeaderboardOpen(false); // one menu panel at a time
		clientStore.setPanelOpen(open);
	}

	/** Change some settings (invalid keys / values are dropped by the store and by the server). */
	update(patch: JuiceOverrides): void {
		const clean = sanitizeJuiceOverrides(patch);
		clientStore.patchOverrides(clean);
		Events.updateSettings.fire(clean);
	}

	/** Back to the defaults (reducedMotion follows the system setting again). */
	reset(): void {
		clientStore.setOverrides({}, false);
		Events.resetSettings.fire();
	}
}
