import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, UserInputService, Workspace } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore, selectAnyPanelOpen, selectInputDevice, selectOverrides, selectPanelOpen } from "client/store";
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId } from "shared/characters";
import { diffControlsOverrides, type Bindings } from "shared/play";
import {
	SETTINGS_ATTRIBUTES,
	applyJuicePatch,
	displayResetOverrides,
	sanitizeAudioOverrides,
	sanitizeDisplayOverrides,
	sanitizeJuiceOverrides,
	sanitizeSettingsOverrides,
	sanitizeSettingsPatch,
	type AudioOverrides,
	type DisplayOverrides,
	type JuiceOverrides,
	type SettingsGroup,
	type SettingsOverrides,
} from "shared/settings";
import { SETTINGS_KEY, openingControlsDevice } from "shared/view/hud";
import { SimController } from "../game/SimController";

/**
 * The player's settings (port of the store + O key of project-kaleb-vale src/fx/settings.ts and
 * JuiceSettingsPanel.tsx @ 42897e2, persisted by the server instead of localStorage: docs/SERVER.md; since task L4
 * every group of the settings document v2: juice, controls, audio, display):
 *
 *   load     `requestSettings` at start; every `settingsChanged` (also sent once after join) replaces the overrides.
 *            Until the server answers, the game runs on the defaults (works offline / in a server-less test place).
 *            With the Workspace attribute KV_ResetBindings on, the first answer's bindings are cleared (dev tool).
 *   change   applied locally at once (Reflex `patchOverrides`), then sent with `updateSettings` as the whole changed
 *            group; the server's answer confirms or corrects it. A group reset sends that group empty; `reset()`
 *            with no group clears every group (reducedMotion follows the system again).
 *   system   GuiService.ReducedMotionEnabled (and its changes) is the default for reducedMotion.
 *   panel    O toggles the Options screen (not while typing, not while a rebind capture owns the input); the pause
 *            overlay opens it too (gamepad route). Pad B closes it (or, first, the swap prompt / reset confirmation
 *            on it) through its focus scopes (FocusController, docs/GAMEPAD_MENUS.md GM3). While it is open the run
 *            is paused (SimController.setUiPause) so its clicks never reach the game.
 */
@Controller({})
export class SettingsController implements OnStart {
	private readonly janitor = new Janitor();
	private bindingsResetPending = false;

	constructor(private readonly sim: SimController) {}

	onStart(): void {
		this.bindingsResetPending = Workspace.GetAttribute(SETTINGS_ATTRIBUTES.resetBindings) === true;
		clientStore.setSystemReducedMotion(GuiService.ReducedMotionEnabled);
		this.janitor.Add(
			GuiService.GetPropertyChangedSignal("ReducedMotionEnabled").Connect(() =>
				clientStore.setSystemReducedMotion(GuiService.ReducedMotionEnabled),
			),
		);
		this.janitor.Add(
			Events.settingsChanged.connect((overrides) => {
				clientStore.setOverrides(sanitizeSettingsOverrides(overrides), true);
				if (!this.bindingsResetPending) return;
				this.bindingsResetPending = false;
				if (selectOverrides(clientStore.getState()).controls !== undefined) this.patch({ controls: {} });
			}),
		);
		Events.requestSettings.fire();

		this.janitor.Add(
			UserInputService.InputBegan.Connect((input, processed) => {
				const state = clientStore.getState();
				if (state.options.inputCaptured) return; // the rebind capture owns this input
				const open = selectPanelOpen(state);
				if (processed || input.KeyCode.Name !== SETTINGS_KEY) return;
				if (UserInputService.GetFocusedTextBox() !== undefined) return;
				this.setPanelOpen(!open);
			}),
		);
		this.janitor.Add(
			// Either menu panel (Options, leaderboards) pauses the run while open.
			clientStore.subscribe(selectAnyPanelOpen, (open) => {
				this.sim.setUiPause(open);
			}),
		);
	}

	/** Opens / closes the Options screen (one menu panel at a time). The existing "open settings" action. */
	setPanelOpen(open: boolean): void {
		if (open) {
			clientStore.setLeaderboardOpen(false);
			// A phone player's Controls tab opens on Touch, its only row (docs/HAPTICS.md HP5 / HP7 review).
			const state = clientStore.getState();
			if (!selectPanelOpen(state)) {
				const device = openingControlsDevice(
					state.options.controlsDevice,
					selectInputDevice(state),
					UserInputService.TouchEnabled,
				);
				clientStore.setControlsDevice(device);
			}
		} else clientStore.clearRebindUi();
		clientStore.setPanelOpen(open);
	}

	/** Change some juice settings (merged into the juice group; invalid keys / values are dropped). */
	update(patch: JuiceOverrides): void {
		const juice = applyJuicePatch(
			selectOverrides(clientStore.getState()).juice ?? {},
			sanitizeJuiceOverrides(patch),
		);
		this.patch({ juice });
	}

	/** Change some volumes (merged into the audio group). */
	updateAudio(patch: AudioOverrides): void {
		const current = selectOverrides(clientStore.getState()).audio ?? {};
		this.patch({ audio: sanitizeAudioOverrides({ ...current, ...patch }) });
	}

	/** Change display settings (merged into the display group). */
	updateDisplay(patch: DisplayOverrides): void {
		const current = selectOverrides(clientStore.getState()).display ?? {};
		this.patch({ display: sanitizeDisplayOverrides({ ...current, ...patch }) });
	}

	/**
	 * docs/ARCHER.md AR5: the selected character (client/store `selectSelectedCharacter`): the next menu run start and
	 * lobby Ready play it; remembered in the display group (only a non-default pick is stored). An unknown id is
	 * ignored; the same pick sends nothing.
	 */
	setSelectedCharacter(characterId: CharacterId): void {
		if (!isCharacterId(characterId)) return;
		const current = selectOverrides(clientStore.getState()).display ?? {};
		if ((current.character ?? DEFAULT_CHARACTER) === characterId) return;
		this.updateDisplay({ character: characterId });
	}

	/** Store a whole key layout (as its overrides: the actions that differ from the defaults). */
	setBindings(bindings: Bindings): void {
		this.patch({ controls: diffControlsOverrides(bindings) });
	}

	/**
	 * One group back to its defaults, or (no group) every group (reducedMotion follows the system setting again). The
	 * display group keeps what another tab shows (displayResetOverrides: Controls > Gamepad's vibration).
	 */
	reset(group?: SettingsGroup): void {
		if (group === "display") {
			this.patch({ display: displayResetOverrides(selectOverrides(clientStore.getState()).display ?? {}) });
			return;
		}
		if (group !== undefined) {
			const clear: Record<string, object> = {};
			clear[group] = {};
			this.patch(clear as SettingsOverrides);
			return;
		}
		clientStore.setOverrides({}, false);
		Events.resetSettings.fire();
	}

	/** Applies `patch` locally (each group present replaces that group) and sends it. */
	private patch(patch: SettingsOverrides): void {
		const clean = sanitizeSettingsPatch(patch);
		clientStore.patchOverrides(clean);
		Events.updateSettings.fire(clean);
	}
}
