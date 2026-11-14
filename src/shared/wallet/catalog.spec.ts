import { describe, expect, it } from "@rbxts/jest-globals";
import { CHARACTER_IDS, DEFAULT_CHARACTER } from "shared/characters";
import {
	ARMORY_CATALOG,
	ARMORY_TIERS,
	POWER_TIER_CAP,
	armoryItem,
	characterUnlock,
	characterUnlockId,
	itemPrice,
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
		]);
	});

	it("the plan's levels and tiers", () => {
		const tiers = ARMORY_CATALOG.map((i) => `${i.id}:${i.kind}:${i.tiers.join("/")}`);
		expect(tiers).toEqual([
			"vigor:upgrade:1/3",
			"deepFlask:upgrade:3/5",
			"plating:upgrade:5",
			"prospector:upgrade:2/3/4/5",
			"character.archer:unlock:4",
		]);
		let total = 0;
		for (const i of ARMORY_CATALOG) for (let l = 1; l <= i.tiers.size(); l++) total += itemPrice(i.id, l)!;
		expect(total).toBe(2970);
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
