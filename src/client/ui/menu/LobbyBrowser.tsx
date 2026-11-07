import { keyDevice } from "shared/play";
import React, { useRef, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectInputDevice, selectLobbyList, selectMyLobbyId } from "client/store";
import { FocusScope } from "client/ui/focus";
import { MenuButton, MenuFit, PadHintBar, Panel, Row, Text } from "client/ui/hud";
import { str } from "client/ui/theme";
import { LOBBY, LOBBY_VISIBILITIES, type LobbyVisibility } from "shared/lobby";
import { SFX } from "shared/view/audio";
import { HUD_VIEW } from "shared/view/hud";
import {
	LOBBY_STRINGS,
	MENU_BACK_HINT,
	MENU_FIT,
	MENU_STRINGS,
	MENU_VIEW,
	browserRows,
	lobbyVisibilityKey,
	screenSkin,
} from "shared/view/menu";
import { useMenuActions } from "./actions";
import { spec, useNameOf } from "./hooks";
import { Cell, ListRow, ScrollList } from "./widgets";

const SMALL = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);
const WIDE = new Vector2(MENU_VIEW.wideButton.x, MENU_VIEW.wideButton.y);

/**
 * The lobby browser (task L5): the lobbies this player may see (the server's `lobbyList`, never closed ones), each
 * row with its preset name ("{host}'s descent"), count / max, Open / Friends, a friend marker, Starting / In run
 * (greyed, no Join) and Join. The top bar creates a lobby with the picked visibility (Open / Friends / Closed); while
 * in a lobby it offers "Your lobby" instead (Join is off: leave yours first). Refresh asks the server again. Fitted
 * into the safe area on touch (MenuFit: the lobby list is the flexible list). A `screen` focus scope with memory
 * (docs/GAMEPAD_MENUS.md GM2): a refresh that removes the selected row falls back to the first button; B goes back;
 * X refreshes, Y creates (GM6), the right stick scrolls the list (GM5); on a gamepad the hint bar replaces the key hint.
 */
export function LobbyBrowser() {
	const actions = useMenuActions();
	const list = useSelector(selectLobbyList);
	const myLobby = useSelector(selectMyLobbyId);
	const device = useSelector(selectInputDevice);
	const nameOf = useNameOf();
	const [visibility, setVisibility] = useState<LobbyVisibility>(LOBBY.defaultVisibility);
	const firstRef = useRef<TextButton>();
	const listRef = useRef<ScrollingFrame>();
	const rows = browserRows(list, myLobby, nameOf);
	const create = () => {
		actions.playUi(SFX.uiConfirm);
		actions.createLobby(visibility);
	};
	const refresh = () => {
		actions.playUi(SFX.uiClick);
		actions.refreshLobbies();
	};
	// docs/GAMEPAD_MENUS.md GM6: X Refresh, Y Create (only while Create is on screen: not in a lobby).
	const padContext = { canCreate: myLobby === undefined, scrollList: true };

	const visButtons = LOBBY_VISIBILITIES.map((v, i) => (
		<MenuButton
			key={v}
			ref={i === 0 && myLobby === undefined ? firstRef : undefined}
			order={i + 2}
			name={`New_${v}`}
			size={SMALL}
			textSize={HUD_VIEW.smallText}
			text={str(lobbyVisibilityKey(v))}
			active={v === visibility}
			onActivated={() => {
				actions.playUi(SFX.uiClick);
				setVisibility(v);
			}}
		/>
	));
	const top =
		myLobby === undefined ? (
			<Row order={2} align={Enum.HorizontalAlignment.Center}>
				<Text order={1} width={MENU_VIEW.countWidth * 2} text={str(LOBBY_STRINGS.newVisibility)} />
				{visButtons}
				<MenuButton
					order={10}
					name="Create"
					size={WIDE}
					text={str(LOBBY_STRINGS.create)}
					onActivated={create}
				/>
			</Row>
		) : (
			<Row order={2} align={Enum.HorizontalAlignment.Center}>
				<MenuButton
					ref={firstRef}
					order={1}
					name="YourLobby"
					size={WIDE}
					text={str(MENU_STRINGS.yourLobby)}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.openLobbyRoom();
					}}
				/>
			</Row>
		);

	const items = rows.map((r, i) => {
		let tag = "";
		if (r.inRun) tag = str(LOBBY_STRINGS.inRun);
		else if (r.starting) tag = str(LOBBY_STRINGS.starting);
		else if (r.mine) tag = str(MENU_STRINGS.yourLobby);
		else if (r.hasFriend) tag = str(LOBBY_STRINGS.friend);
		const color = r.inRun ? "uiTextDim" : "uiText";
		return (
			<ListRow key={r.lobbyId} order={i + 1} dim={r.inRun}>
				<Cell order={1} width={MENU_VIEW.nameWidth} color={color} font="name" text={spec(r.title)} />
				<Cell order={2} width={MENU_VIEW.countWidth} color={color} text={spec(r.count)} />
				<Cell order={3} width={MENU_VIEW.tagWidth} color="uiTextDim" text={str(r.visibilityKey)} />
				<Cell order={4} width={MENU_VIEW.tagWidth} color={r.hasFriend ? "uiAccent" : "uiTextDim"} text={tag} />
				<MenuButton
					order={5}
					name={`Join_${r.lobbyId}`}
					size={SMALL}
					textSize={HUD_VIEW.smallText}
					text={str(LOBBY_STRINGS.join)}
					disabled={!r.canJoin}
					onActivated={() => {
						actions.playUi(SFX.uiConfirm);
						actions.joinLobby(r.lobbyId);
					}}
				/>
			</ListRow>
		);
	});

	return (
		<FocusScope
			name="LobbyBrowserScope"
			id="lobbies"
			layer="screen"
			surface="lobbies"
			defaultRef={firstRef}
			memoryKey="lobbies"
			padContext={padContext}
			scrollRef={listRef}
			onPadAction={(action) => {
				if (action.kind === "back") actions.screenBack();
				else if (action.kind === "shortcutX" && action.meaning === "refresh") refresh();
				else if (action.kind === "shortcutY" && action.meaning === "create" && myLobby === undefined) create();
			}}
		>
			<MenuFit
				flex={{ min: MENU_FIT.listMin, max: MENU_VIEW.listHeight }}
				render={(layout) => (
					<Panel
						width={MENU_VIEW.screenWidth}
						padding={HUD_VIEW.pad * 2}
						skin={screenSkin("lobbyBrowser")}
						name="LobbyBrowser"
					>
						<Text
							fill={true}
							order={1}
							size={HUD_VIEW.titleText}
							color="uiAccent"
							text={str(LOBBY_STRINGS.browserTitle)}
						/>
						{top}
						<ScrollList ref={listRef} order={3} height={layout.flex}>
							{items.size() > 0 ? (
								items
							) : (
								<Text
									fill={true}
									key="Empty"
									order={1}
									color="uiTextDim"
									align={Enum.TextXAlignment.Center}
									text={str(LOBBY_STRINGS.empty)}
								/>
							)}
						</ScrollList>
						<Row order={4} align={Enum.HorizontalAlignment.Center}>
							<MenuButton
								order={1}
								name="Refresh"
								size={SMALL}
								textSize={HUD_VIEW.smallText}
								text={str(LOBBY_STRINGS.refresh)}
								onActivated={refresh}
							/>
							<MenuButton
								order={2}
								name="Back"
								size={SMALL}
								textSize={HUD_VIEW.smallText}
								text={str(MENU_STRINGS.back)}
								onActivated={() => {
									actions.playUi(SFX.uiBack);
									actions.back();
								}}
							/>
						</Row>
						{device === "gamepad" ? (
							<PadHintBar order={5} surface="lobbies" context={padContext} />
						) : device === "touch" ? undefined : (
							<Text
								fill={true}
								order={5}
								size={HUD_VIEW.smallText}
								color="uiTextDim"
								align={Enum.TextXAlignment.Center}
								text={str(MENU_STRINGS.backHint, { key: MENU_BACK_HINT[keyDevice(device)] })}
							/>
						)}
					</Panel>
				)}
			/>
		</FocusScope>
	);
}
