/**
 * Roblox port (docs/SILVER_SHOP.md SH4): the theme's Silver shop keys: every string the Get Silver panel and the `+`
 * beside a Silver balance need. Pure data with no runtime import, like silver.ts: contract.ts sits near Luau's
 * 200-locals limit, so it spreads silverShopStringKeys() LAST inside REQUIRED_STRING_KEYS' function (one import, no
 * other top-level local). No sounds of its own (a grant plays sfx.silver.gain, SHOP_BUY_SOUND's neighbour) and no
 * colour role (the Silver role and the menu roles).
 *
 * The string keys are built inside a function (silverShopStringKeys) so this module adds one top-level local to the
 * compiled Luau of any module that spreads it.
 */

/** The Get Silver panel's and the `+` button's strings. */
export const SILVER_SHOP_KEYS = {
	/** `Get Silver`: the panel's title. */
	title: "silver.shop.title",
	/** `+`: the small button beside a Silver balance (the Armory's header, the main menu) that opens the panel. */
	open: "silver.shop.open",
	/** `{silver} Silver`: a pack's amount on its card. */
	pack: "silver.shop.pack",
	/** `{robux} Robux`: a card's price (Roblox's price for this player), without Roblox's Robux icon. */
	price: "silver.shop.price",
	/** `{robux}`: a card's price beside Roblox's Robux icon (ROBUX_ICON_ID, when the pack has it). */
	priceIcon: "silver.shop.priceIcon",
	/** `...`: the price is still being read from Roblox. */
	loading: "silver.shop.loading",
	/** `Unavailable`: the price could not be read (offline); the card cannot be pressed. */
	unavailable: "silver.shop.unavailable",
	/** `Adding Silver...`: bought, the grant is on its way. */
	adding: "silver.shop.adding",
	/** `+{silver} Silver`: the grant landed (on the card, or as a toast with the panel closed). */
	added: "silver.shop.added",
	/** `Your Silver is on its way`: the grant has not landed after SILVER_SHOP.pendingNoticeSec. */
	onItsWay: "silver.shop.onItsWay",
	/** The footnote under the cards. */
	footnote: "silver.shop.footnote",
	/** `Close`. */
	close: "silver.shop.close",
} as const;

/** Every Silver shop string a pack must define (REQUIRED_STRING_KEYS, its last ones after Silver's), sorted. */
export function silverShopStringKeys(): string[] {
	const out: string[] = [];
	for (const [, k] of pairs(SILVER_SHOP_KEYS)) out.push(k);
	out.sort();
	return out;
}

/** SILVER_SHOP_STRING_KEYS, sorted (a stable order: a key table's pairs order is not). */
export const SILVER_SHOP_STRING_KEYS: ReadonlyArray<string> = silverShopStringKeys();

/**
 * Roblox's Robux icon beside a price (optional free-form ui id, like `ui.icon.silver`). Absent (every bundled pack
 * today): the price reads `{robux} Robux`.
 */
export const ROBUX_ICON_ID = "ui.icon.robux";
