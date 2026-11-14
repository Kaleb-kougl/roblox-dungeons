/** Wallet tunables (docs/SILVER.md "Wallet (server)", SV2 / SV3). Data only. */
import { SETTINGS_RETRY, type RetryPolicy } from "shared/settings";

/**
 * The stored document's version. A stored doc of another version reads as empty; a transaction over a NEWER version is
 * refused (`newerVersion`), so an old server never clobbers a newer server's wallet.
 */
export const WALLET_DOC_VERSION = 1;

export interface WalletTunables {
	/** DataStore holding one WalletDoc per player, keyed by shared/settings `playerDataKey(userId)` (`u_<UserId>`). */
	readonly dataStore: string;
	/** The ring of granted run ids kept in the doc (a grant whose id is in it is a duplicate). */
	readonly runRing: number;
	/** Longest run id / item id / slot name kept or accepted (longer: dropped / refused). */
	readonly maxIdChars: number;
	/** Per-player budget for each of `requestWallet`, `walletBuy` and `walletEquip` (one limiter each). */
	readonly requestRate: { readonly count: number; readonly windowSeconds: number };
	/** Studio writes the DataStore (off: Studio transactions run on an in-memory overlay). */
	readonly writeFromStudio: boolean;
	/** The `walletEquip` item id that empties the slot. */
	readonly noItem: string;
	/** BindToClose: give up waiting for the last transactions after this many seconds (Roblox allows about 30). */
	readonly shutdownSeconds: number;
	/** BindToClose: how often it re-checks the pending transactions. */
	readonly shutdownPollSeconds: number;
	/** How many next goals `nextGoals` returns by default (the next one and the one after, SVD24). */
	readonly goals: number;
}

export const WALLET: WalletTunables = table.freeze({
	dataStore: "KV_Wallet_v1",
	runRing: 64,
	maxIdChars: 64,
	requestRate: table.freeze({ count: 5, windowSeconds: 10 }),
	writeFromStudio: false,
	noItem: "",
	shutdownSeconds: 25,
	shutdownPollSeconds: 0.1,
	goals: 2,
});

/** DataStore calls (the join load, each transaction): the settings policy (3 tries, waiting 1 s then 2 s). */
export const WALLET_RETRY: RetryPolicy = SETTINGS_RETRY;

/**
 * Studio-only Workspace attribute (String): a fake wallet for every player in this Studio session (transactions run on
 * it in memory; nothing is written). Ignored on live servers. Parsed by `parseFakeWallet`:
 *   "0"                                   an empty wallet
 *   "460"                                 460 Silver, nothing owned
 *   "460;vigor:2,character.archer:1"      460 Silver and those levels
 *   "unknown"                             not loaded (the Armory is greyed, the Knight only)
 *   "...;claimed"                         today's first-run and Daily bonuses already taken
 */
export const WALLET_FAKE_ATTRIBUTE = "KV_FakeWallet";

/** Keywords of WALLET_FAKE_ATTRIBUTE (compared lower-cased; item ids are case-sensitive). */
export const WALLET_FAKE_KEYWORDS = table.freeze({ unknown: "unknown", claimed: "claimed" });
