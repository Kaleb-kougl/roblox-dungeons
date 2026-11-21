import { createProducer } from "@rbxts/reflex";
import { EMPTY_SNAPSHOT, snapshotsEqual, type GameSnapshot, type InputDeviceKind } from "shared/play";
import type { DailyRunResult } from "shared/daily";
import type { RunRecordsResult } from "shared/records";
import type { StringVars } from "shared/theme";
import { latencyProbeViewsEqual, type LatencyProbeView } from "shared/view";
import type { SilverGrantBreakdown } from "shared/wallet";

/**
 * Client-local Reflex slice for the game HUD (task 8). Fed by the SimController's ~10 Hz snapshot (only when it
 * changed), the InputController's last-used device, and the run's server verdict. The live sim state never goes in
 * here: views read it through the SimController.
 */

/** What became of this run's submission (`submitRun` -> `runVerdict`, or `finishRun` -> `runFinished`). */
export interface VerdictView {
	readonly status: "none" | "pending" | "accepted" | "rejected" | "skipped";
	/** The run (RunInfo.run) it belongs to: a verdict can arrive after the player restarted. */
	readonly run?: number;
	/** Why the run ended: "death" | "victory" | "abandoned". */
	readonly ending?: string;
	/** Reject code (RunRejectCode or a gate), or why it was skipped. */
	readonly code?: string;
	readonly reason?: string;
	readonly claimedHash?: string;
	readonly serverHash?: string;
	/** Ranked (segmented) runs: the server's leaderboard status ("queued", "ineligible:<reason>", "failed"). */
	readonly leaderboard?: string;
	/**
	 * Ranked runs (docs/NEW_BEST.md NB9): this player's personal-records outcome from the server's verdict
	 * (RunFinishVerdict.records; absent when not credited, ineligible, the records unknown, or Studio without the fake),
	 * and the server's own final score / floor it refers to (the record's new numbers).
	 */
	readonly records?: RunRecordsResult;
	readonly serverScore?: number;
	readonly serverFloor?: number;
	/**
	 * Accepted daily runs (docs/DAILY.md DS10 / DS11): this player's outcome on the day's board (RunFinishVerdict.daily:
	 * posted, improved, previous, the standing); new best's run-over record reads it in place of `records`.
	 */
	readonly daily?: DailyRunResult;
	/**
	 * docs/SILVER.md SV8: this player's predicted Silver grant (RunFinishVerdict.silver; absent on rejected or non-paying
	 * runs and for members not credited). The run-over rows settle on it until the wallet's push for the run arrives.
	 */
	readonly silver?: SilverGrantBreakdown;
	/** The server's run id of a ranked run (the wallet's settled grant names it). */
	readonly runId?: string;
}

/**
 * The result of the debug replay check (the driver key, KV_Debug's info line): whether re-simulating the recording gave
 * the live state's hash, both hashes, and the ticks replayed. SimController stores it; a new run clears it.
 */
export interface ReplayCheckView {
	readonly match: boolean;
	readonly liveHash: string;
	readonly replayHash: string;
	readonly ticks: number;
}

/** Fixed facts about the current run, for the HUD's info line. */
export interface RunInfo {
	readonly seed: number;
	/** The world kind (shared/run worlds.ts): "endless", "daily", "tutorial", "game", "dungeonNoEncounter", "greybox". */
	readonly world: string;
	/** Biome name key for the floor (theme string), "" when there is no floor. */
	readonly placeKey: string;
	readonly dungeonName: string;
	readonly debug: boolean;
	/** Run counter: increments on every restart. */
	readonly run: number;
	/** Why the run fell back from the requested world (the sim's error, e.g. "Unknown archetype ..."), "" when it did not. */
	readonly notice: string;
	/** The floor's biome, 1..5 (theme BIOMES order), or 0 without a floor (greybox). Picks the biome music. */
	readonly biome: number;
	/** A co-op (lockstep) run: no pause, no restart; the pause key opens the non-pausing party overlay. */
	readonly coop: boolean;
	/** The lobby whose start began this run ("" for a run started from the main menu or by R). */
	readonly lobbyId: string;
	/**
	 * docs/ARCHER.md AR10: the local player's character id (SimController.getPlayerCharacter: the run's pick, else the
	 * one their weapons are), "" for none (M1's two weapons, no run): the per-character string overrides' reader.
	 */
	readonly character: string;
	/**
	 * docs/FLOOR_MODIFIERS.md FM6: the current floor's modifier (shared/dungeon FloorModifier id, the floor layout's
	 * EndlessFloorLayout.modifier; 0 = NONE: a plain floor, no endless floor). The status chip and the pause line
	 * read it.
	 */
	readonly floorModifier: number;
}

/** One HUD toast (M2: boon taken, relic found, curse accepted, Second Wind, Fang heal); text from the theme. */
export interface ToastView {
	/** Serial, for React keys. */
	readonly id: number;
	/** Theme string key of the line and its vars (`name` is looked up as a theme string key itself). */
	readonly key: string;
	readonly nameKey?: string;
	/** `{desc}`, looked up as a theme string key (boost pickups). */
	readonly descKey?: string;
	readonly amount?: number;
	/** More vars looked up as theme string keys (builds: an evolution toast's `{boon}` / `{evo}`). */
	readonly varKeys?: Readonly<Record<string, string>>;
	/**
	 * Literal vars for the line (docs/DAILY.md DS10: a friend's name and score), applied over the looked-up ones; a
	 * player's name is never a theme key.
	 */
	readonly args?: StringVars;
	/** A player whose headshot leads the line (docs/DAILY.md DS10: a friend passed), fetched by ToastPanel. */
	readonly headshotUserId?: number;
	/**
	 * claude/codex-plan.md CX6 (R14): the toast's entry was found for the first time ever on its frame: the NEW! chip at
	 * its left and, on a top-centre toast, the second line `Added to your Codex` (SimController.pushToasts from the
	 * CodexTracker's chips; a first-sighting card: SightingController from its sightingChip).
	 */
	readonly codexNew?: boolean;
	/**
	 * claude/codex-plan.md CX6: a codex toast (SightingController) for this Codex entry id: one line (the chip, then
	 * `{name} · Codex`), no second line. The hook for the entry's tile art (CX7's codexTileArt).
	 */
	readonly codexId?: string;
	/**
	 * The tier `codexId` rose to (shared/codex CodexTier): the toast's tile art is drawn in it (a sighting's seen art, a
	 * find's full art; shared/view/codex codexToastArtState).
	 */
	readonly codexTier?: number;
	/** os.clock() at which it disappears. */
	readonly until: number;
}

/** The minimap (docs/MINIMAP.md M8 / M9): set by MinimapController, read by the corner panel and the full map. */
export interface MapView {
	/** This floor has a map (a dungeon floor whose map image was created; never the greybox). */
	readonly available: boolean;
	/** The full map overlay is open (the `map` toggle). */
	readonly open: boolean;
}

const NO_MAP: MapView = { available: false, open: false };

/**
 * The `game` slice's state: the HUD snapshot, the last-used input device, the run's verdict and fixed facts, the toasts
 * and the first-sighting card, the minimap's floor state and the debug readouts. SimController writes most of it (run
 * start, floor change, snapshot, verdict, toasts, run end), InputController the device, MinimapController the map,
 * SightingController the card. A run start clears everything run-scoped; leaving the run clears it too but keeps the
 * last verdict.
 */
export interface GameState {
	readonly snapshot: GameSnapshot;
	/** The last boss seen this run (its corpse may be gone by the time the victory line shows). */
	readonly lastBossId: string;
	readonly inputDevice: InputDeviceKind;
	readonly verdict: VerdictView;
	readonly replayCheck: ReplayCheckView | undefined;
	/** KV_Debug co-op runs only: the latency probe (docs/FEEL.md J9); undefined otherwise. */
	readonly latencyProbe: LatencyProbeView | undefined;
	readonly run: RunInfo;
	readonly active: boolean;
	/** Newest last; at most PROGRESSION_VIEW.maxToasts. */
	readonly toasts: ReadonlyArray<ToastView>;
	/**
	 * The first-sighting card (docs/ENEMY_VARIANTS.md EV12: SightingController sets and expires it), apart from the
	 * top-centre toasts so it never sits over the far side of the room; undefined: none.
	 */
	readonly sighting: ToastView | undefined;
	readonly map: MapView;
	/**
	 * The run (RunInfo.run) the player left with Leave run (solo: a forfeit, it ends as a death; party: the run ends on
	 * this client while the party plays on). Its run-over panel shows, with "You left the run" as its main line; 0: none.
	 */
	readonly leftRun: number;
}

const NO_VERDICT: VerdictView = { status: "none" };

const initialState: GameState = {
	snapshot: EMPTY_SNAPSHOT,
	lastBossId: "",
	inputDevice: "keyboard",
	verdict: NO_VERDICT,
	replayCheck: undefined,
	latencyProbe: undefined,
	run: {
		seed: 0,
		world: "game",
		placeKey: "",
		dungeonName: "",
		debug: false,
		run: 0,
		notice: "",
		biome: 0,
		coop: false,
		lobbyId: "",
		character: "",
		floorModifier: 0,
	},
	active: false,
	toasts: [],
	sighting: undefined,
	map: NO_MAP,
	leftRun: 0,
};

/**
 * The game HUD slice (state: `GameState`, see the file comment). `startRun` begins a run with fresh info and an empty
 * verdict, replay check, toasts, sighting and map; `changeFloor` swaps the run info only; `endRun` empties the snapshot
 * and marks no run active while the last verdict stays. The setters return the same state when nothing changed, so
 * subscribers fire only on a real change.
 */
export const gameSlice = createProducer(initialState, {
	setSnapshot: (state, snapshot: GameSnapshot) =>
		snapshotsEqual(state.snapshot, snapshot)
			? state
			: { ...state, snapshot, lastBossId: snapshot.bossId !== "" ? snapshot.bossId : state.lastBossId },
	setInputDevice: (state, inputDevice: InputDeviceKind) =>
		state.inputDevice === inputDevice ? state : { ...state, inputDevice },
	setVerdict: (state, verdict: VerdictView) => ({ ...state, verdict }),
	setReplayCheck: (state, replayCheck: ReplayCheckView | undefined) => ({ ...state, replayCheck }),
	setLatencyProbe: (state, latencyProbe: LatencyProbeView | undefined) =>
		latencyProbeViewsEqual(state.latencyProbe, latencyProbe) ? state : { ...state, latencyProbe },
	/** The run moved to another floor (endless mode): the floor's info (dungeon name, biome); the rest stays. */
	changeFloor: (state, run: RunInfo) => ({ ...state, run }),
	/** A new run started (mount or restart): new info, verdict, replay check and toasts cleared. */
	startRun: (state, run: RunInfo, snapshot: GameSnapshot) => ({
		...state,
		run,
		snapshot,
		lastBossId: snapshot.bossId,
		verdict: NO_VERDICT,
		replayCheck: undefined,
		latencyProbe: undefined,
		active: true,
		toasts: [],
		sighting: undefined,
		map: NO_MAP,
	}),
	/** The run was left for the menu (run over, Leave run): no run, no HUD; the last verdict stays. */
	endRun: (state) => ({
		...state,
		snapshot: EMPTY_SNAPSHOT,
		lastBossId: "",
		replayCheck: undefined,
		latencyProbe: undefined,
		active: false,
		toasts: [],
		sighting: undefined,
		map: NO_MAP,
	}),
	/** Leave run ended this run (solo or party): the run-over panel says so. */
	setRunLeft: (state, run: number) => (state.leftRun === run ? state : { ...state, leftRun: run }),
	/** The minimap's floor state (MinimapController): whether this floor has a map, and the full map toggle. */
	setMapView: (state, map: MapView) =>
		state.map.available === map.available && state.map.open === map.open ? state : { ...state, map },
	/** Adds a toast (the oldest drops past `max`). */
	pushToast: (state, toast: ToastView, max: number) => {
		const toasts = [...state.toasts, toast];
		while (toasts.size() > max) toasts.remove(0);
		return { ...state, toasts };
	},
	/** Shows (or, with undefined, hides) the first-sighting card. */
	setSighting: (state, sighting: ToastView | undefined) =>
		state.sighting === sighting ? state : { ...state, sighting },
	/** Drops the toasts whose time is up (no change, no new state). */
	expireToasts: (state, now: number) =>
		state.toasts.some((t) => t.until <= now)
			? { ...state, toasts: state.toasts.filter((t) => t.until > now) }
			: state,
});

/**
 * The whole `game` slice, for a reader that needs several of its fields at once. It is a new object on every dispatch
 * that changed any field, the ~10 Hz snapshot included.
 */
export const selectGame = (state: { game: GameState }) => state.game;
/**
 * The HUD snapshot: the flat copy of the run the HUD draws from (vitals, boss line, score and combo, the draft, boons
 * and boosts), taken by SimController at about 10 Hz and replaced only when a field changed. `EMPTY_SNAPSHOT` while no
 * run is active.
 */
export const selectSnapshot = (state: { game: GameState }) => state.game.snapshot;
/**
 * The id of the last boss seen this run, "" when none was (and after the run was left). It outlives the snapshot's boss
 * id, because the corpse may be gone by the time the run-over panel's victory line names the boss.
 */
export const selectLastBossId = (state: { game: GameState }) => state.game.lastBossId;
/**
 * The device the player used last: "keyboard" (the start value), "gamepad" or "touch". Presentation only: which key
 * names the hints show, and whether the touch controls are up. InputController sets it on a switch.
 */
export const selectInputDevice = (state: { game: GameState }) => state.game.inputDevice;
/**
 * What became of the run's submission (`VerdictView`): status "none" from a run's start, "pending" once sent, then
 * "accepted" / "rejected" / "skipped" with the server's records, daily and Silver outcomes. It carries its run counter
 * because it can arrive after a restart, and it stays after the run is left for the menu.
 */
export const selectVerdict = (state: { game: GameState }) => state.game.verdict;
/**
 * The last debug replay check of this run (match, the two hashes, ticks), undefined until one was asked for and again
 * after a run start or exit. The KV_Debug info line shows it.
 */
export const selectReplayCheck = (state: { game: GameState }) => state.game.replayCheck;
/**
 * The latency probe's readout for the debug info line (docs/FEEL.md J9); undefined outside KV_Debug co-op runs and
 * after a run start or exit.
 */
export const selectLatencyProbe = (state: { game: GameState }) => state.game.latencyProbe;
/**
 * The fixed facts of the current run and floor (`RunInfo`: seed, world, biome, co-op, the run counter, the character,
 * the floor's modifier). Set at a run start and replaced on a floor change; after the run is left it still holds the
 * last run's facts, so pair it with `selectGameActive`.
 */
export const selectRunInfo = (state: { game: GameState }) => state.game.run;
/**
 * True from a run's start until it is left for the menu (the run-over panel included); false before the first run and
 * in the menus. The HUD, the pause button and the item tooltip mount on it, and the menu layer hides on it.
 */
export const selectGameActive = (state: { game: GameState }) => state.game.active;
/**
 * The top-centre HUD toasts on screen, newest last and at most `PROGRESSION_VIEW.maxToasts`; empty when none. Each
 * carries the `os.clock()` time it expires at; a run start or exit empties the list.
 */
export const selectToasts = (state: { game: GameState }) => state.game.toasts;
/**
 * The first-sighting card on screen (a toast drawn apart from the top-centre ones), undefined when none.
 * SightingController shows and expires it; a run start or exit clears it.
 */
export const selectSighting = (state: { game: GameState }) => state.game.sighting;
/**
 * The minimap's floor state: whether this floor has a map at all (never the greybox) and whether the full map overlay
 * is open. Both false from a run's start until MinimapController reports. The corner panel and the full map read it.
 */
export const selectMapView = (state: { game: GameState }) => state.game.map;
/**
 * The run counter (`RunInfo.run`) of the run the player ended with Leave run, 0 when none. The run-over panel compares
 * it with the run on screen to show "You left the run" as its main line; it is not cleared, a later run simply has
 * another counter.
 */
export const selectLeftRun = (state: { game: GameState }) => state.game.leftRun;
