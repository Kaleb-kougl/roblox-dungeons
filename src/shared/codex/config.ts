/** Codex tunables (claude/codex-plan.md "Codex data (server)", CX2). Data only. */
import { SETTINGS_RETRY, type RetryPolicy } from "shared/settings";

/**
 * The stored document's version. A stored doc of another version reads as empty; a merge write over a NEWER version
 * is cancelled (mergeStoredCodex), so an old server never clobbers a newer server's doc.
 */
export const CODEX_DOC_VERSION = 1;

export interface CodexTunables {
	/** DataStore holding one CodexDoc per player, keyed by shared/settings `playerDataKey(userId)`. */
	readonly dataStore: string;
	/** Per-player budget for each of `codexClaim`, `codexViewed` and `requestCodex` (CodexService, one limiter each). */
	readonly claimRate: { readonly count: number; readonly windowSeconds: number };
	/** Most items one `codexClaim` call may carry (a longer call is refused whole: decodeCodexClaims). */
	readonly claimMaxItems: number;
	/** Most ids one `codexViewed` call may carry (a longer call is refused whole: decodeCodexViewed). */
	readonly viewedMaxIds: number;
	/** Dirty codex docs are written every this many seconds (besides the leave and BindToClose writes). */
	readonly autosaveSeconds: number;
	/** Codex toasts and decorated chips per floor (CXD8); boss / duo / evolution always show. */
	readonly toastsPerFloor: number;
	/** Tiles of this run's found entries on the run-over line before `+N`. */
	readonly recapIcons: number;
	/** Studio writes the DataStore (off: claims only update the session cache, like the records). */
	readonly writeFromStudio: boolean;
	/** A found entry's floor is clamped to 0..floorMax (0 = unknown / seen). */
	readonly floorMax: number;
	/** `day` stamps are whole UTC days since the unix epoch (codexDay): unix seconds / this. */
	readonly secondsPerDay: number;
	/**
	 * The one-time seed waits at most this long for OnboardingService's join load (its `seen` list); past it the seed
	 * counts as failed for the session (`seeded` stays unset, retried on the next join) and codexStatus goes out.
	 */
	readonly seedWaitSeconds: number;
	/** How often the seed re-checks OnboardingService's join load while waiting. */
	readonly seedPollSeconds: number;
	/** BindToClose: give up waiting for the last saves after this many seconds (Roblox allows about 30). */
	readonly shutdownSaveSeconds: number;
	/** BindToClose: how often it re-checks the pending saves. */
	readonly shutdownPollSeconds: number;
}

export const CODEX: CodexTunables = table.freeze({
	dataStore: "KV_Codex_v1",
	claimRate: table.freeze({ count: 10, windowSeconds: 10 }),
	claimMaxItems: 16,
	viewedMaxIds: 64,
	autosaveSeconds: 120,
	toastsPerFloor: 2,
	recapIcons: 5,
	writeFromStudio: false,
	floorMax: 999,
	secondsPerDay: 86400,
	seedWaitSeconds: 30,
	seedPollSeconds: 0.25,
	shutdownSaveSeconds: 25,
	shutdownPollSeconds: 0.1,
});

/**
 * The client's send pacing (CodexOutbox, CX6): claims and views are batched and sent at most every `flushSeconds`
 * (sooner when hurried: run over, the Codex screen closing), and each remote at most `callsPerWindow` calls per
 * `windowSeconds`: well under the server's CODEX.claimRate (10 / 10 s per remote), whose over-limit calls are lost.
 */
export interface CodexOutboxTunables {
	readonly flushSeconds: number;
	readonly windowSeconds: number;
	readonly callsPerWindow: number;
}

export const CODEX_OUTBOX: CodexOutboxTunables = table.freeze({
	flushSeconds: 2,
	windowSeconds: 10,
	callsPerWindow: 5,
});

/** DataStore calls (load, merge writes): the settings policy (3 tries, waiting 1 s then 2 s), like the records. */
export const CODEX_RETRY: RetryPolicy = SETTINGS_RETRY;

/**
 * Studio-only Workspace attribute (String): a fake Codex for every player in this Studio session, replacing the loaded
 * doc (claims merge into it for the session; nothing is written). Ignored on live servers. Parsed by `parseFakeCodex`:
 *   "all"      every entry found
 *   "seen"     every entry seen
 *   "none"     loaded, nothing seen or found
 *   "unknown"  not loaded (the Codex button is greyed)
 *   "boon:volatile:2,enemy:imp:1"   those entries at those tiers (1 seen, 2 found), each with a NEW dot
 */
export const CODEX_FAKE_ATTRIBUTE = "KV_FakeCodex";

/** Keywords of CODEX_FAKE_ATTRIBUTE (compared lower-cased; entry ids are case-sensitive). */
export const CODEX_FAKE_KEYWORDS = table.freeze({ all: "all", none: "none", seen: "seen", unknown: "unknown" });
