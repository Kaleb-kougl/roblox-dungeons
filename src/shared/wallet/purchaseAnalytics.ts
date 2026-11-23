/**
 * What players buy, in one event (docs/SHOP_ANALYTICS.md). Pure builders; the server logs one `Purchase` beside each
 * grant's own telemetry, and nothing grants, refuses or counts from it.
 *
 * Event `Purchase` (WALLET_ANALYTICS_EVENT.purchase):
 *   field01  the kind: upgrade / unlock / cosmetic (the catalogue item's kind), silverPack
 *   field02  the currency paid: silver, or robux (a Robux-only item's game pass, a Silver pack's developer product)
 *   field03  the item: the catalogue id, or a pack's economy SKU `silverPack.<id>`
 *   value    1: a count. Silver spent is the economy Sink and `ArmoryPurchase`; Robux revenue is Roblox's sales data
 *
 * The older events are unchanged: `ArmoryPurchase` (tier, level and price of a Silver purchase, analytics.ts) and
 * `SilverShop` (the pack funnel, shopAnalytics.ts).
 *
 * @module
 */
import type { AnalyticsEventSpec } from "shared/run";
import { WALLET_ANALYTICS_EVENT, silverPackSku } from "./analytics";
import { ARMORY_CATALOG, armoryItem, isRobuxItem, type ArmoryItem, type ArmoryItemKind } from "./catalog";
import { SILVER_PACKS, type SilverPack, type SilverPurchaseGrant } from "./shop";

/** `Purchase`'s field01 for a Silver pack (every other kind is the catalogue item's own). */
export const PURCHASE_KIND_SILVER_PACK = "silverPack";

/** Every field01 value of `Purchase`: the catalogue's item kinds, then the Silver pack. */
export const PURCHASE_KINDS: ReadonlyArray<string> = table.freeze([
	"upgrade",
	"unlock",
	"cosmetic",
	PURCHASE_KIND_SILVER_PACK,
] satisfies Array<ArmoryItemKind | typeof PURCHASE_KIND_SILVER_PACK>);

/** What a purchase was paid with (`Purchase`'s field02). */
export type PurchaseCurrency = "silver" | "robux";

/** Every field02 value of `Purchase`. */
export const PURCHASE_CURRENCIES: ReadonlyArray<PurchaseCurrency> = table.freeze(["silver", "robux"]);

/** The count every `Purchase` carries as its value. */
const PURCHASE_COUNT = 1;

function purchase(kind: string, currency: PurchaseCurrency, item: string): AnalyticsEventSpec {
	return {
		kind: "custom",
		name: WALLET_ANALYTICS_EVENT.purchase,
		value: PURCHASE_COUNT,
		fields: { field01: kind, field02: currency, field03: item },
	};
}

/**
 * The `Purchase` of one catalogue item, bought with Silver in the Armory or granted from its game pass: the kind is
 * the item's own, the currency robux for a Robux-only item and silver for every other. Undefined for an id the
 * catalogue does not know (nothing is logged for it).
 */
export function itemPurchaseEvent(
	itemId: string,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): AnalyticsEventSpec | undefined {
	const it = armoryItem(itemId, catalog);
	if (it === undefined) return undefined;
	return purchase(it.kind, isRobuxItem(it) ? "robux" : "silver", it.id);
}

/** The `Purchase` of one granted Silver pack (Robux; the item is the pack's economy SKU). */
export function packPurchaseEvent(g: Readonly<SilverPurchaseGrant>): AnalyticsEventSpec {
	return purchase(PURCHASE_KIND_SILVER_PACK, "robux", silverPackSku(g.packId));
}

/** Purchase's field value sets (the analytics catalogue counts them). */
export function purchaseFieldValues(
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
	packs: ReadonlyArray<SilverPack> = SILVER_PACKS,
): {
	readonly kinds: ReadonlyArray<string>;
	readonly currencies: ReadonlyArray<string>;
	readonly items: string[];
} {
	const items = catalog.map((i) => i.id);
	for (const p of packs) items.push(silverPackSku(p.id));
	return { kinds: PURCHASE_KINDS, currencies: PURCHASE_CURRENCIES, items };
}
