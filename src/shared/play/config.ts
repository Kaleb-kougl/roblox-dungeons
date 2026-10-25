/**
 * Client play-session tunables (task 8): run setup attributes, HUD snapshot rate, device thresholds. Data only; the
 * client controllers and the pure modules in shared/play read these (CLAUDE.md "No magic numbers").
 */
import { SIM_HZ } from "shared/sim";

/**
 * Workspace attributes the client reads at run start (Explorer -> Workspace -> Attributes, or the command bar:
 * `workspace:SetAttribute("KV_Seed", 42)`). Read again on every restart (R).
 */
export const RUN_ATTRIBUTES = {
	/** Number: the run's seed (dungeon + sim). Default DEFAULT_RUN_SEED. Must be an integer in [0, 2^32). */
	seed: "KV_Seed",
	/** Boolean: debug keys (K, J, F8) and the debug HUD line. Off by default. */
	debug: "KV_Debug",
	/** Boolean, debug only: start just outside the boss room's door (the web build's `?spawn=boss`). */
	spawnBoss: "KV_SpawnBoss",
	/** Number (or numeric string), debug only: the web build's `?stress=N`. Stress runs are never submitted. */
	stress: "KV_Stress",
	/**
	 * String, debug only: "endless" (endless mode), "game" (the M1 run), "dungeonNoEncounter" (the floor without
	 * enemies) or "greybox" (the 16x16 arena). Default: shared/run LIVE_RUN_WORLD (shared/config PLAY_MODE). Pair it with
	 * the server's Studio-only `KV_RunValidationWorld` so submissions validate in the same world.
	 */
	world: "KV_World",
	/**
	 * Boolean: M2 scoring (score HUD, combo meter, score pops, the results breakdown). Off by default: a scored run
	 * hashes differently from the M1 run the server validates today, so scored runs are not submitted.
	 */
	scoring: "KV_Scoring",
	/**
	 * Boolean (M4 co-op, the minimal party start until the Hub's party pad exists): at each run start the player with
	 * the lowest UserId INVITES everyone else in the server (`partyInvite`); everyone plays solo meanwhile. Each invited
	 * player answers in the HUD prompt (Join / Decline); the party run starts only once every one of them joined (the
	 * server enforces it), and a client only switches to a party run it accepted.
	 */
	party: "KV_Party",
	/** Boolean, dev only: accept every co-op invite at once (no prompt). Off by default. */
	partyAutoAccept: "KV_PartyAutoAccept",
} as const;

/** The web build's DEFAULT_SEED (`?seed=` absent). */
export const DEFAULT_RUN_SEED = 1337;

/**
 * An abandoned run (R before death or victory) shorter than this is not submitted: R-spam would otherwise burn the
 * server's per-player submission budget (shared/run RUN_SUBMIT_RATE) on runs that say nothing. 10 s of sim time.
 * Exception: the first run after a death is always submitted, so the session's "retried after death" signal
 * (shared/run session.ts) still sees a quick retry. Deaths and victories are always submitted.
 */
export const MIN_ABANDONED_SUBMIT_TICKS = SIM_HZ * 10;

/** HUD snapshot interval, seconds (web SimDriver HUD_INTERVAL: at most ~10 store updates per second). */
export const HUD_SNAPSHOT_INTERVAL_SEC = 0.1;

/** Stick radial deadzone (web devices.ts STICK_DEADZONE). */
export const STICK_DEADZONE = 0.2;
/** Analog triggers count as pressed past this value (web devices.ts TRIGGER_THRESHOLD). */
export const TRIGGER_THRESHOLD = 0.5;

/**
 * The world a ranked run asks the server for (`startRun`: the server picks the seed): the endless descent, scored and
 * cut into one segment per floor. It must be registered in shared/run worlds.ts and listed in shared/leaderboard
 * LEADERBOARD_ELIGIBLE_WORLDS to post. Typed as a plain world kind (string) so a switch back to "game" type-checks.
 */
export const RANKED_WORLD_KIND: string = "endless";

/**
 * The client waits this long for `runStarted`; without an answer (no server, old server, refused) it plays an
 * unranked run on the local seed instead (validated the old way with `submitRun`, never on a leaderboard).
 */
export const RUN_START_TIMEOUT_SECONDS = 5;

/**
 * A `startRun` answered `busy` (a party run of this player is still being decided, or previous runs are still being
 * checked) is sent again after this long, up to RUN_START_BUSY_RETRIES times, before the client falls back to an
 * unranked run.
 */
export const RUN_START_BUSY_RETRY_SECONDS = 2;
export const RUN_START_BUSY_RETRIES = 15;
