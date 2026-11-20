/**
 * Roblox port (docs/COSMETICS.md CS3 / CS10): the theme side of cosmetics. Every cosmetic item's colour keyed by its
 * id (shared/cosmetics COSMETIC_ITEMS, the one item list; the key types make the tables exhaustive and
 * cosmetics.spec.ts cross-checks them at run time), the Prismatic dyes' stops and the pure `prismaticColor`, the sprite
 * set a character's dye recolours, and the strings (item names, slot labels, the Armory's Cosmetics tab).
 *
 * How a colour is drawn: a dye multiplies the character's dye sheets (normalised grey, docs/COSMETICS.md "Pipeline"),
 * so the dyed region's mean is colour x the set's `dyeMeanValue`; an outline replaces `playerOutline` for that player;
 * a trail tints their roll afterimages; a spark tints their graze / parry sparks. Every colour here passed
 * cosmeticReport (cosmeticReport.ts, rules 1-5) on every bundled pack; the candidates, margins and drops are
 * docs/COSMETICS.md "As built: theme (CS3)".
 *
 * Pure data plus pure helpers. In its own module (contract.ts sits near Luau's 200-locals limit): contract.ts spreads
 * cosmeticStringKeys() last inside REQUIRED_STRING_KEYS' function, one import and no other top-level local. The report
 * is in cosmeticReport.ts, which imports the validator (this module must not: contract.ts imports it).
 */
import type { CharacterId } from "shared/characters";
import {
	COSMETIC_ITEMS,
	COSMETIC_SLOTS,
	cosmeticItem,
	type CosmeticSlot,
	type PrismaticItemId,
	type SolidCosmeticItemId,
} from "shared/cosmetics";
import { parseHex, type Rgb } from "./color";
import type { HexColor } from "./types";

/** The sprite set each character's dye recolours (shared/characters CHARACTERS' `visualId`; the spec keeps them equal). */
export const COSMETIC_DYE_SETS: Readonly<Record<CharacterId, string>> = table.freeze({
	knight: "class.vanguard",
	archer: "class.ranger",
});

/**
 * Every one-colour cosmetic's colour. Dyes: the colour the dye sheet's grey is multiplied by (ImageColor3). The Knight's
 * Scarlet, Cobalt and Amethyst candidates were lightened to pass the floor-contrast rule (Rose, Azure, Lilac): his
 * undyed plate already reads at more than 3 : 1, so his bar is 3 : 1. The Archer's leathers are dark (her bar is their
 * own contrast, about 1.1 : 1), so she keeps the draft's hues; Scarlet and Bronze are brighter, to stay 40 from the
 * enemy bullet's dark outline.
 */
export const COSMETIC_COLORS: { readonly [K in SolidCosmeticItemId]: HexColor } = table.freeze({
	"dye.knight.frost": "#a0dcff",
	"dye.knight.ivory": "#f0ead6",
	"dye.knight.teal": "#28b4aa",
	"dye.knight.verdant": "#3cb44b",
	"dye.knight.azure": "#59acff",
	"dye.knight.lilac": "#c294d1",
	"dye.knight.bronze": "#cf9e3d",
	"dye.knight.rose": "#f98686",
	"dye.archer.frost": "#a0dcff",
	"dye.archer.ivory": "#f0ead6",
	"dye.archer.teal": "#28b4aa",
	"dye.archer.verdant": "#3cb44b",
	"dye.archer.cobalt": "#3c64dc",
	"dye.archer.amethyst": "#9650d2",
	"dye.archer.bronze": "#d89048",
	"dye.archer.scarlet": "#e61d32",
	"outline.azure": "#33ccff",
	"outline.silver": "#c0c8d0",
	"outline.jade": "#33ff99",
	"outline.sand": "#e8d8a8",
	"outline.rose": "#ff99b3",
	"outline.moss": "#85c270",
	"outline.violet": "#b366ff",
	"outline.orchid": "#cc33ff",
	"trail.azure": "#33ccff",
	"trail.ivory": "#f0ead6",
	"trail.jade": "#33ff99",
	"trail.verdant": "#3cb44b",
	"trail.cobalt": "#4060ff",
	"trail.violet": "#b366ff",
	"spark.azure": "#33ccff",
	"spark.jade": "#33ff99",
	"spark.violet": "#b366ff",
	"spark.rose": "#ff99b3",
	"spark.orchid": "#cc33ff",
});

/**
 * The Prismatic dyes' stops (CS10, CSD7): the colour drifts through them in order and back to the first, one segment
 * per stop over PRISMATIC.periodSec. Every stop and every interpolated sample passes the dye rules (cosmeticReport rule
 * 5). The Knight's run through his shipped dyes' hues; the Archer's through Bronze, Verdant, Teal, Frost and
 * Ivory (no five or more of her dyes loop without a red / violet / blue step dimming to the enemy bullet's outline).
 */
export const PRISMATIC_STOPS: { readonly [K in PrismaticItemId]: ReadonlyArray<HexColor> } = table.freeze({
	"dye.knight.prismatic": table.freeze([
		"#59acff",
		"#28b4aa",
		"#3cb44b",
		"#f0ead6",
		"#f98686",
		"#a0dcff",
	] as HexColor[]),
	"dye.archer.prismatic": table.freeze(["#d89048", "#3cb44b", "#28b4aa", "#a0dcff", "#f0ead6"] as HexColor[]),
});

/** The Prismatic dye's tunables. */
export const PRISMATIC = table.freeze({
	/** Seconds for one loop through every stop (each segment is periodSec / stop count). */
	periodSec: 8,
	/** Samples per segment the report checks (rule 5), each at prismaticColor's own easing. */
	samplesPerSegment: 16,
});

/** Smoothstep: eases each segment in and out, so the colour's rate of change is 0 at every stop (a smooth loop). */
function ease(f: number): number {
	return f * f * (3 - 2 * f);
}

/**
 * The Prismatic colour at `tSec` seconds (any real, negative too): stops `i` and `i + 1` (wrapping to the first) mixed
 * by the eased position in segment `i`, channels 0..255 unrounded. One stop: that stop. No stop, or a malformed hex:
 * black. Reduced motion holds `prismaticColor(stops, 0)`, the first stop.
 */
export function prismaticColor(
	stops: ReadonlyArray<HexColor>,
	tSec: number,
	periodSec: number = PRISMATIC.periodSec,
): Rgb {
	const n = stops.size();
	if (n === 0) return { r: 0, g: 0, b: 0 };
	const first = parseHex(stops[0]) ?? { r: 0, g: 0, b: 0 };
	if (n === 1 || !(periodSec > 0)) return first;
	const t = ((tSec % periodSec) + periodSec) % periodSec;
	const u = (t / periodSec) * n;
	const i = math.min(math.floor(u), n - 1);
	const w = ease(u - i);
	const a = parseHex(stops[i]) ?? first;
	const b = parseHex(stops[(i + 1) % n]) ?? first;
	return { r: a.r + (b.r - a.r) * w, g: a.g + (b.g - a.g) * w, b: a.b + (b.b - a.b) * w };
}

/** The Prismatic stops of item `itemId`, or undefined (not a Prismatic dye). */
export function prismaticStopsOf(itemId: string): ReadonlyArray<HexColor> | undefined {
	return (PRISMATIC_STOPS as unknown as Readonly<Record<string, ReadonlyArray<HexColor>>>)[itemId];
}

/** The hex of one-colour item `itemId`, or undefined (unknown, or a Prismatic dye: prismaticStopsOf). */
export function cosmeticHex(itemId: string): HexColor | undefined {
	return (COSMETIC_COLORS as unknown as Readonly<Record<string, HexColor>>)[itemId];
}

/**
 * The colour item `itemId` draws at `tSec` (0..255 channels): its hex, or a Prismatic dye's prismaticColor (`tSec` 0:
 * its first stop, the reduced-motion hold). Undefined for anything that is not a cosmetic.
 */
export function cosmeticColor(itemId: string, tSec = 0): Rgb | undefined {
	const stops = prismaticStopsOf(itemId);
	if (stops !== undefined) return prismaticColor(stops, tSec);
	const hex = cosmeticHex(itemId);
	return hex !== undefined ? parseHex(hex) : undefined;
}

// --- strings ---------------------------------------------------------------------------------

/** The Armory's Cosmetics tab and the try-on preview (docs/COSMETICS.md "Armory"). */
export const COSMETIC_KEYS = {
	/** `Equip`: wear an owned item. */
	equip: "cosmetic.equip",
	/** `Equipped`: the item worn in its slot. */
	equipped: "cosmetic.equipped",
	/** `Take off`: back to the slot's default. */
	unequip: "cosmetic.unequip",
	/** `Try on`: show the focused item on the preview before buying it. */
	tryOn: "cosmetic.tryOn",
	/** `Default`: a slot's own row (nothing worn: the game's colour). */
	none: "cosmetic.none",
	/** `Animated`: the Prismatic dyes' tag. */
	animated: "cosmetic.animated",
	/** `Robux only`: a Robux-only item's tag (docs/COSMETICS.md CSD13: every animated cosmetic), its price while unknown. */
	robuxOnly: "cosmetic.robux.only",
	/** `{robux} Robux`: a Robux-only item's price (Roblox's price for this player). */
	robuxPrice: "cosmetic.robux.price",
	/** `Buy for {robux} Robux`: its buy button (Roblox's purchase prompt follows). */
	robuxBuy: "cosmetic.robux.buy",
	/** `Buy with Robux`: its buy button while Roblox's price is not known. */
	robuxBuyNoPrice: "cosmetic.robux.buyNoPrice",
	/** `Not for sale`: a Robux-only item that is not on sale in this game. */
	robuxOffSale: "cosmetic.robux.offSale",
	/** `{name} unlocked`: a Robux-only item just granted (a toast). */
	robuxAdded: "cosmetic.robux.added",
} as const;

/** `cosmetic.slot.<slot>`: a slot's header on the Cosmetics tab (`Knight dye`, `Roll trail`). */
export function cosmeticSlotKey(slot: CosmeticSlot): string {
	return `cosmetic.slot.${slot}`;
}

/** `cosmetic.<id>.name`: an item's name (`Frost Plate`, `Azure Trail`). */
export function cosmeticNameKey(itemId: string): string {
	return `cosmetic.${itemId}.name`;
}

/**
 * Every cosmetic string a pack must define (REQUIRED_STRING_KEYS, its last ones after the Silver shop's): the tab's
 * keys in COSMETIC_KEYS order, the slot headers in COSMETIC_SLOTS order, then every item's name in COSMETIC_ITEMS
 * order (append with it).
 */
export function cosmeticStringKeys(): string[] {
	const out: string[] = [
		COSMETIC_KEYS.equip,
		COSMETIC_KEYS.equipped,
		COSMETIC_KEYS.unequip,
		COSMETIC_KEYS.tryOn,
		COSMETIC_KEYS.none,
		COSMETIC_KEYS.animated,
		COSMETIC_KEYS.robuxOnly,
		COSMETIC_KEYS.robuxPrice,
		COSMETIC_KEYS.robuxBuy,
		COSMETIC_KEYS.robuxBuyNoPrice,
		COSMETIC_KEYS.robuxOffSale,
		COSMETIC_KEYS.robuxAdded,
	];
	for (const slot of COSMETIC_SLOTS) out.push(cosmeticSlotKey(slot));
	for (const it of COSMETIC_ITEMS) out.push(cosmeticNameKey(it.id));
	return out;
}

/** COSMETIC_STRING_KEYS, in cosmeticStringKeys' order. */
export const COSMETIC_STRING_KEYS: ReadonlyArray<string> = cosmeticStringKeys();

/** Is `itemId` a cosmetic whose colour this theme knows (a hex or Prismatic stops)? */
export function hasCosmeticColor(itemId: string): boolean {
	return (
		cosmeticItem(itemId) !== undefined &&
		(cosmeticHex(itemId) !== undefined || prismaticStopsOf(itemId) !== undefined)
	);
}
