/**
 * The Studio wallet fake (WALLET_FAKE_ATTRIBUTE, `KV_FakeWallet`): a Workspace string -> the wallet WalletService
 * serves instead of the DataStore (transactions then run on it in memory; nothing is written). Pure.
 *
 *   "0"                                 loaded, empty
 *   "460"                               460 Silver (earned 460, nothing spent or owned)
 *   "460;vigor:2,character.archer:1"    460 Silver and those levels (item ids case-sensitive, levels 1..the item's)
 *   "unknown"                           not loaded (the Armory is greyed, the Knight only)
 *   "<any of the above>;claimed"        today's first-run and Daily bonuses already taken (runDay = dailyDay = `day`)
 *   "6000;outline.azure:1*"             docs/COSMETICS.md CS4: a cosmetic ending in `*` is owned and equipped
 *   "6000;cosmetics"                    every cosmetic owned (combines with items: "6000;vigor:2,cosmetics")
 *   "6000;dressed"                      every cosmetic owned and WALLET_FAKE_DRESSED equipped
 *
 * Spaces around parts are ignored; an item given twice keeps the last level. Anything else (empty, a bad number, an
 * unknown item, a level out of range) is no fake: undefined (the service logs it and serves the real wallet).
 *
 * @module
 */
import { ARMORY_CATALOG, armoryItem, type ArmoryItem } from "./catalog";
import { WALLET_FAKE_DRESSED, WALLET_FAKE_EQUIP_MARK, WALLET_FAKE_KEYWORDS } from "./config";
import { emptyWalletDoc, type WalletDoc } from "./doc";

export interface FakeWallet {
	/** False for `unknown`. */
	readonly loaded: boolean;
	/** The fake document (empty for `unknown`). */
	readonly doc: WalletDoc;
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

/** Puts cosmetic `it` in its slot (false: not a cosmetic). */
function equip(doc: WalletDoc, it: ArmoryItem | undefined): boolean {
	if (it === undefined || it.kind !== "cosmetic" || it.slot === undefined) return false;
	if (doc.eq === undefined) doc.eq = new Map();
	doc.eq.set(it.slot, it.id);
	return true;
}

/** `value` as a fake on UTC day `day` (the `claimed` marker's day). */
export function parseFakeWallet(
	value: unknown,
	day: number,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): FakeWallet | undefined {
	if (!typeIs(value, "string")) return undefined;
	const parts = trim(value).split(";").map(trim);
	let claimed = false;
	if (parts.size() > 1 && parts[parts.size() - 1].lower() === WALLET_FAKE_KEYWORDS.claimed) {
		claimed = true;
		parts.pop();
	}
	if (parts.size() === 0 || parts.size() > 2 || parts[0] === "") return undefined;
	if (parts[0].lower() === WALLET_FAKE_KEYWORDS.unknown) {
		return parts.size() === 1 ? { loaded: false, doc: emptyWalletDoc() } : undefined;
	}
	const balance = parseCount(parts[0]);
	if (balance === undefined) return undefined;
	const doc = emptyWalletDoc();
	doc.earned = balance;
	if (parts.size() === 2) {
		if (parts[1] === "") return undefined;
		for (const part of parts[1].split(",")) {
			const entry = trim(part);
			const keyword = entry.lower();
			if (keyword === WALLET_FAKE_KEYWORDS.cosmetics || keyword === WALLET_FAKE_KEYWORDS.dressed) {
				for (const it of catalog) if (it.kind === "cosmetic") doc.own.set(it.id, it.tiers.size());
				if (keyword === WALLET_FAKE_KEYWORDS.dressed) {
					for (const id of WALLET_FAKE_DRESSED) if (!equip(doc, armoryItem(id, catalog))) return undefined;
				}
				continue;
			}
			const equipped = entry.size() > 1 && entry.sub(-1) === WALLET_FAKE_EQUIP_MARK;
			const fields = (equipped ? entry.sub(1, -2) : entry).split(":");
			if (fields.size() !== 2) return undefined;
			const it = armoryItem(trim(fields[0]), catalog);
			const level = parseCount(trim(fields[1]));
			if (it === undefined || level === undefined || level < 1 || level > it.tiers.size()) return undefined;
			doc.own.set(it.id, level);
			if (equipped && !equip(doc, it)) return undefined;
		}
	}
	if (claimed) {
		doc.runDay = day;
		doc.dailyDay = day;
	}
	return { loaded: true, doc };
}
