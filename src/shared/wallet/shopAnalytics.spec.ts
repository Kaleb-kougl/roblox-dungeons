// docs/SILVER_SHOP.md SH7: the shop's telemetry builders. One IAP Source per granted pack, the SilverShop event's
// steps, and the client report re-read on the server.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	SILVER_SHOP,
	WALLET_ANALYTICS_EVENT,
	economySkus,
	readSilverShopReport,
	silverPackEconomyEvent,
	silverPackSku,
	silverShopGrantedEvent,
	silverShopReportEvent,
	type SilverPurchaseGrant,
} from "shared/wallet";

const GRANT: SilverPurchaseGrant = { purchaseId: "p-1", packId: "purse", productId: 3002, silver: 450, balance: 610 };

describe("Silver shop telemetry (SH7)", () => {
	it("one IAP Source per granted pack, ending at the grant's balance", () => {
		expect(silverPackEconomyEvent(GRANT)).toEqual({
			flow: "Source",
			currency: "Silver",
			amount: 450,
			endingBalance: 610,
			transactionType: "IAP",
			itemSku: "silverPack.purse",
		});
	});

	it("every pack's SKU is an economy SKU", () => {
		const skus = economySkus();
		for (const id of ["pouch", "purse", "chest", "hoard"] as const)
			expect(skus.includes(silverPackSku(id))).toBe(true);
	});

	it("the server's `granted` event: field01 granted, field03 the pack, value the Silver", () => {
		expect(silverShopGrantedEvent(GRANT)).toEqual({
			kind: "custom",
			name: WALLET_ANALYTICS_EVENT.silverShop,
			value: 450,
			fields: { field01: "granted", field03: "purse" },
		});
	});

	it("re-reads a client report: steps, source, pack where the step needs one, seconds rounded and clamped", () => {
		expect(readSilverShopReport({ step: "opened", from: "mainMenu" })).toEqual({
			step: "opened",
			from: "mainMenu",
		});
		expect(readSilverShopReport({ step: "opened", from: "mainMenu", pack: "nope" })).toEqual({
			step: "opened",
			from: "mainMenu",
		});
		expect(readSilverShopReport({ step: "prompted", from: "armory", pack: "chest" })).toEqual({
			step: "prompted",
			from: "armory",
			pack: "chest",
		});
		const settled = readSilverShopReport({ step: "settled", from: "armory", pack: "chest", seconds: 1.234 });
		expect(settled?.seconds).toBeCloseTo(1.2);
		expect(readSilverShopReport({ step: "settled", from: "armory", pack: "chest", seconds: 1e9 })?.seconds).toBe(
			SILVER_SHOP.maxReportSeconds,
		);
	});

	it("refuses a report whole on any bad field", () => {
		for (const bad of [
			undefined,
			"opened",
			{ step: "granted", from: "armory", pack: "pouch" },
			{ step: "opened", from: "lobby" },
			{ step: "prompted", from: "armory" },
			{ step: "bought", from: "armory", pack: "diamonds" },
			{ step: "settled", from: "armory", pack: "pouch" },
			{ step: "settled", from: "armory", pack: "pouch", seconds: -1 },
			{ step: "settled", from: "armory", pack: "pouch", seconds: 0 / 0 },
		]) {
			expect(readSilverShopReport(bad)).toBe(undefined);
		}
	});

	it("a report's event: field01 the step, field02 the source, field03 the pack; value seconds or 1", () => {
		expect(silverShopReportEvent({ step: "cancelled", from: "armory", pack: "hoard" })).toEqual({
			kind: "custom",
			name: "SilverShop",
			value: 1,
			fields: { field01: "cancelled", field02: "armory", field03: "hoard" },
		});
		const e = silverShopReportEvent({ step: "settled", from: "mainMenu", pack: "pouch", seconds: 2.5 });
		expect(e.kind === "custom" ? e.value : undefined).toBe(2.5);
	});
});
