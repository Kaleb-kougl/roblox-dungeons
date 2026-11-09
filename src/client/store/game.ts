import { createProducer } from "@rbxts/reflex";
import { EMPTY_SNAPSHOT, snapshotsEqual, type GameSnapshot, type InputDeviceKind } from "shared/play";
import type { DailyRunResult } from "shared/daily";
import type { RunRecordsResult } from "shared/records";
import type { StringVars } from "shared/theme";
import { latencyProbeViewsEqual, type LatencyProbeView } from "shared/view";

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
}

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
	},
	active: false,
	toasts: [],
	sighting: undefined,
	map: NO_MAP,
};

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

export const selectGame = (state: { game: GameState }) => state.game;
export const selectSnapshot = (state: { game: GameState }) => state.game.snapshot;
export const selectLastBossId = (state: { game: GameState }) => state.game.lastBossId;
export const selectInputDevice = (state: { game: GameState }) => state.game.inputDevice;
export const selectVerdict = (state: { game: GameState }) => state.game.verdict;
export const selectReplayCheck = (state: { game: GameState }) => state.game.replayCheck;
export const selectLatencyProbe = (state: { game: GameState }) => state.game.latencyProbe;
export const selectRunInfo = (state: { game: GameState }) => state.game.run;
export const selectGameActive = (state: { game: GameState }) => state.game.active;
export const selectToasts = (state: { game: GameState }) => state.game.toasts;
export const selectSighting = (state: { game: GameState }) => state.game.sighting;
export const selectMapView = (state: { game: GameState }) => state.game.map;
