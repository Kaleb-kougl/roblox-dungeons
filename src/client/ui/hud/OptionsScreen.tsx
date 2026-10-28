import React, { useEffect, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService } from "@rbxts/services";
import {
	selectAudio,
	selectBindings,
	selectDisplay,
	selectInputDevice,
	selectJuice,
	selectOptions,
	selectOptionsModal,
	selectPanelOpen,
	selectSettingsSynced,
	selectSystemReducedMotion,
	type OptionsState,
} from "client/store";
import { HUD_FONT, role, str } from "client/ui/theme";
import {
	KBM_ACTIONS,
	PAD_ACTIONS,
	inputLabel,
	slotInput,
	type BindingDevice,
	type Bindings,
	type GameAction,
	keyDevice,
} from "shared/play";
import {
	AUDIO_SETTING_KEYS,
	HEALTH_BARS_MODES,
	HUD_SCALE_PERCENTS,
	PARTICLES_LEVELS,
	stepVolume,
	type AudioSettings,
	type JuiceOverrides,
} from "shared/settings";
import { SFX } from "shared/view/audio";
import {
	HUD_VIEW,
	OPTIONS_DEVICES,
	OPTIONS_STRINGS,
	OPTIONS_TABS,
	OPTIONS_VIEW,
	SETTINGS_HINT,
	SETTINGS_STRINGS,
	actionNameKey,
	optionsDeviceKey,
	optionsTabKey,
	refusalKey,
} from "shared/view/hud";
import { useHudActions, type HudActions } from "./actions";
import { MenuButton, Panel, Row, Text } from "./primitives";

const HALF = 0.5;
const HIDDEN = 1;
/** Modal prompts draw above the screen (ZIndexBehavior Sibling: later siblings on top; this keeps it explicit). */
const MODAL_Z = 10;

interface Option<T> {
	readonly value: T;
	readonly label: string;
}

/** Selects `button` for the gamepad (no-op without one). */
function selectButton(button: GuiObject | undefined): void {
	if (button !== undefined && button.Parent !== undefined) GuiService.SelectedObject = button;
}

/** One setting: its label and a row of option buttons, the current one highlighted (web JuiceSettingsPanel Row). */
function SettingRow<T extends string | boolean | number>(props: {
	order: number;
	name: string;
	label: string;
	value: T;
	options: ReadonlyArray<Option<T>>;
	onPick: (v: T) => void;
	selectable: boolean;
	/** Button width (reference px); default HUD_VIEW.optionSize.x. */
	optionWidth?: number;
}) {
	const buttons = props.options.map((o, i) => (
		<MenuButton
			key={`${props.name}${tostring(o.value)}`}
			order={i + 1}
			name={`${props.name}_${tostring(o.value)}`}
			text={o.label}
			active={o.value === props.value}
			selectable={props.selectable}
			size={new Vector2(props.optionWidth ?? HUD_VIEW.optionSize.x, HUD_VIEW.optionSize.y)}
			textSize={HUD_VIEW.smallText}
			onActivated={() => props.onPick(o.value)}
		/>
	));
	return (
		<Row order={props.order}>
			<Text order={0} width={HUD_VIEW.settingsLabelWidth} text={props.label} />
			{buttons}
		</Row>
	);
}

// ---------------------------------------------------------------------------------------------
// Juice tab (the former juice settings panel's rows)

function JuiceTab(props: { order: number; actions: HudActions; selectable: boolean }) {
	const s = useSelector(selectJuice);
	const system = useSelector(selectSystemReducedMotion);
	const on = str(SETTINGS_STRINGS.on);
	const off = str(SETTINGS_STRINGS.off);
	const onOff: ReadonlyArray<Option<boolean>> = [
		{ value: true, label: on },
		{ value: false, label: off },
	];
	const pick = (patch: JuiceOverrides) => {
		props.actions.playUi(SFX.uiClick);
		props.actions.updateSettings(patch);
	};
	const sel = props.selectable;
	return (
		<Panel position={new UDim2()} anchor={new Vector2()} order={props.order} transparency={HIDDEN} padding={0}>
			<SettingRow
				order={1}
				name="healthBars"
				selectable={sel}
				label={str(SETTINGS_STRINGS.healthBars)}
				value={s.healthBars}
				options={HEALTH_BARS_MODES.map((v) => ({
					value: v,
					label: str(`${SETTINGS_STRINGS.healthBarsPrefix}${v}`),
				}))}
				onPick={(v) => pick({ healthBars: v })}
			/>
			<SettingRow
				order={2}
				name="damageNumbers"
				selectable={sel}
				label={str(SETTINGS_STRINGS.damageNumbers)}
				value={s.damageNumbers}
				options={onOff}
				onPick={(v) => pick({ damageNumbers: v })}
			/>
			<SettingRow
				order={3}
				name="freezeFrame"
				selectable={sel}
				label={str(SETTINGS_STRINGS.freezeFrame)}
				value={s.freezeFrame}
				options={onOff}
				onPick={(v) => pick({ freezeFrame: v })}
			/>
			<SettingRow
				order={4}
				name="screenShake"
				selectable={sel}
				label={str(SETTINGS_STRINGS.screenShake)}
				value={s.screenShake}
				options={onOff}
				onPick={(v) => pick({ screenShake: v })}
			/>
			<SettingRow
				order={5}
				name="particles"
				selectable={sel}
				label={str(SETTINGS_STRINGS.particles)}
				value={s.particles}
				options={PARTICLES_LEVELS.map((v) => ({
					value: v,
					label: str(`${SETTINGS_STRINGS.particlesPrefix}${v}`),
				}))}
				onPick={(v) => pick({ particles: v })}
			/>
			<SettingRow
				order={6}
				name="reducedMotion"
				selectable={sel}
				label={str(SETTINGS_STRINGS.reducedMotion)}
				value={s.reducedMotion}
				options={onOff}
				onPick={(v) => pick({ reducedMotion: v })}
			/>
			<Text
				fill={true}
				order={7}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				text={str(SETTINGS_STRINGS.system, { value: system ? on : off })}
			/>
		</Panel>
	);
}

// ---------------------------------------------------------------------------------------------
// Controls tab

function slotText(b: Bindings, device: BindingDevice, action: GameAction, slot: 0 | 1): string {
	const input = slotInput(b, device, action, slot);
	return input !== undefined ? inputLabel(input) : str(OPTIONS_STRINGS.emptySlot);
}

function BindingRow(props: {
	order: number;
	device: BindingDevice;
	action: GameAction;
	bindings: Bindings;
	selectable: boolean;
	onCapture: (slot: 0 | 1) => void;
	onClear: () => void;
}) {
	const { device, action, bindings } = props;
	const slot = new Vector2(OPTIONS_VIEW.slotSize.x, OPTIONS_VIEW.slotSize.y);
	const hasSecondary = slotInput(bindings, device, action, 1) !== undefined;
	return (
		<Row order={props.order}>
			<Text
				order={0}
				width={OPTIONS_VIEW.actionWidth}
				size={HUD_VIEW.smallText}
				text={str(actionNameKey(action))}
			/>
			<MenuButton
				order={1}
				name={`${action}_primary`}
				text={slotText(bindings, device, action, 0)}
				size={slot}
				textSize={HUD_VIEW.smallText}
				selectable={props.selectable}
				onActivated={() => props.onCapture(0)}
			/>
			{device === "kbm" ? (
				<MenuButton
					order={2}
					name={`${action}_secondary`}
					text={slotText(bindings, device, action, 1)}
					size={slot}
					textSize={HUD_VIEW.smallText}
					selectable={props.selectable}
					onActivated={() => props.onCapture(1)}
				/>
			) : undefined}
			{device === "kbm" && hasSecondary ? (
				<MenuButton
					order={3}
					name={`${action}_clear`}
					text={str(OPTIONS_STRINGS.clear)}
					size={new Vector2(OPTIONS_VIEW.clearSize.x, OPTIONS_VIEW.clearSize.y)}
					textSize={HUD_VIEW.smallText}
					selectable={props.selectable}
					onActivated={props.onClear}
				/>
			) : undefined}
		</Row>
	);
}

function TestStrip(props: { order: number; device: BindingDevice; pressed: ReadonlyArray<GameAction> }) {
	const actions = props.device === "kbm" ? KBM_ACTIONS : PAD_ACTIONS;
	const chips = actions.map((action, i) => {
		const lit = props.pressed.includes(action);
		return (
			<textlabel
				key={action}
				LayoutOrder={i}
				BackgroundColor3={role(lit ? "uiAccent" : "uiPanel")}
				BackgroundTransparency={lit ? 0 : HUD_VIEW.panelTransparency}
				BorderSizePixel={0}
				Font={HUD_FONT}
				TextSize={OPTIONS_VIEW.chipText}
				TextColor3={role(lit ? "uiPanel" : "uiTextDim")}
				TextTruncate={Enum.TextTruncate.AtEnd}
				Text={str(actionNameKey(action))}
			>
				<uistroke
					ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
					Thickness={1}
					Color={role(lit ? "uiAccent" : "uiTextDim")}
				/>
			</textlabel>
		);
	});
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(1, 0, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
		>
			<uigridlayout
				CellSize={new UDim2(0, OPTIONS_VIEW.chipSize.x, 0, OPTIONS_VIEW.chipSize.y)}
				CellPadding={new UDim2(0, HUD_VIEW.gap, 0, HUD_VIEW.gap)}
				SortOrder={Enum.SortOrder.LayoutOrder}
			/>
			{chips}
		</frame>
	);
}

function ControlsTab(props: {
	order: number;
	actions: HudActions;
	options: OptionsState;
	selectable: boolean;
	rememberFocus: () => void;
}) {
	const bindings = useSelector(selectBindings);
	const { actions, options } = props;
	const device = options.controlsDevice;
	const list = device === "kbm" ? KBM_ACTIONS : PAD_ACTIONS;
	const sel = props.selectable;
	const deviceTabs = OPTIONS_DEVICES.map((d, i) => (
		<MenuButton
			key={d}
			order={i + 1}
			name={`device_${d}`}
			text={str(optionsDeviceKey(d))}
			active={d === device}
			selectable={sel}
			size={new Vector2(OPTIONS_VIEW.slotSize.x, OPTIONS_VIEW.tabSize.y)}
			textSize={HUD_VIEW.smallText}
			onActivated={() => {
				actions.playUi(SFX.uiClick);
				actions.setControlsDevice(d);
			}}
		/>
	));
	const rows = list.map((action, i) => (
		<BindingRow
			key={`${device}_${action}`}
			order={i + 1}
			device={device}
			action={action}
			bindings={bindings}
			selectable={sel}
			onCapture={(slot) => {
				actions.playUi(SFX.uiClick);
				props.rememberFocus();
				actions.startRebind({ device, action, slot });
			}}
			onClear={() => {
				actions.playUi(SFX.uiClick);
				actions.clearBinding(action);
			}}
		/>
	));
	const notice = options.notice;
	return (
		<Panel position={new UDim2()} anchor={new Vector2()} order={props.order} transparency={HIDDEN} padding={0}>
			<Row order={1}>{deviceTabs}</Row>
			<Row order={2}>
				<Text order={0} width={OPTIONS_VIEW.actionWidth} size={HUD_VIEW.smallText} text="" />
				<Text
					order={1}
					width={OPTIONS_VIEW.slotSize.x}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					align={Enum.TextXAlignment.Center}
					text={str(device === "kbm" ? OPTIONS_STRINGS.primary : OPTIONS_STRINGS.button)}
				/>
				{device === "kbm" ? (
					<Text
						order={2}
						width={OPTIONS_VIEW.slotSize.x}
						size={HUD_VIEW.smallText}
						color="uiTextDim"
						align={Enum.TextXAlignment.Center}
						text={str(OPTIONS_STRINGS.secondary)}
					/>
				) : undefined}
			</Row>
			<scrollingframe
				LayoutOrder={3}
				Size={new UDim2(1, 0, 0, OPTIONS_VIEW.listHeight)}
				CanvasSize={new UDim2()}
				AutomaticCanvasSize={Enum.AutomaticSize.Y}
				ScrollingDirection={Enum.ScrollingDirection.Y}
				ScrollBarThickness={OPTIONS_VIEW.scrollBar}
				ScrollBarImageColor3={role("uiTextDim")}
				BackgroundTransparency={HIDDEN}
				BorderSizePixel={0}
				Selectable={false}
			>
				<uilistlayout SortOrder={Enum.SortOrder.LayoutOrder} Padding={new UDim(0, HUD_VIEW.gap)} />
				{rows}
			</scrollingframe>
			<Text fill={true} order={4} size={HUD_VIEW.smallText} color="uiTextDim" text={str(OPTIONS_STRINGS.test)} />
			<TestStrip order={5} device={device} pressed={options.pressed} />
			{notice !== undefined ? (
				<Text
					order={6}
					size={HUD_VIEW.smallText}
					color="telegraph"
					wrap={true}
					text={str(refusalKey(notice.reason), {
						input: inputLabel(notice.input),
						action: str(actionNameKey(notice.action)),
					})}
				/>
			) : undefined}
			<MenuButton
				order={7}
				name="ResetBindings"
				text={str(OPTIONS_STRINGS.resetDevice, { device: str(optionsDeviceKey(device)) })}
				size={new Vector2(OPTIONS_VIEW.slotSize.x * 2, HUD_VIEW.buttonSize.y)}
				textSize={HUD_VIEW.smallText}
				selectable={sel}
				onActivated={() => {
					actions.playUi(SFX.uiClick);
					props.rememberFocus();
					actions.askResetBindings(device);
				}}
			/>
		</Panel>
	);
}

// ---------------------------------------------------------------------------------------------
// Audio and display tabs

function AudioTab(props: { order: number; actions: HudActions; selectable: boolean }) {
	const audio = useSelector(selectAudio);
	const labels: Record<keyof AudioSettings, string> = {
		master: OPTIONS_STRINGS.master,
		music: OPTIONS_STRINGS.music,
		sfx: OPTIONS_STRINGS.sfx,
	};
	const step = new Vector2(OPTIONS_VIEW.stepSize.x, OPTIONS_VIEW.stepSize.y);
	const rows = AUDIO_SETTING_KEYS.map((key, i) => {
		const set = (direction: 1 | -1) => {
			props.actions.playUi(SFX.uiClick);
			const patch: Partial<AudioSettings> = {};
			patch[key] = stepVolume(audio[key], direction);
			props.actions.updateAudio(patch);
		};
		return (
			<Row key={key} order={i + 1}>
				<Text order={0} width={HUD_VIEW.settingsLabelWidth} text={str(labels[key])} />
				<MenuButton
					order={1}
					name={`${key}_down`}
					text={str(OPTIONS_STRINGS.down)}
					size={step}
					selectable={props.selectable}
					onActivated={() => set(-1)}
				/>
				<Text
					order={2}
					width={OPTIONS_VIEW.valueWidth}
					align={Enum.TextXAlignment.Center}
					text={str(OPTIONS_STRINGS.percent, { value: audio[key] })}
				/>
				<MenuButton
					order={3}
					name={`${key}_up`}
					text={str(OPTIONS_STRINGS.up)}
					size={step}
					selectable={props.selectable}
					onActivated={() => set(1)}
				/>
			</Row>
		);
	});
	return (
		<Panel position={new UDim2()} anchor={new Vector2()} order={props.order} transparency={HIDDEN} padding={0}>
			{rows}
		</Panel>
	);
}

function DisplayTab(props: { order: number; actions: HudActions; selectable: boolean }) {
	const display = useSelector(selectDisplay);
	return (
		<Panel position={new UDim2()} anchor={new Vector2()} order={props.order} transparency={HIDDEN} padding={0}>
			<SettingRow
				order={1}
				name="hudScale"
				selectable={props.selectable}
				label={str(OPTIONS_STRINGS.hudScale)}
				value={display.hudScale}
				optionWidth={HUD_VIEW.scaleOptionWidth}
				options={HUD_SCALE_PERCENTS.map((p) => ({
					value: p,
					label: str(OPTIONS_STRINGS.percent, { value: p }),
				}))}
				onPick={(v) => {
					props.actions.playUi(SFX.uiClick);
					props.actions.updateDisplay({ hudScale: v });
				}}
			/>
			<SettingRow
				order={2}
				name="roomEdges"
				selectable={props.selectable}
				label={str(OPTIONS_STRINGS.roomEdges)}
				value={display.roomEdges}
				options={[
					{ value: true, label: str(SETTINGS_STRINGS.on) },
					{ value: false, label: str(SETTINGS_STRINGS.off) },
				]}
				onPick={(v) => {
					props.actions.playUi(SFX.uiClick);
					props.actions.updateDisplay({ roomEdges: v });
				}}
			/>
			<SettingRow
				order={3}
				name="hudFade"
				selectable={props.selectable}
				label={str(OPTIONS_STRINGS.hudFade)}
				value={display.hudFade}
				options={[
					{ value: true, label: str(SETTINGS_STRINGS.on) },
					{ value: false, label: str(SETTINGS_STRINGS.off) },
				]}
				onPick={(v) => {
					props.actions.playUi(SFX.uiClick);
					props.actions.updateDisplay({ hudFade: v });
				}}
			/>
			<SettingRow
				order={4}
				name="minimap"
				selectable={props.selectable}
				label={str(OPTIONS_STRINGS.minimap)}
				value={display.minimap}
				options={[
					{ value: true, label: str(SETTINGS_STRINGS.on) },
					{ value: false, label: str(SETTINGS_STRINGS.off) },
				]}
				onPick={(v) => {
					props.actions.playUi(SFX.uiClick);
					props.actions.updateDisplay({ minimap: v });
				}}
			/>
			<SettingRow
				order={5}
				name="playerOutline"
				selectable={props.selectable}
				label={str(OPTIONS_STRINGS.playerOutline)}
				value={display.playerOutline}
				options={[
					{ value: true, label: str(SETTINGS_STRINGS.on) },
					{ value: false, label: str(SETTINGS_STRINGS.off) },
				]}
				onPick={(v) => {
					props.actions.playUi(SFX.uiClick);
					props.actions.updateDisplay({ playerOutline: v });
				}}
			/>
		</Panel>
	);
}

// ---------------------------------------------------------------------------------------------
// Prompts over the screen (capture, swap, reset confirmation)

/** A centred prompt over a click-sinking backdrop; with a gamepad its first button is selected. */
function Modal(props: {
	lines: ReadonlyArray<string>;
	buttons: ReadonlyArray<{ readonly name: string; readonly text: string; readonly onActivated: () => void }>;
	device: string;
}) {
	const firstRef = useRef<TextButton>();
	useEffect(() => {
		if (props.device !== "gamepad") return;
		selectButton(firstRef.current);
	}, [props.device]);
	const lines = props.lines.map((line, i) => (
		<Text key={`l${i}`} order={i + 1} align={Enum.TextXAlignment.Center} wrap={true} text={line} />
	));
	const buttons = props.buttons.map((b, i) => (
		<MenuButton
			key={b.name}
			ref={i === 0 ? firstRef : undefined}
			order={i + 1}
			name={b.name}
			text={b.text}
			size={new Vector2(OPTIONS_VIEW.modalButton.x, OPTIONS_VIEW.modalButton.y)}
			onActivated={b.onActivated}
		/>
	));
	return (
		<textbutton
			key="OptionsModal"
			Size={UDim2.fromScale(1, 1)}
			ZIndex={MODAL_Z}
			AutoButtonColor={false}
			Selectable={false}
			Active={true}
			Text=""
			BackgroundColor3={role("background")}
			BackgroundTransparency={HUD_VIEW.overlayTransparency}
			BorderSizePixel={0}
		>
			<Panel
				position={UDim2.fromScale(HALF, HALF)}
				anchor={new Vector2(HALF, HALF)}
				width={OPTIONS_VIEW.modalWidth}
				align={Enum.HorizontalAlignment.Center}
				padding={HUD_VIEW.pad * 2}
				transparency={0}
				name="Prompt"
			>
				<uistroke Thickness={1} Color={role("uiAccent")} />
				{lines}
				{buttons.size() > 0 ? (
					<Row order={props.lines.size() + 1} align={Enum.HorizontalAlignment.Center}>
						{buttons}
					</Row>
				) : undefined}
			</Panel>
		</textbutton>
	);
}

function OptionsModal(props: { options: OptionsState; actions: HudActions; device: string }) {
	const { options, actions } = props;
	if (options.capture !== undefined) {
		const c = options.capture;
		return (
			<Modal
				device={props.device}
				lines={[
					str(actionNameKey(c.action)),
					str(c.device === "kbm" ? OPTIONS_STRINGS.captureKey : OPTIONS_STRINGS.captureButton, {
						seconds: c.secondsLeft,
					}),
					str(OPTIONS_STRINGS.captureCancel),
				]}
				buttons={[]}
			/>
		);
	}
	if (options.conflict !== undefined) {
		const c = options.conflict;
		return (
			<Modal
				device={props.device}
				lines={[
					str(OPTIONS_STRINGS.conflict, {
						input: inputLabel(c.input),
						action: str(actionNameKey(c.holder.action)),
					}),
				]}
				buttons={[
					{
						name: "Swap",
						text: str(OPTIONS_STRINGS.swap),
						onActivated: () => {
							actions.playUi(SFX.uiConfirm);
							actions.answerConflict(true);
						},
					},
					{
						name: "Cancel",
						text: str(OPTIONS_STRINGS.cancel),
						onActivated: () => {
							actions.playUi(SFX.uiBack);
							actions.answerConflict(false);
						},
					},
				]}
			/>
		);
	}
	if (options.confirmReset !== undefined) {
		const device = options.confirmReset;
		return (
			<Modal
				device={props.device}
				lines={[str(OPTIONS_STRINGS.resetConfirm, { device: str(optionsDeviceKey(device)) })]}
				buttons={[
					{
						name: "ConfirmReset",
						text: str(OPTIONS_STRINGS.resetYes),
						onActivated: () => {
							actions.playUi(SFX.uiConfirm);
							actions.confirmResetBindings();
						},
					},
					{
						name: "Cancel",
						text: str(OPTIONS_STRINGS.cancel),
						onActivated: () => {
							actions.playUi(SFX.uiBack);
							actions.askResetBindings(undefined);
						},
					},
				]}
			/>
		);
	}
	return undefined;
}

// ---------------------------------------------------------------------------------------------

/**
 * The Options screen (task L4; the juice settings panel, a port of project-kaleb-vale src/fx/JuiceSettingsPanel.tsx
 * @ 42897e2, grown into tabs): Juice (the panel's rows), Controls (rebinding, task L4b: Keyboard & mouse / Gamepad,
 * a row per rebindable action with its primary / secondary (keyboard) or button (pad), the capture prompt with its
 * countdown, the swap prompt, refusal notes, Clear, Reset device with a confirmation, and the input test strip), Audio
 * (master / music / sfx volume) and Display (HUD scale). O toggles it, the pause overlay's Options button (and any
 * menu's `setSettingsOpen(true)`) opens it, B or Close closes it. Every pick applies at once and is sent to the
 * server. Fully usable with a gamepad: every control is a Selectable MenuButton, the first tab is selected when it
 * opens, a prompt selects its first button and the rows behind it stop being selectable; when a prompt closes the
 * selection goes back to the button that opened it. The run is paused while it is open. Text from theme strings
 * (options.*, fx.settings.*), colours from theme roles.
 */
export function OptionsScreen() {
	const open = useSelector(selectPanelOpen);
	const options = useSelector(selectOptions);
	const modal = useSelector(selectOptionsModal);
	const synced = useSelector(selectSettingsSynced);
	const device = useSelector(selectInputDevice);
	const actions = useHudActions();
	const firstRef = useRef<TextButton>();
	const returnFocus = useRef<GuiObject>();

	useEffect(() => {
		if (!open || device !== "gamepad") return;
		const button = firstRef.current;
		selectButton(button);
		return () => {
			if (GuiService.SelectedObject === button) GuiService.SelectedObject = undefined;
		};
	}, [open, device]);

	// A prompt closed: back to the button that opened it (gamepad).
	useEffect(() => {
		if (modal || !open) return;
		const target = returnFocus.current;
		returnFocus.current = undefined;
		if (device === "gamepad") selectButton(target);
	}, [modal]);

	if (!open) return undefined;
	const rememberFocus = () => {
		returnFocus.current = GuiService.SelectedObject;
	};
	const selectable = !modal;
	const tab = options.tab;
	const tabs = OPTIONS_TABS.map((t, i) => (
		<MenuButton
			key={t}
			ref={i === 0 ? firstRef : undefined}
			order={i + 1}
			name={`tab_${t}`}
			text={str(optionsTabKey(t))}
			active={t === tab}
			selectable={selectable}
			size={new Vector2(OPTIONS_VIEW.tabSize.x, OPTIONS_VIEW.tabSize.y)}
			textSize={HUD_VIEW.smallText}
			onActivated={() => {
				actions.playUi(SFX.uiClick);
				actions.setOptionsTab(t);
			}}
		/>
	));
	let body: React.ReactNode;
	if (tab === "controls") {
		body = (
			<ControlsTab
				order={3}
				actions={actions}
				options={options}
				selectable={selectable}
				rememberFocus={rememberFocus}
			/>
		);
	} else if (tab === "audio") body = <AudioTab order={3} actions={actions} selectable={selectable} />;
	else if (tab === "display") body = <DisplayTab order={3} actions={actions} selectable={selectable} />;
	else body = <JuiceTab order={3} actions={actions} selectable={selectable} />;
	return (
		<frame
			key="OptionsOverlay"
			Size={UDim2.fromScale(1, 1)}
			BackgroundColor3={role("background")}
			BackgroundTransparency={HUD_VIEW.overlayTransparency}
			BorderSizePixel={0}
		>
			<Panel
				position={UDim2.fromScale(HALF, HALF)}
				anchor={new Vector2(HALF, HALF)}
				width={OPTIONS_VIEW.width}
				padding={HUD_VIEW.pad * 2}
				transparency={0}
				name="Options"
			>
				<uistroke Thickness={1} Color={role("uiAccent")} />
				<Text
					fill={true}
					order={1}
					size={HUD_VIEW.titleText}
					color="uiAccent"
					text={str(OPTIONS_STRINGS.title)}
				/>
				<Row order={2}>{tabs}</Row>
				{body}
				<Row order={4}>
					{tab !== "controls" ? (
						<MenuButton
							order={1}
							name="Reset"
							text={str(OPTIONS_STRINGS.reset)}
							selectable={selectable}
							onActivated={() => {
								actions.playUi(SFX.uiConfirm);
								actions.resetSettings(tab);
							}}
						/>
					) : undefined}
					<MenuButton
						order={2}
						name="Close"
						text={str(OPTIONS_STRINGS.close)}
						selectable={selectable}
						onActivated={() => {
							actions.playUi(SFX.uiBack);
							actions.setSettingsOpen(false);
						}}
					/>
				</Row>
				{!synced ? (
					<Text
						fill={true}
						order={5}
						size={HUD_VIEW.smallText}
						color="telegraph"
						text={str(SETTINGS_STRINGS.offline)}
					/>
				) : undefined}
				<Text
					fill={true}
					order={6}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					text={str(OPTIONS_STRINGS.hint, { key: SETTINGS_HINT[keyDevice(device)] })}
				/>
			</Panel>
			<OptionsModal options={options} actions={actions} device={device} />
		</frame>
	);
}
