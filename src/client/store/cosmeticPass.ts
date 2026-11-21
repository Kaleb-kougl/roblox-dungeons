import { createProducer } from "@rbxts/reflex";
import type { CosmeticRobuxPrice } from "shared/view/menu";

/**
 * Client-local Reflex slice for the Robux-only cosmetics (docs/COSMETICS.md CSD13: every animated cosmetic, sold through
 * a Roblox game pass): Roblox's price of each one for this player (read once per session, when the Armory first shows
 * the Cosmetics tab), the item whose purchase prompt is up or whose grant is awaited, and the last grant (the Armory
 * stamps its row). CosmeticPassController is its only writer; ArmoryScreen reads it. Dispatched rarely.
 */
export interface CosmeticPassState {
	/** Roblox's price per Robux-only item on sale here (or Studio's fake price); empty until read. */
	readonly prices: ReadonlyMap<string, CosmeticRobuxPrice>;
	/** The item being bought (prompt up, or bought and its grant not in yet), else undefined. */
	readonly pending: string | undefined;
	/** The last item granted from its pass after a purchase, and a serial bumped with each one. */
	readonly granted: { readonly itemId: string; readonly serial: number } | undefined;
}

const initialState: CosmeticPassState = { prices: new Map(), pending: undefined, granted: undefined };

/**
 * The Robux-only cosmetics slice (state: `CosmeticPassState`). CosmeticPassController writes it: a price as Roblox
 * answers for an item, the item whose purchase is pending, and each grant, which clears the pending item when it is the
 * one granted and bumps the grant serial. Nothing resets it within a session.
 */
export const cosmeticPassSlice = createProducer(initialState, {
	setCosmeticPassPrice: (state, itemId: string, price: CosmeticRobuxPrice): CosmeticPassState => {
		const prices = new Map<string, CosmeticRobuxPrice>();
		for (const [k, v] of state.prices) prices.set(k, v);
		prices.set(itemId, price);
		return { ...state, prices };
	},
	setCosmeticPassPending: (state, itemId: string | undefined): CosmeticPassState =>
		state.pending === itemId ? state : { ...state, pending: itemId },
	cosmeticPassGranted: (state, itemId: string): CosmeticPassState => ({
		...state,
		pending: state.pending === itemId ? undefined : state.pending,
		granted: { itemId, serial: (state.granted?.serial ?? 0) + 1 },
	}),
});

/**
 * The whole Robux-only cosmetics state for the Armory's Cosmetics tab: the prices read so far (an empty map before the
 * read), the item being bought (undefined: none) and the last grant with its serial (undefined: none this session).
 */
export const selectCosmeticPass = (state: { cosmeticPass: CosmeticPassState }) => state.cosmeticPass;
