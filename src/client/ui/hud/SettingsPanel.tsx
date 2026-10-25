import React, { useEffect, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService } from "@rbxts/services";
import {
	selectInputDevice,
	selectJuice,
	selectPanelOpen,
	selectSettingsSynced,
	selectSystemReducedMotion,
} from "client/store";
import { role, str } from "client/ui/theme";
import { HEALTH_BARS_MODES, PARTICLES_LEVELS, type JuiceOverrides } from "shared/settings";
import { SFX } from "shared/view/audio";
import { HUD_VIEW, SETTINGS_HINT, SETTINGS_STRINGS } from "shared/view/hud";
import { useHudActions } from "./actions";
import { MenuButton, Panel, Row, Text } from "./primitives";

const HALF = 0.5;

interface Option<T> {
	readonly value: T;
	readonly label: string;
}

/** One setting: its label and a row of option buttons, the current one highlighted (web JuiceSettingsPanel Row). */
function SettingRow<T extends string | boolean>(props: {
	order: number;
	name: string;
	label: string;
	value: T;
	options: ReadonlyArray<Option<T>>;
	onPick: (v: T) => void;
	firstRef?: React.Ref<TextButton>;
}) {
	const buttons = props.options.map((o, i) => (
		<MenuButton
			key={`${props.name}${tostring(o.value)}`}
			ref={i === 0 ? props.firstRef : undefined}
			order={i + 1}
			name={`${props.name}_${tostring(o.value)}`}
			text={o.label}
			active={o.value === props.value}
			size={new Vector2(HUD_VIEW.optionSize.x, HUD_VIEW.optionSize.y)}
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

/**
 * The juice settings panel (port of project-kaleb-vale src/fx/JuiceSettingsPanel.tsx @ 42897e2): O toggles it, the
 * pause overlay opens it (the gamepad route), B or Close closes it. One row per setting (health bars, damage numbers,
 * freeze frame, particles, reduced motion); every pick applies at once and is sent to the server (updateSettings).
 * Reduced motion shows what the Roblox setting says (its default); Reset clears every override. Text from theme
 * strings (fx.settings.*), colours from theme roles. The run is paused while it is open.
 */
export function SettingsPanel() {
	const open = useSelector(selectPanelOpen);
	const s = useSelector(selectJuice);
	const synced = useSelector(selectSettingsSynced);
	const system = useSelector(selectSystemReducedMotion);
	const device = useSelector(selectInputDevice);
	const actions = useHudActions();
	const firstRef = useRef<TextButton>();

	useEffect(() => {
		if (!open || device !== "gamepad") return;
		const button = firstRef.current;
		if (button !== undefined) GuiService.SelectedObject = button;
		return () => {
			if (GuiService.SelectedObject === button) GuiService.SelectedObject = undefined;
		};
	}, [open, device]);

	if (!open) return undefined;
	const on = str(SETTINGS_STRINGS.on);
	const off = str(SETTINGS_STRINGS.off);
	const onOff: ReadonlyArray<Option<boolean>> = [
		{ value: true, label: on },
		{ value: false, label: off },
	];
	const pick = (patch: JuiceOverrides) => {
		actions.playUi(SFX.uiClick);
		actions.updateSettings(patch);
	};
	return (
		<frame
			key="SettingsOverlay"
			Size={UDim2.fromScale(1, 1)}
			BackgroundColor3={role("background")}
			BackgroundTransparency={HUD_VIEW.overlayTransparency}
			BorderSizePixel={0}
		>
			<Panel
				position={UDim2.fromScale(HALF, HALF)}
				anchor={new Vector2(HALF, HALF)}
				padding={HUD_VIEW.pad * 2}
				transparency={0}
				name="JuiceSettings"
			>
				<uistroke Thickness={1} Color={role("uiAccent")} />
				<Text order={1} size={HUD_VIEW.titleText} color="uiAccent" text={str(SETTINGS_STRINGS.title)} />
				<SettingRow
					order={2}
					name="healthBars"
					firstRef={firstRef}
					label={str(SETTINGS_STRINGS.healthBars)}
					value={s.healthBars}
					options={HEALTH_BARS_MODES.map((v) => ({
						value: v,
						label: str(`${SETTINGS_STRINGS.healthBarsPrefix}${v}`),
					}))}
					onPick={(v) => pick({ healthBars: v })}
				/>
				<SettingRow
					order={3}
					name="damageNumbers"
					label={str(SETTINGS_STRINGS.damageNumbers)}
					value={s.damageNumbers}
					options={onOff}
					onPick={(v) => pick({ damageNumbers: v })}
				/>
				<SettingRow
					order={4}
					name="freezeFrame"
					label={str(SETTINGS_STRINGS.freezeFrame)}
					value={s.freezeFrame}
					options={onOff}
					onPick={(v) => pick({ freezeFrame: v })}
				/>
				<SettingRow
					order={5}
					name="particles"
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
					label={str(SETTINGS_STRINGS.reducedMotion)}
					value={s.reducedMotion}
					options={onOff}
					onPick={(v) => pick({ reducedMotion: v })}
				/>
				<Text
					order={7}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					text={str(SETTINGS_STRINGS.system, { value: system ? on : off })}
				/>
				<Row order={8}>
					<MenuButton
						order={1}
						name="Reset"
						text={str(SETTINGS_STRINGS.reset)}
						onActivated={() => {
							actions.playUi(SFX.uiConfirm);
							actions.resetSettings();
						}}
					/>
					<MenuButton
						order={2}
						name="Close"
						text={str(SETTINGS_STRINGS.close)}
						onActivated={() => {
							actions.playUi(SFX.uiClick);
							actions.setSettingsOpen(false);
						}}
					/>
				</Row>
				{!synced ? (
					<Text order={9} size={HUD_VIEW.smallText} color="telegraph" text={str(SETTINGS_STRINGS.offline)} />
				) : undefined}
				<Text
					order={10}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					text={str(SETTINGS_STRINGS.hint, { key: SETTINGS_HINT[device] })}
				/>
			</Panel>
		</frame>
	);
}
