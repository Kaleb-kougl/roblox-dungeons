import React, { useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSilverShop } from "client/store";
import { FocusScope } from "client/ui/focus";
import { MenuButton, MenuFit, Panel, SilverAmount, Text } from "client/ui/hud";
import { UI_IMAGES, role, str, useUiArt } from "client/ui/theme";
import { ROBUX_ICON_ID, SILVER_SHOP_KEYS } from "shared/theme";
import { SFX } from "shared/view/audio";
import { HUD_VIEW, menuButtonSkin, skinHasOf } from "shared/view/hud";
import {
	MENU_VIEW,
	SILVER_SHOP_VIEW,
	screenSkin,
	silverShopCards,
	silverShopLayout,
	type SilverShopCard,
} from "shared/view/menu";
import { shownSilverPacks } from "shared/wallet";
import { useMenuActions } from "./actions";

const HIDDEN = 1;
const STROKE = 1;
const SMALL = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);
const V = SILVER_SHOP_VIEW;

/** One pack's card: its Silver, then one button with Roblox's price (or the pending / grant / unavailable state). */
function Card(props: {
	card: SilverShopCard;
	order: number;
	width: number;
	buttonRef?: React.Ref<TextButton>;
	onPress: () => void;
}) {
	const c = props.card;
	return (
		<frame
			key={`Card_${c.packId}`}
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(props.width, V.cardHeight)}
			BackgroundColor3={role("uiPanel")}
			BorderSizePixel={0}
		>
			<uistroke Thickness={STROKE} Color={role("uiTextDim")} />
			<uipadding
				PaddingTop={new UDim(0, HUD_VIEW.pad)}
				PaddingBottom={new UDim(0, HUD_VIEW.pad)}
				PaddingLeft={new UDim(0, HUD_VIEW.pad)}
				PaddingRight={new UDim(0, HUD_VIEW.pad)}
			/>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			<SilverAmount order={1} text={str(SILVER_SHOP_KEYS.pack, { silver: c.silver })} />
			<MenuButton
				ref={props.buttonRef}
				order={2}
				name={`Buy_${c.packId}`}
				size={new Vector2(props.width - 2 * HUD_VIEW.pad, V.cardButtonHeight)}
				textSize={HUD_VIEW.smallText}
				text={str(c.labelKey, c.labelVars)}
				icon={c.robuxIcon ? ROBUX_ICON_ID : undefined}
				disabled={!c.pressable}
				onActivated={props.onPress}
			/>
		</frame>
	);
}

/**
 * The Get Silver panel (docs/SILVER_SHOP.md SH6), over the screen whose `+` opened it (the main menu or the Armory;
 * MenuLayer mounts it only there): four equal cards, one per shown pack (shared/view/menu silverShopCards: the Silver,
 * then Roblox's price for this player; no ribbon, "best value" or crossed-out price, SHD5), the calm footnote (or, after
 * SILVER_SHOP.pendingNoticeSec without the grant, `Your Silver is on its way`) and Close. A card opens Roblox's own
 * purchase prompt (the prompt is the confirm; while it is up CorePromptGuard keeps the menus off the pad). A `confirm`
 * focus scope over the screen: the pad starts on the first card; B or Close closes, and the screen's focus memory
 * gives the pad back to the `+`. Its dim is an Active button, so mouse / touch never reach the screen under it.
 * Fitted into the safe area like a menu screen (MenuFit); narrow (a portrait phone): one column.
 */
export function GetSilverPanel() {
	const actions = useMenuActions();
	const shop = useSelector(selectSilverShop);
	const firstRef = useRef<TextButton>();
	useUiArt();
	if (!shop.flow.open) return undefined;
	const has = skinHasOf(UI_IMAGES);
	// Roblox's Robux icon beside the price only where the pack has it and the buttons are drawn on their art (the
	// label then drops the word Robux); every bundled pack today: `55 Robux`.
	const robuxIcon = has(ROBUX_ICON_ID) && menuButtonSkin(has, "button", false, false, false) !== undefined;
	const cards = silverShopCards(shownSilverPacks(), shop.prices, shop.flow, os.clock(), robuxIcon);
	const close = () => {
		actions.playUi(SFX.uiBack);
		actions.closeSilverShop();
	};
	return (
		<frame key="GetSilver" Size={UDim2.fromScale(1, 1)} BackgroundTransparency={HIDDEN} ZIndex={V.zIndex}>
			<textbutton
				key="Dim"
				Size={UDim2.fromScale(1, 1)}
				ZIndex={0}
				BackgroundColor3={role("background")}
				BackgroundTransparency={V.dimTransparency}
				BorderSizePixel={0}
				AutoButtonColor={false}
				Selectable={false}
				Active={true}
				Text=""
			/>
			<FocusScope
				name="GetSilverScope"
				id="silverShop"
				layer="confirm"
				surface="confirm"
				defaultRef={firstRef}
				onPadAction={(action) => {
					if (action.kind === "cancel" || action.kind === "back" || action.kind === "close") close();
				}}
			>
				<MenuFit
					render={(fit) => {
						const l = silverShopLayout(fit.narrow);
						const inner = l.width - 4 * HUD_VIEW.pad;
						const rows: SilverShopCard[][] = [];
						cards.forEach((c, i) => {
							const r = math.floor(i / l.columns);
							if (rows[r] === undefined) rows[r] = [];
							rows[r].push(c);
						});
						return (
							<Panel
								width={l.width}
								align={Enum.HorizontalAlignment.Center}
								padding={HUD_VIEW.pad * 2}
								skin={screenSkin("armory")}
								name="GetSilver"
							>
								<Text
									fill={true}
									order={1}
									size={HUD_VIEW.titleText}
									color="uiAccent"
									align={Enum.TextXAlignment.Center}
									text={str(SILVER_SHOP_KEYS.title)}
								/>
								{rows.map((row, r) => (
									<frame
										key={`Row${r}`}
										LayoutOrder={2 + r}
										Size={UDim2.fromOffset(inner, V.cardHeight)}
										BackgroundTransparency={HIDDEN}
									>
										<uilistlayout
											FillDirection={Enum.FillDirection.Horizontal}
											HorizontalAlignment={Enum.HorizontalAlignment.Center}
											SortOrder={Enum.SortOrder.LayoutOrder}
											Padding={new UDim(0, HUD_VIEW.gap)}
										/>
										{row.map((c, i) => (
											<Card
												key={c.packId}
												card={c}
												order={i + 1}
												width={l.cardWidth}
												buttonRef={r === 0 && i === 0 ? firstRef : undefined}
												onPress={() => {
													actions.playUi(SFX.uiConfirm);
													actions.buySilver(c.packId);
												}}
											/>
										))}
									</frame>
								))}
								<Text
									key="Footnote"
									fill={true}
									order={2 + rows.size()}
									wrap={true}
									size={HUD_VIEW.smallText}
									color={shop.notice ? "uiText" : "uiTextDim"}
									align={Enum.TextXAlignment.Center}
									text={str(shop.notice ? SILVER_SHOP_KEYS.onItsWay : SILVER_SHOP_KEYS.footnote)}
								/>
								<MenuButton
									order={3 + rows.size()}
									name="Close"
									size={SMALL}
									textSize={HUD_VIEW.smallText}
									text={str(SILVER_SHOP_KEYS.close)}
									onActivated={close}
								/>
							</Panel>
						);
					}}
				/>
			</FocusScope>
		</frame>
	);
}
