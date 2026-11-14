/**
 * The Armory screen (docs/SILVER.md "The Armory", SV9; SVD9-SVD11, SVD22-SVD24), pure: client/ui/menu ArmoryScreen
 * draws it; headlessly tested (armory.spec.ts). Text through an injected lookup (the client's `str`).
 *
 *   tabs        Upgrades / Unlocks / Cosmetics (ARMORY_TABS; an item's tab is its catalogue kind; Cosmetics is empty in
 *               v1 and says so)
 *   rows        a tab's items sorted by the tier of the level they would buy next (maxed items last, by their top
 *               tier; ties in catalogue order): its level and maximum, the next price and `to go`, its state (maxed /
 *               owned / affordable / poor / unavailable), the next-goal marks (the cheapest next level and the one after
 *               it: shared/wallet nextGoals, SVD24), and `dim` for a price two or more tiers above the dearest thing
 *               owned
 *   detail      the focused item: its name at its next level, the tier, the description, the exact effect now and at the
 *               next level per character (`Knight 2 1/2 -> 3`, SVD11: from shared/characters upgradeTraits and the
 *               sim's starting maxima, never copied numbers), the price and `to go`, and what the buy button does: hold
 *               (0.4 s, SILVER_SHOP.holdSec), hold then confirm (from shared/wallet CONFIRM_FROM_TIER), or nothing
 *   badge       the main menu's dot: a next level the balance covers that the player has not seen in the Armory yet
 *   BuyHold     the press-and-hold of the buy button (mouse, touch, the pad's A): one completion per press
 */
import {
	CHARACTER_IDS,
	NO_UPGRADES,
	characterDef,
	upgradeTraits,
	type CharacterId,
	type UpgradeLevels,
} from "shared/characters";
import { SILVER } from "shared/silver";
import { playerStartArmorMax, playerStartFlaskMax, playerStartHalfHearts } from "shared/sim";
import { ARMORY_KEYS, CHARACTER_LOCK_KEYS, armoryItemDescKey, type StringVars } from "shared/theme";
import {
	ARMORY_CATALOG,
	CONFIRM_FROM_TIER,
	UPGRADE_ITEM,
	itemTier,
	tierPrice,
	type ArmoryItem,
	type ArmoryItemKind,
	type WalletStatus,
} from "shared/wallet";
import { HUD_VIEW } from "shared/view/hud";
import {
	SILVER_SHOP,
	armoryItemLabel,
	statusBalance,
	statusLevel,
	statusUpgrades,
	walletShown,
} from "shared/view/silver";
import { MENU_VIEW } from "./config";

/** A theme string lookup (the client's `str`). */
export type ArmoryStr = (key: string, vars?: StringVars) => string;

export type ArmoryTab = "upgrades" | "unlocks" | "cosmetics";

/** The tabs in order (LB / RB, Q / E step them). */
export const ARMORY_TABS: ReadonlyArray<ArmoryTab> = ["upgrades", "unlocks", "cosmetics"];

const TAB_KIND: Readonly<Record<ArmoryTab, ArmoryItemKind>> = {
	upgrades: "upgrade",
	unlocks: "unlock",
	cosmetics: "cosmetic",
};

const TAB_KEYS: Readonly<Record<ArmoryTab, string>> = {
	upgrades: ARMORY_KEYS.tabUpgrades,
	unlocks: ARMORY_KEYS.tabUnlocks,
	cosmetics: ARMORY_KEYS.tabCosmetics,
};

/** A tab's label key. */
export function armoryTabKey(tab: ArmoryTab): string {
	return TAB_KEYS[tab];
}

/** Layout of the Armory screen (reference px): desktop, compact (a landscape phone), narrow (upright). */
export const ARMORY_SCREEN = {
	width: 820,
	compactWidth: 740,
	narrowWidth: 448,
	pad: HUD_VIEW.pad * 2,
	/** The list beside the detail (desktop, compact); narrow: the whole inner width, the detail under it. */
	listWidth: 400,
	compactListWidth: 360,
	detailGap: 12,
	/** One row of the list, and the gap between rows. */
	rowHeight: 44,
	rowGap: 4,
	/** The list's scrolling height (the screen's flexible part on a phone) and the least it shrinks to. */
	listHeight: 300,
	listMin: 96,
	/** The upright detail sheet's height (it scrolls inside). */
	sheetHeight: 210,
	/** The tab buttons. */
	tab: { w: 150, h: 30 },
	/** A level pip in a row. */
	pip: 10,
	/** The buy button. */
	buyButton: { x: 200, y: 40 },
	/** A dimmed price's text transparency (two tiers or more above the dearest owned). */
	dimTransparency: 0.55,
	scrollBar: 6,
} as const;

/** What a row's item is to the player now. */
export type ArmoryRowState = "maxed" | "owned" | "affordable" | "poor" | "unavailable";

export interface ArmoryRow {
	readonly itemId: string;
	readonly item: ArmoryItem;
	/** Levels owned, and the item's maximum. */
	readonly level: number;
	readonly maxLevel: number;
	/** The next level's tier and price (undefined: maxed). */
	readonly nextTier: number | undefined;
	readonly price: number | undefined;
	/** Silver still needed for the next level (0: affordable, or maxed). */
	readonly toGo: number;
	readonly state: ArmoryRowState;
	/** The next goal (the cheapest next level), the one after it, or neither. */
	readonly mark: "next" | "after" | undefined;
	/** The price is two or more tiers above the dearest thing owned (shown dimmed). */
	readonly dim: boolean;
	/** Buying it asks to confirm (its tier is CONFIRM_FROM_TIER or higher). */
	readonly confirm: boolean;
}

/** The highest tier among every level owned (0: nothing owned). */
export function dearestOwnedTier(
	status: Readonly<WalletStatus> | undefined,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): number {
	let top = 0;
	for (const it of catalog) {
		const level = statusLevel(status, it.id);
		for (let l = 1; l <= level; l++) top = math.max(top, itemTier(it, l) ?? 0);
	}
	return top;
}

/** The tiers a price may sit above the dearest owned before it is dimmed (two or more: dimmed). */
const DIM_FROM_TIERS_ABOVE = 2;

/** One item's row (see the file comment). */
export function armoryRow(
	it: Readonly<ArmoryItem>,
	status: Readonly<WalletStatus> | undefined,
	dearest: number,
	goals: ReadonlyArray<{ readonly itemId: string; readonly level: number }>,
): ArmoryRow {
	const level = statusLevel(status, it.id);
	const maxLevel = it.tiers.size();
	const nextTier = itemTier(it, level + 1);
	const price = nextTier !== undefined ? tierPrice(nextTier) : undefined;
	const balance = statusBalance(status);
	const toGo = price !== undefined ? math.max(0, price - balance) : 0;
	const loaded = walletShown(status) === "loaded";
	let state: ArmoryRowState;
	if (!loaded) state = "unavailable";
	else if (price === undefined) state = it.kind === "upgrade" ? "maxed" : "owned";
	else state = toGo === 0 ? "affordable" : "poor";
	const g0 = goals[0];
	const g1 = goals[1];
	const mark =
		g0 !== undefined && g0.itemId === it.id && g0.level === level + 1
			? "next"
			: g1 !== undefined && g1.itemId === it.id && g1.level === level + 1
			? "after"
			: undefined;
	return {
		itemId: it.id,
		item: it,
		level,
		maxLevel,
		nextTier,
		price,
		toGo,
		state,
		mark,
		dim: nextTier !== undefined && nextTier - dearest >= DIM_FROM_TIERS_ABOVE,
		confirm: nextTier !== undefined && nextTier >= CONFIRM_FROM_TIER,
	};
}

/** A tab's rows, sorted by the tier they would buy next (maxed last), ties in catalogue order. */
export function armoryRows(
	tab: ArmoryTab,
	status: Readonly<WalletStatus> | undefined,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): ArmoryRow[] {
	const dearest = dearestOwnedTier(status, catalog);
	const goals = status?.loaded === true ? status.goals ?? [] : [];
	const rows: { row: ArmoryRow; key: number; index: number }[] = [];
	for (let index = 0; index < catalog.size(); index++) {
		const it = catalog[index];
		if (it.kind !== TAB_KIND[tab]) continue;
		const row = armoryRow(it, status, dearest, goals);
		const top = it.tiers[it.tiers.size() - 1] ?? 0;
		// Maxed / owned items after every buyable one.
		const key = row.nextTier !== undefined ? row.nextTier : ARMORY_SORT_MAXED + top;
		rows.push({ row, key, index });
	}
	rows.sort((a, b) => (a.key !== b.key ? a.key < b.key : a.index < b.index));
	return rows.map((r) => r.row);
}

/** Sort key offset that puts maxed items after every tier. */
const ARMORY_SORT_MAXED = 100;

/** Half hearts as the effect lines write them: `3`, `2 1/2`, `1/2`. */
export function heartsText(halfHearts: number, s: ArmoryStr): string {
	const whole = math.floor(halfHearts / 2);
	const half = halfHearts % 2 === 1;
	if (!half) return s(ARMORY_KEYS.heartsWhole, { n: whole });
	if (whole === 0) return s(ARMORY_KEYS.heartHalfOnly);
	return s(ARMORY_KEYS.heartsHalf, { n: whole });
}

/** `levels` with track `track` at `level`. */
function withLevel(levels: Readonly<UpgradeLevels>, track: keyof UpgradeLevels, level: number): UpgradeLevels {
	return { ...levels, [track]: level } as UpgradeLevels;
}

/** The character-name key of `id` (`class.<visual>.name`: Knight / Archer). */
function characterNameKey(id: CharacterId): string {
	return `${characterDef(id).visualId}.name`;
}

/**
 * The exact effect lines of item `itemId` now (at `level`) and at `level + 1` (SVD11): Vigor per character (its hearts),
 * Deep Flask the flask charges, Plating the armor pips, Prospector the share of Silver; at the top level `{label}
 * {now}`. Unlocks and cosmetics have none.
 */
export function armoryEffectLines(itemId: string, level: number, maxLevel: number, s: ArmoryStr): string[] {
	const out: string[] = [];
	const line = (label: string, now: string, after: string | undefined) =>
		out.push(
			after !== undefined
				? s(ARMORY_KEYS.effectChange, { label, from: now, to: after })
				: s(ARMORY_KEYS.effectNow, { label, now }),
		);
	const nextLevel = level < maxLevel ? level + 1 : undefined;
	if (itemId === UPGRADE_ITEM.vigor) {
		for (const id of CHARACTER_IDS) {
			const at = (l: number) => playerStartHalfHearts(upgradeTraits(id, withLevel(NO_UPGRADES, "vigor", l)));
			line(
				s(characterNameKey(id)),
				heartsText(at(level), s),
				nextLevel !== undefined ? heartsText(at(nextLevel), s) : undefined,
			);
		}
	} else if (itemId === UPGRADE_ITEM.deepFlask) {
		const at = (l: number) =>
			tostring(playerStartFlaskMax(upgradeTraits(CHARACTER_IDS[0], withLevel(NO_UPGRADES, "deepFlask", l))));
		line(s(ARMORY_KEYS.labelFlask), at(level), nextLevel !== undefined ? at(nextLevel) : undefined);
	} else if (itemId === UPGRADE_ITEM.plating) {
		const at = (l: number) =>
			tostring(playerStartArmorMax(upgradeTraits(CHARACTER_IDS[0], withLevel(NO_UPGRADES, "plating", l))));
		line(s(ARMORY_KEYS.labelArmor), at(level), nextLevel !== undefined ? at(nextLevel) : undefined);
	} else if (itemId === UPGRADE_ITEM.prospector) {
		const at = (l: number) => s(ARMORY_KEYS.percent, { n: l * SILVER.prospectorPercentPerLevel });
		line(s(ARMORY_KEYS.labelSilver), at(level), nextLevel !== undefined ? at(nextLevel) : undefined);
	}
	return out;
}

/** What the detail's buy button does. */
export type ArmoryBuyAction = "hold" | "holdConfirm" | "none";

export interface ArmoryDetail {
	readonly itemId: string;
	/** The item at the level it would buy next (at its top level when maxed). */
	readonly title: string;
	/** `Tier 5` of the next level (undefined: maxed). */
	readonly tier: string | undefined;
	readonly desc: string;
	readonly effects: ReadonlyArray<string>;
	/** `Level 1/2` for a levelled item (undefined for a one-level unlock). */
	readonly levels: string | undefined;
	/** The price line: the price, or Owned / Max level / Armory unavailable. */
	readonly price: string;
	/** `140 to go` (undefined when affordable or not buyable). */
	readonly toGo: string | undefined;
	readonly buy: ArmoryBuyAction;
	readonly row: ArmoryRow;
}

/** The detail of `row` (see the file comment). */
export function armoryDetail(row: Readonly<ArmoryRow>, s: ArmoryStr): ArmoryDetail {
	const it = row.item;
	const shownLevel = row.nextTier !== undefined ? row.level + 1 : row.maxLevel;
	const desc =
		it.id === UPGRADE_ITEM.prospector
			? s(armoryItemDescKey(it.id), { percent: SILVER.prospectorPercentPerLevel })
			: s(armoryItemDescKey(it.id));
	let price: string;
	if (row.state === "unavailable") price = s(ARMORY_KEYS.unavailable);
	else if (row.state === "maxed") price = s(ARMORY_KEYS.maxed);
	else if (row.state === "owned") price = s(ARMORY_KEYS.owned);
	else price = tostring(row.price ?? 0);
	const buyable = row.state === "affordable";
	return {
		itemId: it.id,
		title: armoryItemLabel(it.id, shownLevel, s),
		tier: row.nextTier !== undefined ? s(ARMORY_KEYS.tier, { tier: row.nextTier }) : undefined,
		desc,
		effects: armoryEffectLines(it.id, row.level, row.maxLevel, s),
		levels: row.maxLevel > 1 ? s(ARMORY_KEYS.levels, { level: row.level, max: row.maxLevel }) : undefined,
		price,
		toGo: row.state === "poor" ? s(ARMORY_KEYS.toGo, { silver: row.toGo }) : undefined,
		buy: buyable ? (row.confirm ? "holdConfirm" : "hold") : "none",
		row,
	};
}

/** A row's level pips: `level` filled of `maxLevel` (unlocks: none). */
export function armoryPips(row: Readonly<ArmoryRow>): ReadonlyArray<boolean> {
	if (row.item.kind !== "upgrade") return [];
	const out: boolean[] = [];
	for (let i = 1; i <= row.maxLevel; i++) out.push(i <= row.level);
	return out;
}

/** The keys of the next levels the balance covers now (`<itemId>:<level>`), for the main menu's badge. */
export function affordableKeys(
	status: Readonly<WalletStatus> | undefined,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): string[] {
	const out: string[] = [];
	if (walletShown(status) !== "loaded") return out;
	const balance = statusBalance(status);
	for (const it of catalog) {
		const level = statusLevel(status, it.id) + 1;
		const tier = itemTier(it, level);
		const price = tier !== undefined ? tierPrice(tier) : undefined;
		if (price !== undefined && price <= balance) out.push(`${it.id}:${level}`);
	}
	return out;
}

/** The main menu's Armory badge: something affordable now the player has not seen in the Armory since. */
export function armoryBadge(status: Readonly<WalletStatus> | undefined, seen: ReadonlyArray<string>): boolean {
	for (const k of affordableKeys(status)) if (!seen.includes(k)) return true;
	return false;
}

/** The levels the next run will apply (the character screen's upgrades line): the sim-lever tracks only. */
export function runUpgradeLevels(status: Readonly<WalletStatus> | undefined): UpgradeLevels {
	return statusUpgrades(status);
}

/**
 * The upgrades the next run applies as one line (`Upgrades: Vigor II · Plating`, the item labels at their owned level;
 * `No upgrades yet` without any). Prospector counts too (it pays from the next run).
 */
export function upgradesLine(status: Readonly<WalletStatus> | undefined, s: ArmoryStr, sep: string): string {
	const parts: string[] = [];
	for (const it of ARMORY_CATALOG) {
		if (it.kind !== "upgrade") continue;
		const level = statusLevel(status, it.id);
		if (level > 0) parts.push(armoryItemLabel(it.id, level, s));
	}
	if (parts.size() === 0) return s(CHARACTER_LOCK_KEYS.noUpgrades);
	return s(CHARACTER_LOCK_KEYS.upgrades, { list: parts.join(sep) });
}

/** The buy button's press-and-hold (mouse, touch, the pad's A): one completion per press. Seconds, any growing clock. */
export class BuyHold {
	private pressedAt: number | undefined;
	private done = false;

	/** The press began at `nowSec`. */
	press(nowSec: number): void {
		this.pressedAt = nowSec;
		this.done = false;
	}

	/** The press ended (released, left the button, focus moved). */
	release(): void {
		this.pressedAt = undefined;
	}

	/** `complete` exactly once per press held SILVER_SHOP.holdSec; `holding` before; `idle` otherwise. */
	step(nowSec: number): "idle" | "holding" | "complete" {
		const at = this.pressedAt;
		if (at === undefined || this.done) return "idle";
		if (nowSec - at >= SILVER_SHOP.holdSec) {
			this.done = true;
			return "complete";
		}
		return "holding";
	}

	/** The fill, 0..1 (0 while not pressed; 1 once complete until released). */
	progress(nowSec: number): number {
		const at = this.pressedAt;
		if (at === undefined) return 0;
		if (this.done) return 1;
		return math.clamp((nowSec - at) / SILVER_SHOP.holdSec, 0, 1);
	}
}

/**
 * The screen's content height (reference px, padding excluded) for the fit spec: the title row, the tabs, the body (the
 * list beside the detail; upright: the detail sheet under the list) and the Back row.
 */
export function armoryContentHeight(narrow: boolean, listH: number, titleLineH: number): number {
	const S = ARMORY_SCREEN;
	const body = narrow ? listH + S.detailGap + S.sheetHeight : listH;
	const rows = [titleLineH, S.tab.h, body, MENU_VIEW.smallButton.y];
	let h = 0;
	for (const r of rows) h += r;
	return h + (rows.size() - 1) * HUD_VIEW.gap;
}
