/**
 * Co-op party tunables (M4 "Co-op lockstep", up to 8 players; a Roblox-port feature, no web source). Data plus pure
 * lookups; imports nothing from the sim, so actors.ts / ctx.ts / input.ts can use it without a require cycle.
 *
 * Party size scaling applies to ENDLESS runs, at spawn: enemy hp here (actors.ts spawnActor), the room encounter
 * budget in shared/dungeon endlessData.ts (PARTY_BUDGET_MULTIPLIERS). Enemy bullet speed never scales with the party.
 */

/** The largest party (players 0 .. 7). */
export const MAX_PARTY_SIZE = 8;
/** A party of one is a solo run: no party state, nothing extra hashed. */
export const SOLO_PARTY_SIZE = 1;

/** Enemy (and boss) hp at spawn x PARTY_HP_MULTIPLIERS[n - 1] for a party of n (endless runs). */
export const PARTY_HP_MULTIPLIERS: ReadonlyArray<number> = [1, 1.6, 2.2, 2.8, 3.2, 3.6, 4.0, 4.4];

/** Half hearts a player who died comes back with at the next floor's entrance (1 heart). */
export const PARTY_REVIVE_HALF_HEARTS = 2;

/**
 * Port input bit (lockstep relay only): the player left the run. The server writes it into that player's merged frame
 * from the tick they left on; the sim marks them `left` (dead for the rest of the run, never revived). Outside Button
 * / ALL_BUTTONS / SIM_BUTTONS: only the binary recording codec (both variants) and the steps accept it; a solo step
 * reads it as FORFEIT_BUTTON.
 */
export const PARTY_LEFT_BUTTON = 16384;

/**
 * Port input bit (solo runs, L6a "Leave run counts as a death"): the SAME bit as PARTY_LEFT_BUTTON, named for the solo
 * path. Both mean "this player leaves the run for good": co-op marks them `left` (dead, never revived), a solo step
 * kills the player at that tick through the death bookkeeping a lethal hit uses (killPlayerState + events.playerDied;
 * step.ts forfeitSoloRun), so the run ends as a death. One bit for one meaning keeps the codec's solo and party
 * variants accepting the same set (recordingCodec RECORDED_BUTTONS), and it stays outside SIM_BUTTONS, so the lockstep
 * relay still refuses it from clients (only the relay writes a co-op leave). A forfeit can only end a run early: it
 * never revives, skips a floor, scores or bypasses anything; a run that never sets it is unchanged.
 */
export const FORFEIT_BUTTON = PARTY_LEFT_BUTTON;

/** True for an integer party size in [1, MAX_PARTY_SIZE]. */
export function isValidPartySize(n: unknown): n is number {
	return typeIs(n, "number") && n >= SOLO_PARTY_SIZE && n <= MAX_PARTY_SIZE && n % 1 === 0;
}

/** PARTY_HP_MULTIPLIERS[n - 1] (1 for a solo run). Throws on an invalid size. */
export function partyHpMultiplier(n: number): number {
	if (!isValidPartySize(n)) error(`party: size must be an integer in [1, ${MAX_PARTY_SIZE}], got ${n}`, 0);
	return PARTY_HP_MULTIPLIERS[n - 1];
}
