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

/**
 * The Silver shop's slice (state: `SilverShopState`). SilverShopController writes it: each step of the panel's flow,
 * Roblox's pack prices (one at a time or the whole map) and the on-its-way notice. A flow with no pending purchase
 * clears the notice.
 */
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

/**
 * The Get Silver panel's whole state: its flow, the Robux price per pack (an empty map until the first open read them)
 * and whether the `Your Silver is on its way` notice shows.
 */
export const selectSilverShop = (state: { silverShop: SilverShopState }) => state.silverShop;
/**
 * The Get Silver panel's flow: open or not, which balance opened it, the purchase pending and the grant shown on its
 * card (each undefined when there is none). `SILVER_SHOP_IDLE` until the first open.
 */
export const selectSilverShopFlow = (state: { silverShop: SilverShopState }) => state.silverShop.flow;
/**
 * The Get Silver panel is open (false at start). The menu layer reads it to close the panel when the menu leaves the
 * two screens it lives over (the main menu and the Armory).
 */
export const selectSilverShopOpen = (state: { silverShop: SilverShopState }) => state.silverShop.flow.open;
