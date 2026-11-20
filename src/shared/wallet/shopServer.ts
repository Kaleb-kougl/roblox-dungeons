/**
 * The Silver shop's server rules (docs/SILVER_SHOP.md SH3), pure so they are specced headlessly; SilverShopService and
 * WalletService only wire Roblox to them.
 *
 *   silverShopStatusFields  what the `wallet` push says about the shop: `shopAvailable` (this universe has products,
 *                           or the Studio fake KV_FakeShop gives fake prices) and the fake prices in pack order
 *   silverReceiptPlan       Roblox's receipt dictionary -> grant it (the receipt and its pack) or defer it
 *                           (NotProcessedYet): not a receipt, not one of our products, or the server is closing
 *   fakeSilverReceipt       Studio only: a receipt for a fake purchase of a shown pack (KV_FakeShop on), with a
 *                           purchase id of its own (`studio_<userId>_<nonce>_<serial>`) so it goes through the same
 *                           transform, ring included
 *   silverAuditKey / silverAuditRecord   the best-effort audit entry in SILVER_SHOP.auditStore (support only; never
 *                           decides Roblox's answer, SHD2)
 *
 * @module
 */
import { SILVER_SHOP, WALLET } from "./config";
import {
	SILVER_PACKS,
	SILVER_PRODUCTS,
	isSilverPackId,
	readSilverReceipt,
	shownSilverPacks,
	silverPack,
	silverPackForProduct,
	silverShopAvailable,
	type FakeShop,
	type SilverPack,
	type SilverPackId,
	type SilverProductTable,
	type SilverPurchaseGrant,
	type SilverReceipt,
} from "./shop";

/** One fake price the Studio panel shows (KV_FakeShop). */
export interface SilverFakePrice {
	packId: SilverPackId;
	robux: number;
}

/** The shop's part of the `wallet` push (WalletStatus.shopAvailable / fakePrices). */
export interface SilverShopStatusFields {
	shopAvailable: boolean;
	fakePrices?: SilverFakePrice[];
}

/**
 * `fake` is the Studio fake in force (undefined: none, or a live server): `off` hides the shop, fake prices show it
 * (with no products needed); without a fake the shop exists where this universe has products.
 */
export function silverShopStatusFields(
	gameId: number,
	fake: FakeShop | undefined,
	products: SilverProductTable = SILVER_PRODUCTS,
	packs: ReadonlyArray<SilverPack> = SILVER_PACKS,
): SilverShopStatusFields {
	if (fake === undefined) return { shopAvailable: silverShopAvailable(gameId, products) };
	if (!fake.on) return { shopAvailable: false };
	const fakePrices: SilverFakePrice[] = [];
	for (const p of shownSilverPacks(packs)) {
		const robux = fake.prices.get(p.id);
		if (robux !== undefined) fakePrices.push({ packId: p.id, robux });
	}
	return { shopAvailable: true, fakePrices };
}

/** Why a receipt is answered NotProcessedYet without a transaction. */
export type SilverReceiptDeferral = "badReceipt" | "notOurs" | "closing";

/**
 * What the receipt handler does with a receipt as it arrives: `grant` runs the wallet transaction for this receipt and
 * pack; `defer` answers NotProcessedYet without one, for the reason given (`receipt` is set when the dictionary was
 * readable).
 */
export type SilverReceiptPlan =
	| { readonly kind: "grant"; readonly receipt: SilverReceipt; readonly pack: SilverPack }
	| { readonly kind: "defer"; readonly reason: SilverReceiptDeferral; readonly receipt?: SilverReceipt };

/**
 * A receipt as the handler first sees it. `closing`: BindToClose has begun, so no new transaction starts (Roblox
 * delivers the receipt again on the buyer's next server). A product that is not one of this universe's Silver packs
 * (retired packs included) is not ours: under the ProcessReceipt fallback it may be another product's receipt.
 */
export function silverReceiptPlan(
	info: unknown,
	gameId: number,
	closing: boolean,
	products: SilverProductTable = SILVER_PRODUCTS,
	packs: ReadonlyArray<SilverPack> = SILVER_PACKS,
): SilverReceiptPlan {
	const receipt = readSilverReceipt(info);
	if (receipt === undefined) return { kind: "defer", reason: "badReceipt" };
	if (closing) return { kind: "defer", reason: "closing", receipt };
	const pack = silverPackForProduct(gameId, receipt.productId, products, packs);
	if (pack === undefined) return { kind: "defer", reason: "notOurs", receipt };
	return { kind: "grant", receipt, pack };
}

/** The purchase id prefix of Studio's fake receipts (never a Roblox PurchaseId shape). */
export const SILVER_SHOP_FAKE_PURCHASE_PREFIX = "studio_";

/** How much of the server session's GUID a fake purchase id keeps (the id must fit WALLET.maxIdChars). */
export const SILVER_SHOP_FAKE_NONCE_CHARS = 8;

/** The product id a fake receipt carries (no real product exists). */
export const SILVER_SHOP_FAKE_PRODUCT_ID = 0;

/**
 * A fake receipt for `packId` (KV_FakeShop on; the caller checks Studio). Undefined: not a shown pack, the fake is not
 * on, or the id would be too long for the ring. `nonce` is the server session's (so two Studio sessions over the same
 * memory store never collide), `serial` counts this session's fake purchases.
 */
export function fakeSilverReceipt(
	userId: number,
	packId: unknown,
	fake: FakeShop | undefined,
	nonce: string,
	serial: number,
	packs: ReadonlyArray<SilverPack> = SILVER_PACKS,
): { readonly receipt: SilverReceipt; readonly pack: SilverPack } | undefined {
	if (fake === undefined || !fake.on || !isSilverPackId(packId)) return undefined;
	const pack = silverPack(packId, packs);
	if (pack === undefined || pack.retired === true || !fake.prices.has(pack.id)) return undefined;
	const purchaseId = `${SILVER_SHOP_FAKE_PURCHASE_PREFIX}${userId}_${nonce}_${serial}`;
	if (purchaseId.size() > WALLET.maxIdChars) return undefined;
	return {
		receipt: {
			purchaseId,
			playerId: userId,
			productId: SILVER_SHOP_FAKE_PRODUCT_ID,
			robuxSpent: fake.prices.get(pack.id),
		},
		pack,
	};
}

/** The audit store's key of a purchase. */
export function silverAuditKey(purchaseId: string): string {
	return `${SILVER_SHOP.auditKeyPrefix}${purchaseId}`;
}

/** One audit entry (plain data for SetAsync). */
export interface SilverAuditRecord {
	userId: number;
	productId: number;
	pack: SilverPackId;
	silver: number;
	balance: number;
	robux?: number;
	placeId?: number;
	/** os.time() at the grant. */
	at: number;
}

/**
 * The audit entry of one granted receipt: who bought which product and pack, the Silver granted and the balance after
 * it, and `at` (Unix seconds, the server's os.time() at the grant). The Robux spent and the place id are included only
 * when the receipt carried them. SilverShopService writes it best effort after the grant; it is for support only.
 */
export function silverAuditRecord(
	receipt: Readonly<SilverReceipt>,
	grant: Readonly<SilverPurchaseGrant>,
	at: number,
): SilverAuditRecord {
	const out: SilverAuditRecord = {
		userId: receipt.playerId,
		productId: receipt.productId,
		pack: grant.packId,
		silver: grant.silver,
		balance: grant.balance,
		at,
	};
	if (receipt.robuxSpent !== undefined) out.robux = receipt.robuxSpent;
	if (receipt.placeId !== undefined) out.placeId = receipt.placeId;
	return out;
}
