// docs/SILVER.md SV3: WalletService's pure core. Fakes (an in-memory store, a Studio fake doc), a buy before the load
// is refused, a failed load greys the wallet and still lets a grant land with its bonuses, two simulated servers'
// interleaved grants pay the day bonus once, the price is always the catalogue's (the remote carries an item id only).
import { describe, expect, it } from "@rbxts/jest-globals";
import { emptySilverRunInput, runSilver } from "shared/silver";
import {
	MemoryWalletStore,
	WalletBook,
	decodeWalletDoc,
	encodeWalletDoc,
	ownedLevel,
	parseFakeWallet,
	walletBalance,
	type WalletGrant,
	type WalletStore,
} from "shared/wallet";

const DAY = 316;
const ME = 11;
const keyOf = (id: number) => `u_${id}`;
const RUN = runSilver({ ...emptySilverRunInput(), roomsCleared: 3, floor: 3, kills: 270 }); // 46

function grant(runId: string): WalletGrant {
	return { runId, run: RUN, daily: false };
}

/** A store whose reads fail (a DataStore outage at join); writes still work. */
class FailingReads implements WalletStore {
	readonly inner = new MemoryWalletStore();
	get(): unknown {
		error("DataStore unavailable", 0);
	}
	update(key: string, transform: (stored: unknown) => unknown): void {
		this.inner.update(key, transform);
	}
}

/** A store that throws on the first `failures` writes (throttling), then works. */
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

describe("WalletBook (SV3)", () => {
	it("loads a missing doc as an empty wallet and grants into it", () => {
		const store = new MemoryWalletStore();
		const book = new WalletBook(store, { keyOf });
		expect(book.load(ME)).toBe(true);
		expect(book.status(ME, DAY)).toEqual({
			loaded: true,
			balance: 0,
			earned: 0,
			firstRunBonusOpen: true,
			dailyBonusOpen: true,
			goals: book.status(ME, DAY).goals,
		});
		const r = book.grant(ME, grant("a"), { day: DAY });
		expect(r.ok && r.outcome.breakdown?.total).toBe(96);
		// the read copy was replaced by the result; the store holds it
		expect(walletBalance(book.doc(ME)!)).toBe(96);
		expect(walletBalance(decodeWalletDoc(store.get(keyOf(ME))))).toBe(96);
		expect(book.status(ME, DAY).firstRunBonusOpen).toBe(false);
	});

	it("a buy before the load is refused (notLoaded), and nothing is written", () => {
		const store = new MemoryWalletStore();
		store.set(keyOf(ME), encodeWalletDoc(parseFakeWallet("460", DAY)!.doc));
		const book = new WalletBook(store, { keyOf });
		const before = book.buy(ME, "vigor");
		expect([before.result.ok, before.result.reason]).toEqual([false, "notLoaded"]);
		expect(walletBalance(decodeWalletDoc(store.get(keyOf(ME))))).toBe(460);
		book.load(ME);
		const after = book.buy(ME, "vigor");
		expect(after.result).toEqual({ action: "buy", itemId: "vigor", ok: true, level: 1, price: 40 });
		expect(walletBalance(book.doc(ME)!)).toBe(420);
	});

	it("a failed load greys the wallet (loaded false, no upgrades, the Knight only) and a grant still lands with its bonuses", () => {
		const store = new FailingReads();
		const book = new WalletBook(store, { keyOf });
		expect(book.load(ME)).toBe(false);
		expect(book.status(ME, DAY)).toEqual({ loaded: false });
		expect(book.effectiveUpgrades(ME)).toBe(undefined);
		expect(book.ownsCharacter(ME, "knight")).toBe(true);
		expect(book.ownsCharacter(ME, "archer")).toBe(false);
		expect(book.buy(ME, "vigor").result.reason).toBe("notLoaded");
		const r = book.grant(ME, grant("a"), { day: DAY });
		expect(r.ok && r.outcome.breakdown?.firstRunBonus).toBe(50);
		expect(walletBalance(decodeWalletDoc(store.inner.get(keyOf(ME))))).toBe(96);
		// the session copy stays unknown (loaded false for the session)
		expect(book.status(ME, DAY)).toEqual({ loaded: false });
	});

	it("two servers' interleaved grants pay the day bonus once", () => {
		const store = new MemoryWalletStore();
		const one = new WalletBook(store, { keyOf });
		const two = new WalletBook(store, { keyOf });
		one.load(ME);
		two.load(ME);
		const a = one.grant(ME, grant("server-1"), { day: DAY });
		const b = two.grant(ME, grant("server-2"), { day: DAY });
		expect(a.ok && a.outcome.breakdown?.firstRunBonus).toBe(50);
		expect(b.ok && b.outcome.breakdown?.firstRunBonus).toBe(0);
		expect(walletBalance(decodeWalletDoc(store.get(keyOf(ME))))).toBe(46 + 46 + 50);
		// each server's copy is its own last result; server 2's saw server 1's grant
		expect(walletBalance(two.doc(ME)!)).toBe(142);
		expect(walletBalance(one.doc(ME)!)).toBe(96);
		// a buy on server 1 reads the stored doc (142), not its stale copy (96)
		const buy = one.buy(ME, "character.archer");
		expect([buy.result.ok, walletBalance(one.doc(ME)!)]).toEqual([false, 142]);
		expect(buy.result.reason).toBe("poor");
	});

	it("the price is the catalogue's: an unknown or junk item id is refused, nothing spent", () => {
		const store = new MemoryWalletStore();
		store.set(keyOf(ME), encodeWalletDoc(parseFakeWallet("5000", DAY)!.doc));
		const book = new WalletBook(store, { keyOf });
		book.load(ME);
		for (const junk of ["", "VIGOR", "vigor;price=0", "might"]) {
			const r = book.buy(ME, junk);
			expect([r.result.ok, r.result.reason]).toEqual([false, "unknown"]);
		}
		expect(walletBalance(book.doc(ME)!)).toBe(5000);
		const ok = book.buy(ME, "plating");
		expect(ok.result.price).toBe(600);
		expect(walletBalance(book.doc(ME)!)).toBe(4400);
	});

	it("a store error is retried; past the retries the request answers `failed`", () => {
		const flaky = new FlakyWrites(1);
		const book = new WalletBook(flaky, { keyOf, retry: { attempts: 3, baseDelaySeconds: 0 } });
		book.load(ME);
		expect(book.grant(ME, grant("a"), { day: DAY }).ok).toBe(true);
		const down = new FlakyWrites(10);
		const book2 = new WalletBook(down, { keyOf, retry: { attempts: 2, baseDelaySeconds: 0 } });
		book2.load(ME);
		expect(book2.buy(ME, "vigor").result.reason).toBe("failed");
		expect(book2.pending()).toBe(0);
	});

	it("a buy whose write committed before an error is not bought twice on the retry (the expected level: stale)", () => {
		/** Commits the first write, then throws as if the reply was lost; later writes work. */
		class CommitThenThrow implements WalletStore {
			readonly inner = new MemoryWalletStore();
			private thrown = false;
			get(key: string): unknown {
				return this.inner.get(key);
			}
			update(key: string, transform: (stored: unknown) => unknown): void {
				this.inner.update(key, transform);
				if (!this.thrown) {
					this.thrown = true;
					error("lost reply", 0);
				}
			}
		}
		const store = new CommitThenThrow();
		const book = new WalletBook(store, { keyOf, retry: { attempts: 3, baseDelaySeconds: 0 } });
		store.inner.update(keyOf(ME), () => encodeWalletDoc({ ...decodeWalletDoc(undefined), earned: 1000 }));
		book.load(ME);
		const r = book.buy(ME, "vigor");
		expect([r.result.ok, r.result.level]).toEqual([true, 1]);
		const stored = decodeWalletDoc(store.inner.get(keyOf(ME)));
		expect([ownedLevel(stored, "vigor"), stored.spent]).toEqual([1, 40]);
	});

	it("a doc written by a newer build loads as unknown, never as an empty wallet", () => {
		const store = new MemoryWalletStore();
		store.update(keyOf(ME), () => ({ v: 99, earned: 500, spent: 0, own: {}, runs: [] }));
		const book = new WalletBook(store, { keyOf, retry: { attempts: 1, baseDelaySeconds: 0 } });
		expect(book.load(ME)).toBe(false);
		expect(book.status(ME, DAY).loaded).toBe(false);
		expect(book.effectiveUpgrades(ME)).toBe(undefined);
	});

	it("the Studio fake: a seeded in-memory store, `unknown` marks the session unknown, the Archer owned by the fake", () => {
		const store = new MemoryWalletStore(() => error("never read the real store", 0));
		const fake = parseFakeWallet("460;vigor:2,character.archer:1;claimed", DAY)!;
		store.set(keyOf(ME), encodeWalletDoc(fake.doc));
		const book = new WalletBook(store, { keyOf });
		book.load(ME);
		expect(book.effectiveUpgrades(ME)).toEqual({ vigor: 2, deepFlask: 0, plating: 0 });
		expect(book.ownsCharacter(ME, "archer")).toBe(true);
		expect(book.status(ME, DAY).firstRunBonusOpen).toBe(false);
		book.markUnknown(22);
		expect(book.status(22, DAY)).toEqual({ loaded: false });
		book.forget(ME);
		expect(book.hasCopy(ME)).toBe(false);
	});
});
