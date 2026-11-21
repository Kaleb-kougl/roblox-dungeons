import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectDailyStatus } from "client/store";
import { MenuButton, Panel, Row, Text, useDailyClock, useHeadshot } from "client/ui/hud";
import { fontFor, role, str, textSizeFor, useUiFonts, type FontRole } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { DAILY_STRINGS, FOOTPRINT_ESTIMATE, HUD_VIEW } from "shared/view/hud";
import { DAILY_MENU, dailyCardModel, dailyPodiumModel, type DailyPodiumRow } from "shared/view/menu";
import { useMenuActions } from "./actions";

const HIDDEN = 1;
const CARD_BUTTON = new Vector2(DAILY_MENU.cardButton.x, DAILY_MENU.cardButton.y);

/** A one-line label cut with "..." at `width` (player names). */
function Clipped(props: {
	order: number;
	width: number;
	text: string;
	color?: "uiText" | "uiAccent" | "uiTextDim";
	/** "name" for a player's display name (LD13). */
	font?: FontRole;
}) {
	const fonts = useUiFonts();
	const size = textSizeFor(fonts, HUD_VIEW.smallText);
	return (
		<textlabel
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, size + FOOTPRINT_ESTIMATE.lineSlack)}
			BackgroundTransparency={HIDDEN}
			Font={fontFor(fonts, props.font)}
			TextSize={size}
			TextColor3={role(props.color ?? "uiText")}
			TextStrokeColor3={role("background")}
			TextStrokeTransparency={HUD_VIEW.panelTransparency}
			TextTruncate={Enum.TextTruncate.AtEnd}
			TextXAlignment={Enum.TextXAlignment.Center}
			Text={props.text}
		/>
	);
}

/** A player's headshot (fetched once, cached); a plain uiPanel square while it loads or when there is none. */
function Headshot(props: { order: number; userId: number; size: number }) {
	const image = useHeadshot(props.userId);
	return (
		<imagelabel
			LayoutOrder={props.order}
			Size={new UDim2(0, props.size, 0, props.size)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={0}
			BorderSizePixel={0}
			Image={image ?? ""}
		>
			<uistroke Thickness={1} Color={role("uiTextDim")} />
		</imagelabel>
	);
}

/** A vertical stack of `width` (fixed, so filling text resolves against it), centred. */
function Stack(props: { order: number; width: number; gap?: number; children?: React.ReactNode }) {
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
				Padding={new UDim(0, props.gap ?? HUD_VIEW.gap)}
			/>
			{props.children}
		</frame>
	);
}

/**
 * The main menu's Daily card (docs/DAILY.md DS9, shared/view/menu dailyCardModel): `DAILY #304 · Sat Oct 31`, floor
 * 1's roster and floor 5's boss (DSD14), your best today with its standing (DSD15) or `Not played yet`, the countdown
 * (`New daily in 5:12:33`, a per-second binding), Play Daily and Daily with friends. While today's status is unknown
 * (not answered yet, or stale past midnight) only the title, a quiet placeholder and the countdown show, and Play Daily
 * still works (the server picks the seed). Compact (a phone): the title and countdown share a row, the roster and boss
 * one line.
 */
export function DailyCard(props: { order: number; width: number; compact: boolean }) {
	const actions = useMenuActions();
	const status = useSelector(selectDailyStatus);
	const clock = useDailyClock(status?.resetsAt);
	const m = dailyCardModel(status, clock.today, str);
	const inner = props.width - HUD_VIEW.pad * 2;
	const small = (key: string, order: number, text: string, color: "uiText" | "uiTextDim" = "uiTextDim") =>
		text !== "" ? (
			<Text
				key={key}
				order={order}
				fill={true}
				wrap={true}
				size={HUD_VIEW.smallText}
				color={color}
				align={Enum.TextXAlignment.Center}
				text={text}
			/>
		) : undefined;
	const countdown = (
		<Text
			key="Countdown"
			order={props.compact ? 2 : 6}
			size={HUD_VIEW.smallText}
			color="uiTextDim"
			align={Enum.TextXAlignment.Center}
			text={clock.countdown}
		/>
	);
	const title = (
		<Text
			key="Title"
			order={1}
			size={HUD_VIEW.textSize}
			color="uiAccent"
			align={Enum.TextXAlignment.Center}
			text={m.title}
		/>
	);
	const preview = props.compact ? small("Preview", 3, m.known ? m.preview : "") : undefined;
	return (
		<Panel
			order={props.order}
			width={props.width}
			align={Enum.HorizontalAlignment.Center}
			skin="none"
			name="DailyCard"
			flatOnly={<uistroke Thickness={1} Color={role("uiAccent")} />}
		>
			{props.compact ? (
				<Row key="Head" order={1} align={Enum.HorizontalAlignment.Center}>
					{title}
					{countdown}
				</Row>
			) : (
				title
			)}
			{props.compact ? preview : small("Roster", 2, m.roster)}
			{props.compact ? undefined : small("Boss", 3, m.boss)}
			{small("Best", 4, m.best, "uiText")}
			{small("Placeholder", 5, m.placeholder)}
			{props.compact ? undefined : countdown}
			<Stack order={7} width={inner}>
				<Row order={1} align={Enum.HorizontalAlignment.Center}>
					<MenuButton
						order={1}
						name="PlayDaily"
						size={CARD_BUTTON}
						textSize={HUD_VIEW.smallText}
						fit={true}
						text={str(DAILY_STRINGS.play)}
						onActivated={() => {
							actions.playUi(SFX.uiConfirm);
							actions.playDaily();
						}}
					/>
					<MenuButton
						order={2}
						name="PlayDailyParty"
						size={CARD_BUTTON}
						textSize={HUD_VIEW.smallText}
						fit={true}
						text={str(DAILY_STRINGS.playParty)}
						onActivated={() => {
							actions.playUi(SFX.uiClick);
							actions.playDailyParty();
						}}
					/>
				</Row>
			</Stack>
		</Panel>
	);
}

/** One podium place: desktop the place, headshot, name and score stacked; compact the headshot beside the text. */
function PodiumCell(props: { row: DailyPodiumRow; compact: boolean }) {
	const r = props.row;
	if (props.compact) {
		const w = DAILY_MENU.podiumCompactCellWidth - DAILY_MENU.headshotCompact - HUD_VIEW.gap;
		return (
			<Row order={r.place}>
				<Headshot order={1} userId={r.userId} size={DAILY_MENU.headshotCompact} />
				<Stack order={2} width={w} gap={0}>
					<Clipped order={1} width={w} text={r.line} font="name" />
					<Clipped order={2} width={w} text={r.score} color="uiAccent" />
				</Stack>
			</Row>
		);
	}
	const w = DAILY_MENU.podiumCellWidth;
	return (
		<Stack order={r.place} width={w} gap={DAILY_MENU.podiumLineGap}>
			<Clipped order={1} width={w} text={r.placeText} color="uiAccent" />
			<Headshot order={2} userId={r.userId} size={DAILY_MENU.headshotSize} />
			<Clipped order={3} width={w} text={r.name} font="name" />
			<Clipped order={4} width={w} text={r.score} color="uiAccent" />
		</Stack>
	);
}

/**
 * Yesterday's podium strip (docs/DAILY.md DS9 / DS8; shared/view/menu dailyPodiumModel): the top 3 of yesterday's solo
 * board with headshots (Players:GetUserThumbnailAsync, cached; plain squares while loading), names and scores, and
 * `You finished #57` / `top 12%` when you played. Hidden when unknown or nobody played.
 */
export function DailyPodiumStrip(props: { order: number; width: number; compact: boolean }) {
	const status = useSelector(selectDailyStatus);
	const m = dailyPodiumModel(status?.podium, str);
	if (m === undefined) return undefined;
	return (
		<Stack order={props.order} width={props.width}>
			<Text
				key="Title"
				order={1}
				fill={true}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Center}
				text={m.title}
			/>
			<Row key="Places" order={2} align={Enum.HorizontalAlignment.Center}>
				{m.rows.map((r) => (
					<PodiumCell key={`p${r.place}`} row={r} compact={props.compact} />
				))}
			</Row>
			{m.mine !== "" ? (
				<Text
					key="Mine"
					order={3}
					fill={true}
					size={HUD_VIEW.smallText}
					color="uiText"
					align={Enum.TextXAlignment.Center}
					text={m.mine}
				/>
			) : undefined}
		</Stack>
	);
}
