import { Controller, OnStart } from "@flamework/core";
import { GuiService, Players, RunService, Workspace } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore, type RunInfo, type VerdictView } from "client/store";
import type { PartyRunStart, RunFinishVerdict, RunVerdict } from "shared/network";
import { CoopMenuInputGate, LockstepClient } from "shared/lockstep";
import {
	DEFAULT_RUN_SEED,
	HUD_SNAPSHOT_INTERVAL_SEC,
	LiveRun,
	RANKED_WORLD_KIND,
	RUN_ATTRIBUTES,
	RUN_START_BUSY_RETRIES,
	RUN_START_BUSY_RETRY_SECONDS,
	RUN_START_TIMEOUT_SECONDS,
	oversizeSubmission,
	shouldRequestServerRun,
	shouldSubmitRun,
	takeSnapshot,
	unsubmittedReason,
	type FrameEvents,
	type LiveRunSetup,
	type RunEnding,
	type RunView,
} from "shared/play";
import {
	LIVE_RUN_WORLD,
	TUTORIAL_WORLD_KIND,
	buildWorldSetup,
	errorMessage,
	isValidRunSeed,
	type EndlessRunFloor,
	type RunFinal,
	type SegmentVerdict,
	type RunSubmission,
	type RunWorld,
	type RunWorldKind,
	type StartRunReply,
	type StartRunRequest,
} from "shared/run";
import {
	EMPTY_INPUT,
	isDraftOpen,
	partySize,
	playerAt,
	stressConfig,
	stressTargetFrom,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { TUTORIAL } from "shared/config";
import { BIOMES, type ThemePack } from "shared/theme";
import { RENDER_ORDER } from "shared/view";
import { HitstopClock, simPacerFor, type FrameAdvance, type FramePacer } from "shared/view/fx";
import { PROGRESSION_VIEW, toastFor } from "shared/view/hud";
import { lobbyStartAccepted, restartForfeits } from "shared/view/menu";
import type { Dungeon } from "shared/dungeon";
import { InputController } from "./InputController";
import { ThemeController } from "./ThemeController";

const RENDER_STEP = "KV_Sim";
const WORLDS: ReadonlyArray<RunWorld> = ["game", "endless", "dungeonNoEncounter", "greybox"];

/**
 * Paces a finished tutorial run: every frame frozen, so the run stays on screen (its last state, alpha unchanged) but
 * runs no tick, records nothing and reports no events (LiveRun.frame still resets the frame's events).
 */
const FROZEN_PACER: FramePacer = {
	frame(_realDeltaSeconds: number, out: FrameAdvance): FrameAdvance {
		out.simDelta = 0;
		out.frozen = true;
		out.timeScale = 0;
		out.frozenMs = 0;
		return out;
	},
};

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
	 * A first-run tutorial run (world `tutorial`, docs/TUTORIAL.md): local, never submitted (verdict `tutorial`), no
	 * segments, no R / pad restart (the pause overlay has Restart tutorial and Skip tutorial).
	 */
	readonly tutorial: boolean;
}

export type RunListener = (ctx: RunContext) => void;
/** The run was left for the menu: "left" (Leave run, mid-run) or "exited" (Main menu / Back to lobby after it). */
export type RunExitListener = (how: "left" | "exited") => void;

interface MadeRun {
	readonly run: LiveRun;
	readonly config: Readonly<SimConfig>;
	readonly dungeon: Dungeon | undefined;
	readonly endlessFloor: ((floor: number) => EndlessRunFloor) | undefined;
}

/** KV_World, else the place's play mode (shared/run LIVE_RUN_WORLD: "endless" unless shared/config PLAY_MODE is "m1"). */
function readWorld(): RunWorld {
	const raw = Workspace.GetAttribute(RUN_ATTRIBUTES.world);
	return typeIs(raw, "string") && WORLDS.includes(raw as RunWorld) ? (raw as RunWorld) : LIVE_RUN_WORLD;
}

function readSeed(): number {
	const raw = Workspace.GetAttribute(RUN_ATTRIBUTES.seed);
	if (raw === undefined) return DEFAULT_RUN_SEED;
	if (isValidRunSeed(raw)) return raw;
	warn(`[Sim] ${RUN_ATTRIBUTES.seed} = ${tostring(raw)} is not an integer in [0, 2^32); using ${DEFAULT_RUN_SEED}`);
	return DEFAULT_RUN_SEED;
}

function placeKeyFor(pack: ThemePack, dungeon: Dungeon | undefined): string {
	if (dungeon === undefined) return "";
	const biome = BIOMES.find((b) => b.forgeTheme === dungeon.params.themeKey);
	return biome !== undefined ? pack.biome(biome.id).nameKey : "";
}

/** The floor's biome as 1..5 (theme BIOMES order), 0 without a floor. */
function biomeIndexFor(dungeon: Dungeon | undefined): number {
	if (dungeon === undefined) return 0;
	const i = BIOMES.findIndex((b) => b.forgeTheme === dungeon.params.themeKey);
	return i >= 0 ? i + 1 : 0;
}

/**
 * Owns the live run (port of the web build's SimDriver): builds it with shared/run `buildWorldSetup` (the world
 * registry the server's replay uses, so both worlds are identical; endless by default, always scored), and once per rendered frame (BindToRenderStep, right after
 * Input) samples input ONCE and advances the FixedStepLoop, recording that frame for every tick (shared/play LiveRun).
 *
 * Views read the run through `getContext()` / `getState()` / `getAlpha()` / `getFrameEvents()` and never write it. The
 * Reflex store only gets the ~10 Hz HUD snapshot. At the run's end (death or boss kill; or R before either) it submits
 * { seed, recording (binary), claimedHash, claimed summary } once and stores the server's verdict; short abandoned
 * runs and runs over the server's caps are not sent (shared/play submitPolicy.ts).
 *
 * Attributes (Workspace, read at every run start): KV_Seed, KV_Debug, KV_SpawnBoss (debug), KV_Stress, KV_World,
 * KV_Scoring (M2 scoring on an M1 world, off by default; endless runs are always scored).
 * Pause: P / Start (the sim's PAUSE bit), automatically while the Roblox menu or the juice settings panel is open, and
 * resumable from the pause overlay (resume()).
 *
 * Menu (task L3): no run starts on its own; MenuController calls `startSolo()` (Play solo, a one-player lobby's
 * `lobbyRunStart`, or at once with KV_SkipMenu), and a party run starts on `partyRunStarted` for the lobby this
 * client is in (shared/view/menu lobbyStartAccepted). `leaveRun()` (pause overlay "Leave run", task L6): a solo run is
 * forfeited (LiveRun.requestForfeit: it ends as a death and is submitted like one), a party run is left with
 * `lockstepLeave`; `exitRun()` leaves a finished run (run-over "Main menu" / "Back to lobby"). Either way the run
 * stops (no context, the HUD inactive) and the exit listener (MenuController) opens the menu. R / Restart mid-run
 * forfeits a ranked solo run too and starts the next one once that death was submitted (restartForfeits); in a party
 * run R only works once the party is down, and then goes back to the lobby.
 *
 * Tutorial (docs/TUTORIAL.md, TutorialController): `startTutorial()` plays world `tutorial` locally (never asks
 * `startRun`, never submitted: verdict `tutorial`; RunContext.tutorial). R / pad restart do nothing in it; Leave run
 * (the pause overlay's Skip tutorial) just stops it for the menu; `freezeTutorialRun()` holds the finished run on
 * screen under the outro; a party run start is ignored while it is being played (`inRunningTutorial`).
 *
 * Hitstop: the run's HitstopClock (`hitstop`, fed by the FreezeFrameController's rules) paces the loop exactly as the
 * web SimDriver's computeFrameAdvance: a frozen frame runs no tick and records nothing, slow motion feeds less time.
 * Recordings and hashes never depend on it (shared/play liveRun.hitstop.spec.ts).
 *
 * Ranked runs (M3 / M5, docs/SERVER.md "Segmented runs"): unless a debug attribute fixes the seed or world (or stress
 * is on), a run start asks the server (`startRun`) and plays the seed it answers with, on RANKED_WORLD_KIND. The
 * LiveRun cuts segments (floor change via its hook, else every SEGMENT_FALLBACK_TICKS) and this uploads them as they
 * are cut (`submitSegment`); the run's end cuts the last one and sends `finishRun`, answered by `runFinished`. No
 * answer within RUN_START_TIMEOUT_SECONDS (or a refusal): an unranked run on the local seed, submitted the old way.
 * Each segment the server verified releases its recorded frames (LiveRun.releaseVerifiedFrames), except with
 * KV_Debug (F8's replay check replays the whole recording).
 */
@Controller({})
export class SimController implements OnStart {
	private ctx: RunContext | undefined;
	private readonly listeners = new Array<RunListener>();
	private readonly floorListeners = new Array<RunListener>();
	private readonly input = { ...EMPTY_INPUT };
	private counter = 0;
	private debug = false;
	private submitted = false;
	/** The last run submitted ended in a death: the next run is a retry and is submitted even if abandoned early. */
	private lastSubmittedDied = false;
	private pendingReset = false;
	private pendingReplayCheck = false;
	private pausedByMenu = false;
	private pausedByUi = false;
	/** A menu that takes the controls (the juice settings panel) is open: the run stays paused until it closes. */
	private uiPauseOpen = false;
	private lastPaused = false;
	private hudTimer = 0;
	/** Serial of the last HUD toast (M2 progression events). */
	private toastSerial = 0;
	/** claimedHash -> run counter of submissions waiting for a verdict. */
	private readonly awaiting = new Map<string, { run: number; ending: string }>();
	/** Ranked runs started this session: runId -> run counter and (once finished) ending. */
	private readonly rankedRuns = new Map<string, { run: number; ending?: string; decided: boolean }>();
	/** The `startRun` request waiting for `runStarted`, with the local fallback run's parameters. */
	private awaitingStart:
		| {
				requestId: number;
				sentAt: number;
				seed: number;
				atBossDoor: boolean;
				world: RunWorld;
				request: StartRunRequest;
				busyRetries: number;
				retryAt?: number;
		  }
		| undefined;
	private startReply: StartRunReply | undefined;
	private startRequests = 0;
	/** Back to the lobby asked after the party went down, before its verdict: the run is left when it arrives. */
	private exitAfterVerdict = false;
	/** Leave run was asked: the forfeit tick is pending; the run is left once its death was submitted. */
	private leaveAfterForfeit = false;
	/** R / Restart forfeited a ranked run: the next run starts once its death was submitted. */
	private restartAfterForfeit = false;
	/** The lobby the next solo run belongs to (startSolo); "" for the main menu's Play solo and for restarts. */
	private nextRunLobbyId = "";
	private readonly exitListeners = new Array<RunExitListener>();

	/** Co-op: neutral input while a menu owns the controls (a party run never pauses under one). */
	private readonly coopMenuGate = new CoopMenuInputGate();
	/** The Roblox menu is open (GuiService.MenuOpened / MenuClosed). */
	private robloxMenuOpen = false;
	/** The finished tutorial run is frozen on screen (no ticks) until the next run starts. */
	private frozen = false;

	/** The freeze frame / slow motion clock (presentation pacing only; cleared at every run start). */
	readonly hitstop = new HitstopClock();

	constructor(private readonly inputController: InputController, private readonly theme: ThemeController) {}

	onStart(): void {
		this.inputController.onDriverAction((action) => {
			// R / pad restart: handleReset (nothing in a tutorial run: its pause overlay has Restart tutorial).
			if (action === "reset") this.pendingReset = true;
			else this.pendingReplayCheck = true;
		});
		this.inputController.setRunOverOrPaused(() => {
			const ctx = this.ctx;
			if (ctx?.coop !== undefined) return ctx.coop.isOver();
			const run = ctx?.live;
			return run === undefined || run.isPaused() || run.outcome() !== "playing";
		});
		Events.partyRunStarted.connect((start) => this.startCoop(start));
		Events.lockstepFrames.connect((runId, firstTick, data, hashAck) => {
			const coop = this.ctx?.coop;
			if (coop === undefined || coop.runId !== runId) return;
			if (!coop.receive(firstTick, data)) warn(`[Sim] co-op run ${runId}: ${coop.brokenReason() ?? ""}`);
			coop.acknowledge(hashAck);
		});
		Events.runVerdict.connect((verdict) => this.onVerdict(verdict));
		Events.runStarted.connect((reply) => {
			if (this.awaitingStart !== undefined && reply.requestId === this.awaitingStart.requestId) {
				this.startReply = reply;
			}
		});
		Events.segmentVerdict.connect((v) => {
			if (!v.ok) warn(`[Sim] segment ${v.index} of run ${v.runId} refused: ${v.code ?? ""} ${v.reason ?? ""}`);
			else this.onSegmentVerified(v);
		});
		Events.runFinished.connect((verdict) => this.onRunFinished(verdict));
		GuiService.MenuOpened.Connect(() => {
			this.robloxMenuOpen = true;
			const run = this.ctx?.live; // a co-op run never pauses (the server's clock paces it): neutral input instead
			if (run !== undefined && !run.isPaused()) {
				run.setPaused(true);
				this.pausedByMenu = true;
			}
		});
		GuiService.MenuClosed.Connect(() => {
			this.robloxMenuOpen = false;
			if (this.pausedByMenu) this.ctx?.live?.setPaused(false);
			this.pausedByMenu = false;
		});

		// No run yet: MenuController starts one (Play solo, a lobby, or at once with KV_SkipMenu), or the
		// TutorialController's first-run gate starts the tutorial (a first join).
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Input.Value + RENDER_ORDER.simAfterInput, (dt) =>
			this.frame(dt),
		);
	}

	// --- read access for views (never write the state) -----------------------------------------

	getContext(): RunContext | undefined {
		return this.ctx;
	}

	getState(): SimState | undefined {
		return this.ctx?.run.state;
	}

	getAlpha(): number {
		return this.ctx?.run.getAlpha() ?? 0;
	}

	/** Events of the ticks the last frame ran (summed; see shared/play FrameEvents). */
	getFrameEvents(): FrameEvents | undefined {
		return this.ctx?.run.frameEvents;
	}

	/** This client's player index in the run (co-op: its place in the party; 0 solo). */
	getLocalPlayerIndex(): number {
		return this.ctx?.localIndex ?? 0;
	}

	/** The buttons of the input sampled for the last frame (the tutorial director's FIRE edge). */
	getFrameButtons(): number {
		return this.input.buttons;
	}

	/** The current run is a tutorial run. */
	isTutorialRun(): boolean {
		return this.ctx?.tutorial === true;
	}

	/** The finished tutorial run is frozen (freezeTutorialRun). */
	isFrozen(): boolean {
		return this.frozen;
	}

	// --- tutorial (TutorialController) ---------------------------------------------------------

	/**
	 * Starts a first-run tutorial run now (local, world `tutorial`): the first-run gate on a first join, the main menu's
	 * Tutorial, the pause overlay's Restart tutorial and the outro's Play the tutorial again. The current solo run is
	 * left as by Play solo (submitted as abandoned when it qualifies; a tutorial run never is). Ignored while a party
	 * run is on.
	 */
	startTutorial(): void {
		if (this.ctx?.coop !== undefined && !this.ctx.coop.isOver()) return;
		this.clearExits();
		if (this.ctx?.live !== undefined) this.submit("abandoned");
		this.nextRunLobbyId = "";
		this.beginTutorial();
	}

	/**
	 * The tutorial finished (the floor 2 -> 3 change): the run freezes on screen, no tick more (the floor 3 draft never
	 * opens a step further), and the verdict line reads the tutorial's own "not submitted". Until the next run starts.
	 */
	freezeTutorialRun(): void {
		const ctx = this.ctx;
		if (ctx === undefined || !ctx.tutorial || this.frozen) return;
		this.frozen = true;
		this.submitted = true;
		this.hitstop.clear(); // a boss-kill freeze / slow motion would otherwise hold the particles still
		clientStore.setVerdict({ status: "skipped", run: ctx.counter, ending: "abandoned", code: "tutorial" });
		print(`[Sim] tutorial run ${ctx.counter} finished at tick ${ctx.run.state.tick}`);
	}

	/** A tutorial run is being played (not yet finished): lobby run starts must not take it over. */
	inRunningTutorial(): boolean {
		return this.ctx?.tutorial === true && !this.frozen;
	}

	// --- menu actions (pause overlay, settings panel) -------------------------------------------

	/** Resume a paused run (pause overlay "Resume"; P / Start toggle it too). */
	resume(): void {
		this.pausedByMenu = false;
		this.pausedByUi = false;
		this.ctx?.live?.setPaused(false);
	}

	/** Restart on the next frame (pause overlay "Restart", run-over "Again"; same as R). */
	requestRestart(): void {
		this.pendingReset = true;
	}

	/**
	 * Starts a solo run now (the menu's Play solo; `lobbyId` for a one-player lobby's `lobbyRunStart`): ranked unless
	 * a debug attribute says otherwise (beginRun). Ignored while a party run is on.
	 */
	startSolo(lobbyId?: string): void {
		if (this.ctx?.coop !== undefined && !this.ctx.coop.isOver()) return;
		this.clearExits();
		if (this.ctx?.live !== undefined) this.submit("abandoned"); // (only if not submitted yet, as R does)
		this.nextRunLobbyId = lobbyId ?? "";
		this.beginRun();
	}

	/**
	 * Leave run (pause overlay / party overlay, after the confirm). Solo: the run is forfeited (the next frame steps
	 * the forfeit tick: a death, submitted like any death), then left. Party: `lockstepLeave` (the server plays this
	 * player as disconnected; the others play on) and the run is left at once. A tutorial run (Skip tutorial) is left
	 * at once, unsubmitted. A finished run is just left; a ranked start still waiting for the server is dropped (the
	 * server abandons that session at the next startRun).
	 */
	leaveRun(): void {
		const ctx = this.ctx;
		if (ctx === undefined) {
			this.stopRun("left");
			return;
		}
		const coop = ctx.coop;
		if (coop !== undefined) {
			if (!coop.isOver()) {
				Events.lockstepLeave.fire(coop.runId);
				print(`[Sim] left co-op run ${ctx.counter} (${coop.runId})`);
			}
			coop.stop();
			this.stopRun("left");
			return;
		}
		if (ctx.tutorial) {
			// Skip tutorial: a practice run is never submitted (submit records the "tutorial" verdict) or forfeited.
			this.submit("abandoned");
			this.stopRun("left");
			return;
		}
		const live = ctx.live;
		if (live !== undefined && live.requestForfeit()) {
			this.restartAfterForfeit = false;
			this.leaveAfterForfeit = true;
			print(`[Sim] run ${ctx.counter}: leaving (forfeit; counts as a death)`);
			return;
		}
		this.exitRun();
	}

	/**
	 * Leaves a finished run for the menu (run-over "Main menu" / "Back to lobby"; R once a party is down). A party
	 * run waits for its verdict first (the server decides it from every member's final). A run still being played is
	 * left through leaveRun (forfeit / lockstepLeave).
	 */
	exitRun(): void {
		const ctx = this.ctx;
		if (ctx === undefined) {
			this.stopRun("exited");
			return;
		}
		const coop = ctx.coop;
		if (coop !== undefined) {
			if (!coop.isOver()) {
				this.leaveRun();
				return;
			}
			if (this.rankedRuns.get(coop.runId)?.decided === true) {
				coop.stop();
				this.stopRun("exited");
			} else if (!this.exitAfterVerdict) {
				this.exitAfterVerdict = true;
				print("[Sim] the party's verdict is still being decided; back to the lobby once it arrives");
			}
			return;
		}
		if (ctx.live !== undefined && ctx.live.outcome() === "playing") {
			this.leaveRun();
			return;
		}
		this.stopRun("exited");
	}

	/** The run was left for the menu (leaveRun / exitRun, once done). MenuController opens the menu. */
	onRunExited(listener: RunExitListener): void {
		this.exitListeners.push(listener);
	}

	/**
	 * A menu that takes the controls (the juice settings panel) opened or closed: pauses a running run while it is
	 * open and resumes it on close, unless something else paused it first (like the Roblox menu does).
	 */
	setUiPause(open: boolean): void {
		this.uiPauseOpen = open;
		const run = this.ctx?.live;
		if (run === undefined) return;
		if (open) {
			if (!run.isPaused()) {
				run.setPaused(true);
				this.pausedByUi = true;
			}
		} else if (this.pausedByUi) {
			this.pausedByUi = false;
			run.setPaused(false);
		}
	}

	/** Called now with the current run (if any) and at every run start (mount, restart). */
	onRunStarted(listener: RunListener): void {
		this.listeners.push(listener);
		if (this.ctx !== undefined) listener(this.ctx);
	}

	/**
	 * Endless mode: called after a frame in which the run moved to another floor, with the updated context (its
	 * config / dungeon / floor are the new floor's). Not called at run start (onRunStarted covers floor 1).
	 */
	onFloorChanged(listener: RunListener): void {
		this.floorListeners.push(listener);
	}

	// --- run lifecycle -------------------------------------------------------------------------

	/**
	 * Starts the next run: a ranked one (asks the server for the seed; the run starts in `frame` once it answers) or,
	 * with a debug seed / world / stress attribute, an unranked one on the local seed at once.
	 */
	private beginRun(): void {
		this.frozen = false;
		this.debug = Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		this.inputController.setDebug(this.debug);
		const seed = readSeed();
		const world = readWorld();
		// Endless runs always start at floor 1's entrance and never run the stress emitter.
		const atBossDoor =
			world !== "endless" && this.debug && Workspace.GetAttribute(RUN_ATTRIBUTES.spawnBoss) === true;
		const stress = world !== "endless" ? stressTargetFrom(Workspace.GetAttribute(RUN_ATTRIBUTES.stress)) : 0;
		const ranked = shouldRequestServerRun({
			seedAttributeSet: Workspace.GetAttribute(RUN_ATTRIBUTES.seed) !== undefined,
			worldAttributeSet: Workspace.GetAttribute(RUN_ATTRIBUTES.world) !== undefined,
			stress,
		});
		if (!ranked) {
			this.startRun(seed, atBossDoor, stress, world, undefined, "", false);
			return;
		}
		// The old run stops here; views see no run until the server answers (or the timeout falls back).
		this.ctx = undefined;
		clientStore.setRunStarting(true);
		this.startRequests++;
		this.startReply = undefined;
		const request: StartRunRequest = {
			requestId: this.startRequests,
			worldKind: RANKED_WORLD_KIND,
			atBossDoor: atBossDoor && RANKED_WORLD_KIND !== "endless" ? true : undefined,
		};
		this.awaitingStart = {
			requestId: this.startRequests,
			sentAt: os.clock(),
			seed,
			atBossDoor,
			world,
			request,
			busyRetries: 0,
		};
		Events.startRun.fire(request);
	}

	/** Drops the pending leave / restart / exit requests (a new run starts, or the run was left). */
	private clearExits(): void {
		this.leaveAfterForfeit = false;
		this.restartAfterForfeit = false;
		this.exitAfterVerdict = false;
		this.pendingReset = false;
	}

	/** No run any more (the menu takes over): no context, no pending start, the HUD inactive; tells the listeners. */
	private stopRun(how: "left" | "exited"): void {
		this.clearExits();
		this.ctx = undefined;
		this.frozen = false;
		this.awaitingStart = undefined;
		this.startReply = undefined;
		this.pausedByMenu = false;
		this.pausedByUi = false;
		this.hitstop.clear();
		clientStore.endRun();
		for (const listener of this.exitListeners) listener(how);
	}

	/**
	 * Starts a first-run tutorial run at once, locally (docs/TUTORIAL.md): world `tutorial` on TUTORIAL.runSeed (the
	 * layouts are fixed whatever the seed), never asking `startRun`, never submitted. If the world cannot be built, the
	 * run stops for the menu (as after Leave run).
	 */
	private beginTutorial(): void {
		this.debug = Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		this.inputController.setDebug(this.debug);
		this.awaitingStart = undefined; // a ranked start still waiting is dropped (the server replaces that session)
		this.startReply = undefined;
		this.startRun(TUTORIAL.runSeed, false, 0, TUTORIAL_WORLD_KIND, undefined, "", true);
	}

	// --- co-op (M4, shared/lockstep) ------------------------------------------------------------

	/**
	 * A party run starts (every member gets `partyRunStarted`): the sim is a LockstepClient stepped ONLY by the
	 * server's merged frames. No pause, no hitstop pacing (shared/view/fx `simPacerFor`), no restart mid-run.
	 */
	private startCoop(start: PartyRunStart): void {
		const localIndex = start.members.indexOf(Players.LocalPlayer.UserId);
		if (localIndex < 0 || !isValidRunSeed(start.seed)) return;
		// Never pulled out of a running tutorial (the server refuses lobby starts while the player is in it too; this
		// is a late or stray start). A finished tutorial (frozen on its outro) is over: a lobby run may take over.
		if (this.inRunningTutorial()) {
			warn(`[Sim] ignored party run ${start.runId}: in the tutorial`);
			return;
		}
		// Consent: only the party run of the lobby this client is in (its Start began it).
		const myLobby = clientStore.getState().lobby.mine?.lobbyId;
		if (!lobbyStartAccepted(start.lobbyId, myLobby)) {
			warn(`[Sim] ignored party run ${start.runId}: lobby ${start.lobbyId} is not this client's lobby`);
			return;
		}
		this.clearExits();
		// The owner's own `runStarted` reply follows; it must not start a solo run on top of this one.
		this.awaitingStart = undefined;
		this.startReply = undefined;
		const [ok, result] = pcall(() =>
			buildWorldSetup(start.worldKind, start.seed, { atBossDoor: false, partySize: start.members.size() }),
		);
		if (!ok) {
			warn(`[Sim] co-op run ${start.runId} could not start: ${errorMessage(result)}`);
			return;
		}
		const setup = result as ReturnType<typeof buildWorldSetup>;
		const spawn = setup.spawn ?? { x: 0, z: 0 };
		const client = new LockstepClient({
			runId: start.runId,
			seed: start.seed,
			spawn,
			config: setup.config,
			players: start.members.size(),
			localIndex,
		});
		this.counter++;
		this.submitted = false;
		this.hudTimer = 0;
		this.hitstop.clear();
		const floor = client.state.endless?.floor ?? 0;
		const ctx: RunContext = {
			run: client,
			live: undefined,
			coop: client,
			localIndex,
			seed: start.seed,
			world: start.worldKind,
			atBossDoor: false,
			runId: start.runId,
			stress: 0,
			scoring: false,
			config: setup.endlessFloor !== undefined ? setup.endlessFloor(floor).config : setup.config,
			dungeon: setup.dungeon,
			counter: this.counter,
			floor,
			endlessFloor: setup.endlessFloor,
			lobbyId: start.lobbyId,
			tutorial: false,
		};
		this.frozen = false;
		this.ctx = ctx;
		this.rankedRuns.set(start.runId, { run: this.counter, decided: false });
		clientStore.startRun(this.runInfo(this.theme.getPack(), ctx, ""), this.coopSnapshot(client));
		print(
			`[Sim] co-op run ${this.counter} started: ${start.runId} seed ${start.seed}, player ${localIndex + 1} of ` +
				`${start.members.size()}`,
		);
		for (const listener of this.listeners) listener(ctx);
	}

	/** One rendered frame of a co-op run: step the merged frames that arrived, send inputs / hashes / the final. */
	private coopFrame(ctx: RunContext, coop: LockstepClient, dt: number): void {
		const me = playerAt(coop.state, ctx.localIndex);
		// A menu over the run (party overlay, Options, a rebind capture, leaderboards, the Roblox menu): the pad and
		// keys drive the menu, never the character (solo pauses instead).
		const input = this.coopMenuGate.apply(
			this.inputController.sample(me.x, me.z, this.input),
			this.inputController.menuOwnsInput() || this.robloxMenuOpen,
		);
		const res = coop.pump(dt, () => input);
		const runId = coop.runId;
		for (const b of res.inputs) Events.lockstepInput.fire(runId, b.firstTick, b.data);
		// One call with every report due (new ones and unacknowledged resends; LockstepClient throttles it).
		if (res.hashes.size() > 0) {
			Events.lockstepHash.fire(
				runId,
				res.hashes.map((h) => h.tick),
				res.hashes.map((h) => h.hash),
			);
		}
		if (res.final !== undefined) {
			const entry = this.rankedRuns.get(runId);
			if (entry !== undefined) entry.ending = "death";
			clientStore.setVerdict({
				status: "pending",
				run: ctx.counter,
				ending: "death",
				claimedHash: res.final.claimedHash,
			});
			Events.lockstepFinal.fire(res.final);
			print(`[Sim] co-op run ${ctx.counter} over at tick ${res.final.finalTick}, hash ${res.final.claimedHash}`);
		}
		const floor = coop.state.endless?.floor;
		if (floor !== undefined && floor !== ctx.floor) this.changeFloor(ctx, floor);
		// M2 progression: the local player's toasts; while any draft is open (the world frozen until every player
		// confirmed) the overlay follows the stick and the "waiting for N teammates" line every frame.
		this.pushToasts(coop);
		this.hudTimer += math.max(dt, 0);
		if (coop.runEvents.size() > 0 || isDraftOpen(coop.state)) this.hudTimer = HUD_SNAPSHOT_INTERVAL_SEC;
		if (this.hudTimer >= HUD_SNAPSHOT_INTERVAL_SEC) {
			this.hudTimer = 0;
			clientStore.setSnapshot(this.coopSnapshot(coop));
		}
	}

	private coopSnapshot(coop: LockstepClient) {
		const over = coop.isOver();
		return takeSnapshot(coop.state, {
			paused: false,
			outcome: over ? "dead" : "playing",
			recordedTicks: coop.state.tick,
			kills: coop.kills,
			hitsTaken: coop.hitsTaken,
			endTick: coop.state.tick,
			playerIndex: coop.localIndex,
			config: coop.config,
		});
	}

	/** While a `startRun` is pending: starts the run once answered or timed out. True while still waiting. */
	private pollRunStart(): boolean {
		const waiting = this.awaitingStart;
		if (waiting === undefined) return false;
		const reply = this.startReply;
		if (reply !== undefined && !reply.ok && reply.code === "busy" && waiting.busyRetries < RUN_START_BUSY_RETRIES) {
			// A party run of ours is still being decided (or earlier runs are being checked): ask again shortly.
			this.startReply = undefined;
			waiting.busyRetries++;
			waiting.retryAt = os.clock() + RUN_START_BUSY_RETRY_SECONDS;
			if (waiting.busyRetries === 1)
				print(`[Sim] server busy (${reply.reason ?? ""}); retrying the ranked start`);
			return true;
		}
		if (waiting.retryAt !== undefined) {
			if (os.clock() < waiting.retryAt) return true;
			waiting.retryAt = undefined;
			waiting.sentAt = os.clock();
			Events.startRun.fire(waiting.request);
			return true;
		}
		if (reply !== undefined) {
			this.awaitingStart = undefined;
			this.startReply = undefined;
			if (reply.ok && reply.runId !== undefined && reply.seed !== undefined && isValidRunSeed(reply.seed)) {
				const world = reply.worldKind ?? RANKED_WORLD_KIND;
				this.startRun(reply.seed, reply.atBossDoor === true, 0, world, reply.runId, "", false);
			} else {
				warn(`[Sim] ranked run refused (${reply.code ?? "?"}: ${reply.reason ?? ""}); playing unranked`);
				this.startRun(waiting.seed, waiting.atBossDoor, 0, waiting.world, undefined, "", false);
			}
			return false;
		}
		if (os.clock() - waiting.sentAt < RUN_START_TIMEOUT_SECONDS) return true;
		this.awaitingStart = undefined;
		warn(`[Sim] no answer to startRun after ${RUN_START_TIMEOUT_SECONDS} s; playing unranked`);
		this.startRun(waiting.seed, waiting.atBossDoor, 0, waiting.world, undefined, "", false);
		return false;
	}

	private startRun(
		seed: number,
		atBossDoor: boolean,
		stress: number,
		requestedWorld: RunWorldKind,
		requestedRunId: string | undefined,
		startNotice: string,
		tutorial: boolean,
	): void {
		const pack = this.theme.getPack();
		let world = requestedWorld;
		let runId = requestedRunId;
		let notice = startNotice;
		// Endless is always scored by its own config; KV_Scoring opts an unranked run of another world in. (The
		// tutorial world is scored by its own config too.)
		const scoring =
			!tutorial &&
			world !== "endless" &&
			runId === undefined &&
			Workspace.GetAttribute(RUN_ATTRIBUTES.scoring) === true;

		let made = this.makeRun(seed, atBossDoor, stress, world, runId, scoring);
		if (typeIs(made, "string") && runId !== undefined) {
			// The server built this world; the client could not. Play it unranked (the fallback below may apply).
			warn(`[Sim] ranked run ${runId} could not start (${made}); playing unranked`);
			runId = undefined;
			made = this.makeRun(seed, atBossDoor, stress, world, runId, scoring);
		}
		if (typeIs(made, "string") && world === "game") {
			notice = made;
			warn(`[Sim] enemies unavailable (${made}); playing the floor without enemies`);
			world = "dungeonNoEncounter";
			made = this.makeRun(seed, atBossDoor, stress, world, undefined, scoring);
			runId = undefined;
		}
		if (typeIs(made, "string") && tutorial) {
			// The menu takes over, as after Leave run (the normal flow: the main menu, or the lobby room in a lobby).
			warn(`[Sim] the tutorial could not start (${made}); back to the menu`);
			this.stopRun("left");
			return;
		}
		if (typeIs(made, "string")) {
			error(`[Sim] could not start a run: ${made}`);
		}
		const { run, config, dungeon, endlessFloor } = made;
		this.counter++;
		this.submitted = false;
		this.hudTimer = 0;
		this.pausedByMenu = false;
		this.pausedByUi = false;
		this.frozen = false;
		this.hitstop.clear(); // a pending freeze / slow motion belongs to the old run
		const floor = run.state.endless?.floor ?? 0;
		const ctx: RunContext = {
			run,
			live: run,
			coop: undefined,
			localIndex: 0,
			seed,
			world,
			atBossDoor,
			runId,
			stress,
			scoring,
			config: endlessFloor !== undefined ? endlessFloor(floor).config : config,
			dungeon,
			counter: this.counter,
			floor,
			endlessFloor,
			lobbyId: tutorial ? "" : this.nextRunLobbyId,
			tutorial,
		};
		this.nextRunLobbyId = ""; // a restart (R) is a plain solo run
		this.ctx = ctx;
		if (runId !== undefined) this.rankedRuns.set(runId, { run: this.counter, decided: false });

		const info = this.runInfo(pack, ctx, notice);
		clientStore.startRun(info, this.snapshot(run));
		print(
			`[Sim] run ${this.counter} started: seed ${seed}, world ${world}${atBossDoor ? ", boss door" : ""}` +
				(runId !== undefined ? `, ranked run ${runId}` : "") +
				(tutorial ? " (tutorial: local, not submitted)" : ""),
		);
		for (const listener of this.listeners) listener(ctx);
	}

	private runInfo(pack: ThemePack, ctx: RunContext, notice: string): RunInfo {
		return {
			seed: ctx.seed,
			world: ctx.world,
			placeKey: placeKeyFor(pack, ctx.dungeon),
			dungeonName: ctx.dungeon?.name ?? "",
			debug: this.debug,
			run: ctx.counter,
			notice,
			biome: biomeIndexFor(ctx.dungeon),
			coop: ctx.coop !== undefined,
			lobbyId: ctx.lobbyId,
		};
	}

	/** Endless mode: the run is on another floor than the context says; switch the context and tell the views. */
	private changeFloor(ctx: RunContext, floor: number): void {
		const endlessFloor = ctx.endlessFloor;
		if (endlessFloor === undefined) return;
		const w = endlessFloor(floor);
		const moved: RunContext = { ...ctx, floor, config: w.config, dungeon: w.dungeon };
		this.ctx = moved;
		clientStore.changeFloor(this.runInfo(this.theme.getPack(), moved, clientStore.getState().game.run.notice));
		print(`[Sim] run ${moved.counter}: floor ${floor} (${w.dungeon.name}${w.bossFloor ? ", boss floor" : ""})`);
		for (const listener of this.floorListeners) listener(moved);
	}

	/**
	 * Builds the run's world (the world registry: the same builder as the server's) and a LiveRun (segmented when
	 * `runId` is set: one segment per endless floor, cut on the floor-change tick); returns the error message when
	 * the sim refuses the config. `scoring` adds M2 scoring to a non-endless world (KV_Scoring, never submitted).
	 */
	private makeRun(
		seed: number,
		atBossDoor: boolean,
		stress: number,
		world: RunWorldKind,
		runId: string | undefined,
		scoring: boolean,
	): MadeRun | string {
		const [ok, result] = pcall(() => {
			const setup = buildWorldSetup(world, seed, { atBossDoor });
			const spawn = setup.spawn ?? { x: 0, z: 0 };
			const stressCfg = stressConfig(stress, spawn.x, spawn.z);
			const config: Readonly<SimConfig> =
				stressCfg !== undefined ? { ...setup.config, stress: stressCfg } : setup.config;
			const scored: Readonly<SimConfig> =
				scoring && config.scoring === undefined ? { ...config, scoring: {} } : config;
			const runSetup: LiveRunSetup = {
				seed,
				spawnX: spawn.x,
				spawnZ: spawn.z,
				config: scored,
				atBossDoor,
				runId,
				segmentCutAfterTick: (state) => state.events.floorChanged !== 0,
			};
			return {
				run: new LiveRun(runSetup),
				config: scored,
				dungeon: setup.dungeon,
				endlessFloor: setup.endlessFloor,
			};
		});
		return ok ? (result as MadeRun) : errorMessage(result);
	}

	private frame(dt: number): void {
		if (this.pendingReset) {
			this.pendingReset = false;
			this.handleReset();
		}
		if (this.pollRunStart()) return;
		const ctx = this.ctx;
		if (ctx === undefined) return;
		if (ctx.coop !== undefined) {
			this.coopFrame(ctx, ctx.coop, dt);
			return;
		}
		const run = ctx.live;
		if (run === undefined) return;
		if (this.frozen) {
			// The finished tutorial stays on screen: no input, no tick, the frame's events reset (no repeated sounds).
			run.frame(dt, EMPTY_INPUT, FROZEN_PACER);
			return;
		}
		if (this.pendingReplayCheck) {
			this.pendingReplayCheck = false;
			this.replayCheck(run);
		}

		const p = run.state.player;
		const input = this.inputController.sample(p.x, p.z, this.input);
		run.frame(dt, input, simPacerFor(partySize(run.state), this.hitstop)); // solo: the hitstop clock paces
		const floor = run.state.endless?.floor;
		if (floor !== undefined && floor !== ctx.floor) this.changeFloor(ctx, floor);
		this.uploadSegments(this.ctx ?? ctx);
		// P / Start inside the settings panel: the run resumes when the panel closes, not under it.
		if (this.uiPauseOpen && !run.isPaused()) {
			run.setPaused(true);
			this.pausedByUi = true;
		}

		const outcome = run.outcome();
		if (outcome !== "playing" && !this.submitted) this.submit(outcome === "dead" ? "death" : "victory");
		// Leave run / a forfeiting restart: the forfeit tick ran and its death was submitted.
		if (outcome !== "playing" && this.submitted) {
			if (this.leaveAfterForfeit) {
				this.stopRun("left");
				return;
			}
			if (this.restartAfterForfeit) {
				this.restartAfterForfeit = false;
				this.beginRun();
				return;
			}
		}

		// M2 progression: toasts for this frame's events; the draft overlay follows the stick every frame.
		this.pushToasts(run);

		this.hudTimer += math.max(dt, 0);
		if (run.runEvents.size() > 0 || isDraftOpen(run.state)) this.hudTimer = HUD_SNAPSHOT_INTERVAL_SEC;
		// A pause toggle shows at once (the pause overlay), not at the next ~10 Hz snapshot.
		const paused = run.isPaused();
		if (paused !== this.lastPaused) {
			this.lastPaused = paused;
			this.hudTimer = HUD_SNAPSHOT_INTERVAL_SEC;
		}
		if (this.hudTimer >= HUD_SNAPSHOT_INTERVAL_SEC) {
			this.hudTimer = 0;
			clientStore.setSnapshot(this.snapshot(run));
		}
	}

	/**
	 * R / Restart / Again. Solo: a ranked run still being played is forfeited (restartForfeits: it counts as a death
	 * and is submitted; the next run starts once it was), any other run is submitted as abandoned and the next starts
	 * now. With no run (the menu) R does nothing. Co-op: no restart mid-run (no drop-in either); once the party is
	 * down it goes back to the lobby (after the party's verdict: exitRun).
	 */
	private handleReset(): void {
		const ctx = this.ctx;
		if (ctx === undefined) {
			if (this.awaitingStart !== undefined) this.beginRun(); // ask again (as before the menu existed)
			return;
		}
		const coop = ctx.coop;
		if (coop !== undefined) {
			if (coop.isOver()) this.exitRun();
			return;
		}
		const live = ctx.live;
		if (live === undefined || this.restartAfterForfeit || this.leaveAfterForfeit) return;
		if (ctx.tutorial) return; // no R / pad restart in the tutorial (the pause overlay has Restart tutorial)
		if (restartForfeits(ctx.runId !== undefined, live.outcome() === "playing") && live.requestForfeit()) {
			this.restartAfterForfeit = true;
			print(`[Sim] run ${ctx.counter}: restarting (forfeit; counts as a death)`);
			return;
		}
		this.submit("abandoned");
		this.beginRun();
	}

	/** M2 progression toasts for the local player's events of the last frame (solo or co-op), then expiry. */
	private pushToasts(view: RunView): void {
		const now = os.clock();
		for (const e of view.runEvents) {
			this.toastSerial++;
			const spec = toastFor(e.kind, e.index);
			clientStore.pushToast(
				{ id: this.toastSerial, ...spec, until: now + PROGRESSION_VIEW.toastSeconds },
				PROGRESSION_VIEW.maxToasts,
			);
		}
		clientStore.expireToasts(now);
	}

	private snapshot(run: LiveRun) {
		return takeSnapshot(run.state, {
			paused: run.isPaused(),
			outcome: run.outcome(),
			recordedTicks: run.ticks(),
			kills: run.kills,
			hitsTaken: run.hitsTaken,
			endTick: run.endTick(),
			config: run.setup.config,
		});
	}

	private replayCheck(run: LiveRun): void {
		const r = run.replayCheck();
		clientStore.setReplayCheck(r);
		const line = `[Sim] replay check @ tick ${run.state.tick}: ${r.match ? "MATCH" : "MISMATCH"} live=${
			r.liveHash
		} replay=${r.replayHash}`;
		if (r.match) print(line);
		else warn(line);
	}

	// --- submission ----------------------------------------------------------------------------

	/**
	 * Submits the current run once (death, victory, or abandoned by a restart). Short abandoned runs are not sent
	 * (shared/play `shouldSubmitRun`), and a run over the server's caps is kept and shown as rejected locally
	 * (`oversizeSubmission`): the server would reject it unread, after the upload.
	 */
	private submit(ending: RunEnding): void {
		const ctx = this.ctx;
		if (ctx === undefined || this.submitted) return;
		this.submitted = true;
		const run = ctx.live;
		if (run === undefined) return; // co-op runs end through lockstepFinal (coopFrame)
		if (run.ticks() === 0) return;
		// Tutorial runs are local practice; stress configs are never built by the server; a KV_Scoring run on an M1
		// world would never match the server's unscored replay.
		const never = unsubmittedReason(ctx);
		if (never !== undefined) {
			clientStore.setVerdict({ status: "skipped", run: ctx.counter, ending, code: never });
			return;
		}
		if (!shouldSubmitRun(ending, run.ticks(), this.lastSubmittedDied)) {
			// A ranked session left open is replaced (abandoned) by the next startRun.
			clientStore.setVerdict({ status: "skipped", run: ctx.counter, ending, code: "short" });
			return;
		}
		this.lastSubmittedDied = ending === "death";
		if (ctx.runId !== undefined) {
			this.finishRanked(ctx, ending);
			return;
		}
		const [ok, result] = pcall(() => run.submission());
		if (!ok) {
			warn(`[Sim] could not build the submission: ${errorMessage(result)}`);
			clientStore.setVerdict({ status: "skipped", run: ctx.counter, ending, code: "error" });
			return;
		}
		const submission = result as RunSubmission;
		const kept = oversizeSubmission(submission);
		if (kept !== undefined) {
			warn(
				`[Sim] run ${ctx.counter} (${ending}) ${kept.reason}: ${buffer.len(submission.recording)} bytes, ` +
					`${submission.claimed.ticks} ticks`,
			);
			clientStore.setVerdict({
				status: "rejected",
				run: ctx.counter,
				ending,
				code: kept.code,
				reason: kept.reason,
				claimedHash: submission.claimedHash,
			});
			return;
		}
		this.awaiting.set(submission.claimedHash, { run: ctx.counter, ending });
		clientStore.setVerdict({ status: "pending", run: ctx.counter, ending, claimedHash: submission.claimedHash });
		Events.submitRun.fire(submission);
		print(
			`[Sim] submitted run ${ctx.counter} (${ending}): ${submission.claimed.ticks} ticks, ` +
				`${buffer.len(submission.recording)} bytes, hash ${submission.claimedHash}`,
		);
	}

	/** Sends the segments the run cut (ranked runs that the server has not rejected yet). */
	private uploadSegments(ctx: RunContext): void {
		const runId = ctx.runId;
		const live = ctx.live;
		if (runId === undefined || live === undefined) return;
		const segments = live.takeSegments();
		if (this.rankedRuns.get(runId)?.decided === true) return; // rejected mid-run: the rest is unranked
		for (const segment of segments) Events.submitSegment.fire(segment);
	}

	/**
	 * A segment of a ranked run was verified: its frames are no longer needed (a ranked run never falls back to
	 * submitRun), so the recording is trimmed to the unverified tail. Not with KV_Debug: F8's replay check replays the
	 * whole recording.
	 */
	private onSegmentVerified(v: SegmentVerdict): void {
		const ctx = this.ctx;
		if (ctx === undefined || ctx.runId === undefined || ctx.runId !== v.runId || this.debug) return;
		ctx.live?.releaseVerifiedFrames(v.endTick);
	}

	/** The end of a ranked run: the last segment, then `finishRun` (answered by `runFinished`). */
	private finishRanked(ctx: RunContext, ending: RunEnding): void {
		const runId = ctx.runId!;
		const live = ctx.live;
		const entry = this.rankedRuns.get(runId);
		if (live === undefined || entry === undefined || entry.decided) return; // already rejected (the verdict shows it)
		entry.ending = ending;
		const [ok, result] = pcall(() => live.final());
		this.uploadSegments(ctx);
		if (!ok || result === undefined) {
			warn(`[Sim] could not build the final claim: ${errorMessage(result)}`);
			clientStore.setVerdict({ status: "skipped", run: ctx.counter, ending, code: "error" });
			return;
		}
		const final = result as RunFinal;
		clientStore.setVerdict({ status: "pending", run: ctx.counter, ending, claimedHash: final.claimedHash });
		Events.finishRun.fire(final);
		print(
			`[Sim] finished ranked run ${ctx.counter} (${ending}): ${final.finalTick} ticks in ` +
				`${live.segmentCount()} segments, hash ${final.claimedHash}`,
		);
	}

	private onRunFinished(v: RunFinishVerdict): void {
		const entry = this.rankedRuns.get(v.runId);
		if (entry === undefined || entry.decided) return;
		entry.decided = true;
		// Only the current run's verdict reaches the HUD: one for a run this client already left (a forfeiting restart,
		// Leave run, a party run left for the menu or a new run) is only logged.
		const current = this.ctx !== undefined && entry.run === this.ctx.counter;
		const coop = this.ctx?.coop;
		if (coop !== undefined && coop.runId === v.runId) {
			if (!coop.isOver()) {
				// The server ended the party run before the wipe (desync, replay_error, expiry): it is over here too,
				// so the run-over panel and its exits show (with the verdict's reason).
				coop.end(v.code ?? "ended");
				entry.ending = "ended";
				this.hudTimer = HUD_SNAPSHOT_INTERVAL_SEC;
				clientStore.setSnapshot(this.coopSnapshot(coop));
				warn(
					`[Sim] co-op run ${entry.run} (${v.runId}) ended by the server: ${v.code ?? ""} ${v.reason ?? ""}`,
				);
			}
			coop.stop(); // nothing more to report
			if (this.exitAfterVerdict) {
				this.exitAfterVerdict = false;
				this.stopRun("exited");
			}
		}
		// A run this client already left (a restart, or joining a party run) concluded as abandoned: nothing to show.
		if (v.code === "abandoned" && !current) {
			print(`[Sim] run ${entry.run} (${v.runId}) closed: ${v.reason ?? "abandoned"}`);
			return;
		}
		const view: VerdictView = {
			status: v.ok ? "accepted" : "rejected",
			run: entry.run,
			ending: entry.ending,
			code: v.code,
			reason: v.reason,
			serverHash: v.serverHash,
			leaderboard: v.leaderboard,
		};
		if (current) clientStore.setVerdict(view);
		const where = v.failedSegment !== undefined ? ` (segment ${v.failedSegment})` : "";
		const line = `[Sim] ranked verdict for run ${entry.run}${current ? "" : " (left)"}: ${
			v.ok ? "ACCEPTED" : `REJECTED ${v.code ?? ""}`
		}${where} ${v.reason ?? ""} score ${v.score.score} floor ${v.score.floor} ${v.leaderboard ?? ""}`;
		if (v.ok) print(line);
		else warn(line);
	}

	private onVerdict(v: RunVerdict): void {
		const pending = this.awaiting.get(v.claimedHash);
		if (pending === undefined) return;
		this.awaiting.delete(v.claimedHash);
		const view: VerdictView = {
			status: v.ok ? "accepted" : "rejected",
			run: pending.run,
			ending: pending.ending,
			code: v.code,
			reason: v.reason,
			claimedHash: v.claimedHash,
			serverHash: v.serverHash,
		};
		clientStore.setVerdict(view);
		const line = `[Sim] verdict for run ${pending.run}: ${v.ok ? "ACCEPTED" : `REJECTED ${v.code ?? ""}`} ${
			v.reason ?? ""
		}`;
		if (v.ok) print(line);
		else warn(line);
	}
}
