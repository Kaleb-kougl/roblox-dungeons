/**
 * Silver's telemetry (docs/SILVER.md SV10), pure builders; TelemetryService logs them (AnalyticsService, published
 * places only).
 *
 *   grant     one economy Source per non-zero part of a grant, in order: the run rows (itemSku = the row's name,
 *             transactionType Gameplay), Prospector and the minimum's top-up (Gameplay), the first-run and Daily
 *             bonuses (TimedReward). Each event's ending balance is the balance after it (the grant's starting balance
 *             plus everything so far), so the last equals the grant's `balance`.
 *   purchase  one economy Sink (itemSku = the catalogue id, transactionType Shop) and one `ArmoryPurchase` custom
 *             event (value = the price; field01 the item, field02 its tier, field03 the level bought).
 *   pack      (docs/SILVER_SHOP.md SH7) one economy Source per granted Silver pack (itemSku `silverPack.<id>`,
 *             transactionType IAP, apart from Gameplay / TimedReward) and one `SilverShop` custom event, step `granted`
 *             (shopAnalytics.ts holds the funnel's client steps).
 *
 * Roblox's limits: amount > 0, ending balance >= 0, 5 currency types (Silver is one), 20 transaction types, about 100
 * SKUs (ECONOMY_SKUS; analytics.spec holds them under it).
 *
 * @module
 */
import type { AnalyticsEventSpec } from "shared/run";
import { SILVER_ROWS } from "shared/silver";
import { ARMORY_CATALOG, ARMORY_TIERS, type ArmoryItem } from "./catalog";
import { SILVER_PACKS, type SilverPack, type SilverPackId, type SilverPurchaseGrant } from "./shop";
import type { SilverGrantBreakdown, WalletPurchase } from "./transforms";

/** The currency's name in the economy events. */
export const SILVER_CURRENCY = "Silver";

/** AnalyticsService economy transaction types (the `Enum.AnalyticsEconomyTransactionType` names Silver uses). */
export type EconomyTransactionType = "Gameplay" | "TimedReward" | "Shop" | "IAP";

/** One `AnalyticsService:LogEconomyEvent` call. */
export interface EconomyEventSpec {
	readonly flow: "Source" | "Sink";
	readonly currency: string;
	readonly amount: number;
	readonly endingBalance: number;
	readonly transactionType: EconomyTransactionType;
	readonly itemSku: string;
}

/** The grant SKUs past the run rows (never a catalogue id: `prospector` is the item, `prospectorBonus` its Silver). */
export const GRANT_SKU = table.freeze({
	prospector: "prospectorBonus",
	topUp: "runMinimum",
	firstRunBonus: "firstRunBonus",
	dailyBonus: "dailyBonus",
});

/** The Armory's and the Silver shop's custom events. */
export const WALLET_ANALYTICS_EVENT = table.freeze({ armoryPurchase: "ArmoryPurchase", silverShop: "SilverShop" });

/** A Silver pack's economy SKU. */
export function silverPackSku(id: SilverPackId): string {
	return `silverPack.${id}`;
}

/** ArmoryPurchase's field02 / field03 values. */
export function tierLabel(tier: number): string {
	return `tier${tier}`;
}

export function levelLabel(level: number): string {
	return `level${level}`;
}

/** Every SKU Silver's economy events may carry: the run rows, the grant parts, every catalogue item, every pack. */
export function economySkus(
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
	packs: ReadonlyArray<SilverPack> = SILVER_PACKS,
): string[] {
	const out: string[] = [...SILVER_ROWS];
	out.push(GRANT_SKU.prospector, GRANT_SKU.topUp, GRANT_SKU.firstRunBonus, GRANT_SKU.dailyBonus);
	for (const i of catalog) out.push(i.id);
	for (const p of packs) out.push(silverPackSku(p.id));
	return out;
}

/** ArmoryPurchase's field value sets (the analytics catalogue counts them). */
export function armoryPurchaseFieldValues(catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG): {
	readonly items: string[];
	readonly tiers: string[];
	readonly levels: string[];
} {
	const items = catalog.map((i) => i.id);
	const tiers: string[] = [];
	for (let t = 1; t <= ARMORY_TIERS.size(); t++) tiers.push(tierLabel(t));
	let most = 0;
	for (const i of catalog) most = math.max(most, i.tiers.size());
	const levels: string[] = [];
	for (let l = 1; l <= most; l++) levels.push(levelLabel(l));
	return { items, tiers, levels };
}

/** The Source events of one grant (module comment). */
export function grantEconomyEvents(b: Readonly<SilverGrantBreakdown>): EconomyEventSpec[] {
	const out: EconomyEventSpec[] = [];
	let balance = math.max(0, b.balance - b.total);
	const add = (amount: number, sku: string, transactionType: EconomyTransactionType) => {
		if (amount <= 0) return;
		balance += amount;
		out.push({
			flow: "Source",
			currency: SILVER_CURRENCY,
			amount,
			endingBalance: balance,
			transactionType,
			itemSku: sku,
		});
	};
	for (const r of b.rows) add(r.silver, r.row, "Gameplay");
	add(b.prospector, GRANT_SKU.prospector, "Gameplay");
	add(b.topUp, GRANT_SKU.topUp, "Gameplay");
	add(b.firstRunBonus, GRANT_SKU.firstRunBonus, "TimedReward");
	add(b.dailyBonus, GRANT_SKU.dailyBonus, "TimedReward");
	return out;
}

/** The Sink event of one purchase. */
export function purchaseEconomyEvent(p: Readonly<WalletPurchase>): EconomyEventSpec {
	return {
		flow: "Sink",
		currency: SILVER_CURRENCY,
		amount: p.price,
		endingBalance: math.max(0, p.balance),
		transactionType: "Shop",
		itemSku: p.itemId,
	};
}

/** The `ArmoryPurchase` custom event of one purchase. */
export function armoryPurchaseEvent(p: Readonly<WalletPurchase>): AnalyticsEventSpec {
	return {
		kind: "custom",
		name: WALLET_ANALYTICS_EVENT.armoryPurchase,
		value: p.price,
		fields: { field01: p.itemId, field02: tierLabel(p.tier), field03: levelLabel(p.level) },
	};
}

/** The Source event of one granted Silver pack (IAP; its ending balance is the grant's). */
export function silverPackEconomyEvent(g: Readonly<SilverPurchaseGrant>): EconomyEventSpec {
	return {
		flow: "Source",
		currency: SILVER_CURRENCY,
		amount: g.silver,
		endingBalance: math.max(0, g.balance),
		transactionType: "IAP",
		itemSku: silverPackSku(g.packId),
	};
}

/** One economy event as a log line (TelemetryService's debug echo). */
export function describeEconomyEvent(e: Readonly<EconomyEventSpec>): string {
	return `economy ${e.flow} ${e.currency} ${e.amount} -> ${e.endingBalance} ${e.transactionType} ${e.itemSku}`;
}
