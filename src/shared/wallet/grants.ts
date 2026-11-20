/**
 * Grants at the verdict (docs/SILVER.md SV4, SVD6 / SVD7 / SVD30). Pure: RunSessionService.conclude builds the plan,
 * WalletService runs one grant transaction per credited member.
 *
 *   who      every CREDITED member (the list the leaderboard and records use: party runs' partyContributors), each paid
 *            the TEAM's run amount (the rows of the server's replay, SegmentedRunResult.silver) plus their own
 *            Prospector and day bonuses from their own stored doc
 *   which    accepted runs only; silverEligibility (endless / the Daily; never debug, dev, the tutorial or M1; Studio
 *            only with KV_FakeWallet). Abandoned-but-validated runs and private servers pay.
 *   days     the first-run bonus on the UTC day at the grant (dailyDay(now)); the Daily bonus on the day the Daily run
 *            started (its board's day, session.daily.day), so a Daily started before midnight pays that day's bonus
 *   once     the run id is the grant's idempotence key (applyGrant), so a re-concluded session or a retried
 *            transaction grants once
 *
 * @module
 */
import { DAILY_WORLD_KIND, dailyDay, type DailyRunKey } from "shared/daily";
import { silverEligibility, type RunSilver, type SilverIneligibleReason } from "shared/silver";
import { emptyWalletDoc, type WalletDoc } from "./doc";
import { grantBreakdown, type SilverGrantBreakdown, type WalletGrant, type WalletGrantContext } from "./transforms";

/** What conclude knows about a decided run. */
export interface RunGrantFacts {
	readonly runId: string;
	/** The server accepted the run. */
	readonly ok: boolean;
	/** SegmentedRunResult.silver (accepted runs). */
	readonly silver?: RunSilver;
	readonly worldKind: string;
	/** RunSession.debug. */
	readonly debug: boolean;
	/** A Studio session without KV_FakeWallet. */
	readonly studio: boolean;
	/** The credited members' UserIds. */
	readonly creditedIds: ReadonlyArray<number>;
	/** Unix seconds at the grant (os.time()). */
	readonly unixNow: number;
	/** RunSession.daily (a Daily run's day and ruleset). */
	readonly daily?: DailyRunKey;
}

/** Why a decided run grants nothing. */
export type RunGrantSkip = SilverIneligibleReason | "rejected" | "noSilver" | "nobody";

export interface RunGrantPlan {
	/** Set when nothing is granted. */
	readonly skip?: RunGrantSkip;
	readonly ctx: WalletGrantContext;
	/** The one grant every member gets (absent when skipped). */
	readonly grant?: WalletGrant;
	/** Who gets it, in credited order (empty when skipped). */
	readonly userIds: ReadonlyArray<number>;
}

/** The grant context of a run decided at `unixNow` (a Daily run: its start day too). */
export function grantContextOf(worldKind: string, unixNow: number, daily?: DailyRunKey): WalletGrantContext {
	const day = dailyDay(unixNow);
	return worldKind === DAILY_WORLD_KIND && daily !== undefined ? { day, dailyDay: daily.day } : { day };
}

export function planRunGrants(f: RunGrantFacts): RunGrantPlan {
	const ctx = grantContextOf(f.worldKind, f.unixNow, f.daily);
	const skip = (why: RunGrantSkip): RunGrantPlan => ({ skip: why, ctx, userIds: [] });
	if (!f.ok) return skip("rejected");
	if (f.silver === undefined) return skip("noSilver");
	const why = silverEligibility(f.worldKind, { debug: f.debug, studio: f.studio });
	if (why !== undefined) return skip(why);
	if (f.creditedIds.size() === 0) return skip("nobody");
	const grant: WalletGrant = {
		runId: f.runId,
		run: f.silver,
		daily: f.worldKind === DAILY_WORLD_KIND && ctx.dailyDay !== undefined,
	};
	return { ctx, grant, userIds: [...f.creditedIds] };
}

/**
 * The verdict's predicted breakdown per member (RunFinishVerdict.silver): the grant on each member's SESSION copy (an
 * unknown wallet: an empty one, so its bonuses read as open). The settling `wallet` push carries the real one.
 */
export function predictRunGrants(
	plan: RunGrantPlan,
	docOf: (userId: number) => Readonly<WalletDoc> | undefined,
): Map<number, SilverGrantBreakdown> {
	const out = new Map<number, SilverGrantBreakdown>();
	const grant = plan.grant;
	if (grant === undefined) return out;
	for (const id of plan.userIds) out.set(id, grantBreakdown(docOf(id) ?? emptyWalletDoc(), grant, plan.ctx));
	return out;
}
