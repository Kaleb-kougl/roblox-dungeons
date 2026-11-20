import { describe, expect, it } from "@rbxts/jest-globals";
import {
	COSMETIC_PASSES,
	armoryItem,
	cosmeticPassIdOf,
	cosmeticPassItemOf,
	cosmeticPassStatusFields,
	cosmeticPassesFor,
	isRobuxItem,
	parseFakePasses,
	robuxItemIds,
	type CosmeticPassTable,
} from "shared/wallet";

const GAME = 42;
const TABLE: CosmeticPassTable = new Map([[GAME, new Map([["dye.knight.prismatic", 1001]])]]);

describe("COSMETIC_PASSES (docs/COSMETICS.md CSD13)", () => {
	it("every pass sells a Robux-only item, and no two items share a pass", () => {
		for (const [, m] of COSMETIC_PASSES) {
			const seen = new Set<number>();
			for (const [itemId, passId] of m) {
				expect([itemId, isRobuxItem(armoryItem(itemId))]).toEqual([itemId, true]);
				expect(seen.has(passId)).toBe(false);
				seen.add(passId);
			}
		}
	});

	it("lookups: item -> pass, pass -> item; unknown universes and passes: none", () => {
		expect(cosmeticPassIdOf(GAME, "dye.knight.prismatic", TABLE)).toBe(1001);
		expect(cosmeticPassIdOf(GAME, "dye.archer.prismatic", TABLE)).toBe(undefined);
		expect(cosmeticPassItemOf(GAME, 1001, TABLE)).toBe("dye.knight.prismatic");
		expect(cosmeticPassItemOf(GAME, 1002, TABLE)).toBe(undefined);
		expect(cosmeticPassesFor(7, TABLE)).toBe(undefined);
	});

	it("robuxItemIds: the Prismatic dyes, catalogue order", () => {
		expect(robuxItemIds()).toEqual(["dye.knight.prismatic", "dye.archer.prismatic"]);
	});
});

describe("parseFakePasses (KV_FakePasses)", () => {
	it("off, one whole price, or nothing", () => {
		expect(parseFakePasses("off")).toEqual({ on: false });
		expect(parseFakePasses(" OFF ")).toEqual({ on: false });
		expect(parseFakePasses("299")).toEqual({ on: true, robux: 299 });
		expect(parseFakePasses(" 99 ")).toEqual({ on: true, robux: 99 });
		for (const bad of ["0", "-5", "2.5", "1,2", "", "abc", 5]) expect(parseFakePasses(bad)).toBe(undefined);
	});
});

describe("cosmeticPassStatusFields", () => {
	it("live: the items with a pass here", () => {
		expect(cosmeticPassStatusFields(GAME, undefined, TABLE)).toEqual([
			{ itemId: "dye.knight.prismatic", passId: 1001 },
		]);
		expect(cosmeticPassStatusFields(7, undefined, TABLE)).toEqual([]);
	});

	it("Studio's fake: every Robux-only item at the fake price, or none", () => {
		expect(cosmeticPassStatusFields(7, { on: true, robux: 299 }, TABLE)).toEqual([
			{ itemId: "dye.knight.prismatic", fakeRobux: 299 },
			{ itemId: "dye.archer.prismatic", fakeRobux: 299 },
		]);
		expect(cosmeticPassStatusFields(GAME, { on: false }, TABLE)).toEqual([]);
	});
});
