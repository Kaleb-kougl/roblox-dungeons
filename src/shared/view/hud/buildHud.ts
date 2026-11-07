/**
 * The build in the HUD (docs/BUILDS.md BU10; presentation only): the owned-items row's cells (level pips inside each
 * boon cell, the evolved boon's gold frame, duos as joined chips) and its one-row cap, and the pause / run-over Build
 * list. Pure data and helpers over the snapshot's boons / levels / duos, checked headlessly (buildHud.spec.ts); the
 * client's RunItems and BuildList draw them. The draft cards are draftCards.ts (BU9).
 */
import { BOONS, CURSES, DUOS, RELICS, boonMaxLevel } from "shared/sim";
import type { ColorRole } from "shared/theme";
import {
	BUILD_DUO_ROLE,
	BUILD_EVOLVED_ROLE,
	DUO_CHIP_SPAN,
	boonLevelNameKey,
	boonLineKey,
	levelText,
	textOf,
	type HudText,
} from "./draftCards";
import { HUD_VIEW } from "./layout";
import type { ItemRef } from "./tooltip";
import {
	CURSE_COLOR_ROLE,
	RELIC_COLOR_ROLE,
	boonLevelDescKey,
	itemIconKey,
	itemNameKey,
	rarityColorRole,
} from "./progression";

/** Layout (reference px) of the builds pieces of the items row and the Build list. */
export const BUILD_HUD_VIEW = {
	/**
	 * Items row (status panel and touch chips): the pips drawn INSIDE the bottom of each boon cell (the status panel's
	 * 160 px footprint is full, docs/HUD_LAYOUT.md H2, so they never add a row), as a share of the cell: pip size,
	 * gap, inset from the cell's bottom edge, and the label's height above them.
	 */
	itemPipShare: 0.16,
	itemPipGapShare: 0.08,
	itemPipBottomShare: 0.08,
	itemLabelShare: 0.72,
	/** The evolved boon's frame and every other cell's outline, reference px. */
	evolvedStroke: 2,
	cellStroke: 1,
	/** The Build list (pause overlay side panel, run-over column): its width, name column, rows before "+N". */
	listWidth: 300,
	listNameWidth: 150,
	listLevelWidth: 34,
	listMaxRows: 12,
	/** The compact (phone) run-over's Build column, and the narrowest pause panel. */
	listCompactWidth: 260,
	listCompactRows: 8,
} as const;

// --- Items row (BU10) ---------------------------------------------------------------------------------------------

/** One cell of the owned-items row (RunItems). */
export interface ItemCellModel {
	/** Stable React key. */
	readonly key: string;
	/** Icon labels (`<id>.icon`): one, or a duo chip's two boons (drawn joined, side by side). */
	readonly icons: ReadonlyArray<string>;
	/** Each icon's fill (a duo chip: the duo role behind both halves). */
	readonly fills: ReadonlyArray<ColorRole>;
	/** The cell's outline: the evolved frame (boon.evolved, thicker), else undefined (the plain dark outline). */
	readonly frame?: ColorRole;
	/** Level pips inside the bottom of the cell: `level` of `maxLevel` filled; 0 / 0 none. */
	readonly level: number;
	readonly maxLevel: number;
	/** Cells wide (a duo chip: 2). */
	readonly span: number;
	/** A curse: its skull art behind the label (docs/UI_ART.md UA8). */
	readonly curse: boolean;
	/** The owned item it shows (item tooltips). */
	readonly ref: ItemRef;
}

/**
 * The items row in the order the HUD shows it: the boons (order taken; with builds their level pips and the evolved
 * frame), then the duos (order taken; a joined chip of their two boons' icons in boon.duo), then relics and curses.
 * `levels[i]` is `boons[i]`'s level (snapshot boonLevels: empty without builds: no pips, today's row).
 */
export function runItemCells(
	boons: ReadonlyArray<number>,
	levels: ReadonlyArray<number>,
	duos: ReadonlyArray<number>,
	relics: ReadonlyArray<number>,
	curses: ReadonlyArray<number>,
): ItemCellModel[] {
	const out: ItemCellModel[] = [];
	for (let i = 0; i < boons.size(); i++) {
		const b = boons[i];
		const def = BOONS[b];
		if (def === undefined) continue;
		const level = levels[i] ?? 0;
		const max = level > 0 ? boonMaxLevel(b) : 0;
		const pips = max > 1;
		out.push({
			key: `b${b}`,
			icons: [itemIconKey(def.id)],
			fills: [rarityColorRole(def.rarity)],
			frame: pips && level >= max ? BUILD_EVOLVED_ROLE : undefined,
			level: pips ? level : 0,
			maxLevel: pips ? max : 0,
			span: 1,
			curse: false,
			ref: { kind: "boon", index: b },
		});
	}
	for (const d of duos) {
		const duo = DUOS[d];
		if (duo === undefined) continue;
		out.push({
			key: `d${d}`,
			icons: [itemIconKey(BOONS[duo.a].id), itemIconKey(BOONS[duo.b].id)],
			fills: [BUILD_DUO_ROLE, BUILD_DUO_ROLE],
			level: 0,
			maxLevel: 0,
			span: DUO_CHIP_SPAN,
			curse: false,
			ref: { kind: "duo", index: d },
		});
	}
	for (const x of relics) {
		const def = RELICS[x];
		if (def === undefined) continue;
		out.push(plainCell(`r${x}`, def.id, RELIC_COLOR_ROLE, false, { kind: "relic", index: x }));
	}
	for (const c of curses) {
		const def = CURSES[c];
		if (def === undefined) continue;
		out.push(plainCell(`c${c}`, def.id, CURSE_COLOR_ROLE, true, { kind: "curse", index: c }));
	}
	return out;
}

function plainCell(key: string, id: string, fill: ColorRole, curse: boolean, ref: ItemRef): ItemCellModel {
	return { key, icons: [itemIconKey(id)], fills: [fill], level: 0, maxLevel: 0, span: 1, curse, ref };
}

/** A cell's width: `span` cells and the gaps inside it. */
export function itemCellWidth(span: number, cell: number, gap: number): number {
	return span * cell + (span - 1) * gap;
}

/** What fits in one row: the cells from `first` on (the newest), and a "+N" cell first counting `more`. */
export interface ItemRowCap {
	readonly first: number;
	readonly more: number;
	/** The row's width with the "+N" cell (reference px). */
	readonly width: number;
}

/**
 * The items row capped to ONE row of `maxWidth` (docs/HUD_LAYOUT.md: capOneRow with cells of different spans): every
 * cell when they fit; else the newest that fit after a one-cell "+N" counting the rest (at least the "+N" cell).
 */
export function capItemCells(spans: ReadonlyArray<number>, cell: number, gap: number, maxWidth: number): ItemRowCap {
	const n = spans.size();
	let total = 0;
	for (let i = 0; i < n; i++) total += itemCellWidth(spans[i], cell, gap) + (i > 0 ? gap : 0);
	if (n === 0) return { first: 0, more: 0, width: 0 };
	if (total <= maxWidth) return { first: 0, more: 0, width: total };
	let width = cell;
	let first = n;
	while (first > 0) {
		const w = itemCellWidth(spans[first - 1], cell, gap) + gap;
		if (width + w > maxWidth) break;
		width += w;
		first--;
	}
	return { first, more: first, width };
}

/** Where a cell's pips sit (reference px inside the cell): pip size, gap, bottom inset, the label's height. */
export interface ItemPipLayout {
	readonly pip: number;
	readonly gap: number;
	readonly bottom: number;
	readonly labelHeight: number;
}

/** The pips' layout in a `cell` px cell (BUILD_HUD_VIEW shares, whole px, at least 2 px pips). */
export function itemPipLayout(cell: number): ItemPipLayout {
	const V = BUILD_HUD_VIEW;
	const minPip = 2;
	return {
		pip: math.max(minPip, math.round(cell * V.itemPipShare)),
		gap: math.max(1, math.round(cell * V.itemPipGapShare)),
		bottom: math.max(1, math.round(cell * V.itemPipBottomShare)),
		labelHeight: math.round(cell * V.itemLabelShare),
	};
}

// --- Build list (BU10) --------------------------------------------------------------------------------------------

/** One row of the Build list: name, level, the line it has now. */
export interface BuildListRow {
	readonly key: string;
	readonly name: HudText;
	/** "II" ("" for a boon without levels and for a duo). */
	readonly level: string;
	readonly desc: HudText;
	/** The name's colour: the rarity's, boon.evolved for an evolved boon, boon.duo for a duo. */
	readonly color: ColorRole;
	/** The owned item it shows (item tooltips). */
	readonly ref: ItemRef;
}

/**
 * The Build list (pause overlay, run-over panel): each boon in the order taken (the evolution's name and line at its
 * top level, else the boon's name and its line at its level), then each duo. `levels` as in runItemCells (empty
 * without builds: every boon's level-I line, no level). Empty for no boons.
 */
export function buildListRows(
	boons: ReadonlyArray<number>,
	levels: ReadonlyArray<number>,
	duos: ReadonlyArray<number>,
): BuildListRow[] {
	const out: BuildListRow[] = [];
	for (let i = 0; i < boons.size(); i++) {
		const b = boons[i];
		const def = BOONS[b];
		if (def === undefined) continue;
		const level = levels[i] ?? 0;
		const shown = math.max(1, level);
		const max = boonMaxLevel(b);
		const evolved = level > 0 && max > 1 && level >= max;
		out.push({
			key: `b${b}`,
			name: textOf(level > 0 ? boonLevelNameKey(b, level) : itemNameKey(def.id)),
			level: levelText(b, level),
			desc: textOf(level > 0 ? boonLineKey(b, shown) : boonLevelDescKey(def.id, 1)),
			color: evolved ? BUILD_EVOLVED_ROLE : rarityColorRole(def.rarity),
			ref: { kind: "boon", index: b },
		});
	}
	for (const d of duos) {
		const duo = DUOS[d];
		if (duo === undefined) continue;
		out.push({
			key: `d${d}`,
			name: textOf(itemNameKey(duo.id)),
			level: "",
			desc: textOf(`${duo.id}.desc`),
			color: BUILD_DUO_ROLE,
			ref: { kind: "duo", index: d },
		});
	}
	return out;
}

/** The Build list capped at `maxRows`: the first `shown` rows, then a "+N" line counting `more` (0: none). */
export function capBuildList(rows: number, maxRows: number): { readonly shown: number; readonly more: number } {
	if (rows <= maxRows) return { shown: rows, more: 0 };
	const shown = math.max(0, maxRows - 1);
	return { shown, more: rows - shown };
}

/**
 * The pause overlay's Build panel width (reference px): BUILD_HUD_VIEW.listWidth, narrowed to the room right of the
 * centred pause menu on a narrow screen (`viewW` px at `uiScale`; `framePad` the panel's own left + right padding),
 * never below listCompactWidth.
 */
export function pauseBuildWidth(viewW: number, uiScale: number, framePad: number): number {
	const V = BUILD_HUD_VIEW;
	const scale = uiScale > 0 ? uiScale : 1;
	const room = (viewW / scale - HUD_VIEW.panelWidth) / 2 - HUD_VIEW.gap - HUD_VIEW.margin - framePad;
	return math.clamp(math.floor(room), V.listCompactWidth, V.listWidth);
}
