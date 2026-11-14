import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { HttpService, MarketplaceService, Players, RunService } from "@rbxts/services";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import { SlidingWindowLimiter } from "shared/run";
import {
	SILVER_SHOP,
	SILVER_SHOP_FAKE_NONCE_CHARS,
	fakeSilverReceipt,
	readSilverShopReport,
	silverAuditKey,
	silverAuditRecord,
	silverPackEconomyEvent,
	silverProductIdsFor,
	silverReceiptPlan,
	silverShopGrantedEvent,
	silverShopReportEvent,
	type SilverPack,
	type SilverPurchaseGrant,
	type SilverReceipt,
	type SilverReceiptDecision,
} from "shared/wallet";
import { DataStoreKeyValue } from "./data/DataStoreKeyValue";
import { TelemetryService } from "./TelemetryService";
import { WalletService } from "./WalletService";

const log = serverLogger("SilverShop");

/**
 * The Silver shop, server side (docs/SILVER_SHOP.md SH3): Roblox developer-product receipts become Silver in the
 * wallet. Every rule is pure in shared/wallet (shop.ts: the packs, products and the receipt transform; shopServer.ts:
 * the receipt plan, the Studio fake, the audit entry); this service only wires Roblox to them.
 *
 * Receipts: when this universe has Silver products (shared/wallet SILVER_PRODUCTS), one filtered
 * `MarketplaceService:BindReceiptHandler(DeveloperProduct, handler, <every product id, retired packs included>)`, so
 * ProcessReceipt stays free for any other product. If the bind throws, ProcessReceipt is set once, here, when nothing
 * else set it (another product's receipt then answers NotProcessedYet). The handler:
 *   - defers (NotProcessedYet, no transaction) what is not a receipt, not one of our products, or arrives once
 *     BindToClose has begun (Roblox delivers it again on the buyer's next server);
 *   - otherwise runs WalletService.purchaseSilver (the wallet book: the stored doc inside UpdateAsync, the receipt ring
 *     in the same write, the per-player lock, retries), whether or not the buyer is still here (SHD4), and answers
 *     Processed only after the write committed or for a duplicate (SHD2);
 *   - after a grant: the buyer's `wallet` push with `purchase`, the IAP economy Source and the `granted` funnel event
 *     (only while the buyer is here: AnalyticsService needs the Player), and one best-effort audit entry in
 *     SILVER_SHOP.auditStore (never on Studio, never deciding the answer). A duplicate logs nothing.
 * BindToClose only raises the closing flag: WalletService's own BindToClose waits for receipts already running (the
 * book's `pending` counts them).
 *
 * Remotes: `silverShopReport` (the client's funnel steps; rate limited at SILVER_SHOP.reportRate, re-read with
 * readSilverShopReport, logged as `SilverShop`, used for nothing else) and, in Studio only, `silverShopFakeBuy(packId)`
 * while KV_FakeShop gives fake prices: a fake receipt (shared/wallet fakeSilverReceipt) through the same purchase path.
 */
@Service({})
export class SilverShopService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly audit = new DataStoreKeyValue(SILVER_SHOP.auditStore);
	private readonly reportLimiter = new SlidingWindowLimiter<Player>(
		SILVER_SHOP.reportRate.count,
		SILVER_SHOP.reportRate.windowSeconds,
	);
	private readonly fakeLimiter = new SlidingWindowLimiter<Player>(
		SILVER_SHOP.reportRate.count,
		SILVER_SHOP.reportRate.windowSeconds,
	);
	/** BindToClose has begun: no new receipt transaction starts. */
	private closing = false;
	/** Studio's fake purchase ids: this server session's nonce and a counter. */
	private readonly fakeNonce = HttpService.GenerateGUID(false).sub(1, SILVER_SHOP_FAKE_NONCE_CHARS);
	private fakeSerial = 0;

	constructor(private readonly wallet: WalletService, private readonly telemetry: TelemetryService) {}

	onStart(): void {
		game.BindToClose(() => {
			this.closing = true;
		});
		this.bindReceipts();
		this.janitor.Add(Events.silverShopReport.connect((player, raw) => this.report(player, raw)));
		this.janitor.Add(Events.silverShopFakeBuy.connect((player, packId) => this.fakeBuy(player, packId)));
		this.janitor.Add(
			Players.PlayerRemoving.Connect((player) => {
				this.reportLimiter.forget(player);
				this.fakeLimiter.forget(player);
			}),
		);
	}

	/** The receipt handler for this universe's Silver products (none: no handler, the shop is off). */
	private bindReceipts(): void {
		const ids = silverProductIdsFor(game.GameId);
		if (ids.size() === 0) {
			log.info("NO_PRODUCTS", `no Silver products for game ${game.GameId}: no receipt handler`);
			return;
		}
		const [ok, result] = pcall(() =>
			MarketplaceService.BindReceiptHandler(
				Enum.ReceiptType.DeveloperProduct,
				(info: unknown) =>
					this.onReceipt(info) === "Processed"
						? Enum.ReceiptDecision.Processed
						: Enum.ReceiptDecision.NotProcessedYet,
				ids,
			),
		);
		if (ok) {
			this.janitor.Add(result as RBXScriptConnection);
			log.info("BOUND", `receipt handler for ${ids.size()} Silver products`);
			return;
		}
		log.warn("BIND_FAILED", `BindReceiptHandler: ${tostring(result)}; falling back to ProcessReceipt`);
		if (MarketplaceService.ProcessReceipt !== undefined) {
			log.warn("NO_HANDLER", "ProcessReceipt is already set elsewhere: Silver receipts will wait unprocessed");
			return;
		}
		MarketplaceService.ProcessReceipt = (info) =>
			this.onReceipt(info) === "Processed"
				? Enum.ProductPurchaseDecision.PurchaseGranted
				: Enum.ProductPurchaseDecision.NotProcessedYet;
	}

	/** One receipt (see the class comment). Yields. */
	private onReceipt(info: unknown): SilverReceiptDecision {
		const plan = silverReceiptPlan(info, game.GameId, this.closing);
		if (plan.kind === "defer") {
			const who = plan.receipt !== undefined ? `${plan.receipt.playerId} ${plan.receipt.purchaseId}` : "?";
			if (plan.reason === "closing") log.info("DEFERRED", `${who}: server closing`);
			else log.warn("DEFERRED", `${who}: ${plan.reason}`);
			return "NotProcessedYet";
		}
		return this.grant(plan.receipt, plan.pack, false);
	}

	/** A receipt through the wallet, then the push, telemetry and audit of a grant. Yields. */
	private grant(receipt: SilverReceipt, pack: SilverPack, fake: boolean): SilverReceiptDecision {
		const r = this.wallet.purchaseSilver(receipt, pack);
		const g = r.grant;
		if (g !== undefined) {
			log.info(
				"GRANT",
				`${receipt.playerId} ${receipt.purchaseId} ${g.packId}: +${g.silver} (balance ${g.balance})`,
			);
			this.wallet.pushPurchase(receipt.playerId, g);
			const player = Players.GetPlayerByUserId(receipt.playerId);
			if (player !== undefined) {
				this.telemetry.logEconomy(player, [silverPackEconomyEvent(g)]);
				this.telemetry.logEvents(player, [silverShopGrantedEvent(g)]);
			}
			if (!fake) task.spawn(() => this.writeAudit(receipt, g));
		} else if (r.reason === "duplicate") {
			log.info("DUPLICATE", `${receipt.playerId} ${receipt.purchaseId}: already granted`);
		} else {
			log.warn(
				"NOT_GRANTED",
				`${receipt.playerId} ${receipt.purchaseId}: ${r.reason ?? "?"}${
					r.error !== undefined ? ` (${r.error})` : ""
				}`,
			);
		}
		return r.decision;
	}

	/** The support log: one SetAsync, tagged with the buyer's UserId; never on Studio; a failure is only logged. */
	private writeAudit(receipt: SilverReceipt, g: SilverPurchaseGrant): void {
		if (RunService.IsStudio()) return;
		const [ok, err] = pcall(() =>
			this.audit.set(silverAuditKey(receipt.purchaseId), silverAuditRecord(receipt, g, os.time()), [
				receipt.playerId,
			]),
		);
		if (!ok) log.warn("AUDIT_FAILED", `${receipt.playerId} ${receipt.purchaseId}: ${tostring(err)}`);
	}

	/** `silverShopReport`: rate limit, re-read, log `SilverShop`. */
	private report(player: Player, raw: unknown): void {
		if (player.Parent === undefined || !this.reportLimiter.tryAcquire(player, os.clock())) return;
		const report = readSilverShopReport(raw);
		if (report === undefined) {
			log.warn("BAD_REPORT", `${player.UserId}: silverShopReport dropped`);
			return;
		}
		this.telemetry.logEvents(player, [silverShopReportEvent(report)]);
	}

	/** `silverShopFakeBuy` (Studio only, KV_FakeShop with prices): a fake receipt through the real purchase path. */
	private fakeBuy(player: Player, packId: unknown): void {
		if (!RunService.IsStudio()) return;
		if (player.Parent === undefined || !this.fakeLimiter.tryAcquire(player, os.clock())) return;
		this.fakeSerial++;
		const r = fakeSilverReceipt(player.UserId, packId, this.wallet.fakeShop(), this.fakeNonce, this.fakeSerial);
		if (r === undefined) {
			log.warn(
				"FAKE_REFUSED",
				`${player.UserId}: fake buy of ${tostring(packId)} (KV_FakeShop off or unknown pack)`,
			);
			return;
		}
		this.grant(r.receipt, r.pack, true);
	}
}
