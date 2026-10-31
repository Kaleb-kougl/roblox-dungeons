import React, { useEffect, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService } from "@rbxts/services";
import {
	selectAnyPanelOpen,
	selectBaselineRun,
	selectBindings,
	selectCoopOverlay,
	selectInputDevice,
	selectLeaveConfirm,
	selectRobloxMenuOpen,
	selectRunBaseline,
	selectRunInfo,
	selectSnapshot,
	selectTutorial,
} from "client/store";
import { str } from "client/ui/theme";
import { swapHint, keyDevice } from "shared/play";
import { TUTORIAL_STRINGS } from "shared/tutorial";
import { SFX } from "shared/view/audio";
import {
	HUD_STRINGS,
	HUD_VIEW,
	LEADERBOARD_STRINGS,
	PAUSE_HINT,
	baselineRecord,
	bestTargetKey,
	bestText,
	isDailyBaseline,
} from "shared/view/hud";
import {
	MENU_STRINGS,
	pauseItemIcon,
	pauseItems,
	pauseOverlayShown,
	screenDividers,
	screenOrnament,
	screenSkin,
	type PauseItem,
} from "shared/view/menu";
import { useHudActions, type HudActions } from "./actions";
import { PauseMap } from "./FullMapOverlay";
import { MenuFit } from "./MenuFit";
import { Divider, MenuButton, Panel, Row, Text } from "./primitives";
import { ScreenDim } from "./ScreenDim";
import { RunInfoLine } from "./RunInfoLine";

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
	restartTutorial: { text: TUTORIAL_STRINGS.pauseRestart, sound: SFX.uiConfirm, run: (a) => a.playTutorial() },
	skipTutorial: { text: TUTORIAL_STRINGS.pauseSkip, sound: SFX.uiClick, run: (a) => a.setTutorialSkipConfirm(true) },
	map: { text: HUD_STRINGS.mapTitle, sound: SFX.uiClick, run: (a) => a.toggleMap() },
};

/** A confirm in place of the buttons: its question, then Yes / No (No is selected first with a pad). */
interface ConfirmSpec {
	readonly message: string;
	readonly yes: string;
	readonly no: string;
	readonly yesName: string;
	readonly noName: string;
	readonly onYes: (a: HudActions) => void;
	readonly onNo: (a: HudActions) => void;
}

const LEAVE_CONFIRM: ConfirmSpec = {
	message: MENU_STRINGS.leaveConfirm,
	yes: MENU_STRINGS.leaveYes,
	no: MENU_STRINGS.leaveNo,
	yesName: "LeaveYes",
	noName: "LeaveNo",
	onYes: (a) => a.leaveRun(),
	onNo: (a) => a.setLeaveConfirm(false),
};
const LEAVE_CONFIRM_COOP: ConfirmSpec = { ...LEAVE_CONFIRM, message: MENU_STRINGS.leaveConfirmCoop };
const SKIP_CONFIRM: ConfirmSpec = {
	message: TUTORIAL_STRINGS.pauseSkipConfirm,
	yes: TUTORIAL_STRINGS.pauseSkipYes,
	no: TUTORIAL_STRINGS.pauseSkipNo,
	yesName: "SkipYes",
	noName: "SkipNo",
	onYes: (a) => a.skipTutorial(),
	onNo: (a) => a.setTutorialSkipConfirm(false),
};

/**
 * The pause overlay. Solo (P / Start / the on-screen pause button, and after the Roblox menu closed: the run stays
 * paused under that menu, the overlay hidden until it closes): the run is paused, the scene dimmed,
 * "Paused" and Resume / Restart / Leave run / Options / Leaderboards. Co-op runs never pause: the same key
 * opens the party overlay (MenuController) over the running run, with Resume (closes it) / Leave run / Options /
 * Leaderboards. A first-run tutorial run (paused like solo): Resume / Restart tutorial / Skip tutorial / Options.
 * Leave run first shows the confirm ("Leaving ends your run..."; Leave / Cancel), Skip tutorial its own ("Skip the
 * tutorial?"; Skip / Keep playing). With a gamepad the selection starts on the first button (Cancel / Keep playing
 * in a confirm). Under the buttons, the weapon-swap key (the HUD's swap hint hides after a few seconds,
 * docs/HUD_LAYOUT.md H5), the run's info line and any fallback notice (RunInfoLine: docs/HUD_LAYOUT.md H6,
 * the only place they show while a run is on). Solo: the full map left of the menu (PauseMap, docs/MINIMAP.md MD5).
 * Hidden while a panel is open and once the run is over (the run-over panel has the exits). The solo dim covers the
 * whole screen (ScreenDim); the panel is fitted into the safe area on touch (MenuFit; the ornament only with room).
 * A ranked run with a record shows the target line under the buttons (`Best 48210 · floor 9`, docs/NEW_BEST.md NB9:
 * bestText of the run's frozen baseline); other runs are unchanged.
 */
export function PauseOverlay() {
	const s = useSelector(selectSnapshot);
	const info = useSelector(selectRunInfo);
	const coopOverlay = useSelector(selectCoopOverlay);
	const confirm = useSelector(selectLeaveConfirm);
	const panelOpen = useSelector(selectAnyPanelOpen);
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	const tutorial = useSelector(selectTutorial);
	const robloxMenuOpen = useSelector(selectRobloxMenuOpen);
	const baseline = useSelector(selectRunBaseline);
	const baselineRun = useSelector(selectBaselineRun);
	const actions = useHudActions();
	const firstRef = useRef<TextButton>();
	const coop = info.coop;
	const view = {
		active: true,
		coop,
		playing: s.outcome === "playing",
		paused: s.paused,
		coopOverlay,
		panelOpen,
		menuScreen: false,
		robloxMenuOpen,
		tutorialEnded: tutorial.ended,
	};
	const open = pauseOverlayShown(view);
	// Paused under the Roblox menu, the overlay is only hidden: its skip question waits for it.
	const pending = pauseOverlayShown({ ...view, robloxMenuOpen: false });
	const inTutorial = !coop && tutorial.active && !tutorial.ended;
	// Touch (MB10): no key names; the Map item (co-op) and the weapons' Swap button stand in for them.
	const touch = device === "touch";
	const skipConfirm = inTutorial && tutorial.skipConfirmOpen;

	useEffect(() => {
		if (!open || device !== "gamepad") return;
		const button = firstRef.current;
		if (button !== undefined) GuiService.SelectedObject = button;
		return () => {
			if (GuiService.SelectedObject === button) GuiService.SelectedObject = undefined;
		};
	}, [open, device, confirm, skipConfirm, inTutorial]);

	// The skip question does not outlive the overlay (resumed with P / Resume).
	useEffect(() => {
		if (!pending && tutorial.skipConfirmOpen) actions.setTutorialSkipConfirm(false);
	}, [pending, tutorial.skipConfirmOpen]);

	if (!open) return undefined;
	const hintKey = coop ? MENU_STRINGS.coopHint : HUD_STRINGS.pauseHint;
	// A daily run's baseline is best today (docs/DAILY.md DS10): "Best today {score}".
	const best =
		baselineRun === info.run
			? bestText(baselineRecord(baseline), bestTargetKey(isDailyBaseline(baseline)), str)
			: "";
	let body: React.Element;
	if ((confirm && !inTutorial) || skipConfirm) {
		const spec = skipConfirm ? SKIP_CONFIRM : coop ? LEAVE_CONFIRM_COOP : LEAVE_CONFIRM;
		body = (
			<>
				<Text order={2} align={Enum.TextXAlignment.Center} wrap={true} text={str(spec.message)} />
				<Row order={3} align={Enum.HorizontalAlignment.Center}>
					<MenuButton
						order={1}
						name={spec.yesName}
						size={CONFIRM_BUTTON}
						text={str(spec.yes)}
						onActivated={() => {
							actions.playUi(SFX.uiConfirm);
							spec.onYes(actions);
						}}
					/>
					<MenuButton
						ref={firstRef}
						order={2}
						name={spec.noName}
						size={CONFIRM_BUTTON}
						text={str(spec.no)}
						onActivated={() => {
							actions.playUi(SFX.uiBack);
							spec.onNo(actions);
						}}
					/>
				</Row>
			</>
		);
	} else {
		const buttons = pauseItems(coop, inTutorial, touch).map((item, i) => {
			const spec = ITEMS[item];
			return (
				<MenuButton
					key={item}
					ref={i === 0 ? firstRef : undefined}
					order={i + 2}
					name={item}
					text={str(spec.text)}
					icon={pauseItemIcon(item)}
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
		<frame key="PauseOverlay" Size={UDim2.fromScale(1, 1)} BackgroundTransparency={1} BorderSizePixel={0}>
			{coop ? undefined : <ScreenDim key="Dim" name="PauseDim" transparency={HUD_VIEW.overlayTransparency} />}
			{coop ? undefined : <PauseMap key="Map" />}
			<MenuFit
				ornament={screenOrnament("pause")}
				render={(layout) => (
					<Panel
						width={HUD_VIEW.panelWidth}
						align={Enum.HorizontalAlignment.Center}
						padding={HUD_VIEW.pad * 2}
						skin={screenSkin("pause")}
						ornament={layout.ornament}
					>
						<Text
							fill={true}
							order={1}
							size={HUD_VIEW.bigText}
							color="uiAccent"
							align={Enum.TextXAlignment.Center}
							text={str(coop ? MENU_STRINGS.coopTitle : HUD_STRINGS.paused)}
						/>
						{body}
						{screenDividers("pause") ? (
							<Divider key="Divider" order={17} skin={screenSkin("pause")} />
						) : undefined}
						{best !== "" ? (
							<Text
								key="Best"
								fill={true}
								order={18}
								size={HUD_VIEW.smallText}
								color="uiTextDim"
								align={Enum.TextXAlignment.Center}
								text={best}
							/>
						) : undefined}
						{s.weapons.size() > 0 && !touch ? (
							<Text
								fill={true}
								order={19}
								size={HUD_VIEW.smallText}
								color="uiTextDim"
								align={Enum.TextXAlignment.Center}
								text={str(HUD_STRINGS.weaponSwap, { key: swapHint(bindings)[keyDevice(device)] })}
							/>
						) : undefined}
						{touch && s.floor > 0 ? (
							<Text
								fill={true}
								order={19}
								size={HUD_VIEW.smallText}
								color="uiText"
								align={Enum.TextXAlignment.Center}
								text={str(HUD_STRINGS.floor, { floor: s.floor, depth: s.depth })}
							/>
						) : undefined}
						<RunInfoLine order={20} />
						{touch ? undefined : (
							<Text
								fill={true}
								order={21}
								size={HUD_VIEW.smallText}
								color="uiTextDim"
								align={Enum.TextXAlignment.Center}
								text={str(hintKey, { key: PAUSE_HINT[keyDevice(device)] })}
							/>
						)}
					</Panel>
				)}
			/>
		</frame>
	);
}
