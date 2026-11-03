/**
 * Co-op moments tunables (docs/RUN_RECAP.md Part B, CM1; decisions CMD1-CMD4). Data only: TeamMoments (teamMoments.ts)
 * applies them. Ticks are sim ticks (shared/sim SIM_HZ), so every client of a lockstep run derives the same moments.
 */
export const TEAM_MOMENTS = {
	/** A party run (ScoreState.partySize, the size the run started with) of at least this many has team moments. */
	minPartySize: 2,
	/** TEAM PERFECT's stamp shows its streak (`TEAM PERFECT x{n}`) from this many team perfects in a row. */
	streakShowFrom: 2,
	/**
	 * SYNC! (CMD4: timing only): parry groups of different players whose first erases are at most this many ticks apart
	 * (0.2 s). A further player whose group starts within this many ticks of the sync's first group joins it (x3).
	 */
	syncWindowTicks: 12,
	/** At most one SYNC! per this many seconds (counted in sim ticks: syncCooldownTicks). */
	syncCooldownSec: 1.0,
	/** The SYNC! tether joins the parry points when every two of them are at most this many tiles apart. */
	tetherMaxTiles: 10,
} as const;
