/**
 * The cosmetic items (docs/COSMETICS.md "Slots and catalogue v1"): the ONE list of every cosmetic the Armory sells,
 * with its slot and tier. shared/wallet ARMORY_CATALOG appends a row per item (`cosmeticArmoryItems`), shared/theme
 * cosmetics.ts keys every item's colour (or Prismatic stops) by these ids, and specs on both sides cross-check them, so
 * the catalogue and the colours cannot drift.
 *
 * COSMETIC_ITEMS is APPEND-ONLY (wallets store the ids, telemetry SKUs are the ids, and ARMORY_CATALOG's order lock
 * pins them): a colour the validator drops later is retired, never removed or renumbered.
 *
 * Every item passed shared/theme `cosmeticReport` (docs/COSMETICS.md "Readability rules") when it was added; the table
 * of candidates, margins and drops is docs/COSMETICS.md "As built: theme (CS3)". Pure data, no runtime import.
 *
 * @module
 */
import type { CharacterId } from "shared/characters";

/** A cosmetic slot (the wallet's `eq` key): one item per slot. */
export type CosmeticSlot = "dye.knight" | "dye.archer" | "outline" | "trail" | "spark";

/** Every slot, in the Armory's order (the Cosmetics tab's groups). */
export const COSMETIC_SLOTS: ReadonlyArray<CosmeticSlot> = table.freeze([
	"dye.knight",
	"dye.archer",
	"outline",
	"trail",
	"spark",
]);

/** The dye slot of each character (a dye recolours one character's body, CSD10). */
export const DYE_SLOTS: Readonly<Record<CharacterId, CosmeticSlot>> = table.freeze({
	knight: "dye.knight",
	archer: "dye.archer",
});

/** The dye slot of `character` (DYE_SLOTS). */
export function dyeSlotOf(character: CharacterId): CosmeticSlot {
	return DYE_SLOTS[character];
}

/** The slots that are not dyes: drawn the same whichever character is played. */
export const LOOK_SLOTS = table.freeze({ outline: "outline", trail: "trail", spark: "spark" } as const);

/**
 * The catalogue (append only). `tier` is the price tier on shared/wallet ARMORY_TIERS (one level per item). `prismatic`:
 * the animated dye (CS10, CSD7): its colour is the theme's Prismatic stops, not one hex.
 */
export const COSMETIC_ITEMS = table.freeze([
	// The Knight's plate (dye sheets; tiers 2-6, Prismatic 8). Scarlet / Cobalt / Amethyst were lightened to pass the
	// floor-contrast rule and renamed Rose / Azure / Lilac.
	{ id: "dye.knight.frost", slot: "dye.knight", tier: 2 },
	{ id: "dye.knight.ivory", slot: "dye.knight", tier: 2 },
	{ id: "dye.knight.teal", slot: "dye.knight", tier: 3 },
	{ id: "dye.knight.verdant", slot: "dye.knight", tier: 3 },
	{ id: "dye.knight.azure", slot: "dye.knight", tier: 4 },
	{ id: "dye.knight.lilac", slot: "dye.knight", tier: 4 },
	{ id: "dye.knight.bronze", slot: "dye.knight", tier: 5 },
	{ id: "dye.knight.rose", slot: "dye.knight", tier: 6 },
	{ id: "dye.knight.prismatic", slot: "dye.knight", tier: 8, prismatic: true },
	// The Archer's leathers (tiers 2-6, Prismatic 8): the draft's eight hues, Scarlet and Bronze a touch brighter.
	{ id: "dye.archer.frost", slot: "dye.archer", tier: 2 },
	{ id: "dye.archer.ivory", slot: "dye.archer", tier: 2 },
	{ id: "dye.archer.teal", slot: "dye.archer", tier: 3 },
	{ id: "dye.archer.verdant", slot: "dye.archer", tier: 3 },
	{ id: "dye.archer.cobalt", slot: "dye.archer", tier: 4 },
	{ id: "dye.archer.amethyst", slot: "dye.archer", tier: 4 },
	{ id: "dye.archer.bronze", slot: "dye.archer", tier: 5 },
	{ id: "dye.archer.scarlet", slot: "dye.archer", tier: 6 },
	{ id: "dye.archer.prismatic", slot: "dye.archer", tier: 8, prismatic: true },
	// Outline colours (the watched player's rim; tiers 2-5).
	{ id: "outline.azure", slot: "outline", tier: 2 },
	{ id: "outline.silver", slot: "outline", tier: 2 },
	{ id: "outline.jade", slot: "outline", tier: 3 },
	{ id: "outline.sand", slot: "outline", tier: 3 },
	{ id: "outline.rose", slot: "outline", tier: 4 },
	{ id: "outline.moss", slot: "outline", tier: 4 },
	{ id: "outline.violet", slot: "outline", tier: 5 },
	{ id: "outline.orchid", slot: "outline", tier: 5 },
	// Roll trails (the afterimage ghosts; tiers 3-7).
	{ id: "trail.azure", slot: "trail", tier: 3 },
	{ id: "trail.ivory", slot: "trail", tier: 3 },
	{ id: "trail.jade", slot: "trail", tier: 4 },
	{ id: "trail.verdant", slot: "trail", tier: 5 },
	{ id: "trail.cobalt", slot: "trail", tier: 6 },
	{ id: "trail.violet", slot: "trail", tier: 7 },
	// Spark colours (your graze / parry sparks; tiers 4-7).
	{ id: "spark.azure", slot: "spark", tier: 4 },
	{ id: "spark.jade", slot: "spark", tier: 5 },
	{ id: "spark.violet", slot: "spark", tier: 6 },
	{ id: "spark.rose", slot: "spark", tier: 6 },
	{ id: "spark.orchid", slot: "spark", tier: 7 },
] as const);

/** One cosmetic item. */
export type CosmeticItemDef = (typeof COSMETIC_ITEMS)[number];

/** Every cosmetic item id. */
export type CosmeticItemId = CosmeticItemDef["id"];

/** The animated (Prismatic) items' ids: coloured by stops. */
export type PrismaticItemId = Extract<CosmeticItemDef, { readonly prismatic: true }>["id"];

/** The items with one colour (every item but the Prismatic dyes). */
export type SolidCosmeticItemId = Exclude<CosmeticItemId, PrismaticItemId>;

/** The cosmetic item `id`, or undefined (not a cosmetic, or not a string). */
export function cosmeticItem(id: unknown): CosmeticItemDef | undefined {
	if (!typeIs(id, "string")) return undefined;
	for (const it of COSMETIC_ITEMS) if (it.id === id) return it;
	return undefined;
}

/** Is `id` an animated (Prismatic) item? */
export function isPrismaticItem(id: string): boolean {
	const it = cosmeticItem(id);
	return it !== undefined && (it as { readonly prismatic?: boolean }).prismatic === true;
}

/** The items of `slot`, catalogue order. */
export function cosmeticItemsOf(slot: CosmeticSlot): ReadonlyArray<CosmeticItemDef> {
	const out: CosmeticItemDef[] = [];
	for (const it of COSMETIC_ITEMS) if (it.slot === slot) out.push(it);
	return out;
}
