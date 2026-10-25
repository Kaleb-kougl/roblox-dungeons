/**
 * The HUD side of M2 in-run progression (client/ui/hud DraftOverlay, RunItemsPanel, ToastPanel; the world markers in
 * client/controllers/render RunMarkerController): string keys, colour roles, key hints and layout numbers. Pure data
 * and helpers, checked headlessly (hud.spec.ts: every key exists in the placeholder pack).
 */
import { BOONS, CURSES, RARITY_NAMES, RELICS } from "shared/sim";
import type { ColorRole } from "shared/theme";

/** Fixed HUD strings of the draft, the toasts, the shrine hint and the owned-items panel. */
export const PROGRESSION_STRINGS = {
	draftTitle: "hud.draft.title",
	draftHint: "hud.draft.hint",
	draftWait: "hud.draft.wait",
	/** Co-op: teammates still choosing (the world stays frozen until all confirmed). */
	draftWaiting: "hud.draft.waiting",
	shrineHint: "hud.shrine.hint",
	toastBoon: "hud.toast.boon",
	toastRelic: "hud.toast.relic",
	toastCurse: "hud.toast.curse",
	toastSecondWind: "hud.toast.secondWind",
	toastFang: "hud.toast.fang",
} as const;

/** Theme string keys of a boon / relic / curse id ("boon.sharpened"): its name, one-line effect, short icon label. */
export function itemNameKey(id: string): string {
	return `${id}.name`;
}
export function itemDescKey(id: string): string {
	return `${id}.desc`;
}
export function itemIconKey(id: string): string {
	return `${id}.icon`;
}

/** `boon.rarity.<common|rare|legendary>`. */
export function rarityNameKey(rarity: number): string {
	return `boon.rarity.${RARITY_NAMES[rarity] ?? RARITY_NAMES[0]}`;
}

/** Every progression string key the HUD can ask for (hud.spec.ts checks them all). */
export function progressionStringKeys(): string[] {
	const out: string[] = [];
	for (const [, key] of pairs(PROGRESSION_STRINGS as unknown as Map<string, string>)) out.push(key);
	for (let r = 0; r < RARITY_NAMES.size(); r++) out.push(rarityNameKey(r));
	for (const defs of [BOONS, RELICS, CURSES] as ReadonlyArray<ReadonlyArray<{ readonly id: string }>>) {
		for (const d of defs) out.push(itemNameKey(d.id), itemDescKey(d.id), itemIconKey(d.id));
	}
	return out;
}

/** Card / icon colour per boon rarity (theme item-rarity roles): common, rare, legendary. */
export const RARITY_COLOR_ROLES: ReadonlyArray<ColorRole> = ["rarity.normal", "rarity.rare", "rarity.unique"];
/** Relic and curse icons, the pedestal and the shrine markers (live / used). */
export const RELIC_COLOR_ROLE: ColorRole = "uiAccent";
export const CURSE_COLOR_ROLE: ColorRole = "uiHealth";
export const PEDESTAL_COLOR_ROLE: ColorRole = "uiAccent";
export const SHRINE_COLOR_ROLE: ColorRole = "uiMana";
export const MARKER_USED_COLOR_ROLE: ColorRole = "uiTextDim";

export function rarityColorRole(rarity: number): ColorRole {
	return RARITY_COLOR_ROLES[rarity] ?? RARITY_COLOR_ROLES[0];
}

// The draft and shrine hints' key names follow the player's bindings: shared/play draftHint / shrineHint.

/** Layout (reference pixels) and timing of the progression HUD. */
export const PROGRESSION_VIEW = {
	/** One draft card. */
	cardWidth: 240,
	cardHeight: 150,
	cardGap: 18,
	/** Card outline: normal, and the selected card's (uiAccent). */
	cardStroke: 2,
	selectedStroke: 4,
	/** The selected card is drawn this much larger. */
	selectedScale: 1.06,
	/** Owned boon / relic / curse icons (top left, under the status panel). */
	iconSize: 26,
	iconTextSize: 12,
	/** Toasts (top centre): offset from the top (below the boss bar), width, how long each shows, how many at once. */
	toastTop: 96,
	toastWidth: 380,
	toastSeconds: 3,
	maxToasts: 4,
	/** World markers (studs per tile scale applied by the controller): radius and height in tiles. */
	pedestalRadiusTiles: 0.35,
	pedestalHeightTiles: 0.5,
	shrineRadiusTiles: 1,
	shrineHeightTiles: 0.08,
	/** Transparency of a used marker. */
	usedTransparency: 0.6,
	/** Logical image ID of the beam over a live relic pedestal (drawn only when the pack has it as an image). */
	pedestalBeamVisualId: "ui.marker.pedestal",
	/** The `ui.marker.pedestal` beam (when the pack has it): drawn this many tiles tall, its bottom on the pedestal. */
	pedestalBeamHeightTiles: 3,
} as const;

/** A toast line: its string key and vars (the client looks the names up in the theme). */
export interface ToastSpec {
	readonly key: string;
	readonly nameKey?: string;
	readonly amount?: number;
}

/** What a run event shows as a toast (kinds: shared/play RunEventKind; for "fang" `index` is the half hearts healed). */
export function toastFor(kind: "boon" | "relic" | "curse" | "secondWind" | "fang", index: number): ToastSpec {
	switch (kind) {
		case "boon":
			return { key: PROGRESSION_STRINGS.toastBoon, nameKey: itemNameKey(BOONS[index]?.id ?? "") };
		case "relic":
			return { key: PROGRESSION_STRINGS.toastRelic, nameKey: itemNameKey(RELICS[index]?.id ?? "") };
		case "curse":
			return { key: PROGRESSION_STRINGS.toastCurse, nameKey: itemNameKey(CURSES[index]?.id ?? "") };
		case "secondWind":
			return { key: PROGRESSION_STRINGS.toastSecondWind };
		default:
			return { key: PROGRESSION_STRINGS.toastFang, amount: index };
	}
}
