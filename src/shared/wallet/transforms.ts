/**
 * The wallet's pure transforms (docs/SILVER.md "Wallet (server)", SV2; SVD5, SVD26, SVD27). Each takes the STORED doc
 * (WalletService runs them inside UpdateAsync, so concurrent servers compose) and returns a new doc or a refusal; none
 * mutates its input.
 *
 *   applyGrant  a run's Silver: refused when the run id is already in `runs` (idempotent per run). Otherwise the run
 *               amount (the rows' sum) + Prospector (floor(sum x 5 % x the STORED level), never on the top-up or a
 *               bonus) + the minimum's top-up (a run that qualifies is brought to SILVER.runMinimum, Prospector
 *               included) + the first-run bonus (the stored `runDay` before ctx.day, then runDay = ctx.day) + the Daily
 *               bonus (a Daily finish and the stored `dailyDay` before ctx.dailyDay, then set). A day number that went
 *               backwards pays no bonus and keeps the stored day. Returns the breakdown.
 *   applyBuy    the next level of a catalogue item: refused when unknown, maxed, its prerequisite is missing, or the
 *               balance is short of the price read from the catalogue (the client never sends one).
 *   applyEquip  a cosmetic into its slot ("" empties the slot): the item must be owned and fit the slot.
 *   nextGoals   the next levels to buy, cheapest first (the Armory's marks and the recap's `to go` line, SVD24).
 *
 * walletTransaction(stored, op) wraps one of them for a store transform: it decodes, refuses a NEWER doc version
 * (`newerVersion`: never written over), and gives the value to write (undefined: cancel the write).
 */
import { SILVER, type RunSilver, type SilverRow, type SilverTunables } from "shared/silver";
import { ARMORY_CATALOG, UPGRADE_ITEM, armoryItem, itemTier, tierPrice, type ArmoryItem } from "./catalog";
import { WALLET, WALLET_DOC_VERSION } from "./config";
import {
	cloneWalletDoc,
	decodeWalletDoc,
	encodeWalletDoc,
	ownedLevel,
	walletBalance,
	walletDocVersionOf,
	walletDocsEqual,
	type WalletDoc,
} from "./doc";

/** A run's Silver as a grant (RunSessionService.conclude -> WalletService.grantRun). */
export interface WalletGrant {
	/** The server-issued run id (the idempotence key). */
	readonly runId: string;
	/** The run's rows (SegmentedRunResult.silver). */
	readonly run: Readonly<RunSilver>;
	/** An accepted Daily finish (the Daily bonus may apply). */
	readonly daily: boolean;
}

/** The days a grant is judged on (shared/daily dailyDay numbers). */
export interface WalletGrantContext {
	/** The UTC day at the grant: dailyDay(os.time()) (the first-run bonus). */
	readonly day: number;
	/** A Daily run: the day it started (session.daily.day, SVD30). */
	readonly dailyDay?: number;
}

/** What one grant paid, row by row (the recap rows and the economy events). Plain data: it rides the remotes. */
export interface SilverGrantBreakdown {
	runId: string;
	/** The run rows (every row, zeros included). */
	rows: SilverRow[];
	/** The rows' sum: the run amount. */
	sum: number;
	/** Prospector's level read from the stored doc. */
	prospectorLevel: number;
	/** Prospector's Silver: floor(sum x percent x level / 100). */
	prospector: number;
	/** What the minimum added (after Prospector). */
	topUp: number;
	firstRunBonus: number;
	dailyBonus: number;
	/** Everything this grant added. */
	total: number;
	/** The balance after the grant. */
	balance: number;
}

export type WalletRefusal =
	| "duplicate"
	| "badRunId"
	| "unknown"
	| "maxed"
	| "poor"
	| "prerequisite"
	| "notOwned"
	| "wrongSlot"
	| "badSlot"
	| "newerVersion";

export type WalletGrantResult =
	| { readonly ok: true; readonly doc: WalletDoc; readonly breakdown: SilverGrantBreakdown }
	| { readonly ok: false; readonly reason: WalletRefusal; readonly doc: Readonly<WalletDoc> };

/** A purchase (applyBuy's success). */
export interface WalletPurchase {
	itemId: string;
	/** The level bought (1-based). */
	level: number;
	tier: number;
	price: number;
	/** The balance after it. */
	balance: number;
}

export type WalletBuyResult =
	| { readonly ok: true; readonly doc: WalletDoc; readonly purchase: WalletPurchase }
	| { readonly ok: false; readonly reason: WalletRefusal; readonly doc: Readonly<WalletDoc> };

export type WalletEquipResult =
	| { readonly ok: true; readonly doc: WalletDoc; readonly changed: boolean }
	| { readonly ok: false; readonly reason: WalletRefusal; readonly doc: Readonly<WalletDoc> };

function isRunId(id: unknown): id is string {
	return typeIs(id, "string") && id.size() > 0 && id.size() <= WALLET.maxIdChars;
}

/** The Prospector bonus on a run amount at `level` (SVD27). */
export function prospectorBonus(sum: number, level: number, t: SilverTunables = SILVER): number {
	if (sum <= 0 || level <= 0) return 0;
	return math.floor((sum * t.prospectorPercentPerLevel * level) / t.percentBase);
}

/** The breakdown a grant of `grant` would give on `doc` (no idempotence check, no change). */
export function grantBreakdown(
	doc: Readonly<WalletDoc>,
	grant: Readonly<WalletGrant>,
	ctx: Readonly<WalletGrantContext>,
	t: SilverTunables = SILVER,
): SilverGrantBreakdown {
	const sum = math.max(0, grant.run.sum);
	const level = ownedLevel(doc, UPGRADE_ITEM.prospector);
	const prospector = prospectorBonus(sum, level, t);
	const topUp = grant.run.qualifies ? math.max(0, t.runMinimum - (sum + prospector)) : 0;
	const firstRunBonus = doc.runDay === undefined || doc.runDay < ctx.day ? t.firstRunBonus : 0;
	const dailyOpen =
		grant.daily && ctx.dailyDay !== undefined && (doc.dailyDay === undefined || doc.dailyDay < ctx.dailyDay);
	const dailyBonus = dailyOpen ? t.dailyBonus : 0;
	const total = sum + prospector + topUp + firstRunBonus + dailyBonus;
	return {
		runId: grant.runId,
		rows: grant.run.rows.map((r) => ({ row: r.row, count: r.count, silver: r.silver })),
		sum,
		prospectorLevel: level,
		prospector,
		topUp,
		firstRunBonus,
		dailyBonus,
		total,
		balance: walletBalance(doc) + total,
	};
}

/** A grant (module comment). */
export function applyGrant(
	doc: Readonly<WalletDoc>,
	grant: Readonly<WalletGrant>,
	ctx: Readonly<WalletGrantContext>,
	t: SilverTunables = SILVER,
): WalletGrantResult {
	if (!isRunId(grant.runId)) return { ok: false, reason: "badRunId", doc };
	if (doc.runs.includes(grant.runId)) return { ok: false, reason: "duplicate", doc };
	const breakdown = grantBreakdown(doc, grant, ctx, t);
	const out = cloneWalletDoc(doc);
	out.earned += breakdown.total;
	if (breakdown.firstRunBonus > 0) out.runDay = ctx.day;
	if (breakdown.dailyBonus > 0) out.dailyDay = ctx.dailyDay;
	out.runs.push(grant.runId);
	while (out.runs.size() > WALLET.runRing) out.runs.remove(0);
	return { ok: true, doc: out, breakdown };
}

function prerequisiteMet(doc: Readonly<WalletDoc>, it: Readonly<ArmoryItem>): boolean {
	const req = it.requires;
	return req === undefined || ownedLevel(doc, req.itemId) >= req.level;
}

/** The next level of `itemId` (module comment). */
export function applyBuy(
	doc: Readonly<WalletDoc>,
	itemId: string,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): WalletBuyResult {
	const it = typeIs(itemId, "string") ? armoryItem(itemId, catalog) : undefined;
	if (it === undefined) return { ok: false, reason: "unknown", doc };
	const level = ownedLevel(doc, it.id) + 1;
	const tier = itemTier(it, level);
	const price = tier !== undefined ? tierPrice(tier) : undefined;
	if (tier === undefined || price === undefined) return { ok: false, reason: "maxed", doc };
	if (!prerequisiteMet(doc, it)) return { ok: false, reason: "prerequisite", doc };
	if (walletBalance(doc) < price) return { ok: false, reason: "poor", doc };
	const out = cloneWalletDoc(doc);
	out.spent += price;
	out.own.set(it.id, level);
	return { ok: true, doc: out, purchase: { itemId: it.id, level, tier, price, balance: walletBalance(out) } };
}

/** A cosmetic into its slot, or the slot emptied (`itemId` = WALLET.noItem). */
export function applyEquip(
	doc: Readonly<WalletDoc>,
	slot: string,
	itemId: string,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): WalletEquipResult {
	if (!typeIs(slot, "string") || !catalog.some((i) => i.slot === slot)) return { ok: false, reason: "badSlot", doc };
	if (itemId === WALLET.noItem) {
		if (doc.eq?.get(slot) === undefined) return { ok: true, doc: cloneWalletDoc(doc), changed: false };
		const out = cloneWalletDoc(doc);
		out.eq!.delete(slot);
		if (out.eq!.size() === 0) out.eq = undefined;
		return { ok: true, doc: out, changed: true };
	}
	const it = typeIs(itemId, "string") ? armoryItem(itemId, catalog) : undefined;
	if (it === undefined) return { ok: false, reason: "unknown", doc };
	if (it.slot !== slot) return { ok: false, reason: "wrongSlot", doc };
	if (ownedLevel(doc, it.id) < 1) return { ok: false, reason: "notOwned", doc };
	if (doc.eq?.get(slot) === it.id) return { ok: true, doc: cloneWalletDoc(doc), changed: false };
	const out = cloneWalletDoc(doc);
	if (out.eq === undefined) out.eq = new Map();
	out.eq.set(slot, it.id);
	return { ok: true, doc: out, changed: true };
}

/** One next level to buy. */
export interface WalletGoal {
	itemId: string;
	level: number;
	tier: number;
	price: number;
	/** Silver still needed (0: affordable now). */
	toGo: number;
}

/**
 * The next levels to buy, cheapest first (ties in catalogue order), at most `count`: each item's next level when it
 * has one and its prerequisite is owned.
 */
export function nextGoals(
	doc: Readonly<WalletDoc> | undefined,
	count: number = WALLET.goals,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): WalletGoal[] {
	const balance = doc !== undefined ? walletBalance(doc) : 0;
	const goals: { goal: WalletGoal; index: number }[] = [];
	for (let index = 0; index < catalog.size(); index++) {
		const it = catalog[index];
		const level = ownedLevel(doc, it.id) + 1;
		const tier = itemTier(it, level);
		const price = tier !== undefined ? tierPrice(tier) : undefined;
		if (tier === undefined || price === undefined) continue;
		if (doc !== undefined ? !prerequisiteMet(doc, it) : it.requires !== undefined) continue;
		goals.push({ goal: { itemId: it.id, level, tier, price, toGo: math.max(0, price - balance) }, index });
	}
	goals.sort((a, b) => (a.goal.price !== b.goal.price ? a.goal.price < b.goal.price : a.index < b.index));
	const out: WalletGoal[] = [];
	for (let i = 0; i < goals.size() && i < count; i++) out.push(goals[i].goal);
	return out;
}

/** One wallet change, as WalletService runs it inside a store transform. */
export type WalletOp =
	| { readonly kind: "grant"; readonly grant: WalletGrant; readonly ctx: WalletGrantContext }
	| { readonly kind: "buy"; readonly itemId: string }
	| { readonly kind: "equip"; readonly slot: string; readonly itemId: string };

/** A transaction's outcome. `write` is the value to store (undefined: cancel the write). */
export interface WalletTxOutcome {
	readonly ok: boolean;
	readonly reason?: WalletRefusal;
	/** The doc after the transaction (the stored one when refused or unchanged). */
	readonly doc: WalletDoc;
	readonly write?: unknown;
	readonly breakdown?: SilverGrantBreakdown;
	readonly purchase?: WalletPurchase;
}

/** `op` on the stored value `stored` (module comment). Never throws. */
export function walletTransaction(
	stored: unknown,
	op: WalletOp,
	catalog: ReadonlyArray<ArmoryItem> = ARMORY_CATALOG,
): WalletTxOutcome {
	const version = walletDocVersionOf(stored);
	const doc = decodeWalletDoc(stored, catalog);
	if (version !== undefined && version > WALLET_DOC_VERSION) return { ok: false, reason: "newerVersion", doc };
	if (op.kind === "grant") {
		const r = applyGrant(doc, op.grant, op.ctx);
		if (!r.ok) return { ok: false, reason: r.reason, doc };
		return { ok: true, doc: r.doc, write: encodeWalletDoc(r.doc), breakdown: r.breakdown };
	}
	if (op.kind === "buy") {
		const r = applyBuy(doc, op.itemId, catalog);
		if (!r.ok) return { ok: false, reason: r.reason, doc };
		return { ok: true, doc: r.doc, write: encodeWalletDoc(r.doc), purchase: r.purchase };
	}
	const r = applyEquip(doc, op.slot, op.itemId, catalog);
	if (!r.ok) return { ok: false, reason: r.reason, doc };
	const changed = r.changed && !walletDocsEqual(doc, r.doc);
	return { ok: true, doc: r.doc, write: changed ? encodeWalletDoc(r.doc) : undefined };
}
