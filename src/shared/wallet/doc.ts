/**
 * The wallet document (docs/SILVER.md "Wallet (server)", SV2): one DataStore value per player (`KV_Wallet_v1`, key
 * `u_<UserId>`, WalletService), its codec and the read helpers. Pure: decoding never throws, so a garbage, missing or
 * old-shaped value reads as an empty wallet.
 *
 * Stored as `{ v: 1, earned, spent, own: { [itemId]: level }, eq?: { [slot]: itemId }, runs: string[], runDay?,
 * dailyDay?, bought?, receipts? }` plus any field a newer build added:
 *   earned / spent  non-negative integers; earned is Silver from PLAY only (grants); the balance is
 *                   earned + bought - spent (never stored, never below 0)
 *   bought          Silver bought with Robux (docs/SILVER_SHOP.md SHD9; absent = 0)
 *   receipts        the last SILVER_SHOP.receiptRing granted developer-product PurchaseIds, oldest first (SHD2: a
 *                   receipt whose id is in it is a duplicate)
 *   own             item id -> level owned (>= 1); a catalogue item is clamped to its levels, an id the catalogue does
 *                   not know (a newer server's item) is kept as stored, so a transaction never deletes it
 *   eq              slot -> item id (cosmetics, phase 2)
 *   runs            the last WALLET.runRing granted run ids, oldest first (a grant of an id in it is a duplicate)
 *   runDay          shared/daily dailyDay of the last first-run bonus
 *   dailyDay        shared/daily dailyDay of the last Daily bonus
 * In memory `own` and `eq` are Maps (a Map is a plain Luau table; encode copies it into one with sorted iteration).
 *
 * Forward compatibility (docs/SILVER_SHOP.md SH1, SHD7): every top-level field this build does not know is kept in
 * `extra` exactly as stored and written back by encode, so an older server's transaction never erases a newer server's
 * fields. A known field with a malformed value is dropped as before (it is not "unknown").
 *
 * @module
 */
import { DEFAULT_CHARACTER, type CharacterId, type UpgradeLevels } from "shared/characters";
import { ARMORY_CATALOG, UPGRADE_ITEM, armoryItem, characterUnlock, type ArmoryItem } from "./catalog";
import { SILVER_SHOP, WALLET, WALLET_DOC_VERSION } from "./config";

export interface WalletDoc {
	v: typeof WALLET_DOC_VERSION;
	earned: number;
	spent: number;
	own: Map<string, number>;
	eq?: Map<string, string>;
	runs: string[];
	runDay?: number;
	dailyDay?: number;
	/** Silver bought with Robux (absent: 0). */
	bought?: number;
	/** The last granted PurchaseIds, oldest first (absent: none). */
	receipts?: string[];
	/** Top-level fields this build does not know, kept as stored (absent: none). */
	extra?: Map<string, unknown>;
}

/** The top-level fields this build reads (anything else goes to `extra`). */
const KNOWN_FIELDS: ReadonlySet<string> = new Set([
	"v",
	"earned",
	"spent",
	"own",
	"eq",
	"runs",
	"runDay",
	"dailyDay",
	"bought",
	"receipts",
]);

/** The levels of the upgrade tracks with a sim lever: shared/characters UpgradeLevels (the run session's input). */
export type WalletUpgradeLevels = UpgradeLevels;

export function emptyWalletDoc(): WalletDoc {
	return { v: WALLET_DOC_VERSION, earned: 0, spent: 0, own: new Map(), runs: [] };
}

function copyMap<V>(m: ReadonlyMap<string, V>): Map<string, V> {
	const out = new Map<string, V>();
	for (const [k, v] of m) out.set(k, v);
	return out;
}

export function cloneWalletDoc(d: Readonly<WalletDoc>): WalletDoc {
	const out: WalletDoc = {
		v: WALLET_DOC_VERSION,
		earned: d.earned,
		spent: d.spent,
		own: copyMap(d.own),
		runs: [...d.runs],
	};
	if (d.eq !== undefined) out.eq = copyMap(d.eq);
	if (d.runDay !== undefined) out.runDay = d.runDay;
	if (d.dailyDay !== undefined) out.dailyDay = d.dailyDay;
	if (d.bought !== undefined) out.bought = d.bought;
	if (d.receipts !== undefined) out.receipts = [...d.receipts];
	if (d.extra !== undefined) out.extra = copyMap(d.extra);
	return out;
}

function isInteger(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge && math.floor(v) === v;
}

function isId(v: unknown): v is string {
	return typeIs(v, "string") && v.size() > 0 && v.size() <= WALLET.maxIdChars;
}

function count(v: unknown): number {
	return isInteger(v) && v >= 0 ? v : 0;
}

/** The stored value's version number (undefined: not a table, or no numeric `v`). */
export function walletDocVersionOf(raw: unknown): number | undefined {
	if (!typeIs(raw, "table")) return undefined;
	const v = (raw as { v?: unknown }).v;
	return typeIs(v, "number") ? v : undefined;
}

/** A stored value -> document (module comment). Never throws. */
export function decodeWalletDoc(raw: unknown, catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG): WalletDoc {
	const doc = emptyWalletDoc();
	if (!typeIs(raw, "table") || walletDocVersionOf(raw) !== WALLET_DOC_VERSION) return doc;
	const r = raw as Record<string, unknown>;
	doc.earned = count(r.earned);
	doc.spent = count(r.spent);
	const own = r.own;
	if (typeIs(own, "table")) {
		for (const [k, v] of pairs(own as unknown as ReadonlyMap<unknown, unknown>)) {
			if (!isId(k) || !isInteger(v) || v < 1) continue;
			// Kept exactly as stored (a newer catalogue may have more levels; a rewrite here must not take them away):
			// reads cap it (ownedLevel).
			doc.own.set(k, v);
		}
	}
	const eq = r.eq;
	if (typeIs(eq, "table")) {
		const map = new Map<string, string>();
		for (const [k, v] of pairs(eq as unknown as ReadonlyMap<unknown, unknown>)) {
			if (isId(k) && isId(v)) map.set(k, v);
		}
		if (map.size() > 0) doc.eq = map;
	}
	const runs = r.runs;
	if (typeIs(runs, "table")) {
		const list = runs as unknown as ReadonlyArray<unknown>;
		for (let i = 0; i < list.size(); i++) {
			const id = list[i];
			if (isId(id)) doc.runs.push(id);
		}
		while (doc.runs.size() > WALLET.runRing) doc.runs.remove(0);
	}
	if (isInteger(r.runDay)) doc.runDay = r.runDay;
	if (isInteger(r.dailyDay)) doc.dailyDay = r.dailyDay;
	const bought = count(r.bought);
	if (bought > 0) doc.bought = bought;
	const receipts = r.receipts;
	if (typeIs(receipts, "table")) {
		const list = receipts as unknown as ReadonlyArray<unknown>;
		const kept: string[] = [];
		for (let i = 0; i < list.size(); i++) {
			const id = list[i];
			if (isId(id)) kept.push(id);
		}
		while (kept.size() > SILVER_SHOP.receiptRing) kept.remove(0);
		if (kept.size() > 0) doc.receipts = kept;
	}
	const extra = new Map<string, unknown>();
	for (const [k, v] of pairs(r as unknown as ReadonlyMap<unknown, unknown>)) {
		if (typeIs(k, "string") && !KNOWN_FIELDS.has(k)) extra.set(k, v);
	}
	if (extra.size() > 0) doc.extra = extra;
	return doc;
}

function sortedKeys<V>(m: ReadonlyMap<string, V>): string[] {
	const keys: string[] = [];
	for (const [k] of m) keys.push(k);
	keys.sort();
	return keys;
}

/** Document -> the stored value (plain tables only). */
export function encodeWalletDoc(d: Readonly<WalletDoc>): unknown {
	const out: Record<string, unknown> = {};
	// Unknown fields first, so a known field always wins (decode never puts a known key in `extra` anyway).
	if (d.extra !== undefined) for (const k of sortedKeys(d.extra)) out[k] = d.extra.get(k);
	const own: Record<string, number> = {};
	for (const k of sortedKeys(d.own)) own[k] = d.own.get(k)!;
	out.v = WALLET_DOC_VERSION;
	out.earned = d.earned;
	out.spent = d.spent;
	out.own = own;
	out.runs = [...d.runs];
	if (d.eq !== undefined && d.eq.size() > 0) {
		const eq: Record<string, string> = {};
		for (const k of sortedKeys(d.eq)) eq[k] = d.eq.get(k)!;
		out.eq = eq;
	}
	if (d.runDay !== undefined) out.runDay = d.runDay;
	if (d.dailyDay !== undefined) out.dailyDay = d.dailyDay;
	if (d.bought !== undefined && d.bought > 0) out.bought = d.bought;
	if (d.receipts !== undefined && d.receipts.size() > 0) out.receipts = [...d.receipts];
	return out;
}

function mapsEqual<V>(a: ReadonlyMap<string, V> | undefined, b: ReadonlyMap<string, V> | undefined): boolean {
	const sa = a?.size() ?? 0;
	const sb = b?.size() ?? 0;
	if (sa !== sb) return false;
	if (a === undefined || b === undefined) return true;
	for (const [k, v] of a) if (b.get(k) !== v) return false;
	return true;
}

export function walletDocsEqual(a: Readonly<WalletDoc>, b: Readonly<WalletDoc>): boolean {
	if (a.earned !== b.earned || a.spent !== b.spent || a.runDay !== b.runDay || a.dailyDay !== b.dailyDay) {
		return false;
	}
	if (!mapsEqual(a.own, b.own) || !mapsEqual(a.eq, b.eq) || !mapsEqual(a.extra, b.extra)) return false;
	if ((a.bought ?? 0) !== (b.bought ?? 0)) return false;
	if (!listsEqual(a.runs, b.runs) || !listsEqual(a.receipts ?? [], b.receipts ?? [])) return false;
	return true;
}

function listsEqual(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
	if (a.size() !== b.size()) return false;
	for (let i = 0; i < a.size(); i++) if (a[i] !== b[i]) return false;
	return true;
}

/** Silver available: earned + bought - spent, never below 0. */
export function walletBalance(d: Readonly<WalletDoc>): number {
	return math.max(0, d.earned + (d.bought ?? 0) - d.spent);
}

/** The level of item `id` owned (0: none). */
export function ownedLevel(
	d: Readonly<WalletDoc> | undefined,
	id: string,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): number {
	const v = d?.own.get(id) ?? 0;
	const it = armoryItem(id, catalog);
	return it !== undefined ? math.min(v, it.tiers.size()) : v;
}

/** The player may pick character `id`: the Knight always; any other by its unlock item. No wallet: the Knight only. */
export function ownsCharacter(
	d: Readonly<WalletDoc> | undefined,
	id: CharacterId,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): boolean {
	if (id === DEFAULT_CHARACTER) return true;
	const unlock = characterUnlock(id, catalog);
	return unlock !== undefined && ownedLevel(d, unlock.id) >= 1;
}

/** The levels of the sim-lever upgrade tracks (no wallet: all 0). */
export function walletUpgradeLevels(d: Readonly<WalletDoc> | undefined): WalletUpgradeLevels {
	return {
		vigor: ownedLevel(d, UPGRADE_ITEM.vigor),
		deepFlask: ownedLevel(d, UPGRADE_ITEM.deepFlask),
		plating: ownedLevel(d, UPGRADE_ITEM.plating),
	};
}

/**
 * The cosmetics `d` wears (docs/COSMETICS.md "Looks"): every `eq` slot whose item is a catalogue cosmetic of that slot
 * and owned (a stored doc can hold a stale or foreign entry: it is skipped, never deleted). No wallet: undefined (an
 * unknown wallet: the default look).
 */
export function walletEquipped(
	d: Readonly<WalletDoc> | undefined,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): Map<string, string> | undefined {
	if (d === undefined) return undefined;
	const out = new Map<string, string>();
	if (d.eq === undefined) return out;
	for (const [slot, itemId] of d.eq) {
		const it = armoryItem(itemId, catalog);
		if (it === undefined || it.kind !== "cosmetic" || it.slot !== slot) continue;
		if (ownedLevel(d, it.id, catalog) < 1) continue;
		out.set(slot, it.id);
	}
	return out;
}
