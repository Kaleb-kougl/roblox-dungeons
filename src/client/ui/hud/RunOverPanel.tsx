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
	selectVerdict,
} from "client/store";
import { str } from "client/ui/theme";
import { restartHint } from "shared/play";
import { SIM_HZ } from "shared/sim";
import { SFX } from "shared/view/audio";
import { HUD_STRINGS, HUD_VIEW, SCORE_SOURCE_KEYS, formatClock, formatCombo } from "shared/view/hud";
import { MENU_STRINGS, PAD_CONFIRM_LABEL, partyRunOverLine, runOverExits } from "shared/view/menu";
import { useHudActions } from "./actions";
import { MenuButton, Panel, Row, Text } from "./primitives";

const HALF = 0.5;
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
			<BreakdownLine
				order={props.points.size() + 2}
				label={str(HUD_STRINGS.maxCombo)}
				value={str(HUD_STRINGS.combo, { combo: formatCombo(props.maxCombo) })}
			/>
		</Panel>
	);
}

/**
 * Centre, after the run ends (web PlayerHud death line, BossHud victory banner and the playtest post-run panel's
 * stats): "Run over" / "Victory", "You died — press R to retry" or "<boss name> defeated — press R to play again"
 * with the restart key of the device used last (R / D-pad down) and the other one below, then the run's time, hits
 * taken and kills; in a scored run (M2) the score and its breakdown by source.
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
	const verdict = useSelector(selectVerdict);
	const actions = useHudActions();
	const firstRef = useRef<TextButton>();
	const over = s.outcome !== "playing";

	useEffect(() => {
		if (!over || panelOpen || device !== "gamepad") return;
		const button = firstRef.current;
		if (button !== undefined) GuiService.SelectedObject = button;
		return () => {
			if (GuiService.SelectedObject === button) GuiService.SelectedObject = undefined;
		};
	}, [over, panelOpen, device]);

	if (!over) return undefined;
	const victory = s.outcome === "victory";
	const padKey = PAD_CONFIRM_LABEL;
	const hint = restartHint(bindings);
	const key = device === "gamepad" ? padKey : hint.keyboard;
	const otherKey = device === "gamepad" ? hint.keyboard : padKey;
	const bossName = lastBoss !== "" ? str(`${lastBoss}.name`) : "";
	const exits = runOverExits(info.coop, myLobby !== undefined);
	const party = partyRunOverLine(verdict, info.run);
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
			<Text
				fill={true}
				order={3}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Center}
				text={str(HUD_STRINGS.restartAlt, { key: otherKey })}
			/>
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
