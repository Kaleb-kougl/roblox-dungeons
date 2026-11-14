import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectWallet } from "client/store";
import { MenuButton, SilverAmount } from "client/ui/hud";
import { str } from "client/ui/theme";
import { SILVER_SHOP_KEYS } from "shared/theme";
import { SFX } from "shared/view/audio";
import { HUD_VIEW } from "shared/view/hud";
import { SILVER_SHOP_VIEW, silverShopEntryShown } from "shared/view/menu";
import type { SilverShopFrom } from "shared/wallet";
import { useMenuActions } from "./actions";

const HIDDEN = 1;
const PLUS = new Vector2(SILVER_SHOP_VIEW.plus.x, SILVER_SHOP_VIEW.plus.y);

/**
 * A Silver balance (the Armory's header, the main menu's Silver line) with the Silver shop's quiet `+` beside it
 * (docs/SILVER_SHOP.md SH6, owner OC3): a small square button, the same look as every small menu button, never
 * animated or badged (SHD5), shown only while shared/view/menu silverShopEntryShown (a loaded wallet, the shop on).
 * It opens the Get Silver panel over this screen; B there returns the pad to it (the screen's focus memory).
 */
export function SilverBalance(props: { order: number; from: SilverShopFrom; text: string; size?: number }) {
	const actions = useMenuActions();
	const wallet = useSelector(selectWallet);
	const plus = silverShopEntryShown(wallet);
	return (
		<frame
			key="SilverBalance"
			LayoutOrder={props.order}
			Size={new UDim2()}
			AutomaticSize={Enum.AutomaticSize.XY}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			<SilverAmount order={1} size={props.size} text={props.text} />
			{plus ? (
				<MenuButton
					key="GetSilver"
					order={2}
					name={`GetSilver_${props.from}`}
					size={PLUS}
					textSize={HUD_VIEW.smallText}
					text={str(SILVER_SHOP_KEYS.open)}
					onActivated={() => {
						actions.playUi(SFX.uiClick);
						actions.openSilverShop(props.from);
					}}
				/>
			) : undefined}
		</frame>
	);
}
