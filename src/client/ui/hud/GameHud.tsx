import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectGameActive } from "client/store";
import { HUD_VIEW } from "shared/view/hud";
import { BossBar } from "./BossBar";
import { DraftOverlay } from "./DraftOverlay";
import { Players } from "@rbxts/services";
import { InfoPanel } from "./InfoPanel";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { PartyInvitePanel } from "./PartyInvitePanel";
import { PauseOverlay } from "./PauseOverlay";
import { RunOverPanel } from "./RunOverPanel";
import { ScorePanel } from "./ScorePanel";
import { SettingsPanel } from "./SettingsPanel";
import { StatusPanel } from "./StatusPanel";
import { ToastPanel } from "./ToastPanel";
import { useHudScale } from "./useHudScale";
import { WeaponPanel } from "./WeaponPanel";

/**
 * The game HUD (task 8 part B; replaces part A's minimal text HUD), two ScreenGuis under PlayerGui:
 *
 *   KV_GameHud    StatusPanel (top left: hearts, armor, flask, Embers), WeaponPanel (bottom left: weapon sets + SWAP
 *                 hint), BossBar (top centre), ScorePanel (top right, scored runs: score + combo meter),
 *                 RunOverPanel (centre: death / victory + stats, the score breakdown in scored runs), InfoPanel
 *                 (bottom right: info, verdict, debug line), ToastPanel (top centre: M2 progression toasts and the
 *                 curse shrine hint), DraftOverlay (centre: the M2 boon draft's cards)
 *   KV_GameMenu   PauseOverlay, the co-op PartyInvitePanel (M4 consent: Join / Decline), the juice SettingsPanel and the
 *                 LeaderboardPanel (M5), above the HUD
 *
 * Both lay out at the 1280x720 reference size under a UIScale (useHudScale) and sit inside the device's safe area
 * (ScreenInsets = CoreUISafeInsets: notches, the Roblox top bar). Reads only Reflex (the ~10 Hz snapshot, the input
 * device, the verdict, the settings); text from the theme string table, colours from theme roles, the font from the
 * HUD font token (shared/view/hud HUD_FONTS).
 */
export function GameHud() {
	const active = useSelector(selectGameActive);
	const scale = useHudScale();
	return (
		<>
			<screengui
				key="KV_GameHud"
				ResetOnSpawn={false}
				DisplayOrder={HUD_VIEW.hudDisplayOrder}
				ScreenInsets={Enum.ScreenInsets.CoreUISafeInsets}
				ZIndexBehavior={Enum.ZIndexBehavior.Sibling}
			>
				<uiscale Scale={scale} />
				{active ? (
					<>
						<StatusPanel key="Status" />
						<WeaponPanel key="Weapons" />
						<BossBar key="Boss" />
						<ScorePanel key="Score" />
						<RunOverPanel key="RunOver" />
						<InfoPanel key="Info" />
						<ToastPanel key="Toasts" />
						<DraftOverlay key="Draft" />
					</>
				) : undefined}
			</screengui>
			<screengui
				key="KV_GameMenu"
				ResetOnSpawn={false}
				DisplayOrder={HUD_VIEW.menuDisplayOrder}
				ScreenInsets={Enum.ScreenInsets.CoreUISafeInsets}
				ZIndexBehavior={Enum.ZIndexBehavior.Sibling}
			>
				<uiscale Scale={scale} />
				{active ? <PauseOverlay key="Pause" /> : undefined}
				<PartyInvitePanel key="PartyInvite" />
				<SettingsPanel key="Settings" />
				<LeaderboardPanel key="Leaderboards" localUserId={Players.LocalPlayer.UserId} />
			</screengui>
		</>
	);
}
