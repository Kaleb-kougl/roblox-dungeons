import { describe, expect, it } from "@rbxts/jest-globals";
import { CHARACTER_IDS, DEFAULT_CHARACTER } from "shared/characters";
import { COSMETIC_ITEMS, COSMETIC_SLOTS, cosmeticItem, isPrismaticItem } from "shared/cosmetics";
import {
	ARMORY_CATALOG,
	ARMORY_TIERS,
	POWER_TIER_CAP,
	armoryItem,
	characterUnlock,
	characterUnlockId,
	cosmeticArmoryItems,
	isRobuxItem,
	itemPrice,
	itemSilverPrice,
	tierPrice,
} from "shared/wallet";

describe("ARMORY_TIERS: one exponential ladder (SVD22)", () => {
	it("is the plan's eight prices", () => {
		expect([...ARMORY_TIERS]).toEqual([40, 80, 150, 300, 600, 1200, 2500, 5000]);
	});

	it("every tier is 1.8 to 2.2 times the one before", () => {
		for (let t = 1; t < ARMORY_TIERS.size(); t++) {
			const ratio = ARMORY_TIERS[t] / ARMORY_TIERS[t - 1];
			expect(ratio >= 1.8 && ratio <= 2.2).toBe(true);
		}
	});

	it("tierPrice reads tiers 1..8 only", () => {
		expect(tierPrice(1)).toBe(40);
		expect(tierPrice(8)).toBe(5000);
		for (const t of [0, 9, 1.5, -1]) expect(tierPrice(t)).toBe(undefined);
	});
});

describe("ARMORY_CATALOG (Catalogue v1)", () => {
	it("order lock: append only (wallets store these ids)", () => {
		expect(ARMORY_CATALOG.map((i) => i.id)).toEqual([
			"vigor",
			"deepFlask",
			"plating",
			"prospector",
			"character.archer",
			// docs/COSMETICS.md CS4: shared/cosmetics COSMETIC_ITEMS, in its order
			"dye.knight.frost",
			"dye.knight.ivory",
			"dye.knight.teal",
			"dye.knight.verdant",
			"dye.knight.azure",
			"dye.knight.lilac",
			"dye.knight.bronze",
			"dye.knight.rose",
			"dye.knight.prismatic",
			"dye.archer.frost",
			"dye.archer.ivory",
			"dye.archer.teal",
			"dye.archer.verdant",
			"dye.archer.cobalt",
			"dye.archer.amethyst",
			"dye.archer.bronze",
			"dye.archer.scarlet",
			"dye.archer.prismatic",
			"outline.azure",
			"outline.silver",
			"outline.jade",
			"outline.sand",
			"outline.rose",
			"outline.moss",
			"outline.violet",
			"outline.orchid",
			"trail.azure",
			"trail.ivory",
			"trail.jade",
			"trail.verdant",
			"trail.cobalt",
			"trail.violet",
			"spark.azure",
			"spark.jade",
			"spark.violet",
			"spark.rose",
			"spark.orchid",
		]);
	});

	it("the plan's levels and tiers", () => {
		const v1 = ARMORY_CATALOG.filter((i) => i.kind !== "cosmetic");
		const tiers = v1.map((i) => `${i.id}:${i.kind}:${i.tiers.join("/")}`);
		expect(tiers).toEqual([
			"vigor:upgrade:1/3",
			"deepFlask:upgrade:3/5",
			"plating:upgrade:5",
			"prospector:upgrade:2/3/4/5",
			"character.archer:unlock:4",
		]);
		let total = 0;
		for (const i of v1) for (let l = 1; l <= i.tiers.size(); l++) total += itemPrice(i.id, l)!;
		expect(total).toBe(2970);
	});

	it("the cosmetics (docs/COSMETICS.md CS4): one row per COSMETIC_ITEMS entry, one level on its slot's tiers", () => {
		const rows = ARMORY_CATALOG.filter((i) => i.kind === "cosmetic");
		expect(rows.map((i) => i.id)).toEqual(COSMETIC_ITEMS.map((c) => c.id));
		expect(cosmeticArmoryItems().map((i) => i.id)).toEqual(rows.map((i) => i.id));
		// The plan's tier bands per slot (Prismatic dyes: tier 8).
		const bands: Record<string, [number, number]> = {
			"dye.knight": [2, 6],
			"dye.archer": [2, 6],
			outline: [2, 5],
			trail: [3, 7],
			spark: [4, 7],
		};
		for (const i of rows) {
			const c = cosmeticItem(i.id)!;
			expect([i.id, i.slot, i.simLever, i.tiers.size(), i.tiers[0]]).toEqual([i.id, c.slot, false, 1, c.tier]);
			const [lo, hi] = isPrismaticItem(i.id) ? [8, 8] : bands[c.slot];
			expect([i.id, i.tiers[0] >= lo && i.tiers[0] <= hi]).toEqual([i.id, true]);
		}
		// Every slot sells something; the Cosmetics tab's total
		for (const slot of COSMETIC_SLOTS) expect([slot, rows.some((i) => i.slot === slot)]).toEqual([slot, true]);
		// CSD13: the animated (Prismatic) cosmetics are Robux-only, with no Silver price; every other one has one.
		let total = 0;
		for (const i of rows) {
			expect([i.id, isRobuxItem(i)]).toEqual([i.id, isPrismaticItem(i.id)]);
			const price = itemPrice(i.id, 1);
			expect([i.id, price === undefined]).toEqual([i.id, isRobuxItem(i)]);
			if (price !== undefined) total += price;
		}
		print(`[cosmetics] ${rows.size()} items, ${total} Silver in all`);
		expect(total > 0).toBe(true);
	});

	it("Robux-only items (CSD13): exactly the animated cosmetics; one level, no Silver price, no sim lever", () => {
		const robux = ARMORY_CATALOG.filter((i) => isRobuxItem(i)).map((i) => i.id);
		expect(robux).toEqual(COSMETIC_ITEMS.filter((c) => isPrismaticItem(c.id)).map((c) => c.id));
		expect(robux).toEqual(["dye.knight.prismatic", "dye.archer.prismatic"]);
		for (const id of robux) {
			const it = armoryItem(id)!;
			expect([it.kind, it.simLever, it.tiers.size(), itemSilverPrice(it, 1)]).toEqual([
				"cosmetic",
				false,
				1,
				undefined,
			]);
		}
		expect(itemSilverPrice(armoryItem("vigor")!, 1)).toBe(40);
	});

	it("ids are unique; every level names a tier; a track's levels rise by at least one tier", () => {
		const seen = new Set<string>();
		for (const i of ARMORY_CATALOG) {
			expect(seen.has(i.id)).toBe(false);
			seen.add(i.id);
			expect(i.tiers.size() > 0).toBe(true);
			for (let l = 0; l < i.tiers.size(); l++) {
				expect(tierPrice(i.tiers[l])).never.toBe(undefined);
				if (l > 0) expect(i.tiers[l] >= i.tiers[l - 1] + 1).toBe(true);
			}
		}
	});

	it("nothing with a sim lever sits above tier 5 (SVD23)", () => {
		for (const i of ARMORY_CATALOG) {
			if (!i.simLever) continue;
			for (const t of i.tiers) expect(t <= POWER_TIER_CAP).toBe(true);
		}
	});

	it("cosmetics name a slot, unlocks a character", () => {
		for (const i of ARMORY_CATALOG) {
			if (i.kind === "cosmetic") expect(i.slot).never.toBe(undefined);
			if (i.kind === "unlock") expect(i.character).never.toBe(undefined);
		}
	});

	it("every character but the Knight has an unlock; the Knight none", () => {
		expect(characterUnlock(DEFAULT_CHARACTER)).toBe(undefined);
		for (const c of CHARACTER_IDS) {
			if (c === DEFAULT_CHARACTER) continue;
			expect(characterUnlock(c)?.id).toBe(characterUnlockId(c));
		}
		expect(itemPrice("character.archer", 1)).toBe(300);
	});

	it("itemPrice: unknown items and levels are undefined", () => {
		expect(itemPrice("vigor", 1)).toBe(40);
		expect(itemPrice("vigor", 2)).toBe(150);
		expect(itemPrice("vigor", 3)).toBe(undefined);
		expect(itemPrice("vigor", 0)).toBe(undefined);
		expect(itemPrice("might", 1)).toBe(undefined);
		expect(armoryItem("Vigor")).toBe(undefined);
	});
});
