/**
 * Personal records tunables (docs/NEW_BEST.md "Personal records (server)", RecordsService). Data only.
 *
 * @module
 */
import { LEADERBOARD_READ_RETRY } from "shared/leaderboard";
import { SETTINGS_AUTOSAVE_SECONDS, SETTINGS_RETRY, type RetryPolicy } from "shared/settings";

/**
 * The stored document's version. A stored doc of another version reads as empty; a merge write over a NEWER version
 * is cancelled (mergeStoredRecords), so an old server never clobbers a newer server's doc.
 */
export const RECORDS_DOC_VERSION = 1;

/** DataStore holding one RecordsDoc per player, keyed by shared/settings `playerDataKey(userId)`. */
export const RECORDS_DATASTORE_NAME = "KV_Records_v1";

/** DataStore calls (load, merge writes): the settings policy (3 tries, waiting 1 s then 2 s). */
export const RECORDS_RETRY: RetryPolicy = SETTINGS_RETRY;

/** The one-time seed's reads of the leaderboard details (`LB_Details_v1`): the leaderboard's read policy. */
export const RECORDS_SEED_RETRY: RetryPolicy = LEADERBOARD_READ_RETRY;

/** Dirty records docs are also written every this many seconds (besides the write right after a verdict, leave, shutdown). */
export const RECORDS_AUTOSAVE_SECONDS = SETTINGS_AUTOSAVE_SECONDS;

/** Per-player budget for `requestRecords` (the onboarding request's budget). */
export const RECORDS_REQUEST_RATE = table.freeze({ count: 10, windowSeconds: 10 });

/**
 * Studio-only Workspace attribute (String): fake records for every player in this Studio session, e.g.
 * `"solo:48210:9,coop:0:0"` (`<board>:<best score>:<deepest floor>`, comma-separated; a board at 0:0 or left out has
 * no record), `"none"` (no records at all: a first record) or `"unknown"` (`loaded: false`: the client shows no
 * target). It replaces what the server sends, verdicts merge into it for the session, and nothing is written to the
 * DataStore. Ignored on live servers. Parsed by `parseFakeRecords`.
 */
export const RECORDS_FAKE_ATTRIBUTE = "KV_FakeRecords";

/** Keywords of RECORDS_FAKE_ATTRIBUTE. */
export const RECORDS_FAKE_KEYWORDS = table.freeze({ none: "none", unknown: "unknown" });

/** The runId stamped on a fake record (RECORDS_FAKE_ATTRIBUTE). */
export const RECORDS_FAKE_RUN_ID = "fake";

/**
 * DailyActivityLedger: attempt numbers remembered per player for runs started but not yet concluded (oldest dropped
 * past this). A run that never concludes accepted (abandoned unvalidated, rejected, the server lost it) leaves its
 * entry behind until a later start pushes it out, so the map stays small however long the player stays; a finish whose
 * entry was dropped falls back to the day's start count (the ledger's rule for a start it never saw).
 */
export const DAILY_LEDGER_OPEN_ATTEMPTS = 8;
