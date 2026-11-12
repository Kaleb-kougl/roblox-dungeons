/**
 * The Codex document (claude/codex-plan.md "Codex data (server)", CX2): one DataStore value per player
 * (`KV_Codex_v1`, CodexService), its codec, the merges, the claims and views that change it, and the one-time seed
 * from the onboarding doc's first sightings. Pure: decoding never throws, so a garbage or old-shaped value reads as an
 * empty Codex.
 *
 * Stored as `{ v: 1, seeded?: true, e: { [entryId]: [tier, day, floor] }, unread?: string[] }`:
 *   tier   1 seen, 2 found (CodexTier; clamped into 1..2)
 *   day    whole UTC days since the unix epoch (codexDay) of the first time the entry was FOUND (0 while seen, and for
 *          a fake / unknown day)
 *   floor  the floor it was first found on, 0..CODEX.floorMax (0 while seen / unknown)
 *   unread entry ids whose tier rose since the player last looked (the NEW dots); only ids in `e`, sorted
 * Ids outside the catalog decode away (an entry removed from the game drops out of the session and the display), but
 * the store transform (mergeStoredCodex) writes well-formed unknown entries back untouched, so a server running an
 * older catalog never deletes what a newer one added. `seeded` marks a doc that took the
 * one-time seed (seedFromSightings), stored only when true.
 *
 * Merges are per entry: the higher tier wins; two founds keep the earlier day with its floor (a tie on the day keeps
 * the lower floor); `unread` is a union. Every merge walks ids in sorted order and is commutative, associative and
 * idempotent, so the order servers write in never matters.
 */
import type { DocCodec } from "shared/settings";
import {
	CODEX_CATALOG,
	CODEX_ID_CATEGORY,
	CODEX_ID_SEPARATOR,
	codexEnemyId,
	codexEntry,
	isCodexId,
	isCodexIdShape,
	type CodexTab,
} from "./catalog";
import { CODEX, CODEX_DOC_VERSION } from "./config";

/** An entry's tier: NONE (absent from the doc), SEEN, FOUND. */
export const CodexTier = { NONE: 0, SEEN: 1, FOUND: 2 } as const;
export type CodexTierId = (typeof CodexTier)[keyof typeof CodexTier];

/** One entry's state: `[tier, day, floor]` (see the module comment). */
export type CodexMark = [tier: number, day: number, floor: number];

/** The document, in memory and as stored. */
export interface CodexDoc {
	v: typeof CODEX_DOC_VERSION;
	/** True once the one-time seed from the onboarding sightings ran (absent: seed on the next join). Never false. */
	seeded?: true;
	/** Entry id -> mark. */
	e: Map<string, CodexMark>;
	/** Ids with a NEW dot (absent = none), sorted. */
	unread?: string[];
}

/** One claim (the client's `codexClaim` item): the entry reached `tier` on `floor` (the server stamps the day). */
export interface CodexClaim {
	readonly id: string;
	readonly tier: number;
	readonly floor: number;
}

function isFiniteNumber(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
}

/** A tier, day and floor -> a normalized mark (tier clamped into SEEN..FOUND; a seen mark has day 0 and floor 0). */
function markOf(tier: number, day: unknown, floor: unknown): CodexMark {
	const t = math.clamp(math.floor(tier), CodexTier.SEEN, CodexTier.FOUND);
	if (t === CodexTier.SEEN) return [CodexTier.SEEN, 0, 0];
	const d = isFiniteNumber(day) && day >= 0 ? math.floor(day) : 0;
	const f = isFiniteNumber(floor) ? math.clamp(math.floor(floor), 0, CODEX.floorMax) : 0;
	return [CodexTier.FOUND, d, f];
}

/** A stored mark -> mark (undefined when it is not a table or its tier is not a number). Never throws. */
export function decodeCodexMark(raw: unknown): CodexMark | undefined {
	if (!typeIs(raw, "table")) return undefined;
	const r = raw as unknown[];
	const tier = r[0];
	if (!isFiniteNumber(tier)) return undefined;
	return markOf(tier, r[1], r[2]);
}

function copyMark(m: Readonly<CodexMark>): CodexMark {
	return [m[0], m[1], m[2]];
}

function sameMark(a: Readonly<CodexMark> | undefined, b: Readonly<CodexMark> | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Two marks of one entry merged: the higher tier wins; two founds keep the earlier day with its floor (a tie on the
 * day keeps the lower floor). Commutative, associative, idempotent. A new mark; undefined when both are.
 */
export function mergeCodexMarks(
	a: Readonly<CodexMark> | undefined,
	b: Readonly<CodexMark> | undefined,
): CodexMark | undefined {
	if (a === undefined) return b === undefined ? undefined : copyMark(b);
	if (b === undefined) return copyMark(a);
	if (a[0] !== b[0]) return copyMark(a[0] > b[0] ? a : b);
	if (a[1] !== b[1]) return copyMark(a[1] < b[1] ? a : b);
	return copyMark(a[2] <= b[2] ? a : b);
}

function sortedKeys<V>(m: ReadonlyMap<string, V>): string[] {
	const out: string[] = [];
	for (const [k] of m) out.push(k);
	out.sort();
	return out;
}

/** The distinct strings of `ids`, sorted. */
function sortedUnique(ids: ReadonlyArray<string>): string[] {
	const set = new Set<string>();
	for (const id of ids) set.add(id);
	const out: string[] = [];
	for (const id of set) out.push(id);
	out.sort();
	return out;
}

/** `unread` limited to ids with a mark, sorted and distinct; undefined when none is left. */
function unreadOf(ids: ReadonlyArray<string> | undefined, e: ReadonlyMap<string, CodexMark>): string[] | undefined {
	if (ids === undefined) return undefined;
	const keep: string[] = [];
	for (const id of ids) if (e.has(id)) keep.push(id);
	const out = sortedUnique(keep);
	return out.size() > 0 ? out : undefined;
}

export function emptyCodexDoc(): CodexDoc {
	return { v: CODEX_DOC_VERSION, e: new Map() };
}

/** A stored `unread` list read at most this far (a valid one names each entry once). */
const UNREAD_SCAN_LIMIT = 2 * CODEX_CATALOG.size();

/**
 * A stored value -> document. Missing, a non-table or another doc version: the empty doc. Entries with an unknown id
 * or a bad mark are dropped one by one; tiers clamp into 1..2, floors into 0..CODEX.floorMax; `unread` keeps only
 * catalog ids that have a mark. Never throws.
 */
export function decodeCodexDoc(raw: unknown): CodexDoc {
	if (!typeIs(raw, "table")) return emptyCodexDoc();
	const doc = raw as { v?: unknown; seeded?: unknown; e?: unknown; unread?: unknown };
	if (doc.v !== CODEX_DOC_VERSION) return emptyCodexDoc();
	const out = emptyCodexDoc();
	if (typeIs(doc.e, "table")) {
		for (const [id, raw] of doc.e as Map<unknown, unknown>) {
			if (!isCodexId(id)) continue;
			const mark = decodeCodexMark(raw);
			if (mark !== undefined) out.e.set(id, mark);
		}
	}
	if (doc.seeded === true) out.seeded = true;
	if (typeIs(doc.unread, "table")) {
		const list = doc.unread as unknown[];
		const n = math.min(list.size(), UNREAD_SCAN_LIMIT);
		const ids: string[] = [];
		for (let i = 0; i < n; i++) {
			const id = list[i];
			if (isCodexId(id)) ids.push(id);
		}
		const unread = unreadOf(ids, out.e);
		if (unread !== undefined) out.unread = unread;
	}
	return out;
}

/** The value written to the DataStore: a normalized copy (as decodeCodexDoc would read it). */
export function encodeCodexDoc(doc: Readonly<CodexDoc>): CodexDoc {
	const out = emptyCodexDoc();
	for (const [id, mark] of doc.e) {
		if (!isCodexId(id)) continue;
		const m = decodeCodexMark(mark);
		if (m !== undefined) out.e.set(id, m);
	}
	if (doc.seeded === true) out.seeded = true;
	const unread = unreadOf(doc.unread, out.e);
	if (unread !== undefined) out.unread = unread;
	return out;
}

function sameList(a: ReadonlyArray<string> | undefined, b: ReadonlyArray<string> | undefined): boolean {
	const x = a ?? [];
	const y = b ?? [];
	if (x.size() !== y.size()) return false;
	for (let i = 0; i < x.size(); i++) if (x[i] !== y[i]) return false;
	return true;
}

export function sameCodexDoc(a: Readonly<CodexDoc>, b: Readonly<CodexDoc>): boolean {
	if ((a.seeded === true) !== (b.seeded === true)) return false;
	if (a.e.size() !== b.e.size()) return false;
	for (const [id, mark] of a.e) if (!sameMark(mark, b.e.get(id))) return false;
	return sameList(a.unread, b.unread);
}

/** The entry ids `doc` holds, sorted. */
export function codexIds(doc: Readonly<CodexDoc>): string[] {
	return sortedKeys(doc.e);
}

/** `id`'s tier in `doc` (CodexTier.NONE when absent). */
export function codexTier(doc: Readonly<CodexDoc> | undefined, id: string): CodexTierId {
	const mark = doc?.e.get(id);
	return mark === undefined ? CodexTier.NONE : (mark[0] as CodexTierId);
}

/** Found entries of `tab` (every tab when absent) in `doc`: the completion's numerator. */
export function codexFoundCount(doc: Readonly<CodexDoc> | undefined, tab?: CodexTab): number {
	if (doc === undefined) return 0;
	let n = 0;
	for (const [id, mark] of doc.e) {
		if (mark[0] !== CodexTier.FOUND) continue;
		if (tab === undefined || codexEntry(id)?.tab === tab) n++;
	}
	return n;
}

/** The `day` stamp of unix time `unixSeconds`: whole UTC days since the unix epoch. */
export function codexDay(unixSeconds: number): number {
	return math.floor(unixSeconds / CODEX.secondsPerDay);
}

/** Two documents merged (per entry mergeCodexMarks; `unread` the union; `seeded` when either is). A new doc. */
export function mergeCodex(a: Readonly<CodexDoc>, b: Readonly<CodexDoc>): CodexDoc {
	const out = emptyCodexDoc();
	const ids = new Map<string, true>();
	for (const [id] of a.e) ids.set(id, true);
	for (const [id] of b.e) ids.set(id, true);
	for (const id of sortedKeys(ids)) {
		const mark = mergeCodexMarks(a.e.get(id), b.e.get(id));
		if (mark !== undefined) out.e.set(id, mark);
	}
	if (a.seeded === true || b.seeded === true) out.seeded = true;
	const all: string[] = [];
	for (const id of a.unread ?? []) all.push(id);
	for (const id of b.unread ?? []) all.push(id);
	const unread = unreadOf(all, out.e);
	if (unread !== undefined) out.unread = unread;
	return out;
}

function copyDoc(doc: Readonly<CodexDoc>): CodexDoc {
	const out = emptyCodexDoc();
	for (const [id, mark] of doc.e) out.e.set(id, copyMark(mark));
	if (doc.seeded === true) out.seeded = true;
	if (doc.unread !== undefined) out.unread = [...doc.unread];
	return out;
}

/**
 * Claims applied to `doc` on day `day` (codexDay of the server's clock): an entry only ever rises (a claim at or below
 * its tier changes nothing); a new found gets `day` and its claim's floor (clamped); a rise adds the id to `unread`
 * unless `markUnread` is false. Claims with an unknown id or a non-number tier are skipped; tiers clamp into 1..2.
 * Several claims for one entry act as their merge (the claims' order never matters). Returns `doc` itself when nothing
 * rose (PlayerDocCache.set then sees no change), else a new doc.
 */
export function applyClaims(
	doc: CodexDoc,
	claims: ReadonlyArray<CodexClaim>,
	day: number,
	markUnread = true,
): CodexDoc {
	const best = new Map<string, CodexMark>();
	for (const c of claims) {
		if (!isCodexId(c.id) || !isFiniteNumber(c.tier)) continue;
		const merged = mergeCodexMarks(best.get(c.id), markOf(c.tier, day, c.floor));
		if (merged !== undefined) best.set(c.id, merged);
	}
	let out: CodexDoc | undefined;
	const rose: string[] = [];
	for (const id of sortedKeys(best)) {
		const mark = best.get(id) as CodexMark;
		const cur = doc.e.get(id);
		if (cur !== undefined && cur[0] >= mark[0]) continue;
		if (out === undefined) out = copyDoc(doc);
		out.e.set(id, mark);
		rose.push(id);
	}
	if (out === undefined) return doc;
	if (markUnread) {
		const all = [...(out.unread ?? [])];
		for (const id of rose) all.push(id);
		const unread = unreadOf(all, out.e);
		if (unread !== undefined) out.unread = unread;
	}
	return out;
}

/** `doc` with `ids` removed from `unread` (the player looked at them). Returns `doc` itself when none was unread. */
export function markViewed(doc: CodexDoc, ids: ReadonlyArray<string>): CodexDoc {
	if (doc.unread === undefined) return doc;
	const drop = new Set<string>();
	for (const id of ids) drop.add(id);
	const keep: string[] = [];
	for (const id of doc.unread) if (!drop.has(id)) keep.push(id);
	if (keep.size() === doc.unread.size()) return doc;
	const out = copyDoc(doc);
	out.unread = keep.size() > 0 ? keep : undefined;
	return out;
}

/** Prefix of an affix's onboarding sighting id (`affix.hulking`). */
const AFFIX_SIGHTING_PREFIX = "affix.";

/**
 * The one-time seed (CXD5, R5): the onboarding doc's `seen` sightings as tier-1 claims (floor 0), sorted by id and
 * distinct. Archetype sightings map through codexEnemyId (`imp` -> `enemy:imp`, the Goldling `golden` ->
 * `enemy:golden`); `affix.<id>` -> `affix:<id>`; anything else (`pellet.power`, unknown or non-string values) is
 * dropped.
 */
export function seedFromSightings(seen: ReadonlyArray<unknown>): CodexClaim[] {
	const ids: string[] = [];
	for (const s of seen) {
		if (!typeIs(s, "string")) continue;
		const isAffix = s.sub(1, AFFIX_SIGHTING_PREFIX.size()) === AFFIX_SIGHTING_PREFIX;
		const id = isAffix
			? `${CODEX_ID_CATEGORY.affix}${CODEX_ID_SEPARATOR}${s.sub(AFFIX_SIGHTING_PREFIX.size() + 1)}`
			: codexEnemyId(s);
		if (id !== undefined && isCodexId(id)) ids.push(id);
	}
	const out: CodexClaim[] = [];
	for (const id of sortedUnique(ids)) out.push({ id, tier: CodexTier.SEEN, floor: 0 });
	return out;
}

/**
 * A `codexClaim` payload (untrusted) -> claims. Undefined (refuse the call) for a non-table or more than
 * CODEX.claimMaxItems items; items that are not `{ id, tier, floor }` with a catalog id and a tier of exactly 1 or 2
 * are skipped; a non-number floor reads as 0, others clamp into 0..CODEX.floorMax.
 */
export function decodeCodexClaims(raw: unknown): CodexClaim[] | undefined {
	if (!typeIs(raw, "table")) return undefined;
	const list = raw as unknown[];
	const n = list.size();
	if (n > CODEX.claimMaxItems) return undefined;
	const out: CodexClaim[] = [];
	for (let i = 0; i < n; i++) {
		const item = list[i];
		if (!typeIs(item, "table")) continue;
		const c = item as { id?: unknown; tier?: unknown; floor?: unknown };
		if (!isCodexId(c.id)) continue;
		if (c.tier !== CodexTier.SEEN && c.tier !== CodexTier.FOUND) continue;
		const floor = isFiniteNumber(c.floor) ? math.clamp(math.floor(c.floor), 0, CODEX.floorMax) : 0;
		out.push({ id: c.id, tier: c.tier, floor });
	}
	return out;
}

/**
 * A `codexViewed` payload (untrusted) -> the catalog ids it names, sorted and distinct. Undefined (refuse the call) for
 * a non-table or more than CODEX.viewedMaxIds items.
 */
export function decodeCodexViewed(raw: unknown): string[] | undefined {
	if (!typeIs(raw, "table")) return undefined;
	const list = raw as unknown[];
	const n = list.size();
	if (n > CODEX.viewedMaxIds) return undefined;
	const ids: string[] = [];
	for (let i = 0; i < n; i++) {
		const id = list[i];
		if (isCodexId(id)) ids.push(id);
	}
	return sortedUnique(ids);
}

/** A stored doc's entries and unread ids this catalog does not know (a newer server's), as stored. */
interface ForeignPart {
	/** Id -> the stored mark, untouched. */
	readonly e: Map<string, unknown>;
	/** Unread ids among `e`'s, sorted and distinct. */
	readonly unread: string[];
}

/**
 * The well-formed entries of a stored value whose ids this catalog does not have: an id shaped like a codex id
 * (isCodexIdShape) with a valid mark (decodeCodexMark reads it), kept as stored; and the stored unread ids among them.
 * Empty for a value that is not this doc version.
 */
function foreignPartOf(stored: unknown): ForeignPart {
	const out: ForeignPart = { e: new Map(), unread: [] };
	if (!typeIs(stored, "table")) return out;
	const doc = stored as { v?: unknown; e?: unknown; unread?: unknown };
	if (doc.v !== CODEX_DOC_VERSION) return out;
	if (typeIs(doc.e, "table")) {
		for (const [id, raw] of doc.e as Map<unknown, unknown>) {
			if (isCodexId(id) || !isCodexIdShape(id)) continue;
			if (decodeCodexMark(raw) !== undefined) out.e.set(id, raw);
		}
	}
	if (out.e.size() > 0 && typeIs(doc.unread, "table")) {
		const list = doc.unread as unknown[];
		const n = math.min(list.size(), UNREAD_SCAN_LIMIT + 2 * out.e.size());
		const ids: string[] = [];
		for (let i = 0; i < n; i++) {
			const id = list[i];
			if (typeIs(id, "string") && out.e.has(id)) ids.push(id);
		}
		for (const id of sortedUnique(ids)) out.unread.push(id);
	}
	return out;
}

/**
 * UpdateAsync's transform for a codex write: the stored value merged with `incoming` (the session's doc). Tiers,
 * found days and `seeded` merge as in mergeCodex. `unread` is NOT a plain union here (that would bring back the dots
 * the session cleared): it is the incoming session's list plus the stored unread ids whose stored tier is above the
 * incoming one (a rise another server wrote that this session never saw). Undefined (cancel the write) when the stored
 * value is a NEWER doc version or the merge changes nothing. Junk stored values read as empty and are replaced.
 *
 * Rollout-safe: stored entries whose ids this server's catalog does not know (a newer server added them) pass through
 * untouched when well-formed (an id shaped `<category>:<key>`, a valid mark), with their unread ids; only the session
 * and display docs drop them (decodeCodexDoc). A malformed unknown entry is dropped as before.
 */
export function mergeStoredCodex(stored: unknown, incoming: Readonly<CodexDoc>): CodexDoc | undefined {
	if (typeIs(stored, "table")) {
		const v = (stored as { v?: unknown }).v;
		if (isFiniteNumber(v) && v > CODEX_DOC_VERSION) return undefined;
	}
	const old = decodeCodexDoc(stored);
	const inc = encodeCodexDoc(incoming);
	const merged = mergeCodex(old, inc);
	const unread = [...(inc.unread ?? [])];
	for (const id of old.unread ?? []) if (codexTier(old, id) > codexTier(inc, id)) unread.push(id);
	merged.unread = unreadOf(unread, merged.e);
	const storedValid = typeIs(stored, "table") && (stored as { v?: unknown }).v === CODEX_DOC_VERSION;
	const nothingToKeep = merged.e.size() === 0 && merged.seeded !== true;
	if (sameCodexDoc(old, merged) && (storedValid || nothingToKeep)) return undefined;
	const out = encodeCodexDoc(merged);
	const foreign = foreignPartOf(stored);
	if (foreign.e.size() === 0) return out;
	// Stored as they were: the value is only ever read back through decodeCodexDoc / foreignPartOf.
	for (const [id, raw] of foreign.e) out.e.set(id, raw as CodexMark);
	if (foreign.unread.size() > 0) {
		const all = [...(out.unread ?? [])];
		for (const id of foreign.unread) all.push(id);
		out.unread = sortedUnique(all);
	}
	return out;
}

/** PlayerDocCache codec (shared/settings store.ts). */
export const CODEX_CODEC: DocCodec<CodexDoc> = {
	decode(raw) {
		return decodeCodexDoc(raw);
	},
	encode(doc) {
		return encodeCodexDoc(doc);
	},
	equals(a, b) {
		return sameCodexDoc(a, b);
	},
	empty() {
		return emptyCodexDoc();
	},
};
