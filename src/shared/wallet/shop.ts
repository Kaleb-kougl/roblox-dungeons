/**
 * The Silver shop (docs/SILVER_SHOP.md SH2): Silver for Robux through Roblox developer products. Pure.
 *
 *   SILVER_PACKS        the packs, append-only (an order lock spec holds it): the Silver in each is fixed here; the
 *                       Robux price is Roblox's (Creator Hub, read per player with GetProductInfoAsync, SHD8)
 *   SILVER_PRODUCTS     the developer product id of each pack, per universe (game.GameId): an unknown universe has
 *                       no shop. Filled by the owner in SH9
 *   readSilverReceipt   Roblox's receipt dictionary -> SilverReceipt (undefined: not one)
 *   applyPurchase       one receipt on the STORED doc (inside UpdateAsync): a PurchaseId already in `receipts` is a
 *                       `duplicate` (no write); otherwise `bought += pack.silver` and the id joins the ring. Never
 *                       touches earned, spent, own, eq or the day marks (SHD3, SHD9)
 *   receiptDecision     a book outcome -> Roblox's answer: Processed only for a committed grant or a duplicate (SHD2)
 *   parseFakeShop       the Studio fake KV_FakeShop
 *
 * @module
 */
import { SILVER_SHOP, SILVER_SHOP_FAKE_KEYWORDS, WALLET } from "./config";
import { cloneWalletDoc, walletBalance, type WalletDoc } from "./doc";

/**
 * The Silver packs' ids, smallest to largest. They are stored nowhere in the wallet, but they are telemetry SKUs
 * (`silverPack.<id>`), audit log values and the keys of the product tables.
 */
export type SilverPackId = "pouch" | "purse" | "chest" | "hoard";

/** One pack of Silver sold for Robux through a developer product. */
export interface SilverPack {
	readonly id: SilverPackId;
	/** The Silver it grants (fixed; the Robux price is Roblox's). */
	readonly silver: number;
	/** Never shown again, but a late receipt for it still grants. */
	readonly retired?: boolean;
}

/** The packs, append-only (docs/SILVER_SHOP.md "Packs", owner 2026-11-14). */
export const SILVER_PACKS: ReadonlyArray<SilverPack> = table.freeze([
	table.freeze({ id: "pouch", silver: 150 }),
	table.freeze({ id: "purse", silver: 450 }),
	table.freeze({ id: "chest", silver: 1000 }),
	table.freeze({ id: "hoard", silver: 2500 }),
] as SilverPack[]);

/** Every pack id, in SILVER_PACKS order. */
export const SILVER_PACK_IDS: ReadonlyArray<SilverPackId> = SILVER_PACKS.map((p) => p.id);

/**
 * True when `v` is the id of a pack in SILVER_PACKS, retired ones included. Guards values that come from outside: a
 * client's funnel report, Studio's fake purchase request.
 */
export function isSilverPackId(v: unknown): v is SilverPackId {
	return typeIs(v, "string") && SILVER_PACK_IDS.includes(v as SilverPackId);
}

/**
 * The pack with this id, retired ones included (a late receipt for a retired pack still grants), or undefined for
 * anything that is not a pack id.
 */
export function silverPack(id: unknown, packs: ReadonlyArray<SilverPack> = SILVER_PACKS): SilverPack | undefined {
	for (const p of packs) if (p.id === id) return p;
	return undefined;
}

/** The packs the shop shows, in order (retired ones left out). */
export function shownSilverPacks(packs: ReadonlyArray<SilverPack> = SILVER_PACKS): SilverPack[] {
	return packs.filter((p) => p.retired !== true);
}

/** Per universe (game.GameId): pack -> developer product id. */
export type SilverProductTable = ReadonlyMap<number, ReadonlyMap<SilverPackId, number>>;

/** Roblox Dungeons' universe (game.GameId, as the server logs it). */
export const ROBLOX_DUNGEONS_GAME_ID = 10773051289;

/**
 * The developer products of each universe (docs/SILVER_SHOP.md SH9): with no entry for a universe the shop is off
 * there (no `+`, no receipt handler). Roblox Dungeons' four, created 2026-11-14 in Creator Hub (Managed Pricing on;
 * default prices 20 / 55 / 115 / 265 Robux, read from Roblox at run time, never from here): Small / Medium / Large /
 * Extra Large Silver.
 */
export const SILVER_PRODUCTS: SilverProductTable = new Map<number, ReadonlyMap<SilverPackId, number>>([
	[
		ROBLOX_DUNGEONS_GAME_ID,
		new Map<SilverPackId, number>([
			["pouch", 3731496240],
			["purse", 3731496417],
			["chest", 3731496583],
			["hoard", 3731496818],
		]),
	],
]);

/** This universe's pack -> product id map (undefined: no shop here). */
export function silverProductsFor(
	gameId: number,
	products: SilverProductTable = SILVER_PRODUCTS,
): ReadonlyMap<SilverPackId, number> | undefined {
	const m = products.get(gameId);
	return m !== undefined && m.size() > 0 ? m : undefined;
}

/** The pack a developer product of this universe sells (retired packs included; undefined: not a Silver pack). */
export function silverPackForProduct(
	gameId: number,
	productId: number,
	products: SilverProductTable = SILVER_PRODUCTS,
	packs: ReadonlyArray<SilverPack> = SILVER_PACKS,
): SilverPack | undefined {
	const m = silverProductsFor(gameId, products);
	if (m === undefined) return undefined;
	for (const [packId, id] of m) if (id === productId) return silverPack(packId, packs);
	return undefined;
}

/** Every product id of this universe, retired packs included (the receipt handler's filter), sorted. */
export function silverProductIdsFor(gameId: number, products: SilverProductTable = SILVER_PRODUCTS): number[] {
	const out: number[] = [];
	const m = silverProductsFor(gameId, products);
	if (m !== undefined) for (const [, id] of m) out.push(id);
	out.sort((a, b) => a < b);
	return out;
}

/** The shown packs this universe sells, with their product ids, in pack order. */
export function shownSilverProducts(
	gameId: number,
	products: SilverProductTable = SILVER_PRODUCTS,
	packs: ReadonlyArray<SilverPack> = SILVER_PACKS,
): { readonly pack: SilverPack; readonly productId: number }[] {
	const m = silverProductsFor(gameId, products);
	const out: { pack: SilverPack; productId: number }[] = [];
	if (m === undefined) return out;
	for (const pack of shownSilverPacks(packs)) {
		const productId = m.get(pack.id);
		if (productId !== undefined) out.push({ pack, productId });
	}
	return out;
}

/** The shop is on in this universe: at least one shown pack has a product. */
export function silverShopAvailable(gameId: number, products: SilverProductTable = SILVER_PRODUCTS): boolean {
	return shownSilverProducts(gameId, products).size() > 0;
}

/** One developer product receipt, as the server reads it. */
export interface SilverReceipt {
	readonly purchaseId: string;
	readonly playerId: number;
	readonly productId: number;
	/** CurrencySpent: the Robux paid (may differ from the default price: regions, price tests). */
	readonly robuxSpent?: number;
	/** PlaceIdWherePurchased. */
	readonly placeId?: number;
}

function isWholeNumber(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge && math.floor(v) === v;
}

function isPurchaseId(v: unknown): v is string {
	return typeIs(v, "string") && v.size() > 0 && v.size() <= WALLET.maxIdChars;
}

/** Roblox's receipt dictionary (PurchaseId, PlayerId, ProductId, CurrencySpent, PlaceIdWherePurchased). */
export function readSilverReceipt(info: unknown): SilverReceipt | undefined {
	if (!typeIs(info, "table")) return undefined;
	const r = info as Record<string, unknown>;
	const purchaseId = r.PurchaseId;
	const playerId = r.PlayerId;
	const productId = r.ProductId;
	if (!isPurchaseId(purchaseId) || !isWholeNumber(playerId) || !isWholeNumber(productId)) return undefined;
	const out: { -readonly [K in keyof SilverReceipt]: SilverReceipt[K] } = { purchaseId, playerId, productId };
	if (isWholeNumber(r.CurrencySpent) && r.CurrencySpent >= 0) out.robuxSpent = r.CurrencySpent;
	if (isWholeNumber(r.PlaceIdWherePurchased)) out.placeId = r.PlaceIdWherePurchased;
	return out;
}

/** What one granted receipt added. Plain data: it rides the `wallet` push (WalletStatus.purchase). */
export interface SilverPurchaseGrant {
	purchaseId: string;
	packId: SilverPackId;
	productId: number;
	silver: number;
	/** The balance after it. */
	balance: number;
}

/**
 * Why a receipt granted nothing: `badPurchaseId` it carries no usable PurchaseId, `duplicate` its PurchaseId is already
 * in the wallet's receipt ring (granted before; answered Processed), `unknownProduct` its product is not a Silver pack
 * here or the pack's Silver is not a positive whole number.
 */
export type SilverPurchaseRefusal = "duplicate" | "unknownProduct" | "badPurchaseId";

/**
 * What `applyPurchase` answers: the new doc to write with the grant it made, or the refusal with the stored doc
 * unchanged (nothing is written).
 */
export type SilverPurchaseResult =
	| { readonly ok: true; readonly doc: WalletDoc; readonly grant: SilverPurchaseGrant }
	| { readonly ok: false; readonly reason: SilverPurchaseRefusal; readonly doc: Readonly<WalletDoc> };

/** One receipt on `doc` (module comment). `pack` undefined: the product is not a Silver pack here. */
export function applyPurchase(
	doc: Readonly<WalletDoc>,
	receipt: Readonly<SilverReceipt>,
	pack: Readonly<SilverPack> | undefined,
): SilverPurchaseResult {
	if (!isPurchaseId(receipt.purchaseId)) return { ok: false, reason: "badPurchaseId", doc };
	if (doc.receipts !== undefined && doc.receipts.includes(receipt.purchaseId)) {
		return { ok: false, reason: "duplicate", doc };
	}
	if (pack === undefined || !isWholeNumber(pack.silver) || pack.silver <= 0) {
		return { ok: false, reason: "unknownProduct", doc };
	}
	const out = cloneWalletDoc(doc);
	out.bought = (out.bought ?? 0) + pack.silver;
	const ring = out.receipts ?? [];
	ring.push(receipt.purchaseId);
	while (ring.size() > SILVER_SHOP.receiptRing) ring.remove(0);
	out.receipts = ring;
	return {
		ok: true,
		doc: out,
		grant: {
			purchaseId: receipt.purchaseId,
			packId: pack.id,
			productId: receipt.productId,
			silver: pack.silver,
			balance: walletBalance(out),
		},
	};
}

/** Roblox's answer to a receipt (Enum.ProductPurchaseDecision / ReceiptDecision names). */
export type SilverReceiptDecision = "Processed" | "NotProcessedYet";

/** A book transaction's result as the receipt handler sees it (WalletBookOutcome). */
export type SilverReceiptOutcome =
	| { readonly ok: true; readonly outcome: { readonly ok: boolean; readonly reason?: string } }
	| { readonly ok: false };

/**
 * Processed only when the grant committed or the receipt was already granted (`duplicate`); a store error after every
 * retry, a newer doc version, an unknown product, a bad id or a closing server all answer NotProcessedYet, so Roblox
 * delivers the receipt again (SHD2).
 */
export function receiptDecision(r: SilverReceiptOutcome): SilverReceiptDecision {
	if (!r.ok) return "NotProcessedYet";
	if (r.outcome.ok || r.outcome.reason === "duplicate") return "Processed";
	return "NotProcessedYet";
}

/** The Studio fake (SILVER_SHOP_FAKE_ATTRIBUTE). */
export type FakeShop =
	| { readonly on: false }
	| { readonly on: true; readonly prices: ReadonlyMap<SilverPackId, number> };

/** `off`, or one whole Robux price per shown pack in pack order (`20,55,115,265`); anything else: no fake. */
export function parseFakeShop(value: unknown, packs: ReadonlyArray<SilverPack> = SILVER_PACKS): FakeShop | undefined {
	if (!typeIs(value, "string")) return undefined;
	const [inner] = string.match(value, "^%s*(.-)%s*$");
	const s = typeIs(inner, "string") ? inner : value;
	if (s.lower() === SILVER_SHOP_FAKE_KEYWORDS.off) return { on: false };
	const shown = shownSilverPacks(packs);
	const parts = s.split(",");
	if (parts.size() !== shown.size()) return undefined;
	const prices = new Map<SilverPackId, number>();
	for (let i = 0; i < parts.size(); i++) {
		const [digits] = string.match(parts[i], "^%s*(%d+)%s*$");
		const n = digits !== undefined ? tonumber(digits) : undefined;
		if (n === undefined || n <= 0) return undefined;
		prices.set(shown[i].id, n);
	}
	return { on: true, prices };
}
