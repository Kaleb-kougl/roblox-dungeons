// docs/SERVER_CENSUS.md SE4: the wallet's trust boundary, asserted in one place at its edges: the exact price boundary
// (a balance never goes below 0), what a client-supplied id of any size or type costs (nothing), Roblox's receipt
// dictionary with non-finite numbers, and what the PurchaseId ring's bound means for a very old redelivery.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	MemoryWalletStore,
	SILVER_SHOP,
	WALLET,
	WalletBook,
	applyBuy,
	applyPurchase,
	decodeWalletDoc,
	emptyWalletDoc,
	encodeWalletDoc,
	readSilverReceipt,
	silverPack,
	walletBalance,
	walletDocsEqual,
	walletTransaction,
	type SilverReceipt,
	type WalletDoc,
} from "shared/wallet";

const ME = 11;
const keyOf = (id: number) => `u_${id}`;
const POUCH = silverPack("pouch")!;

function wallet(earned: number): WalletDoc {
	const d = emptyWalletDoc();
	d.earned = earned;
	return d;
}

function receipt(purchaseId: string): SilverReceipt {
	return { purchaseId, playerId: ME, productId: 3001 };
}

/** The catalogue's price of `itemId`'s first level, read from a buy with plenty of Silver. */
function firstPrice(itemId: string): number {
	const r = applyBuy(wallet(1e6), itemId);
	if (!r.ok) error(`no price for ${itemId}`, 0);
	return r.purchase.price;
}

describe("a transaction that would take the balance below 0 is refused", () => {
	const price = firstPrice("vigor");

	it("one Silver short: refused `poor`, the doc unchanged; exactly enough: bought, balance 0", () => {
		const short = applyBuy(wallet(price - 1), "vigor");
		expect(!short.ok && short.reason).toBe("poor");
		expect(walletBalance(short.doc)).toBe(price - 1);
		const exact = applyBuy(wallet(price), "vigor");
		expect(exact.ok).toBe(true);
		expect(walletBalance(exact.doc)).toBe(0);
	});

	it("the store transform writes nothing for the refused buy", () => {
		const stored = encodeWalletDoc(wallet(price - 1));
		const r = walletTransaction(stored, { kind: "buy", itemId: "vigor", level: 1 });
		expect([r.ok, r.reason, r.write]).toEqual([false, "poor", undefined]);
	});

	it("an empty wallet and a stored doc that spent more than it earned both read 0 and buy nothing", () => {
		expect(!applyBuy(emptyWalletDoc(), "vigor").ok).toBe(true);
		const broken = decodeWalletDoc({ v: 1, earned: 10, spent: 500 });
		expect(walletBalance(broken)).toBe(0);
		const r = applyBuy(broken, "vigor");
		expect(!r.ok && r.reason).toBe("poor");
		expect(walletBalance(r.doc)).toBe(0);
	});

	it("through the book: repeated buys stop at the first one the balance cannot pay, never below 0", () => {
		const store = new MemoryWalletStore();
		store.set(keyOf(ME), encodeWalletDoc(wallet(price + 1)));
		const book = new WalletBook(store, { keyOf });
		book.load(ME);
		expect(book.buy(ME, "vigor").result.ok).toBe(true);
		for (let i = 0; i < 3; i++) {
			const again = book.buy(ME, "vigor");
			expect(again.result.ok).toBe(false);
		}
		expect(walletBalance(decodeWalletDoc(store.get(keyOf(ME))))).toBe(1);
	});
});

describe("walletBuy / walletEquip arguments (client-supplied)", () => {
	function loaded(): { book: WalletBook; store: MemoryWalletStore; before: WalletDoc } {
		const store = new MemoryWalletStore();
		const before = wallet(5000);
		store.set(keyOf(ME), encodeWalletDoc(before));
		const book = new WalletBook(store, { keyOf });
		book.load(ME);
		return { book, store, before };
	}

	it("an oversized or wrong-typed item id buys nothing and leaves the stored doc as it was", () => {
		const { book, store, before } = loaded();
		const junk: unknown[] = [
			string.rep("v", WALLET.maxIdChars + 1),
			string.rep("vigor", 20000),
			7,
			0 / 0,
			true,
			{ id: "vigor" },
			undefined,
		];
		for (const id of junk) {
			const r = book.buy(ME, id as string);
			expect(r.result.ok).toBe(false);
			expect(r.outcome?.purchase).toBe(undefined);
		}
		expect(walletDocsEqual(decodeWalletDoc(store.get(keyOf(ME))), before)).toBe(true);
		expect(walletBalance(book.doc(ME)!)).toBe(5000);
	});

	it("a wrong-typed id is answered as the empty id, never echoed", () => {
		const { book } = loaded();
		expect(book.buy(ME, 7 as unknown as string).result.itemId).toBe("");
		expect(book.equip(ME, "dye", { id: "x" } as unknown as string).result.itemId).toBe("");
	});

	it("an unknown, oversized or wrong-typed slot equips nothing", () => {
		const { book, store, before } = loaded();
		const slots: unknown[] = ["", "nope", string.rep("s", 100000), 3, 0 / 0, {}, undefined];
		for (const slot of slots) {
			const r = book.equip(ME, slot as string, "");
			expect(r.result.ok).toBe(false);
		}
		expect(walletDocsEqual(decodeWalletDoc(store.get(keyOf(ME))), before)).toBe(true);
	});
});

describe("Roblox's receipt dictionary", () => {
	const good = { PurchaseId: "abc", PlayerId: ME, ProductId: 3001 };

	it("refuses non-finite and fractional numbers in the player and the product", () => {
		for (const bad of [0 / 0, math.huge, -math.huge, 1.5, "11", true] as unknown[]) {
			expect(readSilverReceipt({ ...good, PlayerId: bad })).toBe(undefined);
			expect(readSilverReceipt({ ...good, ProductId: bad })).toBe(undefined);
		}
		expect(readSilverReceipt(good)).toEqual({ purchaseId: "abc", playerId: ME, productId: 3001 });
	});

	it("refuses a PurchaseId longer than the ring keeps, or not a string", () => {
		const longest = string.rep("p", WALLET.maxIdChars);
		expect(readSilverReceipt({ ...good, PurchaseId: longest })?.purchaseId).toBe(longest);
		for (const bad of [`${longest}p`, 12345, true, {}] as unknown[]) {
			expect(readSilverReceipt({ ...good, PurchaseId: bad })).toBe(undefined);
		}
	});

	it("non-finite optional fields are dropped, never kept", () => {
		const r = readSilverReceipt({ ...good, CurrencySpent: 0 / 0, PlaceIdWherePurchased: math.huge });
		expect(r).toEqual({ purchaseId: "abc", playerId: ME, productId: 3001 });
	});
});

describe("the PurchaseId ring's bound", () => {
	it("every id still in the ring is a duplicate; the balance counts each grant once", () => {
		let d = emptyWalletDoc();
		for (let i = 1; i <= SILVER_SHOP.receiptRing; i++) {
			const r = applyPurchase(d, receipt(`p-${i}`), POUCH);
			if (!r.ok) error("refused", 0);
			d = r.doc;
		}
		const full = walletBalance(d);
		expect(full).toBe(POUCH.silver * SILVER_SHOP.receiptRing);
		for (const i of [1, 2, SILVER_SHOP.receiptRing]) {
			const again = applyPurchase(d, receipt(`p-${i}`), POUCH);
			expect(!again.ok && again.reason).toBe("duplicate");
			expect(walletBalance(again.doc)).toBe(full);
		}
	});

	it("the bound: only an id pushed out by receiptRing later grants is forgotten (and would grant again)", () => {
		let d = emptyWalletDoc();
		for (let i = 1; i <= SILVER_SHOP.receiptRing + 1; i++) {
			const r = applyPurchase(d, receipt(`p-${i}`), POUCH);
			if (!r.ok) error("refused", 0);
			d = r.doc;
		}
		expect(d.receipts?.size()).toBe(SILVER_SHOP.receiptRing);
		const newest = applyPurchase(d, receipt(`p-${SILVER_SHOP.receiptRing + 1}`), POUCH);
		expect(!newest.ok && newest.reason).toBe("duplicate");
		const second = applyPurchase(d, receipt("p-2"), POUCH);
		expect(!second.ok && second.reason).toBe("duplicate");
		// p-1 is the one id the ring no longer holds: this is the documented limit of the duplicate check.
		expect(applyPurchase(d, receipt("p-1"), POUCH).ok).toBe(true);
	});

	it("the ring survives the stored document (encode, decode) at its bound", () => {
		let d = emptyWalletDoc();
		for (let i = 1; i <= SILVER_SHOP.receiptRing + 5; i++) {
			const r = applyPurchase(d, receipt(`p-${i}`), POUCH);
			if (!r.ok) error("refused", 0);
			d = r.doc;
		}
		const back = decodeWalletDoc(encodeWalletDoc(d));
		expect(back.receipts?.size()).toBe(SILVER_SHOP.receiptRing);
		const again = applyPurchase(back, receipt(`p-${SILVER_SHOP.receiptRing + 5}`), POUCH);
		expect(!again.ok && again.reason).toBe("duplicate");
	});
});
