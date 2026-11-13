/**
 * The Codex on the wire (claude/codex-plan.md "Codex data (server)", CX3): the `codexStatus` payload CodexService sends
 * and the client reads back into a CodexDoc, plus the pure rules of the three client -> server remotes (claims,
 * views, the one-time seed), so CodexService stays a thin shell around PlayerDocCache. Pure; never throws.
 *
 * `codexStatus` carries `entries` as a list of `{ id, tier, day, floor }` (a Map is no remote-friendly shape for
 * Flamework's guard) sorted by id, `unread` sorted, and `seeded` (only when true: the seed from the onboarding
 * sightings ran). `loaded` false (a failed join load, or the Studio fake `unknown`) carries nothing else.
 */
import { CODEX_DOC_VERSION } from "./config";
import {
	applyClaims,
	codexTier,
	decodeCodexClaims,
	decodeCodexDoc,
	decodeCodexViewed,
	emptyCodexDoc,
	markViewed,
	mergeCodex,
	seedFromSightings,
	type CodexDoc,
	type CodexMark,
} from "./doc";

/** One entry of `codexStatus`: its id and mark (`tier` CodexTier SEEN / FOUND, `day` / `floor` 0 while seen). */
export interface CodexStatusEntry {
	id: string;
	tier: number;
	day: number;
	floor: number;
}

/** The `codexStatus` payload (server -> client). */
export interface CodexStatus {
	/** False when the join load failed (or the Studio fake says `unknown`): the Codex is unavailable this session. */
	loaded: boolean;
	/** Every entry the player has (absent when none, or not loaded), sorted by id. */
	entries?: CodexStatusEntry[];
	/** Ids with a NEW dot (absent when none), sorted. */
	unread?: string[];
	/** True once the one-time seed from the onboarding sightings ran (absent otherwise). */
	seeded?: boolean;
}

/** The status of `doc` (`loaded` false, or no doc: `{ loaded: false }` alone). */
export function codexStatusOf(doc: Readonly<CodexDoc> | undefined, loaded: boolean): CodexStatus {
	if (!loaded || doc === undefined) return { loaded: false };
	const ids: string[] = [];
	for (const [id] of doc.e) ids.push(id);
	ids.sort();
	const status: CodexStatus = { loaded: true };
	if (ids.size() > 0) {
		const entries: CodexStatusEntry[] = [];
		for (const id of ids) {
			const m = doc.e.get(id) as CodexMark;
			entries.push({ id, tier: m[0], day: m[1], floor: m[2] });
		}
		status.entries = entries;
	}
	if (doc.unread !== undefined && doc.unread.size() > 0) status.unread = [...doc.unread];
	if (doc.seeded === true) status.seeded = true;
	return status;
}

/**
 * A received `codexStatus` -> the document it describes (the client's copy), or undefined when not loaded. Decoded
 * like a stored doc (decodeCodexDoc): unknown ids and bad marks drop out, so a status from a newer server never throws.
 */
export function codexDocOfStatus(status: unknown): CodexDoc | undefined {
	if (!typeIs(status, "table")) return undefined;
	const s = status as { loaded?: unknown; entries?: unknown; unread?: unknown; seeded?: unknown };
	if (s.loaded !== true) return undefined;
	const e = new Map<string, unknown>();
	if (typeIs(s.entries, "table")) {
		for (const item of s.entries as unknown[]) {
			if (!typeIs(item, "table")) continue;
			const x = item as { id?: unknown; tier?: unknown; day?: unknown; floor?: unknown };
			if (typeIs(x.id, "string")) e.set(x.id, [x.tier, x.day, x.floor]);
		}
	}
	return decodeCodexDoc({ v: CODEX_DOC_VERSION, seeded: s.seeded, e, unread: s.unread });
}

/** Why a codex remote changed nothing. */
export type CodexRefusal =
	/** The join load (and seed) has not ended, or it failed: never write over an unknown stored doc. */
	| "notReady"
	/** Over CODEX.claimRate. */
	| "rateLimited"
	/** Not a valid payload (decodeCodexClaims / decodeCodexViewed refused it whole). */
	| "badPayload";

/** What one codex remote does to the player's session doc. */
export type CodexUpdate =
	| {
			readonly refused?: undefined;
			/** The doc to keep (the input itself when nothing changed). */
			readonly doc: CodexDoc;
			readonly changed: boolean;
	  }
	| { readonly refused: CodexRefusal };

/**
 * A `codexClaim(raw)` against the player's session doc (`doc` undefined: not ready, or the load failed). Checked in
 * order: not ready, over the rate, a bad payload; then applyClaims on day `day` (the server's codexDay), marking rises
 * unread. Idempotent: a claim at or below an entry's tier changes nothing.
 */
export function codexClaimUpdate(
	doc: CodexDoc | undefined,
	raw: unknown,
	day: number,
	withinRate: boolean,
): CodexUpdate {
	if (doc === undefined) return { refused: "notReady" };
	if (!withinRate) return { refused: "rateLimited" };
	const claims = decodeCodexClaims(raw);
	if (claims === undefined) return { refused: "badPayload" };
	const updated = applyClaims(doc, claims, day);
	return { doc: updated, changed: updated !== doc };
}

/** A `codexViewed(raw)` against the player's session doc: as codexClaimUpdate, then markViewed. */
export function codexViewedUpdate(doc: CodexDoc | undefined, raw: unknown, withinRate: boolean): CodexUpdate {
	if (doc === undefined) return { refused: "notReady" };
	if (!withinRate) return { refused: "rateLimited" };
	const ids = decodeCodexViewed(raw);
	if (ids === undefined) return { refused: "badPayload" };
	const updated = markViewed(doc, ids);
	return { doc: updated, changed: updated !== doc };
}

/**
 * The one-time seed (CXD5, lead decision): the onboarding `seen` list applied as tier-1 claims WITHOUT NEW dots
 * (seedFromSightings, applyClaims markUnread false), and the doc marked `seeded`. Always a new doc (so the cache sees
 * the marker change even when no sighting was new); entries already in the doc only ever rise.
 */
export function seedCodexDoc(doc: Readonly<CodexDoc>, seen: ReadonlyArray<unknown>, day: number): CodexDoc {
	const base = emptyCodexDoc();
	for (const [id, m] of doc.e) base.e.set(id, [m[0], m[1], m[2]]);
	if (doc.unread !== undefined) base.unread = [...doc.unread];
	const out = applyClaims(base, seedFromSightings(seen), day, false);
	out.seeded = true;
	return out;
}

/**
 * The client's copy after a `codexStatus` (`server`, codexDocOfStatus) arrived over its current copy `copy` (undefined
 * before the first): entries merged (mergeCodex: tiers only rise, so this session's claims the server has not stored
 * yet stay risen); `unread` is the SERVER's list (dots cleared elsewhere stay cleared; never a union with the local
 * copy) plus the local dots of entries the copy holds above the server's tier (this session's rises on their way),
 * minus `pendingViewed` (CodexOutbox.pendingViews: ids this session viewed whose `codexViewed` has not gone out yet).
 * A new doc.
 */
export function codexReceivedDoc(
	copy: Readonly<CodexDoc> | undefined,
	server: Readonly<CodexDoc>,
	pendingViewed: ReadonlyArray<string>,
): CodexDoc {
	const out = mergeCodex(copy ?? emptyCodexDoc(), server);
	const drop = new Set<string>();
	for (const id of pendingViewed) drop.add(id);
	const keep = new Set<string>();
	for (const id of server.unread ?? []) if (!drop.has(id)) keep.add(id);
	if (copy !== undefined) {
		for (const id of copy.unread ?? []) {
			if (!drop.has(id) && codexTier(copy, id) > codexTier(server, id)) keep.add(id);
		}
	}
	const unread: string[] = [];
	for (const id of keep) if (out.e.has(id)) unread.push(id);
	unread.sort();
	out.unread = unread.size() > 0 ? unread : undefined;
	return out;
}
