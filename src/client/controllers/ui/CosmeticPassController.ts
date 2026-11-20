import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { MarketplaceService, Players, RunService } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore } from "client/store";
import { str } from "client/ui/theme";
import { COSMETIC_KEYS, cosmeticNameKey } from "shared/theme";
import { SFX } from "shared/view/audio";
import { COSMETIC_VIEW } from "shared/view/cosmetics";
import { MENU_VIEW, PRICE_FAILED, PRICE_LOADING, priceReady, robuxItemOf } from "shared/view/menu";
import { walletShown } from "shared/view/silver";
import type { WalletPassNotice, WalletStatus } from "shared/wallet";
import { AudioController } from "../audio/AudioController";

/**
 * Robux-only cosmetics in the client (docs/COSMETICS.md CSD13: every animated cosmetic, sold through a Roblox game
 * pass). The server owns every grant (CosmeticPassService); this controller only reads prices, opens Roblox's prompt and
 * follows it, over the store's `cosmeticPass` slice:
 *
 *   prices    each `wallet` push lists the Robux-only items on sale here (WalletStatus.robuxItems): Studio's fake
 *             price, or MarketplaceService:GetProductInfoAsync(pass, GamePass).PriceInRobux (Roblox's price for this
 *             player, never in code), read once per item per session (a failed read is tried again on a later push).
 *   buy       `buy(itemId)` (the Armory's Cosmetics tab): one at a time. PromptGamePassPurchase on the item's pass, or,
 *             with Studio's fake price, `cosmeticPassFakeBuy`. PromptGamePassPurchaseFinished only moves the pending
 *             state (cancelled: the button works again); it is never a grant.
 *   grant     the `wallet` push's `passPurchase` (after the server confirmed the pass): sfx.shop.buy for a purchase, the
 *             row's stamp, a `{name} unlocked` toast. No grant within COSMETIC_VIEW.robux.pendingTimeoutSec: the button
 *             works again (the server grants at the next join).
 */
@Controller({})
export class CosmeticPassController implements OnStart {
	private readonly janitor = new Janitor();
	/** Items whose price read is running or ready (a failed one leaves). */
	private readonly priced = new Set<string>();
	private pendingAt: number | undefined;
	/** Toast serials: negative and below the Silver shop's range, never meeting LobbyController's (positive) ids. */
	private toastSerial = 0;

	constructor(private readonly audio: AudioController) {}

	onStart(): void {
		this.janitor.Add(Events.wallet.connect((status) => this.onWallet(status)));
		this.janitor.Add(
			MarketplaceService.PromptGamePassPurchaseFinished.Connect((player, passId, purchased) => {
				if (player !== Players.LocalPlayer) return;
				this.onPromptFinished(passId, purchased);
			}),
		);
		this.janitor.Add(RunService.Heartbeat.Connect(() => this.expire()));
	}

	/** The Robux buy of `itemId`: Roblox's game pass prompt (Studio's fake: the fake buy). */
	buy(itemId: string): boolean {
		const st = clientStore.getState();
		const status = st.wallet.status;
		if (walletShown(status) !== "loaded" || st.cosmeticPass.pending !== undefined) return false;
		const item = robuxItemOf(status, itemId);
		if (item === undefined) return false;
		clientStore.setCosmeticPassPending(itemId);
		this.pendingAt = undefined;
		if (item.fakeRobux !== undefined) {
			print(`[CosmeticPass] fake buy ${itemId} (KV_FakePasses)`);
			this.pendingAt = os.clock();
			Events.cosmeticPassFakeBuy.fire(itemId);
			return true;
		}
		if (item.passId === undefined) {
			clientStore.setCosmeticPassPending(undefined);
			return false;
		}
		print(`[CosmeticPass] prompt ${itemId} (pass ${item.passId})`);
		MarketplaceService.PromptGamePassPurchase(Players.LocalPlayer, item.passId);
		return true;
	}

	private onPromptFinished(passId: number, purchased: boolean): void {
		const st = clientStore.getState();
		const pending = st.cosmeticPass.pending;
		if (pending === undefined) return;
		const item = robuxItemOf(st.wallet.status, pending);
		if (item === undefined || item.passId !== passId) return;
		if (!purchased) {
			print(`[CosmeticPass] ${pending}: prompt closed`);
			clientStore.setCosmeticPassPending(undefined);
			return;
		}
		// Bought: the grant is the server's push; wait for it (bounded).
		this.pendingAt = os.clock();
	}

	private onWallet(status: WalletStatus): void {
		const notice = status.passPurchase;
		if (notice !== undefined) this.onGranted(notice);
		const pending = clientStore.getState().cosmeticPass.pending;
		// Off sale now (the fake turned off, a pass removed) or owned another way: nothing to wait for.
		if (pending !== undefined && status.loaded) {
			const owned = status.own?.some((o) => o.itemId === pending && o.level >= 1) === true;
			if (owned && notice === undefined) clientStore.cosmeticPassGranted(pending);
			else if (!owned && robuxItemOf(status, pending) === undefined)
				clientStore.setCosmeticPassPending(undefined);
		}
		this.readPrices(status);
	}

	private onGranted(n: WalletPassNotice): void {
		this.pendingAt = undefined;
		clientStore.cosmeticPassGranted(n.itemId);
		if (n.bought) this.audio.playUi(SFX.shopBuy);
		print(`[CosmeticPass] ${n.itemId} granted (${n.bought ? "bought" : "pass already owned"})`);
		this.toastSerial++;
		clientStore.pushLobbyNotice(
			{
				id: -(COSMETIC_VIEW.robux.toastIdBase + this.toastSerial),
				key: COSMETIC_KEYS.robuxAdded,
				vars: { name: str(cosmeticNameKey(n.itemId)) },
				until: os.clock() + COSMETIC_VIEW.robux.toastSec,
			},
			MENU_VIEW.maxNotices,
		);
	}

	private expire(): void {
		const at = this.pendingAt;
		if (at === undefined || os.clock() - at < COSMETIC_VIEW.robux.pendingTimeoutSec) return;
		this.pendingAt = undefined;
		warn("[CosmeticPass] no grant after the purchase; the button works again (the next join grants it)");
		clientStore.setCosmeticPassPending(undefined);
	}

	private readPrices(status: WalletStatus): void {
		if (!status.loaded || status.robuxItems === undefined) return;
		for (const item of status.robuxItems) {
			const id = item.itemId;
			if (item.fakeRobux !== undefined) {
				clientStore.setCosmeticPassPrice(id, priceReady(item.fakeRobux));
				continue;
			}
			const passId = item.passId;
			if (passId === undefined || this.priced.has(id)) continue;
			this.priced.add(id);
			clientStore.setCosmeticPassPrice(id, PRICE_LOADING);
			task.spawn(() => {
				const [ok, info] = pcall(() => MarketplaceService.GetProductInfoAsync(passId, Enum.InfoType.GamePass));
				const robux =
					ok && typeIs(info, "table") ? (info as { PriceInRobux?: unknown }).PriceInRobux : undefined;
				if (typeIs(robux, "number") && robux >= 0) {
					clientStore.setCosmeticPassPrice(id, priceReady(robux));
					return;
				}
				this.priced.delete(id);
				clientStore.setCosmeticPassPrice(id, PRICE_FAILED);
				warn(`[CosmeticPass] no price for ${id} (pass ${passId}): ${ok ? "no PriceInRobux" : info}`);
			});
		}
	}
}
