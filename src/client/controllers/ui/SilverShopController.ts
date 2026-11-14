import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { MarketplaceService, Players, RunService } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore } from "client/store";
import { SFX } from "shared/view/audio";
import {
	MENU_VIEW,
	PRICE_FAILED,
	PRICE_LOADING,
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
	silverShopEntryShown,
	type SilverShopFlow,
	type SilverShopStepReport,
} from "shared/view/menu";
import { SILVER_SHOP_KEYS } from "shared/theme";
import {
	SILVER_SHOP,
	shownSilverProducts,
	type SilverPackId,
	type SilverShopFrom,
	type SilverShopReport,
	type WalletPurchaseNotice,
	type WalletStatus,
} from "shared/wallet";
import { AudioController } from "../audio/AudioController";

/**
 * The Silver shop in the client (docs/SILVER_SHOP.md SH5): the Get Silver panel's flow over the store's `silverShop`
 * slice (the rules are pure in shared/view/menu silverShop.ts). The server owns every grant; this controller only
 * opens Roblox's prompt and follows it:
 *
 *   open      `open(from)` (the `+` beside the Armory's or the main menu's Silver balance, nothing else, SHD5): the panel,
 *             a `opened` funnel step, and on the session's first open the prices: Studio's fake prices
 *             (WalletStatus.fakePrices) or MarketplaceService:GetProductInfoAsync per shown product (`PriceInRobux`,
 *             Roblox's price for this player, never hard-coded: SHD8). A failed read leaves that card `Unavailable`
 *             (one `pricesFailed` step); a later open reads the failed ones again.
 *   buy       `buy(packId)`: one purchase at a time. PromptProductPurchase on the pack's product, or, with Studio's
 *             fake prices, `silverShopFakeBuy` (granted by the server through the same receipt path).
 *   prompt    PromptProductPurchaseFinished (this player's) only moves the pending state (bought / cancelled): it is
 *             never a grant (Roblox: do not use it to process purchases).
 *   grant     the `wallet` push's `purchase` settles a matching pending purchase (before or after the prompt closed),
 *             plays sfx.silver.gain, shows `+N Silver` on its card, or a notice toast with the panel closed (a grant
 *             from an earlier session too). `Your Silver is on its way` after SILVER_SHOP.pendingNoticeSec.
 *   hidden    the panel closes when the wallet stops showing the `+` (unloaded, shop off).
 * Every step that matters reports a `silverShopReport` funnel step (opened / prompted / bought / cancelled / settled /
 * pricesFailed with where it opened from, the pack and, settled, the seconds since the prompt).
 */
@Controller({})
export class SilverShopController implements OnStart {
	private readonly janitor = new Janitor();
	/** The session read the prices once (re-read only the failed ones). */
	private pricesRead = false;
	private reading = false;
	/** Toast serials: negative, so they never meet LobbyController's (positive) notice ids. */
	private toastSerial = 0;

	constructor(private readonly audio: AudioController) {}

	onStart(): void {
		this.janitor.Add(Events.wallet.connect((status) => this.onWallet(status)));
		this.janitor.Add(
			MarketplaceService.PromptProductPurchaseFinished.Connect((userId, productId, purchased) => {
				if (userId !== Players.LocalPlayer.UserId) return;
				this.onPromptFinished(productId, purchased);
			}),
		);
		this.janitor.Add(RunService.Heartbeat.Connect(() => this.tick()));
	}

	/** The `+` beside a Silver balance: the panel opens over that screen. */
	open(from: SilverShopFrom): void {
		const st = clientStore.getState();
		if (!silverShopEntryShown(st.wallet.status)) return;
		if (st.silverShop.flow.open) return;
		this.setFlow(shopOpen(st.silverShop.flow, from));
		this.report({ step: "opened", from });
		this.readPrices(st.wallet.status);
	}

	close(): void {
		const flow = clientStore.getState().silverShop.flow;
		if (flow.open) this.setFlow(shopClose(flow));
	}

	/** A card pressed: Roblox's purchase prompt for the pack (Studio's fake: the fake buy). */
	buy(packId: SilverPackId): void {
		const st = clientStore.getState();
		const flow = st.silverShop.flow;
		const fake = fakeShopPrices(st.wallet.status) !== undefined;
		let productId: number | undefined;
		if (!fake) {
			productId = shownSilverProducts(game.GameId).find((e) => e.pack.id === packId)?.productId;
			if (productId === undefined) return;
		}
		const prompted = shopPrompt(flow, packId, productId, os.clock());
		if (prompted === undefined) return;
		this.setFlow(prompted);
		this.report({ step: "prompted", from: flow.from ?? "mainMenu", pack: packId });
		if (productId === undefined) {
			print(`[SilverShop] fake buy ${packId} (KV_FakeShop)`);
			// Studio's fake shop has no prompt: the press is the purchase, so the pending purchase is bought at once.
			this.onPromptFinished(undefined, true);
			Events.silverShopFakeBuy.fire(packId);
			return;
		}
		print(`[SilverShop] prompt ${packId} (product ${productId})`);
		MarketplaceService.PromptProductPurchase(Players.LocalPlayer, productId);
	}

	private onPromptFinished(productId: number | undefined, purchased: boolean): void {
		const flow = clientStore.getState().silverShop.flow;
		const done = shopPromptFinished(flow, productId, purchased, os.clock());
		if (done.flow === flow) return;
		this.setFlow(done.flow);
		this.reportStep(done.report, flow);
	}

	private onWallet(status: WalletStatus): void {
		const notice = status.purchase;
		if (notice !== undefined) this.onPurchase(notice);
		// The `+` went away (the wallet unloaded, the shop turned off): the panel goes with it.
		if (status.loaded && !silverShopEntryShown(status)) this.close();
	}

	private onPurchase(n: WalletPurchaseNotice): void {
		const flow = clientStore.getState().silverShop.flow;
		const a = shopPurchaseArrived(flow, n, os.clock());
		this.setFlow(a.flow);
		this.reportStep(a.report, flow);
		this.audio.playUi(SFX.silverGain);
		print(`[SilverShop] +${n.silver} Silver (${n.packId}), balance ${n.balance}`);
		if (a.toast) {
			this.toastSerial++;
			clientStore.pushLobbyNotice(
				{
					id: -this.toastSerial,
					key: SILVER_SHOP_KEYS.added,
					vars: { silver: n.silver },
					until: os.clock() + SILVER_SHOP_VIEW.toastSec,
				},
				MENU_VIEW.maxNotices,
			);
		}
	}

	/** Per frame, cheap: the on-its-way notice and the end of a grant's moment on its card (dispatched on change). */
	private tick(): void {
		const st = clientStore.getState().silverShop;
		const now = os.clock();
		const notice = shopNoticeShown(st.flow, now, SILVER_SHOP.pendingNoticeSec);
		if (notice !== st.notice) clientStore.setSilverShopNotice(notice);
		if (shopAddedExpired(st.flow, now)) this.setFlow({ ...st.flow, added: undefined });
	}

	private readPrices(status: WalletStatus | undefined): void {
		const fake = fakeShopPrices(status);
		if (fake !== undefined) {
			clientStore.setSilverShopPrices(fake);
			return;
		}
		if (this.reading) return;
		const prices = clientStore.getState().silverShop.prices;
		const todo = shownSilverProducts(game.GameId).filter((e) => {
			const p = prices.get(e.pack.id);
			return !this.pricesRead || p === undefined || p.kind === "failed";
		});
		if (todo.size() === 0) return;
		this.reading = true;
		for (const e of todo) clientStore.setSilverShopPrice(e.pack.id, PRICE_LOADING);
		task.spawn(() => {
			let failed = false;
			for (const e of todo) {
				const [ok, info] = pcall(() =>
					MarketplaceService.GetProductInfoAsync(e.productId, Enum.InfoType.Product),
				);
				const robux =
					ok && typeIs(info, "table") ? (info as { PriceInRobux?: unknown }).PriceInRobux : undefined;
				if (typeIs(robux, "number") && robux >= 0) clientStore.setSilverShopPrice(e.pack.id, priceReady(robux));
				else {
					failed = true;
					clientStore.setSilverShopPrice(e.pack.id, PRICE_FAILED);
					warn(
						`[SilverShop] no price for ${e.pack.id} (product ${e.productId}): ${
							ok ? "no PriceInRobux" : info
						}`,
					);
				}
			}
			this.pricesRead = true;
			this.reading = false;
			if (failed)
				this.report({ step: "pricesFailed", from: clientStore.getState().silverShop.flow.from ?? "mainMenu" });
		});
	}

	private setFlow(flow: SilverShopFlow): void {
		clientStore.setSilverShopFlow(flow);
	}

	private reportStep(r: SilverShopStepReport | undefined, before: SilverShopFlow): void {
		if (r === undefined) return;
		const report: SilverShopReport = { step: r.step, from: before.from ?? "mainMenu", pack: r.pack };
		if (r.seconds !== undefined) report.seconds = r.seconds;
		this.report(report);
	}

	private report(r: SilverShopReport): void {
		Events.silverShopReport.fire(r);
	}
}
