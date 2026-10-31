import React, { useEffect, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService } from "@rbxts/services";
import { selectBindings, selectInputDevice, selectLeaderboard } from "client/store";
import { role, str } from "client/ui/theme";
import {
	LEADERBOARD_BOARDS,
	LEADERBOARD_TOP_COUNT,
	type LeaderboardBoard,
	type LeaderboardRow,
	type LeaderboardView,
} from "shared/leaderboard";
import { SFX } from "shared/view/audio";
import { leaderboardHint, keyDevice } from "shared/play";
import { HUD_VIEW, LEADERBOARD_STRINGS, LEADERBOARD_VIEW } from "shared/view/hud";
import { useHudActions } from "./actions";
import { MenuFit } from "./MenuFit";
import { MenuButton, Panel, Row, Text } from "./primitives";
import { ScreenDim } from "./ScreenDim";
import { MENU_FIT, screenSkin } from "shared/view/menu";

const HIDDEN = 1;

const TAB_LABEL: Readonly<Record<LeaderboardBoard, string>> = {
	solo: LEADERBOARD_STRINGS.solo,
	coop: LEADERBOARD_STRINGS.coop,
};

function nameWidth(): number {
	const v = LEADERBOARD_VIEW;
	return v.width - v.rankWidth - v.scoreWidth - v.floorWidth - HUD_VIEW.pad * 4 - v.scrollBarThickness;
}

function BoardRow(props: { row: LeaderboardRow; highlight: boolean }) {
	const r = props.row;
	const color = props.highlight ? "uiAccent" : "uiText";
	return (
		<Row order={r.rank}>
			<Text
				order={1}
				width={LEADERBOARD_VIEW.rankWidth}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				text={str(LEADERBOARD_STRINGS.rank, { rank: r.rank })}
			/>
			<Text order={2} width={nameWidth()} size={HUD_VIEW.smallText} color={color} text={r.name} />
			<Text
				order={3}
				width={LEADERBOARD_VIEW.scoreWidth}
				size={HUD_VIEW.smallText}
				color={color}
				align={Enum.TextXAlignment.Right}
				text={tostring(r.score)}
			/>
			<Text
				order={4}
				width={LEADERBOARD_VIEW.floorWidth}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Right}
				text={str(LEADERBOARD_STRINGS.floor, { floor: r.floor })}
			/>
		</Row>
	);
}

/** The status line above the list: loading, unavailable, stale or empty ("" when the rows say it all). */
function statusLine(view: LeaderboardView | undefined, loading: boolean): string {
	if (view === undefined) return str(LEADERBOARD_STRINGS.loading);
	if (!view.ok) return str(LEADERBOARD_STRINGS.unavailable);
	if (view.rows.size() === 0) return str(LEADERBOARD_STRINGS.empty);
	if (view.stale) return str(LEADERBOARD_STRINGS.stale);
	return loading ? str(LEADERBOARD_STRINGS.loading) : "";
}

function mineLine(view: LeaderboardView | undefined): string {
	const mine = view?.mine;
	if (mine === undefined) return str(LEADERBOARD_STRINGS.mineNone);
	if (mine.rank !== undefined) {
		return str(LEADERBOARD_STRINGS.mineRanked, { score: mine.score, floor: mine.floor, rank: mine.rank });
	}
	return str(LEADERBOARD_STRINGS.mine, { score: mine.score, floor: mine.floor, count: LEADERBOARD_TOP_COUNT });
}

/**
 * The leaderboard panel (M5): Solo / Co-op tabs, the top LEADERBOARD_TOP_COUNT verified runs (rank, name, score,
 * floor; the player's own row highlighted), and the player's personal best with its rank when it is in the top.
 * Opened with B (LEADERBOARD_KEY) or from the pause overlay; B, pad B or Close closes it. The run is paused while it is
 * open. Text from theme strings (hud.leaderboard.*), colours from theme roles.
 */
export function LeaderboardPanel(props: { localUserId: number }) {
	const lb = useSelector(selectLeaderboard);
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	const actions = useHudActions();
	const firstRef = useRef<TextButton>();

	useEffect(() => {
		if (!lb.open || device !== "gamepad") return;
		const button = firstRef.current;
		if (button !== undefined) GuiService.SelectedObject = button;
		return () => {
			if (GuiService.SelectedObject === button) GuiService.SelectedObject = undefined;
		};
	}, [lb.open, device]);

	if (!lb.open) return undefined;
	const view = lb.board === "coop" ? lb.coop : lb.solo;
	const status = statusLine(view, lb.loading);
	const rows = view?.rows ?? [];
	const listHeight = math.min(LEADERBOARD_VIEW.listHeight, rows.size() * (LEADERBOARD_VIEW.rowHeight + HUD_VIEW.gap));
	const tabs = LEADERBOARD_BOARDS.map((board, i) => (
		<MenuButton
			key={board}
			ref={i === 0 ? firstRef : undefined}
			order={i + 1}
			name={`Tab_${board}`}
			text={str(TAB_LABEL[board])}
			active={board === lb.board}
			onActivated={() => {
				actions.playUi(SFX.uiClick);
				actions.showLeaderboard(board);
			}}
		/>
	));
	return (
		<frame key="LeaderboardOverlay" Size={UDim2.fromScale(1, 1)} BackgroundTransparency={1} BorderSizePixel={0}>
			<ScreenDim key="Dim" name="LeaderboardDim" transparency={HUD_VIEW.overlayTransparency} />
			<MenuFit
				flex={{ min: MENU_FIT.listMin, max: listHeight }}
				render={(layout) => (
					<Panel
						width={LEADERBOARD_VIEW.width}
						padding={HUD_VIEW.pad * 2}
						transparency={0}
						skin={screenSkin("leaderboard")}
						flatOnly={<uistroke Thickness={1} Color={role("uiAccent")} />}
						name="Leaderboards"
					>
						<Text
							fill={true}
							order={1}
							size={HUD_VIEW.titleText}
							color="uiAccent"
							text={str(LEADERBOARD_STRINGS.title)}
						/>
						<Row order={2}>{tabs}</Row>
						{status !== "" ? (
							<Text fill={true} order={3} size={HUD_VIEW.smallText} color="uiTextDim" text={status} />
						) : undefined}
						{rows.size() > 0 ? (
							<scrollingframe
								key="Rows"
								LayoutOrder={4}
								Size={new UDim2(1, 0, 0, layout.flex)}
								CanvasSize={new UDim2(0, 0, 0, 0)}
								AutomaticCanvasSize={Enum.AutomaticSize.Y}
								ScrollBarThickness={LEADERBOARD_VIEW.scrollBarThickness}
								ScrollBarImageColor3={role("uiTextDim")}
								BackgroundTransparency={HIDDEN}
								BorderSizePixel={0}
								Selectable={false}
							>
								<uilistlayout
									FillDirection={Enum.FillDirection.Vertical}
									SortOrder={Enum.SortOrder.LayoutOrder}
									Padding={new UDim(0, HUD_VIEW.gap)}
								/>
								{rows.map((r) => (
									<BoardRow key={`r${r.rank}`} row={r} highlight={r.userId === props.localUserId} />
								))}
							</scrollingframe>
						) : undefined}
						<Text fill={true} order={5} size={HUD_VIEW.smallText} color="uiText" text={mineLine(view)} />
						<MenuButton
							order={6}
							name="Close"
							text={str(LEADERBOARD_STRINGS.close)}
							onActivated={() => {
								actions.playUi(SFX.uiBack);
								actions.setLeaderboardOpen(false);
							}}
						/>
						{device === "touch" ? undefined : (
							<Text
								fill={true}
								order={7}
								size={HUD_VIEW.smallText}
								color="uiTextDim"
								text={str(LEADERBOARD_STRINGS.hint, {
									key: leaderboardHint(bindings)[keyDevice(device)],
								})}
							/>
						)}
					</Panel>
				)}
			/>
		</frame>
	);
}
