// The Silver shop's pure client half (docs/SILVER_SHOP.md SH5 / SH6): the entry rule, the pending purchase's flow
// (PromptProductPurchaseFinished never grants; the `wallet` push's `purchase` settles), the equal cards and the layout.
import { describe, expect, it } from "@rbxts/jest-globals";
import { SILVER_SHOP_KEYS } from "shared/theme";
import {
	SILVER_SHOP,
	SILVER_SHOP_FROMS,
	shownSilverPacks,
	type SilverPackId,
	type WalletPurchaseNotice,
	type WalletStatus,
} from "shared/wallet";
import { HUD_VIEW } from "shared/view/hud";
import {
	PRICE_FAILED,
	PRICE_LOADING,
	SILVER_SHOP_ENTRY_POINTS,
	SILVER_SHOP_IDLE,
	SILVER_SHOP_VIEW,
	fakeShopPrices,
	priceReady,
	shopAddedExpired,
	shopClose,
	shopNoticeShown,
	shopOpen,
	shopPrompt,
	shopPromptFinished,
	shopPurchaseArrived,
	silverShopCards,
	silverShopEntryShown,
	silverShopLayout,
	silverShopRows,
	type SilverShopPrice,
} from "./silverShop";

const PACKS = shownSilverPacks();
const notice = (packId: SilverPackId, productId: number, silver: number): WalletPurchaseNotice => ({
	productId,
	packId,
	silver,
	balance: 1000 + silver,
});
const allPrices = (): Map<SilverPackId, SilverShopPrice> => {
	const m = new Map<SilverPackId, SilverShopPrice>();
	const robux = [20, 55, 115, 265];
	PACKS.forEach((p, i) => m.set(p.id, priceReady(robux[i])));
	return m;
};

describe("silver shop: entry points", () => {
	it("are exactly the Armory's and the main menu's Silver balance (owner OC3)", () => {
		expect([...SILVER_SHOP_ENTRY_POINTS]).toEqual(["armory", "mainMenu"]);
		expect([...SILVER_SHOP_ENTRY_POINTS]).toEqual([...SILVER_SHOP_FROMS]);
	});

	it("the `+` shows only for a loaded wallet whose server says the shop is on", () => {
		expect(silverShopEntryShown(undefined)).toBe(false);
		expect(silverShopEntryShown({ loaded: false })).toBe(false);
		expect(silverShopEntryShown({ loaded: true, balance: 3 })).toBe(false);
		expect(silverShopEntryShown({ loaded: true, balance: 3, shopAvailable: false })).toBe(false);
		expect(silverShopEntryShown({ loaded: true, balance: 3, shopAvailable: true })).toBe(true);
		// An unloaded wallet never shows it, whatever the flag says.
		expect(silverShopEntryShown({ loaded: false, shopAvailable: true } as WalletStatus)).toBe(false);
	});

	it("Studio's fake prices become ready prices; none -> undefined", () => {
		expect(fakeShopPrices(undefined)).toBe(undefined);
		expect(fakeShopPrices({ loaded: true })).toBe(undefined);
		expect(fakeShopPrices({ loaded: true, fakePrices: [] })).toBe(undefined);
		const m = fakeShopPrices({
			loaded: true,
			fakePrices: [
				{ packId: "pouch", robux: 20 },
				{ packId: "hoard", robux: 265 },
			],
		})!;
		expect(m.get("pouch")).toEqual(priceReady(20));
		expect(m.get("hoard")).toEqual(priceReady(265));
		expect(m.get("purse")).toBe(undefined);
	});
});

describe("silver shop: the pending purchase", () => {
	const open = shopOpen(SILVER_SHOP_IDLE, "mainMenu");

	it("a prompt needs the panel open and nothing else pending", () => {
		expect(shopPrompt(SILVER_SHOP_IDLE, "pouch", 11, 0)).toBe(undefined);
		const p = shopPrompt(open, "pouch", 11, 1)!;
		expect(p.pending).toEqual({
			packId: "pouch",
			productId: 11,
			phase: "prompted",
			promptedAt: 1,
			boughtAt: undefined,
		});
		expect(shopPrompt(p, "purse", 12, 2)).toBe(undefined);
	});

	it("prompt -> bought -> the push settles it (seconds from the prompt) and shows on the card", () => {
		let f = shopPrompt(open, "purse", 12, 10)!;
		const done = shopPromptFinished(f, 12, true, 12);
		expect(done.report).toEqual({ step: "bought", pack: "purse" });
		f = done.flow;
		expect(f.pending?.phase).toBe("bought");
		expect(f.pending?.boughtAt).toBe(12);
		const a = shopPurchaseArrived(f, notice("purse", 12, 450), 13.5);
		expect(a.report).toEqual({ step: "settled", pack: "purse", seconds: 3.5 });
		expect(a.toast).toBe(false);
		expect(a.flow.pending).toBe(undefined);
		expect(a.flow.added).toEqual({ packId: "purse", silver: 450, at: 13.5 });
		expect(shopAddedExpired(a.flow, 13.5 + SILVER_SHOP_VIEW.addedShowSec - 0.01)).toBe(false);
		expect(shopAddedExpired(a.flow, 13.5 + SILVER_SHOP_VIEW.addedShowSec)).toBe(true);
	});

	it("cancelled: the pending purchase goes, nothing is granted", () => {
		const f = shopPrompt(open, "chest", 13, 0)!;
		const done = shopPromptFinished(f, 13, false, 1);
		expect(done.report).toEqual({ step: "cancelled", pack: "chest" });
		expect(done.flow.pending).toBe(undefined);
	});

	it("another product's finish, or a finish with nothing prompted, changes nothing", () => {
		const f = shopPrompt(open, "chest", 13, 0)!;
		expect(shopPromptFinished(f, 99, true, 1)).toEqual({ flow: f });
		expect(shopPromptFinished(open, 13, true, 1)).toEqual({ flow: open });
	});

	it("the push before the prompt closed settles it; the late finish is then ignored", () => {
		const f = shopPrompt(open, "pouch", 11, 0)!;
		const a = shopPurchaseArrived(f, notice("pouch", 11, 150), 0.8);
		expect(a.report).toEqual({ step: "settled", pack: "pouch", seconds: 0.8 });
		expect(a.flow.pending).toBe(undefined);
		const late = shopPromptFinished(a.flow, 11, true, 1);
		expect(late.report).toBe(undefined);
		expect(late.flow).toEqual(a.flow);
	});

	it("closing keeps the pending purchase; its push then toasts", () => {
		const f = shopPromptFinished(shopPrompt(open, "hoard", 14, 0)!, 14, true, 1).flow;
		const closed = shopClose(f);
		expect(closed.open).toBe(false);
		expect(closed.pending?.packId).toBe("hoard");
		const a = shopPurchaseArrived(closed, notice("hoard", 14, 2500), 5);
		expect(a.toast).toBe(true);
		expect(a.report?.step).toBe("settled");
		expect(a.flow.pending).toBe(undefined);
		expect(a.flow.added).toBe(undefined);
	});

	it("a grant nobody waited for (an earlier session's receipt): a toast when closed, the card when open", () => {
		const closed = shopPurchaseArrived(SILVER_SHOP_IDLE, notice("pouch", 11, 150), 1);
		expect(closed.toast).toBe(true);
		expect(closed.report).toBe(undefined);
		const shown = shopPurchaseArrived(open, notice("pouch", 11, 150), 1);
		expect(shown.toast).toBe(false);
		expect(shown.report).toBe(undefined);
		expect(shown.flow.added?.packId).toBe("pouch");
	});

	it("Studio's fake shop: no product id, the pack matches", () => {
		const f = shopPrompt(open, "purse", undefined, 0)!;
		const done = shopPromptFinished(f, undefined, true, 0);
		expect(done.flow.pending?.phase).toBe("bought");
		const a = shopPurchaseArrived(done.flow, notice("purse", 0, 450), 0.2);
		expect(a.report?.step).toBe("settled");
	});

	it("`on its way` after SILVER_SHOP.pendingNoticeSec of waiting for the grant, only once bought", () => {
		const prompted = shopPrompt(open, "pouch", 11, 0)!;
		expect(shopNoticeShown(prompted, 100, SILVER_SHOP.pendingNoticeSec)).toBe(false);
		const bought = shopPromptFinished(prompted, 11, true, 2).flow;
		expect(shopNoticeShown(bought, 2 + SILVER_SHOP.pendingNoticeSec - 0.01, SILVER_SHOP.pendingNoticeSec)).toBe(
			false,
		);
		expect(shopNoticeShown(bought, 2 + SILVER_SHOP.pendingNoticeSec, SILVER_SHOP.pendingNoticeSec)).toBe(true);
	});
});

describe("silver shop: the cards", () => {
	const open = shopOpen(SILVER_SHOP_IDLE, "armory");

	it("one per shown pack, in pack order, all pressable with prices; the label `{robux} Robux` without the icon", () => {
		const cards = silverShopCards(PACKS, allPrices(), open, 0, false);
		expect(cards.map((c) => c.packId)).toEqual(PACKS.map((p) => p.id));
		expect(cards.map((c) => c.silver)).toEqual([150, 450, 1000, 2500]);
		for (const c of cards) {
			expect(c.state).toBe("ready");
			expect(c.pressable).toBe(true);
			expect(c.labelKey).toBe(SILVER_SHOP_KEYS.price);
			expect(c.robuxIcon).toBe(false);
		}
		expect(cards[1].labelVars).toEqual({ robux: 55 });
		const icon = silverShopCards(PACKS, allPrices(), open, 0, true);
		expect(icon[0].labelKey).toBe(SILVER_SHOP_KEYS.priceIcon);
		expect(icon[0].robuxIcon).toBe(true);
	});

	it("loading and failed prices cannot be pressed", () => {
		const prices = new Map<SilverPackId, SilverShopPrice>([
			["pouch", PRICE_LOADING],
			["purse", PRICE_FAILED],
		]);
		const cards = silverShopCards(PACKS, prices, open, 0, false);
		expect(cards[0].state).toBe("loading");
		expect(cards[0].labelKey).toBe(SILVER_SHOP_KEYS.loading);
		expect(cards[1].state).toBe("unavailable");
		expect(cards[1].labelKey).toBe(SILVER_SHOP_KEYS.unavailable);
		// A pack with no price entry is still loading.
		expect(cards[2].state).toBe("loading");
		for (const c of cards) expect(c.pressable).toBe(false);
	});

	it("while one purchase is pending: its card says Adding Silver..., the others wait", () => {
		const f = shopPrompt(open, "chest", 13, 0)!;
		const cards = silverShopCards(PACKS, allPrices(), f, 0, false);
		expect(cards.map((c) => c.state)).toEqual(["busy", "busy", "adding", "busy"]);
		expect(cards[2].labelKey).toBe(SILVER_SHOP_KEYS.adding);
		for (const c of cards) expect(c.pressable).toBe(false);
		// Busy cards keep their price (equal cards: nothing else changes).
		expect(cards[0].labelKey).toBe(SILVER_SHOP_KEYS.price);
	});

	it("a grant shows `+N Silver` on its card for a moment, then the price again", () => {
		const f = shopPurchaseArrived(open, notice("hoard", 14, 2500), 10).flow;
		const now = silverShopCards(PACKS, allPrices(), f, 10, false);
		expect(now[3].state).toBe("added");
		expect(now[3].labelKey).toBe(SILVER_SHOP_KEYS.added);
		expect(now[3].labelVars).toEqual({ silver: 2500 });
		expect(now[0].pressable).toBe(true);
		const later = silverShopCards(PACKS, allPrices(), f, 10 + SILVER_SHOP_VIEW.addedShowSec, false);
		expect(later[3].state).toBe("ready");
	});
});

describe("silver shop: layout", () => {
	it("two columns wide, one narrow; the cards and gaps fill the panel's inner width", () => {
		for (const narrow of [false, true]) {
			const l = silverShopLayout(narrow);
			const inner = l.width - 4 * HUD_VIEW.pad;
			expect(l.columns).toBe(narrow ? 1 : 2);
			expect(l.columns * l.cardWidth + (l.columns - 1) * HUD_VIEW.gap).toBeLessThanOrEqual(inner);
			expect(l.columns * l.cardWidth + (l.columns - 1) * HUD_VIEW.gap).toBeGreaterThan(inner - l.columns);
		}
	});

	it("rows: the title, the card rows, the footnote, Close", () => {
		const wide = silverShopRows(silverShopLayout(false), 4);
		expect(wide.size()).toBe(1 + 2 + 2);
		const narrow = silverShopRows(silverShopLayout(true), 4);
		expect(narrow.size()).toBe(1 + 4 + 2);
		expect(narrow[1]).toBe(SILVER_SHOP_VIEW.cardHeight);
		// A card holds its amount line and its price button.
		expect(SILVER_SHOP_VIEW.cardHeight).toBeGreaterThanOrEqual(
			2 * HUD_VIEW.pad + HUD_VIEW.textSize + 4 + HUD_VIEW.gap + SILVER_SHOP_VIEW.cardButtonHeight,
		);
	});
});
