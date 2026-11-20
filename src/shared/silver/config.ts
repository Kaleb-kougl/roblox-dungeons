import { DAILY_WORLD_KIND } from "shared/daily";

/**
 * Silver tunables (docs/SILVER.md "Earn table", SV1). Data only. Every number is *(tune)*: the SV1 census measures them.
 */

/** A run row: one earn source read from the replayed state (docs/SILVER.md "Earn table"). */
export type SilverRowId = "rooms" | "crates" | "floors" | "bosses" | "vaults" | "secrets" | "goldlings" | "kills";

/** Every run row, in the earn table's order (the recap and the economy events list them so). Append only. */
export const SILVER_ROWS: ReadonlyArray<SilverRowId> = table.freeze([
	"rooms",
	"crates",
	"floors",
	"bosses",
	"vaults",
	"secrets",
	"goldlings",
	"kills",
]);

/**
 * The Silver earn table's numbers, in one frozen object (`SILVER`): what each run row pays, the run minimum and its
 * room requirement, the two per-day bonuses and the Prospector upgrade's percentage. Amounts are whole Silver; every
 * calculation is integer math.
 */
export interface SilverTunables {
	/** Silver per room cleared (`counts[ROOMS]`: rooms with a score record; never the boss room). */
	readonly roomPay: number;
	/** A floor n cleared (descended from) pays floorBase + n. */
	readonly floorBase: number;
	/** The k-th boss kill pays bossPerDepth x the Depth it reached (startDepth + k). */
	readonly bossPerDepth: number;
	/** Each vault chest opened. */
	readonly vaultOpened: number;
	/** Each secret room opened (whether or not its chest is taken). */
	readonly secretFound: number;
	/** Each Goldling caught. */
	readonly goldlingCaught: number;
	/** One Silver per this many kills (floored). */
	readonly killsPerSilver: number;
	/** A run that cleared at least `minimumRooms` rooms is topped up to this (SVD25). */
	readonly runMinimum: number;
	/** Rooms a run must clear for the minimum (the two-room rule: no pay for instant deaths). */
	readonly minimumRooms: number;
	/** The first paying run of each UTC day, per player (applied at the grant). */
	readonly firstRunBonus: number;
	/** The first accepted Daily finish of each UTC day, per player (OC17; applied at the grant). */
	readonly dailyBonus: number;
	/** Prospector: + this many percent of the run amount per level (SVD27: never on the top-up or a bonus). */
	readonly prospectorPercentPerLevel: number;
	/** Percent base of the Prospector bonus (integer math: floor(sum x percent / percentBase)). */
	readonly percentBase: number;
}

/**
 * The live earn table (every number still marked to tune): 2 per room cleared, 5 + n for floor n, 40 times the Depth
 * per boss kill, 15 per vault opened, 25 per secret room, 30 per Goldling caught, 1 per 10 kills; a run that cleared at
 * least 2 rooms is topped up to 20; 50 for the first paying run and 50 for the first Daily finish of a UTC day;
 * Prospector adds 5 % of the run amount per level.
 */
export const SILVER: SilverTunables = table.freeze({
	roomPay: 2,
	floorBase: 5,
	bossPerDepth: 40,
	vaultOpened: 15,
	secretFound: 25,
	goldlingCaught: 30,
	killsPerSilver: 10,
	runMinimum: 20,
	minimumRooms: 2,
	firstRunBonus: 50,
	dailyBonus: 50,
	prospectorPercentPerLevel: 5,
	percentBase: 100,
});

/**
 * World kinds whose runs pay (docs/SILVER.md "What never pays": endless solo / co-op and the Daily). "endless" is
 * shared/run `ENDLESS_WORLD_KIND` (policy.spec pins it): shared/silver must not import shared/run, whose segments.ts
 * reads Silver through this module (a require cycle through the barrels).
 */
export const SILVER_PAYING_WORLDS: ReadonlyArray<string> = table.freeze(["endless", DAILY_WORLD_KIND]);
