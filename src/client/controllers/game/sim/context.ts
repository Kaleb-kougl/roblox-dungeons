/**
 * The run as the views see it, and SimController's contracts with the controllers that register with it
 * (docs/SIM_CONTROLLER.md step 1; moved out of SimController.ts unchanged, which re-exports every name here):
 * {@link RunContext} and its listeners, the stage loader's {@link StageDriver} / {@link StageWork}, the draft reveal's
 * {@link DraftRevealDriver}, the Codex's {@link ToastChipSource}, and the two per-floor reads of a context
 * ({@link floorSecretOf}, {@link floorModifierOf}). Types and two pure functions: no state, no engine call.
 *
 * @module
 */
import type { CharacterId } from "shared/characters";
import type { CosmeticLook } from "shared/cosmetics";
import { ENDLESS_FIRST_FLOOR, FloorModifier, type Dungeon, type FloorSecret } from "shared/dungeon";
import type { ArrivalLog, LockstepClient } from "shared/lockstep";
import type { LiveRun, RunView } from "shared/play";
import type { EndlessRunFloor, RunWorldKind } from "shared/run";
import type { SimConfig } from "shared/sim";
import type { LatencyProbe, SpectateTracker, StageKind } from "shared/view";

/** Everything fixed for one run, as the views see it. */
export interface RunContext {
	/** What views read (state, events, score pops, alpha): the LiveRun, or the co-op LockstepClient. */
	readonly run: RunView;
	/** The solo run's driver (undefined in a co-op run). */
	readonly live: LiveRun | undefined;
	/** The co-op lockstep run (M4), or undefined for a solo run. */
	readonly coop: LockstepClient | undefined;
	/** This client's player index (0 solo; co-op: its place in the party). */
	readonly localIndex: number;
	/**
	 * Co-op spectating (docs/SPECTATE.md): whose player the views follow once this client's player died; undefined
	 * in a solo run and the tutorial (they never spectate).
	 */
	readonly spectate: SpectateTracker | undefined;
	/** Co-op: each member's display name in player index order (the spectate bar); empty in a solo run. */
	readonly memberNames: ReadonlyArray<string>;
	readonly seed: number;
	/** The world registry kind (shared/run worlds.ts). */
	readonly world: RunWorldKind;
	readonly atBossDoor: boolean;
	/** The server's run session (a ranked, segmented run), or undefined for an unranked local run. */
	readonly runId: string | undefined;
	/** Stress target (0 = off). Stress runs are never submitted (the server never builds a stress config). */
	readonly stress: number;
	/**
	 * KV_Scoring: M2 scoring opted into on a non-endless world. Those scored runs are not submitted (the server
	 * replays the unscored M1 config). Endless runs are always scored by their own config and are submitted.
	 */
	readonly scoring: boolean;
	/** The SimConfig the current floor runs with (endless: that floor's world config; else the run's config). */
	readonly config: Readonly<SimConfig>;
	/** The current floor's dungeon, or undefined in the greybox world. */
	readonly dungeon: Dungeon | undefined;
	/** Run counter: 1 for the first run, +1 per restart. */
	readonly counter: number;
	/** Endless mode: the current floor number (0 outside endless runs). */
	readonly floor: number;
	/** Endless mode: each floor's world and layout (the run's cached floors); undefined outside endless runs. */
	readonly endlessFloor: ((floor: number) => EndlessRunFloor) | undefined;
	/** The lobby whose start began this run (a party run, or a one-player lobby's solo run); "" otherwise. */
	readonly lobbyId: string;
	/**
	 * docs/ARCHER.md AR5: every player's character, in player index order, as the run was built (RunSetup.characters);
	 * undefined for a world without characters (M1's `game`, `dungeonNoEncounter`, `greybox`).
	 */
	readonly characters: ReadonlyArray<CharacterId> | undefined;
	/** This client's player's character (`characters[localIndex]`), or undefined (a world without characters). */
	readonly character: CharacterId | undefined;
	/**
	 * docs/COSMETICS.md CS5: every player's look (the cosmetics they wear), player index order: a co-op run's
	 * PartyRunStart.looks, a ranked solo run's StartRunReply.look, else the wallet's equipped slots for the run's
	 * character (the Knight in a world without characters, CSD12). Presentation only (never stepped, hashed or sent).
	 */
	readonly looks: ReadonlyArray<CosmeticLook>;
	/**
	 * A first-run tutorial run (world `tutorial`, docs/TUTORIAL.md): local, never submitted (verdict `tutorial`), no
	 * segments, no R / pad restart (the pause overlay has Restart tutorial and Skip tutorial).
	 */
	readonly tutorial: boolean;
	/**
	 * A developer mode run (world `dev`, docs/DEV_MODE.md): local, never submitted (verdict code `dev`), no segments;
	 * R / Again restart it at once on the same seed and start floor (no forfeit), Leave run just stops it.
	 */
	readonly dev: boolean;
	/**
	 * KV_Debug co-op runs only (docs/FEEL.md J9): the latency probe behind the debug line's lead and press -> stepped
	 * tick numbers. Measurement only: nothing it does reaches what is sent, stepped, hashed or recorded.
	 */
	readonly latencyProbe?: LatencyProbe;
	/**
	 * KV_Debug co-op runs only (docs/FRAME_PACING.md FP0 / FP5): the arrival log behind the `[Pace]` line printed every
	 * ARRIVAL_LOG.windowSec. Measurement only, like the latency probe.
	 */
	readonly arrivalLog?: ArrivalLog;
	/** A co-op run built without the playout clock (KV_PacingOff, read at the run's start). */
	readonly pacingOff?: boolean;
	/** A co-op run built without the measured lead: the legacy miss counter (KV_LeadOff, read at the run's start). */
	readonly leadOff?: boolean;
	/** A co-op run built without local prediction (KV_PredictOff, read at the run's start; docs/LOCAL_PREDICTION.md). */
	readonly predictOff?: boolean;
}

/**
 * A subscriber to the run: called with the run's context by `onRunStarted` (now if a run exists, and at every run
 * start) or by `onFloorChanged` (after the run moved to another floor, with the new floor's context). The render and UI
 * controllers rebuild their views from it.
 */
export type RunListener = (ctx: RunContext) => void;

/**
 * What a run start or floor change hands the stage loader (docs/STAGE_LOADER.md SL3; StageController): the work it
 * runs under its cover on later frames, one item per frame, once the cover is on screen.
 */
export interface StageWork {
	/** Solo run start only: builds the run (makeRun: floor 1 generated) and its context; prints `[Sim] run N started`. */
	readonly forge?: () => void;
	/** Runs the run-start / floor-change listeners with the context current at that moment (views rebuild). */
	readonly notify: () => void;
	/** The floor the cover loads (the label's `{floor}`; 0 for none, e.g. the greybox). */
	readonly floor: number;
}

/**
 * The stage loader as SimController sees it (StageController implements it and registers with `setStageDriver`; one
 * direction only, so SimController never injects it). Without a driver every StageWork runs at once, as before.
 */
export interface StageDriver {
	/** A ranked run start asked the server: the cover ("Starting run...") goes up now; `stage` brings the work. */
	awaitServer(): void;
	/** Cover now (this frame); the work runs on later frames under it (stageMerge decides against a current load). */
	stage(kind: StageKind, work: StageWork): void;
	/** The run stopped (left / exited): any cover ends now, its pending work is dropped. */
	cancel(): void;
	/** Once per SimController frame, before anything else: the cover's clock and the work due. */
	frame(dt: number): void;
	/** A solo run start is under its cover: no tick, no pause menu, no restart. */
	holdsSim(): boolean;
	/** The cover owns the input until its reveal (neutral input reaches the sim, solo and co-op). */
	blocksInput(): boolean;
}
/**
 * The boon draft reveal as SimController sees it (docs/DRAFT_REVEAL.md DR6; DraftRevealController implements it and
 * registers with `setDraftRevealDriver`; one direction only, so SimController never injects it). Without a driver the
 * confirm is never held, as before.
 */
export interface DraftRevealDriver {
	/**
	 * The draft's confirm is held back (DraftRevealGate): the local reveal is playing, or the local draft is open and its
	 * reveal has not begun yet (shared/play draftConfirmHeld).
	 */
	blocksConfirm(): boolean;
	/** A confirm press edge during the reveal: skip it (DRD6). */
	skip(): void;
}

/**
 * The Codex as SimController's toasts see it (claude/codex-plan.md CX6, R14; CodexController implements it and registers
 * with `setToastChipSource`; one direction only, so SimController never injects it). Without a source no toast wears
 * the chip.
 */
export interface ToastChipSource {
	/**
	 * Called once per sim frame, right before the frame's toasts are pushed (solo and co-op, after the step): the Codex
	 * tracker's frame runs here, so its chips are this frame's. Returns the entry ids whose toast this frame wears the
	 * NEW! chip (shared/view/codex codexToastChip maps each run event to its entry). Read it before the next call only.
	 */
	toastChips(view: RunView): ReadonlyArray<string>;
}

/** The run was left for the menu: "left" (Leave run, mid-run) or "exited" (Main menu / Back to lobby after it). */
export type RunExitListener = (how: "left" | "exited") => void;

/**
 * The secret room plan of `ctx`'s floor (docs/SECRET_ROOMS.md SR7): EndlessRunFloor.secret of an endless floor, else
 * undefined. Read it once per floor (the floor builder caches only its last floor); SimController.getFloorSecret caches it.
 */
export function floorSecretOf(ctx: RunContext): FloorSecret | undefined {
	return ctx.endlessFloor !== undefined && ctx.floor > 0 ? ctx.endlessFloor(ctx.floor).secret : undefined;
}

/**
 * docs/FLOOR_MODIFIERS.md FM5 / FM6: floor `floor`'s modifier in the run `ctx` (a shared/dungeon FloorModifier id, the
 * floor layout's EndlessFloorLayout.modifier through the run's cached floor builder), FloorModifier.NONE without an
 * endless floor (M1, the greybox, the menu) or before the first one. Pure and cheap (the floor is cached).
 */
export function floorModifierOf(ctx: RunContext, floor: number = ctx.floor): number {
	const build = ctx.endlessFloor;
	if (build === undefined || floor < ENDLESS_FIRST_FLOOR) return FloorModifier.NONE;
	return build(floor).layout.modifier;
}
