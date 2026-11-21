import React, { useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectInputDevice, selectLeaderboard, type LeaderboardState } from "client/store";
import { useFocusScope } from "client/ui/focus";
import { role, str } from "client/ui/theme";
import {
	LEADERBOARD_TOP_COUNT,
	leaderboardRequestKey,
	type LeaderboardBoard,
	type LeaderboardRow,
	type LeaderboardView,
} from "shared/leaderboard";
import { SFX } from "shared/view/audio";
import { leaderboardHint, keyDevice } from "shared/play";
import {
	DAILY_STRINGS,
	HUD_VIEW,
	LEADERBOARD_BOARD_TABS,
	LEADERBOARD_FILTER_TABS,
	LEADERBOARD_SCOPE_TABS,
	LEADERBOARD_STRINGS,
	LEADERBOARD_VIEW,
	characterIconSize,
	characterOfEntry,
	dailyBoardLines,
	leaderboardFilterShown,
	leaderboardTabRequest,
	withLeaderboardTab,
	type DailyBoardStatus,
	type LeaderboardTabs,
} from "shared/view/hud";
import { useHudActions } from "./actions";
import { CharacterIcon } from "./CharacterIcon";
import { MenuFit } from "./MenuFit";
import { PadHintBar } from "./PadHintBar";
import { ListFocusStroke, MenuButton, Panel, Row, Text } from "./primitives";
import { ScreenDim } from "./ScreenDim";
import { MENU_FIT, screenSkin, stepTab, subTabStep, tabStep } from "shared/view/menu";

const HIDDEN = 1;

/** The scope tabs' scopes, in tab order (LB / RB step them). */
const SCOPES = LEADERBOARD_SCOPE_TABS.map((tab) => tab.scope);

const TAB_LABEL: Readonly<Record<LeaderboardBoard, string>> = {
	solo: LEADERBOARD_STRINGS.solo,
	coop: LEADERBOARD_STRINGS.coop,
};

/**
 * One board row: rank, the character icon of the entry when it carries one (docs/ARCHER.md AR9, owner answer 4: the
 * row's `classId` when it is a character id), name, score, floor. The row is the list's width (the scroll bar keeps
 * its own inset) and the name takes what the fixed columns leave, so the floor column always ends inside the panel
 * whatever the skin's padding at this scale; the floor text shrinks to fit its column (a long floor or translation).
 */
function BoardRow(props: { row: LeaderboardRow; highlight: boolean }) {
	const r = props.row;
	const color = props.highlight ? "uiAccent" : "uiText";
	const character = characterOfEntry(r);
	const icon = characterIconSize(LEADERBOARD_VIEW.rowHeight);
	return (
		<frame
			LayoutOrder={r.rank}
			Size={new UDim2(1, 0, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			<Text
				order={1}
				width={LEADERBOARD_VIEW.rankWidth}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				text={str(LEADERBOARD_STRINGS.rank, { rank: r.rank })}
			/>
			{character !== undefined ? <CharacterIcon order={2} character={character} size={icon} /> : undefined}
			<Text order={3} width={0} flex={true} size={HUD_VIEW.smallText} color={color} font="name" text={r.name} />
			<Text
				order={4}
				width={LEADERBOARD_VIEW.scoreWidth}
				size={HUD_VIEW.smallText}
				color={color}
				align={Enum.TextXAlignment.Right}
				text={tostring(r.score)}
			/>
			<Text
				order={5}
				width={LEADERBOARD_VIEW.floorWidth}
				fit={true}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Right}
				text={str(LEADERBOARD_STRINGS.floor, { floor: r.floor })}
			/>
		</frame>
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

/** A daily tab's status key (shared/view/hud dailyBoardLines), as text ("" for none). */
function dailyStatusText(status: DailyBoardStatus): string {
	switch (status) {
		case "loading":
			return str(LEADERBOARD_STRINGS.loading);
		case "unavailable":
			return str(LEADERBOARD_STRINGS.unavailable);
		case "stale":
			return str(LEADERBOARD_STRINGS.stale);
		case "empty":
			return str(DAILY_STRINGS.boardEmpty);
		case "friendsEmpty":
			return str(DAILY_STRINGS.boardFriendsEmpty);
		default:
			return "";
	}
}

/** The panel's text for the shown tabs: the all-time lines exactly as before, or the daily tab's lines. */
interface BoardText {
	readonly view: LeaderboardView | undefined;
	readonly status: string;
	readonly pending: string;
	readonly total: string;
	readonly mine: string;
}

function boardText(lb: LeaderboardState, tabs: LeaderboardTabs): BoardText {
	if (tabs.scope === "alltime") {
		const view = tabs.board === "coop" ? lb.coop : lb.solo;
		return { view, status: statusLine(view, lb.loading), pending: "", total: "", mine: mineLine(view) };
	}
	const view = lb.scoped[leaderboardRequestKey(leaderboardTabRequest(tabs))];
	const lines = dailyBoardLines(view, lb.loading, str);
	return {
		view,
		status: dailyStatusText(lines.status),
		pending: lines.pending,
		total: lines.total,
		mine: lines.mine,
	};
}

const SCOPE_TAB = new Vector2(LEADERBOARD_VIEW.scopeTab.x, LEADERBOARD_VIEW.scopeTab.y);
const BOARD_TAB = new Vector2(LEADERBOARD_VIEW.boardTab.x, LEADERBOARD_VIEW.boardTab.y);

/**
 * The leaderboard panel (M5; docs/DAILY.md DS9): scope tabs Today / Yesterday / All time, then Solo / Co-op and, on
 * the daily scopes, Global / Friends; the top LEADERBOARD_TOP_COUNT verified runs (rank, name, score, floor; the
 * player's own row highlighted), and the player's best with its rank (daily: `#41`, `top 9%` or `#3 of 12`, against
 * the board's entrants, `1,240 players`). A friends view fills in as the server looks friends up (`finding friends...
 * (12)`). The all-time tab is exactly the old panel. Opened with B (LEADERBOARD_KEY) or from the pause overlay; B, pad
 * B or Close closes it. A `panel` focus scope (docs/GAMEPAD_MENUS.md GM2-GM4): a gamepad starts on the first scope
 * tab, LB / RB step the scope tabs and LT / RT the board tabs (clamped at the ends), B closes it; the rows list is
 * selectable (a uiAccent ring while selected) and the right stick scrolls it (GM5); on a gamepad the hint bar
 * replaces the key hint (GM7). The run is paused
 * while it is open. Text from theme strings (hud.leaderboard.*, daily.tab.*,
 * daily.board.*), colours from theme roles.
 */
export function LeaderboardPanel(props: { localUserId: number }) {
	const lb = useSelector(selectLeaderboard);
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	const actions = useHudActions();
	const firstRef = useRef<TextButton>();
	const rootRef = useRef<Frame>();
	const listRef = useRef<ScrollingFrame>();
	const tabs: LeaderboardTabs = { scope: lb.scope, board: lb.board, friends: lb.friends };
	const t = boardText(lb, tabs);
	const rows = t.view?.rows ?? [];
	// docs/GAMEPAD_MENUS.md GM5: the rows list is selectable (a ring while selected) and the right stick scrolls it.
	const padContext = { subTabs: true, scrollList: rows.size() > 0 };
	const show = (patch: Partial<LeaderboardTabs>) => {
		actions.playUi(SFX.uiClick);
		actions.showLeaderboardTabs(withLeaderboardTab(tabs, patch));
	};
	useFocusScope(rootRef, {
		id: "leaderboard",
		layer: "panel",
		surface: "leaderboard",
		defaultRef: firstRef,
		active: lb.open,
		padContext,
		scrollRef: listRef,
		onPadAction: (action) => {
			if (action.kind === "close") {
				actions.playUi(SFX.uiBack);
				actions.setLeaderboardOpen(false);
				return;
			}
			// Clamped at the ends, silent there (padNav stepTab).
			const scope = stepTab(SCOPES, tabs.scope, tabStep(action));
			if (scope !== undefined) {
				show({ scope });
				return;
			}
			const board = stepTab(LEADERBOARD_BOARD_TABS, tabs.board, subTabStep(action));
			if (board !== undefined) show({ board });
		},
	});

	if (!lb.open) return undefined;
	const listHeight = math.min(LEADERBOARD_VIEW.listHeight, rows.size() * (LEADERBOARD_VIEW.rowHeight + HUD_VIEW.gap));
	const scopeTabs = LEADERBOARD_SCOPE_TABS.map((tab, i) => (
		<MenuButton
			key={tab.scope}
			ref={i === 0 ? firstRef : undefined}
			order={i + 1}
			name={`Scope_${tab.scope}`}
			size={SCOPE_TAB}
			text={str(tab.key)}
			active={tab.scope === tabs.scope}
			onActivated={() => show({ scope: tab.scope })}
		/>
	));
	const boardTabs = LEADERBOARD_BOARD_TABS.map((board, i) => (
		<MenuButton
			key={board}
			order={i + 1}
			name={`Tab_${board}`}
			size={BOARD_TAB}
			textSize={HUD_VIEW.smallText}
			text={str(TAB_LABEL[board])}
			active={board === tabs.board}
			onActivated={() => show({ board })}
		/>
	));
	const filterTabs = leaderboardFilterShown(tabs)
		? LEADERBOARD_FILTER_TABS.map((tab, i) => (
				<MenuButton
					key={tab.friends ? "friends" : "global"}
					order={LEADERBOARD_BOARD_TABS.size() + i + 1}
					name={tab.friends ? "Filter_friends" : "Filter_global"}
					size={BOARD_TAB}
					textSize={HUD_VIEW.smallText}
					text={str(tab.key)}
					active={tab.friends === tabs.friends}
					onActivated={() => show({ friends: tab.friends })}
				/>
		  ))
		: undefined;
	const small = (order: number, text: string, color: "uiTextDim" | "uiText" = "uiTextDim") =>
		text !== "" ? (
			<Text fill={true} order={order} size={HUD_VIEW.smallText} color={color} text={text} />
		) : undefined;
	return (
		<frame
			key="LeaderboardOverlay"
			ref={rootRef}
			Size={UDim2.fromScale(1, 1)}
			BackgroundTransparency={1}
			BorderSizePixel={0}
		>
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
						<Row key="Scopes" order={2}>
							{scopeTabs}
						</Row>
						<Row key="Boards" order={3}>
							{boardTabs}
							{filterTabs}
						</Row>
						{small(4, t.status)}
						{small(5, t.pending)}
						{small(6, t.total)}
						{rows.size() > 0 ? (
							<scrollingframe
								key="Rows"
								ref={listRef}
								LayoutOrder={7}
								Size={new UDim2(1, 0, 0, layout.flex)}
								CanvasSize={new UDim2(0, 0, 0, 0)}
								AutomaticCanvasSize={Enum.AutomaticSize.Y}
								ScrollBarThickness={LEADERBOARD_VIEW.scrollBarThickness}
								VerticalScrollBarInset={Enum.ScrollBarInset.ScrollBar}
								ScrollBarImageColor3={role("uiTextDim")}
								BackgroundTransparency={HIDDEN}
								BorderSizePixel={0}
								Selectable={true}
							>
								<uilistlayout
									FillDirection={Enum.FillDirection.Vertical}
									SortOrder={Enum.SortOrder.LayoutOrder}
									Padding={new UDim(0, HUD_VIEW.gap)}
								/>
								<ListFocusStroke key="ListFocus" />
								{rows.map((r) => (
									<BoardRow key={`r${r.rank}`} row={r} highlight={r.userId === props.localUserId} />
								))}
							</scrollingframe>
						) : undefined}
						{small(8, t.mine, "uiText")}
						<MenuButton
							order={9}
							name="Close"
							text={str(LEADERBOARD_STRINGS.close)}
							onActivated={() => {
								actions.playUi(SFX.uiBack);
								actions.setLeaderboardOpen(false);
							}}
						/>
						{device === "gamepad" ? (
							<PadHintBar order={10} surface="leaderboard" context={padContext} />
						) : device === "touch" ? undefined : (
							<Text
								fill={true}
								order={10}
								size={HUD_VIEW.smallText}
								color="uiTextDim"
								text={str(LEADERBOARD_STRINGS.hint, {
									key: leaderboardHint(bindings, str)[keyDevice(device)],
								})}
							/>
						)}
					</Panel>
				)}
			/>
		</frame>
	);
}
