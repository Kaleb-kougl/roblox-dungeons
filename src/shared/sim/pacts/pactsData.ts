/**
 * Pact tunables in the sim (docs/FORTUNE.md "Pacts", PS2-PS4, decisions FD2-FD8; a Roblox-port feature, no web source).
 * Data only, a LEAF: pacts.ts builds ENDLESS_PACTS_CONFIG from these; score.ts and endless.ts read the run's config
 * through state.pacts. Where the altars stand and which curse Greed shows are floor data (shared/dungeon pactsData.ts
 * PACTS, pactCurseIndex); the PactKind indices live there too (re-exported here).
 */
import { secondsToTicks } from "../playerData";

export { PACT_KIND_COUNT, PACT_KIND_NAMES, PactKind, type PactKindId } from "shared/dungeon";

/** Greed's Legendary deal: this many cards (FD4), filled with ordinary upgrades when the pool is thinner. */
export const PACT_LEGENDARY_CARDS = 3;
/** Horde's second wave: at most this many enemies (the room's planned kinds again, in order). */
export const HORDE_MAX_WAVE = 10;
/** Horde's second wave: the telegraph (spawn rings at its tiles) lasts this long before it spawns (FD7: 1 s). */
export const HORDE_WAVE_TELEGRAPH_SECONDS = 1;
export const HORDE_WAVE_TELEGRAPH_TICKS = secondsToTicks(HORDE_WAVE_TELEGRAPH_SECONDS); // 60
/**
 * Horde's pay (FD8): every award of the horde room's record x this / 100, through awardPoints' bonusPercent (an exact
 * integer factor). Must be a multiple of 100 so bonus x it / 100 stays an integer for every bonus.
 */
export const HORDE_PERCENT = 200;
/** The x2's denominator (integer percent). */
export const PACT_PERCENT = 100;

/** PactsPlayerState.draftKind while the player's draft (if any) is an ordinary one. */
export const NO_PACT = -1;

/** HordeState.room / record / waveDueTick while unset. */
export const HORDE_NONE = -1;
/** HordeState.spawned until the second wave has spawned. */
export const HORDE_WAVE_PENDING = -1;

/**
 * Why an altar gives a player nothing (pactAvailability, the view's grey-out line). 0: it is available. Append only
 * (the view maps each to a string).
 */
export const PactDim = {
	NONE: 0,
	/** This pact was already taken at this shrine (Greed: by this player; Horde: by anyone). */
	TAKEN: 1,
	/** Greed: the player has every curse. */
	NO_CURSE: 2,
	/** Greed: nothing legendary to deal (no unowned legendary boon, no available duo, no level-II boon). */
	NO_LEGENDARY: 3,
	/** Horde: no enemy room on the floor that nobody has entered. */
	NO_ROOM: 4,
	/** The player cannot take anything (dead, or left the party). */
	UNABLE: 5,
} as const;
export type PactDimId = (typeof PactDim)[keyof typeof PactDim];
/** Names in index order (theme string keys `pact.dim.<name>`). */
export const PACT_DIM_NAMES = ["none", "taken", "noCurse", "noLegendary", "noRoom", "unable"] as const;
