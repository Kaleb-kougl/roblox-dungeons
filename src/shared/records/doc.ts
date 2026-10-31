/**
 * The personal records document (docs/NEW_BEST.md "Personal records (server)"): one DataStore value per player
 * (RecordsService, `KV_Records_v1`), its codec, the max-merge, the one-time seed from the leaderboard details, and what
 * the client gets. Pure: decoding never throws, so a garbage or old-shaped value reads as "no records".
 *
 * Best score and deepest floor are independent per board: different runs may hold them, so each field keeps the time
 * and runId of the run that set it. A field at 0 is no record (its time is 0, its runId ""), and a board with both at
 * 0 is absent. Merges only ever raise a field (strictly higher wins; a tie keeps the older run), so a merge inside
 * UpdateAsync can never lower a record whatever order servers write in.
 */
import { MAX_RUN_ID_CHARS } from "shared/run";
import type { DocCodec } from "shared/settings";
import { LEADERBOARD_BOARDS, decodeDetails, type LeaderboardBoard } from "shared/leaderboard";
import { RECORDS_DOC_VERSION } from "./config";

/** One board's records: the best score and the deepest floor, each with the run that set it. */
export interface RecordEntry {
	/** Best score (0 = none). */
	score: number;
	/** Unix seconds of the run that set `score` (0 with no score). */
	scoreAt: number;
	/** runId of that run ("" with no score). */
	scoreRunId: string;
	/** Deepest floor reached (`state.endless.floor`, the leaderboard's floor; 0 = none). */
	floor: number;
	floorAt: number;
	floorRunId: string;
}

/** The plan's name for a board's records. */
export type Rec = RecordEntry;

/** Records per leaderboard board (solo / coop); absent = no record on that board. */
export type RecordsBoards = { [K in LeaderboardBoard]?: RecordEntry };

/** The document, in memory and as stored (`{ v: 1, endless: { solo?, coop? } }`). */
export interface RecordsDoc {
	v: typeof RECORDS_DOC_VERSION;
	/** The endless descent's records (the only ranked world today). */
	endless: RecordsBoards;
}

/** A board's numbers as the client sees them. */
export interface RecordsBest {
	score: number;
	floor: number;
}

/** What the server tells the client (`records`). */
export interface RecordsStatus {
	/**
	 * False when the join load failed (or the Studio fake says `unknown`): the records are unknown, so the client shows
	 * no target and never a false celebration. The boards are then absent.
	 */
	loaded: boolean;
	solo?: RecordsBest;
	coop?: RecordsBest;
}

/** A finished run as the records see it: the server's replay numbers. */
export interface RecordRun {
	readonly score: number;
	readonly floor: number;
	/** Unix seconds. */
	readonly at: number;
	readonly runId: string;
}

/** What one merge did (mergeRecords). */
export interface RecordsMerge {
	/** The merged document (the input itself when nothing improved). */
	readonly doc: RecordsDoc;
	readonly scoreImproved: boolean;
	readonly floorImproved: boolean;
	/** The board's numbers before the merge (0 = none). */
	readonly previous: RecordsBest;
}

/**
 * A member's records outcome of an accepted run (`RunFinishVerdict.records`): the board it counted on, which fields it
 * raised, and the numbers before (0 / 0 = the first record on that board). The new numbers are the verdict's own
 * `score.score` / `score.floor`.
 */
export interface RunRecordsResult {
	board: LeaderboardBoard;
	scoreImproved: boolean;
	floorImproved: boolean;
	previous: RecordsBest;
}

function isFiniteNumber(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
}

function isNonNegativeInteger(v: unknown): v is number {
	return isFiniteNumber(v) && v >= 0 && v % 1 === 0;
}

function timeOf(v: unknown): number {
	return isFiniteNumber(v) && v >= 0 ? v : 0;
}

function runIdOf(v: unknown): string {
	return typeIs(v, "string") ? v.sub(1, MAX_RUN_ID_CHARS) : "";
}

export function emptyRecordsDoc(): RecordsDoc {
	return { v: RECORDS_DOC_VERSION, endless: {} };
}

/** True when no board has a record. */
export function isEmptyRecords(doc: Readonly<RecordsDoc>): boolean {
	for (const board of LEADERBOARD_BOARDS) if (doc.endless[board] !== undefined) return false;
	return true;
}

/**
 * A stored entry -> entry, each field on its own: a bad score / floor reads as 0, a bad time as 0, a bad runId as "".
 * A field at 0 drops its time and runId. Undefined when both are 0 (no record).
 */
export function decodeRecordEntry(raw: unknown): RecordEntry | undefined {
	if (!typeIs(raw, "table")) return undefined;
	const r = raw as {
		score?: unknown;
		scoreAt?: unknown;
		scoreRunId?: unknown;
		floor?: unknown;
		floorAt?: unknown;
		floorRunId?: unknown;
	};
	const score = isNonNegativeInteger(r.score) ? r.score : 0;
	const floor = isNonNegativeInteger(r.floor) ? r.floor : 0;
	if (score === 0 && floor === 0) return undefined;
	return {
		score,
		scoreAt: score > 0 ? timeOf(r.scoreAt) : 0,
		scoreRunId: score > 0 ? runIdOf(r.scoreRunId) : "",
		floor,
		floorAt: floor > 0 ? timeOf(r.floorAt) : 0,
		floorRunId: floor > 0 ? runIdOf(r.floorRunId) : "",
	};
}

/**
 * A stored value -> document. Missing, a non-table, another doc version or a non-table `endless`: the empty doc. Each
 * board decodes on its own (decodeRecordEntry), so one bad board never empties the other.
 */
export function decodeRecordsDoc(raw: unknown): RecordsDoc {
	if (!typeIs(raw, "table")) return emptyRecordsDoc();
	const doc = raw as { v?: unknown; endless?: unknown };
	if (doc.v !== RECORDS_DOC_VERSION || !typeIs(doc.endless, "table")) return emptyRecordsDoc();
	const boards = doc.endless as { [K in LeaderboardBoard]?: unknown };
	const out = emptyRecordsDoc();
	for (const board of LEADERBOARD_BOARDS) {
		const entry = decodeRecordEntry(boards[board]);
		if (entry !== undefined) out.endless[board] = entry;
	}
	return out;
}

function copyEntry(e: Readonly<RecordEntry>): RecordEntry {
	return {
		score: e.score,
		scoreAt: e.scoreAt,
		scoreRunId: e.scoreRunId,
		floor: e.floor,
		floorAt: e.floorAt,
		floorRunId: e.floorRunId,
	};
}

/** The value written to the DataStore: a normalized copy (absent boards left out). */
export function encodeRecordsDoc(doc: Readonly<RecordsDoc>): RecordsDoc {
	const out = emptyRecordsDoc();
	for (const board of LEADERBOARD_BOARDS) {
		const entry = decodeRecordEntry(doc.endless[board]);
		if (entry !== undefined) out.endless[board] = copyEntry(entry);
	}
	return out;
}

function sameEntry(a: Readonly<RecordEntry> | undefined, b: Readonly<RecordEntry> | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return (
		a.score === b.score &&
		a.scoreAt === b.scoreAt &&
		a.scoreRunId === b.scoreRunId &&
		a.floor === b.floor &&
		a.floorAt === b.floorAt &&
		a.floorRunId === b.floorRunId
	);
}

export function sameRecordsDoc(a: Readonly<RecordsDoc>, b: Readonly<RecordsDoc>): boolean {
	for (const board of LEADERBOARD_BOARDS) if (!sameEntry(a.endless[board], b.endless[board])) return false;
	return true;
}

/** A board's numbers (0 / 0 with no record). */
export function bestOf(doc: Readonly<RecordsDoc> | undefined, board: LeaderboardBoard): RecordsBest {
	const e = doc?.endless[board];
	return { score: e?.score ?? 0, floor: e?.floor ?? 0 };
}

/**
 * One entry per field max: `b`'s score / floor replace `a`'s only when strictly higher (each with its time and runId),
 * so a tie keeps `a` (pass the stored side as `a`: the older run). Undefined when both are.
 */
function mergeEntries(a: RecordEntry | undefined, b: RecordEntry | undefined): RecordEntry | undefined {
	if (b === undefined) return a;
	if (a === undefined) return copyEntry(b);
	const out = copyEntry(a);
	if (b.score > a.score) {
		out.score = b.score;
		out.scoreAt = b.scoreAt;
		out.scoreRunId = b.scoreRunId;
	}
	if (b.floor > a.floor) {
		out.floor = b.floor;
		out.floorAt = b.floorAt;
		out.floorRunId = b.floorRunId;
	}
	return out;
}

/** Two documents merged, max per board per field; ties keep `a`'s (pass the stored doc as `a`). A new doc. */
export function mergeRecordDocs(a: Readonly<RecordsDoc>, b: Readonly<RecordsDoc>): RecordsDoc {
	const out = emptyRecordsDoc();
	for (const board of LEADERBOARD_BOARDS) {
		const entry = mergeEntries(a.endless[board], b.endless[board]);
		if (entry !== undefined) out.endless[board] = copyEntry(entry);
	}
	return out;
}

/** The entry a run alone would set (undefined when its score and floor are both 0 or invalid). */
export function entryOfRun(run: RecordRun): RecordEntry | undefined {
	return decodeRecordEntry({
		score: run.score,
		scoreAt: run.at,
		scoreRunId: run.runId,
		floor: run.floor,
		floorAt: run.at,
		floorRunId: run.runId,
	});
}

/** The document a run alone would write (the base of a merge write when the stored doc is unknown). */
export function docOfRun(board: LeaderboardBoard, run: RecordRun): RecordsDoc {
	const out = emptyRecordsDoc();
	const entry = entryOfRun(run);
	if (entry !== undefined) out.endless[board] = entry;
	return out;
}

/**
 * Merges a finished run into `doc` on `board`: the score and the floor each replace the record only when strictly
 * higher (independently). Invalid numbers (negative, fractional, NaN) count as 0. Returns `doc` itself when nothing
 * improved (callers may compare by identity; PlayerDocCache.set then sees no change).
 */
export function mergeRecords(doc: RecordsDoc, board: LeaderboardBoard, run: RecordRun): RecordsMerge {
	const previous = bestOf(doc, board);
	const entry = entryOfRun(run);
	const scoreImproved = entry !== undefined && entry.score > previous.score;
	const floorImproved = entry !== undefined && entry.floor > previous.floor;
	if (!scoreImproved && !floorImproved) return { doc, scoreImproved, floorImproved, previous };
	const out = encodeRecordsDoc(doc);
	out.endless[board] = mergeEntries(doc.endless[board], entry);
	return { doc: out, scoreImproved, floorImproved, previous };
}

/** The verdict's records field for a merge on `board`. */
export function runRecordsResult(board: LeaderboardBoard, merge: RecordsMerge): RunRecordsResult {
	return {
		board,
		scoreImproved: merge.scoreImproved,
		floorImproved: merge.floorImproved,
		previous: { score: merge.previous.score, floor: merge.previous.floor },
	};
}

/**
 * UpdateAsync's transform for a records write: the stored value merged with `incoming` (mergeRecordDocs, the stored
 * side first, so ties keep the stored run). Undefined (cancel the write) when the stored value is a NEWER doc version
 * (an old server must not clobber it) or when the merge changes nothing (no write needed). Junk stored values read as
 * empty (decodeRecordsDoc), so they are replaced.
 */
export function mergeStoredRecords(stored: unknown, incoming: Readonly<RecordsDoc>): RecordsDoc | undefined {
	if (typeIs(stored, "table")) {
		const v = (stored as { v?: unknown }).v;
		if (isFiniteNumber(v) && v > RECORDS_DOC_VERSION) return undefined;
	}
	const old = decodeRecordsDoc(stored);
	const merged = mergeRecordDocs(old, decodeRecordsDoc(encodeRecordsDoc(incoming)));
	// A valid stored doc equal to the merge needs no write; a junk value is rewritten only if there is something to keep.
	const storedValid = typeIs(stored, "table") && (stored as { v?: unknown }).v === RECORDS_DOC_VERSION;
	if (sameRecordsDoc(old, merged) && (storedValid || isEmptyRecords(merged))) return undefined;
	return encodeRecordsDoc(merged);
}

/** Raw `LB_Details_v1` values of one player (detailsKey per board; undefined = never posted). */
export type RecordsSeedDetails = { readonly [K in LeaderboardBoard]?: unknown };

/**
 * The one-time seed (NBD2): a player's leaderboard personal bests (shared/leaderboard decodeDetails per board) as
 * records, so a veteran's first run is not a FIRST RECORD. The leaderboard entry is the best-SCORE run, so its floor
 * seeds the deepest floor only as a floor (a later deeper run raises it). Malformed details are skipped per board.
 */
export function seedFromDetails(details: RecordsSeedDetails): RecordsDoc {
	const out = emptyRecordsDoc();
	for (const board of LEADERBOARD_BOARDS) {
		const d = decodeDetails(details[board]);
		if (d === undefined) continue;
		const entry = entryOfRun({ score: d.score, floor: d.floor, at: d.at, runId: runIdOf(d.runId) });
		if (entry !== undefined) out.endless[board] = entry;
	}
	return out;
}

/** The status for a session's document (`loaded` = the join load succeeded). Boards only when loaded. */
export function recordsStatusOf(doc: Readonly<RecordsDoc> | undefined, loaded: boolean): RecordsStatus {
	const status: RecordsStatus = { loaded };
	if (!loaded || doc === undefined) return status;
	for (const board of LEADERBOARD_BOARDS) {
		const e = doc.endless[board];
		if (e !== undefined) status[board] = { score: e.score, floor: e.floor };
	}
	return status;
}

/** PlayerDocCache codec (shared/settings store.ts). */
export const RECORDS_CODEC: DocCodec<RecordsDoc> = {
	decode(raw) {
		return decodeRecordsDoc(raw);
	},
	encode(doc) {
		return encodeRecordsDoc(doc);
	},
	equals(a, b) {
		return sameRecordsDoc(a, b);
	},
	empty() {
		return emptyRecordsDoc();
	},
};
