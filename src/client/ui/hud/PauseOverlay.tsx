import React, { useEffect, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService } from "@rbxts/services";
import {
	selectAnyPanelOpen,
	selectCoopOverlay,
	selectInputDevice,
	selectLeaveConfirm,
	selectRunInfo,
	selectSnapshot,
} from "client/store";
import { role, str } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { HUD_STRINGS, HUD_VIEW, LEADERBOARD_STRINGS, PAUSE_HINT } from "shared/view/hud";
import { MENU_STRINGS, pauseItems, type PauseItem } from "shared/view/menu";
import { useHudActions, type HudActions } from "./actions";
import { MenuButton, Panel, Row, Text } from "./primitives";

const HALF = 0.5;
const CONFIRM_BUTTON = new Vector2(HUD_VIEW.buttonSize.x / 2, HUD_VIEW.buttonSize.y);

interface ItemSpec {
	readonly text: string;
	readonly sound: string;
	readonly run: (a: HudActions) => void;
}

const ITEMS: Record<PauseItem, ItemSpec> = {
	resume: { text: HUD_STRINGS.resume, sound: SFX.uiConfirm, run: (a) => a.resume() },
	restart: { text: HUD_STRINGS.restart, sound: SFX.uiConfirm, run: (a) => a.restart() },
	leave: { text: MENU_STRINGS.leaveRun, sound: SFX.uiClick, run: (a) => a.setLeaveConfirm(true) },
	settings: { text: HUD_STRINGS.settings, sound: SFX.uiClick, run: (a) => a.setSettingsOpen(true) },
	leaderboards: { text: LEADERBOARD_STRINGS.open, sound: SFX.uiClick, run: (a) => a.setLeaderboardOpen(true) },
};

/**
 * The pause overlay. Solo (P / Start; also while the Roblox menu is open): the run is paused, the scene dimmed,
 * "Paused" and Resume / Restart / Leave run / Options / Leaderboards. Co-op runs never pause: the same key
 * opens the party overlay (MenuController) over the running run, with Resume (closes it) / Leave run / Options /
 * Leaderboards. Leave run first shows the confirm ("Leaving ends your run..."; Leave / Cancel). With a
 * gamepad the selection starts on the first button (Cancel in the confirm). Hidden while a panel is open and once
 * the run is over (the run-over panel has the exits).
 */
export function PauseOverlay() {
	const s = useSelector(selectSnapshot);
	const info = useSelector(selectRunInfo);
	const coopOverlay = useSelector(selectCoopOverlay);
	const confirm = useSelector(selectLeaveConfirm);
	const panelOpen = useSelector(selectAnyPanelOpen);
	const device = useSelector(selectInputDevice);
	const actions = useHudActions();
	const firstRef = useRef<TextButton>();
	const coop = info.coop;
	const open = s.outcome === "playing" && !panelOpen && (coop ? coopOverlay : s.paused);

	useEffect(() => {
		if (!open || device !== "gamepad") return;
		const button = firstRef.current;
		if (button !== undefined) GuiService.SelectedObject = button;
		return () => {
			if (GuiService.SelectedObject === button) GuiService.SelectedObject = undefined;
		};
	}, [open, device, confirm]);

	if (!open) return undefined;
	const hintKey = coop ? MENU_STRINGS.coopHint : HUD_STRINGS.pauseHint;
	let body: React.Element;
	if (confirm) {
		body = (
			<>
				<Text
					order={2}
					align={Enum.TextXAlignment.Center}
					wrap={true}
					text={str(coop ? MENU_STRINGS.leaveConfirmCoop : MENU_STRINGS.leaveConfirm)}
				/>
				<Row order={3} align={Enum.HorizontalAlignment.Center}>
					<MenuButton
						order={1}
						name="LeaveYes"
						size={CONFIRM_BUTTON}
						text={str(MENU_STRINGS.leaveYes)}
						onActivated={() => {
							actions.playUi(SFX.uiConfirm);
							actions.leaveRun();
						}}
					/>
					<MenuButton
						ref={firstRef}
						order={2}
						name="LeaveNo"
						size={CONFIRM_BUTTON}
						text={str(MENU_STRINGS.leaveNo)}
						onActivated={() => {
							actions.playUi(SFX.uiClick);
							actions.setLeaveConfirm(false);
						}}
					/>
				</Row>
			</>
		);
	} else {
		const buttons = pauseItems(coop).map((item, i) => {
			const spec = ITEMS[item];
			return (
				<MenuButton
					key={item}
					ref={i === 0 ? firstRef : undefined}
					order={i + 2}
					name={item}
					text={str(spec.text)}
					onActivated={() => {
						actions.playUi(spec.sound);
						spec.run(actions);
					}}
				/>
			);
		});
		body = <>{buttons}</>;
	}
	return (
		<frame
			key="PauseOverlay"
			Size={UDim2.fromScale(1, 1)}
			BackgroundColor3={role("background")}
			BackgroundTransparency={coop ? 1 : HUD_VIEW.overlayTransparency}
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
					text={str(coop ? MENU_STRINGS.coopTitle : HUD_STRINGS.paused)}
				/>
				{body}
				<Text
					order={20}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					align={Enum.TextXAlignment.Center}
					text={str(hintKey, { key: PAUSE_HINT[device] })}
				/>
			</Panel>
		</frame>
	);
}
