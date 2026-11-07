import React, { useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { Players } from "@rbxts/services";
import { selectLobby, selectLobbyNotices, type LobbyNoticeToast } from "client/store";
import { FocusScope } from "client/ui/focus";
import { MenuButton, PadHintBar, Panel, Row, Text } from "client/ui/hud";
import { role, str, type FontRole } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { HUD_VIEW } from "shared/view/hud";
import {
	LOBBY_STRINGS,
	MENU_STRINGS,
	MENU_VIEW,
	arrivedInviteShown,
	receivedInvites,
	screenSkin,
	type ReceivedInvite,
} from "shared/view/menu";
import { useMenuActions } from "./actions";
import { spec, useClock, useNameOf } from "./hooks";

const HALF = 0.5;
const SMALL = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);

/**
 * The invite toasts on screen now (task L5): the received invites still live (counted from when the list arrived), at
 * most MENU_VIEW.maxInviteToasts, in the server's order (the newest last). MenuLayer reads it once for the toasts and
 * the main menu's Y (docs/GAMEPAD_MENUS.md GM6).
 */
export function useInviteToasts(): ReadonlyArray<ReceivedInvite> {
	const lobby = useSelector(selectLobby);
	const nameOf = useNameOf();
	const now = useClock(lobby.invites.size() > 0);
	return receivedInvites(lobby.invites, now - lobby.invitesAt, nameOf, MENU_VIEW.maxInviteToasts);
}

/**
 * Lobby invites this player received (task L5), top right on the menu screens: "{from} invites you to {lobby}" with
 * Join / Decline, gone once expired. Their own `invites` focus scope (docs/GAMEPAD_MENUS.md GM6, GMD2): never reached
 * by direction from the screen, only through the main menu's Y (`focused`), which selects the newest toast's Join;
 * B (`onLeave`) goes back to the screen, whose memory brings its button back. While focused the hint bar shows under
 * them.
 */
export function InviteToasts(props: { invites: ReadonlyArray<ReceivedInvite>; focused: boolean; onLeave: () => void }) {
	const actions = useMenuActions();
	const newestRef = useRef<TextButton>();
	const invites = props.invites;
	if (invites.size() === 0) return undefined;
	const newest = invites.size() - 1;
	return (
		<FocusScope
			name="InviteToastsScope"
			id="invites"
			layer="invites"
			surface="invites"
			active={props.focused}
			defaultRef={newestRef}
			onPadAction={(action) => {
				if (action.kind !== "back") return;
				actions.playUi(SFX.uiBack);
				props.onLeave();
			}}
		>
			<Panel
				position={new UDim2(1, -HUD_VIEW.margin, 0, MENU_VIEW.inviteToastTop)}
				anchor={new Vector2(1, 0)}
				width={MENU_VIEW.inviteToastWidth}
				transparency={1}
				padding={0}
				name="InviteToasts"
			>
				{invites.map((inv, i) => (
					<Panel
						key={inv.inviteId}
						position={new UDim2()}
						anchor={new Vector2()}
						order={i + 1}
						width={MENU_VIEW.inviteToastWidth}
						transparency={0}
						skin={screenSkin("inviteToast")}
						flatOnly={<uistroke Thickness={1} Color={role("uiAccent")} />}
					>
						<Text
							order={1}
							size={HUD_VIEW.smallText}
							color="uiAccent"
							wrap={true}
							text={str(LOBBY_STRINGS.inviteReceived, { from: inv.from, lobby: spec(inv.title) })}
						/>
						<Row order={2}>
							<MenuButton
								ref={i === newest ? newestRef : undefined}
								order={1}
								name="Join"
								size={SMALL}
								textSize={HUD_VIEW.smallText}
								text={str(LOBBY_STRINGS.inviteAccept)}
								onActivated={() => {
									actions.playUi(SFX.uiConfirm);
									actions.answerInvite(inv.inviteId, true);
								}}
							/>
							<MenuButton
								order={2}
								name="Decline"
								size={SMALL}
								textSize={HUD_VIEW.smallText}
								text={str(LOBBY_STRINGS.inviteDecline)}
								onActivated={() => {
									actions.playUi(SFX.uiClick);
									actions.answerInvite(inv.inviteId, false);
								}}
							/>
						</Row>
					</Panel>
				))}
				{props.focused ? <PadHintBar key="PadHints" order={invites.size() + 1} surface="invites" /> : undefined}
			</Panel>
		</FocusScope>
	);
}

/** During a run: a small "Lobby invites: N" badge (bottom centre); they are answered from the menu screens. */
export function InviteBadge() {
	const lobby = useSelector(selectLobby);
	const nameOf = useNameOf();
	const now = useClock(lobby.invites.size() > 0);
	const count = receivedInvites(lobby.invites, now - lobby.invitesAt, nameOf, lobby.invites.size()).size();
	if (count === 0) return undefined;
	return (
		<Panel
			position={new UDim2(HALF, 0, 1, -MENU_VIEW.badgeBottom)}
			anchor={new Vector2(HALF, 1)}
			skin={screenSkin("inviteBadge")}
			name="InviteBadge"
		>
			<Text
				order={1}
				size={HUD_VIEW.smallText}
				color="uiAccent"
				text={str(MENU_STRINGS.invitesBadge, { count })}
			/>
		</Panel>
	);
}

/** A notice's line: its vars, plus the partyLobby notice's lobby title as `{lobby}`. */
/** A notice that names a player or a lobby (`{name}`, `{host}`, `{lobby}`): shown in the display-name font (LD13). */
function noticeFont(n: LobbyNoticeToast): FontRole {
	const vars = n.vars as Record<string, unknown> | undefined;
	const named = vars !== undefined && (vars.name !== undefined || vars.host !== undefined);
	return n.lobby !== undefined || named ? "name" : "text";
}

function noticeText(n: LobbyNoticeToast): string {
	const lobby = n.lobby;
	return lobby !== undefined ? str(n.key, { ...(n.vars ?? {}), lobby: spec(lobby) }) : str(n.key, n.vars);
}

/**
 * Lobby notices (refusals, kicked, new host, countdown cancelled, Roblox invite arrivals, ...), top centre, a few
 * seconds each. "{name} joined from your invite" carries an Invite button (the normal in-server `lobbyInvite`) while
 * this player is in a lobby that can take them and the friend is here, outside it and not invited yet.
 */
export function NoticeToasts() {
	const notices = useSelector(selectLobbyNotices);
	const lobby = useSelector(selectLobby);
	const actions = useMenuActions();
	if (notices.size() === 0) return undefined;
	const me = Players.LocalPlayer.UserId;
	return (
		<Panel
			position={new UDim2(HALF, 0, 0, MENU_VIEW.noticeTop)}
			anchor={new Vector2(HALF, 0)}
			width={MENU_VIEW.noticeWidth}
			align={Enum.HorizontalAlignment.Center}
			skin={screenSkin("notices")}
			name="LobbyNotices"
		>
			{notices.map((n, i) => {
				const inviteId = n.inviteUserId;
				if (inviteId === undefined || !arrivedInviteShown(inviteId, lobby.mine, lobby.players, me)) {
					return (
						<Text
							key={`n${n.id}`}
							order={i + 1}
							color="uiAccent"
							align={Enum.TextXAlignment.Center}
							wrap={true}
							font={noticeFont(n)}
							text={noticeText(n)}
						/>
					);
				}
				return (
					<Row key={`n${n.id}`} order={i + 1} align={Enum.HorizontalAlignment.Center}>
						<Text order={1} color="uiAccent" font={noticeFont(n)} text={noticeText(n)} />
						<MenuButton
							order={2}
							name={`InviteArrived_${inviteId}`}
							size={SMALL}
							textSize={HUD_VIEW.smallText}
							text={str(LOBBY_STRINGS.inviteSend)}
							onActivated={() => {
								actions.playUi(SFX.uiConfirm);
								actions.invite(inviteId);
							}}
						/>
					</Row>
				);
			})}
		</Panel>
	);
}
