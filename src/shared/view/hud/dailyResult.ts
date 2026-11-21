/**
 * The run-over panel's daily block (docs/DAILY.md DS11), for a daily run only. Pure (daily.spec.ts): the client's
 * RunOverPanel hands in the run's world, its verdict as far as it got and the server's daily result
 * (RunFinishVerdict.daily), and draws the lines this returns; the countdown is the client's per-second binding.
 *
 * States:
 *   waiting       the verdict is not in (the server waits up to DAILY_VERDICT.waitSeconds for the post): the title only
 *                 (and the countdown and Retry Daily), no standing, no save chip
 *   saved         accepted and posted: the standing (`#38 today`; `Top 14%` beyond the top rows; `#3 of 12 today` under
 *                 20 entrants), `of 1,240 players` (not with `#n of m`, which says it), the best-today line
 *                 (`Best today 23,410 -> 26,870` when this run raised it, `Best today 26,870` on the first entry of the
 *                 day, the standing entry's score `Best today 23,410` when it did not), `Saved`
 *   not saved     rejected, skipped (never submitted), accepted without a daily result (an ineligible run: Studio, a
 *                 private server, debug) or accepted with `posted: false` (the write did not land in time): `Not saved`;
 *                 a not-posted result still shows any standing it carries
 *
 * One owner per piece on a daily run (new best's block, the client's BestBlock, sits above this one): new best keeps
 * the celebration (ribbon, record rows rolling, the dim `Best today ...` target line of a run with no record); this
 * block owns the standing, the entrants, the countdown and the ONE save chip (new best draws none on a daily run:
 * runOverBestLines), and draws its best-today line only when new best's block draws no best line for this run
 * (`bestLineShown`: bestBlockDrawsBestLine). In practice: an improved run shows new best's `23,410 -> 26,870` row and
 * no daily best line; a first run of the day shows the FIRST RUN TODAY ribbon (no rows) and `Best today 26,870` here; a
 * run that did not improve shows new best's `Best today 23,410` target line only.
 *
 * @module
 */
import type { DailyRunResult } from "shared/daily";
import { dailyLabel } from "shared/daily";
import { DAILY_STRINGS } from "./dailyStrings";
import { formatThousands } from "shared/l10n";
import { RESULT_STANDING_KEYS, standingOf, type DailyLine } from "./dailyText";

/** The run's verdict as the block reads it (client VerdictView.status for this run; "pending" until it arrives). */
export type DailyResultStatus = "pending" | "accepted" | "rejected" | "skipped";

/**
 * What `dailyResultBlock` reads: the run's world, its verdict as far as it got and the server's daily result. The
 * client's RunOverPanel builds it each time the verdict changes.
 */
export interface DailyResultInput {
	/** The run's world is the Daily (shared/daily DAILY_WORLD_KIND). */
	readonly daily: boolean;
	readonly status: DailyResultStatus;
	/** The verdict's daily result (accepted daily runs; absent otherwise). */
	readonly result?: DailyRunResult;
	/** The run's final score (the server's when its verdict carried one). */
	readonly score: number;
	/** The Daily the run counts on, when known without a result (the client's status label for the run's day). */
	readonly label?: number;
	/**
	 * New best's block already draws a best line for this run (its record rows or its `Best today ...` target line:
	 * bestBlockDrawsBestLine): the best-today line is left to it.
	 */
	readonly bestLineShown?: boolean;
}

/**
 * The daily block's lines as the run-over panel draws them (the states are in the file header). A line that is
 * undefined is not drawn; while the verdict is pending only `title` is set.
 */
export interface DailyResultBlock {
	/** `Daily #304`, when the day is known. */
	readonly title?: DailyLine;
	/** `#38 today` / `Top 14%` / `#3 of 12 today`. */
	readonly standing?: DailyLine;
	/** `of 1,240 players`. */
	readonly entrants?: DailyLine;
	/** `Best today 23,410 -> 26,870` (improved: drawn in the accent), `Best today 26,870`. */
	readonly best?: DailyLine;
	readonly improved: boolean;
	/** The save chip: saved / not saved; undefined while waiting. */
	readonly saved?: "saved" | "unsaved";
}

/** The daily block for a run, or undefined for a run that is not a daily one (the panel is unchanged then). */
export function dailyResultBlock(input: DailyResultInput): DailyResultBlock | undefined {
	if (!input.daily) return undefined;
	const r = input.status === "accepted" ? input.result : undefined;
	const label = r !== undefined ? dailyLabel(r.day) : input.label;
	const title: DailyLine | undefined =
		label !== undefined ? { key: DAILY_STRINGS.resultTitle, vars: { label } } : undefined;
	if (input.status === "pending") return { title, improved: false };
	if (r === undefined) return { title, improved: false, saved: "unsaved" };
	const standing = standingOf(r, RESULT_STANDING_KEYS);
	const entrants: DailyLine | undefined =
		standing !== undefined && standing.kind !== "rankOf" && r.total !== undefined
			? { key: DAILY_STRINGS.resultEntrants, vars: { total: formatThousands(r.total) } }
			: undefined;
	let best: DailyLine | undefined;
	let improved = false;
	if (r.posted && input.bestLineShown !== true) {
		const now = formatThousands(input.score);
		if (r.improved && r.previous !== undefined) {
			improved = true;
			best = { key: DAILY_STRINGS.resultImproved, vars: { old: formatThousands(r.previous.score), new: now } };
		} else if (r.improved) {
			best = { key: DAILY_STRINGS.resultFirstBest, vars: { new: now } };
		} else if (r.previous !== undefined) {
			best = { key: DAILY_STRINGS.resultBest, vars: { score: formatThousands(r.previous.score) } };
		}
	}
	return {
		title,
		standing: standing !== undefined ? { key: standing.key, vars: standing.vars } : undefined,
		entrants,
		best,
		improved,
		saved: r.posted ? "saved" : "unsaved",
	};
}
