// docs/SILVER_SHOP.md SH3: the server rules SilverShopService wires to Roblox: the shop's status fields (products or
// the Studio fake), the receipt plan (grant / defer), Studio's fake receipts and the audit entry.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	SILVER_SHOP,
	SILVER_SHOP_FAKE_PRODUCT_ID,
	SILVER_SHOP_FAKE_PURCHASE_PREFIX,
	WALLET,
	applyPurchase,
	emptyWalletDoc,
	fakeSilverReceipt,
	parseFakeShop,
	receiptDecision,
	silverAuditKey,
	silverAuditRecord,
	silverPack,
	silverReceiptPlan,
	silverShopStatusFields,
	type FakeShop,
	type SilverPack,
	type SilverPackId,
	type SilverProductTable,
} from "shared/wallet";

const GAME = 4242;
const OTHER_GAME = 99;

function products(entries: [SilverPackId, number][]): SilverProductTable {
	const m = new Map<SilverPackId, number>();
	for (const [k, v] of entries) m.set(k, v);
	return new Map([[GAME, m]]);
}

const TABLE = products([
	["pouch", 101],
	["purse", 102],
	["chest", 103],
	["hoard", 104],
]);

function info(purchaseId: unknown, productId: unknown, playerId: unknown = 7): unknown {
	return { PurchaseId: purchaseId, PlayerId: playerId, ProductId: productId, CurrencySpent: 20 };
}

function fakeOn(): FakeShop {
	return parseFakeShop("20,55,115,265")!;
}

describe("silverShopStatusFields", () => {
	it("no fake: the shop exists where this universe has products", () => {
		expect(silverShopStatusFields(GAME, undefined, TABLE)).toEqual({ shopAvailable: true });
		expect(silverShopStatusFields(OTHER_GAME, undefined, TABLE)).toEqual({ shopAvailable: false });
		expect(silverShopStatusFields(GAME, undefined, new Map())).toEqual({ shopAvailable: false });
	});

	it("the fake `off` hides the shop even with products", () => {
		expect(silverShopStatusFields(GAME, { on: false }, TABLE)).toEqual({ shopAvailable: false });
	});

	it("fake prices show the shop with no products, in pack order", () => {
		const f = silverShopStatusFields(OTHER_GAME, fakeOn(), new Map());
		expect(f.shopAvailable).toBe(true);
		expect(f.fakePrices).toEqual([
			{ packId: "pouch", robux: 20 },
			{ packId: "purse", robux: 55 },
			{ packId: "chest", robux: 115 },
			{ packId: "hoard", robux: 265 },
		]);
	});

	it("a retired pack is not priced", () => {
		const packs: SilverPack[] = [
			{ id: "pouch", silver: 150 },
			{ id: "purse", silver: 450, retired: true },
		];
		const fake = parseFakeShop("20", packs)!;
		expect(silverShopStatusFields(GAME, fake, new Map(), packs).fakePrices).toEqual([
			{ packId: "pouch", robux: 20 },
		]);
	});
});

describe("silverReceiptPlan", () => {
	it("grants a receipt for one of this universe's packs", () => {
		const p = silverReceiptPlan(info("abc", 103), GAME, false, TABLE);
		expect(p.kind).toBe("grant");
		if (p.kind === "grant") {
			expect(p.pack.id).toBe("chest");
			expect(p.receipt).toEqual({ purchaseId: "abc", playerId: 7, productId: 103, robuxSpent: 20 });
		}
	});

	it("defers what is not a receipt", () => {
		expect(silverReceiptPlan(undefined, GAME, false, TABLE)).toEqual({ kind: "defer", reason: "badReceipt" });
		expect(silverReceiptPlan(info("", 101), GAME, false, TABLE).kind).toBe("defer");
		expect(silverReceiptPlan(info("abc", "101"), GAME, false, TABLE).kind).toBe("defer");
		expect(silverReceiptPlan(info("abc", 101, 1.5), GAME, false, TABLE).kind).toBe("defer");
	});

	it("defers another product's receipt and any receipt in another universe", () => {
		const p = silverReceiptPlan(info("abc", 555), GAME, false, TABLE);
		expect(p.kind === "defer" && p.reason).toBe("notOurs");
		const q = silverReceiptPlan(info("abc", 101), OTHER_GAME, false, TABLE);
		expect(q.kind === "defer" && q.reason).toBe("notOurs");
	});

	it("a closing server starts no transaction", () => {
		const p = silverReceiptPlan(info("abc", 101), GAME, true, TABLE);
		expect(p.kind === "defer" && p.reason).toBe("closing");
	});

	it("a retired pack's late receipt still grants", () => {
		const packs: SilverPack[] = [
			{ id: "pouch", silver: 150 },
			{ id: "purse", silver: 450, retired: true },
		];
		const p = silverReceiptPlan(info("late", 102), GAME, false, TABLE, packs);
		expect(p.kind === "grant" && p.pack.id).toBe("purse");
	});

	it("the deferrals and the grant meet receiptDecision as SHD2 says", () => {
		// A defer never reaches the book: the service answers NotProcessedYet itself.
		const p = silverReceiptPlan(info("abc", 101), GAME, false, TABLE);
		if (p.kind !== "grant") error("expected a grant", 0);
		const first = applyPurchase(emptyWalletDoc(), p.receipt, p.pack);
		expect(receiptDecision({ ok: true, outcome: { ok: first.ok } })).toBe("Processed");
		const again = applyPurchase(first.doc, p.receipt, p.pack);
		expect(again.ok).toBe(false);
		expect(receiptDecision({ ok: true, outcome: { ok: false, reason: "duplicate" } })).toBe("Processed");
		expect(receiptDecision({ ok: false })).toBe("NotProcessedYet");
	});
});

describe("fakeSilverReceipt", () => {
	it("makes a receipt for a shown pack with its own purchase id", () => {
		const r = fakeSilverReceipt(7, "purse", fakeOn(), "n1", 3)!;
		expect(r.pack.id).toBe("purse");
		expect(r.receipt).toEqual({
			purchaseId: `${SILVER_SHOP_FAKE_PURCHASE_PREFIX}7_n1_3`,
			playerId: 7,
			productId: SILVER_SHOP_FAKE_PRODUCT_ID,
			robuxSpent: 55,
		});
	});

	it("each serial grants once; the same serial is a duplicate", () => {
		const fake = fakeOn();
		const a = fakeSilverReceipt(7, "pouch", fake, "n1", 1)!;
		const b = fakeSilverReceipt(7, "pouch", fake, "n1", 2)!;
		const d1 = applyPurchase(emptyWalletDoc(), a.receipt, a.pack);
		expect(d1.ok).toBe(true);
		const d2 = applyPurchase(d1.doc, b.receipt, b.pack);
		expect(d2.ok).toBe(true);
		expect(d2.doc.bought).toBe(300);
		const dup = applyPurchase(d2.doc, a.receipt, a.pack);
		expect(dup.ok === false && dup.reason).toBe("duplicate");
	});

	it("refuses without the fake, with it off, an unknown pack or a retired one", () => {
		expect(fakeSilverReceipt(7, "pouch", undefined, "n", 1)).toBeUndefined();
		expect(fakeSilverReceipt(7, "pouch", { on: false }, "n", 1)).toBeUndefined();
		expect(fakeSilverReceipt(7, "gem", fakeOn(), "n", 1)).toBeUndefined();
		expect(fakeSilverReceipt(7, 3, fakeOn(), "n", 1)).toBeUndefined();
		const packs: SilverPack[] = [
			{ id: "pouch", silver: 150 },
			{ id: "purse", silver: 450, retired: true },
		];
		const fake = parseFakeShop("20", packs)!;
		expect(fakeSilverReceipt(7, "purse", fake, "n", 1, packs)).toBeUndefined();
	});

	it("refuses an id longer than the ring keeps", () => {
		let nonce = "";
		while (nonce.size() <= WALLET.maxIdChars) nonce += "x";
		expect(fakeSilverReceipt(7, "pouch", fakeOn(), nonce, 1)).toBeUndefined();
	});
});

describe("the audit entry", () => {
	it("keys by purchase id and records the grant", () => {
		expect(silverAuditKey("abc")).toBe(`${SILVER_SHOP.auditKeyPrefix}abc`);
		const receipt = { purchaseId: "abc", playerId: 7, productId: 101, robuxSpent: 18, placeId: 5 };
		const grant = { purchaseId: "abc", packId: "pouch" as SilverPackId, productId: 101, silver: 150, balance: 150 };
		expect(silverAuditRecord(receipt, grant, 1000)).toEqual({
			userId: 7,
			productId: 101,
			pack: "pouch",
			silver: 150,
			balance: 150,
			robux: 18,
			placeId: 5,
			at: 1000,
		});
		expect(silverAuditRecord({ purchaseId: "abc", playerId: 7, productId: 101 }, grant, 1).robux).toBeUndefined();
		expect(silverPack("pouch")!.silver).toBe(150);
	});
});
