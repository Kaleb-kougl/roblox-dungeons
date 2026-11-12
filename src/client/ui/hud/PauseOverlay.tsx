import React, { useEffect, useRef, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import {
	selectAnyPanelOpen,
	selectBaselineRun,
	selectBindings,
	selectCoopOverlay,
	selectInputDevice,
	selectLeaveConfirm,
	selectMapView,
	selectMenuScreen,
	selectRobloxMenuOpen,
	selectRunBaseline,
	selectRunInfo,
	selectSnapshot,
	selectTutorial,
} from "client/store";
import { useFocusScope, useOpeningId } from "client/ui/focus";
import { str } from "client/ui/theme";
import { swapHint, keyDevice } from "shared/play";
import { FLOOR_MODIFIER_PAUSE_KEY } from "shared/theme";
import { TUTORIAL_STRINGS } from "shared/tutorial";
import { PORTRAIT, modifierCardRows } from "shared/view";
import { SFX } from "shared/view/audio";
import {
	HUD_STRINGS,
	HUD_VIEW,
	LEADERBOARD_STRINGS,
	TOOLTIP_STRINGS,
	pauseHint,
	baselineRecord,
	bestTargetKey,
	bestText,
	hasSwapTarget,
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
import { PauseBuild, hasBuildItems } from "./BuildList";
import { PauseMap } from "./FullMapOverlay";
import { MenuFit } from "./MenuFit";
import { PadHintBar } from "./PadHintBar";
import { Divider, MenuButton, Panel, Row, Text } from "./primitives";
import { ScreenDim } from "./ScreenDim";
import { usePortrait } from "./usePortrait";
import { RunInfoLine } from "./RunInfoLine";
import { useFloorModifier } from "./FloorModifierChip";

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
	restartTutorial: { text: TUTORIAL_STRINGS.pauseRestart, sound: SFX.uiConfirm, run: (a) => a.restartTutorial() },
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
 * in a confirm): an `overlay` focus scope (surface pause / party) with memory for the time it is open (back from
 * Options, Leaderboards or a confirm lands on the button that opened it; a new pause starts on Resume), the confirm a
 * `confirm` scope over it (docs/GAMEPAD_MENUS.md GM2). Pad B (GM3): solo resumes (as Resume), the party overlay
 * closes, a confirm cancels (as Cancel / Keep playing). Under the buttons, the weapon-swap key (the HUD's swap hint
 * hides after a few seconds, docs/HUD_LAYOUT.md H5), the run's info line and any fallback notice (RunInfoLine: docs/HUD_LAYOUT.md H6,
 * the only place they show while a run is on). Solo: the full map left of the menu (PauseMap, docs/MINIMAP.md MD5);
 * solo and co-op: the local player's Build list right of it (PauseBuild, docs/BUILDS.md BU10).
 * Hidden while a panel is open and once the run is over (the run-over panel has the exits). The solo dim covers the
 * whole screen (ScreenDim); the panel is fitted into the safe area on touch (MenuFit; the ornament only with room).
 * A ranked run with a record shows the target line under the buttons (`Best 48210 · floor 9`, docs/NEW_BEST.md NB9:
 * bestText of the run's frozen baseline); other runs are unchanged. On a floor modifier's floor
 * (docs/FLOOR_MODIFIERS.md FM6) one line over the run's info line: `hud.pause.floorMod` (`Gilded · A Goldling is
 * certain`) in the kind's colour; the compact layout (a landscape phone) drops the divider then, so the panel keeps
 * its fit (shared/view/menu fit.spec).
 */
export function PauseOverlay() {
	const s = useSelector(selectSnapshot);
	const info = useSelector(selectRunInfo);
	const modifierRows = modifierCardRows(useFloorModifier());
	const coopOverlay = useSelector(selectCoopOverlay);
	const confirm = useSelector(selectLeaveConfirm);
	const panelOpen = useSelector(selectAnyPanelOpen);
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	const tutorial = useSelector(selectTutorial);
	const robloxMenuOpen = useSelector(selectRobloxMenuOpen);
	// docs/ARCHER.md AR7: the character screen (the dev panel's Go over a paused run) hides the overlay.
	const menuScreen = useSelector(selectMenuScreen) !== "none";
	const baseline = useSelector(selectRunBaseline);
	const baselineRun = useSelector(selectBaselineRun);
	const actions = useHudActions();
	const firstRef = useRef<TextButton>();
	const noRef = useRef<TextButton>();
	const rootRef = useRef<Frame>();
	const coop = info.coop;
	const portrait = usePortrait();
	const mapAvailable = useSelector(selectMapView).available;
	/** Upright (docs/ITEM_TOOLTIPS.md IT8, ITD7): the Build list shown in the map's area instead of the map. */
	const [buildShown, setBuildShown] = useState(false);
	const view = {
		active: true,
		coop,
		playing: s.outcome === "playing",
		paused: s.paused,
		coopOverlay,
		panelOpen,
		menuScreen,
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
	const confirmShown = (confirm && !inTutorial) || skipConfirm;
	const confirmSpec = skipConfirm ? SKIP_CONFIRM : coop ? LEAVE_CONFIRM_COOP : LEAVE_CONFIRM;
	// One memory per opening (a panel over the overlay keeps it; the next pause starts on Resume).
	const opened = useOpeningId(coop ? coopOverlay : s.paused);
	useFocusScope(rootRef, {
		id: "pause",
		layer: "overlay",
		surface: coop ? "party" : "pause",
		defaultRef: firstRef,
		memoryKey: `pause${opened}`,
		active: open && !confirmShown,
		onPadAction: (action) => {
			if (action.kind === "resume") {
				actions.playUi(ITEMS.resume.sound);
				ITEMS.resume.run(actions);
			} else if (action.kind === "close") {
				actions.playUi(SFX.uiBack);
				actions.closeCoopOverlay();
			}
		},
	});
	useFocusScope(rootRef, {
		id: "pauseConfirm",
		layer: "confirm",
		surface: "confirm",
		defaultRef: noRef,
		active: open && confirmShown,
		onPadAction: (action) => {
			if (action.kind !== "cancel") return;
			actions.playUi(SFX.uiBack);
			confirmSpec.onNo(actions);
		},
	});

	// The upright Build / Map toggle starts on the map at every open.
	useEffect(() => {
		if (!open) setBuildShown(false);
	}, [open]);

	// The skip question does not outlive the overlay (resumed with P / Resume).
	useEffect(() => {
		if (!pending && tutorial.skipConfirmOpen) actions.setTutorialSkipConfirm(false);
	}, [pending, tutorial.skipConfirmOpen]);

	if (!open) return undefined;
	// Upright: the Build / Map toggle when anything is owned; the map's area holds the list while it is on.
	const mapArea = !coop && mapAvailable;
	const buildToggle = portrait && hasBuildItems(s, true);
	const buildOn = buildToggle && buildShown;
	const hintKey = coop ? MENU_STRINGS.coopHint : HUD_STRINGS.pauseHint;
	// A daily run's baseline is best today (docs/DAILY.md DS10): "Best today {score}".
	const best =
		baselineRun === info.run
			? bestText(baselineRecord(baseline), bestTargetKey(isDailyBaseline(baseline)), str)
			: "";
	let body: React.Element;
	if (confirmShown) {
		const spec = confirmSpec;
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
						ref={noRef}
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
		// docs/ITEM_TOOLTIPS.md IT8 (ITD7): upright, a Build item swaps the map's area for the Build list and back (its
		// label names what it shows next: Map where the solo map stands, else Build again in the party overlay).
		if (buildToggle) {
			buttons.push(
				<MenuButton
					key="buildToggle"
					order={buttons.size() + 2}
					name="buildToggle"
					text={str(buildOn && mapArea ? TOOLTIP_STRINGS.pauseMap : TOOLTIP_STRINGS.pauseBuild)}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						setBuildShown(!buildShown);
					}}
				/>,
			);
		}
		body = <>{buttons}</>;
	}
	const split = portrait && (mapArea || buildOn);
	// Landscape: beside the menu; upright: in the map's area while the toggle is on.
	const buildPanel = !portrait ? (
		<PauseBuild key="Build" />
	) : buildOn ? (
		<PauseBuild key="Build" top={true} />
	) : undefined;
	const menuFit = (
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
					{screenDividers("pause") && !(layout.compact && modifierRows !== undefined) ? (
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
					{hasSwapTarget(s.weapons) && !touch ? (
						<Text
							fill={true}
							order={19}
							size={HUD_VIEW.smallText}
							color="uiTextDim"
							align={Enum.TextXAlignment.Center}
							text={str(HUD_STRINGS.weaponSwap, { key: swapHint(bindings, str)[keyDevice(device)] })}
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
					{modifierRows !== undefined ? (
						<Text
							key="FloorModifier"
							fill={true}
							order={20}
							size={HUD_VIEW.smallText}
							color={modifierRows.role}
							align={Enum.TextXAlignment.Center}
							wrap={true}
							text={str(FLOOR_MODIFIER_PAUSE_KEY, {
								name: str(modifierRows.nameKey),
								line: str(modifierRows.lineKey),
							})}
						/>
					) : undefined}
					<RunInfoLine order={21} />
					{device === "gamepad" ? (
						<PadHintBar order={22} surface={confirmShown ? "confirm" : coop ? "party" : "pause"} />
					) : touch ? undefined : (
						<Text
							fill={true}
							order={22}
							size={HUD_VIEW.smallText}
							color="uiTextDim"
							align={Enum.TextXAlignment.Center}
							text={str(hintKey, { key: pauseHint(str)[keyDevice(device)] })}
						/>
					)}
				</Panel>
			)}
		/>
	);
	return (
		<frame
			key="PauseOverlay"
			ref={rootRef}
			Size={UDim2.fromScale(1, 1)}
			BackgroundTransparency={1}
			BorderSizePixel={0}
		>
			{coop ? undefined : <ScreenDim key="Dim" name="PauseDim" transparency={HUD_VIEW.overlayTransparency} />}
			{coop || buildOn ? undefined : <PauseMap key="Map" portrait={portrait} />}
			{buildPanel}
			{split ? (
				// Upright with the map (docs/PORTRAIT.md PT6): the panel fits into the frame under it (MenuFit measures its
				// parent; shared/view/menu pausePanelArea is the formula).
				<frame
					key="PanelArea"
					Position={new UDim2(0, 0, PORTRAIT.pauseMapShare, HUD_VIEW.gap)}
					Size={new UDim2(1, 0, 1 - PORTRAIT.pauseMapShare, -HUD_VIEW.gap)}
					BackgroundTransparency={1}
				>
					{menuFit}
				</frame>
			) : (
				menuFit
			)}
		</frame>
	);
}
