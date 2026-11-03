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

/**
 * The co-op moments' presentation (docs/RUN_RECAP.md CM2 / CM4 / CM5). Data only: shared/view/fx teamMomentsView.ts,
 * shared/view/hud syncCallout.ts, shared/view/audio cues.ts and the client's TeamMomentsController /
 * SyncCalloutController / RoomClearController apply it. Real (unpaused) seconds.
 */
export const TEAM_MOMENTS_VIEW = {
	/**
	 * CM2 team pulse: at a team perfect, one spark ring (ROOM_CLEAR.burst's shape, ParticleController) on every living
	 * party member, in `role` (new best's gold: the kill's own PERFECT ring is `ember`). Seeds: burstSeed(player, the
	 * clear's tick, seedSalt) (room clear 15, near misses 16 / 17, loot fizzle 18).
	 */
	pulse: { role: "newBest", seedSalt: 19 },
	/** CM4: while sfx.player.syncparry is silent, the SYNC! plays sfx.player.parry this many semitones up. */
	syncAudio: { fallbackSemitones: 5 },
	/**
	 * CM5 SYNC! floor text, on the combo shout's construction (its box, canvas, layer, cap and duck): lives `sec`, fades
	 * out over the last `fadeSec`, pops from `popScale` over `popSec` (none under reduced motion). A tethered sync shows
	 * one text at the points' mean filling `scale` of the shout's box at rest; an untethered one a small text at each
	 * point (`smallScale`). Colour role `role` (the PARRY! flash's: validated against the enemy bullets).
	 */
	callout: {
		sec: 0.9,
		fadeSec: 0.3,
		popSec: 0.12,
		popScale: 1.3,
		scale: 0.8,
		smallScale: 0.5,
		role: "nearMiss.parry",
		folderName: "KV_SyncCallout",
	},
	/**
	 * CM5 tether: a bright thin floor bar between the sync's first and latest parry points while `tethered`, for `sec`;
	 * it snaps from `flashWidthTiles` down to `widthTiles` over `snapSec` and fades over its last `fadeSec` (reduced
	 * motion: no snap, the thin bar only, the same fade). Opacity at most `maxOpacity`; drawn on the floor text's layer
	 * (under every bullet). One at a time (a new sync replaces it).
	 */
	tether: {
		sec: 0.25,
		snapSec: 0.08,
		fadeSec: 0.12,
		widthTiles: 0.1,
		flashWidthTiles: 0.3,
		maxOpacity: 0.85,
		role: "nearMiss.parry",
	},
	/**
	 * Studio check aid (CLAUDE.md working agreement: off by default). Workspace string attribute `attribute`; every
	 * CHANGE to it arms once:
	 *   "perfect" / "perfect:<n>": the next PERFECT clear of the run (solo too) is a team perfect with streak n
	 *     (default 1; the stamp, chip, rings and sound as in a party run);
	 *   "sync" / "sync:far" / "sync:3": on the next frame a SYNC! at the view player (two points `nearTiles` apart:
	 *     tethered; `farTiles` apart: untethered; three points: SYNC x3), with its sound.
	 * Nothing counts toward the run's totals. Absent / anything else: nothing.
	 */
	debug: { attribute: "KV_TeamMomentsDebug", nearTiles: 4, farTiles: 14 },
} as const;
