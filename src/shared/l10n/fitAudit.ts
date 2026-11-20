/**
 * The fit audit's rules (docs/LOCALIZATION.md L9, debug attribute `KV_LocaleAudit`): which text objects count as
 * overflowing, and each one reported once. Pure; the client's LocaleAuditController walks PlayerGui and feeds it facts.
 *
 * @module
 */

/** The audit's switch and pace. */
export const LOCALE_AUDIT = {
	/** Workspace attribute (Studio command bar): true starts the audit. Off by default. */
	attribute: "KV_LocaleAudit",
	/** Seconds between two walks of PlayerGui. */
	intervalSec: 0.5,
	/** Log prefix. */
	tag: "[LocaleAudit]",
} as const;

/** What the audit reads off one TextLabel / TextButton / TextBox. */
export interface TextFitFacts {
	/** The object and every ancestor up to its enabled root GUI are visible. */
	readonly visible: boolean;
	/** TextFits. */
	readonly fits: boolean;
	/** TextScaled: the engine shrinks the text to fit (never a misfit). */
	readonly scaled: boolean;
	/** TextTruncate is not None: cut on purpose (never a misfit). */
	readonly truncated: boolean;
	readonly text: string;
}

/** A visible, non-blank text that does not fit and neither shrinks nor truncates on purpose. */
export function isTextMisfit(f: Readonly<TextFitFacts>): boolean {
	if (!f.visible || f.fits || f.scaled || f.truncated) return false;
	const [trimmed] = f.text.gsub("%s", "");
	return trimmed.size() > 0;
}

/** The log line for a misfit. */
export function fitAuditLine(path: string, locale: string, text: string): string {
	return `${LOCALE_AUDIT.tag} misfit [${locale}] ${path}: "${text}"`;
}

/** Remembers what was reported, so each (instance path, text) pair logs once per locale. */
export class FitAuditLog {
	private readonly seen = new Set<string>();

	/** True the first time `path` shows `text` in `locale` (log it); false after. */
	report(locale: string, path: string, text: string): boolean {
		const key = `${locale}\n${path}\n${text}`;
		if (this.seen.has(key)) return false;
		this.seen.add(key);
		return true;
	}

	clear(): void {
		this.seen.clear();
	}
}

/** What a locale table could not supply (structurally shared/theme LocaleReport). */
export interface LocaleFallbacks {
	readonly stale: ReadonlyArray<string>;
	readonly mismatched: ReadonlyArray<string>;
	readonly unknown: ReadonlyArray<string>;
}

/** The audit's log lines for a locale switch: a summary, then one line per non-empty list (keys comma-joined). */
export function localeReportLines(code: string, report: Readonly<LocaleFallbacks>): string[] {
	const lines = [
		`${
			LOCALE_AUDIT.tag
		} locale ${code}: ${report.stale.size()} stale, ${report.mismatched.size()} mismatched, ${report.unknown.size()} unknown`,
	];
	const lists: Array<[string, ReadonlyArray<string>]> = [
		["stale", report.stale],
		["mismatched", report.mismatched],
		["unknown", report.unknown],
	];
	for (const [label, keys] of lists)
		if (keys.size() > 0) lines.push(`${LOCALE_AUDIT.tag}   ${label}: ${keys.join(", ")}`);
	return lines;
}
