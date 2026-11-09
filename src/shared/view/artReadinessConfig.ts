/**
 * Tunables of art readiness (docs/STAGE_ASSETS.md "Revision 2" section 11, SA15; logic in artReadiness.ts, fed by the
 * client's PreloadController). Presentation only: nothing here reaches the sim, the lockstep wire or a hash.
 * Roblox-port choices, no web source.
 */
export interface ArtReadinessConfig {
	/** Seconds after a content id's first failed fetch before its one retry is due (SAD13). */
	readonly retryAfterSec: number;
	/**
	 * Failed fetches after which a content id is final: it counts as resolved, so one broken optional sheet never keeps
	 * a whole set a stand-in forever (the set draws without it, as an un-uploaded optional sheet does). 2 = one retry.
	 */
	readonly maxFailures: number;
	/** `KV_StandInsForce` (RUN_ATTRIBUTES.standInsForce): this value forces every logical id to a stand-in. */
	readonly forceAllValue: string;
	/** `KV_StandInsForce`: separator of a list of logical-id prefixes ("enemy., bullet."). */
	readonly forceListSeparator: string;
}

export const ART_READINESS: ArtReadinessConfig = {
	retryAfterSec: 10,
	maxFailures: 2,
	forceAllValue: "all",
	forceListSeparator: ",",
};
