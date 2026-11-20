import { createProducer, createSelector } from "@rbxts/reflex";
import {
	applyClaims,
	codexProgressOf,
	codexReceivedDoc,
	codexUnreadCount,
	markViewed,
	type CodexClaim,
	type CodexDoc,
	type CodexProgress,
} from "shared/codex";
import type { CodexRunSummary } from "shared/view/codex";

/**
 * Client-local Reflex slice for the Codex (claude/codex-plan.md CX6). CodexController fills it: every `codexStatus`
 * (codexReceive), this session's claims and views applied locally (the server sends no echo), and the run's frozen
 * summary. Read by the main menu's Codex button (badge, greyed when unavailable) and the Codex screen (CX7), and the
 * run-over panel's codex row (CX9). Dispatched rarely (a status, a frame with rises, a screen close), never per frame.
 *
 * `doc` is the local copy (immutable: every change is a new doc, shared/codex applyClaims / markViewed / mergeCodex);
 * `version` counts its changes (a cheap dependency for memoized views).
 */
export type CodexLoadStatus =
	/** No `codexStatus` yet (the server sends it once its join load and seed end, maybe ~30 s after join). */
	| "pending"
	/** A `loaded: true` status arrived: `doc` is this account's Codex. */
	| "loaded"
	/** The first status said `loaded: false`: the Codex is unavailable this session (the button greys). */
	| "unavailable";

/**
 * The `codex` slice's state: whether this account's Codex loaded, the local copy of its doc, a change counter and the
 * last run's frozen summary. CodexController is the only writer (the server's `codexStatus`, this session's claims and
 * views, the run summary); nothing resets it within a session.
 */
export interface CodexState {
	readonly status: CodexLoadStatus;
	/** The local copy of the doc (entries, NEW dots, the seed marker); undefined unless loaded. */
	readonly doc: CodexDoc | undefined;
	/** Bumped on every change of `doc`. */
	readonly version: number;
	/**
	 * The last run's Codex summary (shared/view/codex CodexRunSummary), frozen when the run was over or left; undefined
	 * during a run and before the first one ended. The run-over panel's row (CX9) reads it.
	 */
	readonly runSummary: CodexRunSummary | undefined;
}

const initialState: CodexState = {
	status: "pending",
	doc: undefined,
	version: 0,
	runSummary: undefined,
};

/**
 * The Codex slice (see the comment on `CodexLoadStatus` above). It starts `pending` with no doc; a received status
 * loads or marks it unavailable, claims and views edit the local copy (each real change bumps `version`), and
 * `setCodexRunSummary` stores or clears the run-over row's summary.
 */
export const codexSlice = createProducer(initialState, {
	/**
	 * A `codexStatus` (shared/codex codexDocOfStatus): a doc loads (shared/codex codexReceivedDoc over the local copy:
	 * tiers only rise; the NEW dots are the server's minus `pendingViewed`, CodexOutbox.pendingViews, plus this
	 * session's rises the server has not stored yet), undefined is `loaded: false`: unavailable unless a doc already
	 * loaded (ignored).
	 */
	codexReceive: (state, doc: CodexDoc | undefined, pendingViewed: ReadonlyArray<string>): CodexState => {
		if (doc === undefined)
			return state.status === "loaded" ? state : { ...state, status: "unavailable", doc: undefined };
		const merged = codexReceivedDoc(state.doc, doc, pendingViewed);
		return { ...state, status: "loaded", doc: merged, version: state.version + 1 };
	},
	/** This session's claims on the local copy (applyClaims on the client's `day`, marking rises unread). */
	codexApplyClaims: (state, claims: ReadonlyArray<CodexClaim>, day: number): CodexState => {
		if (state.doc === undefined || claims.size() === 0) return state;
		const doc = applyClaims(state.doc, claims, day);
		return doc === state.doc ? state : { ...state, doc, version: state.version + 1 };
	},
	/** Entries the player looked at (the Codex screen): their NEW dots clear on the local copy. */
	codexMarkViewed: (state, ids: ReadonlyArray<string>): CodexState => {
		if (state.doc === undefined || ids.size() === 0) return state;
		const doc = markViewed(state.doc, ids);
		return doc === state.doc ? state : { ...state, doc, version: state.version + 1 };
	},
	setCodexRunSummary: (state, runSummary: CodexRunSummary | undefined): CodexState =>
		state.runSummary === runSummary ? state : { ...state, runSummary },
});

/**
 * Where this session's Codex load stands: `pending` until the server's first status, then `loaded` or `unavailable`.
 * The main menu greys its Codex button on `unavailable`; the Codex screen reads it beside the doc.
 */
export const selectCodexStatus = (state: { codex: CodexState }) => state.codex.status;
/**
 * The local copy of this account's Codex doc (entries with their tiers and NEW dots), undefined unless the status is
 * `loaded`. It is a new object on every change, so it can be compared by identity.
 */
export const selectCodexDoc = (state: { codex: CodexState }) => state.codex.doc;
/**
 * How many times the local doc changed this session (0 before the first load; a received status, applied claims and
 * viewed entries each add one). A cheap dependency for views memoized on the doc.
 */
export const selectCodexVersion = (state: { codex: CodexState }) => state.codex.version;
/**
 * The last run's Codex summary, frozen when the run was over or left; undefined during a run and before the first one
 * ended. The run-over panel's codex row draws from it.
 */
export const selectCodexRunSummary = (state: { codex: CodexState }) => state.codex.runSummary;
/** The menu badge: entries with a NEW dot (0 unless loaded). */
export const selectCodexNewCount = createSelector([selectCodexDoc] as const, (doc) => codexUnreadCount(doc));
/** Found / total overall and per tab (the screen's header and tabs; found 0 unless loaded). */
export const selectCodexProgress = createSelector(
	[selectCodexDoc] as const,
	(doc): CodexProgress => codexProgressOf(doc),
);
