/**
 * A player's cosmetics as the views draw them (docs/COSMETICS.md CS5 / CS10's view half), pure: which look each party
 * member wears (index order: the run's RunContext.looks), the colour each slot draws at a moment (a Prismatic dye on
 * the view's clock, held at its first stop under reduced motion), whole 0..255 channels so a caller rewrites a property
 * only when a channel moves (`rgb8Key`), the dye x tint the sprite's dye label shows, which character a dye belongs to,
 * and the sprite sets whose dye sheets a stage loads (`stageDyeSets`). No Roblox types: the client builds Color3s.
 */
import { CHARACTER_IDS, type CharacterId } from "shared/characters";
import { DYE_SLOTS, NO_LOOK, cosmeticItem, isPrismaticItem, type CosmeticLook } from "shared/cosmetics";
import { COSMETIC_DYE_SETS, cosmeticColor } from "shared/theme";
import { COSMETIC_VIEW } from "./config";

/** A colour in whole 0..255 channels. */
export interface Rgb8 {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

/** A colour in 0..1 channels (a Color3's). */
export interface Rgb01 {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

/** Player `index`'s look in `looks` (player index order), or the default look (missing, a world without looks). */
export function lookAt(looks: ReadonlyArray<CosmeticLook> | undefined, index: number): CosmeticLook {
	return looks?.[index] ?? NO_LOOK;
}

/** The cosmetic clock as drawn: `tSec`, or 0 under reduced motion (a Prismatic dye holds its first stop, CSD7). */
export function cosmeticClockSec(tSec: number, reducedMotion: boolean): number {
	return reducedMotion ? 0 : tSec;
}

function channel(v: number): number {
	const max = COSMETIC_VIEW.channelMax;
	return math.clamp(math.floor(v + 0.5), 0, max);
}

/** Item `itemId`'s colour at `tSec` (cosmeticColor) in whole channels; undefined for none or no cosmetic. */
export function cosmeticRgb8(itemId: string | undefined, tSec = 0): Rgb8 | undefined {
	if (itemId === undefined) return undefined;
	const c = cosmeticColor(itemId, tSec);
	if (c === undefined) return undefined;
	return { r: channel(c.r), g: channel(c.g), b: channel(c.b) };
}

/** One number per whole colour (r, g, b packed), -1 for none: a cheap "did it change" key. */
export function rgb8Key(c: Rgb8 | undefined): number {
	if (c === undefined) return -1;
	const base = COSMETIC_VIEW.channelMax + 1;
	return (c.r * base + c.g) * base + c.b;
}

/**
 * The dye label's colour (docs/COSMETICS.md "View"): the dye (whole channels) times the view's tint (0..1 per
 * channel; white = the dye itself), per channel, 0..1.
 */
export function tintedDye(dye: Rgb8, tint: Rgb01): Rgb01 {
	const max = COSMETIC_VIEW.channelMax;
	return { r: (dye.r / max) * tint.r, g: (dye.g / max) * tint.g, b: (dye.b / max) * tint.b };
}

/** The character whose dye `itemId` is (its slot is DYE_SLOTS[character]), or undefined (not a dye). */
export function dyeCharacterOf(itemId: string | undefined): CharacterId | undefined {
	const it = cosmeticItem(itemId);
	if (it === undefined) return undefined;
	for (const id of CHARACTER_IDS) if (DYE_SLOTS[id] === it.slot) return id;
	return undefined;
}

/** The sprite set dye `itemId` recolours (COSMETIC_DYE_SETS of its character), or undefined (not a dye). */
export function dyeSetOf(itemId: string | undefined): string | undefined {
	const c = dyeCharacterOf(itemId);
	return c !== undefined ? COSMETIC_DYE_SETS[c] : undefined;
}

/**
 * The dye a player wearing `look` shows on the sprite set `visualId`: `look.dye` when it is a dye of that set, else
 * undefined (no dye, or another character's: never tint one set with another's colour).
 */
export function dyeForVisual(look: Readonly<CosmeticLook>, visualId: string): string | undefined {
	const dye = look.dye;
	return dye !== undefined && dyeSetOf(dye) === visualId ? dye : undefined;
}

/** Does `look` hold an animated (Prismatic) item: its colour changes with the clock? */
export function lookAnimated(look: Readonly<CosmeticLook>): boolean {
	return look.dye !== undefined && isPrismaticItem(look.dye);
}

/**
 * The sprite sets whose dye sheets a stage loads (StageAssetInput.dyed): each worn dye's set, once, in player order.
 * Nobody dyed: empty (no dye sheet is ever loaded for them).
 */
export function stageDyeSets(looks: ReadonlyArray<CosmeticLook> | undefined): Array<string> {
	const out = new Array<string>();
	if (looks === undefined) return out;
	for (const look of looks) {
		const set = dyeSetOf(look.dye);
		if (set !== undefined && !out.includes(set)) out.push(set);
	}
	return out;
}
