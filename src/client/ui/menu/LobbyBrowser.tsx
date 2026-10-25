import React, { useRef, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectInputDevice, selectLobbyList, selectMyLobbyId } from "client/store";
import { MenuButton, Panel, Row, Text } from "client/ui/hud";
import { str } from "client/ui/theme";
import { LOBBY, LOBBY_VISIBILITIES, type LobbyVisibility } from "shared/lobby";
import { SFX } from "shared/view/audio";
import { HUD_VIEW } from "shared/view/hud";
import {
	LOBBY_STRINGS,
	MENU_BACK_HINT,
	MENU_STRINGS,
	MENU_VIEW,
	browserRows,
	lobbyVisibilityKey,
} from "shared/view/menu";
import { useMenuActions } from "./actions";
import { spec, useGamepadFocus, useNameOf } from "./hooks";
import { Cell, ListRow, ScrollList } from "./widgets";

const HALF = 0.5;
const SMALL = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);
const WIDE = new Vector2(MENU_VIEW.wideButton.x, MENU_VIEW.wideButton.y);

/**
 * The lobby browser (task L5): the lobbies this player may see (the server's `lobbyList`, never closed ones), each
 * row with its preset name ("{host}'s descent"), count / max, Open / Friends, a friend marker, Starting / In run
 * (greyed, no Join) and Join. The top bar creates a lobby with the picked visibility (Open / Friends / Closed); while
 * in a lobby it offers "Your lobby" instead (Join is off: leave yours first). Refresh asks the server again.
 */
export function LobbyBrowser() {
	const actions = useMenuActions();
	const list = useSelector(selectLobbyList);
	const myLobby = useSelector(selectMyLobbyId);
	const device = useSelector(selectInputDevice);
	const nameOf = useNameOf();
	const [visibility, setVisibility] = useState<LobbyVisibility>(LOBBY.defaultVisibility);
	const firstRef = useRef<TextButton>();
	useGamepadFocus(firstRef, "lobbies");
	const rows = browserRows(list, myLobby, nameOf);

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
					onActivated={() => {
						actions.playUi(SFX.uiConfirm);
						actions.createLobby(visibility);
					}}
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
				<Cell order={1} width={MENU_VIEW.nameWidth} color={color} text={spec(r.title)} />
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
		<Panel
			position={UDim2.fromScale(HALF, HALF)}
			anchor={new Vector2(HALF, HALF)}
			width={MENU_VIEW.screenWidth}
			padding={HUD_VIEW.pad * 2}
			name="LobbyBrowser"
		>
			<Text order={1} size={HUD_VIEW.titleText} color="uiAccent" text={str(LOBBY_STRINGS.browserTitle)} />
			{top}
			<ScrollList order={3} height={MENU_VIEW.listHeight}>
				{items.size() > 0 ? (
					items
				) : (
					<Text
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
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.refreshLobbies();
					}}
				/>
				<MenuButton
					order={2}
					name="Back"
					size={SMALL}
					textSize={HUD_VIEW.smallText}
					text={str(MENU_STRINGS.back)}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.back();
					}}
				/>
			</Row>
			<Text
				order={5}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Center}
				text={str(MENU_STRINGS.backHint, { key: MENU_BACK_HINT[device] })}
			/>
		</Panel>
	);
}
