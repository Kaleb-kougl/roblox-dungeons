/**
 * The Codex on the run-over panel and the siblings' hooks (claude/codex-plan.md "Run over", CX9, decision R12). Pure:
 * the client's CodexRunRow (client/ui/hud) draws codexRecapRow from the store's frozen run summary
 * (selectCodexRunSummary: CodexController freezes CodexTracker.codexRunSummary at run over / leave / exit).
 *
 *   codexRecapRow        `3 new in the Codex` (`run.codex.newOne` for one), up to CODEX.recapIcons tile icons in the
 *                        summary's order (found order, rarest first on one frame), `+N` for the rest, `Codex 41%`.
 *                        None when nothing new was found, the Codex is not loaded, or the run could not claim
 *                        (its summary has no new ids)
 *   codexRecapRowFit     the row as drawn in a column: one line when its estimated width (codexRecapRowWidth) fits,
 *                        else one line with fewer icons, else (and always upright) two lines: the count and the
 *                        total, the icons under them
 *   codexRecapRowHeight  the row's height for that fit, for the panel's fit (fit.spec.ts)
 *   codexSummaryHas      entry `id` is in a run's new ids (claude/build-online-plan.md's first-fire callout line
 *                        `NEW TO YOUR CODEX` reads it from the frozen summary, or CodexController.codexNewThisRun live;
 *                        the callout is not built yet: CX9 exports the hooks only)
 */
import { CODEX } from "shared/codex";
import { HUD_VIEW, ROOM_CLEAR_VIEW, type RecapLayout } from "shared/view/hud";
import { codexCompletionPct, type CodexStr } from "./screen";
import type { CodexRunSummary } from "./tracker";

/** The run-over row's strings (shared/theme CODEX_STRING_KEYS). */
export const CODEX_RECAP_STRINGS = {
	/** `{n} new in the Codex` (n >= 2) and its singular. */
	count: "run.codex.new",
	countOne: "run.codex.newOne",
	/** `+{n}` after the icons. */
	more: "run.codex.more",
	/** `Codex {pct}%`. */
	total: "run.codex.total",
} as const;

/** The row's look (reference px). */
export const CODEX_RECAP = {
	/** A found entry's tile icon. */
	iconBox: 20,
	iconGap: 4,
	/** One line of the row's small text (HUD_VIEW.smallText + the Text primitive's 4 px slack). */
	lineHeight: HUD_VIEW.smallText + 4,
	/** A one-line row too long for its column shows fewer icons, down to this many, before it takes two lines. */
	minIcons: 1,
} as const;

/** What the row shows. */
export interface CodexRecapRowModel {
	readonly countText: string;
	/** Up to CODEX.recapIcons entry ids, in the summary's order. */
	readonly icons: ReadonlyArray<string>;
	/** `+N` for the new entries past the icons; undefined when every one has its icon. */
	readonly moreText?: string;
	readonly totalText: string;
}

/**
 * The run-over row for a run's summary, or undefined (nothing new, not loaded, no summary). At most `maxIcons` icons
 * (CODEX.recapIcons by default; codexRecapRowFit shows fewer to keep a line), `+N` for the rest.
 */
export function codexRecapRow(
	summary: CodexRunSummary | undefined,
	s: CodexStr,
	maxIcons: number = CODEX.recapIcons,
): CodexRecapRowModel | undefined {
	if (summary === undefined || !summary.loaded) return undefined;
	const n = summary.newIds.size();
	if (n === 0) return undefined;
	const T = CODEX_RECAP_STRINGS;
	const icons: string[] = [];
	const shown = math.min(n, maxIcons);
	for (let i = 0; i < shown; i++) icons.push(summary.newIds[i]);
	const more = n - shown;
	return {
		countText: n === 1 ? s(T.countOne) : s(T.count, { n }),
		icons,
		moreText: more > 0 ? s(T.more, { n: more }) : undefined,
		totalText: s(T.total, { pct: codexCompletionPct(summary.foundTotal, summary.catalogTotal) }),
	};
}

/**
 * The row's width (reference px) on one line, estimated: its texts at HUD_VIEW.smallText by the HUD font's average
 * advance per byte (ROOM_CLEAR_VIEW.tallyFit.glyphAspect, the estimate the room-clear tally row fits with; bytes, so
 * non-Latin text is over-estimated), the icon strip, and the Row primitive's HUD_VIEW.gap between its parts.
 */
export function codexRecapRowWidth(row: CodexRecapRowModel): number {
	const em = HUD_VIEW.smallText * ROOM_CLEAR_VIEW.tallyFit.glyphAspect;
	let bytes = row.countText.size() + row.totalText.size();
	let parts = 3; // the count, the icons, the total
	if (row.moreText !== undefined) {
		bytes += row.moreText.size();
		parts++;
	}
	return bytes * em + codexRecapIconsWidth(row.icons.size()) + (parts - 1) * HUD_VIEW.gap;
}

/**
 * The row on one line (the wide panel, and a landscape phone's left column) when `row` fits `width` (reference px:
 * the column it is drawn in; codexRecapRowWidth), else two (the text line, then the icons); always two upright. Without
 * a row or a width: one (wide, compact) or two (narrow).
 */
export function codexRecapRowLines(layout: RecapLayout, row?: CodexRecapRowModel, width?: number): number {
	if (layout === "narrow") return 2;
	if (row === undefined || width === undefined) return 1;
	return codexRecapRowWidth(row) <= width ? 1 : 2;
}

/** The row as drawn: its model and its lines (codexRecapRowFit). */
export interface CodexRecapRowFit {
	readonly row: CodexRecapRowModel;
	readonly lines: number;
}

/**
 * The row for `summary` as drawn in `layout` within `width` (reference px, the column's): on one line (wide, compact)
 * with every icon when it fits (codexRecapRowWidth); else on one line with fewer icons (down to CODEX_RECAP.minIcons,
 * the rest in `+N`: a landscape phone's left column has no height for a second line); else, and always upright, on
 * two lines with every icon. Undefined when there is no row (codexRecapRow).
 */
export function codexRecapRowFit(
	summary: CodexRunSummary | undefined,
	s: CodexStr,
	layout: RecapLayout,
	width: number,
): CodexRecapRowFit | undefined {
	const full = codexRecapRow(summary, s);
	if (full === undefined) return undefined;
	if (layout === "narrow") return { row: full, lines: 2 };
	if (codexRecapRowLines(layout, full, width) === 1) return { row: full, lines: 1 };
	for (let icons = full.icons.size() - 1; icons >= CODEX_RECAP.minIcons; icons--) {
		const fewer = codexRecapRow(summary, s, icons) as CodexRecapRowModel;
		if (codexRecapRowLines(layout, fewer, width) === 1) return { row: fewer, lines: 1 };
	}
	return { row: full, lines: 2 };
}

/**
 * The row's height (reference px) in `layout`, `gap` between its lines: `fit`'s lines (codexRecapRowFit), or without
 * one the layout's default (codexRecapRowLines).
 */
export function codexRecapRowHeight(layout: RecapLayout, gap: number, fit?: CodexRecapRowFit): number {
	const line = math.max(CODEX_RECAP.iconBox, CODEX_RECAP.lineHeight);
	const lines = fit?.lines ?? codexRecapRowLines(layout);
	return lines * line + (lines - 1) * gap;
}

/** The icon strip's width (reference px) for `icons` icons. */
export function codexRecapIconsWidth(icons: number): number {
	return icons * CODEX_RECAP.iconBox + math.max(0, icons - 1) * CODEX_RECAP.iconGap;
}

/** Entry `id` was found for the first time ever on the run of `summary` (the BO callout's hook). */
export function codexSummaryHas(summary: CodexRunSummary | undefined, id: string): boolean {
	return summary !== undefined && summary.newIds.includes(id);
}
