import React, { useEffect, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService } from "@rbxts/services";
import {
	selectAnyPanelOpen,
	selectBindings,
	selectInputDevice,
	selectLastBossId,
	selectMyLobbyId,
	selectRunInfo,
	selectSnapshot,
	selectStageCovered,
	selectVerdict,
} from "client/store";
import { HUD_FONT, role, str, themePack } from "client/ui/theme";
import type { ColorRole } from "shared/theme";
import { restartHint } from "shared/play";
import { SIM_HZ } from "shared/sim";
import { SFX } from "shared/view/audio";
import {
	COMBO_DRAW,
	COMBO_TIERS,
	FOOTPRINT_ESTIMATE,
	HUD_STRINGS,
	HUD_VIEW,
	SCORE_SOURCE_KEYS,
	comboBestRichText,
	comboTier,
	formatClock,
	formatCombo,
} from "shared/view/hud";
import { MENU_STRINGS, PAD_CONFIRM_LABEL, partyRunOverLine, runOverExits } from "shared/view/menu";
import { useHudActions } from "./actions";
import { MenuButton, Panel, Row, Text } from "./primitives";
import { RunInfoLine, verdictColor, verdictLine } from "./RunInfoLine";

const HALF = 0.5;
const HIDDEN = 1;
const STAT_WIDTH = 150;

function Stat(props: { order: number; label: string; value: string }) {
	return (
		<Panel position={new UDim2()} anchor={new Vector2()} order={props.order} width={STAT_WIDTH} transparency={1}>
			<Text
				fill={true}
				order={1}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Center}
				text={props.label}
			/>
			<Text
				fill={true}
				order={2}
				size={HUD_VIEW.titleText}
				align={Enum.TextXAlignment.Center}
				text={props.value}
			/>
		</Panel>
	);
}

/** One line of the score breakdown: label left, value right. */
function BreakdownLine(props: { order: number; label: string; value: string; color?: "uiText" | "uiAccent" }) {
	return (
		<Row order={props.order}>
			<Text order={1} width={HUD_VIEW.breakdownLabelWidth} color="uiTextDim" text={props.label} />
			<Text
				order={2}
				width={HUD_VIEW.breakdownValueWidth}
				color={props.color ?? "uiText"}
				align={Enum.TextXAlignment.Right}
				text={props.value}
			/>
		</Row>
	);
}

/**
 * The best combo line (docs/COMBO.md CB6, CD16): "x3.4 CARNAGE", the tier's name in its colour (nothing below x2). Its
 * value column is COMBO_DRAW.runOverValueExtra wider (the label's that much narrower, so the row keeps the breakdown's
 * width and alignment) and TextScaled up to HUD_VIEW.textSize, so UNSTOPPABLE or a long translation shrinks to fit.
 */
function BestComboLine(props: { order: number; maxCombo: number }) {
	const extra = COMBO_DRAW.runOverValueExtra;
	const tier = COMBO_TIERS[comboTier(props.maxCombo)];
	const name = tier.nameKey !== undefined ? str(tier.nameKey) : undefined;
	const multiplier = str(HUD_STRINGS.combo, { combo: formatCombo(props.maxCombo) });
	const value = comboBestRichText(multiplier, name, themePack()?.hex(tier.role as ColorRole) ?? "");
	const h = HUD_VIEW.textSize + FOOTPRINT_ESTIMATE.lineSlack;
	return (
		<Row order={props.order}>
			<Text
				order={1}
				width={HUD_VIEW.breakdownLabelWidth - extra}
				color="uiTextDim"
				text={str(HUD_STRINGS.maxCombo)}
			/>
			<textlabel
				LayoutOrder={2}
				Size={new UDim2(0, HUD_VIEW.breakdownValueWidth + extra, 0, h)}
				BackgroundTransparency={HIDDEN}
				Font={HUD_FONT}
				RichText={true}
				TextScaled={true}
				TextSize={HUD_VIEW.textSize}
				TextColor3={role("uiText")}
				TextStrokeColor3={role("background")}
				TextStrokeTransparency={HUD_VIEW.panelTransparency}
				TextXAlignment={Enum.TextXAlignment.Right}
				Text={value}
			>
				<uitextsizeconstraint MaxTextSize={HUD_VIEW.textSize} />
			</textlabel>
		</Row>
	);
}

/** Scored runs (M2): the score, its points per source and the best combo. */
function ScoreBreakdown(props: { order: number; score: number; points: ReadonlyArray<number>; maxCombo: number }) {
	const lines = new Array<React.Element>();
	for (let i = 0; i < props.points.size(); i++) {
		const key = SCORE_SOURCE_KEYS[i];
		if (key === undefined) continue;
		lines.push(<BreakdownLine key={`s${i}`} order={i + 2} label={str(key)} value={tostring(props.points[i])} />);
	}
	return (
		<Panel
			position={new UDim2()}
			anchor={new Vector2()}
			order={props.order}
			transparency={1}
			align={Enum.HorizontalAlignment.Center}
		>
			<BreakdownLine order={1} label={str(HUD_STRINGS.score)} value={tostring(props.score)} color="uiAccent" />
			{lines}
			<BestComboLine order={props.points.size() + 2} maxCombo={props.maxCombo} />
		</Panel>
	);
}

/**
 * Centre, after the run ends (web PlayerHud death line, BossHud victory banner and the playtest post-run panel's
 * stats): "Run over" / "Victory", "You died — press R to retry" or "<boss name> defeated — press R to play again"
 * with the restart key of the device used last (R / D-pad down) and the other one below, then the run's time, hits
 * taken and kills; in a scored run (M2) the score and its breakdown by source; under the exits, the server's verdict
 * line and the run's info line (RunInfoLine; docs/HUD_LAYOUT.md H6: the in-run InfoPanel only flashes the verdict).
 *
 * Exits (L3 / L6): "Again" (solo runs; R) and "Main menu", or "Back to lobby" while in a lobby. A party run has no
 * Again: R / the button go back to the lobby (once the party's verdict is in). A party run the server ended before the
 * wipe (desync, an error, expiry) shows here too, its main line naming the verdict's reason (partyRunOverLine), as
 * does a wiped party's run the server rejected. The panel counts as a menu, so the pad
 * drives the GUI selection here (it starts on the first button): the pad's hint is A, not the D-pad restart.
 */
export function RunOverPanel() {
	const s = useSelector(selectSnapshot);
	const device = useSelector(selectInputDevice);
	const lastBoss = useSelector(selectLastBossId);
	const info = useSelector(selectRunInfo);
	const bindings = useSelector(selectBindings);
	const myLobby = useSelector(selectMyLobbyId);
	const panelOpen = useSelector(selectAnyPanelOpen);
	// The stage loader's cover (a run that ends under a floor card): no selection on the hidden buttons until it goes.
	const covered = useSelector(selectStageCovered);
	const verdict = useSelector(selectVerdict);
	const actions = useHudActions();
	const firstRef = useRef<TextButton>();
	const over = s.outcome !== "playing";

	useEffect(() => {
		if (!over || panelOpen || covered || device !== "gamepad") return;
		const button = firstRef.current;
		if (button !== undefined) GuiService.SelectedObject = button;
		return () => {
			if (GuiService.SelectedObject === button) GuiService.SelectedObject = undefined;
		};
	}, [over, panelOpen, covered, device]);

	if (!over) return undefined;
	const victory = s.outcome === "victory";
	const padKey = PAD_CONFIRM_LABEL;
	const hint = restartHint(bindings);
	// Touch: the Again button stands in for the restart key (docs/MOBILE.md MB10).
	const touch = device === "touch";
	const key = touch ? str(MENU_STRINGS.again) : device === "gamepad" ? padKey : hint.keyboard;
	const otherKey = device === "gamepad" ? hint.keyboard : padKey;
	const bossName = lastBoss !== "" ? str(`${lastBoss}.name`) : "";
	const exits = runOverExits(info.coop, myLobby !== undefined);
	const party = partyRunOverLine(verdict, info.run);
	const verdictText = verdictLine(verdict);
	const main = info.coop
		? str(party.key, { key, reason: party.reason })
		: victory
		? str(HUD_STRINGS.victory, { name: bossName, key })
		: str(HUD_STRINGS.dead, { key });
	return (
		<Panel
			position={UDim2.fromScale(HALF, HALF)}
			anchor={new Vector2(HALF, HALF)}
			width={HUD_VIEW.panelWidth * 2}
			align={Enum.HorizontalAlignment.Center}
			name="RunOver"
		>
			<Text
				fill={true}
				order={1}
				size={HUD_VIEW.bigText}
				color={victory ? "uiAccent" : "uiHealth"}
				align={Enum.TextXAlignment.Center}
				text={str(victory ? HUD_STRINGS.runVictory : HUD_STRINGS.runOver)}
			/>
			<Text order={2} size={HUD_VIEW.titleText} align={Enum.TextXAlignment.Center} wrap={true} text={main} />
			{touch ? undefined : (
				<Text
					fill={true}
					order={3}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					align={Enum.TextXAlignment.Center}
					text={str(HUD_STRINGS.restartAlt, { key: otherKey })}
				/>
			)}
			<Row order={4} align={Enum.HorizontalAlignment.Center}>
				<Stat
					order={1}
					label={str(victory ? HUD_STRINGS.timeVictory : HUD_STRINGS.time)}
					value={formatClock(s.endTick / SIM_HZ)}
				/>
				<Stat order={2} label={str(HUD_STRINGS.hits)} value={tostring(s.hitsTaken)} />
				<Stat order={3} label={str(HUD_STRINGS.kills)} value={tostring(s.kills)} />
			</Row>
			{s.scoring ? (
				<ScoreBreakdown order={5} score={s.score} points={s.scorePoints} maxCombo={s.maxCombo} />
			) : undefined}
			{verdictText !== "" ? (
				<Text
					order={7}
					size={HUD_VIEW.smallText}
					color={verdictColor(verdict)}
					align={Enum.TextXAlignment.Center}
					wrap={true}
					text={verdictText}
				/>
			) : undefined}
			<RunInfoLine order={8} />
			<Row order={6} align={Enum.HorizontalAlignment.Center}>
				{exits.again ? (
					<MenuButton
						ref={firstRef}
						order={1}
						name="Again"
						text={str(MENU_STRINGS.again)}
						onActivated={() => {
							actions.playUi(SFX.uiConfirm);
							actions.restart();
						}}
					/>
				) : undefined}
				<MenuButton
					ref={exits.again ? undefined : firstRef}
					order={2}
					name="Exit"
					text={str(exits.exitKey)}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.exitRun();
					}}
				/>
			</Row>
		</Panel>
	);
}
