/**
 * Client play-session tunables (task 8): run setup attributes, HUD snapshot rate, device thresholds. Data only; the
 * client controllers and the pure modules in shared/play read these (CLAUDE.md "No magic numbers").
 *
 * @module
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
	 * enemies) or "greybox" (the 16x16 arena): a local, unranked run on KV_Seed. Not "daily": its seed is the server's
	 * (KV_Daily starts a ranked Daily). Default: shared/run LIVE_RUN_WORLD (shared/config PLAY_MODE). Pair it with
	 * the server's Studio-only `KV_RunValidationWorld` so submissions validate in the same world.
	 */
	world: "KV_World",
	/**
	 * Boolean: M2 scoring (score HUD, combo meter, score pops, the results breakdown). Off by default: a scored run
	 * hashes differently from the M1 run the server validates today, so scored runs are not submitted.
	 */
	scoring: "KV_Scoring",
	/**
	 * Boolean, dev only (task L3): skip the main menu on join and start a solo run at once, as before the menu
	 * existed. Off by default. Co-op runs start from a lobby (the menu's Lobbies screen).
	 */
	skipMenu: "KV_SkipMenu",
	/**
	 * Boolean (Studio), read once on join: true starts the first-run tutorial whatever the server says (no main menu
	 * first), false never starts it (the normal flow at once). Unset: the server's `onboardingStatus` decides
	 * (docs/TUTORIAL.md).
	 */
	tutorial: "KV_Tutorial",
	/**
	 * Boolean (Studio), read once on join: true releases the join loading screen at once (docs/PRELOAD.md P3), so it
	 * never shows; the download queue still runs behind the menu. Off by default.
	 */
	skipLoading: "KV_SkipLoading",
	/**
	 * Boolean, debug: the main menu's Play solo (and KV_SkipMenu's start) starts the Daily instead (docs/DAILY.md: a
	 * ranked run in world "daily" on the server's seed of the day), until the menu's Daily card exists. Off by default.
	 */
	daily: "KV_Daily",
	/**
	 * Boolean, debug (docs/FRAME_PACING.md FPD8), read at every co-op run start: true builds the co-op client without
	 * the playout clock (it steps every merged frame the moment it arrives, as before the pacing), for an A/B in a
	 * playtest. Off by default.
	 */
	pacingOff: "KV_PacingOff",
	/**
	 * Number of seconds, Studio only (ignored outside Studio), read live (docs/STAGE_ASSETS.md SA4): the preload worker
	 * waits that long before each PreloadAsync chunk, the engine fetch-status pre-check is skipped, and the content ids
	 * passed to PreloadController.whenLoaded that already resolved are fetched once more (once per id per session), so
	 * the stage gates and the stand-in swaps can be exercised against Studio's cache. Unset or 0: off.
	 */
	fakeAssetLatency: "KV_FakeAssetLatency",
	/**
	 * String, debug, read live (docs/STAGE_ASSETS.md SA16): "all" draws every logical id as its stand-in (the pack's
	 * placeholder), or a comma list of logical-id prefixes ("enemy., bullet.") draws those; unset or empty: off.
	 * Feeds ArtReadiness.setForced (shared/view parseStandInsForce).
	 */
	standInsForce: "KV_StandInsForce",
	/**
	 * Boolean, debug, read at each stage (run start, floor change; docs/STAGE_ASSETS.md SA11): while on, every logical
	 * id the views resolve through the theme pack during a floor is recorded (ThemeController's recording wrapper) and
	 * diffed against that floor's stage manifest at the next floor change, run over or exit, printing
	 * `[StageAudit] floor N used <id>, not in its manifest`. Off by default.
	 */
	stageAssetAudit: "KV_StageAssetAudit",
	/**
	 * Boolean, debug (docs/FRAME_PACING.md Design 12), read at every co-op run start: true builds the co-op client
	 * without the measured lead (the legacy miss counter: +1 per missed deadline, -1 after 10 clean seconds), for an A/B
	 * in a playtest; combinable with KV_PacingOff. Off by default.
	 */
	leadOff: "KV_LeadOff",
	/**
	 * Boolean, debug (docs/FRAME_PACING.md Revision 3, FP20), read at every co-op run start: true builds the co-op client
	 * with Revision 2's late bump (`LEAD.lateBump` true: an echoed late raises the lead at once to its own trip), for an
	 * A/B against Revision 3's rule in a playtest (FP21); combinable with KV_PacingOff / KV_PredictOff, ignored with
	 * KV_LeadOff. Off by default.
	 */
	leadBump: "KV_LeadBump",
	/**
	 * Boolean, read at each co-op run start (docs/LOCAL_PREDICTION.md LPD6): the run's LockstepClient is built without
	 * local prediction (your own knight is drawn at the merged state, as before LP5), for an A/B in a playtest;
	 * combinable with KV_PacingOff / KV_LeadOff. Off by default.
	 */
	predictOff: "KV_PredictOff",
	/**
	 * Boolean, read live (docs/CURSOR.md section 4): true forces Roblox's own pointer everywhere, the menus' gauntlet
	 * cursor never drawn (CursorController), for debugging and as the fallback if a Roblox update breaks the software
	 * cursor. The gamepad rule (no pointer while on a pad) still applies. Off by default.
	 */
	systemCursor: "KV_SystemCursor",
	/**
	 * Boolean, Studio or with KV_Debug (docs/SECRET_ROOMS.md Design 12): SecretRenderController outlines the floor's
	 * crack, chamber and front box and labels the crack with the chest's tier and the secret's status. Presentation only,
	 * read live; off by default.
	 */
	secretLabel: "KV_SecretLabel",
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

// ---------------------------------------------------------------------------------------------
// Key rebinding (task L4b; shared/play bindings.ts). Pure string lists of Enum.KeyCode / Enum.UserInputType NAMES
// (no Enum here: the lists are checked headlessly and against untrusted stored overrides).

/** Rebinding tunables: the settings panel's "press a key" capture gives up after this long. */
export const REBIND = {
	captureTimeoutSeconds: 5,
} as const;

/**
 * Inputs that are not rebindable: they keep their meaning whatever the bindings say (pause, the settings panel, the
 * menus' pad close button, the debug keys). The keyboard and Start ones are in RESERVED_KBM_INPUTS /
 * RESERVED_PAD_INPUTS; the pad close button only acts while a panel is open, so in game it stays bindable (skill 2).
 */
export const FIXED_INPUTS = {
	/** Pause (web: Escape; Roblox keeps Escape for its menu). */
	pause: "P",
	padPause: "ButtonStart",
	/** The juice settings panel (shared/view/hud SETTINGS_KEY). */
	settings: "O",
	/** Closes the settings / leaderboard panels on a pad (shared/view/hud SETTINGS_PAD_CLOSE_KEY; GUI "back"). */
	padMenuClose: "ButtonB",
	/**
	 * Debug (KV_Debug only): one hit on the player, 10% off an engaged boss, end the endless floor, drop the next boost
	 * kind 1.5 tiles ahead of the player (runs with drops; docs/BOOSTS.md B6). The drop key was M until the full map took
	 * M (docs/MINIMAP.md MD11): Semicolon, rarely bound, so reserving it is unlikely to drop a stored binding.
	 */
	debugHit: "K",
	debugBoss: "J",
	debugFloor: "N",
	debugDrop: "Semicolon",
} as const;

/** The debug replay check (KV_Debug only): F8 as in the web build, L because Studio can take F8 for itself. */
export const DEBUG_REPLAY_CHECK_KEYS: ReadonlyArray<string> = ["F8", "L"];

/**
 * Keyboard / mouse names a binding may never take. Roblox: Escape (game menu), Tab (player list), Slash (chat),
 * F9 (developer console), F11 (fullscreen). The game's fixed keys: P (pause), O (settings). Debug: K, J, N, Semicolon
 * (the boost drop; M until docs/MINIMAP.md MD11), F8, L.
 */
export const RESERVED_KBM_INPUTS: ReadonlyArray<string> = [
	"Escape",
	"Tab",
	"Slash",
	"F9",
	"F11",
	"P",
	"O",
	"K",
	"J",
	"N",
	"Semicolon",
	"F8",
	"L",
];

/** Gamepad names a binding may never take: Start (pause), Select (Roblox), both sticks (move / aim, fixed). */
export const RESERVED_PAD_INPUTS: ReadonlyArray<string> = ["ButtonStart", "ButtonSelect", "Thumbstick1", "Thumbstick2"];

/** Every Enum.KeyCode name a keyboard binding slot accepts (reserved names are refused before this list is read). */
// prettier-ignore
export const KBM_KEY_NAMES: ReadonlyArray<string> = [
	// letters
	"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
	"N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
	// number row
	"Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
	// function keys
	"F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
	// whitespace, editing, modifiers
	"Space", "Return", "Backspace", "CapsLock",
	"LeftShift", "RightShift", "LeftControl", "RightControl", "LeftAlt", "RightAlt",
	// navigation
	"Up", "Down", "Left", "Right", "Insert", "Delete", "Home", "End", "PageUp", "PageDown",
	// punctuation
	"Minus", "Equals", "LeftBracket", "RightBracket", "BackSlash", "Semicolon", "Quote", "Comma", "Period", "Backquote",
	// keypad
	"KeypadZero", "KeypadOne", "KeypadTwo", "KeypadThree", "KeypadFour",
	"KeypadFive", "KeypadSix", "KeypadSeven", "KeypadEight", "KeypadNine",
	"KeypadPeriod", "KeypadDivide", "KeypadMultiply", "KeypadMinus", "KeypadPlus", "KeypadEnter",
];

/** Mouse buttons (Enum.UserInputType names) a keyboard / mouse binding slot accepts. */
export const KBM_MOUSE_NAMES: ReadonlyArray<string> = ["MouseButton1", "MouseButton2", "MouseButton3"];

/** Every gamepad Enum.KeyCode name a pad binding accepts (a trigger keeps its analog threshold wherever bound). */
export const PAD_BUTTON_NAMES: ReadonlyArray<string> = [
	"ButtonA",
	"ButtonB",
	"ButtonX",
	"ButtonY",
	"ButtonL1",
	"ButtonR1",
	"ButtonL2",
	"ButtonR2",
	"ButtonL3",
	"ButtonR3",
	"DPadUp",
	"DPadDown",
	"DPadLeft",
	"DPadRight",
];
