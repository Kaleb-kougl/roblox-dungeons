import { createProducer, createSelector } from "@rbxts/reflex";
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId } from "shared/characters";
import { DEFAULT_BINDINGS, applyControlsOverrides } from "shared/play";
import {
	applySettingsPatch,
	resolveAudioSettings,
	resolveDisplaySettings,
	resolveJuiceSettings,
	reuseSameGroups,
	sanitizeSettingsOverrides,
	type SettingsOverrides,
} from "shared/settings";

/**
 * Client-local Reflex slice for the player's settings (task 8 part B; every group since task L4) and the menu layer.
 * Presentation only: nothing here reaches the sim (bindings only change which device inputs make the InputFrame).
 *
 * `overrides` are what the player changed, every group (the server stores exactly these: docs/SERVER.md
 * "DataStores", settings document v2); the effective settings resolve them against the defaults: `selectJuice`
 * (reducedMotion defaulting to the Roblox "Reduce Motion" setting, the web build's rule), `selectBindings`,
 * `selectAudio`, `selectDisplay`. Changes apply locally at once (optimistic) and are sent with `updateSettings`; the
 * server's `settingsChanged` answer replaces them. Before (or without) an answer the game runs on the defaults plus
 * whatever the player changed this session.
 */
export interface SettingsState {
	readonly overrides: SettingsOverrides;
	/** GuiService.ReducedMotionEnabled (the default for reducedMotion). */
	readonly systemReducedMotion: boolean;
	/** The server has answered at least once (settings loaded / saved). */
	readonly synced: boolean;
	/** The Options screen is open (O, "Options" in the pause overlay, or a menu's open-settings action). */
	readonly panelOpen: boolean;
}

const initialState: SettingsState = {
	overrides: {},
	systemReducedMotion: false,
	synced: false,
	panelOpen: false,
};

export const settingsSlice = createProducer(initialState, {
	/** The server's stored overrides (settingsChanged), or a full local reset. */
	setOverrides: (state, overrides: SettingsOverrides, synced: boolean) => ({
		...state,
		overrides: reuseSameGroups(state.overrides, sanitizeSettingsOverrides(overrides)),
		synced: state.synced || synced,
	}),
	/** A local change (applied before the server answers): each group in `patch` replaces that group. */
	patchOverrides: (state, patch: SettingsOverrides) => ({
		...state,
		overrides: reuseSameGroups(state.overrides, applySettingsPatch(state.overrides, patch)),
	}),
	setSystemReducedMotion: (state, systemReducedMotion: boolean) =>
		state.systemReducedMotion === systemReducedMotion ? state : { ...state, systemReducedMotion },
	setPanelOpen: (state, panelOpen: boolean) => (state.panelOpen === panelOpen ? state : { ...state, panelOpen }),
});

export const selectSettings = (state: { settings: SettingsState }) => state.settings;
export const selectPanelOpen = (state: { settings: SettingsState }) => state.settings.panelOpen;
export const selectSettingsSynced = (state: { settings: SettingsState }) => state.settings.synced;
export const selectSystemReducedMotion = (state: { settings: SettingsState }) => state.settings.systemReducedMotion;
export const selectOverrides = (state: { settings: SettingsState }) => state.settings.overrides;

/** The effective juice settings (memoized: the same object until the overrides or the system setting change). */
export const selectJuice = createSelector(
	[(state: { settings: SettingsState }) => state.settings.overrides.juice, selectSystemReducedMotion] as const,
	(juice, system) => resolveJuiceSettings(juice, system),
);

/** The player's key bindings: DEFAULT_BINDINGS with the controls overrides on top (memoized; always valid). */
export const selectBindings = createSelector(
	[(state: { settings: SettingsState }) => state.settings.overrides.controls] as const,
	(controls) => (controls === undefined ? DEFAULT_BINDINGS : applyControlsOverrides(DEFAULT_BINDINGS, controls)),
);

/** The effective audio volumes (whole percents). */
export const selectAudio = createSelector(
	[(state: { settings: SettingsState }) => state.settings.overrides.audio] as const,
	(audio) => resolveAudioSettings(audio),
);

/**
 * The selected character (docs/ARCHER.md AR5, ARD12): the character the next run started from the menu or a lobby
 * Ready plays, and the character screen's focus. Stored in the display group (`display.character`, only a non-default
 * pick), so it is remembered across sessions; DEFAULT_CHARACTER (the Knight) until the player picks. Change it with
 * SettingsController.setSelectedCharacter (applied locally at once, then saved). A running run keeps the character it
 * was started with (Again / R / dev restart replay it), whatever this says now.
 */
export const selectSelectedCharacter = (state: { settings: SettingsState }): CharacterId => {
	const c = state.settings.overrides.display?.character;
	return c !== undefined && isCharacterId(c) ? c : DEFAULT_CHARACTER;
};

/** The effective display settings (HUD scale percent). */
export const selectDisplay = createSelector(
	[(state: { settings: SettingsState }) => state.settings.overrides.display] as const,
	(display) => resolveDisplaySettings(display),
);
