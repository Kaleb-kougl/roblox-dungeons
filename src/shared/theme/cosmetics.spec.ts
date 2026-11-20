// docs/COSMETICS.md CS3 / CS10: the theme side of cosmetics. Every cosmetic in shared/cosmetics COSMETIC_ITEMS has a
// colour (or Prismatic stops) here and nothing else does; prismaticColor loops smoothly; the strings are
// REQUIRED_STRING_KEYS' last ones and every bundled pack has them; and cosmeticReport holds the whole shipped
// catalogue to the readability rules 1-5 on every bundled pack, every check's worst margin printed per item (the table
// in docs/COSMETICS.md "As built: theme (CS3)"), on the dye means art:build measured (the vale layout).
import { describe, expect, it } from "@rbxts/jest-globals";
import { CHARACTER_IDS, characterDef, type CharacterId } from "shared/characters";
import { COSMETIC_ITEMS, COSMETIC_SLOTS, isPrismaticItem } from "shared/cosmetics";
import { colorDifference as colorDifferenceOf, contrastRatio, parseHex, toHex, type Rgb } from "./color";
import { REQUIRED_STRING_KEYS } from "./contract";
import { COSMETIC_RULES, cosmeticReport, dyedMean, type CosmeticEntry, type CosmeticRule } from "./cosmeticReport";
import {
	COSMETIC_COLORS,
	COSMETIC_DYE_SETS,
	COSMETIC_KEYS,
	COSMETIC_STRING_KEYS,
	PRISMATIC,
	PRISMATIC_STOPS,
	cosmeticColor,
	cosmeticHex,
	cosmeticNameKey,
	cosmeticSlotKey,
	cosmeticStringKeys,
	hasCosmeticColor,
	prismaticColor,
	prismaticStopsOf,
} from "./cosmetics";
import { THEME_PACKS } from "./packs";
import { PLACEHOLDER_MANIFEST } from "./packs/placeholder";
import { valeDyeMeanValue, valeDyeSourceMean } from "./packs/vale";
import { runOf } from "./testing";
import type { HexColor } from "./types";
import { deepClone, sortedKeys, type Obj } from "./util";

/** Each character's dye mean: the atlas pipeline's measurement in the generated layout (required: no fallback). */
function dyeMeans(): Record<CharacterId, number> {
	const out = {} as Record<CharacterId, number>;
	for (const c of CHARACTER_IDS) {
		const mean = valeDyeMeanValue(COSMETIC_DYE_SETS[c]);
		if (mean === undefined) error(`${COSMETIC_DYE_SETS[c]} has no dyeMeanValue in the vale layout (art:build)`, 0);
		out[c] = mean;
	}
	return out;
}

/** Each character's undyed region mean colour (rule 3's baseline): the generated layout's (required: no fallback). */
function dyeSources(): Record<CharacterId, HexColor> {
	const out = {} as Record<CharacterId, HexColor>;
	for (const c of CHARACTER_IDS) {
		const source = valeDyeSourceMean(COSMETIC_DYE_SETS[c]);
		if (source === undefined)
			error(`${COSMETIC_DYE_SETS[c]} has no dyeSourceMean in the vale layout (art:build)`, 0);
		out[c] = source;
	}
	return out;
}

const fixed = (n: number, d: number) => `%.${d}f`.format(n);
const near = (a: Rgb, b: Rgb) => math.abs(a.r - b.r) + math.abs(a.g - b.g) + math.abs(a.b - b.b);

describe("cosmetics: colours", () => {
	it("every cosmetic item has exactly one colour source (a hex, or Prismatic stops), and nothing else has one", () => {
		const keyed = new Set<string>();
		for (const id of sortedKeys(COSMETIC_COLORS)) keyed.add(id);
		for (const id of sortedKeys(PRISMATIC_STOPS)) {
			expect([id, keyed.has(id)]).toEqual([id, false]);
			keyed.add(id);
		}
		expect(keyed.size()).toBe(COSMETIC_ITEMS.size());
		for (const it of COSMETIC_ITEMS) {
			expect([it.id, hasCosmeticColor(it.id)]).toEqual([it.id, true]);
			expect([it.id, prismaticStopsOf(it.id) !== undefined]).toEqual([it.id, isPrismaticItem(it.id)]);
			expect([it.id, cosmeticHex(it.id) !== undefined]).toEqual([it.id, !isPrismaticItem(it.id)]);
			const hex = cosmeticHex(it.id);
			if (hex !== undefined) expect([it.id, parseHex(hex) !== undefined]).toEqual([it.id, true]);
		}
		expect(hasCosmeticColor("vigor")).toBe(false);
		expect(cosmeticColor("vigor")).toBe(undefined);
	});

	it("a dye's set is its character's visual (shared/characters CHARACTERS)", () => {
		for (const c of CHARACTER_IDS) expect([c, COSMETIC_DYE_SETS[c]]).toEqual([c, characterDef(c).visualId]);
	});

	it("no two items of a slot share a colour", () => {
		for (const slot of COSMETIC_SLOTS) {
			const seen = new Set<string>();
			for (const it of COSMETIC_ITEMS) {
				if (it.slot !== slot) continue;
				const key = cosmeticHex(it.id) ?? `stops:${it.id}`;
				expect([it.id, seen.has(key)]).toEqual([it.id, false]);
				seen.add(key);
			}
		}
	});
});

describe("cosmetics: prismaticColor (CS10)", () => {
	const stops: HexColor[] = ["#ff0000", "#00ff00", "#0000ff"];
	const P = PRISMATIC.periodSec;

	it("sits on stop i at the start of segment i, loops, and wraps negative time", () => {
		for (let i = 0; i < stops.size(); i++) {
			expect([i, near(prismaticColor(stops, (i * P) / stops.size()), parseHex(stops[i])!) < 1e-6]).toEqual([
				i,
				true,
			]);
		}
		expect(prismaticColor(stops, 0)).toEqual(parseHex(stops[0]));
		expect(near(prismaticColor(stops, P), parseHex(stops[0])!) < 1e-6).toBe(true);
		expect(near(prismaticColor(stops, 3 * P), parseHex(stops[0])!) < 1e-6).toBe(true);
		expect(near(prismaticColor(stops, -P / 6), prismaticColor(stops, (5 * P) / 6)) < 1e-9).toBe(true);
	});

	it("is continuous and eases at every stop (no jump anywhere in the loop, the last segment back to the first)", () => {
		const n = 600;
		let worst = 0;
		for (let k = 0; k < n; k++) {
			const a = prismaticColor(stops, (k / n) * P);
			const b = prismaticColor(stops, ((k + 1) / n) * P);
			worst = math.max(worst, near(a, b));
		}
		// a full 255 swing per channel over a segment of n / 3 steps: the eased peak is 1.5x the linear step
		expect(worst <= (255 * 2 * 1.5) / (n / stops.size()) + 1e-6).toBe(true);
		// eased: right after a stop the colour has barely moved
		const s = prismaticColor(stops, 0.001);
		expect(near(s, parseHex(stops[0])!) < 0.01).toBe(true);
	});

	it("reduced motion holds the first stop (t = 0); one stop is constant; none is black", () => {
		for (const id of sortedKeys(PRISMATIC_STOPS)) {
			expect(cosmeticColor(id, 0)).toEqual(parseHex(prismaticStopsOf(id)![0]));
		}
		expect(prismaticColor(["#123456"], 7.3)).toEqual(parseHex("#123456"));
		expect(prismaticColor([], 1)).toEqual({ r: 0, g: 0, b: 0 });
	});
});

describe("cosmetics: strings", () => {
	it("are REQUIRED_STRING_KEYS' last ones, distinct, in every bundled pack", () => {
		expect([...cosmeticStringKeys()]).toEqual([...COSMETIC_STRING_KEYS]);
		expect(COSMETIC_STRING_KEYS.size()).toBe(12 + COSMETIC_SLOTS.size() + COSMETIC_ITEMS.size());
		expect(runOf(REQUIRED_STRING_KEYS, COSMETIC_STRING_KEYS)).toEqual([...COSMETIC_STRING_KEYS]);
		expect(new Set(REQUIRED_STRING_KEYS).size()).toBe(REQUIRED_STRING_KEYS.size());
		for (const p of sortedKeys(THEME_PACKS))
			for (const key of COSMETIC_STRING_KEYS)
				expect([p, key, typeIs(THEME_PACKS[p].strings[key], "string")]).toEqual([p, key, true]);
	});

	it("the placeholder English", () => {
		const s = PLACEHOLDER_MANIFEST.strings;
		expect(s[COSMETIC_KEYS.tryOn]).toBe("Try on");
		expect(s[cosmeticSlotKey("trail")]).toBe("Roll trail");
		expect(s[cosmeticNameKey("dye.knight.azure")]).toBe("Azure Plate");
		expect(s[cosmeticNameKey("dye.archer.prismatic")]).toBe("Prismatic Leathers");
		expect(s[cosmeticNameKey("spark.orchid")]).toBe("Orchid Sparks");
	});
});

/** Every rule an item is held to, by slot. */
function rulesOf(slot: string): ReadonlyArray<CosmeticRule> {
	if (slot === "outline") return ["outline"];
	if (slot === "trail") return ["trail"];
	if (slot === "spark") return ["spark"];
	return ["danger", "pickup", "floor"];
}

/** The worst (value - min) margin per rule of `itemId`, and the entry it came from. */
function worstByRule(report: ReadonlyArray<CosmeticEntry>, itemId: string): Map<CosmeticRule, CosmeticEntry> {
	const out = new Map<CosmeticRule, CosmeticEntry>();
	for (const e of report) {
		if (e.itemId !== itemId) continue;
		const w = out.get(e.rule);
		if (w === undefined || e.value - e.min < w.value - w.min) out.set(e.rule, e);
	}
	return out;
}

describe("cosmetics: cosmeticReport (readability rules 1-5)", () => {
	it("the shipped catalogue passes every rule on every bundled pack (every item's worst margins printed)", () => {
		const means = dyeMeans();
		const sources = dyeSources();
		for (const c of CHARACTER_IDS) {
			print(`[cosmetics] ${c} dye mean ${fixed(means[c], 4)}, undyed ${sources[c]} (vale layout)`);
		}
		for (const p of sortedKeys(THEME_PACKS)) {
			const report = cosmeticReport(THEME_PACKS[p], means, sources);
			for (const it of COSMETIC_ITEMS) {
				const worst = worstByRule(report, it.id);
				const parts = new Array<string>();
				for (const rule of rulesOf(it.slot)) {
					const e = worst.get(rule);
					expect([p, it.id, rule, e !== undefined]).toEqual([p, it.id, rule, true]);
					parts.push(`${rule} ${fixed(e!.value, 2)} (min ${fixed(e!.min, 2)}) vs ${e!.against}`);
				}
				const shown = cosmeticHex(it.id) ?? "prismatic";
				print(`[cosmetics] ${p} ${it.id} ${shown}: ${parts.join(" | ")}`);
			}
			for (const e of report) {
				if (!e.ok) print(`[cosmetics] FAIL ${p} ${e.itemId} ${e.rule} ${e.color} vs ${e.against} ${e.value}`);
				expect([p, e.itemId, e.rule, e.sample, e.against, e.ok]).toEqual([
					p,
					e.itemId,
					e.rule,
					e.sample,
					e.against,
					true,
				]);
			}
		}
	});

	it("covers every rule: dyes on the dyed mean (danger, pickup, floor), Prismatic every stop and sample, the rest", () => {
		const report = cosmeticReport(THEME_PACKS.vale, dyeMeans(), dyeSources());
		const biomes = sortedKeys((THEME_PACKS.vale as unknown as Obj).biomes as Obj).size();
		for (const it of COSMETIC_ITEMS) {
			const mine = report.filter((e) => e.itemId === it.id);
			const rules = new Set(mine.map((e) => e.rule));
			for (const rule of rulesOf(it.slot)) expect([it.id, rule, rules.has(rule)]).toEqual([it.id, rule, true]);
			if (isPrismaticItem(it.id)) {
				const samples = new Set(mine.map((e) => e.sample));
				expect(samples.size()).toBe(prismaticStopsOf(it.id)!.size() * PRISMATIC.samplesPerSegment);
			}
			if (rulesOf(it.slot).includes("floor")) {
				const perSample = mine.filter((e) => e.rule === "floor" && (e.sample ?? 0) === 0).size();
				expect([it.id, perSample]).toEqual([it.id, biomes]);
			}
		}
		// the dyed mean is the colour x the mean, per channel
		const c = parseHex(cosmeticHex("dye.knight.teal")!)!;
		const e = report.find((x) => x.itemId === "dye.knight.teal" && x.rule === "floor")!;
		expect(e.color).toBe(toHex(dyedMean(c, dyeMeans().knight)));
		expect(COSMETIC_RULES.minDangerDifference).toBe(40);
		// rule 3's bar: min(3 : 1, the undyed region's own contrast on that floor)
		const sources = dyeSources();
		for (const x of report) {
			if (x.rule !== "floor") continue;
			const character = x.slot === "dye.knight" ? "knight" : "archer";
			const bar = math.min(COSMETIC_RULES.minFloorContrast, contrastRatio(sources[character], x.againstColor));
			expect([x.itemId, x.against, math.abs(x.min - bar) < 1e-12]).toEqual([x.itemId, x.against, true]);
		}
	});

	it("rule 3's baseline: the Knight's plate reads above 3 : 1 on every floor (his bar is 3), the Archer's leathers not", () => {
		const sources = dyeSources();
		const m = THEME_PACKS.vale as unknown as Obj;
		let knightLow = math.huge;
		let archerHigh = 0;
		for (const b of sortedKeys(m.biomes as Obj)) {
			const floor = ((m.biomes as Obj)[b] as Obj).floor as string;
			knightLow = math.min(knightLow, contrastRatio(sources.knight, floor));
			archerHigh = math.max(archerHigh, contrastRatio(sources.archer, floor));
		}
		print(`[cosmetics] undyed plate >= ${fixed(knightLow, 2)} : 1, undyed leathers <= ${fixed(archerHigh, 2)} : 1`);
		expect(knightLow >= COSMETIC_RULES.minFloorContrast).toBe(true);
		expect(archerHigh < COSMETIC_RULES.minFloorContrast).toBe(true);
		// without a baseline the full 3 : 1 applies (never a looser bar): her rich dyes fail it
		const strict = cosmeticReport(THEME_PACKS.vale, dyeMeans());
		expect(strict.some((x) => x.itemId === "dye.archer.cobalt" && x.rule === "floor" && !x.ok)).toBe(true);
		for (const x of strict) if (x.rule === "floor") expect(x.min).toBe(COSMETIC_RULES.minFloorContrast);
	});

	it("the rules on probe colours (the prototype's table): crimson, ember and gilded Knights fail, scarlet fails the floor", () => {
		const m = deepClone(PLACEHOLDER_MANIFEST) as unknown as Obj;
		const colors = m.colors as Obj;
		const means = dyeMeans();
		const probe = (hex: HexColor, mean: number) => {
			const dyed = toHex(dyedMean(parseHex(hex)!, mean));
			const out = new Array<string>();
			const diff = (role: string) => colorDifferenceOf(dyed, colors[role] as string);
			for (const role of COSMETIC_RULES.danger)
				if (diff(role) < COSMETIC_RULES.minDangerDifference) out.push(`danger:${role}`);
			for (const role of COSMETIC_RULES.pickup)
				if (diff(role) < COSMETIC_RULES.minPickupDifference) out.push(`pickup:${role}`);
			return out;
		};
		expect(probe("#dc2832", means.knight).includes("danger:enemyOutline")).toBe(true);
		expect(probe("#e67828", means.knight).includes("danger:telegraph")).toBe(true);
		expect(probe("#f0be28", means.knight).includes("danger:telegraph")).toBe(true);
		expect(probe("#c0182a", means.knight)).toEqual([]);
		// ... but scarlet is too dark a Knight for the floors (rule 3: his bar is 3): why it shipped lightened, as Rose
		const scarlet = toHex(dyedMean(parseHex("#c0182a")!, means.knight));
		let darkest = math.huge;
		for (const b of sortedKeys(m.biomes as Obj)) {
			darkest = math.min(darkest, contrastRatio(scarlet, ((m.biomes as Obj)[b] as Obj).floor as string));
		}
		expect(darkest < COSMETIC_RULES.minFloorContrast).toBe(true);
		// a report on a pack without colours, or nothing at all: nothing
		expect(cosmeticReport(undefined, means)).toEqual([]);
		expect(cosmeticReport({ colors: 5 }, means)).toEqual([]);
		// no dye mean: every dye fails `mean`, nothing else is checked for it
		const noMean = cosmeticReport(PLACEHOLDER_MANIFEST, {});
		for (const it of COSMETIC_ITEMS) {
			const mine = noMean.filter((e) => e.itemId === it.id);
			if (rulesOf(it.slot).includes("floor")) {
				expect(mine.map((e) => [e.rule, e.ok])).toEqual([["mean", false]]);
			} else {
				for (const e of mine) expect(e.ok).toBe(true);
			}
		}
	});
});
