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
	/**
	 * A grant whose transaction failed (every retry of the DataStore call errored) waits this many seconds and is tried
	 * again, up to `grantRetryMax` more times (the run-id ring makes a retry safe), and once more at BindToClose.
	 */
	readonly grantRetrySeconds: number;
	readonly grantRetryMax: number;
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
	grantRetrySeconds: 30,
	grantRetryMax: 10,
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
 * Cosmetics (docs/COSMETICS.md CS4), in the items part:
 *   "6000;outline.azure:1*"               an item ending in `*` is owned AND equipped in its slot
 *   "6000;cosmetics"                      every cosmetic owned, none equipped
 *   "6000;dressed"                        every cosmetic owned, WALLET_FAKE_DRESSED equipped
 */
export const WALLET_FAKE_ATTRIBUTE = "KV_FakeWallet";

/** Keywords of WALLET_FAKE_ATTRIBUTE (compared lower-cased; item ids are case-sensitive). */
export const WALLET_FAKE_KEYWORDS = table.freeze({
	unknown: "unknown",
	claimed: "claimed",
	cosmetics: "cosmetics",
	dressed: "dressed",
});

/** An item entry ending in this is equipped as well as owned (KV_FakeWallet). */
export const WALLET_FAKE_EQUIP_MARK = "*";

/**
 * The `dressed` preset's equipped cosmetics (one per slot: both Prismatic dyes, so either character shows the animated
 * dye, and a colour in each other slot that reads far from the defaults).
 */
export const WALLET_FAKE_DRESSED: ReadonlyArray<string> = table.freeze([
	"dye.knight.prismatic",
	"dye.archer.prismatic",
	"outline.azure",
	"trail.violet",
	"spark.jade",
]);

/** The Silver shop's tunables (docs/SILVER_SHOP.md): Silver for Robux through developer products. Data only. */
export interface SilverShopTunables {
	/** Granted PurchaseIds kept in the wallet doc (`receipts`), oldest dropped first (SHD2). */
	readonly receiptRing: number;
	/** The client shows "Your Silver is on its way" after this many seconds without the grant's push. */
	readonly pendingNoticeSec: number;
	/** DataStore of the best-effort purchase audit log (key `p_<PurchaseId>`; support only, never decides a grant). */
	readonly auditStore: string;
	/** The audit log's key prefix. */
	readonly auditKeyPrefix: string;
	/** Per-player budget for `silverShopReport` (funnel telemetry). */
	readonly reportRate: { readonly count: number; readonly windowSeconds: number };
	/** A funnel report's `seconds` (prompt -> settled) is clamped to this and rounded to `reportSecondsStep`. */
	readonly maxReportSeconds: number;
	readonly reportSecondsStep: number;
}

export const SILVER_SHOP: SilverShopTunables = table.freeze({
	receiptRing: 128,
	pendingNoticeSec: 15,
	auditStore: "KV_Purchases_v1",
	auditKeyPrefix: "p_",
	reportRate: table.freeze({ count: 10, windowSeconds: 10 }),
	maxReportSeconds: 600,
	reportSecondsStep: 0.1,
});

/**
 * Studio-only Workspace attribute (String): fake the shop (parseFakeShop). `off` hides it; four whole Robux prices in
 * shown-pack order (`20,55,115,265`) turn it on with those prices and grant a press straight into the Studio memory
 * store through the same transform, so the panel can be laid out before the products exist. Ignored on live servers.
 */
export const SILVER_SHOP_FAKE_ATTRIBUTE = "KV_FakeShop";

/** Keywords of SILVER_SHOP_FAKE_ATTRIBUTE (compared lower-cased). */
export const SILVER_SHOP_FAKE_KEYWORDS = table.freeze({ off: "off" });

/**
 * Robux-only cosmetics (docs/COSMETICS.md CSD13): every animated cosmetic is sold through a Roblox game pass. Data only.
 */
export interface CosmeticPassTunables {
	/**
	 * PromptGamePassPurchaseFinished said purchased: the server confirms with UserOwnsGamePassAsync this many times,
	 * `verifySeconds` apart, before it grants (an unconfirmed purchase is granted at the buyer's next join instead).
	 */
	readonly verifyTries: number;
	readonly verifySeconds: number;
	/** Per-player budget for Studio's `cosmeticPassFakeBuy`. */
	readonly fakeRate: { readonly count: number; readonly windowSeconds: number };
}

export const COSMETIC_PASS: CosmeticPassTunables = table.freeze({
	verifyTries: 3,
	verifySeconds: 2,
	fakeRate: table.freeze({ count: 5, windowSeconds: 10 }),
});

/**
 * Studio-only Workspace attribute (String): fake the Robux-only cosmetics' game passes (parseFakePasses). `off` takes
 * them off sale; one whole Robux price (`299`) puts every Robux-only cosmetic on sale at that price, and a press grants
 * it straight into the Studio memory store through the same transform, so the flow can be tried before the passes
 * exist. Ignored on live servers.
 */
export const COSMETIC_PASS_FAKE_ATTRIBUTE = "KV_FakePasses";

/** Keywords of COSMETIC_PASS_FAKE_ATTRIBUTE (compared lower-cased). */
export const COSMETIC_PASS_FAKE_KEYWORDS = table.freeze({ off: "off" });
