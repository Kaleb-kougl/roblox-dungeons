/**
 * The new-best celebration's pure core (docs/NEW_BEST.md NB3): the run's frozen baseline, the per-frame tracker and the
 * text / timeline helpers the client's NewBestController, StageController, score panel, run-over panel, pause overlay
 * and main menu use. Presentation only (NBD1): it reads numbers the client already shows (the score roller's shown
 * score, the true score, the endless floor) and never writes sim state.
 *
 *   - `RunBaseline` (NBD9, NBD10): captured ONCE at run start from the client's copy of the personal records
 *     (`baselineFrom` over `withPendingRuns`: earlier runs whose verdict is still pending folded in; or `debugBaseline`
 *     for KV_NewBestDebug) and handed to the tracker's constructor: a records update mid-run never moves it. Four
 *     kinds:
 *       "unranked"  not the ranked world (tutorial, M1 even under KV_Scoring, an unscored run): nothing anywhere;
 *       "unknown"   the records did not load: nothing in-run (never a false celebration); the run over can still
 *                   celebrate from the verdict's server records (`runOverRecords` with `server`);
 *       "none"      no target (NBD5): no record on this board yet (score 0, floor 0) or a best under NEW_BEST.minScore
 *                   (its numbers kept, so the run over knows a record from a lower run): quiet in-run, `FIRST RECORD`
 *                   (or NEW BEST over the low best) at run over;
 *       "known"     the target: the board's best score (> 0; 0 = no score target, a debug floor-only baseline) and
 *                   deepest floor (0 = no floor target, a debug score-only baseline).
 *   - `NewBestTracker`: per rendered frame from the shown score and the floor -> the target row's state (none / chasing
 *     / reach / passed) and numbers, the slam / pulse / gold / flash / shine / confetti / shout timelines and the
 *     one-frame edges: `scoreCrossed` (once per run, the frame the SHOWN score first exceeds the best: a held room bonus
 *     crosses when it lands), `deepestReached` (once per run, the first floor past the record), `deeperYet` (each later
 *     new floor), `fanfare` (either of the first two: sfx.best.new). An edge due under the stage cover is held to the
 *     first frame after it (the reveal); none fires once the run is over (a held one is dropped). The frame is also the
 *     cue mapper's `NewBestCueSource` (shared/view/audio): `fanfare`, `recordFloor` (the floor enter of the first floor
 *     past it is replaced by the fanfare) and `recordRun` (the run-over jingle swap).
 *   - Text: `newBestRowText` (target row), `stageBestLine` (stairwell card's second line), `recordRowText` /
 *     `runOverRibbonKey` / `recordSavedKey` / `bestText` (run over, pause, menu). Numbers go through a caller's
 *     formatter (the HUD shows plain digits today; a thousands separator is the caller's choice).
 *   - `runOverRecords`: the run-over record rows (old -> new, delta) from the baseline and the final score / floor, or
 *     from the server's verdict records once they arrive (they win: the server's replay is the record).
 *   - `confettiPieceAt`: one confetti piece's place at a time, in-run pieces kept outside HUD_CLEAR_ZONE.
 *   - Daily runs (docs/DAILY.md DS10, DSD6): `dailyBaselineFrom` freezes best today (the client's last
 *     `dailyStatus.mine` for the run's board, earlier daily runs of the day still awaiting their verdict folded in) as
 *     a baseline flagged `daily`: score only (no deepest-floor target: the daily board's floor is its best score's),
 *     the same tracker, and the "best today" strings (the text helpers' `daily` argument, DAILY_RANK_STRINGS). Its run
 *     over reads the server's `verdict.daily` (improved / previous) in place of the records. Endless baselines are
 *     unchanged (no `daily` flag; `baselineFrom` still answers unranked for the daily world).
 *
 * The records status and the server's verdict records are read through LOCAL structural types (`NewBestRecordsInput`,
 * `NewBestServerRecords`), so this compiles without shared/records; the network types pass as is when their fields
 * match (extra fields are fine).
 */
import { RANKED_WORLD_KIND } from "shared/play";
import type { StringVars } from "shared/theme";
import { easeOutBack } from "shared/view/fx";
import { DAILY_RANK_STRINGS } from "./dailyRankStrings";
import type { ScreenRect } from "./footprint";
import { NEW_BEST } from "./newBestConfig";
import { NEW_BEST_STRINGS } from "./newBestStrings";

/** A record board: solo runs compare with solo records, party runs with co-op records (the leaderboard's tabs). */
export type NewBestBoard = "solo" | "coop";

/** The run's frozen baseline (see the file header). */
export type RunBaseline =
	| { readonly kind: "unranked" }
	| { readonly kind: "unknown"; readonly board: NewBestBoard; readonly daily?: boolean }
	| {
			readonly kind: "none";
			readonly board: NewBestBoard;
			readonly score: number;
			readonly floor: number;
			readonly daily?: boolean;
	  }
	| {
			readonly kind: "known";
			readonly board: NewBestBoard;
			readonly score: number;
			readonly floor: number;
			/** A daily run's baseline (best today, DSD6): score only, the "best today" strings. Absent: endless. */
			readonly daily?: boolean;
	  };

/** One board's personal record as the client holds it (shared/records' Rec fits: extra fields are ignored). */
export interface NewBestRecord {
	readonly score: number;
	readonly floor: number;
}

/**
 * The client's copy of the personal records (shared/network `records(RecordsStatus)` fits when shaped like this):
 * `loaded` false = the server could not load them (no target, never a false celebration); a missing board = no record
 * on it yet.
 */
export interface NewBestRecordsInput {
	readonly loaded: boolean;
	readonly solo?: NewBestRecord;
	readonly coop?: NewBestRecord;
}

/** The board of a run of `partySize` players. */
export function boardFor(partySize: number): NewBestBoard {
	return partySize > 1 ? "coop" : "solo";
}

/** A stored number as a whole, non-negative value (junk counts as 0: no record). */
function whole(n: unknown): number {
	if (!typeIs(n, "number") || n !== n || n === math.huge || n <= 0) return 0;
	return math.floor(n);
}

/**
 * The run's baseline at run start (NB3): unranked unless the ranked world (shared/play RANKED_WORLD_KIND) and a scored
 * run; unknown while the records are missing or failed to load; none for no record on the board or a best under
 * NEW_BEST.minScore (its numbers kept); else known.
 */
export function baselineFrom(
	records: NewBestRecordsInput | undefined,
	partySize: number,
	worldKind: string,
	scoring: boolean,
): RunBaseline {
	if (worldKind !== RANKED_WORLD_KIND || !scoring) return { kind: "unranked" };
	const board = boardFor(partySize);
	if (records === undefined || records.loaded !== true) return { kind: "unknown", board };
	const rec = board === "coop" ? records.coop : records.solo;
	const score = rec !== undefined ? whole(rec.score) : 0;
	const floor = rec !== undefined ? whole(rec.floor) : 0;
	if (score < NEW_BEST.minScore) return { kind: "none", board, score, floor };
	return { kind: "known", board, score, floor };
}

/**
 * An earlier ranked run of this session whose records may not have reached the client's records yet: its verdict is
 * still pending (the client's own final score and floor, a claim) or it was accepted with a records result (the
 * server's numbers; the `records` push follows the verdict). SimController lists them (`pendingRunClaims`).
 */
export interface PendingRunClaim {
	readonly board: NewBestBoard;
	readonly score: number;
	readonly floor: number;
	/**
	 * A daily run's claim (docs/DAILY.md DS10): the day it belongs to. Folded only into that day's daily baseline
	 * (dailyBaselineFrom), never into the endless records (withPendingRuns skips it). Absent: an endless run.
	 */
	readonly daily?: number;
}

/**
 * The records with earlier runs still in flight folded in (max per field, `board` only), for freezing the next run's
 * baseline: the server pushes new records only after a verdict, so a run started before the previous run's verdict
 * (R-restart, a quick Again, Leave run then Play) would otherwise freeze a baseline below the record just set and
 * replay a false NEW BEST at the old number. Records not loaded (or missing) are returned as they are: an unknown
 * baseline stays unknown. A pending run that is later rejected leaves the frozen baseline alone (frozen per run,
 * NBD10): at worst one run aims too high, never a false celebration. Returns `records` itself when nothing changes.
 */
export function withPendingRuns(
	records: NewBestRecordsInput | undefined,
	board: NewBestBoard,
	pending: ReadonlyArray<PendingRunClaim>,
): NewBestRecordsInput | undefined {
	if (records === undefined || records.loaded !== true) return records;
	const rec = board === "coop" ? records.coop : records.solo;
	const baseScore = rec !== undefined ? whole(rec.score) : 0;
	const baseFloor = rec !== undefined ? whole(rec.floor) : 0;
	let score = baseScore;
	let floor = baseFloor;
	for (const claim of pending) {
		if (claim.board !== board || claim.daily !== undefined) continue;
		score = math.max(score, whole(claim.score));
		floor = math.max(floor, whole(claim.floor));
	}
	if (score === baseScore && floor === baseFloor) return records;
	const merged: NewBestRecord = { score, floor };
	return board === "coop"
		? { loaded: true, solo: records.solo, coop: merged }
		: { loaded: true, solo: merged, coop: records.coop };
}

/** A board's entry today as the client holds it (shared/daily DailyMineEntry fits). */
export interface NewBestDailyEntry {
	readonly score: number;
}

/**
 * The client's last `dailyStatus` as dailyBaselineFrom reads it (shared/daily DailyStatus fits): `mine` absent = the
 * entries are unknown (no answer from the boards); a board missing from `mine` = no entry on it today.
 */
export interface NewBestDailyInput {
	readonly day: number;
	readonly seed: number;
	readonly mine?: { readonly solo?: NewBestDailyEntry; readonly coop?: NewBestDailyEntry };
}

/**
 * A daily run's baseline at run start (docs/DAILY.md DS10, DSD6): unranked unless `ranked` (a server run session, not
 * the tutorial, scored); unknown (flagged daily) while the status is missing, belongs to another day's seed than the
 * run's (`runSeed`: the status of the day this run was seeded for, never yesterday's), or carries no `mine`; else best
 * today on the run's board (solo / co-op by party size) with this day's pending daily claims folded in (max), as none
 * under NEW_BEST.minScore or no entry, else known. Score only: floor 0, so no deepest-floor beat or stage line.
 */
export function dailyBaselineFrom(
	status: NewBestDailyInput | undefined,
	partySize: number,
	runSeed: number,
	ranked: boolean,
	pending: ReadonlyArray<PendingRunClaim> = [],
): RunBaseline {
	if (!ranked) return { kind: "unranked" };
	const board = boardFor(partySize);
	if (status === undefined || status.seed !== runSeed || status.mine === undefined) {
		return { kind: "unknown", board, daily: true };
	}
	const entry = board === "coop" ? status.mine.coop : status.mine.solo;
	let score = entry !== undefined ? whole(entry.score) : 0;
	for (const claim of pending) {
		if (claim.board === board && claim.daily === status.day) score = math.max(score, whole(claim.score));
	}
	if (score < NEW_BEST.minScore) return { kind: "none", board, score, floor: 0, daily: true };
	return { kind: "known", board, score, floor: 0, daily: true };
}

/** The baseline is a daily run's (best today). */
export function isDailyBaseline(b: RunBaseline): boolean {
	return b.kind !== "unranked" && b.daily === true;
}

/** KV_NewBestDebug's forced baseline (parseNewBestDebug). */
export type NewBestDebug =
	| { readonly kind: "first" }
	| { readonly kind: "unknown" }
	| { readonly kind: "set"; readonly score: number; readonly floor: number };

/**
 * Parses the KV_NewBestDebug Workspace attribute: "first" (no record), "unknown" (records not loaded), or one or both
 * of "score:<n>" / "floor:<n>" separated by a comma ("score:2000,floor:3"; whole numbers >= 0; a missing one is 0, no
 * target). Anything else (absent, empty, malformed) is undefined: no override.
 */
export function parseNewBestDebug(attr: unknown): NewBestDebug | undefined {
	if (!typeIs(attr, "string")) return undefined;
	const [trimmed] = attr.lower().gsub("%s", "");
	if (trimmed === "first") return { kind: "first" };
	if (trimmed === "unknown") return { kind: "unknown" };
	if (trimmed === "") return undefined;
	let score = 0;
	let floor = 0;
	let seen = false;
	for (const part of trimmed.split(",")) {
		const pair = part.split(":");
		if (pair.size() !== 2) return undefined;
		const value = tonumber(pair[1]);
		if (value === undefined || value < 0 || value !== math.floor(value) || value === math.huge) return undefined;
		if (pair[0] === "score") score = value;
		else if (pair[0] === "floor") floor = value;
		else return undefined;
		seen = true;
	}
	return seen ? { kind: "set", score, floor } : undefined;
}

/**
 * The baseline a debug override forces on `board`: "first" a none with no record, "unknown" unknown, a "set" a known
 * baseline with exactly those numbers (no minScore rule: "score:500" is a target; 0 = no target of that kind).
 */
export function debugBaseline(debug: NewBestDebug, board: NewBestBoard, daily = false): RunBaseline {
	if (daily) {
		// A daily run's baseline is score only (dailyBaselineFrom): the debug floor is ignored.
		if (debug.kind === "first") return { kind: "none", board, score: 0, floor: 0, daily: true };
		if (debug.kind === "unknown") return { kind: "unknown", board, daily: true };
		return { kind: "known", board, score: debug.score, floor: 0, daily: true };
	}
	if (debug.kind === "first") return { kind: "none", board, score: 0, floor: 0 };
	if (debug.kind === "unknown") return { kind: "unknown", board };
	return { kind: "known", board, score: debug.score, floor: debug.floor };
}

/** The best score the run chases (known, > 0), else undefined. */
export function scoreTarget(b: RunBaseline): number | undefined {
	return b.kind === "known" && b.score > 0 ? b.score : undefined;
}

/** The deepest floor the run chases (known, > 0), else undefined. */
export function floorTarget(b: RunBaseline): number | undefined {
	return b.kind === "known" && b.floor > 0 ? b.floor : undefined;
}

/**
 * Whether a run ending at `score` / `floor` holds a record over `b` (client side, before the verdict): known, past a
 * target it has; none, above the stored numbers (any run beats no record); unknown / unranked, never.
 */
export function isRecordRun(b: RunBaseline, score: number, floor: number): boolean {
	if (b.kind === "known") {
		return (b.score > 0 && score > b.score) || (b.floor > 0 && floor > b.floor);
	}
	// A daily baseline is score only (best today): a deeper floor is no record.
	if (b.kind === "none") return score > b.score || (b.daily !== true && floor > b.floor);
	return false;
}

/**
 * What the cue mapper (shared/view/audio AudioCueMapper.frame's `newBest`) reads of a frame. NewBestFrame fits as is;
 * NO_NEW_BEST_CUES is "no run / no new best" (every other cue as before).
 */
export interface NewBestCueSource {
	/** sfx.best.new this frame: the score crossing or the first floor past the record (NewBestFrame.fanfare). */
	readonly fanfare: boolean;
	/**
	 * The record floor (known baseline with a floor target), or 0 for none: on the frame the run enters the first
	 * floor past it (floorChanged), sfx.floor.enter is dropped; the fanfare plays at the card's reveal instead.
	 */
	readonly recordFloor: number;
	/** The run holds a record (isRecordRun on the true score and floor): the run-over jingle is sfx.jingle.record. */
	readonly recordRun: boolean;
}

/** No new-best cues (no run, an unranked run, or before the tracker's first frame). */
export const NO_NEW_BEST_CUES: NewBestCueSource = { fanfare: false, recordFloor: 0, recordRun: false };

/** One frame's input. */
export interface NewBestInput {
	/** Real seconds since the last frame (clamped to NEW_BEST.maxFrameDtSec). */
	readonly dt: number;
	/** The score panel's shown score (shared/view/fx ScoreRoller.shown): the row and the crossing follow it. */
	readonly shownScore: number;
	/** The true score (state.score.total): recordRun reads it (the run-over jingle never waits for the roller). */
	readonly score: number;
	/** The endless floor (state.endless.floor). */
	readonly floor: number;
	/** The stage cover is up (StageController / SimController.isInputCovered): edges wait for the reveal. */
	readonly underCover: boolean;
	/** The run is over (SimController.isRunOver): no edge from now on, a held one is dropped. */
	readonly runOver: boolean;
	/** The effective reduced-motion setting: no slam, shine or confetti (colours, text, sounds stay). */
	readonly reducedMotion: boolean;
}

/** The target row's state (docs/NEW_BEST.md "The target line"). */
export type NewBestLine = "none" | "chasing" | "reach" | "passed";

/** The tracker's output. One object, reused every frame: read it, never keep it. */
export interface NewBestFrame extends NewBestCueSource {
	/** none: empty slot; chasing: uiTextDim; reach: ember, pulsing; passed: newBest gold. */
	line: NewBestLine;
	/** chasing / reach: points the shown score still needs to pass the best (best + 1 - shown, >= 1); else 0. */
	gap: number;
	/** passed: shown score - best (>= 1); else 0. */
	margin: number;
	/** The row's UIScale: the crossing's slam (NEW_BEST.slam, 1.6 -> 1), else 1. 1 under reduced motion. */
	slamScale: number;
	/** reach: the 1 Hz pulse 0..1 (draw the row this much toward white / brighter); 0 in other states. */
	pulse: number;
	/** The score number's gold: 0 before the crossing has played, 1 after (for the rest of the run). */
	goldMix: number;
	/** The score number's white flash over the gold: 1 at the crossing, to 0 over NEW_BEST.flashSec. */
	whiteFlash: number;
	/** The shine sweep across the gold number, 0..1, or -1 (none; none under reduced motion). */
	shine: number;
	/** Seconds since the in-run confetti started (crossing or deepest), or -1 (none; none under reduced motion). */
	confettiAge: number;
	/** The running confetti's seed (confettiPieceAt): a new burst, a new pattern. */
	confettiSeed: number;
	/** Seconds since the NEW BEST! floor shout started (life NEW_BEST.shout.lifeSec), or -1. */
	shoutAge: number;
	/** The shown score is past the best (level; the crossing edge may still be held by the cover). */
	scorePassed: boolean;
	/** The run has reached a floor past the record (level). */
	deeper: boolean;
	// --- one-frame edges ---
	/** The shown score passed the best: sfx.best.new, gold flare, slam, shout, edge confetti. Once per run. */
	scoreCrossed: boolean;
	/** The first floor past the record (at the reveal): sfx.best.new (instead of the floor enter), confetti. Once. */
	deepestReached: boolean;
	/** A later new floor past the record: no sound (the card says "Deepest yet"). */
	deeperYet: boolean;
	/** scoreCrossed or deepestReached (the cue mapper's sfx.best.new). */
	fanfare: boolean;
	/** The record floor or 0 (NewBestCueSource). */
	recordFloor: number;
	/** The run holds a record on the true numbers (NewBestCueSource). */
	recordRun: boolean;
}

const IDLE = -1;
const FULL_TURN = 2 * math.pi;
const DEG_PER_TURN = 360;

function clamp01(u: number): number {
	return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** Advances a running timer (IDLE stays IDLE). */
function advance(t: number, d: number): number {
	return t >= 0 ? t + d : t;
}

/** Progress of a timer `t` over `sec`: 0..1 while running, IDLE before / after. */
function progress(t: number, sec: number): number {
	if (t < 0 || t >= sec) return IDLE;
	return sec > 0 ? t / sec : 0;
}

/** The new-best state machine (see the file header). One per run: the baseline is frozen at construction. */
export class NewBestTracker {
	readonly look: NewBestFrame;
	private readonly target: number | undefined;
	private readonly deepTarget: number | undefined;
	private lastFloor = 0;
	private crossQueued = false;
	private crossPending = false;
	private crossFired = false;
	private deepQueued = false;
	private deepPending = false;
	private deeperPending = false;
	private reachT = 0;
	private slamT = IDLE;
	private flashT = IDLE;
	private shineT = IDLE;
	private confettiT = IDLE;
	private shoutT = IDLE;
	private bursts = 0;

	constructor(readonly baseline: RunBaseline) {
		this.target = scoreTarget(baseline);
		this.deepTarget = floorTarget(baseline);
		this.look = {
			line: "none",
			gap: 0,
			margin: 0,
			slamScale: 1,
			pulse: 0,
			goldMix: 0,
			whiteFlash: 0,
			shine: IDLE,
			confettiAge: IDLE,
			confettiSeed: 0,
			shoutAge: IDLE,
			scorePassed: false,
			deeper: false,
			scoreCrossed: false,
			deepestReached: false,
			deeperYet: false,
			fanfare: false,
			recordFloor: this.deepTarget ?? 0,
			recordRun: false,
		};
	}

	frame(input: NewBestInput): NewBestFrame {
		const d = math.clamp(input.dt, 0, NEW_BEST.maxFrameDtSec);
		const motion = !input.reducedMotion;
		const L = this.look;
		L.scoreCrossed = false;
		L.deepestReached = false;
		L.deeperYet = false;
		L.fanfare = false;
		this.slamT = advance(this.slamT, d);
		this.flashT = advance(this.flashT, d);
		this.shineT = advance(this.shineT, d);
		this.confettiT = advance(this.confettiT, d);
		this.shoutT = advance(this.shoutT, d);

		this.watchScore(input.shownScore);
		this.watchFloor(input.floor);
		if (input.runOver) {
			this.crossPending = false;
			this.deepPending = false;
			this.deeperPending = false;
		} else if (!input.underCover) this.fire(motion);

		L.recordRun = isRecordRun(this.baseline, input.score, input.floor);
		this.writeLine(input.shownScore, d);
		this.writeTimelines(motion);
		return L;
	}

	/** Queues the crossing the first frame the shown score exceeds the best (once per run). */
	private watchScore(shown: number): void {
		const target = this.target;
		if (target === undefined || this.crossQueued || !(shown > target)) return;
		this.crossQueued = true;
		this.crossPending = true;
	}

	/** Queues deepestReached for the first new floor past the record, deeperYet for each later one. */
	private watchFloor(floor: number): void {
		const deep = this.deepTarget;
		if (floor <= this.lastFloor) return;
		this.lastFloor = floor;
		if (deep === undefined || floor <= deep) return;
		this.look.deeper = true;
		if (!this.deepQueued) {
			this.deepQueued = true;
			this.deepPending = true;
		} else this.deeperPending = true;
	}

	/** Raises the held edges (not covered, not over) and starts their timelines. */
	private fire(motion: boolean): void {
		const L = this.look;
		if (this.crossPending) {
			this.crossPending = false;
			this.crossFired = true;
			L.scoreCrossed = true;
			this.flashT = 0;
			this.shoutT = 0;
			if (motion) {
				this.slamT = 0;
				this.shineT = 0;
			}
		}
		if (this.deepPending) {
			this.deepPending = false;
			L.deepestReached = true;
		}
		if (this.deeperPending) {
			this.deeperPending = false;
			L.deeperYet = true;
		}
		L.fanfare = L.scoreCrossed || L.deepestReached;
		if (L.fanfare && motion) {
			this.confettiT = 0;
			this.bursts++;
			L.confettiSeed = this.bursts;
		}
	}

	private writeLine(shown: number, d: number): void {
		const L = this.look;
		const target = this.target;
		L.gap = 0;
		L.margin = 0;
		L.pulse = 0;
		if (target === undefined) {
			L.line = "none";
			L.scorePassed = false;
			return;
		}
		if (shown > target) {
			L.line = "passed";
			L.scorePassed = true;
			L.margin = shown - target;
			this.reachT = 0;
			return;
		}
		L.scorePassed = false;
		L.gap = target + 1 - shown;
		if (L.gap <= NEW_BEST.reachFraction * target) {
			L.line = "reach";
			this.reachT += d;
			L.pulse = (1 - math.cos(FULL_TURN * NEW_BEST.pulseHz * this.reachT)) * (1 / 2);
		} else {
			L.line = "chasing";
			this.reachT = 0;
		}
	}

	private writeTimelines(motion: boolean): void {
		const L = this.look;
		L.goldMix = this.crossFired ? 1 : 0;
		const flashU = progress(this.flashT, NEW_BEST.flashSec);
		L.whiteFlash = flashU >= 0 ? 1 - flashU : 0;
		L.slamScale = 1;
		L.shine = IDLE;
		if (motion) {
			const slamU = progress(this.slamT, NEW_BEST.slam.sec);
			if (slamU >= 0) {
				const from = NEW_BEST.slam.fromScale;
				L.slamScale = from + (1 - from) * easeOutBack(slamU);
			}
			if (this.shineT >= NEW_BEST.shine.delaySec) {
				L.shine = progress(this.shineT - NEW_BEST.shine.delaySec, NEW_BEST.shine.sweepSec);
			}
		} else this.confettiT = IDLE;
		if (this.confettiT >= NEW_BEST.confetti.inRun.lifeSec) this.confettiT = IDLE;
		L.confettiAge = this.confettiT;
		if (this.shoutT >= NEW_BEST.shout.lifeSec) this.shoutT = IDLE;
		L.shoutAge = this.shoutT;
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Text

/** A theme string lookup (ThemePack.str). */
export type NewBestStr = (key: string, vars?: StringVars) => string;
/** How a score is printed (plain digits by default; a thousands separator is the caller's choice). */
export type NewBestFormat = (n: number) => string;

const plainNumber: NewBestFormat = (n) => tostring(n);

/**
 * The score panel's target row (left slot of the label row): "" for none; chasing / reach `hud.best.toGo` ("{points}
 * TO BEST", the gap) or, compact (touch, 120 px), `hud.best.toGoShort` ("-{points}"); passed `hud.best.over` ("NEW
 * BEST +{points}", the margin) or, compact, `hud.best.new` ("NEW BEST").
 */
export function newBestRowText(
	look: Pick<NewBestFrame, "line" | "gap" | "margin">,
	compact: boolean,
	s: NewBestStr,
	fmt: NewBestFormat = plainNumber,
	daily = false,
): string {
	const K = NEW_BEST_STRINGS;
	if (look.line === "none") return "";
	if (daily) {
		// Best today (docs/DAILY.md DS10): "{points} TO BEST TODAY" / "NEW BEST TODAY +{points}"; compact chasing as
		// endless ("-{points}"), compact passed "BEST TODAY".
		const D = DAILY_RANK_STRINGS;
		if (look.line === "passed") return compact ? s(D.newBest) : s(D.over, { points: fmt(look.margin) });
		return s(compact ? K.toGoShort : D.toGo, { points: fmt(look.gap) });
	}
	if (look.line === "passed") return compact ? s(K.newBest) : s(K.over, { points: fmt(look.margin) });
	return s(compact ? K.toGoShort : K.toGo, { points: fmt(look.gap) });
}

/** The NEW BEST! floor shout's key: `hud.best.shout`, or for a daily run `hud.dailyRank.shout` (NEW BEST TODAY!). */
export function newBestShoutKey(daily = false): string {
	return daily ? DAILY_RANK_STRINGS.shout : NEW_BEST_STRINGS.shout;
}

/** A string to show: its key, its vars, and whether it is drawn in the newBest gold. */
export interface NewBestLineText {
	readonly key: string;
	readonly args: StringVars | undefined;
	readonly gold: boolean;
}

/**
 * The stairwell card's second line for `floor` (undefined: none, for a baseline without a floor target): below the
 * record `stage.best.toGo` ("Deepest: floor {floor} · {n} to go") or one floor below `stage.best.oneToGo`; on it
 * `stage.best.recordFloor`; past it `stage.best.newDeepest` (gold) on the first floor past the record of the run, else
 * `stage.best.deeperYet` (gold). `alreadyDeeper`: an earlier floor of this run was already past the record
 * (NewBestFrame.deeper read BEFORE this floor, or simply floor > record + 1 for stairs).
 */
export function stageBestLine(
	floor: number,
	baseline: RunBaseline,
	alreadyDeeper: boolean,
): NewBestLineText | undefined {
	const record = floorTarget(baseline);
	if (record === undefined) return undefined;
	const K = NEW_BEST_STRINGS;
	if (floor > record)
		return { key: alreadyDeeper ? K.stageDeeperYet : K.stageNewDeepest, args: undefined, gold: true };
	if (floor === record) return { key: K.stageRecordFloor, args: undefined, gold: false };
	const n = record - floor;
	if (n === 1) return { key: K.stageOneToGo, args: { floor: record }, gold: false };
	return { key: K.stageToGo, args: { floor: record, n }, gold: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Run over

/**
 * The server's verdict records (shared/network RunFinishVerdict.records fits: `board` and other extra fields are
 * ignored): what the server's replay changed and the record before it.
 */
export interface NewBestServerRecords {
	readonly scoreImproved: boolean;
	readonly floorImproved: boolean;
	readonly previous: NewBestRecord;
}

/** A daily run's verdict on its board as dailyServerRecords reads it (shared/daily DailyRunResult fits). */
export interface NewBestDailyResult {
	readonly improved: boolean;
	readonly previous?: NewBestRecord;
}

/**
 * A daily run's server records for runOverRecords (docs/DAILY.md DS10): from `verdict.daily` instead of the records
 * doc (daily runs never write it, DSD6): the score improved when the entry was raised, never the floor (a daily entry
 * is ranked by score), the previous entry or none (0 / 0: the day's first entry, FIRST RUN TODAY). Undefined in,
 * undefined out (no daily result: Studio, a failed post, a rejected run).
 */
export function dailyServerRecords(d: NewBestDailyResult | undefined): NewBestServerRecords | undefined {
	if (d === undefined) return undefined;
	const prev = d.previous;
	return {
		scoreImproved: d.improved === true,
		floorImproved: false,
		previous: {
			score: prev !== undefined ? whole(prev.score) : 0,
			floor: prev !== undefined ? whole(prev.floor) : 0,
		},
	};
}

/** One record row: `Score 48210 -> 61930 (+13720)` / `Deepest floor 9 -> 11 (+2)`. */
export interface RecordRow {
	readonly kind: "score" | "floor";
	readonly from: number;
	readonly to: number;
	readonly delta: number;
}

/** The run-over panel's record (runOverRecords). */
export interface RunOverRecords {
	/** A record run: the ribbon, the rows, full-screen confetti, the record fanfare. */
	readonly record: boolean;
	/** No record existed before (the ribbon says FIRST RECORD; the rows start at 0, the client may hide them). */
	readonly first: boolean;
	/** From the server's verdict records (a Saved chip may show), not the client's guess. */
	readonly fromServer: boolean;
	/** The improved fields, score first. Empty when not a record. */
	readonly rows: ReadonlyArray<RecordRow>;
}

const NO_RECORD: RunOverRecords = { record: false, first: false, fromServer: false, rows: [] };

function recordOf(
	scoreFrom: number,
	floorFrom: number,
	scoreImproved: boolean,
	floorImproved: boolean,
	finalScore: number,
	finalFloor: number,
	fromServer: boolean,
): RunOverRecords {
	if (!scoreImproved && !floorImproved) return { record: false, first: false, fromServer, rows: [] };
	const rows: RecordRow[] = [];
	if (scoreImproved) rows.push({ kind: "score", from: scoreFrom, to: finalScore, delta: finalScore - scoreFrom });
	if (floorImproved) rows.push({ kind: "floor", from: floorFrom, to: finalFloor, delta: finalFloor - floorFrom });
	return { record: true, first: scoreFrom <= 0 && floorFrom <= 0, fromServer, rows };
}

/**
 * The run-over record from the baseline and the run's final score / floor (the verdict's, or the client's own while
 * it waits), or from the server's verdict records when given (they win, NBD10: an unknown baseline celebrates from
 * them; the old values are the server's `previous`). Unranked runs never hold a record.
 */
export function runOverRecords(
	baseline: RunBaseline,
	finalScore: number,
	finalFloor: number,
	server?: NewBestServerRecords,
): RunOverRecords {
	if (baseline.kind === "unranked") return NO_RECORD;
	const score = whole(finalScore);
	const floor = whole(finalFloor);
	if (server !== undefined) {
		const prev = server.previous;
		return recordOf(
			whole(prev.score),
			whole(prev.floor),
			server.scoreImproved === true,
			server.floorImproved === true,
			score,
			floor,
			true,
		);
	}
	if (baseline.kind === "unknown") return NO_RECORD;
	const known = baseline.kind === "known";
	const scoreImproved = known ? baseline.score > 0 && score > baseline.score : score > baseline.score;
	// A daily baseline is score only (best today): its floor never makes a record row.
	const floors = baseline.daily !== true;
	const floorImproved = floors && (known ? baseline.floor > 0 && floor > baseline.floor : floor > baseline.floor);
	return recordOf(baseline.score, baseline.floor, scoreImproved, floorImproved, score, floor, false);
}

/**
 * The ribbon across the run-over panel's header: FIRST RECORD / NEW BEST!, or for a daily run (`daily`) FIRST RUN
 * TODAY / NEW BEST TODAY!; undefined (no record).
 */
export function runOverRibbonKey(records: RunOverRecords, daily = false): string | undefined {
	if (!records.record) return undefined;
	if (daily) return records.first ? DAILY_RANK_STRINGS.first : DAILY_RANK_STRINGS.ribbon;
	return records.first ? NEW_BEST_STRINGS.first : NEW_BEST_STRINGS.ribbon;
}

/**
 * A record row's text at a rolled value `shown` (recordRollValue; pass row.to when settled): `run.best.score` with the
 * score formatted by `fmt`, `run.best.floor` with plain floor numbers.
 */
export function recordRowText(
	row: RecordRow,
	shown: number,
	s: NewBestStr,
	fmt: NewBestFormat = plainNumber,
	daily = false,
): string {
	const f = row.kind === "score" ? fmt : plainNumber;
	// A daily run's score row is best today's (`run.dailyRank.score`); it has no floor row.
	const scoreKey = daily ? DAILY_RANK_STRINGS.scoreRow : NEW_BEST_STRINGS.scoreRow;
	const key = row.kind === "score" ? scoreKey : NEW_BEST_STRINGS.floorRow;
	return s(key, { old: f(row.from), new: f(shown), delta: f(shown - row.from) });
}

/**
 * Row `index`'s rolled value `t` seconds after the run-over panel opened: row.from until its start (NEW_BEST.runOver
 * rowDelaySec + index x rowGapSec), easing out to row.to over rollSec (whole numbers). Done when it equals row.to.
 */
export function recordRollValue(row: RecordRow, index: number, t: number): number {
	const R = NEW_BEST.runOver;
	const u = clamp01((t - R.rowDelaySec - index * R.rowGapSec) / R.rollSec);
	const eased = 1 - (1 - u) * (1 - u);
	return u >= 1 ? row.to : row.from + math.floor((row.to - row.from) * eased);
}

/** The roll's sound edges between two frames (recordRollEdges): rows that started rolling, rows that landed. */
export interface RecordRollEdges {
	/** Rows whose roll started in (prevT, t]: sfx.score.tick each. */
	started: number;
	/** Rows that reached their value in (prevT, t]: sfx.score.land each. */
	landed: number;
}

/**
 * How many of `rowCount` record rows started rolling and how many landed between `prevT` (exclusive) and `t`
 * (inclusive), seconds since the run-over panel opened (recordRollValue's timeline: row i starts at rowDelaySec + i x
 * rowGapSec and lands rollSec later). The client plays one tick per start and one land per landing; summing over any
 * split of the time gives each edge once. `out` (optional) is refilled and returned.
 */
export function recordRollEdges(
	rowCount: number,
	prevT: number,
	t: number,
	out: RecordRollEdges = { started: 0, landed: 0 },
): RecordRollEdges {
	const R = NEW_BEST.runOver;
	out.started = 0;
	out.landed = 0;
	for (let i = 0; i < rowCount; i++) {
		const start = R.rowDelaySec + i * R.rowGapSec;
		const land = start + R.rollSec;
		if (prevT < start && start <= t) out.started += 1;
		if (prevT < land && land <= t) out.landed += 1;
	}
	return out;
}

/** The run's verdict as the run-over panel knows it (hud.verdict.<status>). */
export type NewBestVerdictStatus = "pending" | "accepted" | "rejected" | "skipped";

/**
 * The save chip: `run.best.saved` once an accepted verdict carried the server's records, `run.best.unsaved` for a
 * rejected record run, else undefined (no record, waiting, or never submitted).
 */
export function recordSavedKey(records: RunOverRecords, status: NewBestVerdictStatus): string | undefined {
	if (status === "rejected") return records.record ? NEW_BEST_STRINGS.unsaved : undefined;
	if (status === "accepted" && records.record && records.fromServer) return NEW_BEST_STRINGS.saved;
	return undefined;
}

/**
 * "Best {score} · floor {floor}" for a record (run over with no record: `run.best.target`; pause overlay: the same;
 * main menu: `menu.best`), or "" when there is none to show (undefined or no score).
 */
export function bestText(
	record: NewBestRecord | undefined,
	key: string,
	s: NewBestStr,
	fmt: NewBestFormat = plainNumber,
): string {
	if (record === undefined || whole(record.score) <= 0) return "";
	return s(key, { score: fmt(whole(record.score)), floor: whole(record.floor) });
}

/** The dim target line's key: `run.best.target`, or for a daily run `run.dailyRank.target` (Best today ...). */
export function bestTargetKey(daily = false): string {
	return daily ? DAILY_RANK_STRINGS.target : NEW_BEST_STRINGS.target;
}

/** The baseline's record for bestText (known / none with numbers), else undefined. */
export function baselineRecord(b: RunBaseline): NewBestRecord | undefined {
	return b.kind === "known" || b.kind === "none" ? { score: b.score, floor: b.floor } : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Confetti

/** One confetti piece at a time (screen px, y down). Mutable: pass one per piece and refill it. */
export interface ConfettiPiece {
	/** Centre. */
	x: number;
	y: number;
	sizePx: number;
	rotationDeg: number;
	transparency: number;
	/** 0..1: the client mixes newBest gold toward white by it (a little sparkle in the gold). */
	tone: number;
}

/** The hash behind confettiPieceAt (deterministic per seed and piece; presentation only, no sim stream). */
const CONFETTI_HASH = {
	modulus: 4294967296,
	seedWrap: 65521,
	seedMul: 65599,
	pieceMul: 7919,
	keyMul: 104729,
	/** < 2^20, so a 32-bit value times it stays an exact float64 integer. */
	roundMul: 548539,
	roundAdd: 12345,
	rounds: 3,
	shiftA: 15,
	shiftB: 13,
} as const;

/** Uniform 0..1 for (seed, piece, key). */
function hash01(seed: number, i: number, key: number): number {
	const H = CONFETTI_HASH;
	let h = ((math.floor(seed) % H.seedWrap) * H.seedMul + i * H.pieceMul + key * H.keyMul) % H.modulus;
	for (let r = 0; r < H.rounds; r++) {
		h = bit32.bxor(h, bit32.rshift(h, H.shiftA));
		h = (h * H.roundMul + H.roundAdd) % H.modulus;
	}
	h = bit32.bxor(h, bit32.rshift(h, H.shiftB));
	return h / H.modulus;
}

/** The hash keys of a piece's properties. */
const KEY = { start: 1, speed: 2, x: 3, sway: 4, spin: 5, turn: 6, tone: 7, size: 8 } as const;

function emptyPiece(): ConfettiPiece {
	return { x: 0, y: 0, sizePx: 0, rotationDeg: 0, transparency: 1, tone: 0 };
}

/**
 * Piece `i` of a burst with `seed`, `t` seconds after it started, on a `screenW` x `screenH` screen (px), or undefined
 * when it is not in the air (before its start, after the burst's life, or no room for it). In-run (`fullScreen`
 * false): NEW_BEST.confetti.inRun's life; even pieces fall in the band left of `clearZone`, odd ones right of it
 * (shared/view/hud clearZoneRect, px), every piece (its whole box, sway included) kept outside the zone's columns by
 * NEW_BEST.confetti.edgeMarginPx, so none ever crosses the fight. Run over (`fullScreen`): runOver's life, anywhere.
 * Every piece starts above the screen's top and falls; `out` (optional) is refilled and returned.
 */
export function confettiPieceAt(
	seed: number,
	i: number,
	t: number,
	screenW: number,
	screenH: number,
	clearZone: ScreenRect,
	fullScreen: boolean,
	out: ConfettiPiece = emptyPiece(),
): ConfettiPiece | undefined {
	const C = NEW_BEST.confetti;
	const life = fullScreen ? C.runOver.lifeSec : C.inRun.lifeSec;
	const start = hash01(seed, i, KEY.start) * C.spawnShare * life;
	if (t < start || t >= life) return undefined;
	const age = t - start;
	const flight = life - start;
	const size = C.minSizePx + hash01(seed, i, KEY.size) * (C.maxSizePx - C.minSizePx);
	const half = size / 2;
	const sway = C.swayPx * math.sin(FULL_TURN * (C.swayHz * age + hash01(seed, i, KEY.sway)));
	let x: number;
	if (fullScreen) x = hash01(seed, i, KEY.x) * screenW + sway;
	else {
		const m = C.edgeMarginPx;
		const left = i % 2 === 0;
		const lo = left ? m + half : clearZone.x + clearZone.w + m + half;
		const hi = left ? clearZone.x - m - half : screenW - m - half;
		if (hi < lo) return undefined;
		x = math.clamp(lo + hash01(seed, i, KEY.x) * (hi - lo) + sway, lo, hi);
	}
	const speed = ((C.fallScreens * screenH) / life) * (C.speedMin + C.speedSpan * hash01(seed, i, KEY.speed));
	const flown = age / flight;
	const fadeFrom = 1 - C.fadeShare;
	out.x = x;
	out.y = -half + speed * age;
	out.sizePx = size;
	out.rotationDeg =
		hash01(seed, i, KEY.turn) * DEG_PER_TURN + C.spinDegPerSec * (2 * hash01(seed, i, KEY.spin) - 1) * age;
	out.transparency = flown > fadeFrom ? clamp01((flown - fadeFrom) / C.fadeShare) : 0;
	out.tone = hash01(seed, i, KEY.tone);
	return out;
}
