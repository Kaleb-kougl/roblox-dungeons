/**
 * The Studio Codex fake (CODEX_FAKE_ATTRIBUTE, `KV_FakeCodex`): a Workspace string -> what CodexService serves
 * instead of the DataStore. Pure.
 *
 *   "all"                          every catalog entry found (day 0 / floor 0: no found line details)
 *   "seen"                         every catalog entry seen
 *   "none"                         loaded, nothing seen or found
 *   "unknown"                      not loaded (the Codex button is greyed)
 *   "boon:volatile:2,enemy:imp:1"  those entries at those tiers (1 seen, 2 found), each unread (a NEW dot); spaces
 *                                  around parts are ignored, an entry given twice keeps the higher tier
 *
 * Keywords are compared lower-cased; entry ids are case-sensitive (`boon:swiftStrikes`). Every fake doc is `seeded`
 * (no seed runs over it). Anything else (empty, a bad part, an unknown id, a tier other than 1 / 2) is no fake:
 * undefined (the service logs it and serves the real doc).
 *
 * @module
 */
import { CODEX_CATALOG, isCodexId } from "./catalog";
import { CODEX_FAKE_KEYWORDS } from "./config";
import { CodexTier, applyClaims, emptyCodexDoc, type CodexClaim, type CodexDoc } from "./doc";

/**
 * What a valid `KV_FakeCodex` attribute value stands for: the document CodexService serves in Studio in place of the
 * stored one, and whether the Codex counts as loaded.
 */
export interface FakeCodex {
	/** False for `unknown`. */
	readonly loaded: boolean;
	/** The fake document (empty for `unknown` / `none`). */
	readonly doc: CodexDoc;
}

function trim(s: string): string {
	const [inner] = string.match(s, "^%s*(.-)%s*$");
	return typeIs(inner, "string") ? inner : s;
}

function everyEntry(tier: number): CodexDoc {
	const doc = emptyCodexDoc();
	doc.seeded = true;
	for (const e of CODEX_CATALOG) doc.e.set(e.id, [tier, 0, 0]);
	return doc;
}

/**
 * The fake Codex a Workspace attribute value describes (formats in the file comment), or undefined when the value is
 * not a string, is empty, or has any bad part (an unknown id, a tier other than 1 or 2): one bad part rejects the whole
 * value, never a partial fake. Called by CodexService in Studio only. Every loaded fake is marked `seeded`; listed
 * entries carry a NEW dot, the `all` / `seen` keywords none.
 */
export function parseFakeCodex(value: unknown): FakeCodex | undefined {
	if (!typeIs(value, "string")) return undefined;
	const text = trim(value);
	if (text === "") return undefined;
	const keyword = text.lower();
	if (keyword === CODEX_FAKE_KEYWORDS.unknown) return { loaded: false, doc: emptyCodexDoc() };
	if (keyword === CODEX_FAKE_KEYWORDS.none) {
		const doc = emptyCodexDoc();
		doc.seeded = true;
		return { loaded: true, doc };
	}
	if (keyword === CODEX_FAKE_KEYWORDS.all) return { loaded: true, doc: everyEntry(CodexTier.FOUND) };
	if (keyword === CODEX_FAKE_KEYWORDS.seen) return { loaded: true, doc: everyEntry(CodexTier.SEEN) };
	const claims: CodexClaim[] = [];
	for (const part of text.split(",")) {
		const [id, digits] = string.match(trim(part), "^(.+):(%d+)$");
		if (!typeIs(id, "string") || !typeIs(digits, "string")) return undefined;
		const entryId = trim(id);
		const tier = tonumber(digits);
		if (!isCodexId(entryId) || (tier !== CodexTier.SEEN && tier !== CodexTier.FOUND)) return undefined;
		claims.push({ id: entryId, tier, floor: 0 });
	}
	const base = emptyCodexDoc();
	base.seeded = true;
	return { loaded: true, doc: applyClaims(base, claims, 0) };
}
