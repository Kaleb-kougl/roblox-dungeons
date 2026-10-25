import { combineProducers, InferState } from "@rbxts/reflex";
import { gameSlice } from "./game";
import { leaderboardSlice } from "./leaderboard";
import { settingsSlice } from "./settings";
import { spikesSlice } from "./spikes";

/**
 * Barrel for the client's Reflex store. Client-local state only (HUD, settings, spikes); the
 * sim's live state never goes in here (PLAN.md task 8: views read the sim directly). The `game`
 * slice holds the ~10 Hz HUD snapshot, the last-used input device and the run's verdict; the `settings` slice the juice
 * settings (overrides, the system Reduce Motion flag) and whether the settings panel is open; the `leaderboard` slice
 * the leaderboard panel (M5).
 *
 * Import through the directory (`client/store`), never the file.
 */
export * from "./game";
export * from "./leaderboard";
export * from "./settings";
export * from "./spikes";

export const clientStore = combineProducers({
	game: gameSlice,
	settings: settingsSlice,
	spikes: spikesSlice,
	leaderboard: leaderboardSlice,
});

export type ClientStore = typeof clientStore;
export type ClientState = InferState<ClientStore>;
