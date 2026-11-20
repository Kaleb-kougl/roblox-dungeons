/**
 * Barrel for personal records (docs/NEW_BEST.md "Personal records (server)", NB1): the stored document `KV_Records_v1`
 * (best score and deepest floor per board, each with its run), its codec and max-merge, the one-time seed from the
 * leaderboard details, the eligibility policy, the status the client gets, the verdict's records result, the Studio
 * fake parser and their tunables; the optional daily activity (`daily`: attempt count, finished days, docs/DAILY.md
 * DS13) with its merges and the server's ledger. Plain TypeScript, headlessly tested; RecordsService wraps it.
 *
 * @module
 */
export * from "./config";
export * from "./daily";
export * from "./dailyLedger";
export * from "./doc";
export * from "./policy";
export * from "./fake";
