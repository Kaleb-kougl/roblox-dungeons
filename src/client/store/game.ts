import { createProducer } from "@rbxts/reflex";
import { EMPTY_SNAPSHOT, snapshotsEqual, type GameSnapshot, type InputDeviceKind } from "shared/play";

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
	/** "game" | "endless" | "dungeonNoEncounter" | "greybox". */
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
}

/** One HUD toast (M2: boon taken, relic found, curse accepted, Second Wind, Fang heal); text from the theme. */
export interface ToastView {
	/** Serial, for React keys. */
	readonly id: number;
	/** Theme string key of the line and its vars (`name` is looked up as a theme string key itself). */
	readonly key: string;
	readonly nameKey?: string;
	readonly amount?: number;
	/** os.clock() at which it disappears. */
	readonly until: number;
}

/** A co-op invite waiting for this player's answer (the HUD prompt: accept / decline). */
export interface PartyInviteView {
	readonly inviteId: string;
	readonly hostName: string;
	/** Players in the party, the host included. */
	readonly count: number;
	readonly accepted: number;
}

export interface GameState {
	readonly snapshot: GameSnapshot;
	/** The last boss seen this run (its corpse may be gone by the time the victory line shows). */
	readonly lastBossId: string;
	readonly inputDevice: InputDeviceKind;
	readonly verdict: VerdictView;
	readonly replayCheck: ReplayCheckView | undefined;
	readonly run: RunInfo;
	readonly active: boolean;
	/** Newest last; at most PROGRESSION_VIEW.maxToasts. */
	readonly toasts: ReadonlyArray<ToastView>;
	/** A co-op invite to answer, or undefined. */
	readonly partyInvite: PartyInviteView | undefined;
}

const NO_VERDICT: VerdictView = { status: "none" };

const initialState: GameState = {
	snapshot: EMPTY_SNAPSHOT,
	lastBossId: "",
	inputDevice: "keyboard",
	verdict: NO_VERDICT,
	replayCheck: undefined,
	run: { seed: 0, world: "game", placeKey: "", dungeonName: "", debug: false, run: 0, notice: "", biome: 0 },
	active: false,
	toasts: [],
	partyInvite: undefined,
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
		active: true,
		toasts: [],
	}),
	/** Adds a toast (the oldest drops past `max`). */
	pushToast: (state, toast: ToastView, max: number) => {
		const toasts = [...state.toasts, toast];
		while (toasts.size() > max) toasts.remove(0);
		return { ...state, toasts };
	},
	/** The co-op invite prompt (undefined hides it). */
	setPartyInvite: (state, partyInvite: PartyInviteView | undefined) => ({ ...state, partyInvite }),
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
export const selectRunInfo = (state: { game: GameState }) => state.game.run;
export const selectGameActive = (state: { game: GameState }) => state.game.active;
export const selectToasts = (state: { game: GameState }) => state.game.toasts;
export const selectPartyInvite = (state: { game: GameState }) => state.game.partyInvite;
