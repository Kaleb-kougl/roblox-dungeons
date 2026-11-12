/**
 * What the menu shows of the Codex (claude/codex-plan.md "Main menu and the Codex screen", CX6 / CX7): the NEW-dot count
 * for the Codex button's badge, and found / total per tab and overall. Pure; the client's store selectors wrap them.
 */
import { CODEX_TABS, catalogTotal, type CodexTab } from "./catalog";
import { codexFoundCount, type CodexDoc } from "./doc";

/** Found / total of one tab, or of the whole catalog. */
export interface CodexCount {
	readonly found: number;
	readonly total: number;
}

export interface CodexProgress {
	/** The whole catalog (the completion %). */
	readonly all: CodexCount;
	/** Per tab, in CODEX_TABS order. */
	readonly tabs: ReadonlyArray<CodexCount & { readonly tab: CodexTab }>;
}

/** Entries with a NEW dot in `doc` (0 without a doc): the menu badge. */
export function codexUnreadCount(doc: Readonly<CodexDoc> | undefined): number {
	return doc?.unread?.size() ?? 0;
}

/** `doc`'s found / total overall and per tab (found 0 everywhere without a doc). */
export function codexProgressOf(doc: Readonly<CodexDoc> | undefined): CodexProgress {
	const tabs: (CodexCount & { readonly tab: CodexTab })[] = [];
	for (const tab of CODEX_TABS) tabs.push({ tab, found: codexFoundCount(doc, tab), total: catalogTotal(tab) });
	return { all: { found: codexFoundCount(doc), total: catalogTotal() }, tabs };
}
