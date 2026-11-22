import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService } from "@rbxts/services";
import { logInfo, logWarn } from "client/log";
import { Events } from "client/network";
import { clientStore, selectRecordsStatus, selectWallet } from "client/store";
import { DEFAULT_CHARACTER } from "shared/characters";
import { SFX } from "shared/view/audio";
import { silverWelcomeDecision } from "shared/view/menu";
import { SILVER_SHOP, walletShown } from "shared/view/silver";
import type { WalletStatus } from "shared/wallet";
import { AudioController } from "../audio/AudioController";
import { SimController } from "../game/SimController";
import { SettingsController } from "./SettingsController";

/**
 * Silver's wallet in the client (docs/SILVER.md SV8 / SV9 / SV18). The server owns the wallet; this controller only
 * keeps its latest push in the store's `wallet` slice (client/store wallet.ts) and sends the player's purchases:
 *
 *   status    `requestWallet` at start (the server also pushes once its join load ends); every `wallet` push goes to
 *             the store (walletReceive: the latest status, a settled grant kept by runId, a buy's answer)
 *   buy       `buy(itemId)` (the Armory's and the character screen's hold): one purchase in flight at a time (the
 *             store's `buying`; dropped after SILVER_SHOP.buyTimeoutSec with no answer); the answer plays sfx.shop.buy
 *             or sfx.shop.deny (their fallbacks while silent). The price is the server's: the client sends the id only.
 *   equip     `equip(slot, itemId)` (docs/COSMETICS.md CS6: the Armory's Equip / Take off): `walletEquip`; the push answers
 *             with the new `equipped` list (a refusal plays sfx.shop.deny)
 *   lock      a `locked_character` start (SimController.onLockedCharacter) resets the stored pick to the Knight
 *             (SettingsController), so the next run, the character screen and a lobby Ready start from the Knight
 */
@Controller({})
export class WalletController implements OnStart {
	private readonly janitor = new Janitor();
	private buySentAt: number | undefined;

	constructor(
		private readonly audio: AudioController,
		private readonly sim: SimController,
		private readonly settings: SettingsController,
	) {}

	onStart(): void {
		this.janitor.Add(Events.wallet.connect((status) => this.receive(status)));
		Events.requestWallet.fire();
		this.sim.onLockedCharacter((refused) => {
			logInfo(`[Wallet] ${refused} is locked for this account: the pick resets to the Knight`);
			this.settings.setSelectedCharacter(DEFAULT_CHARACTER);
		});
		this.janitor.Add(RunService.Heartbeat.Connect(() => this.expireBuy()));
		// docs/SILVER.md OC12: the returning-player card's decision, latched once both join pushes are in.
		const latch = () => {
			const st = clientStore.getState();
			if (st.wallet.welcome !== undefined) return;
			const show = silverWelcomeDecision(selectWallet(st), selectRecordsStatus(st));
			if (show !== undefined) clientStore.latchSilverWelcome(show);
		};
		this.janitor.Add(clientStore.subscribe(selectWallet, latch));
		this.janitor.Add(clientStore.subscribe(selectRecordsStatus, latch));
		latch();
	}

	/** The latest push (undefined until the first). */
	status(): WalletStatus | undefined {
		return clientStore.getState().wallet.status;
	}

	/**
	 * Buys the next level of `itemId` (shared/wallet ARMORY_CATALOG). Ignored while another purchase is in flight or
	 * the wallet is not loaded; the server checks the price, the level and the balance against its own doc.
	 */
	buy(itemId: string): boolean {
		const st = clientStore.getState().wallet;
		if (st.buying !== undefined || walletShown(st.status) !== "loaded") return false;
		clientStore.setWalletBuying(itemId);
		this.buySentAt = os.clock();
		logInfo(`[Wallet] buy ${itemId}`);
		Events.walletBuy.fire(itemId);
		return true;
	}

	/**
	 * docs/COSMETICS.md CS6: wears `itemId` in `slot` (WALLET.noItem: takes it off). Ignored while the wallet is not
	 * loaded; the server checks the item is owned and fits the slot (applyEquip).
	 */
	equip(slot: string, itemId: string): boolean {
		if (walletShown(clientStore.getState().wallet.status) !== "loaded") return false;
		logInfo(`[Wallet] equip ${slot}: ${itemId === "" ? "(off)" : itemId}`);
		Events.walletEquip.fire(slot, itemId);
		return true;
	}

	private receive(status: WalletStatus): void {
		clientStore.walletReceive(status);
		const r = status.result;
		if (r !== undefined && r.action === "buy") {
			this.buySentAt = undefined;
			this.audio.playUi(r.ok ? SFX.shopBuy : SFX.shopDeny);
			logInfo(
				`[Wallet] buy ${r.itemId}: ${r.ok ? `level ${r.level ?? "?"} for ${r.price ?? "?"}` : r.reason ?? "?"}`,
			);
		}
		if (r !== undefined && r.action === "equip" && !r.ok) {
			this.audio.playUi(SFX.shopDeny);
			logInfo(`[Wallet] equip ${r.itemId}: ${r.reason ?? "?"}`);
		}
		if (status.grant !== undefined) {
			logInfo(`[Wallet] run ${status.grant.runId}: +${status.grant.total} (balance ${status.grant.balance})`);
		}
	}

	private expireBuy(): void {
		const sent = this.buySentAt;
		if (sent === undefined || os.clock() - sent < SILVER_SHOP.buyTimeoutSec) return;
		this.buySentAt = undefined;
		logWarn("[Wallet] no answer to the purchase; the button works again");
		clientStore.setWalletBuying(undefined);
	}
}
