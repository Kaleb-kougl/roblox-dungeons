/**
 * The Studio wallet fake (WALLET_FAKE_ATTRIBUTE, `KV_FakeWallet`): a Workspace string -> the wallet WalletService
 * serves instead of the DataStore (transactions then run on it in memory; nothing is written). Pure.
 *
 *   "0"                                 loaded, empty
 *   "460"                               460 Silver (earned 460, nothing spent or owned)
 *   "460;vigor:2,character.archer:1"    460 Silver and those levels (item ids case-sensitive, levels 1..the item's)
 *   "unknown"                           not loaded (the Armory is greyed, the Knight only)
 *   "<any of the above>;claimed"        today's first-run and Daily bonuses already taken (runDay = dailyDay = `day`)
 *
 * Spaces around parts are ignored; an item given twice keeps the last level. Anything else (empty, a bad number, an
 * unknown item, a level out of range) is no fake: undefined (the service logs it and serves the real wallet).
 */
import { ARMORY_CATALOG, armoryItem, type ArmoryItem } from "./catalog";
import { WALLET_FAKE_KEYWORDS } from "./config";
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
			const fields = trim(part).split(":");
			if (fields.size() !== 2) return undefined;
			const it = armoryItem(trim(fields[0]), catalog);
			const level = parseCount(trim(fields[1]));
			if (it === undefined || level === undefined || level < 1 || level > it.tiers.size()) return undefined;
			doc.own.set(it.id, level);
		}
	}
	if (claimed) {
		doc.runDay = day;
		doc.dailyDay = day;
	}
	return { loaded: true, doc };
}
