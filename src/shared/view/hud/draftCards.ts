/**
 * Draft cards with builds (docs/BUILDS.md BU9; presentation only): what a card shows for its kind for the local player
 * (New / Upgrade / Evolution / Duo: name, banner, the Upgrade's delta and "was" lines, level pips, the duo's joined
 * chip, its colour), how it flips (DraftBeat: an evolution or a duo plays the legendary beat), the boss double draft's
 * re-deal ("Pick again"), and the boon level strings the Build list shares. Pure data and helpers over shared/sim's card
 * ids and build state, checked headlessly (draftCards.spec.ts); the client's DraftRevealController writes them to
 * DRAFT_UI at the deal and DraftOverlay draws them with no further logic.
 *
 * Text is never composed here: every string is a theme key plus vars, some of which are theme keys themselves
 * (`HudText.varKeys`, looked up by the client like a toast's `nameKey`).
 */
import { isBossFloor } from "shared/dungeon";
import {
	BOONS,
	CardKind,
	DUOS,
	Rarity,
	boonMaxLevel,
	cardBoon,
	cardDuo,
	cardKind,
	type CardKindId,
	type RarityId,
	type SimState,
} from "shared/sim";
import type { ColorRole } from "shared/theme";
import { DraftBeat, type DraftBeatId } from "./draftReveal";
import { romanPhase } from "./layout";
import {
	PROGRESSION_STRINGS,
	boonEvoDescKey,
	boonEvoNameKey,
	boonLevelDescKey,
	itemIconKey,
	itemNameKey,
	rarityColorRole,
	rarityNameKey,
} from "./progression";

/** A theme string to show: its key, literal vars, and vars that are theme keys themselves (looked up first). */
export interface HudText {
	readonly key: string;
	readonly vars?: Readonly<Record<string, string | number>>;
	readonly varKeys?: Readonly<Record<string, string>>;
}

/** The colour roles of the evolution and duo looks (theme BOON_BUILD_ROLES, docs/BUILDS.md BU1). */
export const BUILD_EVOLVED_ROLE: ColorRole = "boon.evolved";
export const BUILD_DUO_ROLE: ColorRole = "boon.duo";

/** Layout (reference px) of a draft card's builds pieces (DraftOverlay's banner row). */
export const DRAFT_CARD_VIEW = {
	/** The banner row's level pips (square, gap between) and the duo's joined icon chip (one cell per boon). */
	pipSize: 8,
	pipGap: 3,
	chipCell: 22,
	chipText: 10,
	/** Between the banner row's chip, text and pips. */
	bannerGap: 6,
	/** An empty pip's transparency (the filled ones are opaque), on the card and in the items row. */
	emptyPipTransparency: 0.6,
	/** The duo chip cells' outline, reference px. */
	chipStroke: 1,
} as const;

/** Cells a duo chip spans (the draft card's joined chip and the items row's). */
export const DUO_CHIP_SPAN = 2;

// --- Boon levels' strings -----------------------------------------------------------------------------------------

/** A boon's line at `level`: `<id>.desc` (I), `<id>.desc.2` (II), the evolution's `<id>.evo.desc` (its top level). */
export function boonLineKey(boon: number, level: number): string {
	const id = BOONS[boon]?.id ?? "";
	const max = boonMaxLevel(boon);
	if (max > 1 && level >= max) return boonEvoDescKey(id);
	return boonLevelDescKey(id, level);
}

/** A boon's name at `level`: the evolution's `<id>.evo.name` at its top level, else `<id>.name`. */
export function boonLevelNameKey(boon: number, level: number): string {
	const id = BOONS[boon]?.id ?? "";
	const max = boonMaxLevel(boon);
	return max > 1 && level >= max ? boonEvoNameKey(id) : itemNameKey(id);
}

/** A level as shown ("II"); "" for a boon that has no levels (a legendary, or no builds: level 0). */
export function levelText(boon: number, level: number): string {
	return boonMaxLevel(boon) > 1 && level > 0 ? romanPhase(level) : "";
}

// --- Draft cards (BU9) --------------------------------------------------------------------------------------------

/** A card's look: its boon's rarity, or the evolution / duo looks (their own colour role, the legendary beat). */
export type DraftTone = "common" | "rare" | "legendary" | "evolved" | "duo";

/** A tone's colour role (frame stroke, glow, flash mix, name, rays). */
export function draftToneRole(tone: DraftTone): ColorRole {
	switch (tone) {
		case "evolved":
			return BUILD_EVOLVED_ROLE;
		case "duo":
			return BUILD_DUO_ROLE;
		case "legendary":
			return rarityColorRole(Rarity.LEGENDARY);
		case "rare":
			return rarityColorRole(Rarity.RARE);
		default:
			return rarityColorRole(Rarity.COMMON);
	}
}

/** The tone of a rarity (a New or Upgrade card, the KV_DraftRevealDebug override). */
export function rarityTone(rarity: RarityId): DraftTone {
	return rarity === Rarity.LEGENDARY ? "legendary" : rarity === Rarity.RARE ? "rare" : "common";
}

/**
 * How a card flips (DraftReveal.begin): an Evolution or a Duo card plays the legendary beat; a New or Upgrade card its
 * boon's rarity's (an upgrade flips like its boon).
 */
export function draftBeatFor(kind: CardKindId | -1, rarity: RarityId): DraftBeatId {
	if (kind === CardKind.EVOLUTION || kind === CardKind.DUO) return DraftBeat.LEGENDARY;
	return rarity === Rarity.LEGENDARY
		? DraftBeat.LEGENDARY
		: rarity === Rarity.RARE
		? DraftBeat.RARE
		: DraftBeat.COMMON;
}

/** Everything a draft card shows (DraftOverlay). See draftCardModel. */
export interface DraftCardModel {
	readonly card: number;
	readonly kind: CardKindId;
	/** The boon (New / Upgrade / Evolution) or -1; the duo (Duo) or -1. */
	readonly boon: number;
	readonly duo: number;
	readonly beat: DraftBeatId;
	readonly tone: DraftTone;
	/** The name row (the evolution's name on an Evolution card). */
	readonly name: HudText;
	/** The row under the name: the rarity (New), "Level II" (Upgrade), "EVOLVE" + boon (Evolution), "DUO" (Duo). */
	readonly banner: HudText;
	/** The effect: the boon's line at the level the card gives (an Upgrade: only the new level's line). */
	readonly desc: HudText;
	/** An Upgrade card's previous line under it ("was: ..."), else undefined. */
	readonly was?: HudText;
	/** Level pips in the banner row: `level` of `maxLevel` filled (the level the card gives); 0 / 0: none. */
	readonly level: number;
	readonly maxLevel: number;
	/** The duo's joined chip: its two boons' icon labels (`<id>.icon`); empty for a boon card. */
	readonly chipIcons: ReadonlyArray<string>;
	/** The duo chip's halves' fills (the two boons' rarity roles). */
	readonly chipRoles: ReadonlyArray<ColorRole>;
}

/** A HudText. */
export function textOf(key: string, vars?: Record<string, string | number>, varKeys?: Record<string, string>): HudText {
	return { key, vars, varKeys };
}

/**
 * What card id `card` shows when it is of kind `kind` for the local player (shared/sim cardKind, read when the deal
 * is dealt: the level it raises is the one before the pick). undefined for no card. Without builds every boon card
 * is New (today's card: name, rarity, line).
 */
export function draftCardModel(card: number, kind: CardKindId | -1): DraftCardModel | undefined {
	const d = cardDuo(card);
	if (d >= 0) {
		const duo = DUOS[d];
		const a = BOONS[duo.a];
		const b = BOONS[duo.b];
		return {
			card,
			kind: CardKind.DUO,
			boon: -1,
			duo: d,
			beat: DraftBeat.LEGENDARY,
			tone: "duo",
			name: textOf(itemNameKey(duo.id)),
			banner: textOf(PROGRESSION_STRINGS.draftDuo, undefined, { a: itemNameKey(a.id), b: itemNameKey(b.id) }),
			desc: textOf(`${duo.id}.desc`),
			level: 0,
			maxLevel: 0,
			chipIcons: [itemIconKey(a.id), itemIconKey(b.id)],
			chipRoles: [rarityColorRole(a.rarity), rarityColorRole(b.rarity)],
		};
	}
	const boon = cardBoon(card);
	if (boon < 0) return undefined;
	const def = BOONS[boon];
	const max = boonMaxLevel(boon);
	const k: CardKindId =
		kind === CardKind.UPGRADE || kind === CardKind.EVOLUTION ? (kind as CardKindId) : CardKind.NEW;
	const level = k === CardKind.EVOLUTION ? max : k === CardKind.UPGRADE ? math.min(2, max) : 1;
	const base = {
		card,
		kind: k,
		boon,
		duo: -1,
		beat: draftBeatFor(k, def.rarity),
		chipIcons: [] as string[],
		chipRoles: [] as ColorRole[],
	};
	if (k === CardKind.EVOLUTION) {
		return {
			...base,
			tone: "evolved",
			name: textOf(boonLevelNameKey(boon, level)),
			banner: textOf(PROGRESSION_STRINGS.draftEvolve, undefined, { boon: itemNameKey(def.id) }),
			desc: textOf(boonLineKey(boon, level)),
			level,
			maxLevel: max,
		};
	}
	if (k === CardKind.UPGRADE) {
		return {
			...base,
			tone: rarityTone(def.rarity),
			name: textOf(itemNameKey(def.id)),
			banner: textOf(PROGRESSION_STRINGS.draftLevel, { level: romanPhase(level) }),
			desc: textOf(boonLineKey(boon, level)),
			was: textOf(PROGRESSION_STRINGS.draftWas, undefined, { desc: boonLineKey(boon, level - 1) }),
			level,
			maxLevel: max,
		};
	}
	return {
		...base,
		tone: rarityTone(def.rarity),
		name: textOf(itemNameKey(def.id)),
		banner: textOf(rarityNameKey(def.rarity)),
		desc: textOf(boonLineKey(boon, 1)),
		level: 0,
		maxLevel: 0,
	};
}

/** The kind of each offer for player `playerIndex` (shared/sim cardKind; -1 for no card). */
export function draftCardKinds(
	state: Readonly<SimState>,
	playerIndex: number,
	offers: ReadonlyArray<number>,
): Array<CardKindId | -1> {
	return offers.map((card) => cardKind(state, playerIndex, card));
}

/**
 * The draft on screen is a builds re-deal (the boss double draft's second deal, BUD4): the "Pick again" line. True when
 * the player's draft is open and fewer deals are left than the floor just cleared deals (2 after a boss floor).
 */
export function draftRedealt(state: Readonly<SimState>, playerIndex: number): boolean {
	const builds = state.builds;
	const p = state.run?.players[playerIndex];
	const bp = builds?.players[playerIndex];
	if (builds === undefined || p === undefined || bp === undefined || p.draftOpen === 0) return false;
	const floorCleared = (state.endless?.floor ?? 1) - 1;
	const deals = isBossFloor(floorCleared) ? builds.config.bossFloorDrafts : builds.config.floorDrafts;
	return bp.draftsLeft > 0 && bp.draftsLeft < deals;
}
