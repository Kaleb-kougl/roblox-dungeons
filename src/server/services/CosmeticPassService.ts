import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { MarketplaceService, Players, RunService } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import { SlidingWindowLimiter } from "shared/run";
import {
	COSMETIC_PASS,
	armoryItem,
	cosmeticPassItemOf,
	cosmeticPassesFor,
	isRobuxItem,
	itemPurchaseEvent,
} from "shared/wallet";
import { TelemetryService } from "./TelemetryService";
import { WalletService } from "./WalletService";

const log = serverLogger("CosmeticPass");

/**
 * Robux-only cosmetics, server side (docs/COSMETICS.md CSD13): every animated cosmetic is sold through a Roblox game
 * pass (shared/wallet COSMETIC_PASSES), and Roblox's ownership of the pass becomes the item in the wallet's `own`
 * (WalletService.grantPass: one UpdateAsync transaction, no write when owned already), so equip, looks, lobbies and runs
 * read it as before. The client opens Roblox's prompt itself (MarketplaceService:PromptGamePassPurchase); nothing the
 * client sends grants anything here.
 *
 *   join       after each join load (WalletService.onLoaded): every pass of this universe whose item the read copy
 *              does not own is checked with UserOwnsGamePassAsync; an owned one is granted (a pass bought on the website,
 *              in another server, or a grant that failed before). Its push carries `passPurchase` with `bought` false.
 *   purchase   PromptGamePassPurchaseFinished (server side) with `purchased`: the purchase is confirmed with
 *              UserOwnsGamePassAsync (COSMETIC_PASS.verifyTries, verifySeconds apart; Studio trusts the signal, its test
 *              purchases are not owned) and then granted, the push carrying `passPurchase` with `bought` true. An
 *              unconfirmed purchase is logged and granted at the buyer's next join.
 *   Studio     `cosmeticPassFakeBuy(itemId)` while KV_FakePasses gives a fake price: the same grant (no pass needed).
 *   telemetry  (docs/SHOP_ANALYTICS.md PUD3) one `Purchase` when a grant commits, from the prompt or the join check
 *              alike, so each pass logs once per player; only while the player is here (AnalyticsService needs the
 *              Player).
 */
@Service({})
export class CosmeticPassService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly fakeLimiter = new SlidingWindowLimiter<Player>(
		COSMETIC_PASS.fakeRate.count,
		COSMETIC_PASS.fakeRate.windowSeconds,
	);

	constructor(private readonly wallet: WalletService, private readonly telemetry: TelemetryService) {}

	onStart(): void {
		this.wallet.onLoaded((player) => this.reconcile(player));
		this.janitor.Add(
			MarketplaceService.PromptGamePassPurchaseFinished.Connect((player, passId, purchased) => {
				if (!purchased) return;
				task.spawn(() => this.onPurchased(player, passId));
			}),
		);
		this.janitor.Add(Events.cosmeticPassFakeBuy.connect((player, itemId) => this.fakeBuy(player, itemId)));
		this.janitor.Add(Players.PlayerRemoving.Connect((player) => this.fakeLimiter.forget(player)));
	}

	/** Roblox's answer to "does `userId` own pass `passId`", or undefined when the call failed. Yields. */
	private ownsPass(userId: number, passId: number): boolean | undefined {
		const [ok, owns] = pcall(() => MarketplaceService.UserOwnsGamePassAsync(userId as unknown as User, passId));
		if (!ok) {
			log.warn("OWNS_FAILED", `${userId} pass ${passId}: ${tostring(owns)}`);
			return undefined;
		}
		return owns === true;
	}

	/** The join check (see the class comment). Yields. */
	private reconcile(player: Player): void {
		const passes = cosmeticPassesFor(game.GameId);
		if (passes === undefined) return;
		const userId = player.UserId;
		for (const [itemId, passId] of passes) {
			if (player.Parent === undefined) return;
			if (this.wallet.owns(userId, itemId)) continue;
			if (this.ownsPass(userId, passId) !== true) continue;
			this.grant(userId, itemId, false, `join pass ${passId}`);
		}
	}

	/** A purchase Roblox reported (see the class comment). Yields. */
	private onPurchased(player: Player, passId: number): void {
		const userId = player.UserId;
		const itemId = cosmeticPassItemOf(game.GameId, passId);
		if (itemId === undefined) {
			log.info("NOT_OURS", `${userId} bought pass ${passId}: not a cosmetic pass here`);
			return;
		}
		let confirmed = RunService.IsStudio();
		for (let i = 0; !confirmed && i < COSMETIC_PASS.verifyTries; i++) {
			if (i > 0) task.wait(COSMETIC_PASS.verifySeconds);
			confirmed = this.ownsPass(userId, passId) === true;
		}
		if (!confirmed) {
			log.warn("UNCONFIRMED", `${userId} pass ${passId} (${itemId}): not owned yet; granted at the next join`);
			return;
		}
		this.grant(userId, itemId, true, `pass ${passId}`);
	}

	/** The wallet grant and its push. Yields. */
	private grant(userId: number, itemId: string, bought: boolean, what: string): void {
		const r = this.wallet.grantPass(userId, itemId);
		if (!r.ok) {
			log.warn(
				"NOT_GRANTED",
				`${userId} ${itemId} (${what}): ${r.reason ?? "?"}${r.error !== undefined ? ` (${r.error})` : ""}`,
			);
			return;
		}
		if (r.granted) log.info("GRANT", `${userId} ${itemId} (${what})`);
		// A purchase always answers (the buyer's client is waiting on it); a join check only when it granted.
		if (r.granted || bought) this.wallet.pushPass(userId, { itemId, bought });
		if (r.granted) this.logPurchase(userId, itemId);
	}

	/** The granted item's `Purchase` (docs/SHOP_ANALYTICS.md PUD3), while its buyer is on this server. */
	private logPurchase(userId: number, itemId: string): void {
		const player = Players.GetPlayerByUserId(userId);
		const bought = itemPurchaseEvent(itemId);
		if (player === undefined || bought === undefined) return;
		this.telemetry.logEvents(player, [bought]);
	}

	/** `cosmeticPassFakeBuy` (Studio only, KV_FakePasses with a price): the real grant without a pass. */
	private fakeBuy(player: Player, itemId: string): void {
		if (!RunService.IsStudio()) return;
		if (player.Parent === undefined || !this.fakeLimiter.tryAcquire(player, os.clock())) return;
		const fake = this.wallet.fakePasses();
		if (fake === undefined || !fake.on || !isRobuxItem(armoryItem(itemId))) {
			log.warn(
				"FAKE_REFUSED",
				`${player.UserId}: fake buy of ${tostring(itemId)} (KV_FakePasses off or not Robux)`,
			);
			return;
		}
		this.grant(player.UserId, itemId, true, "KV_FakePasses");
	}
}
