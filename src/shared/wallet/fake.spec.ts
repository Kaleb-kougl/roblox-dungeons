import { describe, expect, it } from "@rbxts/jest-globals";
import { parseFakeWallet, walletBalance } from "shared/wallet";

const DAY = 316;

describe("parseFakeWallet (KV_FakeWallet)", () => {
	it('"0" and "460": loaded, that balance, nothing owned, bonuses open', () => {
		const zero = parseFakeWallet("0", DAY)!;
		expect([zero.loaded, walletBalance(zero.doc), zero.doc.own.size()]).toEqual([true, 0, 0]);
		const rich = parseFakeWallet(" 460 ", DAY)!;
		expect(walletBalance(rich.doc)).toBe(460);
		expect([rich.doc.runDay, rich.doc.dailyDay]).toEqual([undefined, undefined]);
	});

	it('"460;vigor:2,character.archer:1": those levels', () => {
		const f = parseFakeWallet("460;vigor:2, character.archer:1", DAY)!;
		expect(f.loaded).toBe(true);
		expect(walletBalance(f.doc)).toBe(460);
		expect([f.doc.own.get("vigor"), f.doc.own.get("character.archer")]).toEqual([2, 1]);
	});

	it('"unknown": not loaded', () => {
		const f = parseFakeWallet("UNKNOWN", DAY)!;
		expect(f.loaded).toBe(false);
	});

	it('a trailing ";claimed" takes today\'s bonuses', () => {
		const a = parseFakeWallet("460;claimed", DAY)!;
		expect([a.doc.runDay, a.doc.dailyDay, walletBalance(a.doc)]).toEqual([DAY, DAY, 460]);
		const b = parseFakeWallet("460;vigor:1;claimed", DAY)!;
		expect([b.doc.own.get("vigor"), b.doc.runDay]).toEqual([1, DAY]);
	});

	it("anything else is no fake", () => {
		for (const bad of [
			"",
			"   ",
			"claimed",
			"-5",
			"4.5",
			"lots",
			"460;",
			"460;vigor",
			"460;vigor:3",
			"460;vigor:0",
			"460;Vigor:1",
			"460;might:1",
			"460;vigor:1;extra",
			"unknown;vigor:1",
			5,
			undefined,
		]) {
			expect(parseFakeWallet(bad, DAY)).toBe(undefined);
		}
	});
});
