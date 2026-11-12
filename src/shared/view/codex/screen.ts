/**
 * The Codex screen's view rules (claude/codex-plan.md "Main menu and the Codex screen", CX7). Pure: the client's
 * CodexScreen (client/ui/menu) draws them; headlessly tested (screen.spec.ts).
 *
 *   CODEX_SCREEN        the layout tunables (reference px): desktop / compact (a landscape phone) / narrow (upright)
 *   codexGridColumns    how many tiles fit a row of the grid
 *   codexTileState      unknown / seen / found, and codexTileNew (the NEW dot: unread in the doc, not focused yet)
 *   codexTabRows        the tab row: each tab's found / total and its NEW dot (codexTabLabel: `{tab} {found}/{total}`)
 *   codexGridGroups     a tab's tiles in grid order, by group with their sub-headers (the items tab: Relics, Curses;
 *                       the Bestiary: Enemies, Champions, Bosses); boons sorted by rarity (common, rare, legendary)
 *   codexDetail         the detail panel: the name in its role colour, the kind line, the description or tell (an
 *                       unknown tile: its hint, decision R3), a duo's two boons (unknown ones `???`), an evolution's boon
 *                       (in the kind line), the Seen / Found line (zero parts skipped), the character tag (R7)
 *   codexCompletionPct  the completion percentage (floored: 100 only when every entry is found)
 *   codexBadgeText      the main menu button's badge (`9+` above CODEX_SCREEN.badgeMax)
 *   codexTabScrollX     the scrolling tab row's canvas x that keeps the current tab in view
 *
 * Text goes through an injected lookup (`CodexStr`: the client's `str`, a spec's fake), so every line here is final.
 */
import {
	CODEX_TABS,
	CODEX_TAB_GROUPS,
	CodexTier,
	catalogTotal,
	codexEntry,
	codexFoundCount,
	codexTabEntries,
	codexTier,
	type CodexDoc,
	type CodexEntry,
	type CodexGroup,
	type CodexMark,
	type CodexTab,
} from "shared/codex";
import { DAILY } from "shared/daily";
import { BOONS } from "shared/sim";
import {
	BOOST_KINDS,
	affixRole,
	boostId,
	codexGroupNameKey,
	codexKindKey,
	codexRequiresKey,
	codexTabNameKey,
	type ColorRole,
	type StringVars,
} from "shared/theme";
import {
	BUILD_DUO_ROLE,
	BUILD_EVOLVED_ROLE,
	CURSE_COLOR_ROLE,
	HUD_VIEW,
	RELIC_COLOR_ROLE,
	dailyCivilDate,
	dailyMonthKey,
	rarityColorRole,
	rarityNameKey,
} from "shared/view/hud";

/** A theme string lookup (the client's `str`; ThemePack.str). */
export type CodexStr = (key: string, vars?: StringVars) => string;

/** The Codex screen's strings (shared/theme CODEX_STRING_KEYS). */
export const CODEX_SCREEN_STRINGS = {
	title: "codex.title",
	/** `{pct}%`. */
	completion: "codex.completion",
	/** `{tab} {found}/{total}`. */
	tabCount: "codex.tab.count",
	unknown: "codex.unknown",
	seen: "codex.state.seen",
	/** `Found on floor {floor} · {date}`, and the variants without the floor / the date / either. */
	found: "codex.state.found",
	foundFloor: "codex.state.foundFloor",
	foundDate: "codex.state.foundDate",
	foundAny: "codex.state.foundAny",
	/** `{day} {month} {year}`. */
	date: "codex.date",
	hintEnemy: "codex.hint.enemy",
	hintAffix: "codex.hint.affix",
	hintBoss: "codex.hint.boss",
	hintEvo: "codex.hint.evo",
	hintDuo: "codex.hint.duo",
	hintDuoLocked: "codex.hint.duoLocked",
	/** The main menu's button and its badge above badgeMax (`{n}+`). */
	menu: "menu.codex",
	menuMore: "menu.codexMore",
	unavailable: "codex.unavailable",
} as const;

/** Layout of the Codex screen (reference px). */
export const CODEX_SCREEN = {
	/** The panel's width: desktop (and a touch tablet), compact (a landscape phone), narrow (upright). */
	width: 900,
	compactWidth: 762,
	narrowWidth: 448,
	/** The panel's padding per side (HUD_VIEW.pad * 2, as the other menu screens). */
	pad: HUD_VIEW.pad * 2,
	/** The grid's width beside the detail panel (desktop, compact); narrow: the whole inner width. */
	gridWidth: 520,
	compactGridWidth: 440,
	/** Between the grid and the detail panel (desktop, compact) / the detail sheet (narrow). */
	detailGap: 12,
	/** A tile (square) and the gap between tiles. */
	tile: 56,
	tileGap: 6,
	/** Columns are clamped into this range. */
	minColumns: 3,
	maxColumns: 10,
	/** The grid's scrolling height (the screen's flexible list: MenuFit shrinks it on a phone, never below listMin). */
	gridHeight: 340,
	gridMin: 96,
	/** The upright detail sheet's height (it scrolls inside). */
	sheetHeight: 200,
	/** The detail's art box: beside the grid, and in the upright sheet. */
	artBox: 96,
	sheetArtBox: 56,
	/** A duo's boon chip in the detail. */
	chip: { w: 140, h: 26 },
	/** The tab buttons: one row (it scrolls when the panel is narrower); wider for the tabs with long names. */
	tab: { w: 128, h: 30, wideW: 184 },
	wideTabs: ["items"] as ReadonlyArray<CodexTab>,
	/** The NEW dot (tiles and tabs): its side and its inset from the corner. */
	dot: 8,
	dotInset: 3,
	/** The completion bar beside the title. */
	bar: { w: 220, h: 8 },
	/** The scroll bar of the grid and the tab row. */
	scrollBar: 6,
	/** The menu badge counts up to this, then reads `{n}+`. */
	badgeMax: 9,
	/** A seen tile's art transparency (45 % opacity). */
	seenTransparency: 0.55,
} as const;

/** What a tile shows. */
export type CodexTileState = "unknown" | "seen" | "found";

/** A tile in the grid. */
export interface CodexTileModel {
	readonly id: string;
	readonly state: CodexTileState;
	/** The NEW dot (unread in the doc and not focused on this visit). */
	readonly isNew: boolean;
}

/** One group of a tab's grid: its sub-header (only in tabs with more than one group) and its tiles. */
export interface CodexGridGroup {
	readonly group: CodexGroup;
	readonly headerKey?: string;
	readonly tiles: ReadonlyArray<CodexTileModel>;
}

/** One tab of the tab row. */
export interface CodexTabRow {
	readonly tab: CodexTab;
	readonly nameKey: string;
	readonly found: number;
	readonly total: number;
	/** Some entry inside has a NEW dot. */
	readonly isNew: boolean;
}

const NO_VIEWED: ReadonlySet<string> = new Set<string>();
const PERCENT = 100;

/**
 * How many tiles fit a grid row `widthPx` screen px wide at `scale` screen px per reference px (tiles and gaps are
 * CODEX_SCREEN's reference px), clamped into [minColumns, maxColumns]. A bad scale counts as 1.
 */
export function codexGridColumns(widthPx: number, scale: number): number {
	const S = CODEX_SCREEN;
	const s = scale > 0 && scale < math.huge ? scale : 1;
	const ref = math.max(0, widthPx) / s;
	const n = math.floor((ref + S.tileGap) / (S.tile + S.tileGap));
	return math.clamp(n, S.minColumns, S.maxColumns);
}

/** The grid's drawn width for `columns` tiles (reference px). */
export function codexGridWidth(columns: number): number {
	return columns * CODEX_SCREEN.tile + math.max(0, columns - 1) * CODEX_SCREEN.tileGap;
}

/** Rows of `count` tiles at `columns` per row. */
export function codexGridRowCount(count: number, columns: number): number {
	return columns > 0 ? math.ceil(count / columns) : 0;
}

/** Entry `id`'s tile state in `doc` (unknown without a doc). */
export function codexTileState(doc: Readonly<CodexDoc> | undefined, id: string): CodexTileState {
	const tier = codexTier(doc, id);
	return tier >= CodexTier.FOUND ? "found" : tier >= CodexTier.SEEN ? "seen" : "unknown";
}

/** The set of unread ids of `doc` (the NEW dots). */
function unreadSet(doc: Readonly<CodexDoc> | undefined): ReadonlySet<string> {
	const out = new Set<string>();
	if (doc?.unread !== undefined) for (const id of doc.unread) out.add(id);
	return out;
}

/** Entry `id` wears the NEW dot: unread in `doc` and not in `viewed` (the tiles focused on this visit). */
export function codexTileNew(
	doc: Readonly<CodexDoc> | undefined,
	id: string,
	viewed: ReadonlySet<string> = NO_VIEWED,
): boolean {
	return doc?.unread !== undefined && doc.unread.includes(id) && !viewed.has(id);
}

/** The NEW dots left in `doc` once `viewed` are cleared (the badge while the screen is open). */
export function codexNewCount(doc: Readonly<CodexDoc> | undefined, viewed: ReadonlySet<string> = NO_VIEWED): number {
	let n = 0;
	if (doc?.unread !== undefined) for (const id of doc.unread) if (!viewed.has(id)) n++;
	return n;
}

/** The tab row, in CODEX_TABS order. */
export function codexTabRows(
	doc: Readonly<CodexDoc> | undefined,
	viewed: ReadonlySet<string> = NO_VIEWED,
): CodexTabRow[] {
	const unread = unreadSet(doc);
	const out: CodexTabRow[] = [];
	for (const tab of CODEX_TABS) {
		let isNew = false;
		for (const e of codexTabEntries(tab)) if (unread.has(e.id) && !viewed.has(e.id)) isNew = true;
		out.push({
			tab,
			nameKey: codexTabNameKey(tab),
			found: codexFoundCount(doc, tab),
			total: catalogTotal(tab),
			isNew,
		});
	}
	return out;
}

/** A tab button's label: `Boons 9/20`. */
export function codexTabLabel(row: CodexTabRow, s: CodexStr): string {
	return s(CODEX_SCREEN_STRINGS.tabCount, { tab: s(row.nameKey), found: row.found, total: row.total });
}

/** A tab button's width (the long-named tabs are wider). */
export function codexTabWidth(tab: CodexTab): number {
	return CODEX_SCREEN.wideTabs.includes(tab) ? CODEX_SCREEN.tab.wideW : CODEX_SCREEN.tab.w;
}

/** The tab row's full width (every tab and the gaps). */
export function codexTabRowWidth(gap: number): number {
	let w = 0;
	for (const tab of CODEX_TABS) w += codexTabWidth(tab);
	return w + (CODEX_TABS.size() - 1) * gap;
}

/**
 * The tab row's canvas x (reference px) that shows tab `tab` in a row `viewW` wide scrolled to `currentX`: unchanged
 * when it is already in view, else the least scroll that brings it in (never past either end).
 */
export function codexTabScrollX(tab: CodexTab, gap: number, viewW: number, currentX: number): number {
	let left = 0;
	for (const t of CODEX_TABS) {
		if (t === tab) break;
		left += codexTabWidth(t) + gap;
	}
	const right = left + codexTabWidth(tab);
	const maxX = math.max(0, codexTabRowWidth(gap) - viewW);
	let x = math.clamp(currentX, 0, maxX);
	if (left < x) x = left;
	else if (right > x + viewW) x = right - viewW;
	return math.clamp(x, 0, maxX);
}

/** A boon entry's rarity (Rarity index), 0 for anything else. */
function boonRarity(e: CodexEntry): number {
	return e.artRef.kind === "boon" ? BOONS[e.artRef.index]?.rarity ?? 0 : 0;
}

/**
 * Tab `tab`'s tiles in grid order, grouped (CODEX_TAB_GROUPS), each group with its sub-header when the tab has more
 * than one. Boons are sorted by rarity (common, rare, legendary), data order within a rarity.
 */
export function codexGridGroups(
	tab: CodexTab,
	doc: Readonly<CodexDoc> | undefined,
	viewed: ReadonlySet<string> = NO_VIEWED,
): CodexGridGroup[] {
	const groups = CODEX_TAB_GROUPS[tab];
	const entries = codexTabEntries(tab);
	const unread = unreadSet(doc);
	const out: CodexGridGroup[] = [];
	for (const group of groups) {
		const inGroup: CodexEntry[] = [];
		for (const e of entries) if (e.group === group) inGroup.push(e);
		if (group === "boons") {
			inGroup.sort((a, b) => {
				const ra = boonRarity(a);
				const rb = boonRarity(b);
				return ra !== rb ? ra < rb : a.order < b.order;
			});
		}
		const tiles: CodexTileModel[] = [];
		for (const e of inGroup) {
			tiles.push({ id: e.id, state: codexTileState(doc, e.id), isNew: unread.has(e.id) && !viewed.has(e.id) });
		}
		out.push({ group, headerKey: groups.size() > 1 ? codexGroupNameKey(group) : undefined, tiles });
	}
	return out;
}

/** Every tile id of a tab, in grid order (the groups flattened). */
export function codexGridIds(tab: CodexTab): string[] {
	const out: string[] = [];
	for (const g of codexGridGroups(tab, undefined)) for (const t of g.tiles) out.push(t.id);
	return out;
}

/** The completion percentage: floored, so 100 only once every entry is found (0 for an empty total). */
export function codexCompletionPct(found: number, total: number): number {
	if (!(total > 0)) return 0;
	return math.clamp(math.floor((math.max(0, found) * PERCENT) / total), 0, PERCENT);
}

/** The menu badge's text for `count` NEW dots: none at 0, the count up to badgeMax, then `{n}+`. */
export function codexBadgeText(count: number, s: CodexStr): string | undefined {
	if (!(count > 0)) return undefined;
	if (count > CODEX_SCREEN.badgeMax) return s(CODEX_SCREEN_STRINGS.menuMore, { n: CODEX_SCREEN.badgeMax });
	return tostring(math.floor(count));
}

// --- The detail panel ----------------------------------------------------------------------------------------------

/** One of a duo's boons in the detail: its name, or `???` while that boon is unknown. */
export interface CodexDetailBoon {
	readonly id: string;
	readonly name: string;
	readonly known: boolean;
}

export interface CodexDetailModel {
	readonly id: string;
	readonly state: CodexTileState;
	/** The name (`???` while unknown) and its colour role (uiTextDim while unknown). */
	readonly name: string;
	readonly nameRole: ColorRole;
	/** The kind line (`Rare boon`, `Evolution of Volatile`, `Duo`, `Champion`, ...); undefined while unknown. */
	readonly kind?: string;
	/** The description / tell (seen, found), or the unknown tile's hint. */
	readonly body: string;
	readonly bodyIsHint: boolean;
	/** A seen / found duo's two boons (unknown boons read `???`). */
	readonly duo?: ReadonlyArray<CodexDetailBoon>;
	/** A seen / found evolution's boon (also named in the kind line). */
	readonly boon?: CodexDetailBoon;
	/** `Seen` or the Found line; undefined while unknown. */
	readonly status?: string;
	/** R7: `Knight only` / `Archer only` for a weapon-gated entry (in every state). */
	readonly requires?: string;
}

/** The day index the Daily's date helpers count from (shared/daily: DAILY.epochSeconds), in unix days. */
function dailyEpochDay(): number {
	return math.floor(DAILY.epochSeconds / DAILY.secondsPerDay);
}

/** A Codex day stamp (unix days, shared/codex codexDay) as `3 Nov 2026` (`codex.date`, the month a daily name). */
export function codexDateText(day: number, s: CodexStr): string {
	const d = dailyCivilDate(day - dailyEpochDay());
	return s(CODEX_SCREEN_STRINGS.date, { day: d.date, month: s(dailyMonthKey(d.month)), year: d.year });
}

/**
 * The state line of a mark: `Seen`, or the Found line with its floor and date, a zero part skipped (day 0 or floor 0
 * is unknown: a seeded or fake entry). Undefined for no mark.
 */
export function codexStatusLine(mark: Readonly<CodexMark> | undefined, s: CodexStr): string | undefined {
	if (mark === undefined || mark[0] < CodexTier.SEEN) return undefined;
	if (mark[0] < CodexTier.FOUND) return s(CODEX_SCREEN_STRINGS.seen);
	const day = mark[1];
	const floor = mark[2];
	const T = CODEX_SCREEN_STRINGS;
	if (day > 0 && floor > 0) return s(T.found, { floor, date: codexDateText(day, s) });
	if (floor > 0) return s(T.foundFloor, { floor });
	if (day > 0) return s(T.foundDate, { date: codexDateText(day, s) });
	return s(T.foundAny);
}

function found(doc: Readonly<CodexDoc> | undefined, id: string): boolean {
	return codexTier(doc, id) >= CodexTier.FOUND;
}

function nameOf(id: string, s: CodexStr): string {
	const e = codexEntry(id);
	return e !== undefined ? s(e.nameKey) : s(CODEX_SCREEN_STRINGS.unknown);
}

/** An unknown tile's hint (R3): the line by the entry's hint kind; an evolution's / duo's once its boons are found. */
export function codexHintText(entry: CodexEntry, doc: Readonly<CodexDoc> | undefined, s: CodexStr): string {
	const h = entry.hint;
	const T = CODEX_SCREEN_STRINGS;
	switch (h.kind) {
		case "enemy":
			return s(T.hintEnemy);
		case "affix":
			return s(T.hintAffix, { floor: h.floor });
		case "boss":
			return s(T.hintBoss, { every: h.every });
		case "evo":
			return found(doc, h.boon) ? s(T.hintEvo, { boon: nameOf(h.boon, s) }) : s(T.unknown);
		case "duo":
			return found(doc, h.a) && found(doc, h.b)
				? s(T.hintDuo, { a: nameOf(h.a, s), b: nameOf(h.b, s) })
				: s(T.hintDuoLocked);
	}
	return s(T.unknown);
}

/** An entry's colour role (its rarity, boon.evolved / boon.duo, the relic / curse role, the boost / affix colour). */
export function codexEntryRole(entry: CodexEntry): ColorRole {
	const a = entry.artRef;
	switch (entry.group) {
		case "boons":
			return rarityColorRole(boonRarity(entry));
		case "evolutions":
			return BUILD_EVOLVED_ROLE;
		case "duos":
			return BUILD_DUO_ROLE;
		case "relics":
			return RELIC_COLOR_ROLE;
		case "curses":
			return CURSE_COLOR_ROLE;
		case "boosts": {
			const kind = a.kind === "boost" ? BOOST_KINDS[a.index] : undefined;
			return kind !== undefined ? boostId(kind) : "uiText";
		}
		case "champions":
			return a.kind === "affix" ? affixRole(a.affix) : "uiText";
		case "bosses":
			return "uiHealth";
	}
	return "uiText";
}

function detailBoon(id: string, doc: Readonly<CodexDoc> | undefined, s: CodexStr): CodexDetailBoon {
	const known = codexTier(doc, id) >= CodexTier.SEEN;
	return { id, known, name: known ? nameOf(id, s) : s(CODEX_SCREEN_STRINGS.unknown) };
}

/** The kind line of a seen / found entry. */
function kindLine(entry: CodexEntry, doc: Readonly<CodexDoc> | undefined, s: CodexStr): string | undefined {
	const key = codexKindKey(entry.group);
	if (key === undefined) return undefined;
	if (entry.group === "boons") return s(key, { rarity: s(rarityNameKey(boonRarity(entry))) });
	if (entry.group === "evolutions" && entry.hint.kind === "evo") {
		return s(key, { boon: detailBoon(entry.hint.boon, doc, s).name });
	}
	return s(key);
}

/** The detail panel for entry `id` (undefined for an unknown id). */
export function codexDetail(
	id: string,
	doc: Readonly<CodexDoc> | undefined,
	s: CodexStr,
): CodexDetailModel | undefined {
	const entry = codexEntry(id);
	if (entry === undefined) return undefined;
	const state = codexTileState(doc, id);
	const requires = entry.requires !== undefined ? s(codexRequiresKey(entry.requires)) : undefined;
	if (state === "unknown") {
		return {
			id,
			state,
			name: s(CODEX_SCREEN_STRINGS.unknown),
			nameRole: "uiTextDim",
			body: codexHintText(entry, doc, s),
			bodyIsHint: true,
			requires,
		};
	}
	const h = entry.hint;
	return {
		id,
		state,
		name: s(entry.nameKey),
		nameRole: codexEntryRole(entry),
		kind: kindLine(entry, doc, s),
		body: s(entry.descKey),
		bodyIsHint: false,
		duo: h.kind === "duo" ? [detailBoon(h.a, doc, s), detailBoon(h.b, doc, s)] : undefined,
		boon: h.kind === "evo" ? detailBoon(h.boon, doc, s) : undefined,
		status: codexStatusLine(doc?.e.get(id), s),
		requires,
	};
}
