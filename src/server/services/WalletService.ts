import { OnStart, Service } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, Workspace } from "@rbxts/services";
import { dailyClockNow } from "server/config";
import { serverLogger } from "server/log";
import { Events } from "server/network";
import type { CharacterId } from "shared/characters";
import { dailyDay } from "shared/daily";
import { SlidingWindowLimiter } from "shared/run";
import { playerDataKey } from "shared/settings";
import {
	MemoryWalletStore,
	WALLET,
	WALLET_FAKE_ATTRIBUTE,
	WalletBook,
	armoryPurchaseEvent,
	encodeWalletDoc,
	grantEconomyEvents,
	parseFakeWallet,
	predictRunGrants,
	purchaseEconomyEvent,
	type FakeWallet,
	type RunGrantPlan,
	type SilverGrantBreakdown,
	type WalletActionResult,
	type WalletStatus,
	type WalletStore,
	type WalletTxOutcome,
	type WalletUpgradeLevels,
} from "shared/wallet";
import { WalletTransactions } from "./data/WalletTransactions";
import { SilverAccessService } from "./SilverAccessService";
import { TelemetryService } from "./TelemetryService";

const log = serverLogger("Wallet");

/**
 * Silver's wallet, server side (docs/SILVER.md "Wallet (server)", SV3; docs/SERVER.md "Wallet"): each player's balance,
 * Armory levels and day-bonus marks in DataStore WALLET.dataStore (`KV_Wallet_v1`, key `u_<UserId>`). Every rule is pure
 * in shared/wallet (WalletBook: the transactions and read copies; transforms.ts: grant / buy / equip); this service only
 * loads, gates, sends and logs.
 *
 * Every change is its own UpdateAsync transaction (data/WalletTransactions) re-reading the stored doc (SVD5); the
 * session copy is a READ copy replaced by each transaction's result and never saved, so there is nothing to write on
 * leave or BindToClose (which only waits, bounded, for transactions still running and for runs still validating, whose
 * verdicts grant). A FAILED join load sends `{ loaded: false }` for the session: the Armory is greyed, runs start as the
 * Knight with no upgrades (`effectiveUpgrades` undefined, `ownsCharacter` the Knight only), yet grants still land with
 * their bonuses (their transaction reads the stored doc).
 *
 * Remotes: `requestWallet` (answered once the join load ended; an earlier one is answered by the join-end push),
 * `walletBuy(itemId)` and `walletEquip(slot, itemId)`, each with its own per-player limiter at WALLET.requestRate (a call
 * over it is dropped and answered with the current status), one request in flight per player (`busy`), refused before
 * the load (`notLoaded`). The price is the catalogue's. Each answer is a `wallet` push with `result`; a purchase logs an
 * economy Sink and `ArmoryPurchase` (TelemetryService).
 *
 * Grants (`grantRun`, RunSessionService.conclude): one transaction per credited member, spawned (conclude may run on
 * Heartbeat, so this never yields); returns the breakdowns predicted from the session copies for the verdict; after each
 * transaction the member (if still here) gets a `wallet` push with the settled `grant` and the economy Sources.
 *
 * Studio: nothing is written. Transactions run on an in-memory store (shared/wallet MemoryWalletStore) that falls back
 * to reading the real DataStore. Workspace attribute WALLET_FAKE_ATTRIBUTE (`KV_FakeWallet`, parseFakeWallet; Studio
 * only) replaces every player's stored doc in that memory store (`unknown`: the wallet unknown for the session); a
 * change of the attribute resets the memory store, reloads every player and pushes their status.
 *
 * Seams for other services (Track H): `effectiveUpgrades(userId)`, `ownsCharacter(userId, characterId)`.
 */
@Service({})
export class WalletService implements OnStart {
	private readonly janitor = new Janitor();
	private readonly real = new WalletTransactions(WALLET.dataStore);
	private readonly book: WalletBook;
	private readonly requestLimiter = new SlidingWindowLimiter<Player>(
		WALLET.requestRate.count,
		WALLET.requestRate.windowSeconds,
	);
	private readonly buyLimiter = new SlidingWindowLimiter<Player>(
		WALLET.requestRate.count,
		WALLET.requestRate.windowSeconds,
	);
	private readonly equipLimiter = new SlidingWindowLimiter<Player>(
		WALLET.requestRate.count,
		WALLET.requestRate.windowSeconds,
	);
	/** Players whose join load ended: only they are sent `wallet`. */
	private readonly ready = new Set<Player>();
	/** RunSessionService: runs still validating whose verdict may grant (BindToClose waits for them). */
	private pendingRuns: () => number = () => 0;
	/** The Studio fake's attribute value the memory store was made for. */
	private fakeSource: string | undefined;
	/** Studio: the in-memory store the book transacts on. */
	private memory: MemoryWalletStore | undefined;

	constructor(
		private readonly telemetry: TelemetryService,
		private readonly silverAccess: SilverAccessService,
	) {
		this.book = new WalletBook(this.createStore(), {
			keyOf: playerDataKey,
			wait: (s) => task.wait(s),
		});
		// docs/SILVER.md SV6 / SV17: run starts and lobbies read each member's upgrade levels and owned characters here
		// (an unknown wallet: no upgrades, the Knight only), wired at construction so no start sees the open default.
		this.silverAccess.setSilverAccess({
			upgradesFor: (userId) => this.effectiveUpgrades(userId),
			ownsCharacter: (userId, characterId) => this.ownsCharacter(userId, characterId),
		});
	}

	onStart(): void {
		this.janitor.Add(Players.PlayerAdded.Connect((player) => this.loadAndSend(player)));
		for (const player of Players.GetPlayers()) task.spawn(() => this.loadAndSend(player));
		this.janitor.Add(Players.PlayerRemoving.Connect((player) => this.release(player)));
		if (RunService.IsStudio()) {
			this.janitor.Add(
				Workspace.GetAttributeChangedSignal(WALLET_FAKE_ATTRIBUTE).Connect(() => this.resetFake()),
			);
		}

		this.janitor.Add(
			Events.requestWallet.connect((player) => {
				if (player.Parent === undefined) return;
				if (!this.requestLimiter.tryAcquire(player, os.clock())) {
					log.warn("RATE_LIMITED", `${player.UserId}: requestWallet dropped`);
					return;
				}
				this.send(player);
			}),
		);
		this.janitor.Add(
			Events.walletBuy.connect((player, itemId) => {
				if (player.Parent === undefined) return;
				if (!this.buyLimiter.tryAcquire(player, os.clock())) {
					this.answer(player, { action: "buy", itemId, ok: false, reason: "busy" });
					return;
				}
				const r = this.book.buy(player.UserId, itemId);
				this.afterRequest(player, r.result, r.outcome);
			}),
		);
		this.janitor.Add(
			Events.walletEquip.connect((player, slot, itemId) => {
				if (player.Parent === undefined) return;
				if (!this.equipLimiter.tryAcquire(player, os.clock())) {
					this.answer(player, { action: "equip", itemId, ok: false, reason: "busy" });
					return;
				}
				const r = this.book.equip(player.UserId, slot, itemId);
				this.afterRequest(player, r.result, r.outcome);
			}),
		);
		game.BindToClose(() => this.waitOnClose());
	}

	/** RunSessionService: how many of its runs may still produce a verdict (BindToClose waits for them first). */
	setPendingRuns(count: () => number): void {
		this.pendingRuns = count;
	}

	/**
	 * The levels a run started now applies for `userId` (shared/wallet walletUpgradeLevels), or undefined when their
	 * wallet is not loaded (not in this server, the join load failed or is still running, the fake `unknown`): no
	 * upgrades. Seam for the run start (Track H). Never yields.
	 */
	effectiveUpgrades(userId: number): WalletUpgradeLevels | undefined {
		return this.book.effectiveUpgrades(userId);
	}

	/** Whether `userId` may play `characterId` (the Knight always; an unknown wallet: the Knight only). Never yields. */
	ownsCharacter(userId: number, characterId: CharacterId): boolean {
		return this.book.ownsCharacter(userId, characterId);
	}

	/** Studio with KV_FakeWallet set: such runs pay (into the fake), so the grant path can be tested in Studio. */
	fakeActive(): boolean {
		return this.fake() !== undefined;
	}

	/**
	 * A decided run's grants (shared/wallet planRunGrants; see the class comment). Returns each member's PREDICTED
	 * breakdown by UserId (for RunFinishVerdict.silver). Never yields.
	 */
	grantRun(plan: RunGrantPlan): Map<number, SilverGrantBreakdown> {
		const grant = plan.grant;
		if (grant === undefined) return new Map();
		const predicted = predictRunGrants(plan, (id) => this.book.doc(id));
		for (const userId of plan.userIds) {
			task.spawn(() => {
				const r = this.book.grant(userId, grant, plan.ctx);
				if (!r.ok) {
					log.warn("GRANT_FAILED", `${userId} run ${grant.runId}: ${r.error}`);
					return;
				}
				const o = r.outcome;
				if (!o.ok) {
					log.info("GRANT_REFUSED", `${userId} run ${grant.runId}: ${o.reason ?? "?"}`);
					return;
				}
				const b = o.breakdown!;
				log.info("GRANT", `${userId} run ${grant.runId}: +${b.total} (balance ${b.balance})`);
				const player = Players.GetPlayerByUserId(userId);
				if (player === undefined) return;
				this.telemetry.logEconomy(player, grantEconomyEvents(b));
				if (player.Parent !== undefined && this.ready.has(player)) {
					const status = this.status(player);
					status.grant = b;
					Events.wallet.fire(player, status);
				}
			});
		}
		return predicted;
	}

	private afterRequest(player: Player, result: WalletActionResult, outcome: WalletTxOutcome | undefined): void {
		if (outcome?.purchase !== undefined) {
			const p = outcome.purchase;
			log.info("BUY", `${player.UserId} ${p.itemId} ${p.level} for ${p.price} (balance ${p.balance})`);
			this.telemetry.logEconomy(player, [purchaseEconomyEvent(p)]);
			this.telemetry.logEvents(player, [armoryPurchaseEvent(p)]);
		} else if (!result.ok) {
			log.info("REFUSED", `${player.UserId} ${result.action} ${result.itemId}: ${result.reason ?? "?"}`);
		}
		this.answer(player, result);
	}

	private answer(player: Player, result: WalletActionResult): void {
		if (player.Parent === undefined || !this.ready.has(player)) return;
		const status = this.status(player);
		status.result = result;
		Events.wallet.fire(player, status);
	}

	private day(): number {
		return dailyDay(dailyClockNow());
	}

	private status(player: Player): WalletStatus {
		return this.book.status(player.UserId, this.day());
	}

	/** Sends the player's status, only once their join load ended. */
	private send(player: Player): void {
		if (player.Parent !== undefined && this.ready.has(player)) Events.wallet.fire(player, this.status(player));
	}

	/** The store: the DataStore on live servers; in Studio an in-memory store over its reads (or the fake). */
	protected createStore(): WalletStore {
		if (!RunService.IsStudio() || WALLET.writeFromStudio) return this.real;
		this.memory = new MemoryWalletStore((key) => this.real.get(key));
		return this.memory;
	}

	/** The Studio fake in force, or undefined (live servers, attribute unset or unparsable). */
	private fake(): FakeWallet | undefined {
		if (!RunService.IsStudio()) return undefined;
		const raw = Workspace.GetAttribute(WALLET_FAKE_ATTRIBUTE);
		if (raw === undefined) return undefined;
		const fake = parseFakeWallet(raw, this.day());
		if (fake === undefined) log.warn("BAD_FAKE", `${WALLET_FAKE_ATTRIBUTE} = ${tostring(raw)} ignored`);
		return fake;
	}

	/** Studio: a fresh memory store for the attribute's current value (seeded per player as they load). */
	private resetFake(): void {
		this.fakeSource = undefined;
		this.book.setStore(this.createStore());
		for (const player of Players.GetPlayers()) task.spawn(() => this.loadAndSend(player));
	}

	/** The Studio fake in force; a changed attribute value gets a fresh memory store first. */
	private currentFake(): FakeWallet | undefined {
		const fake = this.fake();
		if (fake === undefined) return undefined;
		const source = tostring(Workspace.GetAttribute(WALLET_FAKE_ATTRIBUTE));
		if (this.fakeSource !== source) {
			this.fakeSource = source;
			this.book.setStore(this.createStore());
		}
		return fake;
	}

	private loadAndSend(player: Player): void {
		const userId = player.UserId;
		const fake = this.currentFake();
		if (fake !== undefined && !fake.loaded) {
			this.book.markUnknown(userId);
		} else {
			if (fake !== undefined) this.seedMemory(userId, fake);
			const ok = this.book.load(userId);
			if (!ok) log.warn("LOAD_FAILED", `${userId}: wallet unknown this session`);
		}
		if (player.Parent === undefined) {
			this.release(player);
			return;
		}
		this.ready.add(player);
		this.send(player);
	}

	/** Puts the fake's doc into the Studio memory store for `userId`. */
	private seedMemory(userId: number, fake: FakeWallet): void {
		this.memory?.set(playerDataKey(userId), encodeWalletDoc(fake.doc));
	}

	private release(player: Player): void {
		this.requestLimiter.forget(player);
		this.buyLimiter.forget(player);
		this.equipLimiter.forget(player);
		this.ready.delete(player);
		this.book.forget(player.UserId);
	}

	/** Waits (bounded) for runs still validating, then for transactions still running. Nothing is saved. */
	private waitOnClose(): void {
		const deadline = os.clock() + WALLET.shutdownSeconds;
		while ((this.pendingRuns() > 0 || this.book.pending() > 0) && os.clock() < deadline) {
			task.wait(WALLET.shutdownPollSeconds);
		}
		if (this.book.pending() > 0) log.warn("SHUTDOWN_TIMEOUT", `${this.book.pending()} transactions still running`);
	}
}
