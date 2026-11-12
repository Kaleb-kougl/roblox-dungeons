/**
 * The Codex on the run-over panel and the siblings' hooks (claude/codex-plan.md "Run over", CX9, decision R12). Pure:
 * the client's CodexRunRow (client/ui/hud) draws codexRecapRow from the store's frozen run summary
 * (selectCodexRunSummary: CodexController freezes CodexTracker.codexRunSummary at run over / leave / exit).
 *
 *   codexRecapRow        `3 new in the Codex` (`run.codex.newOne` for one), up to CODEX.recapIcons tile icons in the
 *                        summary's order (found order, rarest first on one frame), `+N` for the rest, `Codex 41%`.
 *                        None when nothing new was found, the Codex is not loaded, or the run could not claim
 *                        (its summary has no new ids)
 *   codexRecapRowHeight  the row's height per run-over layout (wide and compact: one line; narrow: the count and the
 *                        total on one line, the icons under it), for the panel's fit (fit.spec.ts)
 *   codexSummaryHas      entry `id` is in a run's new ids (claude/build-online-plan.md's first-fire callout line
 *                        `NEW TO YOUR CODEX` reads it from the frozen summary, or CodexController.codexNewThisRun live;
 *                        the callout is not built yet: CX9 exports the hooks only)
 */
import { CODEX } from "shared/codex";
import { HUD_VIEW, type RecapLayout } from "shared/view/hud";
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

/** The run-over row for a run's summary, or undefined (nothing new, not loaded, no summary). */
export function codexRecapRow(summary: CodexRunSummary | undefined, s: CodexStr): CodexRecapRowModel | undefined {
	if (summary === undefined || !summary.loaded) return undefined;
	const n = summary.newIds.size();
	if (n === 0) return undefined;
	const T = CODEX_RECAP_STRINGS;
	const icons: string[] = [];
	const shown = math.min(n, CODEX.recapIcons);
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
 * The row on one line (the wide panel, and a landscape phone's left column: its height is the tight one) or two
 * (upright: the text line, then the icons).
 */
export function codexRecapRowLines(layout: RecapLayout): number {
	return layout === "narrow" ? 2 : 1;
}

/** The row's height (reference px) in `layout`, `gap` between its lines. */
export function codexRecapRowHeight(layout: RecapLayout, gap: number): number {
	const line = math.max(CODEX_RECAP.iconBox, CODEX_RECAP.lineHeight);
	const lines = codexRecapRowLines(layout);
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
