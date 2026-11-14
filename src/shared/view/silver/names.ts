/**
 * Armory item labels (docs/SILVER.md SV8 / SV9): an item's name, at a level in Roman numerals when it has more than
 * one (`Vigor II`, `The Archer`), for the Armory, the run-over `to go` line and the character screen's upgrades line.
 * Pure; text through an injected lookup (the client's `str`, a spec's fake).
 */
import { ARMORY_KEYS, armoryItemNameKey, type StringVars } from "shared/theme";
import { armoryItem } from "shared/wallet";
// By file: the shared/view/hud barrel is heavy and this is a leaf.
import { romanPhase } from "../hud/layout";

/** A theme string lookup (the client's `str`; ThemePack.str). */
export type SilverStr = (key: string, vars?: StringVars) => string;

/** The name of item `itemId` (its theme string). */
export function armoryItemName(itemId: string, s: SilverStr): string {
	return s(armoryItemNameKey(itemId));
}

/** Item `itemId` at `level`: `{name} {roman}` when the item has several levels, else its name alone. */
export function armoryItemLabel(itemId: string, level: number, s: SilverStr): string {
	const name = armoryItemName(itemId, s);
	const it = armoryItem(itemId);
	if (it === undefined || it.tiers.size() <= 1 || !(level >= 1)) return name;
	return s(ARMORY_KEYS.itemLevel, { name, level: romanPhase(level) });
}
