import React, { useEffect, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService } from "@rbxts/services";
import {
	selectAnyPanelOpen,
	selectBindings,
	selectInputDevice,
	selectBaselineRun,
	selectLastBossId,
	selectMyLobbyId,
	selectRunBaseline,
	selectRecap,
	selectRunInfo,
	selectSnapshot,
	selectStageCovered,
	selectVerdict,
} from "client/store";
import { useHudFont, role, str, themePack } from "client/ui/theme";
import type { ColorRole } from "shared/theme";
import { DAILY_WORLD_KIND } from "shared/daily";
import { restartHint } from "shared/play";
import { SIM_HZ } from "shared/sim";
import { SFX } from "shared/view/audio";
import {
	BUILD_HUD_VIEW,
	COMBO_DRAW,
	COMBO_TIERS,
	DAILY_STRINGS,
	FOOTPRINT_ESTIMATE,
	HUD_STRINGS,
	HUD_VIEW,
	NEW_BEST_ROLE,
	NEW_BEST_STRINGS,
	UI_ART,
	bestBlockDrawsBestLine,
	bestTargetKey,
	bestText,
	comboBestRichText,
	comboTier,
	formatClock,
	formatCombo,
	recapExitSizes,
	recapHidesBestLine,
	runOverRibbonKey,
	scoreBreakdownRows,
	type RecapLayout,
} from "shared/view/hud";
import {
	MENU_FIT,
	MENU_STRINGS,
	PAD_CONFIRM_LABEL,
	partyRunOverLine,
	runOverExitIcon,
	runOverExits,
	runOverIcon,
	screenSkin,
} from "shared/view/menu";
import { useHudActions } from "./actions";
import { DailyResultBlock } from "./DailyResultBlock";
import { MenuFit } from "./MenuFit";
import { runOverBest, type RunOverBest } from "./newBestRunOver";
import { NEW_BEST_UI } from "./newBestUi";
import { ArtImage, MenuButton, Panel, Row, Text, panelIcon } from "./primitives";
import { BuildList, hasBuildItems } from "./BuildList";
import { DailyPassedRow } from "./DailyPassedRow";
import { RunInfoLine, verdictColor, verdictLine } from "./RunInfoLine";
import { DetailsToggle, HighlightGrid, NearMissLine } from "./RecapBlocks";

const HIDDEN = 1;
const STAT_WIDTH = 150;

/** LayoutOrder of the panel's rows (the compact panel's left column uses the same numbers). */
const ROW = {
	header: 1,
	ribbon: 2,
	main: 3,
	alt: 4,
	/** docs/RUN_RECAP.md RR5: the near-miss line under the main line (a record run's dim one: nearMissDim). */
	nearMiss: 5,
	stats: 6,
	best: 7,
	/** A record run's dim near-miss sub-line, under new best's rows (RRD3). */
	nearMissDim: 8,
	/** The highlights (RR5), or behind Details the score breakdown and the Build list in their place (RRD5). */
	breakdown: 9,
	/** Narrow (portrait) only: the Build list under the breakdown (beside it elsewhere). */
	build: 10,
	/** docs/DAILY.md DS11: the daily block (daily runs only), then the friends you passed (DailyPassedRow, DS10). */
	daily: 11,
	dailyPassed: 12,
	exits: 13,
	verdict: 14,
	info: 15,
} as const;

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
	const hudFont = useHudFont();
	const extra = COMBO_DRAW.runOverValueExtra;
	const tier = COMBO_TIERS[comboTier(props.maxCombo)];
	const name = tier.nameKey !== undefined ? str(tier.nameKey) : undefined;
	const multiplier = str(HUD_STRINGS.combo, { combo: formatCombo(props.maxCombo) });
	const value = comboBestRichText(multiplier, name, themePack()?.hex(tier.role as ColorRole) ?? "", str);
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
				Font={hudFont}
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

interface BreakdownProps {
	order: number;
	score: number;
	points: ReadonlyArray<number>;
	maxCombo: number;
}

/** The breakdown's lines: the score, its points per source, the best combo. */
function breakdownLines(props: BreakdownProps): React.Element[] {
	const lines = [
		<BreakdownLine
			key="score"
			order={1}
			label={str(HUD_STRINGS.score)}
			value={tostring(props.score)}
			color="uiAccent"
		/>,
	];
	for (const row of scoreBreakdownRows(props.points)) {
		lines.push(
			<BreakdownLine
				key={`s${row.index}`}
				order={row.index + 2}
				label={str(row.key)}
				value={tostring(row.points)}
			/>,
		);
	}
	lines.push(<BestComboLine key="combo" order={props.points.size() + 2} maxCombo={props.maxCombo} />);
	return lines;
}

/** Scored runs (M2): the score, its points per source and the best combo. */
function ScoreBreakdown(props: BreakdownProps) {
	return (
		<Panel
			position={new UDim2()}
			anchor={new Vector2()}
			order={props.order}
			transparency={1}
			align={Enum.HorizontalAlignment.Center}
		>
			{breakdownLines(props)}
		</Panel>
	);
}

/**
 * The gold ribbon across the panel under its header on a record run (docs/NEW_BEST.md NB9, runOverRibbonKey: `NEW
 * BEST!` / `FIRST RECORD`): a full-width newBest bar with the text in the background colour.
 */
function BestRibbon(props: { order: number; text: string }) {
	const hudFont = useHudFont();
	return (
		<frame
			key="BestRibbon"
			LayoutOrder={props.order}
			Size={new UDim2(1, 0, 0, HUD_VIEW.titleText + FOOTPRINT_ESTIMATE.lineSlack)}
			BackgroundColor3={role(NEW_BEST_ROLE)}
			BorderSizePixel={0}
		>
			<textlabel
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={HIDDEN}
				Font={hudFont}
				TextSize={HUD_VIEW.titleText}
				TextColor3={role("background")}
				TextXAlignment={Enum.TextXAlignment.Center}
				Text={props.text}
			/>
		</frame>
	);
}

/**
 * The run over's new-best block (docs/NEW_BEST.md NB9), ranked runs only (nothing otherwise: the old panel). A record
 * run: its record rows in gold (`Score 48210 -> 61930 (+13720)` / `Deepest floor 9 -> 11 (+2)`, the NEW_BEST_UI
 * record row bindings NewBestController rolls; none for a first record, whose ribbon says it) and the save chip
 * (recordSavedKey: `Saved` in gold once the accepted verdict carried the server's records, `Not saved: run not
 * verified` in uiHealth for a rejected one, nothing while waiting). No record: one dim line, the target for next time
 * (`Best 48210 · floor 9`, bestText run.best.target). What it draws is runOverBest's `lines` (shared/view/hud
 * runOverBestLines); on a daily run it draws no save chip (the daily block's is the one, docs/DAILY.md DS11).
 */
function BestBlock(props: { order: number; best: RunOverBest; hideTarget?: boolean }) {
	const hudFont = useHudFont();
	const b = props.best;
	if (!b.ranked) return undefined;
	const lines = new Array<React.Element>();
	if (b.lines.rows) {
		const h = HUD_VIEW.textSize + FOOTPRINT_ESTIMATE.lineSlack;
		b.records.rows.forEach((_, i) => {
			const value = NEW_BEST_UI.recordRows[i];
			if (value === undefined) return;
			lines.push(
				<textlabel
					key={`Record${i}`}
					LayoutOrder={i + 1}
					Size={new UDim2(1, 0, 0, h)}
					BackgroundTransparency={HIDDEN}
					Font={hudFont}
					TextScaled={true}
					TextSize={HUD_VIEW.textSize}
					TextColor3={role(NEW_BEST_ROLE)}
					TextStrokeColor3={role("background")}
					TextStrokeTransparency={HUD_VIEW.panelTransparency}
					TextXAlignment={Enum.TextXAlignment.Center}
					Text={value.binding}
				>
					<uitextsizeconstraint MaxTextSize={HUD_VIEW.textSize} />
				</textlabel>,
			);
		});
	}
	const saved = b.lines.saved;
	if (saved !== undefined) {
		lines.push(
			<Text
				key="Saved"
				order={lines.size() + 1}
				fill={true}
				size={HUD_VIEW.smallText}
				color={saved === NEW_BEST_STRINGS.saved ? NEW_BEST_ROLE : "uiHealth"}
				align={Enum.TextXAlignment.Center}
				text={str(saved)}
			/>,
		);
	}
	// docs/RUN_RECAP.md RR5: the near-miss line says the same thing, closer, so the dim target line steps aside for it.
	const target = props.hideTarget === true ? "" : bestText(b.lines.target, bestTargetKey(b.daily), str);
	if (target !== "") {
		lines.push(
			<Text
				key="Target"
				order={lines.size() + 1}
				fill={true}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Center}
				text={target}
			/>,
		);
	}
	if (lines.size() === 0) return undefined;
	return (
		<frame
			key="Best"
			LayoutOrder={props.order}
			Size={new UDim2(1, 0, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{lines}
		</frame>
	);
}

/** A fixed-width column of the compact run-over panel (a fixed width, so wrapped and filling text resolve against it). */
function Column(props: { order: number; width: number; gap: number; children?: React.ReactNode }) {
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, props.gap)}
			/>
			{props.children}
		</frame>
	);
}

/**
 * The run-over title ("Run over" / "Victory"). With the frame art and the header icon (runOverIcon: the skull for a
 * solo death, the RIP stone for a party's end, none for a victory), the icon beside the title, the pair centred
 * (docs/UI_ART.md UA8); otherwise exactly the flat title line.
 */
function RunOverHeader(props: { order: number; victory: boolean; icon: string | undefined; text: string }) {
	const color = props.victory ? "uiAccent" : "uiHealth";
	const icon = panelIcon(screenSkin("runOver"), props.icon);
	if (icon === undefined) {
		return (
			<Text
				fill={true}
				order={props.order}
				size={HUD_VIEW.bigText}
				color={color}
				align={Enum.TextXAlignment.Center}
				text={props.text}
			/>
		);
	}
	const box = UI_ART.iconBox.header;
	return (
		<Row order={props.order} align={Enum.HorizontalAlignment.Center}>
			<ArtImage name="HeaderIcon" id={icon} order={1} box={{ w: box, h: box }} />
			<Text order={2} size={HUD_VIEW.bigText} color={color} text={props.text} />
		</Row>
	);
}

/**
 * Centre, after the run ends (web PlayerHud death line, BossHud victory banner and the playtest post-run panel's
 * stats): "Run over" / "Victory", "You died — press R to retry" or "<boss name> defeated — press R to play again"
 * with the restart key of the device used last (R / D-pad down) and the other one below, then the run's time, hits
 * taken and kills; in a scored run (M2) the score and its breakdown by source; under the exits, the server's verdict
 * line and the run's info line (RunInfoLine; docs/HUD_LAYOUT.md H6: the in-run InfoPanel only flashes the verdict).
 * With boons, the Build list (docs/BUILDS.md BU10) beside the score breakdown (a third column on a phone).
 *
 * Exits (L3 / L6): "Again" (solo runs; R) and "Main menu", or "Back to lobby" while in a lobby. A party run has no
 * Again: R / the button go back to the lobby (once the party's verdict is in). A party run the server ended before the
 * wipe (desync, an error, expiry) shows here too, its main line naming the verdict's reason (partyRunOverLine), as
 * does a wiped party's run the server rejected. The panel counts as a menu, so the pad
 * drives the GUI selection here (it starts on the first button): the pad's hint is A, not the D-pad restart.
 *
 * Fitted into the safe area on touch (MenuFit, docs/UI_ART.md "Phones"); compact (a phone): two columns, the header,
 * the main line, the stats as lines, the exits, the verdict and the info line on the left, the score breakdown on
 * the right with tighter lines. Narrow (a phone in portrait): the full layout in one MENU_FIT.runOverNarrowWidth
 * column, the stats as lines, the Build list under the breakdown and the smaller exit buttons.
 *
 * New best (docs/NEW_BEST.md NB9), ranked runs only (runOverBest; an unranked run's panel is unchanged): on a record
 * run the gold ribbon under the header (BestRibbon) and, under the stats (compact: atop the breakdown column), the
 * record rows and the save chip (BestBlock); a run with no record gets the dim `Best ...` line there instead. The
 * record fanfare (the cue mapper's run-over jingle swap), the rows' roll with its tick / land sounds and the
 * full-screen confetti are NewBestController's.
 *
 * The Daily (docs/DAILY.md DS11), daily runs only: the daily block (DailyResultBlock: standing, entrants, best today,
 * the save chip, the countdown) under new best's block (compact: atop the breakdown column), a spot for the friends
 * you passed right after it (DS10), and the Again button reads Retry Daily (still the first, focused button).
 *
 * The recap (docs/RUN_RECAP.md RR5 / RR7), endless, daily and dev runs (the store's `recap` slice for this run;
 * RecapController draws its counting numbers and fades through RECAP_BINDINGS): the near-miss line under the main
 * line (it replaces BestBlock's dim `Best ...` line; a record run's is a dim sub-line under new best's rows), the
 * highlights (2 x 2) in the score breakdown's place, and Details in the exits row, which swaps the breakdown and the
 * Build list back in (RRD5; compact: the Build list's third column only then). Again is the largest button
 * (recapExitSizes), the gamepad's selection starts on it, a keyboard's Enter / Space press it (RecapController) and its
 * focus brightens once armed; it goes through the recap's retry gate (HudActions.again: before the 0.6 s arm a press
 * skips the timeline). Runs without a recap keep exactly the old panel.
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
	const baseline = useSelector(selectRunBaseline);
	const baselineRun = useSelector(selectBaselineRun);
	const recap = useSelector(selectRecap);
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
	const hint = restartHint(bindings, str);
	// Touch: the Again button stands in for the restart key (docs/MOBILE.md MB10).
	const touch = device === "touch";
	// A daily run's Again is Retry Daily (docs/DAILY.md DS11, DSD3: unlimited attempts; the restart keeps the world).
	const daily = info.world === DAILY_WORLD_KIND;
	const againText = str(daily ? DAILY_STRINGS.retry : MENU_STRINGS.again);
	const key = touch ? againText : device === "gamepad" ? padKey : hint.keyboard;
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
	// docs/RUN_RECAP.md RR5: this run's recap (none: the old panel exactly).
	const recapOn = recap.run !== 0 && recap.run === info.run;
	const nearMiss = recapOn ? recap.nearMiss : undefined;
	const highlightsOn = recapOn && recap.highlights.size() > 0;
	// The breakdown and the Build list: behind Details while there are highlights (RRD5), else as before.
	const details = !highlightsOn || recap.details;
	const best = runOverBest(baseline, baselineRun, info.run, verdict, s.score, s.floor);
	const ribbonKey = runOverRibbonKey(best.records, best.daily);
	const ribbon =
		ribbonKey !== undefined ? <BestRibbon key="Ribbon" order={ROW.ribbon} text={str(ribbonKey)} /> : undefined;
	const hideTarget = recapHidesBestLine(nearMiss);
	const bestBlock = <BestBlock key="Best" order={ROW.best} best={best} hideTarget={hideTarget} />;
	// One owner per piece (docs/DAILY.md DS11): the daily block's best-today line only when BestBlock draws no best line
	// (a near-miss line in its place counts as drawn: the daily block never brings it back).
	const bestLineShown = bestBlockDrawsBestLine(best.lines);
	const dailyBlock = <DailyResultBlock key="Daily" order={ROW.daily} bestLineShown={bestLineShown} />;
	const header = (
		<RunOverHeader
			key="Header"
			order={ROW.header}
			victory={victory}
			icon={runOverIcon(victory, info.coop)}
			text={str(victory ? HUD_STRINGS.runVictory : HUD_STRINGS.runOver)}
		/>
	);
	const mainLine = (
		<Text
			key="Main"
			order={ROW.main}
			size={HUD_VIEW.titleText}
			align={Enum.TextXAlignment.Center}
			wrap={true}
			text={main}
		/>
	);
	const altLine = touch ? undefined : (
		<Text
			key="Alt"
			fill={true}
			order={ROW.alt}
			size={HUD_VIEW.smallText}
			color="uiTextDim"
			align={Enum.TextXAlignment.Center}
			text={str(HUD_STRINGS.restartAlt, { key: otherKey })}
		/>
	);
	const nearMissLine =
		nearMiss !== undefined && !nearMiss.dim ? (
			<NearMissLine key="NearMiss" order={ROW.nearMiss} dim={false} />
		) : undefined;
	const nearMissDim = (order: number) =>
		nearMiss !== undefined && nearMiss.dim ? (
			<NearMissLine key="NearMissDim" order={order} dim={true} />
		) : undefined;
	const grid = (order: number) =>
		highlightsOn && !details ? (
			<HighlightGrid key="Highlights" order={order} cells={recap.highlights} />
		) : undefined;
	const stats = [
		{ label: str(victory ? HUD_STRINGS.timeVictory : HUD_STRINGS.time), value: formatClock(s.endTick / SIM_HZ) },
		{ label: str(HUD_STRINGS.hits), value: tostring(s.hitsTaken) },
		{ label: str(HUD_STRINGS.kills), value: tostring(s.kills) },
	];
	const verdictRow =
		verdictText !== "" ? (
			<Text
				key="Verdict"
				order={ROW.verdict}
				size={HUD_VIEW.smallText}
				color={verdictColor(verdict)}
				align={Enum.TextXAlignment.Center}
				wrap={true}
				text={verdictText}
			/>
		) : undefined;
	/**
	 * The exits. With a recap (RR7): Again the largest (recapExitSizes), Details beside the exit when there are
	 * highlights, Again's keyboard focus brightening once armed (the gamepad's selection is the ring otherwise), Again
	 * through the retry gate. Without: exactly the old row (`legacy`: the layout's old button size).
	 */
	const exitButtons = (layout: RecapLayout, legacy?: Vector2) => {
		const sizes = recapExitSizes(layout);
		const againSize = recapOn ? new Vector2(sizes.again.x, sizes.again.y) : legacy;
		const otherSize = recapOn ? new Vector2(sizes.other.x, sizes.other.y) : legacy;
		const otherText = recapOn ? sizes.otherTextSize : undefined;
		return (
			<Row key="Exits" order={ROW.exits} align={Enum.HorizontalAlignment.Center}>
				{exits.again ? (
					<MenuButton
						ref={firstRef}
						order={1}
						name="Again"
						size={againSize}
						active={recapOn && device === "keyboard" && recap.armed}
						text={againText}
						onActivated={() => actions.again()}
					/>
				) : undefined}
				<MenuButton
					ref={exits.again ? undefined : firstRef}
					order={2}
					name="Exit"
					size={otherSize}
					textSize={otherText}
					text={str(exits.exitKey)}
					icon={runOverExitIcon(exits.exitKey)}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.exitRun();
					}}
				/>
				{highlightsOn ? (
					<DetailsToggle
						order={3}
						details={recap.details}
						size={sizes.other}
						textSize={sizes.otherTextSize}
					/>
				) : undefined}
			</Row>
		);
	};
	const breakdown = { order: ROW.breakdown, score: s.score, points: s.scorePoints, maxCombo: s.maxCombo };
	const breakdownWidth = HUD_VIEW.breakdownLabelWidth + HUD_VIEW.gap + HUD_VIEW.breakdownValueWidth;
	// docs/ITEM_TOOLTIPS.md IT7: relics and curses count too (the list's sections; boosts ended with the run).
	const hasBuild = hasBuildItems(s, false) && details;
	const legacyButton = new Vector2(MENU_FIT.runOverButton.x, MENU_FIT.runOverButton.y);
	return (
		<MenuFit
			render={(layout) => {
				if (layout.compact) {
					// A phone (docs/UI_ART.md "Phones"): the header, stats, exits and verdict on the left, the
					// score breakdown (or the highlights) beside them, so the panel is about half as tall.
					const left = MENU_FIT.runOverLeftWidth;
					const right = s.scoring ? breakdownWidth : 0;
					// docs/BUILDS.md BU10: the Build list as a third column (a phone's panel is wide, not tall); with
					// highlights only behind Details (RRD5).
					const build = hasBuild ? BUILD_HUD_VIEW.listCompactWidth : 0;
					return (
						<Panel
							width={
								left +
								(s.scoring ? HUD_VIEW.gap + right : 0) +
								(hasBuild ? HUD_VIEW.gap + build : 0) +
								HUD_VIEW.pad * 4
							}
							align={Enum.HorizontalAlignment.Center}
							skin={screenSkin("runOver")}
							name="RunOver"
						>
							<Row order={1}>
								<Column order={1} width={left} gap={HUD_VIEW.gap}>
									{header}
									{ribbon}
									{mainLine}
									{altLine}
									{nearMissLine}
									<Column order={ROW.stats} width={breakdownWidth} gap={HUD_VIEW.gap}>
										{stats.map((st, i) => (
											<BreakdownLine
												key={`st${i}`}
												order={i + 1}
												label={st.label}
												value={st.value}
											/>
										))}
									</Column>
									{exitButtons("compact", legacyButton)}
									{verdictRow}
									<RunInfoLine order={ROW.info} />
								</Column>
								{s.scoring ? (
									<Column order={2} width={right} gap={MENU_FIT.runOverLineGap}>
										<DailyResultBlock key="Daily" order={-4} bestLineShown={bestLineShown} />
										<DailyPassedRow key="DailyPassed" order={-3} />
										{best.ranked ? (
											<BestBlock key="Best" order={-2} best={best} hideTarget={hideTarget} />
										) : undefined}
										{nearMissDim(-1)}
										{grid(0)}
										{details ? breakdownLines(breakdown) : undefined}
									</Column>
								) : undefined}
								{hasBuild ? (
									<Column order={3} width={build} gap={MENU_FIT.runOverLineGap}>
										<BuildList
											order={1}
											width={build}
											maxRows={BUILD_HUD_VIEW.listCompactRows}
											withBoosts={false}
										/>
									</Column>
								) : undefined}
							</Row>
						</Panel>
					);
				}
				// A phone in portrait: one narrow column (the stats as lines, the Build list under the breakdown).
				const narrow = layout.narrow;
				return (
					<Panel
						width={narrow ? MENU_FIT.runOverNarrowWidth : HUD_VIEW.panelWidth * 2}
						align={Enum.HorizontalAlignment.Center}
						skin={screenSkin("runOver")}
						name="RunOver"
					>
						{header}
						{ribbon}
						{mainLine}
						{altLine}
						{nearMissLine}
						{narrow ? (
							<Column order={ROW.stats} width={breakdownWidth} gap={HUD_VIEW.gap}>
								{stats.map((st, i) => (
									<BreakdownLine key={`st${i}`} order={i + 1} label={st.label} value={st.value} />
								))}
							</Column>
						) : (
							<Row order={ROW.stats} align={Enum.HorizontalAlignment.Center}>
								{stats.map((st, i) => (
									<Stat key={`st${i}`} order={i + 1} label={st.label} value={st.value} />
								))}
							</Row>
						)}
						{bestBlock}
						{nearMissDim(ROW.nearMissDim)}
						{dailyBlock}
						<DailyPassedRow key="DailyPassed" order={ROW.dailyPassed} />
						{grid(ROW.breakdown)}
						{/* docs/BUILDS.md BU10: the score breakdown and the Build list side by side (narrow: stacked). */}
						{details ? (
							<Row order={ROW.breakdown} align={Enum.HorizontalAlignment.Center}>
								{s.scoring ? <ScoreBreakdown {...breakdown} order={1} /> : undefined}
								{hasBuild && !narrow ? (
									<BuildList
										order={2}
										width={BUILD_HUD_VIEW.listWidth}
										maxRows={BUILD_HUD_VIEW.listMaxRows}
										withBoosts={false}
									/>
								) : undefined}
							</Row>
						) : undefined}
						{hasBuild && narrow ? (
							<BuildList
								order={ROW.build}
								width={BUILD_HUD_VIEW.listWidth}
								maxRows={BUILD_HUD_VIEW.listCompactRows}
								withBoosts={false}
							/>
						) : undefined}
						{verdictRow}
						<RunInfoLine order={ROW.info} />
						{exitButtons(narrow ? "narrow" : "wide", narrow ? legacyButton : undefined)}
					</Panel>
				);
			}}
		/>
	);
}
