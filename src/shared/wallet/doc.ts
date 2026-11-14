/**
 * The wallet document (docs/SILVER.md "Wallet (server)", SV2): one DataStore value per player (`KV_Wallet_v1`, key
 * `u_<UserId>`, WalletService), its codec and the read helpers. Pure: decoding never throws, so a garbage, missing or
 * old-shaped value reads as an empty wallet.
 *
 * Stored as `{ v: 1, earned, spent, own: { [itemId]: level }, eq?: { [slot]: itemId }, runs: string[], runDay?,
 * dailyDay? }`:
 *   earned / spent  non-negative integers; the balance is earned - spent (never stored, never below 0)
 *   own             item id -> level owned (>= 1); a catalogue item is clamped to its levels, an id the catalogue does
 *                   not know (a newer server's item) is kept as stored, so a transaction never deletes it
 *   eq              slot -> item id (cosmetics, phase 2)
 *   runs            the last WALLET.runRing granted run ids, oldest first (a grant of an id in it is a duplicate)
 *   runDay          shared/daily dailyDay of the last first-run bonus
 *   dailyDay        shared/daily dailyDay of the last Daily bonus
 * In memory `own` and `eq` are Maps (a Map is a plain Luau table; encode copies it into one with sorted iteration).
 */
import { DEFAULT_CHARACTER, type CharacterId, type UpgradeLevels } from "shared/characters";
import { ARMORY_CATALOG, UPGRADE_ITEM, armoryItem, characterUnlock, type ArmoryItem } from "./catalog";
import { WALLET, WALLET_DOC_VERSION } from "./config";

export interface WalletDoc {
	v: typeof WALLET_DOC_VERSION;
	earned: number;
	spent: number;
	own: Map<string, number>;
	eq?: Map<string, string>;
	runs: string[];
	runDay?: number;
	dailyDay?: number;
}

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
			const it = armoryItem(k, catalog);
			doc.own.set(k, it !== undefined ? math.min(v, it.tiers.size()) : v);
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
	const own: Record<string, number> = {};
	for (const k of sortedKeys(d.own)) own[k] = d.own.get(k)!;
	const out: Record<string, unknown> = {
		v: WALLET_DOC_VERSION,
		earned: d.earned,
		spent: d.spent,
		own,
		runs: [...d.runs],
	};
	if (d.eq !== undefined && d.eq.size() > 0) {
		const eq: Record<string, string> = {};
		for (const k of sortedKeys(d.eq)) eq[k] = d.eq.get(k)!;
		out.eq = eq;
	}
	if (d.runDay !== undefined) out.runDay = d.runDay;
	if (d.dailyDay !== undefined) out.dailyDay = d.dailyDay;
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
	if (!mapsEqual(a.own, b.own) || !mapsEqual(a.eq, b.eq)) return false;
	if (a.runs.size() !== b.runs.size()) return false;
	for (let i = 0; i < a.runs.size(); i++) if (a.runs[i] !== b.runs[i]) return false;
	return true;
}

/** Silver available: earned - spent, never below 0. */
export function walletBalance(d: Readonly<WalletDoc>): number {
	return math.max(0, d.earned - d.spent);
}

/** The level of item `id` owned (0: none). */
export function ownedLevel(d: Readonly<WalletDoc> | undefined, id: string): number {
	return d?.own.get(id) ?? 0;
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
