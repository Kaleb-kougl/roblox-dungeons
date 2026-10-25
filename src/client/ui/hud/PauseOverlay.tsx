import React, { useEffect, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService } from "@rbxts/services";
import { selectAnyPanelOpen, selectInputDevice, selectSnapshot } from "client/store";
import { role, str } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { HUD_STRINGS, HUD_VIEW, LEADERBOARD_STRINGS, PAUSE_HINT } from "shared/view/hud";
import { useHudActions } from "./actions";
import { MenuButton, Panel, Text } from "./primitives";

const HALF = 0.5;

/**
 * The pause overlay (P / Start; also while the Roblox menu is open): the scene dimmed, "Paused", and Resume /
 * Restart / Juice settings buttons (the gamepad route to the settings panel). With a gamepad the selection starts on
 * Resume (the InputController lets the navigation keys through while a menu is open). Hidden while the settings panel
 * is open and once the run is over (the run-over panel has the restart).
 */
export function PauseOverlay() {
	const s = useSelector(selectSnapshot);
	const panelOpen = useSelector(selectAnyPanelOpen);
	const device = useSelector(selectInputDevice);
	const actions = useHudActions();
	const resumeRef = useRef<TextButton>();
	const open = s.paused && s.outcome === "playing" && !panelOpen;

	useEffect(() => {
		if (!open || device !== "gamepad") return;
		const button = resumeRef.current;
		if (button !== undefined) GuiService.SelectedObject = button;
		return () => {
			if (GuiService.SelectedObject === button) GuiService.SelectedObject = undefined;
		};
	}, [open, device]);

	if (!open) return undefined;
	return (
		<frame
			key="PauseOverlay"
			Size={UDim2.fromScale(1, 1)}
			BackgroundColor3={role("background")}
			BackgroundTransparency={HUD_VIEW.overlayTransparency}
			BorderSizePixel={0}
		>
			<Panel
				position={UDim2.fromScale(HALF, HALF)}
				anchor={new Vector2(HALF, HALF)}
				width={HUD_VIEW.panelWidth}
				align={Enum.HorizontalAlignment.Center}
				padding={HUD_VIEW.pad * 2}
			>
				<Text
					order={1}
					size={HUD_VIEW.bigText}
					color="uiAccent"
					align={Enum.TextXAlignment.Center}
					text={str(HUD_STRINGS.paused)}
				/>
				<MenuButton
					ref={resumeRef}
					order={2}
					name="Resume"
					text={str(HUD_STRINGS.resume)}
					onActivated={() => {
						actions.playUi(SFX.uiConfirm);
						actions.resume();
					}}
				/>
				<MenuButton
					order={3}
					name="Restart"
					text={str(HUD_STRINGS.restart)}
					onActivated={() => {
						actions.playUi(SFX.uiConfirm);
						actions.restart();
					}}
				/>
				<MenuButton
					order={4}
					name="Settings"
					text={str(HUD_STRINGS.settings)}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.setSettingsOpen(true);
					}}
				/>
				<MenuButton
					order={5}
					name="Leaderboards"
					text={str(LEADERBOARD_STRINGS.open)}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.setLeaderboardOpen(true);
					}}
				/>
				<Text
					order={6}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					align={Enum.TextXAlignment.Center}
					text={str(HUD_STRINGS.pauseHint, { key: PAUSE_HINT[device] })}
				/>
			</Panel>
		</frame>
	);
}
