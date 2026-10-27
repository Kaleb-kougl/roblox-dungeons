import { combineProducers, InferState } from "@rbxts/reflex";
import { gameSlice } from "./game";
import { leaderboardSlice } from "./leaderboard";
import { loadingSlice } from "./loading";
import { lobbySlice } from "./lobby";
import { menuSlice } from "./menu";
import { optionsSlice } from "./options";
import { settingsSlice } from "./settings";
import { spikesSlice } from "./spikes";
import { tutorialSlice } from "./tutorial";

/**
 * Barrel for the client's Reflex store. Client-local state only (HUD, settings, spikes); the
 * sim's live state never goes in here (PLAN.md task 8: views read the sim directly). The `game`
 * slice holds the ~10 Hz HUD snapshot, the last-used input device and the run's verdict; the `settings` slice the
 * player's settings (overrides of every group, the system Reduce Motion flag) and whether the Options screen is open;
 * the `options` slice the Options screen's tab and rebinding flow; the `leaderboard` slice the leaderboard panel (M5);
 * the `menu` slice the menu shell's screen + back stack and the Leave run confirm (L3 / L6); the `lobby` slice the
 * lobby list, this player's lobby, invites and notices (L5); the `tutorial` slice the first-run tutorial's
 * HUD state (prompt, highlight, outro) and whether the first-run gate is still deciding; the `loading` slice the join
 * loading screen (released, core progress, Skip shown: docs/PRELOAD.md P4).
 *
 * Import through the directory (`client/store`), never the file.
 */
export * from "./game";
export * from "./leaderboard";
export * from "./loading";
export * from "./lobby";
export * from "./menu";
export * from "./options";
export * from "./selectors";
export * from "./settings";
export * from "./spikes";
export * from "./tutorial";

export const clientStore = combineProducers({
	game: gameSlice,
	settings: settingsSlice,
	options: optionsSlice,
	spikes: spikesSlice,
	leaderboard: leaderboardSlice,
	menu: menuSlice,
	lobby: lobbySlice,
	tutorial: tutorialSlice,
	loading: loadingSlice,
});

export type ClientStore = typeof clientStore;
export type ClientState = InferState<ClientStore>;
