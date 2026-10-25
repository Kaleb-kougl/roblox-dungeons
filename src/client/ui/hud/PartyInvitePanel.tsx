import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectPartyInvite } from "client/store";
import { str } from "client/ui/theme";
import { SFX } from "shared/view/audio";
import { HUD_VIEW, PARTY_STRINGS } from "shared/view/hud";
import { useHudActions } from "./actions";
import { MenuButton, Panel, Row, Text } from "./primitives";

const HALF = 0.5;
const BUTTON = new Vector2(HUD_VIEW.partyButtonSize.x, HUD_VIEW.partyButtonSize.y);

/**
 * Co-op consent (M4): a party invite waiting for this player's answer, with Join / Decline. The party run only starts
 * once every invited player joined (the server enforces it); declining cancels it for everyone. Hidden otherwise.
 */
export function PartyInvitePanel() {
	const invite = useSelector(selectPartyInvite);
	const actions = useHudActions();
	if (invite === undefined) return undefined;
	return (
		<Panel
			position={new UDim2(HALF, 0, 0, HUD_VIEW.partyInviteTop)}
			anchor={new Vector2(HALF, 0)}
			width={HUD_VIEW.panelWidth}
			align={Enum.HorizontalAlignment.Center}
			name="PartyInvite"
		>
			<Text
				order={1}
				color="uiAccent"
				align={Enum.TextXAlignment.Center}
				wrap={true}
				text={str(PARTY_STRINGS.invited, { host: invite.hostName, count: invite.count })}
			/>
			<Text
				order={2}
				size={HUD_VIEW.smallText}
				align={Enum.TextXAlignment.Center}
				text={str(PARTY_STRINGS.accepted, { accepted: invite.accepted, count: invite.count })}
			/>
			<Row order={3} align={Enum.HorizontalAlignment.Center}>
				<MenuButton
					order={1}
					name="Join"
					size={BUTTON}
					text={str(PARTY_STRINGS.accept)}
					onActivated={() => {
						actions.playUi(SFX.uiConfirm);
						actions.answerPartyInvite(true);
					}}
				/>
				<MenuButton
					order={2}
					name="Decline"
					size={BUTTON}
					text={str(PARTY_STRINGS.decline)}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.answerPartyInvite(false);
					}}
				/>
			</Row>
		</Panel>
	);
}
