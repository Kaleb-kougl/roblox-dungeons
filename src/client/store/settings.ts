import { createProducer, createSelector } from "@rbxts/reflex";
import { applyJuicePatch, resolveJuiceSettings, sanitizeJuiceOverrides, type JuiceOverrides } from "shared/settings";

/**
 * Client-local Reflex slice for the juice settings (task 8 part B) and the menu layer. Juice settings are
 * presentation only: nothing here reaches the sim.
 *
 * `overrides` are what the player changed (the server stores exactly these: docs/SERVER.md "DataStores"); the effective
 * settings resolve them against the defaults with reducedMotion defaulting to the Roblox "Reduce Motion" setting
 * (`selectJuice`, shared/settings resolveJuiceSettings, the web build's rule). Changes apply locally at once
 * (optimistic) and are sent with `updateSettings`; the server's `settingsChanged` answer replaces them. Before (or
 * without) an answer the game runs on the defaults plus whatever the player changed this session.
 */
export interface SettingsState {
	readonly overrides: JuiceOverrides;
	/** GuiService.ReducedMotionEnabled (the default for reducedMotion). */
	readonly systemReducedMotion: boolean;
	/** The server has answered at least once (settings loaded / saved). */
	readonly synced: boolean;
	/** The juice settings panel is open (O, or "Juice settings" in the pause overlay). */
	readonly panelOpen: boolean;
}

const initialState: SettingsState = {
	overrides: {},
	systemReducedMotion: false,
	synced: false,
	panelOpen: false,
};

export const settingsSlice = createProducer(initialState, {
	/** The server's stored overrides (settingsChanged). */
	setOverrides: (state, overrides: JuiceOverrides, synced: boolean) => ({
		...state,
		overrides: sanitizeJuiceOverrides(overrides),
		synced: state.synced || synced,
	}),
	/** A local change (applied before the server answers). */
	patchOverrides: (state, patch: JuiceOverrides) => ({
		...state,
		overrides: applyJuicePatch(state.overrides, patch),
	}),
	setSystemReducedMotion: (state, systemReducedMotion: boolean) =>
		state.systemReducedMotion === systemReducedMotion ? state : { ...state, systemReducedMotion },
	setPanelOpen: (state, panelOpen: boolean) => (state.panelOpen === panelOpen ? state : { ...state, panelOpen }),
});

export const selectSettings = (state: { settings: SettingsState }) => state.settings;
export const selectPanelOpen = (state: { settings: SettingsState }) => state.settings.panelOpen;
export const selectSettingsSynced = (state: { settings: SettingsState }) => state.settings.synced;
export const selectSystemReducedMotion = (state: { settings: SettingsState }) => state.settings.systemReducedMotion;

/** The effective juice settings (memoized: the same object until the overrides or the system setting change). */
export const selectJuice = createSelector(
	[(state: { settings: SettingsState }) => state.settings.overrides, selectSystemReducedMotion] as const,
	(overrides, system) => resolveJuiceSettings(overrides, system),
);
