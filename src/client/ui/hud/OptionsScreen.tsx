import React, { useEffect, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService, UserInputService } from "@rbxts/services";
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
import { role, str, useHudFont, useLocale } from "client/ui/theme";
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
	BUILD_FX_LEVELS,
	HEALTH_BARS_MODES,
	HUD_SCALE_PERCENTS,
	PARTICLES_LEVELS,
	TOUCH_OPACITY_PERCENTS,
	TOUCH_SIZE_PERCENTS,
	stepVolume,
	type AudioSettings,
	type JuiceOverrides,
} from "shared/settings";
import { SFX } from "shared/view/audio";
import {
	HUD_VIEW,
	LANGUAGE_ROW,
	OPTIONS_DEVICES,
	OPTIONS_STRINGS,
	OPTIONS_TABS,
	OPTIONS_VIEW,
	settingsHint,
	SETTINGS_STRINGS,
	UI_ART,
	actionNameKey,
	currentLanguageChoice,
	languageChoiceLabel,
	languageChoices,
	optionsDeviceKey,
	optionsTabKey,
	refusalKey,
	stepLanguageChoice,
	volumeIcon,
} from "shared/view/hud";
import { MENU_FIT, screenDividers, screenSkin } from "shared/view/menu";
import { useHudActions, type HudActions } from "./actions";
import { FitScroll, MenuFit } from "./MenuFit";
import { ArtImage, Divider, MenuButton, Panel, Row, Text, panelIcon } from "./primitives";
import { ScreenDim } from "./ScreenDim";

const HALF = 0.5;
const HIDDEN = 1;
/** Modal prompts draw above the screen (ZIndexBehavior Sibling: later siblings on top; this keeps it explicit). */
const MODAL_Z = 10;
/** The screen's rows: title 1, tabs 2, a divider 3, the tab's body, a divider 5, Reset / Close 6, notes 7-8. */
const BODY_ORDER = 4;

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
			variant="option"
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
				name="roomClear"
				selectable={sel}
				label={str(SETTINGS_STRINGS.roomClear)}
				value={s.roomClear}
				options={onOff}
				onPick={(v) => pick({ roomClear: v })}
			/>
			<SettingRow
				order={6}
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
				order={7}
				name="reducedMotion"
				selectable={sel}
				label={str(SETTINGS_STRINGS.reducedMotion)}
				value={s.reducedMotion}
				options={onOff}
				onPick={(v) => pick({ reducedMotion: v })}
			/>
			<Text
				fill={true}
				order={8}
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
	return input !== undefined ? inputLabel(input, str) : str(OPTIONS_STRINGS.emptySlot);
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
	const hudFont = useHudFont();
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
				Font={hudFont}
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
	/** A phone (MenuFit compact): the whole tab scrolls (FitScroll), so the action rows are a plain list. */
	compact: boolean;
	/** The action rows' scroll list height otherwise (OPTIONS_VIEW.listHeight; less on a short touch screen). */
	listHeight: number;
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
			{props.compact ? (
				<frame
					key="Rows"
					LayoutOrder={3}
					Size={new UDim2(1, 0, 0, 0)}
					AutomaticSize={Enum.AutomaticSize.Y}
					BackgroundTransparency={HIDDEN}
				>
					<uilistlayout SortOrder={Enum.SortOrder.LayoutOrder} Padding={new UDim(0, HUD_VIEW.gap)} />
					{rows}
				</frame>
			) : (
				<scrollingframe
					key="Rows"
					LayoutOrder={3}
					Size={new UDim2(1, 0, 0, props.listHeight)}
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
			)}
			<Text fill={true} order={4} size={HUD_VIEW.smallText} color="uiTextDim" text={str(OPTIONS_STRINGS.test)} />
			<TestStrip order={5} device={device} pressed={options.pressed} />
			{notice !== undefined ? (
				<Text
					order={6}
					size={HUD_VIEW.smallText}
					color="telegraph"
					wrap={true}
					text={str(refusalKey(notice.reason), {
						input: inputLabel(notice.input, str),
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

/**
 * An audio row's label (docs/UI_ART.md UA8): with the frame art, the speaker glyph (the struck-through one at 0 %,
 * volumeIcon) beside the label, both inside the label's width so the row keeps its columns; otherwise exactly the flat
 * label.
 */
function VolumeLabel(props: { order: number; label: string; volume: number }) {
	const icon = panelIcon(screenSkin("options"), volumeIcon(props.volume));
	const glyph = UI_ART.iconBox.glyph;
	const flat = <Text order={props.order} width={HUD_VIEW.settingsLabelWidth} text={props.label} />;
	if (icon === undefined) return flat;
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, HUD_VIEW.settingsLabelWidth, 0, HUD_VIEW.textSize)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			<ArtImage name="Icon" id={icon} order={1} box={{ w: glyph, h: glyph }} color="uiText" />
			<Text order={2} width={HUD_VIEW.settingsLabelWidth - glyph - HUD_VIEW.gap} text={props.label} />
		</frame>
	);
}

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
				<VolumeLabel order={0} label={str(labels[key])} volume={audio[key]} />
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

/**
 * Options > Display > Language (docs/LOCALIZATION.md L6): `< value >` like the audio rows (the choices don't fit a row
 * of option buttons: up to 19 for a developer), the value in the display-name font (endonyms in their own script,
 * LD13). Automatic ({name}) first, then the listed locales (shared/view/hud language.ts). A pick applies at once: the
 * HUD remounts in the new locale (LocaleRoot) and the gamepad selection stays on the arrow that was pressed.
 */
function LanguageRow(props: { order: number; actions: HudActions; selectable: boolean }) {
	const l10n = useLocale();
	const choices = languageChoices(l10n.allowHidden);
	const current = currentLanguageChoice(l10n);
	const choice = choices.find((c) => c.value === current) ?? choices[0];
	const step = new Vector2(OPTIONS_VIEW.stepSize.x, OPTIONS_VIEW.stepSize.y);
	const pick = (direction: 1 | -1) => {
		props.actions.playUi(SFX.uiClick);
		props.actions.updateDisplay({ language: stepLanguageChoice(choices, current, direction) });
	};
	return (
		<Row order={props.order}>
			<Text order={0} width={HUD_VIEW.settingsLabelWidth} text={str(OPTIONS_STRINGS.language)} />
			<MenuButton
				order={1}
				name="language_prev"
				text={str(OPTIONS_STRINGS.languagePrev)}
				size={step}
				selectable={props.selectable}
				onActivated={() => pick(-1)}
			/>
			<Text
				order={2}
				width={LANGUAGE_ROW.valueWidth}
				align={Enum.TextXAlignment.Center}
				font="name"
				text={languageChoiceLabel(choice, l10n.autoCode, str)}
			/>
			<MenuButton
				order={3}
				name="language_next"
				text={str(OPTIONS_STRINGS.languageNext)}
				size={step}
				selectable={props.selectable}
				onActivated={() => pick(1)}
			/>
		</Row>
	);
}

function DisplayTab(props: { order: number; actions: HudActions; selectable: boolean }) {
	const display = useSelector(selectDisplay);
	/** Touch devices only: the touch rows (docs/MOBILE.md MB11). Read once, when the tab opens. */
	const touch = UserInputService.TouchEnabled;
	return (
		<Panel position={new UDim2()} anchor={new Vector2()} order={props.order} transparency={HIDDEN} padding={0}>
			<LanguageRow order={0} actions={props.actions} selectable={props.selectable} />
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
			<SettingRow
				order={6}
				name="buildFx"
				selectable={props.selectable}
				label={str(OPTIONS_STRINGS.buildFx)}
				value={display.buildFx}
				options={BUILD_FX_LEVELS.map((level) => ({
					value: level,
					label: str(level === "full" ? OPTIONS_STRINGS.buildFxFull : OPTIONS_STRINGS.buildFxReduced),
				}))}
				onPick={(v) => {
					props.actions.playUi(SFX.uiClick);
					props.actions.updateDisplay({ buildFx: v });
				}}
			/>
			{touch && (
				<SettingRow
					order={7}
					name="touchSize"
					selectable={props.selectable}
					label={str(OPTIONS_STRINGS.touchSize)}
					value={display.touchSize}
					optionWidth={HUD_VIEW.scaleOptionWidth}
					options={TOUCH_SIZE_PERCENTS.map((p) => ({
						value: p,
						label: str(OPTIONS_STRINGS.percent, { value: p }),
					}))}
					onPick={(v) => {
						props.actions.playUi(SFX.uiClick);
						props.actions.updateDisplay({ touchSize: v });
					}}
				/>
			)}
			{touch && (
				<SettingRow
					order={8}
					name="touchOpacity"
					selectable={props.selectable}
					label={str(OPTIONS_STRINGS.touchOpacity)}
					value={display.touchOpacity}
					optionWidth={HUD_VIEW.scaleOptionWidth}
					options={TOUCH_OPACITY_PERCENTS.map((p) => ({
						value: p,
						label: str(OPTIONS_STRINGS.percent, { value: p }),
					}))}
					onPick={(v) => {
						props.actions.playUi(SFX.uiClick);
						props.actions.updateDisplay({ touchOpacity: v });
					}}
				/>
			)}
			{touch && (
				<SettingRow
					order={9}
					name="touchAutoTarget"
					selectable={props.selectable}
					label={str(OPTIONS_STRINGS.touchAutoTarget)}
					value={display.touchAutoTarget}
					options={[
						{ value: true, label: str(SETTINGS_STRINGS.on) },
						{ value: false, label: str(SETTINGS_STRINGS.off) },
					]}
					onPick={(v) => {
						props.actions.playUi(SFX.uiClick);
						props.actions.updateDisplay({ touchAutoTarget: v });
					}}
				/>
			)}
			{touch && (
				<SettingRow
					order={10}
					name="touchLeftHanded"
					selectable={props.selectable}
					label={str(OPTIONS_STRINGS.touchLeftHanded)}
					value={display.touchLeftHanded}
					options={[
						{ value: true, label: str(SETTINGS_STRINGS.on) },
						{ value: false, label: str(SETTINGS_STRINGS.off) },
					]}
					onPick={(v) => {
						props.actions.playUi(SFX.uiClick);
						props.actions.updateDisplay({ touchLeftHanded: v });
					}}
				/>
			)}
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
				skin={screenSkin("optionsPrompt")}
				flatOnly={<uistroke Thickness={1} Color={role("uiAccent")} />}
				name="Prompt"
			>
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
						input: inputLabel(c.input, str),
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
 * (options.*, fx.settings.*), colours from theme roles. The dim covers the whole screen (ScreenDim); fitted into the
 * safe area on touch (MenuFit: the Controls list is the flexible list); compact (a phone): the tab's body scrolls
 * (FitScroll, MENU_FIT.optionsWidth wide), the Controls rows a plain list inside it.
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
	const bodyFor = (compact: boolean, listHeight: number): React.Element => {
		if (tab === "controls") {
			return (
				<ControlsTab
					order={BODY_ORDER}
					actions={actions}
					options={options}
					selectable={selectable}
					rememberFocus={rememberFocus}
					compact={compact}
					listHeight={listHeight}
				/>
			);
		}
		if (tab === "audio") return <AudioTab order={BODY_ORDER} actions={actions} selectable={selectable} />;
		if (tab === "display") return <DisplayTab order={BODY_ORDER} actions={actions} selectable={selectable} />;
		return <JuiceTab order={BODY_ORDER} actions={actions} selectable={selectable} />;
	};
	const dividers = screenDividers("options");
	return (
		<frame key="OptionsOverlay" Size={UDim2.fromScale(1, 1)} BackgroundTransparency={1} BorderSizePixel={0}>
			<ScreenDim key="Dim" name="OptionsDim" transparency={HUD_VIEW.overlayTransparency} />
			<MenuFit
				flex={(compact) =>
					compact
						? { min: MENU_FIT.listMin, max: MENU_FIT.optionsBodyMax }
						: tab === "controls"
						? { min: MENU_FIT.listMin, max: OPTIONS_VIEW.listHeight }
						: undefined
				}
				render={(layout) => (
					<Panel
						width={layout.compact ? MENU_FIT.optionsWidth : OPTIONS_VIEW.width}
						padding={HUD_VIEW.pad * 2}
						transparency={0}
						skin={screenSkin("options")}
						flatOnly={<uistroke Thickness={1} Color={role("uiAccent")} />}
						name="Options"
					>
						<Text
							fill={true}
							order={1}
							size={HUD_VIEW.titleText}
							color="uiAccent"
							text={str(OPTIONS_STRINGS.title)}
						/>
						<Row order={2}>{tabs}</Row>
						{dividers ? <Divider key="DividerTop" order={3} skin={screenSkin("options")} /> : undefined}
						{layout.compact ? (
							<FitScroll
								key="Body"
								order={BODY_ORDER}
								height={layout.flex}
								onContent={layout.setFlexContent}
							>
								{bodyFor(true, 0)}
							</FitScroll>
						) : (
							bodyFor(false, layout.flex)
						)}
						{dividers ? <Divider key="DividerBottom" order={5} skin={screenSkin("options")} /> : undefined}
						<Row order={6}>
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
								order={7}
								size={HUD_VIEW.smallText}
								color="telegraph"
								text={str(SETTINGS_STRINGS.offline)}
							/>
						) : undefined}
						{device === "touch" ? undefined : (
							<Text
								fill={true}
								order={8}
								size={HUD_VIEW.smallText}
								color="uiTextDim"
								text={str(OPTIONS_STRINGS.hint, { key: settingsHint(str)[keyDevice(device)] })}
							/>
						)}
					</Panel>
				)}
			/>
			<OptionsModal options={options} actions={actions} device={device} />
		</frame>
	);
}
