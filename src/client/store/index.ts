import { combineProducers, InferState } from "@rbxts/reflex";
import { dailySlice } from "./daily";
import { dailyRankSlice } from "./dailyRank";
import { gameSlice } from "./game";
import { l10nSlice } from "./l10n";
import { leaderboardSlice } from "./leaderboard";
import { loadingSlice } from "./loading";
import { lobbySlice } from "./lobby";
import { menuSlice } from "./menu";
import { optionsSlice } from "./options";
import { recapSlice } from "./recap";
import { recordsSlice } from "./records";
import { settingsSlice } from "./settings";
import { spikesSlice } from "./spikes";
import { stageSlice } from "./stage";
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
 * loading screen (released, core progress, Skip shown: docs/PRELOAD.md P4); the `stage` slice the stage loader's cover
 * (shown / revealing, its label, the card's lines, the run-start bar: docs/STAGE_LOADER.md SL5); the `records` slice the
 * personal records the server sent and the run's frozen new-best baseline (docs/NEW_BEST.md NB7); the `daily` slice the
 * Daily's status (today's day, label, seed, ruleset, reset time: docs/DAILY.md DS4); the `dailyRank` slice the friends a
 * daily run passed (docs/DAILY.md DS10); the `l10n` slice the locale shown (docs/LOCALIZATION.md L6); the `recap` slice the
 * run-over recap's near-miss line, highlights, Details toggle and arm (docs/RUN_RECAP.md RR5).
 *
 * Import through the directory (`client/store`), never the file.
 */
export * from "./daily";
export * from "./dailyRank";
export * from "./game";
export * from "./l10n";
export * from "./leaderboard";
export * from "./loading";
export * from "./lobby";
export * from "./menu";
export * from "./options";
export * from "./recap";
export * from "./records";
export * from "./selectors";
export * from "./settings";
export * from "./spikes";
export * from "./stage";
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
	stage: stageSlice,
	records: recordsSlice,
	recap: recapSlice,
	daily: dailySlice,
	dailyRank: dailyRankSlice,
	l10n: l10nSlice,
});

export type ClientStore = typeof clientStore;
export type ClientState = InferState<ClientStore>;
