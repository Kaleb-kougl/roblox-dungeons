import { createSelector } from "@rbxts/reflex";
import { selectGameActive, selectSnapshot } from "./game";
import { selectAnyPanelOpen } from "./leaderboard";
import { selectLoadingReleased } from "./loading";
import { selectCoopOverlay, selectMenuScreen } from "./menu";
import { selectTutorialOutroOpen } from "./tutorial";

/**
 * A menu that takes the gamepad is open: a menu screen (main menu, lobbies), the pause overlay (paused, run on),
 * the co-op party overlay, the run-over panel (its Again / Main menu buttons), juice settings, leaderboards, the
 * tutorial's outro card or the join loading screen (its Skip button, docs/PRELOAD.md P4). Cross-slice, so it lives
 * here: HudController turns gamepad UI navigation on by it, and MinimapController refuses to open the full map under it (docs/MINIMAP.md M9).
 */
export const selectMenuOpen = createSelector(
	[
		selectSnapshot,
		selectAnyPanelOpen,
		selectMenuScreen,
		selectCoopOverlay,
		selectGameActive,
		selectTutorialOutroOpen,
		selectLoadingReleased,
	] as const,
	(snapshot, panelOpen, screen, coopOverlay, active, outroOpen, loadingReleased) =>
		!loadingReleased ||
		panelOpen ||
		screen !== "none" ||
		coopOverlay ||
		(active && (outroOpen || snapshot.outcome !== "playing" || snapshot.paused)),
);
