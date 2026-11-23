// docs/SHOP_ANALYTICS.md PU1: the `Purchase` event's builders. One event per thing bought, labelled from the
// catalogue: its kind, the currency paid and the item.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ARMORY_CATALOG,
	PURCHASE_CURRENCIES,
	PURCHASE_KINDS,
	SILVER_PACK_IDS,
	WALLET_ANALYTICS_EVENT,
	isRobuxItem,
	itemPurchaseEvent,
	packPurchaseEvent,
	purchaseFieldValues,
	silverPackSku,
	type SilverPurchaseGrant,
} from "shared/wallet";

describe("Purchase telemetry (docs/SHOP_ANALYTICS.md)", () => {
	it("every catalogue item: its own kind, robux only for a Robux-only item, its id, a count of 1", () => {
		let robux = 0;
		for (const item of ARMORY_CATALOG) {
			const currency = isRobuxItem(item) ? "robux" : "silver";
			if (currency === "robux") robux++;
			expect(itemPurchaseEvent(item.id)).toEqual({
				kind: "custom",
				name: WALLET_ANALYTICS_EVENT.purchase,
				value: 1,
				fields: { field01: item.kind, field02: currency, field03: item.id },
			});
		}
		// The Prismatic dyes (docs/COSMETICS.md CSD13): the game-pass path has something to label.
		expect(robux > 0).toBe(true);
	});

	it("an id the catalogue does not know logs nothing", () => {
		expect(itemPurchaseEvent("nope")).toBe(undefined);
		expect(itemPurchaseEvent("")).toBe(undefined);
	});

	it("every Silver pack: kind silverPack, robux, the pack's economy SKU", () => {
		for (const packId of SILVER_PACK_IDS) {
			const grant: SilverPurchaseGrant = { purchaseId: "p-1", packId, productId: 1, silver: 150, balance: 150 };
			expect(packPurchaseEvent(grant)).toEqual({
				kind: "custom",
				name: WALLET_ANALYTICS_EVENT.purchase,
				value: 1,
				fields: { field01: "silverPack", field02: "robux", field03: silverPackSku(packId) },
			});
		}
	});

	it("the field value sets: every catalogue kind, both currencies, every item and pack once", () => {
		const values = purchaseFieldValues();
		for (const item of ARMORY_CATALOG) {
			expect(values.kinds.includes(item.kind)).toBe(true);
			expect(values.items.includes(item.id)).toBe(true);
		}
		expect(values.kinds).toBe(PURCHASE_KINDS);
		expect(values.currencies).toBe(PURCHASE_CURRENCIES);
		expect(values.items.size()).toBe(ARMORY_CATALOG.size() + SILVER_PACK_IDS.size());
		expect(new Set(values.items).size()).toBe(values.items.size());
	});
});
