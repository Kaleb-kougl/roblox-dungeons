// docs/COSMETICS.md CS4: the cosmetic item list (append-only ids, slots, tiers) and a player's look: cosmeticLookOf
// from equipped slots for the character played, readCosmeticLook for a value off the wire.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CHARACTER_IDS } from "shared/characters";
import {
	COSMETIC_ITEMS,
	COSMETIC_SLOTS,
	DYE_SLOTS,
	NO_LOOK,
	cosmeticItem,
	cosmeticItemsOf,
	cosmeticLookOf,
	dyeSlotOf,
	equippedMapOf,
	isDefaultLook,
	isPrismaticItem,
	readCosmeticLook,
	sameCosmeticLook,
} from "shared/cosmetics";

const DRESSED = new Map([
	["dye.knight", "dye.knight.teal"],
	["dye.archer", "dye.archer.frost"],
	["outline", "outline.azure"],
	["trail", "trail.jade"],
	["spark", "spark.rose"],
]);

describe("COSMETIC_ITEMS", () => {
	it("ids are unique, `<slot>.<colour>`, each in a known slot; one Prismatic dye per character, last in its slot", () => {
		const seen = new Set<string>();
		for (const it of COSMETIC_ITEMS) {
			expect(seen.has(it.id)).toBe(false);
			seen.add(it.id);
			expect([it.id, COSMETIC_SLOTS.includes(it.slot)]).toEqual([it.id, true]);
			expect([it.id, it.id.sub(1, it.slot.size() + 1)]).toEqual([it.id, `${it.slot}.`]);
			expect(cosmeticItem(it.id)).toBe(it);
		}
		for (const c of CHARACTER_IDS) {
			const slot = dyeSlotOf(c);
			expect(DYE_SLOTS[c]).toBe(slot);
			const dyes = cosmeticItemsOf(slot);
			const prismatic = dyes.filter((d) => isPrismaticItem(d.id));
			expect(prismatic.map((d) => d.id)).toEqual([`${slot}.prismatic`]);
			expect(dyes[dyes.size() - 1].id).toBe(`${slot}.prismatic`);
		}
		expect(cosmeticItem("vigor")).toBe(undefined);
		expect(cosmeticItem(5)).toBe(undefined);
		expect(isPrismaticItem("dye.knight.teal")).toBe(false);
	});
});

describe("cosmeticLookOf", () => {
	it("the played character's dye and the three shared slots", () => {
		expect(cosmeticLookOf(DRESSED, "knight")).toEqual({
			dye: "dye.knight.teal",
			outline: "outline.azure",
			trail: "trail.jade",
			spark: "spark.rose",
		});
		expect(cosmeticLookOf(DRESSED, "archer").dye).toBe("dye.archer.frost");
	});

	it("an unknown wallet or nothing equipped is the default look; junk entries are dropped", () => {
		expect(cosmeticLookOf(undefined, "knight")).toEqual({});
		expect(isDefaultLook(cosmeticLookOf(new Map(), "archer"))).toBe(true);
		const junk = new Map([
			["dye.knight", "dye.archer.frost"], // another character's dye in the Knight's slot
			["outline", "trail.jade"], // wrong slot
			["trail", "trail.nope"], // unknown
			["spark", "spark.jade"],
		]);
		expect(cosmeticLookOf(junk, "knight")).toEqual({ spark: "spark.jade" });
		// The Archer's dye slot is empty here: no dye, whatever the Knight wears.
		expect(cosmeticLookOf(new Map([["dye.knight", "dye.knight.rose"]]), "archer")).toEqual({});
	});

	it("equippedMapOf reads the wallet payload's list", () => {
		const m = equippedMapOf([
			{ slot: "outline", itemId: "outline.jade" },
			{ slot: "dye.archer", itemId: "dye.archer.ivory" },
		]);
		expect(cosmeticLookOf(m, "archer")).toEqual({ dye: "dye.archer.ivory", outline: "outline.jade" });
		expect(equippedMapOf(undefined).size()).toBe(0);
	});
});

describe("readCosmeticLook (a value off the wire)", () => {
	it("keeps known items in their slots, drops the rest; never throws", () => {
		expect(
			readCosmeticLook({
				dye: "dye.archer.prismatic",
				outline: "outline.moss",
				trail: "trail.cobalt",
				spark: "spark.orchid",
			}),
		).toEqual({
			dye: "dye.archer.prismatic",
			outline: "outline.moss",
			trail: "trail.cobalt",
			spark: "spark.orchid",
		});
		expect(
			readCosmeticLook({ dye: "outline.moss", outline: "dye.knight.rose", trail: 3, spark: "spark.x", junk: 1 }),
		).toEqual({});
		for (const bad of [undefined, 5, "dye.knight.rose", true]) expect(readCosmeticLook(bad)).toEqual({});
	});

	it("sameCosmeticLook / isDefaultLook", () => {
		expect(sameCosmeticLook(cosmeticLookOf(DRESSED, "knight"), cosmeticLookOf(DRESSED, "knight"))).toBe(true);
		expect(sameCosmeticLook(cosmeticLookOf(DRESSED, "knight"), cosmeticLookOf(DRESSED, "archer"))).toBe(false);
		expect(isDefaultLook(NO_LOOK)).toBe(true);
	});
});
