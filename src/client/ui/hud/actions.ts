import React, { useContext } from "@rbxts/react";
import type { LeaderboardBoard } from "shared/leaderboard";
import type { BindingDevice, CaptureTarget, GameAction } from "shared/play";
import type { AudioOverrides, DisplayOverrides, JuiceOverrides, SettingsGroup } from "shared/settings";
import type { LeaderboardTabs, OptionsControlsDevice, OptionsTab, RecapTab } from "shared/view/hud";

/**
 * What the HUD's menus can do. HudController builds it from the controllers (SimController, SettingsController,
 * RebindController, InputController, AudioController, MenuController, TutorialController) and provides it to the tree,
 * so components never import controllers.
 */
export interface HudActions {
	/** The on-screen pause button: pause a solo run / open the co-op party overlay (as P / Start). */
	readonly pause: () => void;
	/** Pause overlay: resume / restart the run (co-op: Resume closes the party overlay). */
	readonly resume: () => void;
	readonly restart: () => void;
	/** The party overlay's pad B (docs/GAMEPAD_MENUS.md GM3): close it (as Backspace does). */
	readonly closeCoopOverlay: () => void;
	/** The Options screen (formerly the juice settings panel): open / close. Other menus open it through this. */
	readonly setSettingsOpen: (open: boolean) => void;
	/** Juice settings (merged into the juice group). */
	readonly updateSettings: (patch: JuiceOverrides) => void;
	/** One settings group back to its defaults; no group: every group. */
	readonly resetSettings: (group?: SettingsGroup) => void;
	/** Options screen: tabs, volumes, HUD scale. */
	readonly setOptionsTab: (tab: OptionsTab) => void;
	readonly setControlsDevice: (device: OptionsControlsDevice) => void;
	readonly updateAudio: (patch: AudioOverrides) => void;
	readonly updateDisplay: (patch: DisplayOverrides) => void;
	/** Options > Controls: capture an input for a slot, answer the swap prompt, clear a secondary, reset a device. */
	readonly startRebind: (target: CaptureTarget) => void;
	readonly answerConflict: (swap: boolean) => void;
	readonly clearBinding: (action: GameAction) => void;
	readonly askResetBindings: (device: BindingDevice | undefined) => void;
	readonly confirmResetBindings: () => void;
	/** A menu sound by theme ID (sfx.ui.click / sfx.ui.confirm). */
	readonly playUi: (id: string) => void;
	/** Leaderboard panel (M5): open / close, and the Solo / Co-op tab. */
	readonly setLeaderboardOpen: (open: boolean) => void;
	readonly showLeaderboard: (board: LeaderboardBoard) => void;
	/** The panel's tabs (docs/DAILY.md DS9: Today / Yesterday / All time x Solo / Co-op x Global / Friends). */
	readonly showLeaderboardTabs: (tabs: LeaderboardTabs) => void;
	/** Leave run (L6): show / hide the confirm, then leave (solo: forfeit; party: lockstepLeave) for the menu. */
	readonly setLeaveConfirm: (open: boolean) => void;
	readonly leaveRun: () => void;
	/** Run-over "Main menu" / "Back to lobby": leave the finished run for the menu. */
	readonly exitRun: () => void;
	/**
	 * Run-over "Again" / "Retry Daily" (docs/RUN_RECAP.md RR7): through the recap's retry gate (RecapController):
	 * before the arm it skips the recap's timeline, after it it restarts (as `restart`).
	 */
	readonly again: () => void;
	/**
	 * Run-over "Character" beside Again (docs/ARCHER.md AR7, owner answer 8): the character screen over the finished
	 * run; its Confirm restarts the run as the pick, Back returns to the panel. Never through the retry gate.
	 */
	readonly runOverCharacter: () => void;
	/** Run-over "Details" / "Highlights" (RRD5): the score breakdown and Build list in the highlights' place, and back. */
	readonly toggleRecapDetails: () => void;
	/**
	 * A party run's run-over tab (docs/RUN_CONTRIBUTION.md CT5 / CT6: a tap on You / Team / Party, the pad's LB / RB):
	 * RecapController switches it (the Team tab's first open starts its count-up); never a retry or a skip.
	 */
	readonly setRecapTab: (tab: RecapTab) => void;
	/**
	 * First-run tutorial (TutorialController): a new tutorial run (`playTutorial`: the outro's Play the tutorial again;
	 * `restartTutorial`: the pause overlay's Restart tutorial; two actions so the funnel's attempt entry tells them
	 * apart), the outro's Start my first run (the character screen, then a solo run: docs/ARCHER.md AR7), the pause overlay's skip question and the
	 * skip itself (back to the menu, like Leave run).
	 */
	readonly playTutorial: () => void;
	readonly restartTutorial: () => void;
	readonly startFirstRun: () => void;
	readonly setTutorialSkipConfirm: (open: boolean) => void;
	readonly skipTutorial: () => void;
	/** Touch (docs/MOBILE.md MB10): tap a draft card (its index in the offer) to take it. */
	readonly draftTap: (index: number) => void;
	/** Touch (MB10): open / close the full map (the party overlay's Map item; a tap on the open map closes it). */
	readonly toggleMap: () => void;
}

const NOOP: HudActions = {
	pause: () => undefined,
	resume: () => undefined,
	restart: () => undefined,
	closeCoopOverlay: () => undefined,
	setSettingsOpen: () => undefined,
	updateSettings: () => undefined,
	resetSettings: () => undefined,
	setOptionsTab: () => undefined,
	setControlsDevice: () => undefined,
	updateAudio: () => undefined,
	updateDisplay: () => undefined,
	startRebind: () => undefined,
	answerConflict: () => undefined,
	clearBinding: () => undefined,
	askResetBindings: () => undefined,
	confirmResetBindings: () => undefined,
	playUi: () => undefined,
	setLeaderboardOpen: () => undefined,
	showLeaderboard: () => undefined,
	showLeaderboardTabs: () => undefined,
	setLeaveConfirm: () => undefined,
	leaveRun: () => undefined,
	exitRun: () => undefined,
	again: () => undefined,
	runOverCharacter: () => undefined,
	toggleRecapDetails: () => undefined,
	setRecapTab: () => undefined,
	playTutorial: () => undefined,
	restartTutorial: () => undefined,
	startFirstRun: () => undefined,
	setTutorialSkipConfirm: () => undefined,
	skipTutorial: () => undefined,
	draftTap: () => undefined,
	toggleMap: () => undefined,
};

export const HudActionsContext = React.createContext<HudActions>(NOOP);

export function useHudActions(): HudActions {
	return useContext(HudActionsContext);
}
