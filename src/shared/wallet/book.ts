/**
 * The server's wallet book (docs/SILVER.md "Wallet (server)", SV3): every wallet change as its own store transaction,
 * and the per-player READ copies they leave behind. Pure (the store and the wait are injected); WalletService is a
 * thin shell around it (remotes, rate limits, the Studio fake, telemetry, sends).
 *
 *   load        the join load: one read (with retries). A failed read leaves the player `loaded: false` for the
 *               session: the Armory greyed, the Knight only, no upgrades. Grants still land (their transaction reads
 *               the stored doc, not the copy).
 *   transact    one WalletOp inside `store.update` (UpdateAsync on the server): walletTransaction re-reads the stored
 *               value, so concurrent servers compose; the transform may run several times, the last run's outcome
 *               stands. Retried on errors (WALLET_RETRY). Transactions of one player run one at a time on this server
 *               (a lock; `wait` polls), so the read copy is replaced in the order they were applied. The copy is
 *               replaced by each result of a loaded player and never saved.
 *   buy / equip a client request: refused before the load or after a failed one (`notLoaded`) and while another of the
 *               player's requests is in flight (`busy`: one at a time); the price is the catalogue's (the remote carries
 *               an item id only).
 *   grant       a run's grant (applyGrant's rules), whatever the load did.
 *   purchase    a developer-product receipt (docs/SILVER_SHOP.md SH2 / SH3), whatever the load did and whether or not the
 *               buyer is still here (SHD4); answers Roblox's decision (receiptDecision).
 *   grantPass   a Robux-only cosmetic whose game pass Roblox says the player owns (docs/COSMETICS.md CSD13), whatever
 *               the load did; owned already: no write.
 *
 * @module
 */
import { withRetries, type RetryPolicy } from "shared/settings";
import type { CharacterId } from "shared/characters";
import { WALLET, WALLET_DOC_VERSION, WALLET_RETRY } from "./config";
import {
	decodeWalletDoc,
	ownedLevel,
	ownsCharacter,
	walletDocVersionOf,
	walletEquipped,
	walletUpgradeLevels,
	type WalletDoc,
	type WalletUpgradeLevels,
} from "./doc";
import { armoryItem, itemTier, tierPrice } from "./catalog";
import {
	receiptDecision,
	type SilverPack,
	type SilverPurchaseGrant,
	type SilverReceipt,
	type SilverReceiptDecision,
} from "./shop";
import { walletStatusOf, type WalletActionResult, type WalletStatus } from "./status";
import {
	walletTransaction,
	type WalletGrant,
	type WalletGrantContext,
	type WalletOp,
	type WalletRefusal,
	type WalletTxOutcome,
} from "./transforms";

/** A store with atomic read-modify-write (DataStore UpdateAsync on the server). Calls may yield and throw. */
export interface WalletStore {
	get(key: string): unknown;
	/** Runs `transform(stored)` atomically; its result is written (undefined: the write is cancelled). */
	update(key: string, transform: (stored: unknown) => unknown, userIds?: ReadonlyArray<number>): void;
}

/**
 * An in-memory WalletStore (Studio and specs): a value per key, falling back to `fallback` (a read-only real store)
 * for keys it does not hold yet. Writes stay in memory.
 */
export class MemoryWalletStore implements WalletStore {
	private readonly values = new Map<string, unknown>();

	constructor(private readonly fallback?: (key: string) => unknown) {}

	get(key: string): unknown {
		if (this.values.has(key)) return this.values.get(key);
		return this.fallback !== undefined ? this.fallback(key) : undefined;
	}

	update(key: string, transform: (stored: unknown) => unknown): void {
		const written = transform(this.get(key));
		if (written !== undefined) this.values.set(key, written);
	}

	/** Puts a value (the Studio fake's starting doc). */
	set(key: string, value: unknown): void {
		this.values.set(key, value);
	}

	/** Forgets every value (the fake changed). */
	clear(): void {
		this.values.clear();
	}
}

/** A transaction's result: the outcome, or the store's error after every retry. */
export type WalletBookOutcome =
	| { readonly ok: true; readonly outcome: WalletTxOutcome }
	| { readonly ok: false; readonly error: string };

/** A receipt's result (WalletBook.purchase). */
export interface SilverPurchaseBookResult {
	/** Roblox's answer. */
	readonly decision: SilverReceiptDecision;
	/** The grant, when this delivery granted it (absent for a duplicate or a refusal). */
	readonly grant?: SilverPurchaseGrant;
	/** Why it did not grant: a refusal (`duplicate` among them), or `failed` (the store errored every retry). */
	readonly reason?: WalletRefusal | "failed";
	/** The store's error after every retry. */
	readonly error?: string;
}

/** A pass grant's result (WalletBook.grantPass). */
export interface WalletPassBookResult {
	/** The item is owned now. */
	readonly ok: boolean;
	/** This call made it owned (false: owned already, or refused). */
	readonly granted: boolean;
	readonly reason?: WalletRefusal | "failed";
	readonly error?: string;
}

/** A player's read copy. */
interface Copy {
	loaded: boolean;
	doc?: WalletDoc;
}

export interface WalletBookOptions {
	readonly retry?: RetryPolicy;
	/** Sleeps (task.wait on the server; a no-op in specs). */
	readonly wait?: (seconds: number) => void;
	/** The lock's poll interval (seconds). */
	readonly pollSeconds?: number;
	/** The key of a player's doc (shared/settings playerDataKey). */
	readonly keyOf: (userId: number) => string;
}

export class WalletBook {
	private readonly copies = new Map<number, Copy>();
	/** Players with a transaction running on this server. */
	private readonly locked = new Set<number>();
	/** Players with a client request (buy / equip) queued or running. */
	private readonly requesting = new Set<number>();
	private readonly retry: RetryPolicy;
	private readonly wait: (seconds: number) => void;
	private readonly poll: number;
	private pendingCount = 0;

	constructor(private store: WalletStore, private readonly options: WalletBookOptions) {
		this.retry = options.retry ?? WALLET_RETRY;
		this.wait = options.wait ?? (() => {});
		this.poll = options.pollSeconds ?? WALLET.shutdownPollSeconds;
	}

	/** Replaces the store (the Studio fake changed: a fresh in-memory store). */
	setStore(store: WalletStore): void {
		this.store = store;
	}

	/** The join load (may yield). Returns whether it loaded. */
	load(userId: number): boolean {
		const key = this.options.keyOf(userId);
		const r = withRetries(() => this.store.get(key), this.retry, this.wait);
		if (!r.ok) {
			this.copies.set(userId, { loaded: false });
			return false;
		}
		// A doc written by a newer build (a rolling update): unknown here, never shown as an empty wallet (its
		// transactions refuse it too, walletTransaction's newerVersion).
		const version = walletDocVersionOf(r.value);
		if (version !== undefined && version > WALLET_DOC_VERSION) {
			this.copies.set(userId, { loaded: false });
			return false;
		}
		this.copies.set(userId, { loaded: true, doc: decodeWalletDoc(r.value) });
		return true;
	}

	/** Marks a player's wallet unknown for the session without reading (the Studio fake `unknown`). */
	markUnknown(userId: number): void {
		this.copies.set(userId, { loaded: false });
	}

	/** The player left: their copy goes (transactions still running finish on the store). */
	forget(userId: number): void {
		this.copies.delete(userId);
		this.requesting.delete(userId);
	}

	/** The player's join load ran (loaded or failed). */
	hasCopy(userId: number): boolean {
		return this.copies.has(userId);
	}

	isLoaded(userId: number): boolean {
		return this.copies.get(userId)?.loaded === true;
	}

	/** The player's read copy (loaded players only). */
	doc(userId: number): Readonly<WalletDoc> | undefined {
		const c = this.copies.get(userId);
		return c !== undefined && c.loaded ? c.doc : undefined;
	}

	/** The levels the next run applies, or undefined when the wallet is not loaded (no upgrades). */
	effectiveUpgrades(userId: number): WalletUpgradeLevels | undefined {
		const d = this.doc(userId);
		return d !== undefined ? walletUpgradeLevels(d) : undefined;
	}

	/** The player may pick `id` (an unknown wallet: the Knight only). */
	ownsCharacter(userId: number, id: CharacterId): boolean {
		return ownsCharacter(this.doc(userId), id);
	}

	/** The cosmetics the player wears (walletEquipped), or undefined when their wallet is not loaded. */
	equipped(userId: number): Map<string, string> | undefined {
		return walletEquipped(this.doc(userId));
	}

	/** The `wallet` payload of the player on UTC day `day`. */
	status(userId: number, day: number): WalletStatus {
		const c = this.copies.get(userId);
		return walletStatusOf(c?.doc, c?.loaded === true, day);
	}

	/** Transactions running or waiting for their turn (BindToClose waits for them). */
	pending(): number {
		return this.pendingCount;
	}

	/** One op as a transaction (module comment). May yield. */
	transact(userId: number, op: WalletOp): WalletBookOutcome {
		this.pendingCount++;
		while (this.locked.has(userId)) this.wait(this.poll);
		this.locked.add(userId);
		const key = this.options.keyOf(userId);
		const r = withRetries(
			() => {
				const box: { last?: WalletTxOutcome } = {};
				this.store.update(
					key,
					(stored) => {
						const out = walletTransaction(stored, op);
						box.last = out;
						return out.write;
					},
					[userId],
				);
				const last = box.last;
				if (last === undefined) error("wallet transform never ran", 0);
				return last;
			},
			this.retry,
			this.wait,
		);
		this.locked.delete(userId);
		this.pendingCount--;
		if (!r.ok) return { ok: false, error: r.error };
		const outcome = r.value;
		const c = this.copies.get(userId);
		if (c !== undefined && c.loaded) c.doc = outcome.doc;
		return { ok: true, outcome };
	}

	/** A run's grant (works whether or not the player's wallet loaded). May yield. */
	grant(userId: number, grant: WalletGrant, ctx: WalletGrantContext): WalletBookOutcome {
		return this.transact(userId, { kind: "grant", grant, ctx });
	}

	/**
	 * A developer-product receipt for player `userId` (`pack` undefined: not a Silver pack here). Runs on the stored doc
	 * through the same lock and retries, loaded or not; replaces the read copy when loaded. May yield.
	 */
	purchase(userId: number, receipt: SilverReceipt, pack: SilverPack | undefined): SilverPurchaseBookResult {
		const r = this.transact(userId, { kind: "silverPurchase", receipt, pack });
		const decision = receiptDecision(r);
		if (!r.ok) return { decision, reason: "failed", error: r.error };
		const o = r.outcome;
		if (o.silverPurchase !== undefined) return { decision, grant: o.silverPurchase };
		return { decision, reason: o.reason };
	}

	/**
	 * A Robux-only cosmetic whose game pass `userId` owns (transforms.ts applyPassGrant): the stored doc through the same
	 * lock and retries, loaded or not; replaces the read copy when loaded. May yield.
	 */
	grantPass(userId: number, itemId: string): WalletPassBookResult {
		const r = this.transact(userId, { kind: "passGrant", itemId });
		if (!r.ok) return { ok: false, granted: false, reason: "failed", error: r.error };
		const o = r.outcome;
		if (!o.ok) return { ok: false, granted: false, reason: o.reason };
		return { ok: true, granted: o.passGranted === true };
	}

	/** A client's `walletBuy`. May yield. */
	buy(userId: number, itemId: string): { readonly result: WalletActionResult; readonly outcome?: WalletTxOutcome } {
		// The level the player chose (the session copy's next one): a retried write that already committed answers
		// `stale`, which is reported as the purchase it was (request below).
		const level = ownedLevel(this.doc(userId), typeIs(itemId, "string") ? itemId : "") + 1;
		return this.request(userId, "buy", itemId, { kind: "buy", itemId, level });
	}

	/** A client's `walletEquip` (`itemId` WALLET.noItem empties the slot). May yield. */
	equip(
		userId: number,
		slot: string,
		itemId: string,
	): { readonly result: WalletActionResult; readonly outcome?: WalletTxOutcome } {
		return this.request(userId, "equip", itemId, { kind: "equip", slot, itemId });
	}

	private request(
		userId: number,
		action: WalletActionResult["action"],
		itemId: string,
		op: WalletOp,
	): { readonly result: WalletActionResult; readonly outcome?: WalletTxOutcome } {
		const id = typeIs(itemId, "string") ? itemId : "";
		if (!this.isLoaded(userId)) return { result: { action, itemId: id, ok: false, reason: "notLoaded" } };
		if (this.requesting.has(userId)) return { result: { action, itemId: id, ok: false, reason: "busy" } };
		this.requesting.add(userId);
		const r = this.transact(userId, op);
		this.requesting.delete(userId);
		if (!r.ok) return { result: { action, itemId: id, ok: false, reason: "failed" } };
		const o = r.outcome;
		// A stale buy whose level is already in the stored doc went through on an earlier try of the same request.
		if (op.kind === "buy" && o.reason === "stale" && op.level !== undefined && ownedLevel(o.doc, id) >= op.level) {
			const it = armoryItem(id);
			const tier = it !== undefined ? itemTier(it, op.level) : undefined;
			const done: WalletActionResult = { action, itemId: id, ok: true, level: op.level };
			if (tier !== undefined) done.price = tierPrice(tier);
			return { result: done, outcome: o };
		}
		const result: WalletActionResult = { action, itemId: id, ok: o.ok };
		if (o.reason !== undefined) result.reason = o.reason;
		if (o.purchase !== undefined) {
			result.level = o.purchase.level;
			result.price = o.purchase.price;
		}
		return { result, outcome: o };
	}
}
