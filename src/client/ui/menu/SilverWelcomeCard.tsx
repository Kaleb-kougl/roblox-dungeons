import React, { useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectDisplay, selectRecordsStatus, selectWallet } from "client/store";
import { FocusScope } from "client/ui/focus";
import { MenuButton, Panel, Text } from "client/ui/hud";
import { SILVER_WELCOME_KEYS } from "shared/theme";
import { SFX } from "shared/view/audio";
import { HUD_VIEW } from "shared/view/hud";
import { MENU_VIEW, screenSkin, silverWelcomeShown } from "shared/view/menu";
import { role, str } from "client/ui/theme";
import { useMenuActions } from "./actions";

/** The card's width (reference px) and its OK button. */
const WIDTH = 420;
const OK = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);
/** Over the main menu's panel (its own ZIndex in the shell's Sibling layering). */
const Z = 5;
const HALF = 0.5;

/**
 * The one-time main-menu card for accounts that played before the Silver update (docs/SILVER.md SV18, OC12): what
 * changed (Silver, the Armory, 2 hearts and the Knight to start). Shown over the main menu while shared/view/menu
 * silverWelcomeShown says so (a loaded wallet that never earned, personal records from before it, not dismissed yet);
 * Got it (or pad B) stores DisplaySettings.silverNoticeSeen, so it never shows again. A `confirm` focus scope: the pad
 * starts on Got it.
 */
export function SilverWelcomeCard() {
	const actions = useMenuActions();
	const wallet = useSelector(selectWallet);
	const records = useSelector(selectRecordsStatus);
	const seen = useSelector(selectDisplay).silverNoticeSeen;
	const okRef = useRef<TextButton>();
	if (!silverWelcomeShown({ wallet, records, seen })) return undefined;
	const dismiss = () => {
		actions.playUi(SFX.uiConfirm);
		actions.dismissSilverWelcome();
	};
	return (
		<FocusScope
			name="SilverWelcomeScope"
			id="silverWelcome"
			layer="confirm"
			surface="confirm"
			defaultRef={okRef}
			onPadAction={(action) => {
				if (action.kind === "cancel" || action.kind === "back") dismiss();
			}}
		>
			<frame key="SilverWelcome" Size={UDim2.fromScale(1, 1)} BackgroundTransparency={1} ZIndex={Z}>
				<Panel
					width={WIDTH}
					align={Enum.HorizontalAlignment.Center}
					skin={screenSkin("mainMenu")}
					name="SilverWelcome"
				>
					<Text
						fill={true}
						order={1}
						wrap={true}
						size={HUD_VIEW.titleText}
						color="uiAccent"
						align={Enum.TextXAlignment.Center}
						text={str(SILVER_WELCOME_KEYS.title)}
					/>
					<Text
						fill={true}
						order={2}
						wrap={true}
						size={HUD_VIEW.smallText}
						align={Enum.TextXAlignment.Center}
						text={str(SILVER_WELCOME_KEYS.body)}
					/>
					<MenuButton
						ref={okRef}
						order={3}
						name="GotIt"
						size={OK}
						textSize={HUD_VIEW.smallText}
						text={str(SILVER_WELCOME_KEYS.ok)}
						onActivated={dismiss}
					/>
				</Panel>
			</frame>
		</FocusScope>
	);
}
