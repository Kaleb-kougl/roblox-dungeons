/**
 * The Studio records fake (RECORDS_FAKE_ATTRIBUTE, `KV_FakeRecords`): a Workspace string -> what RecordsService serves
 * instead of the DataStore. Pure.
 *
 *   "solo:48210:9,coop:0:0"   per board `<board>:<best score>:<deepest floor>` (non-negative integers); 0:0 or a board
 *                             left out = no record there. Spaces around parts are ignored; a board given twice: the
 *                             last wins.
 *   "none"                    loaded, no records (every board's first record)
 *   "unknown"                 not loaded (the client shows no target)
 *
 * Anything else (empty, a bad part, an unknown board) is no fake: undefined (the service logs it and serves the real
 * records).
 */
import { LEADERBOARD_BOARDS, type LeaderboardBoard } from "shared/leaderboard";
import { RECORDS_FAKE_KEYWORDS, RECORDS_FAKE_RUN_ID } from "./config";
import { emptyRecordsDoc, entryOfRun, type RecordsDoc } from "./doc";

export interface FakeRecords {
	/** False for `unknown`. */
	readonly loaded: boolean;
	/** The fake document (empty for `unknown` / `none`). */
	readonly doc: RecordsDoc;
}

function trim(s: string): string {
	const [inner] = string.match(s, "^%s*(.-)%s*$");
	return typeIs(inner, "string") ? inner : s;
}

function parseCount(s: string): number | undefined {
	const [digits] = string.match(s, "^%d+$");
	if (digits === undefined) return undefined;
	const n = tonumber(digits);
	return n !== undefined && n === n && n !== math.huge ? n : undefined;
}

export function parseFakeRecords(value: unknown): FakeRecords | undefined {
	if (!typeIs(value, "string")) return undefined;
	const text = trim(value).lower();
	if (text === "") return undefined;
	if (text === RECORDS_FAKE_KEYWORDS.unknown) return { loaded: false, doc: emptyRecordsDoc() };
	if (text === RECORDS_FAKE_KEYWORDS.none) return { loaded: true, doc: emptyRecordsDoc() };
	const doc = emptyRecordsDoc();
	for (const part of text.split(",")) {
		const fields = trim(part).split(":");
		if (fields.size() !== 3) return undefined;
		const board = trim(fields[0]) as LeaderboardBoard;
		if (!LEADERBOARD_BOARDS.includes(board)) return undefined;
		const score = parseCount(trim(fields[1]));
		const floor = parseCount(trim(fields[2]));
		if (score === undefined || floor === undefined) return undefined;
		const entry = entryOfRun({ score, floor, at: 0, runId: RECORDS_FAKE_RUN_ID });
		if (entry === undefined) doc.endless[board] = undefined;
		else doc.endless[board] = entry;
	}
	return { loaded: true, doc };
}
