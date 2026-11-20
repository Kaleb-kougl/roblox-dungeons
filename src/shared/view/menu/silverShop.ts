/**
 * The Silver shop's client half, pure (docs/SILVER_SHOP.md SH5 / SH6: Silver for Robux through developer products).
 * client/ui/menu GetSilverPanel draws it, client SilverShopController drives it:
 *
 *   entry       the two entry points, a quiet `+` beside the Silver balance in the Armory's header and on the main menu
 *               (SILVER_SHOP_ENTRY_POINTS, owner OC3); shown only while the wallet is loaded and the server says the
 *               shop is on (silverShopEntryShown). Nothing else opens the panel (SHD5: no prompt in a run, at run
 *               over, on a lock card, ...); scripts/check-silver-shop-entry.test.js holds the importers to the two.
 *   flow        the purchase's pending state (SilverShopFlow): idle -> prompted (Roblox's prompt is up) -> bought
 *               (PromptProductPurchaseFinished said purchased: waiting for the grant) -> settled (the `wallet` push's
 *               `purchase`). PromptProductPurchaseFinished is never a grant (fact 4): it only moves the pending state;
 *               the push settles it, before or after the prompt closed, the panel open or not (a toast then).
 *   cards       one equal card per shown pack (silverShopCards): the Silver, then Roblox's price, `Unavailable`, the
 *               pending `Adding Silver...` or, for a moment, `+450 Silver`. Same size and look for every card: no
 *               ribbon, no "best value", no crossed-out price (SHD5).
 *   layout      the panel's widths, columns and rows (silverShopLayout / silverShopRows), shared with fit.spec.ts.
 *
 * @module
 */
import type { StringVars } from "shared/theme";
import { SILVER_SHOP_KEYS } from "shared/theme";
import {
	SILVER_SHOP_FROMS,
	type SilverPack,
	type SilverPackId,
	type SilverShopFrom,
	type WalletPurchaseNotice,
	type WalletStatus,
} from "shared/wallet";
import { HUD_VIEW } from "shared/view/hud";
import { MENU_VIEW } from "./config";

/** The panel's tunables (reference px, seconds). */
export const SILVER_SHOP_VIEW = {
	/** Wide (desktop, a landscape phone): two columns of cards. */
	width: 440,
	wideColumns: 2,
	/** Narrow (a portrait phone): one column. */
	narrowWidth: 300,
	narrowColumns: 1,
	/** A card's height; its width fills its column. */
	cardHeight: 76,
	/** The price button's height inside a card. */
	cardButtonHeight: 30,
	/** The footnote's lines (wraps once wide, twice narrow). */
	wideFootnoteLines: 2,
	narrowFootnoteLines: 3,
	/**
	 * The `+` beside a Silver balance: a small square button as tall as the Armory's title line (HUD_VIEW.titleText +
	 * 4), so neither the Armory's header nor the phone main menu's Silver line (MENU_VIEW.smallButton.y) grows.
	 */
	plus: { x: HUD_VIEW.titleText + 4, y: HUD_VIEW.titleText + 4 },
	/** `+450 Silver` stays on its card this long after the grant lands. */
	addedShowSec: 2.5,
	/** A purchase landing with the panel closed: a notice toast (MENU_VIEW notices) this long. */
	toastSec: 4,
	/** Over the menu shell's pointer sink (MENU_VIEW.pointerSinkZIndex) in its Sibling layering. */
	zIndex: MENU_VIEW.pointerSinkZIndex + 1,
	/** The panel's dim over the screen that opened it. */
	dimTransparency: 0.35,
} as const;

/** Where the panel can open from (owner OC3): exactly the two Silver balances. */
export const SILVER_SHOP_ENTRY_POINTS: ReadonlyArray<SilverShopFrom> = SILVER_SHOP_FROMS;

/** The `+` beside a Silver balance is shown: a loaded wallet whose server says the shop is on. */
export function silverShopEntryShown(status: Readonly<WalletStatus> | undefined): boolean {
	return status !== undefined && status.loaded && status.shopAvailable === true;
}

/** A pack's Robux price as this client knows it. */
export type SilverShopPrice =
	| { readonly kind: "loading" }
	| { readonly kind: "ready"; readonly robux: number }
	| { readonly kind: "failed" };

/**
 * A pack's price while Roblox has not answered yet: its card shows the loading label and cannot be pressed. Also what a
 * pack missing from the price map reads as.
 */
export const PRICE_LOADING: SilverShopPrice = { kind: "loading" };
/** A pack's price when it could not be read: its card shows `Unavailable` and cannot be pressed. */
export const PRICE_FAILED: SilverShopPrice = { kind: "failed" };

/** A pack's known price of `robux` Robux: its card shows the price and can be pressed. */
export function priceReady(robux: number): SilverShopPrice {
	return { kind: "ready", robux };
}

/** Studio's fake prices (WalletStatus.fakePrices) as a price map, or undefined when there are none. */
export function fakeShopPrices(
	status: Readonly<WalletStatus> | undefined,
): ReadonlyMap<SilverPackId, SilverShopPrice> | undefined {
	const list = status?.fakePrices;
	if (list === undefined || list.size() === 0) return undefined;
	const out = new Map<SilverPackId, SilverShopPrice>();
	for (const e of list) out.set(e.packId, priceReady(e.robux));
	return out;
}

/** A purchase in flight. */
export interface SilverShopPending {
	readonly packId: SilverPackId;
	/** The product prompted (undefined: Studio's fake shop, no product). */
	readonly productId: number | undefined;
	/** "prompted": Roblox's prompt is up; "bought": it said purchased, the grant is on its way. */
	readonly phase: "prompted" | "bought";
	readonly promptedAt: number;
	/** When PromptProductPurchaseFinished said purchased (phase "bought"). */
	readonly boughtAt: number | undefined;
}

/** A grant shown on its card for a moment (SILVER_SHOP_VIEW.addedShowSec). */
export interface SilverShopAdded {
	readonly packId: SilverPackId;
	readonly silver: number;
	readonly at: number;
}

/** The panel's flow (the store's `silverShop.flow`). Immutable: every step returns a new one. */
export interface SilverShopFlow {
	readonly open: boolean;
	/** The balance that opened it (focus memory and telemetry). */
	readonly from: SilverShopFrom | undefined;
	readonly pending: SilverShopPending | undefined;
	readonly added: SilverShopAdded | undefined;
}

/**
 * The flow at rest: the panel closed, no purchase pending and no grant being shown. The store's `silverShop.flow`
 * starts here.
 */
export const SILVER_SHOP_IDLE: SilverShopFlow = { open: false, from: undefined, pending: undefined, added: undefined };

/** The flow with the panel opened from the balance `from`. A pending purchase and a grant being shown are kept. */
export function shopOpen(f: SilverShopFlow, from: SilverShopFrom): SilverShopFlow {
	return { ...f, open: true, from };
}

/** Closing keeps a pending purchase: its grant still lands (a toast then). */
export function shopClose(f: SilverShopFlow): SilverShopFlow {
	return { ...f, open: false, added: undefined };
}

/** A card pressed: undefined (refused) while another purchase is pending or the panel is closed. */
export function shopPrompt(
	f: SilverShopFlow,
	packId: SilverPackId,
	productId: number | undefined,
	now: number,
): SilverShopFlow | undefined {
	if (!f.open || f.pending !== undefined) return undefined;
	return {
		...f,
		added: undefined,
		pending: { packId, productId, phase: "prompted", promptedAt: now, boughtAt: undefined },
	};
}

/** What a step reports (the `silverShopReport` funnel; shared/wallet SilverShopClientStep). */
export interface SilverShopStepReport {
	readonly step: "bought" | "cancelled" | "settled";
	readonly pack: SilverPackId;
	/** settled: seconds from the prompt to the grant's push. */
	readonly seconds?: number;
}

/** PromptProductPurchaseFinished for this player: moves a matching prompted purchase on, or drops it (cancelled). */
export function shopPromptFinished(
	f: SilverShopFlow,
	productId: number | undefined,
	purchased: boolean,
	now: number,
): { readonly flow: SilverShopFlow; readonly report?: SilverShopStepReport } {
	const p = f.pending;
	if (p === undefined || p.phase !== "prompted") return { flow: f };
	if (p.productId !== undefined && productId !== p.productId) return { flow: f };
	if (!purchased) return { flow: { ...f, pending: undefined }, report: { step: "cancelled", pack: p.packId } };
	return {
		flow: { ...f, pending: { ...p, phase: "bought", boughtAt: now } },
		report: { step: "bought", pack: p.packId },
	};
}

/** The pending purchase this grant answers (its product, else its pack). */
function answers(p: SilverShopPending, n: Readonly<WalletPurchaseNotice>): boolean {
	return p.productId !== undefined ? p.productId === n.productId : p.packId === n.packId;
}

/**
 * A `wallet` push carried `purchase`. A matching pending purchase settles (before or after its prompt closed); any
 * grant shows on its card while the panel is open, else as a toast (a grant from an earlier session, or the panel
 * closed while it was on its way).
 */
export function shopPurchaseArrived(
	f: SilverShopFlow,
	n: Readonly<WalletPurchaseNotice>,
	now: number,
): { readonly flow: SilverShopFlow; readonly report?: SilverShopStepReport; readonly toast: boolean } {
	const p = f.pending;
	const settles = p !== undefined && answers(p, n);
	const pending = settles ? undefined : f.pending;
	const report: SilverShopStepReport | undefined = settles
		? { step: "settled", pack: p!.packId, seconds: math.max(0, now - p!.promptedAt) }
		: undefined;
	if (f.open) {
		return {
			flow: { ...f, pending, added: { packId: n.packId, silver: n.silver, at: now } },
			report,
			toast: false,
		};
	}
	return { flow: { ...f, pending }, report, toast: true };
}

/** `Your Silver is on its way`: a bought purchase has waited SILVER_SHOP.pendingNoticeSec for its grant. */
export function shopNoticeShown(f: SilverShopFlow, now: number, noticeSec: number): boolean {
	const p = f.pending;
	return p !== undefined && p.phase === "bought" && p.boughtAt !== undefined && now - p.boughtAt >= noticeSec;
}

/** The `added` moment has passed (the card shows its price again). */
export function shopAddedExpired(f: SilverShopFlow, now: number, showSec = SILVER_SHOP_VIEW.addedShowSec): boolean {
	return f.added !== undefined && now - f.added.at >= showSec;
}

/**
 * What a pack's card shows: `loading` or `unavailable` (the price is not known or failed), `ready` (the price,
 * pressable), `busy` (the price, but another pack's purchase is pending), `adding` (this pack's purchase is pending) or
 * `added` (its grant just landed, for a moment).
 */
export type SilverShopCardState = "loading" | "ready" | "unavailable" | "adding" | "added" | "busy";

/** One card as drawn. */
export interface SilverShopCard {
	readonly packId: SilverPackId;
	readonly silver: number;
	readonly state: SilverShopCardState;
	/** The button's text: a string key and its vars. */
	readonly labelKey: string;
	readonly labelVars?: StringVars;
	/** The button presses (Roblox's prompt opens). */
	readonly pressable: boolean;
	/** The price shows Roblox's Robux icon (only on `ready`, and only where the pack has it). */
	readonly robuxIcon: boolean;
}

/** The cards, one per shown pack, all the same size and look (SHD5). */
export function silverShopCards(
	packs: ReadonlyArray<SilverPack>,
	prices: ReadonlyMap<SilverPackId, SilverShopPrice>,
	f: SilverShopFlow,
	now: number,
	hasRobuxIcon: boolean,
	showSec = SILVER_SHOP_VIEW.addedShowSec,
): SilverShopCard[] {
	const out: SilverShopCard[] = [];
	for (const pack of packs) {
		const base = { packId: pack.id, silver: pack.silver };
		const p = f.pending;
		const a = f.added;
		if (p !== undefined && p.packId === pack.id) {
			out.push({
				...base,
				state: "adding",
				labelKey: SILVER_SHOP_KEYS.adding,
				pressable: false,
				robuxIcon: false,
			});
			continue;
		}
		if (a !== undefined && a.packId === pack.id && now - a.at < showSec) {
			out.push({
				...base,
				state: "added",
				labelKey: SILVER_SHOP_KEYS.added,
				labelVars: { silver: a.silver },
				pressable: false,
				robuxIcon: false,
			});
			continue;
		}
		const price = prices.get(pack.id) ?? PRICE_LOADING;
		if (price.kind === "failed") {
			out.push({
				...base,
				state: "unavailable",
				labelKey: SILVER_SHOP_KEYS.unavailable,
				pressable: false,
				robuxIcon: false,
			});
		} else if (price.kind === "loading") {
			out.push({
				...base,
				state: "loading",
				labelKey: SILVER_SHOP_KEYS.loading,
				pressable: false,
				robuxIcon: false,
			});
		} else {
			const icon = hasRobuxIcon;
			out.push({
				...base,
				state: p !== undefined ? "busy" : "ready",
				labelKey: icon ? SILVER_SHOP_KEYS.priceIcon : SILVER_SHOP_KEYS.price,
				labelVars: { robux: price.robux },
				pressable: p === undefined,
				robuxIcon: icon,
			});
		}
	}
	return out;
}

/** The panel's arrangement: its width, columns and a card's width. */
export interface SilverShopLayout {
	readonly width: number;
	readonly columns: number;
	readonly cardWidth: number;
	readonly footnoteLines: number;
}

/**
 * The panel's arrangement, in reference px: one column of cards on a narrow (portrait phone) screen, two otherwise,
 * each card filling its column inside the panel's padding, and the number of lines the footnote wraps to.
 */
export function silverShopLayout(narrow: boolean): SilverShopLayout {
	const V = SILVER_SHOP_VIEW;
	const width = narrow ? V.narrowWidth : V.width;
	const columns = narrow ? V.narrowColumns : V.wideColumns;
	const inner = width - 4 * HUD_VIEW.pad;
	const cardWidth = math.floor((inner - (columns - 1) * HUD_VIEW.gap) / columns);
	return { width, columns, cardWidth, footnoteLines: narrow ? V.narrowFootnoteLines : V.wideFootnoteLines };
}

/** One line of text as the HUD draws it (size + 4, like Text). */
function line(size: number): number {
	return size + 4;
}

/**
 * The panel's rows top to bottom (reference px, no padding or gaps): the title, the card rows, the footnote, Close.
 * GetSilverPanel draws exactly these; fit.spec.ts measures them.
 */
export function silverShopRows(layout: SilverShopLayout, packCount: number): number[] {
	const rows = [line(HUD_VIEW.titleText)];
	const cardRows = math.ceil(packCount / layout.columns);
	for (let i = 0; i < cardRows; i++) rows.push(SILVER_SHOP_VIEW.cardHeight);
	rows.push(layout.footnoteLines * line(HUD_VIEW.smallText));
	rows.push(MENU_VIEW.smallButton.y);
	return rows;
}
