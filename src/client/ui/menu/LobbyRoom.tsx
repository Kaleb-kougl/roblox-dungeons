import { keyDevice } from "shared/play";
import React, { useRef, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { Players } from "@rbxts/services";
import { selectInputDevice, selectLobby } from "client/store";
import { FocusScope } from "client/ui/focus";
import { MenuButton, MenuFit, PadHintBar, Panel, Row, Text } from "client/ui/hud";
import { str } from "client/ui/theme";
import { LOBBY_VISIBILITIES, LOBBY_WORLDS, isLobbyWorld } from "shared/lobby";
import { SFX } from "shared/view/audio";
import { HUD_VIEW } from "shared/view/hud";
import {
	LOBBY_STRINGS,
	MENU_BACK_HINT,
	MENU_FIT,
	MENU_STRINGS,
	MENU_VIEW,
	countdownLeft,
	inviteCandidateKey,
	inviteCandidates,
	lobbyRoomModel,
	lobbyRoomParts,
	lobbyVisibilityKey,
	lobbyWorldModel,
	platformInviteButton,
	screenSkin,
} from "shared/view/menu";
import { useMenuActions } from "./actions";
import { spec, useClock, useNameOf } from "./hooks";
import { Cell, ListRow, ScrollList } from "./widgets";

const SMALL = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);
const WIDE = new Vector2(MENU_VIEW.wideButton.x, MENU_VIEW.wideButton.y);

/**
 * The lobby room (task L5): the lobby's name and status (waiting / everyone ready / "Starting in N..." / "Run in
 * progress"), its members in join order (name, host crown, ready tick; the host gets Kick and Make host on the others'
 * rows), the host's controls (visibility Open / Friends / Closed, Rename through the preset names, Start: "Start solo
 * run" when alone, enabled once everyone is ready), and for everyone Ready, Invite (the players in this server outside
 * the lobby; "Invited" while an invite is live) and Leave lobby. Host-only controls are hidden for the others.
 * The invite panel's top row is "Invite friends (Roblox)" (Roblox's invite prompt with this lobby attached,
 * docs/INVITES.md I5; disabled with the reason when the server says this player cannot send invites, and while the
 * lobby cannot take an invite); friends invited that way read "Invited (Roblox)", with their own rows while they are
 * not in this server yet. Fitted into the safe area on touch (MenuFit: the member list is the flexible list); compact
 * (a phone) while inviting, the invite list takes the member list's and the host controls' place (lobbyRoomParts).
 * Beside the members line, the lobby's world (docs/DAILY.md DS9): the host's Endless / Daily toggle while forming (a
 * change clears every Ready, server side), `World: Daily` for the others. A `screen` focus scope with memory
 * (docs/GAMEPAD_MENUS.md GM2): a list refresh (a kick, a leave) that removes the selected row falls back to Ready; B
 * goes back; X toggles Ready and Y opens the Roblox invite prompt (GM6); the right stick scrolls the member list (the
 * invite list where it takes the members' place, GM5); on a gamepad the hint bar replaces the key hint (GM7).
 */
export function LobbyRoom() {
	const actions = useMenuActions();
	const lobby = useSelector(selectLobby);
	const device = useSelector(selectInputDevice);
	const nameOf = useNameOf();
	const [inviting, setInviting] = useState(false);
	const firstRef = useRef<TextButton>();
	const listRef = useRef<ScrollingFrame>();
	const view = lobby.mine;
	const now = useClock(view?.phase === "countdown");
	if (view === undefined) return undefined;

	const me = Players.LocalPlayer.UserId;
	const m = lobbyRoomModel(view, me, nameOf, countdownLeft(view.countdownIn, now - lobby.mineAt));

	const candidates = inviting ? inviteCandidates(lobby.players, view, me, m.canInvite, nameOf) : [];
	const platform = platformInviteButton(lobby.inviteEligible, m.canInvite);

	const memberRows = m.members.map((r, i) => (
		<ListRow key={`m${r.userId}`} order={i + 1}>
			<Cell
				order={1}
				width={MENU_VIEW.nameWidth}
				color={r.me ? "uiAccent" : "uiText"}
				font="name"
				text={r.me ? str(LOBBY_STRINGS.you, { name: r.name }) : r.name}
			/>
			<Cell
				order={2}
				width={MENU_VIEW.countWidth}
				color="uiAccent"
				text={r.host ? str(LOBBY_STRINGS.host) : ""}
			/>
			<Cell
				order={3}
				width={MENU_VIEW.tagWidth}
				color={r.ready ? "uiAccent" : "uiTextDim"}
				text={str(r.ready ? LOBBY_STRINGS.ready : LOBBY_STRINGS.notReady)}
			/>
			{r.canKick ? (
				<MenuButton
					order={4}
					name={`Kick_${r.userId}`}
					size={SMALL}
					textSize={HUD_VIEW.smallText}
					text={str(LOBBY_STRINGS.kick)}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.kick(r.userId);
					}}
				/>
			) : undefined}
			{r.canMakeHost ? (
				<MenuButton
					order={5}
					name={`MakeHost_${r.userId}`}
					size={SMALL}
					textSize={HUD_VIEW.smallText}
					text={str(LOBBY_STRINGS.makeHost)}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.makeHost(r.userId);
					}}
				/>
			) : undefined}
		</ListRow>
	));

	const hostControls = (shown: boolean) =>
		m.isHost && shown ? (
			<Row order={5} align={Enum.HorizontalAlignment.Center}>
				<Text order={1} width={MENU_VIEW.tagWidth} text={str(LOBBY_STRINGS.visibility)} />
				{LOBBY_VISIBILITIES.map((v, i) => (
					<MenuButton
						key={v}
						order={i + 2}
						name={`Vis_${v}`}
						size={SMALL}
						textSize={HUD_VIEW.smallText}
						text={str(lobbyVisibilityKey(v))}
						active={v === m.visibility}
						disabled={!m.canEdit}
						onActivated={() => {
							actions.playUi(SFX.uiClick);
							actions.setVisibility(v);
						}}
					/>
				))}
				<MenuButton
					order={LOBBY_VISIBILITIES.size() + 2}
					name="Rename"
					size={SMALL}
					textSize={HUD_VIEW.smallText}
					text={str(LOBBY_STRINGS.rename)}
					disabled={!m.canEdit}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.rename();
					}}
				/>
			</Row>
		) : undefined;

	// docs/DAILY.md DS9: the lobby's world (Endless / Daily); the host toggles it while forming, the others see it.
	const world = lobbyWorldModel(view.worldKind, LOBBY_WORLDS, m.isHost, view.phase === "forming", str);
	const worldRow = world.toggle ? (
		<>
			<Text key="WorldLabel" order={2} size={HUD_VIEW.smallText} color="uiTextDim" text={world.label} />
			{world.options.map((o, i) => (
				<MenuButton
					key={o.world}
					order={i + 3}
					name={`World_${o.world}`}
					size={SMALL}
					textSize={HUD_VIEW.smallText}
					text={o.text}
					active={o.active}
					disabled={!world.canEdit}
					onActivated={() => {
						if (!isLobbyWorld(o.world) || o.active) return;
						actions.playUi(SFX.uiClick);
						actions.setLobbyWorld(o.world);
					}}
				/>
			))}
		</>
	) : (
		<Text key="World" order={2} size={HUD_VIEW.smallText} color="uiTextDim" text={world.line} />
	);

	const toggleReady = () => {
		actions.playUi(SFX.uiClick);
		actions.setReady(!m.meReady);
	};
	const invitePlatform = () => {
		actions.playUi(SFX.uiConfirm);
		actions.inviteFriendsToLobby();
	};
	// docs/GAMEPAD_MENUS.md GM6: X Ready (while this member can toggle it), Y the Roblox invite prompt (while it can
	// open: the Invite friends (Roblox) button's own action); the right stick scrolls the member list (GM5).
	const padContext = { canReady: m.canReady, canInvite: platform.enabled, scrollList: true };
	const invitePanel = (listHeight: number, scrollTarget: boolean) =>
		inviting ? (
			<Panel
				position={new UDim2()}
				anchor={new Vector2()}
				order={7}
				width={MENU_VIEW.screenWidth - HUD_VIEW.pad * 4}
				skin={screenSkin("lobbyInvites")}
			>
				<Text fill={true} order={1} color="uiAccent" text={str(LOBBY_STRINGS.inviteTitle)} />
				<Row order={2}>
					<MenuButton
						order={1}
						name="InvitePlatform"
						size={WIDE}
						textSize={HUD_VIEW.smallText}
						text={str(LOBBY_STRINGS.invitePlatform)}
						disabled={!platform.enabled}
						onActivated={invitePlatform}
					/>
					{platform.reasonKey !== undefined ? (
						<Text order={2} size={HUD_VIEW.smallText} color="uiTextDim" text={str(platform.reasonKey)} />
					) : undefined}
				</Row>
				<ScrollList ref={scrollTarget ? listRef : undefined} order={3} height={listHeight}>
					{candidates.size() > 0 ? (
						candidates.map((c, i) => (
							<ListRow key={`c${c.userId}`} order={i + 1}>
								<Cell
									order={1}
									width={MENU_VIEW.nameWidth}
									color={c.here ? "uiText" : "uiTextDim"}
									font="name"
									text={c.name}
								/>
								<MenuButton
									order={2}
									name={`Invite_${c.userId}`}
									size={c.platform ? WIDE : SMALL}
									textSize={HUD_VIEW.smallText}
									text={str(inviteCandidateKey(c))}
									disabled={!c.canInvite}
									onActivated={() => {
										actions.playUi(SFX.uiConfirm);
										actions.invite(c.userId);
									}}
								/>
							</ListRow>
						))
					) : (
						<Text fill={true} key="None" order={1} color="uiTextDim" text={str(LOBBY_STRINGS.inviteNone)} />
					)}
				</ScrollList>
			</Panel>
		) : undefined;

	return (
		<FocusScope
			name="LobbyRoomScope"
			id="lobby"
			layer="screen"
			surface="lobby"
			defaultRef={firstRef}
			memoryKey="lobby"
			padContext={padContext}
			scrollRef={listRef}
			onPadAction={(action) => {
				if (action.kind === "back") actions.screenBack();
				else if (action.kind === "shortcutX" && action.meaning === "ready" && m.canReady) toggleReady();
				else if (action.kind === "shortcutY" && action.meaning === "invite" && platform.enabled) {
					invitePlatform();
				}
			}}
		>
			<MenuFit
				flex={{ min: MENU_FIT.listMin, max: MENU_VIEW.listHeight }}
				render={(layout) => {
					// Compact (a phone) while inviting: the invite list takes the member list's place (and its height).
					const parts = lobbyRoomParts(layout.compact, inviting);
					return (
						<Panel
							width={MENU_VIEW.screenWidth}
							padding={HUD_VIEW.pad * 2}
							skin={screenSkin("lobbyRoom")}
							name="LobbyRoom"
						>
							<Text
								fill={true}
								order={1}
								size={HUD_VIEW.titleText}
								color="uiAccent"
								font="name"
								text={spec(m.title)}
							/>
							<Text
								fill={true}
								order={2}
								color={m.inRun ? "uiTextDim" : "uiText"}
								text={spec(m.status)}
							/>
							<Row key="MembersWorld" order={3}>
								<Text
									order={1}
									size={HUD_VIEW.smallText}
									color="uiTextDim"
									text={spec(m.membersLine)}
								/>
								{worldRow}
							</Row>
							{parts.members ? (
								<ScrollList ref={listRef} order={4} height={layout.flex}>
									{memberRows}
								</ScrollList>
							) : undefined}
							{hostControls(parts.hostControls)}
							<Row order={6} align={Enum.HorizontalAlignment.Center}>
								<MenuButton
									ref={firstRef}
									order={1}
									name="Ready"
									size={SMALL}
									textSize={HUD_VIEW.smallText}
									text={str(m.meReady ? LOBBY_STRINGS.unready : LOBBY_STRINGS.readyUp)}
									active={m.meReady}
									disabled={!m.canReady}
									onActivated={toggleReady}
								/>
								<MenuButton
									order={2}
									name="Invite"
									size={SMALL}
									textSize={HUD_VIEW.smallText}
									text={str(LOBBY_STRINGS.invite)}
									active={inviting}
									onActivated={() => {
										actions.playUi(SFX.uiClick);
										setInviting(!inviting);
									}}
								/>
								{m.isHost ? (
									<MenuButton
										order={3}
										name="Start"
										size={WIDE}
										textSize={HUD_VIEW.smallText}
										text={str(m.startKey)}
										disabled={!m.canStart}
										onActivated={() => {
											actions.playUi(SFX.uiConfirm);
											actions.startLobby();
										}}
									/>
								) : undefined}
								<MenuButton
									order={4}
									name="Leave"
									size={SMALL}
									textSize={HUD_VIEW.smallText}
									text={str(LOBBY_STRINGS.leave)}
									onActivated={() => {
										actions.playUi(SFX.uiClick);
										actions.leaveLobby();
									}}
								/>
								<MenuButton
									order={5}
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
							{invitePanel(parts.members ? MENU_VIEW.inviteListHeight : layout.flex, !parts.members)}
							{device === "gamepad" ? (
								<PadHintBar order={8} surface="lobby" context={padContext} />
							) : device === "touch" ? undefined : (
								<Text
									fill={true}
									order={8}
									size={HUD_VIEW.smallText}
									color="uiTextDim"
									align={Enum.TextXAlignment.Center}
									text={str(MENU_STRINGS.backHint, { key: MENU_BACK_HINT[keyDevice(device)] })}
								/>
							)}
						</Panel>
					);
				}}
			/>
		</FocusScope>
	);
}
