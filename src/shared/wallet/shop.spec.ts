// docs/SILVER_SHOP.md SH2: the packs (order lock), the per-universe product table, Roblox's receipt, applyPurchase (one
// grant per PurchaseId, the ring, unknown products), receiptDecision, the store transform and the Studio fake.
import { describe, expect, it } from "@rbxts/jest-globals";
import { emptySilverRunInput, runSilver } from "shared/silver";
import {
	SILVER_PACKS,
	SILVER_PACK_IDS,
	SILVER_PRODUCTS,
	SILVER_SHOP,
	applyPurchase,
	decodeWalletDoc,
	emptyWalletDoc,
	parseFakeShop,
	readSilverReceipt,
	receiptDecision,
	shownSilverPacks,
	shownSilverProducts,
	silverPack,
	silverPackForProduct,
	silverProductIdsFor,
	silverProductsFor,
	silverShopAvailable,
	walletBalance,
	walletTransaction,
	type SilverPack,
	type SilverPackId,
	type SilverProductTable,
	type SilverReceipt,
} from "shared/wallet";

const GAME = 4242;
const OTHER_GAME = 99;
const PRODUCTS: SilverProductTable = new Map([
	[
		GAME,
		new Map<SilverPackId, number>([
			["pouch", 3001],
			["purse", 3002],
			["chest", 3003],
			["hoard", 3004],
		]),
	],
]);
const POUCH = silverPack("pouch")!;

function receipt(purchaseId: string, productId = 3001): SilverReceipt {
	return { purchaseId, playerId: 11, productId };
}

describe("Silver packs (SH2)", () => {
	it("order lock: pouch 150, purse 450, chest 1,000, hoard 2,500 (append-only)", () => {
		expect(SILVER_PACKS.map((p) => `${p.id}:${p.silver}`)).toEqual([
			"pouch:150",
			"purse:450",
			"chest:1000",
			"hoard:2500",
		]);
		expect([...SILVER_PACK_IDS]).toEqual(["pouch", "purse", "chest", "hoard"]);
	});

	it("a retired pack is not shown but still sells to a late receipt", () => {
		const packs: SilverPack[] = [
			{ id: "pouch", silver: 150, retired: true },
			{ id: "purse", silver: 450 },
		];
		expect(shownSilverPacks(packs).map((p) => p.id)).toEqual(["purse"]);
		expect(silverPackForProduct(GAME, 3001, PRODUCTS, packs)?.id).toBe("pouch");
	});

	it("products per universe: none shipped yet, so no shop anywhere until SH9", () => {
		expect(SILVER_PRODUCTS.size()).toBe(0);
		expect(silverShopAvailable(GAME)).toBe(false);
		expect(silverProductsFor(GAME)).toBe(undefined);
	});

	it("product lookups: this universe only, every id for the handler's filter", () => {
		expect(silverShopAvailable(GAME, PRODUCTS)).toBe(true);
		expect(silverShopAvailable(OTHER_GAME, PRODUCTS)).toBe(false);
		expect(silverPackForProduct(GAME, 3003, PRODUCTS)?.id).toBe("chest");
		expect(silverPackForProduct(GAME, 9999, PRODUCTS)).toBe(undefined);
		expect(silverPackForProduct(OTHER_GAME, 3003, PRODUCTS)).toBe(undefined);
		expect(silverProductIdsFor(GAME, PRODUCTS)).toEqual([3001, 3002, 3003, 3004]);
		expect(silverProductIdsFor(OTHER_GAME, PRODUCTS)).toEqual([]);
		expect(shownSilverProducts(GAME, PRODUCTS).map((e) => `${e.pack.id}:${e.productId}`)).toEqual([
			"pouch:3001",
			"purse:3002",
			"chest:3003",
			"hoard:3004",
		]);
	});
});

describe("readSilverReceipt (SH2)", () => {
	it("reads Roblox's dictionary", () => {
		expect(
			readSilverReceipt({
				PurchaseId: "abc",
				PlayerId: 11,
				ProductId: 3001,
				CurrencySpent: 20,
				PlaceIdWherePurchased: 77,
				CurrencyType: "Robux",
			}),
		).toEqual({ purchaseId: "abc", playerId: 11, productId: 3001, robuxSpent: 20, placeId: 77 });
	});

	it("refuses a missing or malformed id, player or product; drops bad optional fields", () => {
		expect(readSilverReceipt(undefined)).toBe(undefined);
		expect(readSilverReceipt({ PlayerId: 11, ProductId: 3001 })).toBe(undefined);
		expect(readSilverReceipt({ PurchaseId: "", PlayerId: 11, ProductId: 3001 })).toBe(undefined);
		expect(readSilverReceipt({ PurchaseId: "a", PlayerId: 1.5, ProductId: 3001 })).toBe(undefined);
		expect(readSilverReceipt({ PurchaseId: "a", PlayerId: 11, ProductId: "3001" })).toBe(undefined);
		expect(readSilverReceipt({ PurchaseId: "a", PlayerId: 11, ProductId: 3001, CurrencySpent: -1 })).toEqual({
			purchaseId: "a",
			playerId: 11,
			productId: 3001,
		});
	});
});

describe("applyPurchase (SH2)", () => {
	it("adds the pack's Silver to `bought` and the id to the ring; nothing else moves", () => {
		const d = emptyWalletDoc();
		d.earned = 30;
		d.spent = 10;
		d.runDay = 5;
		const r = applyPurchase(d, receipt("p-1"), POUCH);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.doc.bought).toBe(150);
		expect([...(r.doc.receipts ?? [])]).toEqual(["p-1"]);
		expect([r.doc.earned, r.doc.spent, r.doc.runDay]).toEqual([30, 10, 5]);
		expect(r.grant).toEqual({ purchaseId: "p-1", packId: "pouch", productId: 3001, silver: 150, balance: 170 });
		expect(d.bought).toBe(undefined);
	});

	it("grants once per PurchaseId: a second delivery is a duplicate", () => {
		const once = applyPurchase(emptyWalletDoc(), receipt("p-1"), POUCH);
		if (!once.ok) error("refused", 0);
		const again = applyPurchase(once.doc, receipt("p-1"), POUCH);
		expect(again.ok).toBe(false);
		if (!again.ok) expect(again.reason).toBe("duplicate");
		expect(walletBalance(again.doc)).toBe(150);
	});

	it("the ring drops the oldest past SILVER_SHOP.receiptRing", () => {
		let d = emptyWalletDoc();
		for (let i = 1; i <= SILVER_SHOP.receiptRing + 1; i++) {
			const r = applyPurchase(d, receipt(`p-${i}`), POUCH);
			if (!r.ok) error("refused", 0);
			d = r.doc;
		}
		expect(d.receipts?.size()).toBe(SILVER_SHOP.receiptRing);
		expect(d.receipts?.[0]).toBe("p-2");
		expect(d.bought).toBe(150 * (SILVER_SHOP.receiptRing + 1));
	});

	it("refuses an unknown product and a bad PurchaseId", () => {
		const u = applyPurchase(emptyWalletDoc(), receipt("p-1"), undefined);
		if (!u.ok) expect(u.reason).toBe("unknownProduct");
		const b = applyPurchase(emptyWalletDoc(), receipt(""), POUCH);
		if (!b.ok) expect(b.reason).toBe("badPurchaseId");
		expect(u.ok || b.ok).toBe(false);
	});
});

describe("the store transform and Roblox's decision (SH2)", () => {
	it("a granted receipt writes; a duplicate writes nothing", () => {
		const first = walletTransaction(undefined, { kind: "silverPurchase", receipt: receipt("p-1"), pack: POUCH });
		expect(first.ok).toBe(true);
		expect(first.silverPurchase?.silver).toBe(150);
		const again = walletTransaction(first.write, {
			kind: "silverPurchase",
			receipt: receipt("p-1"),
			pack: POUCH,
		});
		expect(again.ok).toBe(false);
		expect(again.reason).toBe("duplicate");
		expect(again.write).toBe(undefined);
	});

	it("a newer stored version is never written over", () => {
		const r = walletTransaction(
			{ v: 2, earned: 5 },
			{ kind: "silverPurchase", receipt: receipt("p-1"), pack: POUCH },
		);
		expect(r.reason).toBe("newerVersion");
		expect(r.write).toBe(undefined);
		expect(receiptDecision({ ok: true, outcome: r })).toBe("NotProcessedYet");
	});

	it("Processed only for a committed grant or a duplicate", () => {
		expect(receiptDecision({ ok: true, outcome: { ok: true } })).toBe("Processed");
		expect(receiptDecision({ ok: true, outcome: { ok: false, reason: "duplicate" } })).toBe("Processed");
		for (const reason of ["unknownProduct", "badPurchaseId", "newerVersion"]) {
			expect(receiptDecision({ ok: true, outcome: { ok: false, reason } })).toBe("NotProcessedYet");
		}
		expect(receiptDecision({ ok: false })).toBe("NotProcessedYet");
	});

	it("composes with a run grant and an Armory buy in either order", () => {
		const grantOp = {
			kind: "grant" as const,
			grant: { runId: "run-a", run: runSilver({ ...emptySilverRunInput(), roomsCleared: 3 }), daily: false },
			ctx: { day: 316 },
		};
		const buyOp = { kind: "buy" as const, itemId: "vigor", level: 1 };
		const payOp = { kind: "silverPurchase" as const, receipt: receipt("p-1"), pack: POUCH };
		const run = (ops: ReadonlyArray<typeof grantOp | typeof buyOp | typeof payOp>) => {
			let stored: unknown = undefined;
			for (const op of ops) {
				const r = walletTransaction(stored, op);
				if (r.write !== undefined) stored = r.write;
			}
			return decodeWalletDoc(stored);
		};
		const a = run([payOp, grantOp, buyOp]);
		const b = run([grantOp, payOp, buyOp]);
		const c = run([payOp, buyOp, grantOp]);
		for (const d of [a, b, c]) {
			expect(d.bought).toBe(150);
			expect(d.own.get("vigor")).toBe(1);
			expect(walletBalance(d)).toBe(walletBalance(a));
		}
		// the buy before the grant was paid from bought Silver (one pool, SHD1)
		expect(c.spent).toBe(40);
	});
});

describe("parseFakeShop (SH2, Studio)", () => {
	it("`off`, or four whole prices in pack order", () => {
		expect(parseFakeShop("off")).toEqual({ on: false });
		expect(parseFakeShop(" OFF ")).toEqual({ on: false });
		const f = parseFakeShop("20, 55,115 ,265");
		expect(f?.on).toBe(true);
		if (f !== undefined && f.on) {
			expect(SILVER_PACK_IDS.map((id) => f.prices.get(id))).toEqual([20, 55, 115, 265]);
		}
	});

	it("anything else is no fake", () => {
		for (const bad of [
			undefined,
			5,
			"",
			"20,55,115",
			"20,55,115,265,9",
			"20,x,115,265",
			"0,55,115,265",
			"2.5,55,115,265",
		]) {
			expect(parseFakeShop(bad)).toBe(undefined);
		}
	});
});
