import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectLobby, selectLobbyNotices } from "client/store";
import { MenuButton, Panel, Row, Text } from "client/ui/hud";
import { role, str } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { HUD_VIEW } from "shared/view/hud";
import { LOBBY_STRINGS, MENU_STRINGS, MENU_VIEW, receivedInvites } from "shared/view/menu";
import { useMenuActions } from "./actions";
import { spec, useClock, useNameOf } from "./hooks";

const HALF = 0.5;
const SMALL = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);

/**
 * Lobby invites this player received (task L5), top right on the menu screens: "{from} invites you to {lobby}" with
 * Join / Decline, at most MENU_VIEW.maxInviteToasts, gone once expired (counted from when the list arrived).
 */
export function InviteToasts() {
	const actions = useMenuActions();
	const lobby = useSelector(selectLobby);
	const nameOf = useNameOf();
	const now = useClock(lobby.invites.size() > 0);
	const invites = receivedInvites(lobby.invites, now - lobby.invitesAt, nameOf, MENU_VIEW.maxInviteToasts);
	if (invites.size() === 0) return undefined;
	return (
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
				>
					<uistroke Thickness={1} Color={role("uiAccent")} />
					<Text
						order={1}
						size={HUD_VIEW.smallText}
						color="uiAccent"
						wrap={true}
						text={str(LOBBY_STRINGS.inviteReceived, { from: inv.from, lobby: spec(inv.title) })}
					/>
					<Row order={2}>
						<MenuButton
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
		</Panel>
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

/** Lobby notices (refusals, kicked, new host, countdown cancelled, ...), top centre, a few seconds each. */
export function NoticeToasts() {
	const notices = useSelector(selectLobbyNotices);
	if (notices.size() === 0) return undefined;
	return (
		<Panel
			position={new UDim2(HALF, 0, 0, MENU_VIEW.noticeTop)}
			anchor={new Vector2(HALF, 0)}
			width={MENU_VIEW.noticeWidth}
			align={Enum.HorizontalAlignment.Center}
			name="LobbyNotices"
		>
			{notices.map((n, i) => (
				<Text
					key={`n${n.id}`}
					order={i + 1}
					color="uiAccent"
					align={Enum.TextXAlignment.Center}
					wrap={true}
					text={str(n.key, n.vars)}
				/>
			))}
		</Panel>
	);
}
