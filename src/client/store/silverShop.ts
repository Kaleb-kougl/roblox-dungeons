import { createProducer } from "@rbxts/reflex";
import { SILVER_SHOP_IDLE, type SilverShopFlow, type SilverShopPrice } from "shared/view/menu";
import type { SilverPackId } from "shared/wallet";

/**
 * Client-local Reflex slice for the Silver shop (docs/SILVER_SHOP.md SH5): the Get Silver panel's flow (open, where
 * from, the pending purchase, the grant shown on its card; shared/view/menu SilverShopFlow), the Robux prices Roblox
 * gave this player (read once per session on the first open) and whether `Your Silver is on its way` shows.
 * SilverShopController is its only writer; GetSilverPanel and the `+` beside each Silver balance read it. Whether the
 * `+` shows is the wallet push's (shared/view/menu silverShopEntryShown), not this slice's. Dispatched rarely (an open,
 * a press, a prompt closing, a grant, a price read), never per frame.
 */
export interface SilverShopState {
	readonly flow: SilverShopFlow;
	/** Roblox's price per shown pack (or Studio's fake prices); empty until the first open read them. */
	readonly prices: ReadonlyMap<SilverPackId, SilverShopPrice>;
	/** The bought purchase has waited SILVER_SHOP.pendingNoticeSec for its grant. */
	readonly notice: boolean;
}

const initialState: SilverShopState = {
	flow: SILVER_SHOP_IDLE,
	prices: new Map(),
	notice: false,
};

export const silverShopSlice = createProducer(initialState, {
	setSilverShopFlow: (state, flow: SilverShopFlow): SilverShopState =>
		state.flow === flow ? state : { ...state, flow, notice: flow.pending === undefined ? false : state.notice },
	setSilverShopPrice: (state, packId: SilverPackId, price: SilverShopPrice): SilverShopState => {
		const prices = new Map<SilverPackId, SilverShopPrice>();
		for (const [k, v] of state.prices) prices.set(k, v);
		prices.set(packId, price);
		return { ...state, prices };
	},
	setSilverShopPrices: (state, prices: ReadonlyMap<SilverPackId, SilverShopPrice>): SilverShopState => ({
		...state,
		prices,
	}),
	setSilverShopNotice: (state, notice: boolean): SilverShopState =>
		state.notice === notice ? state : { ...state, notice },
});

export const selectSilverShop = (state: { silverShop: SilverShopState }) => state.silverShop;
export const selectSilverShopFlow = (state: { silverShop: SilverShopState }) => state.silverShop.flow;
export const selectSilverShopOpen = (state: { silverShop: SilverShopState }) => state.silverShop.flow.open;
