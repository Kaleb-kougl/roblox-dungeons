import { describe, expect, it } from "@rbxts/jest-globals";
import { SILVER_ROWS, emptySilverRunInput, runSilver } from "shared/silver";
import {
	GRANT_SKU,
	SILVER_CURRENCY,
	WALLET_ANALYTICS_EVENT,
	applyBuy,
	applyGrant,
	armoryPurchaseEvent,
	armoryPurchaseFieldValues,
	economySkus,
	emptyWalletDoc,
	grantEconomyEvents,
	purchaseEconomyEvent,
} from "shared/wallet";

/** Roblox's economy limits. */
const MAX_SKUS = 100;

describe("Silver economy events (SV10)", () => {
	it("one Source per non-zero grant row, amounts > 0, ending balances >= 0 ending at the grant's balance", () => {
		const doc = emptyWalletDoc();
		doc.earned = 30;
		doc.own.set("prospector", 1);
		const run = runSilver({ ...emptySilverRunInput(), roomsCleared: 3, floor: 2, kills: 25 });
		const r = applyGrant(doc, { runId: "a", run, daily: true }, { day: 5, dailyDay: 5 });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const events = grantEconomyEvents(r.breakdown);
		// rooms 6, floors 6, kills 2 -> sum 14; Prospector 0; top-up 6; both bonuses
		expect(events.map((e) => `${e.itemSku}:${e.amount}:${e.transactionType}`)).toEqual([
			"rooms:6:Gameplay",
			"floors:6:Gameplay",
			"kills:2:Gameplay",
			`${GRANT_SKU.topUp}:6:Gameplay`,
			`${GRANT_SKU.firstRunBonus}:50:TimedReward`,
			`${GRANT_SKU.dailyBonus}:50:TimedReward`,
		]);
		let last = 30;
		for (const e of events) {
			expect(e.flow).toBe("Source");
			expect(e.currency).toBe(SILVER_CURRENCY);
			expect(e.amount > 0).toBe(true);
			expect(e.endingBalance).toBe(last + e.amount);
			last = e.endingBalance;
		}
		expect(last).toBe(r.breakdown.balance);
	});

	it("a grant of nothing logs nothing", () => {
		const doc = emptyWalletDoc();
		doc.runDay = 5;
		const r = applyGrant(doc, { runId: "a", run: runSilver(emptySilverRunInput()), daily: false }, { day: 5 });
		expect(r.ok).toBe(true);
		if (r.ok) expect(grantEconomyEvents(r.breakdown).size()).toBe(0);
	});

	it("one Sink and one ArmoryPurchase per purchase, with its tier", () => {
		const doc = emptyWalletDoc();
		doc.earned = 500;
		const r = applyBuy(doc, "character.archer");
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(purchaseEconomyEvent(r.purchase)).toEqual({
			flow: "Sink",
			currency: SILVER_CURRENCY,
			amount: 300,
			endingBalance: 200,
			transactionType: "Shop",
			itemSku: "character.archer",
		});
		expect(armoryPurchaseEvent(r.purchase)).toEqual({
			kind: "custom",
			name: WALLET_ANALYTICS_EVENT.armoryPurchase,
			value: 300,
			fields: { field01: "character.archer", field02: "tier4", field03: "level1" },
		});
		const values = armoryPurchaseFieldValues();
		expect(values.items.includes("character.archer")).toBe(true);
		expect(values.tiers.includes("tier4")).toBe(true);
		expect(values.levels.includes("level1")).toBe(true);
	});

	it("every SKU is unique and they stay under Roblox's 100", () => {
		const skus = economySkus();
		const seen = new Set<string>();
		for (const s of skus) {
			expect(seen.has(s)).toBe(false);
			seen.add(s);
		}
		for (const row of SILVER_ROWS) expect(seen.has(row)).toBe(true);
		expect(skus.size() <= MAX_SKUS).toBe(true);
	});
});
