// docs/SILVER_SHOP.md SH2 / SH3: WalletBook.purchase, the receipt handler's pure core. One grant per PurchaseId across
// a commit-then-crash redelivery, a store failure on every retry answers NotProcessedYet and the next delivery grants
// once, it grants whether or not the wallet loaded, serialises with a run grant and replaces the read copy.
import { describe, expect, it } from "@rbxts/jest-globals";
import { emptySilverRunInput, runSilver } from "shared/silver";
import {
	MemoryWalletStore,
	WalletBook,
	decodeWalletDoc,
	silverPack,
	walletBalance,
	type SilverReceipt,
	type WalletStore,
} from "shared/wallet";

const DAY = 316;
const ME = 11;
const keyOf = (id: number) => `u_${id}`;
const POUCH = silverPack("pouch")!;
const PURSE = silverPack("purse")!;
const NO_RETRY = { attempts: 1, baseDelaySeconds: 0 };

function receipt(purchaseId: string, productId = 3001): SilverReceipt {
	return { purchaseId, playerId: ME, productId };
}

/** A store that throws on the first `failures` writes, then works. */
class FlakyWrites implements WalletStore {
	readonly inner = new MemoryWalletStore();
	constructor(private failures: number) {}
	get(key: string): unknown {
		return this.inner.get(key);
	}
	update(key: string, transform: (stored: unknown) => unknown): void {
		if (this.failures > 0) {
			this.failures--;
			error("throttled", 0);
		}
		this.inner.update(key, transform);
	}
}

/** A store whose write commits, then the call errors (the server died before answering Roblox). */
class CommitThenCrash implements WalletStore {
	readonly inner = new MemoryWalletStore();
	crash = true;
	get(key: string): unknown {
		return this.inner.get(key);
	}
	update(key: string, transform: (stored: unknown) => unknown): void {
		this.inner.update(key, transform);
		if (this.crash) error("server shut down", 0);
	}
}

function stored(store: MemoryWalletStore) {
	return decodeWalletDoc(store.get(keyOf(ME)));
}

describe("WalletBook.purchase (SH2 / SH3)", () => {
	it("grants a pack once: Processed, the grant, the read copy replaced", () => {
		const store = new MemoryWalletStore();
		const book = new WalletBook(store, { keyOf });
		book.load(ME);
		const r = book.purchase(ME, receipt("p-1"), POUCH);
		expect(r.decision).toBe("Processed");
		expect(r.grant?.silver).toBe(150);
		expect(r.grant?.balance).toBe(150);
		expect(book.status(ME, DAY).balance).toBe(150);
		expect(stored(store).bought).toBe(150);
	});

	it("a redelivery of a granted receipt is Processed and pays nothing", () => {
		const store = new MemoryWalletStore();
		const book = new WalletBook(store, { keyOf });
		book.purchase(ME, receipt("p-1"), POUCH);
		const again = book.purchase(ME, receipt("p-1"), POUCH);
		expect(again.decision).toBe("Processed");
		expect(again.reason).toBe("duplicate");
		expect(again.grant).toBe(undefined);
		expect(stored(store).bought).toBe(150);
	});

	it("commit then crash: the redelivery finds the id and pays once", () => {
		const store = new CommitThenCrash();
		const book = new WalletBook(store, { keyOf, retry: NO_RETRY });
		const first = book.purchase(ME, receipt("p-1"), PURSE);
		expect(first.decision).toBe("NotProcessedYet");
		expect(first.reason).toBe("failed");
		store.crash = false;
		const redelivered = new WalletBook(store, { keyOf }).purchase(ME, receipt("p-1"), PURSE);
		expect(redelivered.decision).toBe("Processed");
		expect(redelivered.reason).toBe("duplicate");
		expect(stored(store.inner).bought).toBe(450);
	});

	it("a store error on every retry answers NotProcessedYet; the next delivery grants once", () => {
		const store = new FlakyWrites(3);
		const book = new WalletBook(store, { keyOf });
		const r = book.purchase(ME, receipt("p-1"), POUCH);
		expect(r.decision).toBe("NotProcessedYet");
		expect(r.error).never.toBe(undefined);
		expect(store.inner.get(keyOf(ME))).toBe(undefined);
		const later = book.purchase(ME, receipt("p-1"), POUCH);
		expect(later.decision).toBe("Processed");
		expect(later.grant?.silver).toBe(150);
		expect(book.purchase(ME, receipt("p-1"), POUCH).reason).toBe("duplicate");
		expect(stored(store.inner).bought).toBe(150);
	});

	it("grants whether or not the wallet loaded (or the player is here at all)", () => {
		const store = new MemoryWalletStore();
		const book = new WalletBook(store, { keyOf });
		book.markUnknown(ME);
		expect(book.purchase(ME, receipt("p-1"), POUCH).decision).toBe("Processed");
		expect(book.status(ME, DAY)).toEqual({ loaded: false });
		expect(book.purchase(77, { purchaseId: "p-9", playerId: 77, productId: 3001 }, POUCH).decision).toBe(
			"Processed",
		);
		expect(decodeWalletDoc(store.get(keyOf(77))).bought).toBe(150);
	});

	it("an unknown product is NotProcessedYet and writes nothing", () => {
		const store = new MemoryWalletStore();
		const book = new WalletBook(store, { keyOf });
		const r = book.purchase(ME, receipt("p-1", 5555), undefined);
		expect(r.decision).toBe("NotProcessedYet");
		expect(r.reason).toBe("unknownProduct");
		expect(store.get(keyOf(ME))).toBe(undefined);
	});

	it("composes with a run grant and an Armory buy on the same player", () => {
		const store = new MemoryWalletStore();
		const book = new WalletBook(store, { keyOf });
		book.load(ME);
		const run = runSilver({ ...emptySilverRunInput(), roomsCleared: 3, floor: 3, kills: 270 });
		const g = book.grant(ME, { runId: "run-a", run, daily: false }, { day: DAY });
		expect(g.ok).toBe(true);
		book.purchase(ME, receipt("p-1"), POUCH);
		expect(book.buy(ME, "vigor").result.ok).toBe(true);
		const d = stored(store);
		expect(d.bought).toBe(150);
		expect(d.own.get("vigor")).toBe(1);
		expect(walletBalance(d)).toBe(d.earned + 150 - 40);
		expect(book.pending()).toBe(0);
	});
});
