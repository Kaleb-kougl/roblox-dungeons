/**
 * How the co-op contribution is drawn on the run-over panel (docs/RUN_CONTRIBUTION.md CT5): the `You | Team | Party`
 * tabs (party runs only), the You card (header, damage share bar, cells, standing line), the Party rows and the box
 * they share in the highlights' slot, in the wide / compact / narrow layouts (CONTRIB_UI, the recap's RECAP_UI style),
 * plus the pure text helpers RecapController and the panel share. The contribution's numbers are contribution.ts;
 * presentation only.
 *
 *   - `RECAP_TABS` / `recapTabStep`  the tab order (You first: a party run opens on You, CTD1) and LB / RB / Q / E /
 *                                    Tab's step (wraps around: three tabs cycle).
 *   - `recapTabsShown`               a run over draws the tabs: a recap with a contribution (party runs) and
 *                                    highlights (the Team tab's content).
 *   - `contribCellMetrics`           the You cells per layout: the highlight cell itself (label over value, four a
 *                                    row) on desktop, one line (label left, value right, two a row) on a phone.
 *   - `contribCardHeight` / `contribPartyHeight` / `contribBoxHeight`   the You card's, the Party list's and the
 *                                    tab body's heights (the box is the taller of You and Team, so switching tabs never
 *                                    resizes the panel; the Party list scrolls inside it when taller).
 *   - `contribShareSegments`         the damage share bar: one segment per player with a share, index order, whole
 *                                    px summing to the bar's width; the local one flagged (drawn bright).
 *   - `contribCellText`              a You cell's value at a counted value: `{value} · {pct}%`, the pickups parts, or
 *                                    the grouped number (RichText-escaped: the cell draws RichText).
 *   - `contribPartyTexts`            one Party row's texts (name, title, damage share, kills, parries, hits).
 *
 * @module
 */
import { formatThousands } from "shared/l10n";
import { richTextEscape } from "./comboDraw";
import { HUD_VIEW } from "./layout";
import {
	contribPickupParts,
	contribStandingText,
	type ContribCell,
	type ContributionRow,
	type RunContribution,
} from "./contribution";
import { CONTRIB, CONTRIB_STRINGS, contribTitleKey } from "./contributionConfig";
import { RECAP_UI, recapGridSize, type RecapFormat, type RecapLayout, type RecapStr } from "./recapUi";

/** A tab of a party run's run-over panel. */
export type RecapTab = "you" | "team" | "party";

/** The tabs in strip order; a party run opens on the first (You, CTD1). */
export const RECAP_TABS: ReadonlyArray<RecapTab> = ["you", "team", "party"];

/** The tab a party run's run over opens on (CTD1; never remembered between runs). */
export const RECAP_FIRST_TAB: RecapTab = "you";

/** One recap cell's look (the highlight grid's cell and the You cells). */
export interface RecapCellMetrics {
	readonly width: number;
	readonly height: number;
	/** Label and value on one line (label left, value right) instead of the label over the value. */
	readonly inline: boolean;
	/** Label: TextScaled up to `labelText`, never below `labelMinText`. */
	readonly labelText: number;
	readonly labelMinText: number;
	readonly valueText: number;
	readonly valueMinText: number;
	/** Stacked: the label's and the value's line heights (cellHeight minus them is the vertical padding). */
	readonly labelHeight: number;
	readonly valueHeight: number;
	/** Inline: the label's share of the cell's inner width (the value takes the rest). */
	readonly labelShare: number;
}

/** The You card's pieces in one layout (reference px). */
export interface ContribCardLayout {
	readonly cell: RecapCellMetrics;
	/** Cells a row (their widths and HUD_VIEW.gap between them are the box's width, contribBoxWidth). */
	readonly columns: number;
	/** Between the card's rows and between cell rows (the layout's list gap). */
	readonly gap: number;
	/** `You · {title}`: TextScaled up to headerText (min headerMinText) in a headerHeight line. */
	readonly headerHeight: number;
	readonly headerText: number;
	readonly headerMinText: number;
	/**
	 * The share bar (barWidth x barHeight): its own row with its label beside it (shareHeight tall), or with
	 * `shareInHeader` at the header row's right end with no label (a landscape phone: the Damage cell already reads
	 * `{value} · {pct}%`).
	 */
	readonly shareInHeader: boolean;
	readonly shareHeight: number;
	readonly barWidth: number;
	readonly barHeight: number;
	readonly shareText: number;
	readonly shareMinText: number;
	/** The standing line. */
	readonly standingHeight: number;
	readonly standingText: number;
	readonly standingMinText: number;
}

/** The Party list in one layout: a header row, then one row per player. */
export interface ContribPartyLayout {
	readonly headerHeight: number;
	readonly rowHeight: number;
	readonly gap: number;
	readonly text: number;
	readonly minText: number;
	readonly headerText: number;
	readonly headerMinText: number;
	/**
	 * The name column's least width (contribPartyColumns gives it whatever the other columns leave of the box), the
	 * title's and each number's widths, the gap between columns.
	 */
	readonly nameWidth: number;
	readonly titleWidth: number;
	readonly numberWidth: number;
	readonly columnGap: number;
}

/** The tab strip in one layout: three buttons side by side. */
export interface ContribTabLayout {
	readonly w: number;
	readonly h: number;
	readonly text: number;
}

/** The highlight grid's own cell (RECAP_UI), as metrics. */
export const RECAP_CELL: RecapCellMetrics = {
	width: RECAP_UI.cellWidth,
	height: RECAP_UI.cellHeight,
	inline: false,
	labelText: RECAP_UI.labelText,
	labelMinText: RECAP_UI.labelMinText,
	valueText: RECAP_UI.valueText,
	valueMinText: RECAP_UI.valueMinText,
	labelHeight: RECAP_UI.labelHeight,
	valueHeight: RECAP_UI.valueHeight,
	labelShare: 1,
};

/** A one-line cell (a phone's You card): the highlight cell's width and type, label left and value right. */
const INLINE_CELL: RecapCellMetrics = {
	width: RECAP_UI.cellWidth,
	height: 22,
	inline: true,
	labelText: 14,
	labelMinText: 9,
	valueText: 16,
	valueMinText: 10,
	labelHeight: 22,
	valueHeight: 22,
	labelShare: 0.45,
};

/**
 * Wide (desktop, console): the highlight grid's own cells (48 tall, label over value), four a row (4 x 155 + 3 x 6 =
 * 638 of the 840 panel's 808 inside), so the seven cells take the Team grid's two rows and a record daily party run's
 * panel stays no taller than today's record daily run with its breakdown (fit.spec.ts). The tab strip and the Team grid
 * stay 316 wide, centred in the box.
 */
const WIDE_CARD: ContribCardLayout = {
	cell: RECAP_CELL,
	columns: 4,
	gap: 6,
	headerHeight: 22,
	headerText: 18,
	headerMinText: 12,
	shareInHeader: false,
	shareHeight: 16,
	barWidth: 140,
	barHeight: 8,
	shareText: 14,
	shareMinText: 9,
	standingHeight: 18,
	standingText: 14,
	standingMinText: 9,
};

/**
 * Narrow (a phone upright): two one-line cells a row (2 x 155 + 6 = the breakdown's 316, the panel's one column), the
 * share row with its label.
 */
const NARROW_CARD: ContribCardLayout = {
	cell: INLINE_CELL,
	columns: 2,
	gap: 2,
	headerHeight: 18,
	headerText: 16,
	headerMinText: 11,
	shareInHeader: false,
	shareHeight: 14,
	barWidth: 140,
	barHeight: 6,
	shareText: 13,
	shareMinText: 9,
	standingHeight: 16,
	standingText: 13,
	standingMinText: 9,
};

/**
 * Compact (a landscape phone, the right column beside the exits): the narrow card, 20 tall cells, the bar in the header
 * row and a 14 tall standing line, so a record daily party run still fits the smallest landscape phone (fit.spec.ts).
 */
const COMPACT_CARD: ContribCardLayout = {
	...NARROW_CARD,
	cell: { ...INLINE_CELL, height: 20, labelHeight: 20, valueHeight: 20, valueText: 15 },
	shareInHeader: true,
	barWidth: 120,
	standingHeight: 14,
	standingText: 12,
};

/** Wide: 220 + 120 + 4 x 60 + 5 x 6 = 610 of the 638 box. */
const WIDE_PARTY: ContribPartyLayout = {
	headerHeight: 16,
	rowHeight: 24,
	gap: 4,
	text: 16,
	minText: 9,
	headerText: 13,
	headerMinText: 8,
	nameWidth: 220,
	titleWidth: 120,
	numberWidth: 60,
	columnGap: 6,
};

/** A phone: 84 + 72 + 4 x 34 + 5 x 4 = 312 of the 316 box. */
const PHONE_PARTY: ContribPartyLayout = {
	headerHeight: 14,
	rowHeight: 20,
	gap: 2,
	text: 14,
	minText: 9,
	headerText: 12,
	headerMinText: 8,
	nameWidth: 84,
	titleWidth: 72,
	numberWidth: 34,
	columnGap: 4,
};

export const CONTRIB_UI = {
	/** The tab strip: 3 x 100 + 2 gaps = 312 of the breakdown's 316; a phone's shorter buttons. */
	tabs: {
		wide: { w: 100, h: 28, text: 16 },
		compact: { w: 100, h: 22, text: 14 },
		narrow: { w: 100, h: 24, text: 14 },
	} as Readonly<Record<RecapLayout, ContribTabLayout>>,
	card: { wide: WIDE_CARD, compact: COMPACT_CARD, narrow: NARROW_CARD } as Readonly<
		Record<RecapLayout, ContribCardLayout>
	>,
	party: { wide: WIDE_PARTY, compact: PHONE_PARTY, narrow: PHONE_PARTY } as Readonly<
		Record<RecapLayout, ContribPartyLayout>
	>,
	/** The share bar's other players' segments (dim, uiTextDim) and its track (uiPanel). */
	barOtherTransparency: 0.45,
	barTrackTransparency: 0.6,
	/** A leaver's Party row (dim). */
	leftTransparency: 0.5,
	/** The local Party row's outline (the playerOutline role, like the share bar's bright segment) over a faint tile. */
	localStroke: 1,
	localTileTransparency: 0.75,
	/** The title chip's background (uiTextDim under background-coloured text, the recap scope chip's look). */
	chipTransparency: 0.25,
	/** The Party list's scroll bar. */
	scrollBarThickness: 4,
	/** The Team tab's first open: its highlights start counting this long after the tab shows (s). */
	teamOpenDelaySec: 0.1,
} as const;

/** The tab's label string key. */
export function recapTabKey(tab: RecapTab): string {
	if (tab === "you") return CONTRIB_STRINGS.tabYou;
	if (tab === "team") return CONTRIB_STRINGS.tabTeam;
	return CONTRIB_STRINGS.tabParty;
}

/** The tab `dir` steps from `current` (-1 previous, +1 next, wrapping; 0: unchanged). */
export function recapTabStep(current: RecapTab, dir: number): RecapTab {
	const n = RECAP_TABS.size();
	const i = RECAP_TABS.indexOf(current);
	if (dir === 0 || i < 0) return i < 0 ? RECAP_FIRST_TAB : current;
	const j = (((i + (dir < 0 ? -1 : 1)) % n) + n) % n;
	return RECAP_TABS[j];
}

/** The run over draws the tabs: a party run's contribution and the Team tab's highlights both exist. */
export function recapTabsShown(contribution: RunContribution | undefined, highlights: number): boolean {
	return contribution !== undefined && highlights > 0;
}

/** The You cells' metrics in `layout`. */
export function contribCellMetrics(layout: RecapLayout): RecapCellMetrics {
	return CONTRIB_UI.card[layout].cell;
}

/**
 * The You cells' grid in `layout`: `columns` a row; a lone last cell (the pickups line, last in CONTRIB.cellOrder: 7
 * cells in two columns) spans the whole width as its own row under the grid. `gridCells` go in the grid, `wideLast`
 * says whether the last one is that full row.
 */
export function contribCellRows(
	cells: number,
	layout: RecapLayout,
): { readonly gridCells: number; readonly wideLast: boolean; readonly rows: number; readonly columns: number } {
	const n = math.max(0, cells);
	const cols = CONTRIB_UI.card[layout].columns;
	const wideLast = cols > 1 && n % cols === 1;
	const gridCells = wideLast ? n - 1 : n;
	return { gridCells, wideLast, rows: math.ceil(n / cols), columns: cols };
}

/** The You cells' block height: their rows of cell height, the card's gap between rows. */
export function contribCellsHeight(cells: number, layout: RecapLayout): number {
	const c = CONTRIB_UI.card[layout];
	const rows = contribCellRows(cells, layout).rows;
	return rows > 0 ? rows * c.cell.height + (rows - 1) * c.gap : 0;
}

/**
 * The You card's height: header, the share row (when there is a damage share and it is not in the header row), the
 * cells, the standing line, the card's gap between.
 */
export function contribCardHeight(cells: number, shareBar: boolean, layout: RecapLayout): number {
	const c = CONTRIB_UI.card[layout];
	const parts = [c.headerHeight];
	if (shareBar && !c.shareInHeader) parts.push(c.shareHeight);
	if (cells > 0) parts.push(contribCellsHeight(cells, layout));
	parts.push(c.standingHeight);
	let h = 0;
	for (const p of parts) h += p;
	return h + (parts.size() - 1) * c.gap;
}

/** The Party list's full height: the header row and `players` rows (it scrolls when the box is shorter). */
export function contribPartyHeight(players: number, layout: RecapLayout): number {
	const p = CONTRIB_UI.party[layout];
	const n = math.max(0, players);
	return p.headerHeight + n * (p.rowHeight + p.gap);
}

/** The Party list is taller than its box in `layout` (it scrolls; the pad's right stick is hinted). */
export function contribPartyScrolls(c: RunContribution, highlights: number, layout: RecapLayout): boolean {
	return contribPartyHeight(c.rows.size(), layout) > contribBoxHeight(c, highlights, layout);
}

/** The tab strip's height and width (3 tabs, `gap` between). */
export function contribTabsSize(layout: RecapLayout, gap: number): { readonly w: number; readonly h: number } {
	const t = CONTRIB_UI.tabs[layout];
	const n = RECAP_TABS.size();
	return { w: n * t.w + (n - 1) * gap, h: t.h };
}

/**
 * The tab body's box width in `layout`: its card's cells a row and HUD_VIEW.gap between them (wide 638; a phone 316, the
 * highlight grid's and the score breakdown's width).
 */
export function contribBoxWidth(layout: RecapLayout): number {
	const c = CONTRIB_UI.card[layout];
	return c.columns * c.cell.width + (c.columns - 1) * HUD_VIEW.gap;
}

/**
 * The tab body's box height (reference px): as tall as the taller of the You card and the Team
 * grid, so a tab switch never resizes the panel; the Party list scrolls inside it when taller (5-8 players on a phone).
 */
export function contribBoxHeight(c: RunContribution, highlights: number, layout: RecapLayout): number {
	const you = contribCardHeight(c.youCells.size(), contribShareBarShown(c), layout);
	const team = recapGridSize(highlights, HUD_VIEW.gap).h;
	return math.max(you, team);
}

/** The whole tab body's height: the strip, `gap` (the column's list gap), the box (what the fit specs count). */
export function contribTabBodyHeight(c: RunContribution, highlights: number, layout: RecapLayout, gap: number): number {
	return CONTRIB_UI.tabs[layout].h + gap + contribBoxHeight(c, highlights, layout);
}

/** The share bar draws when the team dealt any damage (the Damage cell exists). */
export function contribShareBarShown(c: RunContribution): boolean {
	for (const cell of c.youCells) if (cell.kind === "damage") return true;
	return false;
}

/** One share bar segment (reference px from the bar's left edge). */
export interface ContribShareSegment {
	readonly index: number;
	readonly x: number;
	readonly w: number;
	readonly local: boolean;
}

/**
 * The damage share bar's segments: every player with a share > 0, in index order (never sorted, no names), each
 * `round(cumulative share x width) - the previous edge` px, so the segments sum to `width` exactly when the shares sum to
 * CONTRIB.shareTotal; `local` marks the local player's (drawn bright in playerOutline, the rest dim).
 */
export function contribShareSegments(
	shares: ReadonlyArray<number>,
	localIndex: number,
	width: number,
	total: number = CONTRIB.shareTotal,
): ContribShareSegment[] {
	const out: ContribShareSegment[] = [];
	if (total <= 0 || width <= 0) return out;
	let acc = 0;
	let edge = 0;
	for (let i = 0; i < shares.size(); i++) {
		const s = math.max(0, shares[i]);
		acc += s;
		const right = math.round((math.min(acc, total) / total) * width);
		if (s > 0 && right > edge) out.push({ index: i, x: edge, w: right - edge, local: i === localIndex });
		edge = math.max(edge, right);
	}
	return out;
}

const grouped: RecapFormat = (n) => formatThousands(n);

/**
 * A You cell's value at the counted `value` (the cell's final value once landed), RichText-escaped: a cell with a share
 * reads `{value} · {pct}%` (the share is final from the start); pickups read their parts (`4 boosts · 22 pellets`; a
 * part with a zero team total left out; counting fills the boosts first, then the pellets); the rest the number alone.
 */
export function contribCellText(cell: ContribCell, value: number, s: RecapStr, fmt: RecapFormat = grouped): string {
	if (cell.kind === "pickups") {
		const v = math.max(0, math.floor(value));
		const boosts = cell.boosts !== undefined ? math.min(cell.boosts, v) : undefined;
		const pellets = cell.pellets !== undefined ? math.max(0, v - (boosts ?? 0)) : undefined;
		const parts = contribPickupParts({ ...cell, boosts, pellets });
		const texts = parts.map((p) => {
			const vars: Record<string, string> = {};
			for (const [k, n] of pairs(p.vars as unknown as ReadonlyMap<string, number>)) vars[k] = fmt(n);
			return s(p.key, vars);
		});
		const text =
			texts.size() >= 2
				? s(CONTRIB_STRINGS.youPickupsValue, { boosts: texts[0], pellets: texts[1] })
				: texts[0] ?? fmt(v);
		return richTextEscape(text);
	}
	if (cell.share !== undefined) {
		return richTextEscape(s(CONTRIB_STRINGS.youShare, { value: fmt(value), pct: cell.share }));
	}
	return richTextEscape(fmt(value));
}

/** The You card's header: `You · {title}` with the local player's title name. */
export function contribHeaderText(c: RunContribution, s: RecapStr): string {
	return s(CONTRIB_STRINGS.youHeader, { title: s(contribTitleKey(c.local.title)) });
}

/** The share row's label: `{pct}% of the team's damage`. */
export function contribShareText(c: RunContribution, s: RecapStr): string {
	return s(CONTRIB_STRINGS.youShareBar, { pct: c.local.damageShare });
}

/** The standing line of a row (the You card's is the local row's). */
export function contribStandingLine(row: ContributionRow, s: RecapStr): string {
	const t = contribStandingText(row.standing);
	return s(t.key, t.vars);
}

/** One Party row's texts (plain text: the row draws no RichText). */
export interface ContribPartyTexts {
	readonly name: string;
	readonly title: string;
	readonly damage: string;
	readonly kills: string;
	readonly parries: string;
	readonly hits: string;
	/** A leaver's standing line (`Left on floor {n}`, contribStandingText), shown in the title's place; else undefined. */
	readonly left?: string;
}

/** Party row `row`'s texts: its display name, title, damage share (`{pct}%`), kills, parries and hits taken. */
export function contribPartyTexts(row: ContributionRow, s: RecapStr, fmt: RecapFormat = grouped): ContribPartyTexts {
	return {
		name: row.name,
		title: s(contribTitleKey(row.title)),
		damage: s(CONTRIB_STRINGS.partyShare, { pct: row.damageShare }),
		kills: fmt(row.kills),
		parries: fmt(row.parries),
		hits: fmt(row.hits),
		left: row.left ? contribStandingLine(row, s) : undefined,
	};
}

/** The Party tab's column headers, left to right after the name and title columns. */
export const CONTRIB_PARTY_COLUMNS: ReadonlyArray<string> = [
	CONTRIB_STRINGS.partyDamage,
	CONTRIB_STRINGS.partyKills,
	CONTRIB_STRINGS.partyParries,
	CONTRIB_STRINGS.partyHits,
];

/** One Party column: its x (reference px from the row's left edge) and width. */
export interface ContribPartyColumn {
	readonly x: number;
	readonly w: number;
}

/**
 * The Party list's columns in `layout` (the header and every row place their cells by these, so they line up): the
 * name column takes whatever the title and the four number columns (CONTRIB_PARTY_COLUMNS) and the gaps leave of the
 * box, so the last column ends exactly at the box's right edge.
 */
export function contribPartyColumns(layout: RecapLayout): {
	readonly name: ContribPartyColumn;
	readonly title: ContribPartyColumn;
	readonly numbers: ReadonlyArray<ContribPartyColumn>;
} {
	const P = CONTRIB_UI.party[layout];
	const box = contribBoxWidth(layout);
	const n = CONTRIB_PARTY_COLUMNS.size();
	const nameW = math.max(0, box - P.titleWidth - n * P.numberWidth - (n + 1) * P.columnGap);
	const title = { x: nameW + P.columnGap, w: P.titleWidth };
	const numbers: ContribPartyColumn[] = [];
	let x = title.x + title.w + P.columnGap;
	for (let i = 0; i < n; i++) {
		numbers.push({ x, w: P.numberWidth });
		x += P.numberWidth + P.columnGap;
	}
	return { name: { x: 0, w: nameW }, title, numbers };
}
