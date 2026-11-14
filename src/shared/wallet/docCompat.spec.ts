/**
 * docs/SILVER_SHOP.md SH1: the wallet codec keeps unknown top-level fields (forward compatibility, SHD7), bought Silver
 * (SHD9) and the receipt ring (SHD2).
 */
import { describe, expect, it } from "@rbxts/jest-globals";
import { emptySilverRunInput, runSilver } from "shared/silver";
import { silverWelcomeShown } from "shared/view/menu";
import {
	SILVER_SHOP,
	applyBuy,
	applyGrant,
	cloneWalletDoc,
	decodeWalletDoc,
	emptyWalletDoc,
	encodeWalletDoc,
	walletBalance,
	walletDocsEqual,
	walletStatusOf,
	walletTransaction,
} from "shared/wallet";

const DAY = 316;

/** A stored value as a newer build might write it: today's fields plus two this build does not know. */
function newerShaped(): Record<string, unknown> {
	return {
		v: 1,
		earned: 900,
		spent: 100,
		own: { vigor: 1 },
		runs: ["run-a"],
		bought: 450,
		receipts: ["p-1", "p-2"],
		season: { id: 3, xp: 1200 },
		note: "kept",
	};
}

function field(stored: unknown, key: string): unknown {
	return (stored as Record<string, unknown>)[key];
}

describe("wallet codec: unknown fields (SH1)", () => {
	it("decode keeps every unknown top-level field and encode writes it back unchanged", () => {
		const raw = newerShaped();
		const season = raw.season;
		const d = decodeWalletDoc(raw);
		expect(d.extra?.size()).toBe(2);
		const back = encodeWalletDoc(d);
		expect(field(back, "season")).toBe(season);
		expect(field(back, "note")).toBe("kept");
		expect(field(back, "v")).toBe(1);
		expect(walletDocsEqual(decodeWalletDoc(back), d)).toBe(true);
	});

	it("an old-shaped doc reads as before: no bought, receipts or extra", () => {
		const d = decodeWalletDoc({ v: 1, earned: 40, spent: 0, own: {}, runs: [] });
		expect(d.bought).toBe(undefined);
		expect(d.receipts).toBe(undefined);
		expect(d.extra).toBe(undefined);
		const back = encodeWalletDoc(d);
		expect(field(back, "bought")).toBe(undefined);
		expect(field(back, "receipts")).toBe(undefined);
	});

	it("a malformed known field is dropped, never kept as unknown", () => {
		for (const bad of ["9", -3, 1.5, 0 / 0]) {
			const d = decodeWalletDoc({ v: 1, earned: 0, spent: 0, own: {}, runs: [], bought: bad });
			expect(d.bought).toBe(undefined);
			expect(d.extra).toBe(undefined);
		}
		const d = decodeWalletDoc({ v: 1, earned: 0, spent: 0, own: {}, runs: [], receipts: "p-1" });
		expect(d.receipts).toBe(undefined);
		expect(d.extra).toBe(undefined);
	});

	it("a doc of another version still reads as empty (extra included)", () => {
		const raw = newerShaped();
		raw.v = 2;
		const d = decodeWalletDoc(raw);
		expect(d.extra).toBe(undefined);
		expect(walletBalance(d)).toBe(0);
	});

	it("the receipt ring keeps valid ids only and the newest SILVER_SHOP.receiptRing", () => {
		const list: defined[] = ["", 7];
		for (let i = 1; i <= SILVER_SHOP.receiptRing + 5; i++) list.push(`p-${i}`);
		const d = decodeWalletDoc({ v: 1, earned: 0, spent: 0, own: {}, runs: [], receipts: list });
		expect(d.receipts?.size()).toBe(SILVER_SHOP.receiptRing);
		expect(d.receipts?.[0]).toBe("p-6");
	});

	it("equality and clone cover bought, receipts and extra", () => {
		const d = decodeWalletDoc(newerShaped());
		const c = cloneWalletDoc(d);
		expect(walletDocsEqual(c, d)).toBe(true);
		c.bought = 451;
		expect(walletDocsEqual(c, d)).toBe(false);
		const r = cloneWalletDoc(d);
		r.receipts!.push("p-3");
		expect(walletDocsEqual(r, d)).toBe(false);
		expect(d.receipts?.size()).toBe(2);
		const e = cloneWalletDoc(d);
		e.extra!.set("note", "changed");
		expect(walletDocsEqual(e, d)).toBe(false);
		expect(d.extra?.get("note")).toBe("kept");
	});
});

describe("wallet codec: bought Silver in the balance and every transform (SH1)", () => {
	it("balance = earned + bought - spent, never below 0", () => {
		const d = decodeWalletDoc(newerShaped());
		expect(walletBalance(d)).toBe(900 + 450 - 100);
		const poor = emptyWalletDoc();
		poor.spent = 10;
		poor.bought = 5;
		expect(walletBalance(poor)).toBe(0);
	});

	it("a grant and a buy keep bought, the receipts and unknown fields", () => {
		const stored = encodeWalletDoc(decodeWalletDoc(newerShaped()));
		const g = walletTransaction(stored, {
			kind: "grant",
			grant: { runId: "run-b", run: runSilver({ ...emptySilverRunInput(), roomsCleared: 3 }), daily: false },
			ctx: { day: DAY },
		});
		expect(g.ok).toBe(true);
		const b = walletTransaction(g.write, { kind: "buy", itemId: "vigor", level: 2 });
		expect(b.ok).toBe(true);
		const after = b.write;
		expect(field(after, "bought")).toBe(450);
		expect(field(after, "note")).toBe("kept");
		expect([...(field(after, "receipts") as string[])]).toEqual(["p-1", "p-2"]);
		const d = decodeWalletDoc(after);
		expect(d.own.get("vigor")).toBe(2);
		// the purchase spends bought Silver too (one pool, SHD1): Vigor II at tier 3 (150)
		expect(walletBalance(d)).toBe(900 + 450 - 100 - 150 + g.breakdown!.total);
	});

	it("applyGrant / applyBuy never touch bought, receipts or unknown fields", () => {
		const d = decodeWalletDoc(newerShaped());
		const g = applyGrant(d, { runId: "x", run: runSilver(emptySilverRunInput()), daily: false }, { day: DAY });
		const b = applyBuy(d, "vigor");
		for (const r of [g, b]) {
			expect(r.ok).toBe(true);
			if (!r.ok) continue;
			expect(r.doc.bought).toBe(450);
			expect([...(r.doc.receipts ?? [])]).toEqual(["p-1", "p-2"]);
			expect(r.doc.extra?.get("note")).toBe("kept");
		}
	});

	it("`earned` stays Silver from play: the returning-player card ignores bought Silver", () => {
		const d = emptyWalletDoc();
		d.bought = 450;
		const status = walletStatusOf(d, true, DAY);
		expect(status.earned).toBe(0);
		expect(status.balance).toBe(450);
		const records = { loaded: true, solo: { score: 4800, floor: 6 } } as never;
		expect(silverWelcomeShown({ wallet: status, records, seen: false })).toBe(true);
	});
});
