import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectGameActive, selectGhostHeart, selectTutorialHighlight } from "client/store";
import { isBoostsHighlight } from "shared/view/boosts";
import { HUD_VIEW } from "shared/view/hud";
import { PAUSE_BUTTON_VIEW } from "shared/view/menu";
import { BossBar } from "./BossBar";
import { DraftOverlay } from "./DraftOverlay";
import { Players } from "@rbxts/services";
import { InfoPanel } from "./InfoPanel";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { PauseButton } from "./PauseButton";
import { PauseOverlay } from "./PauseOverlay";
import { RunOverPanel } from "./RunOverPanel";
import { ScorePanel } from "./ScorePanel";
import { SpectateBar } from "./SpectateBar";
import { OptionsScreen } from "./OptionsScreen";
import { StatusPanel } from "./StatusPanel";
import { ToastPanel } from "./ToastPanel";
import { ObjectiveCard } from "./ObjectiveCard";
import { TutorialOutro } from "./TutorialOutro";
import { TutorialPanel } from "./TutorialPanel";
import { useHudScale } from "./useHudScale";
import { WeaponPanel } from "./WeaponPanel";

/**
 * The game HUD (task 8 part B; replaces part A's minimal text HUD), three ScreenGuis under PlayerGui:
 *
 *   KV_GameHud    StatusPanel (top left: hearts, armor + Aegis pips, flask, Embers, the boost row), WeaponPanel (bottom left: weapon sets + SWAP
 *                 hint), BossBar (top centre), ScorePanel (top right, scored runs: score + combo meter),
 *                 RunOverPanel (centre: death / victory + stats, the score breakdown in scored runs), InfoPanel
 *                 (bottom right: info, verdict, debug line), ToastPanel (top centre: M2 progression toasts and the
 *                 curse shrine hint), DraftOverlay (centre: the M2 boon draft's cards), SpectateBar (bottom centre,
 *                 co-op: who a dead player watches, the switch hint); the first-run tutorial's
 *                 TutorialPanel (lower centre: prompt, progress, pause hint) and ObjectiveCard (centre), and its
 *                 highlight ring on the taught element (tutorial slice `highlight`) and the ghost half heart
 *   KV_GameMenu   PauseOverlay (solo: paused; co-op: the non-pausing party overlay; both with Leave run; a tutorial
 *                 run: Restart / Skip tutorial), the tutorial's outro card (TutorialOutro), the OptionsScreen (tabs:
 *                 juice, controls / rebinding, audio, display) and the LeaderboardPanel (M5), above the HUD and the
 *                 menu shell (client/ui/menu MenuLayer, mounted next to this by HudController)
 *   KV_PauseButton  PauseButton (mouse / touch; in the Roblox top bar, right of its buttons): pauses a solo run,
 *                 opens a co-op run's party overlay. Screen pixels and no safe-area insets: the top bar is outside
 *                 the safe area.
 *
 * The first two lay out at the 1280x720 reference size under a UIScale (useHudScale) and sit inside the device's
 * safe area (ScreenInsets = CoreUISafeInsets: notches, the Roblox top bar). Reads only Reflex (the ~10 Hz snapshot, the input
 * device, the verdict, the settings); text from the theme string table, colours from theme roles, the font from the
 * HUD font token (shared/view/hud HUD_FONTS).
 */
export function GameHud() {
	const active = useSelector(selectGameActive);
	const highlight = useSelector(selectTutorialHighlight);
	const ghostHeart = useSelector(selectGhostHeart);
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
						<StatusPanel
							key="Status"
							highlight={highlight === "flask" || highlight === "hearts" ? highlight : undefined}
							ghostHeart={ghostHeart}
							boostsHighlight={isBoostsHighlight(highlight)}
						/>
						<WeaponPanel key="Weapons" highlight={highlight === "weapons"} />
						<BossBar key="Boss" highlight={highlight === "bossBar"} />
						<ScorePanel key="Score" highlight={highlight === "score"} />
						<RunOverPanel key="RunOver" />
						<InfoPanel key="Info" />
						<ToastPanel key="Toasts" />
						<DraftOverlay key="Draft" />
						<SpectateBar key="Spectate" />
						<TutorialPanel key="TutorialPanel" />
						<ObjectiveCard key="ObjectiveCard" />
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
				{active ? <TutorialOutro key="TutorialOutro" /> : undefined}
				<OptionsScreen key="Options" />
				<LeaderboardPanel key="Leaderboards" localUserId={Players.LocalPlayer.UserId} />
			</screengui>
			<screengui
				key="KV_PauseButton"
				ResetOnSpawn={false}
				DisplayOrder={PAUSE_BUTTON_VIEW.displayOrder}
				ScreenInsets={Enum.ScreenInsets.None}
				ZIndexBehavior={Enum.ZIndexBehavior.Sibling}
			>
				<PauseButton key="PauseButton" />
			</screengui>
		</>
	);
}
