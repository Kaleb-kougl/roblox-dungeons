/**
 * Which accepted runs count toward personal records (docs/NEW_BEST.md, owner decisions NBD3 / NBD4). Pure.
 *
 * Like the leaderboard (shared/leaderboard leaderboardEligibility) except where the plan says otherwise: abandoned
 * (quit) validated runs count (NBD4), private servers count, Studio counts only with `writeFromStudio`. Debug runs,
 * other worlds, bad party sizes and party runs with fewer than COOP_MIN_PARTY contributors never count, as on the
 * leaderboard. Only ACCEPTED verdicts get here: rejected and expired runs never write.
 */
import {
	COOP_MIN_PARTY,
	LEADERBOARD_DEATH_ONLY_WORLDS,
	LEADERBOARD_ELIGIBLE_WORLDS,
	MAX_PARTY_SIZE,
} from "shared/leaderboard";

export interface RecordsPolicy {
	/** World kinds whose validated runs count (the endless descent). */
	readonly eligibleWorlds: ReadonlyArray<string>;
	/** Worlds whose runs only end in death (the endless descent): a run there that did not die was abandoned. */
	readonly deathOnlyWorlds: ReadonlyArray<string>;
	/** Abandoned (quit / Leave run) validated runs count (NBD4). */
	readonly countAbandoned: boolean;
	/** VIP (owned) private servers write records. */
	readonly writeFromPrivateServers: boolean;
	/** Studio writes records (off: Studio play never touches the DataStore; the KV_FakeRecords fake is separate). */
	readonly writeFromStudio: boolean;
	/** Runs with debug limits in force count (never in production). */
	readonly countDebug: boolean;
}

export const RECORDS_POLICY: RecordsPolicy = table.freeze({
	eligibleWorlds: LEADERBOARD_ELIGIBLE_WORLDS,
	deathOnlyWorlds: LEADERBOARD_DEATH_ONLY_WORLDS,
	countAbandoned: true,
	writeFromPrivateServers: true,
	writeFromStudio: false,
	countDebug: false,
});

/** Why an accepted run does not count toward records (undefined: it counts). */
export type RecordsIneligibleReason =
	| "world"
	| "debug"
	| "studio"
	| "private_server"
	| "abandoned"
	| "party"
	/** A party run (2+ members) where fewer than COOP_MIN_PARTY members contributed (partyContributors). */
	| "contributors";

export interface RecordsContext {
	readonly worldKind: string;
	readonly partySize: number;
	/** Party runs: members credited (partyContributors). Default: every member. */
	readonly contributors?: number;
	readonly debug: boolean;
	readonly studio: boolean;
	/** A VIP (owned) private server. */
	readonly privateServer: boolean;
	readonly died: boolean;
	readonly bossDefeated: boolean;
}

export function recordsEligibility(
	ctx: RecordsContext,
	policy: RecordsPolicy = RECORDS_POLICY,
): RecordsIneligibleReason | undefined {
	if (!policy.eligibleWorlds.includes(ctx.worldKind)) return "world";
	if (ctx.debug && !policy.countDebug) return "debug";
	if (ctx.studio && !policy.writeFromStudio) return "studio";
	if (ctx.privateServer && !policy.writeFromPrivateServers) return "private_server";
	if (ctx.partySize < 1 || ctx.partySize > MAX_PARTY_SIZE) return "party";
	if (!policy.countAbandoned) {
		const finished = policy.deathOnlyWorlds.includes(ctx.worldKind) ? ctx.died : ctx.died || ctx.bossDefeated;
		if (!finished) return "abandoned";
	}
	if (ctx.partySize >= COOP_MIN_PARTY && (ctx.contributors ?? ctx.partySize) < COOP_MIN_PARTY) return "contributors";
	return undefined;
}
