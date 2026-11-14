import { describe, expect, it } from "@rbxts/jest-globals";
import {
	WALLET,
	cloneWalletDoc,
	decodeWalletDoc,
	emptyWalletDoc,
	encodeWalletDoc,
	ownsCharacter,
	walletBalance,
	walletDocsEqual,
	walletStatusOf,
	ownedLevel,
	walletUpgradeLevels,
	type WalletDoc,
} from "shared/wallet";

function sample(): WalletDoc {
	const d = emptyWalletDoc();
	d.earned = 900;
	d.spent = 340;
	d.own.set("vigor", 2);
	d.own.set("character.archer", 1);
	d.eq = new Map([["outline", "outline.gold"]]);
	d.runs.push("run-a", "run-b");
	d.runDay = 316;
	d.dailyDay = 315;
	return d;
}

describe("WalletDoc codec", () => {
	it("round trips", () => {
		const d = sample();
		const back = decodeWalletDoc(encodeWalletDoc(d));
		expect(walletDocsEqual(back, d)).toBe(true);
		expect(back.own.get("vigor")).toBe(2);
		expect(back.eq?.get("outline")).toBe("outline.gold");
		expect([...back.runs]).toEqual(["run-a", "run-b"]);
		expect([back.runDay, back.dailyDay]).toEqual([316, 315]);
	});

	it("a missing doc is an empty wallet", () => {
		const d = decodeWalletDoc(undefined);
		expect(walletDocsEqual(d, emptyWalletDoc())).toBe(true);
		expect(walletBalance(d)).toBe(0);
	});

	it("junk never throws and reads as empty fields", () => {
		const junk: unknown[] = [
			"x",
			5,
			true,
			{},
			{ v: 2, earned: 10 },
			{ v: "1" },
			{ v: 1, earned: -5, spent: 0 / 0, own: "no", runs: 3, runDay: 1.5 },
			{ v: 1, earned: 10, own: { vigor: 0, plating: -1, deepFlask: 2.5, "": 1 }, runs: [1, "", "ok"] },
		];
		for (const j of junk) {
			const d = decodeWalletDoc(j);
			expect(d.earned >= 0 && d.spent >= 0).toBe(true);
			for (const [, level] of d.own) expect(level >= 1).toBe(true);
		}
		const last = decodeWalletDoc(junk[junk.size() - 1]);
		expect(last.earned).toBe(10);
		expect(last.own.size()).toBe(0);
		expect([...last.runs]).toEqual(["ok"]);
		expect(decodeWalletDoc({ v: 2, earned: 10 }).earned).toBe(0); // another version reads as empty
	});

	it("levels are kept as stored (a newer catalogue's) and capped on read; ids a newer catalogue added are kept", () => {
		const d = decodeWalletDoc({ v: 1, earned: 0, spent: 0, own: { vigor: 9, "cosmetic.future": 3 }, runs: [] });
		expect(d.own.get("vigor")).toBe(9);
		expect(decodeWalletDoc(encodeWalletDoc(d)).own.get("vigor")).toBe(9); // a rewrite never takes a level away
		expect(ownedLevel(d, "vigor")).toBe(2);
		expect(walletUpgradeLevels(d).vigor).toBe(2);
		expect(d.own.get("cosmetic.future")).toBe(3);
		expect(decodeWalletDoc(encodeWalletDoc(d)).own.get("cosmetic.future")).toBe(3);
	});

	it("the run ring keeps the last WALLET.runRing ids", () => {
		const runs: string[] = [];
		for (let i = 0; i < WALLET.runRing + 5; i++) runs.push(`r${i}`);
		const d = decodeWalletDoc({ v: 1, earned: 0, spent: 0, own: {}, runs });
		expect(d.runs.size()).toBe(WALLET.runRing);
		expect(d.runs[0]).toBe("r5");
	});

	it("clone is independent", () => {
		const a = sample();
		const b = cloneWalletDoc(a);
		b.own.set("vigor", 1);
		b.runs.push("c");
		expect(a.own.get("vigor")).toBe(2);
		expect(a.runs.size()).toBe(2);
	});
});

describe("wallet reads", () => {
	it("the balance is earned - spent, never below 0", () => {
		expect(walletBalance(sample())).toBe(560);
		const d = emptyWalletDoc();
		d.spent = 10;
		expect(walletBalance(d)).toBe(0);
	});

	it("ownsCharacter: the Knight always; the Archer by her unlock; no wallet = the Knight only", () => {
		expect(ownsCharacter(undefined, "knight")).toBe(true);
		expect(ownsCharacter(undefined, "archer")).toBe(false);
		expect(ownsCharacter(emptyWalletDoc(), "archer")).toBe(false);
		expect(ownsCharacter(sample(), "archer")).toBe(true);
	});

	it("walletUpgradeLevels: the sim-lever tracks as plain numbers", () => {
		expect(walletUpgradeLevels(undefined)).toEqual({ vigor: 0, deepFlask: 0, plating: 0 });
		const d = sample();
		d.own.set("deepFlask", 1);
		d.own.set("prospector", 3);
		expect(walletUpgradeLevels(d)).toEqual({ vigor: 2, deepFlask: 1, plating: 0 });
	});

	it("walletStatusOf: loaded fields, sorted lists, the day's open bonuses", () => {
		expect(walletStatusOf(undefined, true, 316)).toEqual({ loaded: false });
		expect(walletStatusOf(sample(), false, 316)).toEqual({ loaded: false });
		const s = walletStatusOf(sample(), true, 316);
		expect(s.balance).toBe(560);
		expect(s.own).toEqual([
			{ itemId: "character.archer", level: 1 },
			{ itemId: "vigor", level: 2 },
		]);
		expect(s.equipped).toEqual([{ slot: "outline", itemId: "outline.gold" }]);
		expect([s.firstRunBonusOpen, s.dailyBonusOpen]).toEqual([false, true]);
		expect(walletStatusOf(sample(), true, 317).firstRunBonusOpen).toBe(true);
		expect(s.goals?.size()).toBe(2);
	});
});
