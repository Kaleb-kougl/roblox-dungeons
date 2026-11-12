import { createSelector } from "@rbxts/reflex";
import { menuPointerSinkShown } from "shared/view/menu";
import { selectGameActive, selectSnapshot } from "./game";
import { selectAnyPanelOpen } from "./leaderboard";
import { selectLoadingReleased } from "./loading";
import { selectCoopOverlay, selectMenuScreen } from "./menu";
import { selectStageCovered } from "./stage";
import { selectTutorialOutroOpen } from "./tutorial";

/**
 * A real menu is on screen: a menu screen (main menu, lobbies), the pause overlay (paused, run on), the co-op party
 * overlay, the run-over panel (its Again / Main menu buttons), juice settings, leaderboards or the tutorial's outro
 * card. Not the join loading screen or the stage cover (selectMenuOpen adds those). HudController blocks the pad
 * buttons held when this turns off (InputController.blockHeldPadInputs, docs/GAMEPAD_MENUS.md GM4), so an A held
 * through Resume never fires skill 1, while a trigger held through a stairwell card keeps firing.
 */
export const selectMenuShown = createSelector(
	[
		selectSnapshot,
		selectAnyPanelOpen,
		selectMenuScreen,
		selectCoopOverlay,
		selectGameActive,
		selectTutorialOutroOpen,
	] as const,
	(snapshot, panelOpen, screen, coopOverlay, active, outroOpen) =>
		panelOpen ||
		screen !== "none" ||
		coopOverlay ||
		(active && (outroOpen || snapshot.outcome !== "playing" || snapshot.paused)),
);

/**
 * The menu shell covers its screen with a pointer sink: a panel (Options, leaderboards) is open over a menu screen, so
 * mouse / touch never reach the main menu (or lobby room, ...) through the panel's dim (shared/view/menu pointer.ts).
 */
export const selectMenuPointerSink = createSelector(
	[selectMenuScreen, selectAnyPanelOpen] as const,
	(screen, panelOpen) => menuPointerSinkShown({ screen, panelOpen }),
);

/**
 * A menu that takes the gamepad is open: a real menu (selectMenuShown), the join loading screen (its Skip button,
 * docs/PRELOAD.md P4) or the stage loader's cover until its reveal (docs/STAGE_LOADER.md SL5: input goes nowhere, so a
 * draft is never confirmed blind; co-op sends neutral input under it). Cross-slice, so it lives here: HudController
 * turns gamepad UI navigation on by it (which is what InputController.menuOwnsInput reads), and MinimapController
 * refuses to open the full map under it (docs/MINIMAP.md M9).
 */
export const selectMenuOpen = createSelector(
	[selectMenuShown, selectLoadingReleased, selectStageCovered] as const,
	(shown, loadingReleased, stageCovered) => !loadingReleased || stageCovered || shown,
);

/**
 * The gauntlet cursor's menu context (docs/CURSOR.md section 3): a menu that takes the pointer is open
 * (selectMenuOpen: a menu screen, a panel, the party overlay, a paused run, run over, the tutorial outro, the join
 * loading screen, the stage cover) or the local player's boon draft is open in a running run (the snapshot's
 * `draftOpen`: the run is not paused, so neither selector above has it; a co-op player who picked and waits for
 * teammates is back in gameplay). Cross-slice, so it lives here. CursorController draws the gauntlet only while this
 * holds; gameplay keeps Roblox's pointer.
 */
export const selectCursorMenuContext = createSelector(
	[selectMenuOpen, selectGameActive, selectSnapshot] as const,
	(menuOpen, active, snapshot) => menuOpen || (active && snapshot.draftOpen),
);
