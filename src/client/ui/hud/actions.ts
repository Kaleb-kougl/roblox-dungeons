import React, { useContext } from "@rbxts/react";
import type { LeaderboardBoard } from "shared/leaderboard";
import type { JuiceOverrides } from "shared/settings";

/**
 * What the HUD's menus can do. HudController builds it from the controllers (SimController, SettingsController,
 * InputController, AudioController) and provides it to the tree, so components never import controllers.
 */
export interface HudActions {
	/** Pause overlay: resume / restart the run. */
	readonly resume: () => void;
	readonly restart: () => void;
	/** Juice settings panel. */
	readonly setSettingsOpen: (open: boolean) => void;
	readonly updateSettings: (patch: JuiceOverrides) => void;
	readonly resetSettings: () => void;
	/** A menu sound by theme ID (sfx.ui.click / sfx.ui.confirm). */
	readonly playUi: (id: string) => void;
	/** Leaderboard panel (M5): open / close, and the Solo / Co-op tab. */
	readonly setLeaderboardOpen: (open: boolean) => void;
	readonly showLeaderboard: (board: LeaderboardBoard) => void;
	/** Co-op invite prompt: join or decline the pending invite. */
	readonly answerPartyInvite: (accept: boolean) => void;
}

const NOOP: HudActions = {
	resume: () => undefined,
	restart: () => undefined,
	setSettingsOpen: () => undefined,
	updateSettings: () => undefined,
	resetSettings: () => undefined,
	playUi: () => undefined,
	setLeaderboardOpen: () => undefined,
	showLeaderboard: () => undefined,
	answerPartyInvite: () => undefined,
};

export const HudActionsContext = React.createContext<HudActions>(NOOP);

export function useHudActions(): HudActions {
	return useContext(HudActionsContext);
}
