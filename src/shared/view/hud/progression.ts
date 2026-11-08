/**
 * The HUD side of M2 in-run progression (client/ui/hud DraftOverlay, RunItemsPanel, ToastPanel; the world markers in
 * client/controllers/render RunMarkerController): string keys, colour roles, key hints and layout numbers. Pure data
 * and helpers, checked headlessly (hud.spec.ts: every key exists in the placeholder pack).
 */
import { BOONS, CURSES, DUOS, RARITY_NAMES, RELICS, boonMaxLevel, cardBoon, cardDisplay, cardDuo } from "shared/sim";
import {
	BOON_RARITY_ROLES,
	BOOST_KINDS,
	BOOST_STRING_FIELDS,
	BOOST_TOAST_KEY,
	boostStringKey,
	type ColorRole,
} from "shared/theme";

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
	/** A boost pickup (docs/BOOSTS.md B7): `{name}: {desc}` of the kind (theme BOOST_TOAST_KEY). */
	toastBoost: BOOST_TOAST_KEY,
	// Builds (docs/BUILDS.md BU9 / BU10; theme BUILD_STRING_KEYS, plus the upgrade card's "was" line):
	/** An Upgrade card's banner: `{level}` (roman). */
	draftLevel: "hud.draft.level",
	/** An Evolution card's banner: `{boon}` (the boon's name, a theme key). */
	draftEvolve: "hud.draft.evolve",
	/** A Duo card's banner: `{a}`, `{b}` (the two boons' names; the placeholder shows neither: the chip does). */
	draftDuo: "hud.draft.duo",
	/** The boss double draft's re-deal, under the title. */
	draftAgain: "hud.draft.again",
	/** An Upgrade card's previous line under the new one: `{desc}` (a theme key). */
	draftWas: "hud.draft.was",
	/** docs/BUILDS_V2.md BV8: a New card that unlocks a duo, at its foot: `{duo}` (the duo's name, a theme key). */
	draftDuoHint: "hud.draft.duoHint",
	/** An evolution taken: `{boon}`, `{evo}`; a duo taken: `{name}` (theme keys). */
	toastEvolved: "hud.toast.evolved",
	toastDuo: "hud.toast.duo",
	/** The pause / run-over Build list's title. */
	buildTitle: "hud.build.title",
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

/**
 * Builds (docs/BUILDS.md BU1): a levelled boon's line at level 2 (`<id>.desc.2`; level I is `<id>.desc`, level III
 * the evolution's), and its evolution's name and line (`<id>.evo.name`, `<id>.evo.desc`).
 */
export const BOON_LEVEL_2 = 2;
export function boonLevelDescKey(id: string, level: number): string {
	return level <= 1 ? itemDescKey(id) : `${id}.desc.${level}`;
}
export function boonEvoNameKey(id: string): string {
	return `${id}.evo.name`;
}
export function boonEvoDescKey(id: string): string {
	return `${id}.evo.desc`;
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
	for (const defs of [BOONS, RELICS, CURSES, DUOS] as ReadonlyArray<ReadonlyArray<{ readonly id: string }>>) {
		for (const d of defs) out.push(itemNameKey(d.id), itemDescKey(d.id), itemIconKey(d.id));
	}
	// Builds (docs/BUILDS.md BU1): every levelled boon's level-2 line and its evolution's name and line.
	for (let b = 0; b < BOONS.size(); b++) {
		if (boonMaxLevel(b) <= 1) continue;
		const id = BOONS[b].id;
		out.push(boonLevelDescKey(id, BOON_LEVEL_2), boonEvoNameKey(id), boonEvoDescKey(id));
	}
	// Boost drops (docs/BOOSTS.md B7): every kind's name / desc / icon (the toast and the HUD's boost row).
	for (const k of BOOST_KINDS) for (const f of BOOST_STRING_FIELDS) out.push(boostStringKey(k, f));
	return out;
}

/**
 * Card / icon colour per boon rarity (theme BOON_RARITY_ROLES, docs/DRAFT_REVEAL.md DR3: bone, blood red, candle gold):
 * common, rare, legendary. The loot `rarity.*` roles are not used here.
 */
export const RARITY_COLOR_ROLES: ReadonlyArray<ColorRole> = BOON_RARITY_ROLES;
/** Relic and curse icons and the shrine marker (live / used); a relic pedestal is drawn as the vault chest. */
export const RELIC_COLOR_ROLE: ColorRole = "uiAccent";
export const CURSE_COLOR_ROLE: ColorRole = "uiHealth";
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
	/**
	 * World markers (studs per tile scale applied by the controller), tiles: the pedestal beam's base above the floor
	 * (inside the chest, so the chest's billboard draws over its foot), the shrine zone's radius and height.
	 */
	pedestalHeightTiles: 0.5,
	shrineRadiusTiles: 1,
	shrineHeightTiles: 0.08,
	/** Transparency of a used marker. */
	usedTransparency: 0.6,
	/** Logical image ID of the beam over a live relic pedestal (drawn only when the pack has it as an image). */
	pedestalBeamVisualId: "ui.marker.pedestal",
	/** The `ui.marker.pedestal` beam (when the pack has it): drawn this many tiles tall, its bottom at pedestalHeightTiles. */
	pedestalBeamHeightTiles: 3,
} as const;

/**
 * The first-sighting card (docs/ENEMY_VARIANTS.md EV12, "the toast blocks the view" fix): first sightings no longer
 * join the top-centre toasts (over the far side of the room, where the new enemy usually is) but show on a card of
 * their own at the left edge, under the status panel (on touch: the safe area's top left, under the touch strip when
 * it hangs below the top bar). Reference px. footprint.ts HUD_TRANSIENT.sighting / TOUCH_SIGHTING_BOX place it, and
 * footprint.spec.ts holds it out of HUD_CLEAR_ZONE.
 */
export const SIGHTING_CARD = {
	/** The status panel's budget width: the card stays in the left quarter of the screen at HUD scale <= 100 %. */
	width: 240,
	/** Wrapped lines the longest English bestiary line takes at smallText (the footprint estimate). */
	lines: 3,
} as const;

/** A toast line: its string key and vars (the client looks the names / descriptions up in the theme). */
export interface ToastSpec {
	readonly key: string;
	readonly nameKey?: string;
	/** `{desc}`: a theme string key itself (boost pickups). */
	readonly descKey?: string;
	readonly amount?: number;
	/** More vars that are theme string keys themselves (builds: an evolution's `{boon}` / `{evo}`). */
	readonly varKeys?: Readonly<Record<string, string>>;
}

/** What a draft pick was, from the sim's builds events (shared/play RunEventRecord.build): an evolution or a duo. */
export type BuildTake = "evolved" | "duo";

/**
 * What a run event shows as a toast (kinds: shared/play RunEventKind; for "fang" `index` is the half hearts healed,
 * for "boost" the Boost index).
 */
export function toastFor(
	kind: "boon" | "relic" | "curse" | "secondWind" | "fang" | "boost",
	index: number,
	build?: BuildTake,
): ToastSpec {
	switch (kind) {
		case "boost": {
			const k = BOOST_KINDS[index] ?? BOOST_KINDS[0];
			return {
				key: PROGRESSION_STRINGS.toastBoost,
				nameKey: boostStringKey(k, "name"),
				descKey: boostStringKey(k, "desc"),
			};
		}
		case "boon": {
			// `index` is the draft card taken: a boon, or with builds a duo (docs/BUILDS.md card ids); `build` says
			// when the sim's builds events recorded the pick as an evolution or a duo (BU10).
			const d = cardDuo(index);
			if (build === "duo" && d >= 0)
				return { key: PROGRESSION_STRINGS.toastDuo, nameKey: itemNameKey(DUOS[d].id) };
			const b = cardBoon(index);
			if (build === "evolved" && b >= 0) {
				const id = BOONS[b].id;
				return {
					key: PROGRESSION_STRINGS.toastEvolved,
					varKeys: { boon: itemNameKey(id), evo: boonEvoNameKey(id) },
				};
			}
			return { key: PROGRESSION_STRINGS.toastBoon, nameKey: itemNameKey(cardDisplay(index)?.id ?? "") };
		}
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
