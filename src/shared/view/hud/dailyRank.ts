/**
 * The Daily's in-run rank layer, pure core (docs/DAILY.md DS10, section 7): the run's frozen rank baseline, the
 * per-frame tracker and the text helpers the client's DailyRankController and the run-over row of friends passed use.
 * Presentation only: it reads the score the score panel shows (the roller's) and never writes sim state.
 *
 *   - `DailyRankBaseline` (NBD10's rule): captured ONCE at run start from the client's last board answers
 *     (`dailyRankBaselineFrom`: today's top rows on the run's board, solo or co-op by party size; the friends view;
 *     best today, the same number new best's daily baseline holds; the board total) and handed to the tracker's
 *     constructor: a board update mid-run never moves it. Unknown parts show nothing: best today unknown -> nothing at
 *     all (no rank can be judged against an unknown entry); top rows unknown -> no rungs or thresholds; friends unknown
 *     -> no friend beats. The player's own row is never among the others (rows of `selfUserId` are dropped).
 *   - `DailyRankTracker`: per rendered frame from the SHOWN score -> the target row (`row`: before best today "none",
 *     new best's text stays; after it the next rung `#41 -> #40 · 310`, `#1`, or beyond the rows read the nearer of the
 *     next friend and the top-rows cut-off) and the one-frame edges: `threshold` (the highest rank threshold crossed,
 *     DAILY_RANK.thresholds; several in one frame shout once, the highest) and `passed` (every friend passed this frame,
 *     each a queued toast). Each edge once per run; an edge due under the stage cover is held to the first frame after
 *     it (the reveal), none fires once the run is over (held ones are dropped), none with an unknown baseline. The
 *     `bestToday` edge is new best's (its tracker over the daily baseline: same fanfare and shout).
 *   - Prediction (DS10: ranks during the run are a prediction from the board at run start): the run's rank at score s
 *     is 1 + the others scoring >= s (a tie keeps the older entry above: the ordered value's inverted time). The
 *     player's board standing only moves once s passes best today, so a threshold fires when the predicted rank enters
 *     it while best today's rank was outside it, and a friend counts only when their score was not already below best
 *     today.
 *   - `dailyRankRowText`, `dailyPassedView`, `parseDailyRankDebug` / `debugRankBaseline` (KV_DailyRankDebug).
 *
 * Board answers are read through LOCAL structural types (`DailyRankBoardInput`), so this compiles without
 * shared/leaderboard; its LeaderboardView passes as is (extra fields are fine).
 *
 * @module
 */
import { DAILY_RANK } from "./dailyRankConfig";
import { DAILY_RANK_STRINGS } from "./dailyRankStrings";
import type { NewBestBoard, NewBestFormat, NewBestStr } from "./newBest";

/** One other entry on today's board (a top row or a friend), as the tracker keeps it. */
export interface DailyRankEntry {
	readonly userId: number;
	readonly name: string;
	readonly score: number;
}

/** A board answer as the baseline reads it (shared/leaderboard LeaderboardView fits). */
export interface DailyRankBoardInput {
	readonly board: string;
	readonly scope: string;
	readonly day?: number;
	readonly friends?: boolean;
	readonly ok: boolean;
	readonly total?: number;
	readonly rows: ReadonlyArray<{ readonly userId: number; readonly name: string; readonly score: number }>;
}

/** The run's frozen rank baseline (see the file header). */
export type DailyRankBaseline =
	| { readonly kind: "unknown" }
	| {
			readonly kind: "known";
			readonly board: NewBestBoard;
			/** Best today on this board (0: no entry yet, or a best new best counts as none). */
			readonly best: number;
			/** Today's top rows minus the player's own, highest first; undefined when unknown. */
			readonly rows: ReadonlyArray<DailyRankEntry> | undefined;
			/** The rows are the whole board (fewer than the top count were read): no rank lies beyond them. */
			readonly complete: boolean;
			/** The top count asked for (the cut-off's `{n}`). */
			readonly topCount: number;
			/** The friends with an entry today minus the player, highest first; undefined when unknown. */
			readonly friends: ReadonlyArray<DailyRankEntry> | undefined;
			/** Entrants on the board, when known. */
			readonly total: number | undefined;
	  };

const UNKNOWN: DailyRankBaseline = { kind: "unknown" };

/** What dailyRankBaselineFrom reads (the client's store at run start). */
export interface DailyRankBaselineInput {
	readonly board: NewBestBoard;
	/** Best today (new best's daily baseline: 0 for none), or undefined when unknown. */
	readonly best: number | undefined;
	/** Today's day index (the status the run's seed belongs to): an answer for another day is ignored. */
	readonly day: number;
	readonly top: DailyRankBoardInput | undefined;
	readonly friends: DailyRankBoardInput | undefined;
	readonly selfUserId: number;
	/** shared/leaderboard LEADERBOARD_TOP_COUNT. */
	readonly topCount: number;
}

function wholeScore(n: unknown): number {
	if (!typeIs(n, "number") || n !== n || n === math.huge || n <= 0) return 0;
	return math.floor(n);
}

/** The view's rows as entries (self dropped, junk scores dropped), highest first; undefined if not usable. */
function entriesOf(
	view: DailyRankBoardInput | undefined,
	board: NewBestBoard,
	day: number,
	friends: boolean,
	selfId: number,
): DailyRankEntry[] | undefined {
	if (view === undefined || view.ok !== true || view.board !== board || view.scope !== "today") return undefined;
	if ((view.friends === true) !== friends) return undefined;
	if (view.day !== undefined && view.day !== day) return undefined;
	const out: DailyRankEntry[] = [];
	for (const r of view.rows) {
		const score = wholeScore(r.score);
		if (r.userId === selfId || score <= 0) continue;
		out.push({ userId: r.userId, name: r.name, score });
	}
	out.sort((a, b) => a.score > b.score);
	return out;
}

/** The run's rank baseline at run start (see the file header). */
export function dailyRankBaselineFrom(input: DailyRankBaselineInput): DailyRankBaseline {
	if (input.best === undefined) return UNKNOWN;
	const rawRows = input.top !== undefined ? input.top.rows.size() : 0;
	const rows = entriesOf(input.top, input.board, input.day, false, input.selfUserId);
	const friends = entriesOf(input.friends, input.board, input.day, true, input.selfUserId);
	const total = rows !== undefined ? input.top?.total : undefined;
	return {
		kind: "known",
		board: input.board,
		best: wholeScore(input.best),
		rows,
		complete: rows !== undefined && rawRows < input.topCount,
		topCount: input.topCount,
		friends,
		total: total !== undefined && total > 0 ? total : undefined,
	};
}

/** The target row's state. */
export type DailyRankRow =
	/** Nothing of the rank layer: new best's row stays (before best today, or nothing known to chase). */
	| "none"
	/** `#{from} -> #{to} · {points}`: the next rank up inside the rows read. */
	| "rung"
	/** `#1 TODAY`: nobody left above. */
	| "top"
	/** `{name} · {points}`: beyond the rows read, the next friend is nearer than the cut-off. */
	| "friend"
	/** `TOP {n} · {points}`: beyond the rows read, the gap to the last row read. */
	| "cutoff";

/** One frame's input. */
export interface DailyRankInput {
	/** The score panel's shown score (ScoreRoller.shown): the row and the edges follow it. */
	readonly shownScore: number;
	/** The stage cover is up (as new best's tracker: StageController.coverLifting): edges wait for the reveal. */
	readonly underCover: boolean;
	/** The run is over: no edge from now on, held ones are dropped. */
	readonly runOver: boolean;
}

/** The tracker's output. One object, reused every frame: read it, never keep it (`passed` is refilled). */
export interface DailyRankFrame {
	row: DailyRankRow;
	/** rung: the predicted rank now and the one above; top: 1 / 1; else 0. */
	fromRank: number;
	toRank: number;
	/** rung / friend / cutoff: points still needed to pass the target (its score + 1 - shown, >= 1); else 0. */
	gap: number;
	/** friend: the friend chased; else undefined. */
	friend: DailyRankEntry | undefined;
	/** The predicted rank (inside the rows read) once past best today, else 0 (unknown, beyond, or not past). */
	rank: number;
	// --- one-frame edges ---
	/** The highest rank threshold crossed this frame (1 beats 3 beats 10 beats 100), or 0. */
	threshold: number;
	/** Friends passed this frame, nearest first (each once per run). */
	passed: DailyRankEntry[];
}

/** The rank-layer state machine (see the file header). One per run: the baseline is frozen at construction. */
export class DailyRankTracker {
	readonly look: DailyRankFrame = {
		row: "none",
		fromRank: 0,
		toRank: 0,
		gap: 0,
		friend: undefined,
		rank: 0,
		threshold: 0,
		passed: [],
	};
	/** Best today's rank among the rows (math.huge: no entry, or beyond the rows read). */
	private readonly bestRank: number;
	/** Friends still ahead of best today (passing them is news), lowest score first. */
	private readonly ahead: DailyRankEntry[] = [];
	/** Index into `ahead` of the next friend not yet passed this run. */
	private nextAhead = 0;
	private readonly firedThresholds = new Set<number>();
	private pendingThreshold = 0;
	private readonly pendingPassed: DailyRankEntry[] = [];

	constructor(readonly baseline: DailyRankBaseline) {
		if (baseline.kind !== "known") {
			this.bestRank = math.huge;
			return;
		}
		this.bestRank = baseline.best > 0 ? this.rankAt(baseline.best) : math.huge;
		const friends = baseline.friends;
		if (friends !== undefined) {
			for (let i = friends.size() - 1; i >= 0; i--) {
				if (friends[i].score >= baseline.best) this.ahead.push(friends[i]);
			}
		}
	}

	/** Friends still ahead of best today at run start, lowest score first (the client prefetches their headshots). */
	friendsAhead(): ReadonlyArray<DailyRankEntry> {
		return this.ahead;
	}

	/** Others scoring >= s among the rows read (0 when the rows are unknown). */
	private above(s: number): number {
		const b = this.baseline;
		if (b.kind !== "known" || b.rows === undefined) return 0;
		let n = 0;
		for (const r of b.rows) {
			if (r.score >= s) n++;
			else break;
		}
		return n;
	}

	/** The predicted rank at s, or math.huge when it lies beyond the rows read (or they are unknown). */
	private rankAt(s: number): number {
		const b = this.baseline;
		if (b.kind !== "known" || b.rows === undefined) return math.huge;
		const n = this.above(s);
		return n < b.rows.size() || b.complete ? n + 1 : math.huge;
	}

	frame(input: DailyRankInput): DailyRankFrame {
		const L = this.look;
		L.threshold = 0;
		L.passed.clear();
		const b = this.baseline;
		if (b.kind !== "known") {
			this.writeNone();
			return L;
		}
		const shown = input.shownScore;
		this.watch(b, shown);
		if (input.runOver) {
			this.pendingThreshold = 0;
			this.pendingPassed.clear();
		} else if (!input.underCover) {
			L.threshold = this.pendingThreshold;
			this.pendingThreshold = 0;
			for (const f of this.pendingPassed) L.passed.push(f);
			this.pendingPassed.clear();
		}
		this.writeRow(b, shown);
		return L;
	}

	/** Queues this frame's threshold and friend crossings (each once per run). */
	private watch(b: Extract<DailyRankBaseline, { kind: "known" }>, shown: number): void {
		if (!(shown > b.best)) return;
		if (b.rows !== undefined) {
			const rank = this.rankAt(shown);
			const others = b.rows.size();
			for (const t of DAILY_RANK.thresholds) {
				if (this.firedThresholds.has(t) || others < t || rank > t || this.bestRank <= t) continue;
				this.firedThresholds.add(t);
				if (this.pendingThreshold === 0 || t < this.pendingThreshold) this.pendingThreshold = t;
			}
		}
		while (this.nextAhead < this.ahead.size() && shown > this.ahead[this.nextAhead].score) {
			this.pendingPassed.push(this.ahead[this.nextAhead]);
			this.nextAhead++;
		}
	}

	private writeNone(): void {
		const L = this.look;
		L.row = "none";
		L.fromRank = 0;
		L.toRank = 0;
		L.gap = 0;
		L.friend = undefined;
		L.rank = 0;
	}

	private writeRow(b: Extract<DailyRankBaseline, { kind: "known" }>, shown: number): void {
		this.writeNone();
		if (!(shown > b.best)) return;
		const L = this.look;
		const friend = this.nextAhead < this.ahead.size() ? this.ahead[this.nextAhead] : undefined;
		const rows = b.rows;
		if (rows !== undefined) {
			const n = this.above(shown);
			if (n < rows.size() || b.complete) {
				L.rank = n + 1;
				if (n === 0) {
					L.row = "top";
					L.fromRank = 1;
					L.toRank = 1;
				} else {
					L.row = "rung";
					L.fromRank = n + 1;
					L.toRank = n;
					L.gap = rows[n - 1].score + 1 - shown;
				}
				return;
			}
			// Beyond the rows read: the nearer of the cut-off (the last row read) and the next friend.
			const cutGap = rows.size() > 0 ? rows[rows.size() - 1].score + 1 - shown : math.huge;
			const friendGap = friend !== undefined ? friend.score + 1 - shown : math.huge;
			if (friend !== undefined && friendGap <= cutGap) {
				L.row = "friend";
				L.friend = friend;
				L.gap = friendGap;
			} else if (cutGap !== math.huge) {
				L.row = "cutoff";
				L.gap = cutGap;
			}
			return;
		}
		if (friend !== undefined) {
			L.row = "friend";
			L.friend = friend;
			L.gap = friend.score + 1 - shown;
		}
	}
}

/**
 * What the cue mapper (shared/view/audio AudioCueMapper.frame's `rank`) reads of a frame: the client's
 * DailyRankController sets them on the frame a threshold shouts (`rankUp`: sfx.rank.up) or a friend's toast shows
 * (`friendPassed`: sfx.friend.passed). NO_DAILY_RANK_CUES: no daily run, or nothing this frame.
 */
export interface DailyRankCueSource {
	readonly rankUp: boolean;
	readonly friendPassed: boolean;
}

/** No rank-layer cues (every other cue as before). */
export const NO_DAILY_RANK_CUES: DailyRankCueSource = { rankUp: false, friendPassed: false };

// ---------------------------------------------------------------------------------------------------------------
// Text

const plainNumber: NewBestFormat = (n) => tostring(n);

/**
 * The score panel's target row while the rank layer owns it (undefined: row "none", new best's text stays). Wide:
 * `hud.dailyRank.rung` / `.top` / `.friend` / `.cutoff`; compact (touch): `.rungShort` / `.topShort` / `.chaseShort`.
 */
export function dailyRankRowText(
	look: Pick<DailyRankFrame, "row" | "fromRank" | "toRank" | "gap" | "friend">,
	compact: boolean,
	topCount: number,
	s: NewBestStr,
	fmt: NewBestFormat = plainNumber,
): string | undefined {
	const K = DAILY_RANK_STRINGS;
	const points = fmt(look.gap);
	if (look.row === "rung") {
		return compact
			? s(K.rungShort, { to: look.toRank, points })
			: s(K.rung, { from: look.fromRank, to: look.toRank, points });
	}
	if (look.row === "top") return s(compact ? K.topShort : K.top);
	if (look.row === "friend") {
		return compact ? s(K.chaseShort, { points }) : s(K.friend, { name: look.friend?.name ?? "", points });
	}
	if (look.row === "cutoff") return compact ? s(K.chaseShort, { points }) : s(K.cutoff, { n: topCount, points });
	return undefined;
}

/** The threshold shout's string key (`hud.dailyRank.shout.<n>`), or undefined for an unknown threshold. */
export function dailyRankShoutKey(threshold: number): string | undefined {
	const K = DAILY_RANK_STRINGS;
	if (threshold === 1) return K.shout1;
	if (threshold === 3) return K.shout3;
	if (threshold === 10) return K.shout10;
	if (threshold === 100) return K.shout100;
	return undefined;
}

/** The friend toast's line: `hud.dailyRank.passed` ("Beat {name}'s high score ({score})"). */
export function dailyPassedToastText(f: DailyRankEntry, s: NewBestStr, fmt: NewBestFormat = plainNumber): string {
	return s(DAILY_RANK_STRINGS.passed, { name: f.name, score: fmt(f.score) });
}

/** The run-over row of friends passed (dailyPassedView). */
export interface DailyPassedView {
	/** The friends whose headshots show, in pass order (at most DAILY_RANK.passedShown). */
	readonly shown: ReadonlyArray<DailyRankEntry>;
	/** How many more were passed (`+{n} more`; 0: no such text). */
	readonly more: number;
}

/** The friends passed this run as the run-over row shows them: the first DAILY_RANK.passedShown, then `+n more`. */
export function dailyPassedView(passed: ReadonlyArray<DailyRankEntry>): DailyPassedView {
	const shown: DailyRankEntry[] = [];
	for (let i = 0; i < passed.size() && i < DAILY_RANK.passedShown; i++) shown.push(passed[i]);
	return { shown, more: math.max(0, passed.size() - shown.size()) };
}

/** The `+{n} more` text (run.dailyRank.more), or "" for none. */
export function dailyPassedMoreText(more: number, s: NewBestStr): string {
	return more > 0 ? s(DAILY_RANK_STRINGS.passedMore, { n: more }) : "";
}

// ---------------------------------------------------------------------------------------------------------------
// Debug (KV_DailyRankDebug)

/** KV_DailyRankDebug's forced baseline (parseDailyRankDebug). */
export interface DailyRankDebug {
	readonly rows: number;
	readonly step: number;
	/** Every n-th row is a friend (0: none). */
	readonly friendsEvery: number;
	readonly best: number;
}

/** A whole number >= 0 from text, else undefined. */
function wholeOf(text: string | undefined): number | undefined {
	if (text === undefined) return undefined;
	const v = tonumber(text);
	if (v === undefined || v < 0 || v !== math.floor(v) || v === math.huge) return undefined;
	return v;
}

/**
 * Parses KV_DailyRankDebug: "rows:<count>:<step>" (required: count >= 1, step >= 1), optional "friends:<every>" and
 * "best:<score>", comma separated, spaces ignored. Anything else (absent, empty, malformed) is undefined: no override.
 */
export function parseDailyRankDebug(attr: unknown): DailyRankDebug | undefined {
	if (!typeIs(attr, "string")) return undefined;
	const [trimmed] = attr.lower().gsub("%s", "");
	if (trimmed === "") return undefined;
	let rows: number | undefined;
	let step: number | undefined;
	let friendsEvery = 0;
	let best = 0;
	for (const part of trimmed.split(",")) {
		const bits = part.split(":");
		if (bits[0] === "rows" && bits.size() === 3) {
			rows = wholeOf(bits[1]);
			step = wholeOf(bits[2]);
			if (rows === undefined || step === undefined || rows < 1 || step < 1) return undefined;
		} else if (bits[0] === "friends" && bits.size() === 2) {
			const v = wholeOf(bits[1]);
			if (v === undefined) return undefined;
			friendsEvery = v;
		} else if (bits[0] === "best" && bits.size() === 2) {
			const v = wholeOf(bits[1]);
			if (v === undefined) return undefined;
			best = v;
		} else return undefined;
	}
	if (rows === undefined || step === undefined) return undefined;
	return { rows, step, friendsEvery, best };
}

/**
 * The rank baseline a debug override forces: `rows` rows scored step x rows down to step (user ids 1..rows, names
 * "Rival <i>"), every `friendsEvery`-th row also a friend, best today `best`; complete when under `topCount` rows.
 */
export function debugRankBaseline(d: DailyRankDebug, board: NewBestBoard, topCount: number): DailyRankBaseline {
	const rows: DailyRankEntry[] = [];
	const friends: DailyRankEntry[] = [];
	const count = math.min(d.rows, topCount);
	for (let i = 1; i <= count; i++) {
		const e = { userId: i, name: `Rival ${i}`, score: (count - i + 1) * d.step };
		rows.push(e);
		if (d.friendsEvery > 0 && i % d.friendsEvery === 0) friends.push(e);
	}
	return {
		kind: "known",
		board,
		best: d.best,
		rows,
		complete: count < topCount,
		topCount,
		friends,
		total: count,
	};
}
