/**
 * Pure rules of the run services (server/services RunValidationService and RunSessionService) that decide something:
 * which limits a Studio session validates under, the verdict of a submission that was never replayed, and what one
 * recipient's copy of a run's verdict carries. Moved out of the services so they run headlessly (docs/SERVER_CENSUS.md);
 * the services keep the engine reads (RunService, Workspace attributes) and the remotes.
 *
 * @module
 */
import type { DailyRunResult } from "shared/daily";
import type { RunFinishVerdict, RunVerdict } from "shared/network";
import type { RunRecordsResult } from "shared/records";
import type { SilverGrantBreakdown } from "shared/wallet";
import { LIVE_RUN_LIMITS, type RunLimits, type RunWorld } from "./limits";

/** The worlds Studio's run-world attribute (RunValidationService RUN_WORLD_ATTRIBUTE) may select. */
export const STUDIO_RUN_WORLDS: ReadonlyArray<RunWorld> = ["game", "endless", "dungeonNoEncounter", "greybox"];

/**
 * The limits a STUDIO session validates under: LIVE_RUN_LIMITS, relaxed by the two Workspace attributes as read
 * (`allowDebugRuns` exactly `true`: debug input bits and boss-door starts; `world` one of STUDIO_RUN_WORLDS: that
 * world). Anything else changes nothing. A live server never calls this: it uses LIVE_RUN_LIMITS whatever the
 * attributes say (RunValidationService.limits).
 */
export function studioRunLimits(allowDebugRuns: unknown, world: unknown): RunLimits {
	let limits: RunLimits = LIVE_RUN_LIMITS;
	if (allowDebugRuns === true) {
		limits = { ...limits, allowDebugInput: true, allowBossDoorSpawn: true };
	}
	if (typeIs(world, "string") && STUDIO_RUN_WORLDS.includes(world as RunWorld)) {
		limits = { ...limits, world: world as RunWorld };
	}
	return limits;
}

/**
 * The verdict of a `submitRun` the server did not replay (`busy`: the player's earlier runs are still being checked;
 * `rate_limited`: over RUN_SUBMIT_RATE): refused, no server hash, an empty summary, the claimed hash echoed.
 */
export function gateVerdict(claimedHash: string, code: "rate_limited" | "busy", reason: string): RunVerdict {
	return {
		ok: false,
		claimedHash,
		code,
		reason,
		serverHash: "",
		summary: { ticks: 0, kills: 0, bossDefeated: false, died: false },
	};
}

/**
 * `verdict` with one recipient's personal records result, daily board result and predicted Silver grant (a copy; the
 * verdict itself when there is none of them).
 */
export function forRecipient(
	verdict: RunFinishVerdict,
	records: RunRecordsResult | undefined,
	daily: DailyRunResult | undefined,
	silver: SilverGrantBreakdown | undefined,
): RunFinishVerdict {
	if (records === undefined && daily === undefined && silver === undefined) return verdict;
	const out: RunFinishVerdict = { ...verdict };
	if (records !== undefined) out.records = records;
	if (daily !== undefined) out.daily = daily;
	if (silver !== undefined) out.silver = silver;
	return out;
}
