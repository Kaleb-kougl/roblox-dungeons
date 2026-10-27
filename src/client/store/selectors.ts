import { createSelector } from "@rbxts/reflex";
import { selectGameActive, selectSnapshot } from "./game";
import { selectAnyPanelOpen } from "./leaderboard";
import { selectLoadingReleased } from "./loading";
import { selectCoopOverlay, selectMenuScreen } from "./menu";
import { selectStageCovered } from "./stage";
import { selectTutorialOutroOpen } from "./tutorial";

/**
 * A menu that takes the gamepad is open: a menu screen (main menu, lobbies), the pause overlay (paused, run on),
 * the co-op party overlay, the run-over panel (its Again / Main menu buttons), juice settings, leaderboards, the
 * tutorial's outro card, the join loading screen (its Skip button, docs/PRELOAD.md P4) or the stage loader's cover
 * until its reveal (docs/STAGE_LOADER.md SL5: input goes nowhere, so a draft is never confirmed blind; co-op sends neutral
 * input under it). Cross-slice, so it lives here: HudController turns gamepad UI navigation on by it (which is what
 * InputController.menuOwnsInput reads), and MinimapController refuses to open the full map under it (docs/MINIMAP.md M9).
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
		selectStageCovered,
	] as const,
	(snapshot, panelOpen, screen, coopOverlay, active, outroOpen, loadingReleased, stageCovered) =>
		!loadingReleased ||
		stageCovered ||
		panelOpen ||
		screen !== "none" ||
		coopOverlay ||
		(active && (outroOpen || snapshot.outcome !== "playing" || snapshot.paused)),
);
