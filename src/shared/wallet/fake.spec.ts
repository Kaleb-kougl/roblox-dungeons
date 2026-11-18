import { describe, expect, it } from "@rbxts/jest-globals";
import { cosmeticItem, cosmeticLookOf } from "shared/cosmetics";
import { ARMORY_CATALOG, WALLET_FAKE_DRESSED, parseFakeWallet, walletBalance, walletEquipped } from "shared/wallet";

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

describe("parseFakeWallet: cosmetics (docs/COSMETICS.md CS4)", () => {
	it('an item ending in "*" is owned and equipped in its slot', () => {
		const f = parseFakeWallet("6000;outline.azure:1*, dye.knight.teal:1*, trail.jade:1", DAY)!;
		expect([f.doc.own.get("outline.azure"), f.doc.own.get("trail.jade")]).toEqual([1, 1]);
		expect(f.doc.eq?.get("outline")).toBe("outline.azure");
		expect(f.doc.eq?.get("dye.knight")).toBe("dye.knight.teal");
		expect(f.doc.eq?.get("trail")).toBe(undefined);
		expect(walletEquipped(f.doc)?.get("outline")).toBe("outline.azure");
	});

	it('"cosmetics" owns every cosmetic, none equipped; "dressed" also equips WALLET_FAKE_DRESSED', () => {
		const owned = parseFakeWallet("6000;vigor:2,cosmetics", DAY)!;
		for (const it of ARMORY_CATALOG) {
			if (it.kind === "cosmetic") expect([it.id, owned.doc.own.get(it.id)]).toEqual([it.id, 1]);
		}
		expect(owned.doc.own.get("vigor")).toBe(2);
		expect(owned.doc.eq).toBe(undefined);
		const dressed = parseFakeWallet("6000;Dressed", DAY)!;
		const eq = walletEquipped(dressed.doc)!;
		expect(eq.size()).toBe(WALLET_FAKE_DRESSED.size());
		for (const id of WALLET_FAKE_DRESSED) expect(eq.get(cosmeticItem(id)!.slot)).toBe(id);
		expect(cosmeticLookOf(eq, "archer")).toEqual({
			dye: "dye.archer.prismatic",
			outline: "outline.azure",
			trail: "trail.violet",
			spark: "spark.jade",
		});
	});

	it("equipping a non-cosmetic or a malformed mark is no fake", () => {
		for (const bad of ["6000;vigor:1*", "6000;*", "6000;outline.azure*", "6000;outline.azure:1**"]) {
			expect([bad, parseFakeWallet(bad, DAY)]).toEqual([bad, undefined]);
		}
	});
});
