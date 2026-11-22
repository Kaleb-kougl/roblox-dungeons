import { Controller, OnStart } from "@flamework/core";
import { GuiService, Players, RunService, Workspace } from "@rbxts/services";
import { logInfo, logWarn } from "client/log";
import { Events } from "client/network";
import { clientStore, selectSelectedCharacter, type VerdictView } from "client/store";
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId, type UpgradeLevels } from "shared/characters";
import { cosmeticLookOf, equippedMapOf, readCosmeticLook, type CosmeticLook } from "shared/cosmetics";
import type { PartyRunStart, RunFinishVerdict } from "shared/network";
import { ArrivalLog, CoopMenuInputGate, LockstepClient, type InputSampler } from "shared/lockstep";
import {
	ALL_DEBUG_BUTTONS,
	DEFAULT_RUN_SEED,
	DraftRevealGate,
	HUD_SNAPSHOT_INTERVAL_SEC,
	LiveRun,
	RANKED_WORLD_KIND,
	RUN_ATTRIBUTES,
	RUN_START_BUSY_RETRIES,
	RUN_START_BUSY_RETRY_SECONDS,
	RUN_START_TIMEOUT_SECONDS,
	shouldRequestServerRun,
	type FrameEvents,
	type RunView,
} from "shared/play";
import {
	DEV_WORLD_KIND,
	TUTORIAL_WORLD_KIND,
	buildWorldSetup,
	clampDevFloor,
	errorMessage,
	isEndlessWorld,
	isValidRunSeed,
	type DevRunOptions,
	type RunWorld,
	type RunWorldKind,
	type StartRunReply,
	type StartRunRequest,
} from "shared/run";
import {
	DEV_GOD_BUTTON,
	EMPTY_INPUT,
	copyInput,
	isDraftOpen,
	partySize,
	playerAt,
	stressTargetFrom,
	type InputFrame,
	type PlayerState,
	type SimState,
	type SpacingConfig,
} from "shared/sim";
import { TUTORIAL } from "shared/config";
import {} from "shared/daily";
import {} from "shared/records";
import {} from "shared/theme";
import {
	LatencyProbe,
	RENDER_ORDER,
	SpectateTracker,
	floorChangeStaged,
	playerCharacterOf,
	spectateCommand,
	type SpectateView,
	type StageKind,
} from "shared/view";
import { codexToastChip } from "shared/view/codex";
import { HitstopClock, simPacerFor } from "shared/view/fx";
import { GoldenRumourClock } from "shared/view/golden";
import { DrawnLocalPlayer, PREDICTION_VIEW, type DrawnPlayerOf, type PredictionSmoothing } from "shared/view/predict";
import { PROGRESSION_VIEW, toastFor, type PendingRunClaim } from "shared/view/hud";
import {
	LEFT_RUN_END_REASON,
	afterForfeitStep,
	afterRobloxMenuClosed,
	lobbyStartAccepted,
	partyExitStep,
	restartForfeits,
} from "shared/view/menu";
import { ownedCharacterOr } from "shared/view/silver";
import type { WalletStatus } from "shared/wallet";
import { ENDLESS_FIRST_FLOOR, type FloorSecret } from "shared/dungeon";
import { InputController } from "./InputController";
import { ThemeController } from "./ThemeController";
import {
	floorModifierOf,
	floorSecretOf,
	type DraftRevealDriver,
	type RunContext,
	type RunExitListener,
	type RunListener,
	type StageDriver,
	type StageWork,
	type ToastChipSource,
	FROZEN_PACER,
	RunSubmissions,
	MS_FORMAT,
	MS_PER_SECOND,
	buildCoopClient,
	callListeners,
	coopSnapshot,
	makeSoloRun,
	readSeed,
	readWorld,
	runInfo,
	soloSnapshot,
	type MadeRun,
	logArrivals,
	memberName,
	publishLatencyProbe,
} from "./sim";

export { floorModifierOf, floorSecretOf } from "./sim";
export type {
	DraftRevealDriver,
	RunContext,
	RunExitListener,
	RunListener,
	StageDriver,
	StageWork,
	ToastChipSource,
} from "./sim";

const RENDER_STEP = "KV_Sim";

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
 * forfeited (LiveRun.requestForfeit: it ends as a death and is submitted like one) and then shows its run-over panel
 * with the run's stats ("You left the run"; the game slice's `leftRun`), a party run is left with `lockstepLeave` and
 * ended on this client (LockstepClient.end: the party plays on, nothing more is stepped here) and shows its run-over
 * panel with the run up to the leave; `exitRun()` leaves a finished run (run-over "Main menu" / "Back to lobby"; at
 * once after a leave, else a party run waits for its verdict). A run that stops has no context and the HUD inactive,
 * and the exit listener (MenuController) opens the menu. R / Restart mid-run
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
 * is on), a run start asks the server (`startRun`) and plays the seed it answers with, on RANKED_WORLD_KIND or the
 * world startSolo asked for (the Daily, docs/DAILY.md: the server's seed of the day, built with the same
 * buildWorldSetup("daily", ...) and cut, uploaded and finished exactly like an endless run). The LiveRun cuts
 * segments (floor change via its hook, else every SEGMENT_FALLBACK_TICKS) and this uploads them as they are cut
 * (`submitSegment`); the run's end cuts the last one and sends `finishRun`, answered by `runFinished`. No answer
 * within RUN_START_TIMEOUT_SECONDS (or a refusal): an unranked run on the local seed, submitted the old way.
 * Each segment the server verified releases its recorded frames (LiveRun.releaseVerifiedFrames), except with
 * KV_Debug (F8's replay check replays the whole recording).
 *
 * Stage loader (docs/STAGE_LOADER.md SL3, StageController via `setStageDriver`): run starts and floor changes no longer
 * call their listeners inline. A solo start (Play solo, R, the tutorial) clears the context and hands the driver a
 * `forge` (makeRun and the context: frame 1 the cover goes up, later frames build the run, then run the listeners, then
 * pre-generate floor 2) and holds the run (`isHeldByLoader`: no tick, no pause, R ignored) until the reveal; a ranked
 * start shows the cover from the request on (`awaitServer`). A co-op start builds its LockstepClient at once (merged
 * frames for the run must never be dropped) and only defers the listeners; the lockstep is never held. A floor change
 * switches the context at once (renderers read the state) and defers its listeners under the card, except the
 * tutorial's ending change (shared/view floorChangeStaged). While the cover owns the input, the solo sim and the
 * co-op wire get neutral input (`coverGate` / the co-op menu gate), so a draft is never confirmed blind. After that
 * gate, both input paths hold the draft's confirm while the local boon draft reveal plays (`draftGate`, a shared/play
 * DraftRevealGate; DraftRevealController registers through `setDraftRevealDriver`, docs/DRAFT_REVEAL.md DR6): a press
 * then skips the reveal and stays masked until released. KV_Debug
 * (SL0): every listener call is timed (`[Stage] listeners (...): World 38.0 ms, ...`, labelled by its script) and the
 * sim step of a frame that changed the floor (`[Stage] floor step T ms`).
 */
@Controller({})
export class SimController implements OnStart {
	private ctx: RunContext | undefined;
	private readonly listeners = new Array<RunListener>();
	private readonly floorListeners = new Array<RunListener>();
	private readonly input = { ...EMPTY_INPUT };
	private counter = 0;
	private debug = false;
	/** Run submission and verdict bookkeeping (sim/submissions.ts): `submitted`, the ranked runs, the uploads. */
	private readonly submissions = new RunSubmissions(this);
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
	/**
	 * Leave run was asked: the forfeit tick is pending; once its death was submitted the run stays on its run-over
	 * panel (the run's stats), from which Again / Main menu go on.
	 */
	private leaveAfterForfeit = false;
	/** R / Restart forfeited a ranked run: the next run starts once its death was submitted. */
	private restartAfterForfeit = false;
	/**
	 * Leave run ended the party run on this client (lockstepLeave sent, LockstepClient.end): its run-over panel shows,
	 * and Back to lobby goes at once (no wait for the party's verdict).
	 */
	private leftPartyRun = false;
	/** The lobby the next solo run belongs to (startSolo); "" for the main menu's Play solo and for restarts. */
	private nextRunLobbyId = "";
	/**
	 * The world a ranked start asks the server for (`startRun`): RANKED_WORLD_KIND (Play solo), or the Daily
	 * (shared/daily DAILY_WORLD_KIND: playDaily, a daily lobby's solo start). Set by startSolo; a restart (R, Again)
	 * keeps it, so retrying a Daily is another Daily run.
	 */
	private rankedWorld: RunWorldKind = RANKED_WORLD_KIND;
	/**
	 * docs/ARCHER.md AR5: the character solo runs are built with (ranked starts ask for it, `startRun.characterId`).
	 * Set by startSolo / startDev from the request or client/store selectSelectedCharacter; a restart (R, Again, a dev
	 * run's R) keeps it, so the retry plays the run's own character (owner answer 8). A ranked start takes the
	 * server's echo (StartRunReply.characterId).
	 */
	private runCharacter: CharacterId = selectSelectedCharacter(clientStore.getState());
	/** docs/SILVER.md SV18: told when a run start was refused as `locked_character` (onLockedCharacter). */
	private readonly lockedListeners: Array<(refused: CharacterId) => void> = [];
	/**
	 * docs/SILVER.md SV6: the owner's upgrade levels the ranked session was built with (StartRunReply.upgrades), set
	 * from the reply and used only for that ranked run's build (makeRun with a runId), so the client builds the
	 * server's config. Undefined: no upgrades (an unranked run, or a world without them).
	 */
	private rankedUpgrades: UpgradeLevels | undefined;
	/** docs/COSMETICS.md CS4 / CS5: the owner's look the ranked session stored (StartRunReply.look), for that run only. */
	private rankedLook: CosmeticLook | undefined;
	private readonly exitListeners = new Array<RunExitListener>();

	/** Co-op: neutral input while a menu owns the controls (a party run never pauses under one). */
	private readonly coopMenuGate = new CoopMenuInputGate();
	/**
	 * Co-op spectating: the raw sampled input of this frame and the last (copied before the menu gate rewrites the
	 * sampled frame in place), for the switch command's rising edges (spectateCommand).
	 */
	private readonly spectateRaw = { ...EMPTY_INPUT };
	private readonly spectatePrevRaw = { ...EMPTY_INPUT };
	/** The co-op run's spectate view after the last frame (undefined before its first frame and outside co-op). */
	private spectateView: SpectateView | undefined;
	/** The Roblox menu is open (GuiService.MenuOpened / MenuClosed). */
	private robloxMenuOpen = false;
	/** The finished tutorial run is frozen on screen (no ticks) until the next run starts. */
	private frozen = false;
	/** The stage loader (StageController), once registered. */
	private stage: StageDriver | undefined;
	/** Solo: neutral input while the stage cover owns the input; buttons held through its end stay masked. */
	private readonly coverGate = new CoopMenuInputGate();
	/** The boon draft reveal (setDraftRevealDriver), if registered. */
	private draftReveal: DraftRevealDriver | undefined;
	/** The Codex's toast chips (setToastChipSource), if registered. */
	private toastChipSource: ToastChipSource | undefined;
	/**
	 * Solo and co-op: the draft's confirm held back while the local reveal plays, after the cover / menu gate
	 * (docs/DRAFT_REVEAL.md DR6, DRD2); a press then skips the reveal and stays masked until released.
	 */
	private readonly draftGate = new DraftRevealGate();
	/** A tutorial run start is waiting for its forge under the stage cover (inRunningTutorial). */
	private startingTutorial = false;
	/** Developer mode (docs/DEV_MODE.md): the last dev run's choices and seed (R restarts with them). */
	private devRun: DevRunOptions | undefined;
	private devSeed = DEFAULT_RUN_SEED;
	/** Developer mode: DEV_GOD_BUTTON goes out with the next frame that steps a tick (toggleGodMode). */
	private pendingGodToggle = false;

	/** The freeze frame / slow motion clock (presentation pacing only; cleared at every run start). */
	readonly hitstop = new HitstopClock();
	/** The Goldling rumour clock (getGoldenRumour) and the run context it was last stepped for. */
	private readonly rumour = new GoldenRumourClock();
	private rumourCtx: RunContext | undefined;
	/** getFloorSecret's cache: the context it was read for and its plan. */
	private secretCtx: RunContext | undefined;
	private secretPlan: FloorSecret | undefined;

	/**
	 * Local prediction on screen (docs/LOCAL_PREDICTION.md LP5; shared/view/predict DrawnLocalPlayer): the co-op client's
	 * predicted head smoothed into the drawn local player (its `update`, once per co-op frame after the pump). Nothing is
	 * drawn predicted in a solo run, with KV_PredictOff, spectating, dead, in a draft or under the stage cover: then every
	 * view gets the merged player exactly as before.
	 */
	private readonly drawnLocal = new DrawnLocalPlayer(PREDICTION_VIEW);

	/**
	 * getDrawnPlayer as a function value, for the shared/view helpers that place things on a player
	 * (shared/view/predict DrawnPlayerOf). One closure for the controller's life.
	 */
	readonly drawnPlayerOf: DrawnPlayerOf = (state, index) => this.getDrawnPlayer(state, index);

	constructor(private readonly inputController: InputController, private readonly theme: ThemeController) {}

	onStart(): void {
		this.inputController.onDriverAction((action) => {
			// R / pad restart: handleReset (nothing in a tutorial run: its pause overlay has Restart tutorial). R only acts
			// once the run is over or in a dev run, the pad's once it is over or paused (driverKeyAction).
			if (action === "reset") this.pendingReset = true;
			else this.pendingReplayCheck = true;
		});
		this.inputController.setRestartWindow(() => {
			const ctx = this.ctx;
			const devRun = ctx?.dev === true;
			if (ctx?.coop !== undefined) return { over: ctx.coop.isOver(), paused: false, devRun };
			const run = ctx?.live;
			if (run === undefined) return { over: true, paused: false, devRun };
			return { over: run.outcome() !== "playing", paused: run.isPaused(), devRun };
		});
		Events.partyRunStarted.connect((start) => this.startCoop(start));
		Events.lockstepFrames.connect((runId, firstTick, data, hashAck, echo) => {
			const coop = this.ctx?.coop;
			if (coop === undefined || coop.runId !== runId) return;
			// A run ended here (left, or ended by the server) steps nothing more: its frames are not kept.
			if (coop.endReason() !== undefined) return;
			// The local clock stamps the arrival for the playout clock (docs/FRAME_PACING.md Design 6) and times this
			// client's input echo for the measured lead (Revision 2, Design 9; a malformed echo is ignored).
			const now = os.clock();
			const before = coop.receivedTicks();
			if (!coop.receive(firstTick, data, now, echo))
				logWarn(`[Sim] co-op run ${runId}: ${coop.brokenReason() ?? ""}`);
			this.ctx?.arrivalLog?.arrived(now, coop.receivedTicks() - before);
			coop.acknowledge(hashAck);
		});
		Events.runVerdict.connect((verdict) => this.submissions.onVerdict(verdict));
		Events.runStarted.connect((reply) => {
			if (this.awaitingStart !== undefined && reply.requestId === this.awaitingStart.requestId) {
				this.startReply = reply;
			}
		});
		Events.segmentVerdict.connect((v) => {
			if (!v.ok) logWarn(`[Sim] segment ${v.index} of run ${v.runId} refused: ${v.code ?? ""} ${v.reason ?? ""}`);
			else this.submissions.onSegmentVerified(v);
		});
		Events.runFinished.connect((verdict) => this.onRunFinished(verdict));
		// The Roblox menu (Escape / Start: a game cannot take those keys) pauses a solo run; the pause overlay hides
		// under it and shows once it closes, the run still paused (shared/view/menu afterRobloxMenuClosed).
		GuiService.MenuOpened.Connect(() => {
			this.robloxMenuOpen = true;
			clientStore.setRobloxMenuOpen(true);
			const run = this.ctx?.live; // a co-op run never pauses (the server's clock paces it): neutral input instead
			if (run !== undefined && !run.isPaused()) {
				run.setPaused(true);
				this.pausedByMenu = true;
			}
		});
		GuiService.MenuClosed.Connect(() => {
			this.robloxMenuOpen = false;
			clientStore.setRobloxMenuOpen(false);
			const run = this.ctx?.live;
			const playing = run !== undefined && run.outcome() === "playing";
			if (afterRobloxMenuClosed(this.pausedByMenu, playing, this.frozen) === "resume") this.unpause(run);
			this.pausedByMenu = false;
		});

		// No run yet: MenuController starts one (Play solo, a lobby, or at once with KV_SkipMenu), or the
		// TutorialController's first-run gate starts the tutorial (a first join).
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Input.Value + RENDER_ORDER.simAfterInput, (dt) => {
			this.frame(dt);
			this.stepRumour(dt);
		});
	}

	/**
	 * The Goldling rumour clock (docs/GOLDLING_RUMOURS.md GR5 / GR6), stepped once per rendered frame right after the
	 * frame's ticks (so the audio frame, the HUD snapshot and the first-time card read THIS frame's edges): reset on
	 * every new run context, held under the stage cover, a solo pause or the frozen tutorial and once the run is over.
	 * Read only: it never writes the state.
	 */
	getGoldenRumour(): GoldenRumourClock {
		return this.rumour;
	}

	/**
	 * The current floor's secret room plan (docs/SECRET_ROOMS.md SR7: the layout's FloorSecret, its carved dungeon the
	 * sim's movers run on), or undefined (no run, not an endless floor, no secret rolled). Cached per run context, so
	 * per-frame readers never ask the run's floor builder again.
	 */
	getFloorSecret(): FloorSecret | undefined {
		const ctx = this.ctx;
		if (ctx !== this.secretCtx) {
			this.secretCtx = ctx;
			this.secretPlan = ctx !== undefined ? floorSecretOf(ctx) : undefined;
		}
		return this.secretPlan;
	}

	private stepRumour(dt: number): void {
		const ctx = this.ctx;
		if (ctx !== this.rumourCtx) {
			this.rumourCtx = ctx;
			this.rumour.reset();
		}
		if (ctx === undefined) return;
		const hold =
			this.frozen ||
			this.isInputCovered() ||
			this.isHeldByLoader() ||
			this.isRunOver() ||
			ctx.live?.isPaused() === true;
		const chip = this.rumour.chip();
		this.rumour.step(ctx.run.state, dt, hold, this.getViewPlayerIndex());
		// The chip shows (or changes) with its cue: the next frame's snapshot goes out at once, not at the ~10 Hz tick.
		if (this.rumour.chip() !== chip) this.hudTimer = HUD_SNAPSHOT_INTERVAL_SEC;
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

	/** docs/ARCHER.md AR9: the characters the run was built with (RunSetup.characters), or undefined (M1, no run). */
	getRunCharacters(): ReadonlyArray<CharacterId> | undefined {
		return this.ctx?.characters;
	}

	/**
	 * docs/ARCHER.md AR9 / AR10: player `index`'s character (shared/view playerCharacterOf: the run's pick, else the
	 * character their weapons are), undefined for no run or a player who is no character (M1's two weapons).
	 */
	getPlayerCharacter(index: number): CharacterId | undefined {
		const ctx = this.ctx;
		return ctx !== undefined ? playerCharacterOf(ctx.characters, ctx.run.state, index) : undefined;
	}

	/**
	 * The player index the views follow (camera, weapon visuals, bullet transparency, ring colour, the audio split,
	 * the HUD's vitals): the watched teammate while this client spectates (docs/SPECTATE.md), else the local index.
	 */
	getViewPlayerIndex(): number {
		const ctx = this.ctx;
		if (ctx?.spectate === undefined) return this.getLocalPlayerIndex();
		return this.spectateView?.viewIndex ?? ctx.localIndex;
	}

	/**
	 * Player `index` of `state` as the views draw it (docs/LOCAL_PREDICTION.md Design 1 / 6): while this client's own
	 * player is predicted (co-op, viewing yourself, alive, no draft, no cover, not KV_PredictOff) the local player is
	 * the predicted, smoothed body (shared/view/predict writeDrawnPlayer: position, facing, roll, the flask's slowdown;
	 * everything else merged); otherwise, and for every other player, exactly `playerAt(state, index)`. For views that
	 * draw on or at the player (the census's "drawn" rows); what shows the sim's decisions keeps `playerAt`. Read only.
	 */
	getDrawnPlayer(state: Readonly<SimState>, index: number): Readonly<PlayerState> {
		return this.drawnLocal.playerOf(state, index);
	}

	/**
	 * How many ticks past the merged state the drawn local player is this frame (docs/LOCAL_PREDICTION.md LP10: the
	 * enemy bullets are drawn as far ahead): the predictor's horizon (shared/lockstep LocalPredictor.horizonTicks, at
	 * most PREDICTION.maxTicks) while getDrawnPlayer draws the local player predicted, else 0 (solo, KV_PredictOff,
	 * spectating, dead, a draft, the stage cover, no run).
	 */
	getPredictionAheadTicks(): number {
		return this.drawnLocal.aheadTicks();
	}

	/** The smoother's snaps and corrections so far this session (the KV_Debug co-op line, LP6). */
	getPredictionSmoothing(): PredictionSmoothing {
		return this.drawnLocal.smoothing();
	}

	/** Co-op spectating: the spectate view after the last frame; undefined outside a co-op run or before its first frame. */
	getSpectateView(): SpectateView | undefined {
		return this.ctx?.spectate !== undefined ? this.spectateView : undefined;
	}

	/** The buttons of the input sampled for the last frame (the tutorial director's FIRE edge). */
	getFrameButtons(): number {
		return this.input.buttons;
	}

	/**
	 * The local player's input for the last frame, as the sim got it (neutral under a menu, a cover or death; world
	 * axes): KV_CollisionDebug's stall flash (docs/WALL_SLIDE.md WS6). Read-only: never write it.
	 */
	getFrameInput(): Readonly<InputFrame> {
		return this.input;
	}

	/**
	 * docs/SWORD_SPACING.md SP6: the run's sword spacing brake, the RUN config's SimConfig.spacing (what step() reads;
	 * an endless floor's world config, `getContext().config`, does not carry it); undefined without one (SwordSpacing.WEB,
	 * the greybox) or a run. KV_CollisionDebug's keep circles. Read-only.
	 */
	getRunSpacing(): Readonly<SpacingConfig> | undefined {
		const ctx = this.ctx;
		if (ctx === undefined) return undefined;
		return (ctx.live?.setup.config ?? ctx.coop?.config)?.spacing;
	}

	/**
	 * KV_Debug was on when the current (or last) run started (read at every run start; claude/codex-plan.md R9: such a
	 * run claims no Codex entries, like it counts no records). False before the first run.
	 */
	isDebugRun(): boolean {
		return this.debug;
	}

	/** The current run is a tutorial run. */
	isTutorialRun(): boolean {
		return this.ctx?.tutorial === true;
	}

	/** The finished tutorial run is frozen (freezeTutorialRun). */
	isFrozen(): boolean {
		return this.frozen;
	}

	/** A solo run start is under the stage loader's cover: the run is held (no tick), as if paused without the menu. */
	isHeldByLoader(): boolean {
		return this.stage?.holdsSim() === true;
	}

	/** The stage loader's cover is up (its blocksInput): no run input, no touch frame. */
	isInputCovered(): boolean {
		return this.stage?.blocksInput() === true;
	}

	/**
	 * The run is over (the run-over panel shows): the solo run's outcome is no longer "playing", or the co-op client is
	 * over. False with no run. The combo's display and its sounds read this one predicate (docs/COMBO.md: run over, no
	 * break or lapse; shared/view/fx comboQuiet), so the two can never disagree.
	 */
	isRunOver(): boolean {
		const ctx = this.ctx;
		if (ctx === undefined) return false;
		return ctx.live !== undefined ? ctx.live.outcome() !== "playing" : ctx.coop?.isOver() === true;
	}

	/**
	 * Earlier ranked runs of this session whose records may not be in the client's records yet (docs/NEW_BEST.md
	 * "pending runs"): finished, final claim sent, verdict pending (the client's own score and floor), or accepted with
	 * a records result (the server's numbers). Never debug runs (KV_Debug: they never count), rejected runs or accepted
	 * runs that did not count. NewBestController folds them into a new run's baseline (shared/view/hud withPendingRuns).
	 */
	pendingRunClaims(): ReadonlyArray<PendingRunClaim> {
		return this.submissions.pendingRunClaims();
	}

	/** The stage loader registers itself (StageController.onStart). */
	setStageDriver(driver: StageDriver): void {
		this.stage = driver;
	}

	/** The boon draft reveal registers itself (DraftRevealController.onStart). */
	setDraftRevealDriver(driver: DraftRevealDriver): void {
		this.draftReveal = driver;
	}

	/** The Codex registers its toast chips (CodexController.onStart; claude/codex-plan.md CX6). */
	setToastChipSource(source: ToastChipSource): void {
		this.toastChipSource = source;
	}

	/**
	 * The draft reveal's confirm gate on this frame's input (in place), applied after the cover / menu gate: while the
	 * driver holds the confirm (the reveal not settled, or not begun yet for the open draft; never while paused)
	 * DRAFT_CONFIRM_BUTTON is masked and a press edge skips the reveal.
	 */
	private gateDraftConfirm(input: InputFrame, paused: boolean): void {
		const driver = this.draftReveal;
		const revealing = !paused && driver !== undefined && driver.blocksConfirm();
		if (this.draftGate.apply(input, revealing)) driver?.skip();
		this.draftGate.consumeSkip();
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
		if (this.ctx?.live !== undefined) this.submissions.submit("abandoned");
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
		this.submissions.submitted = true;
		this.hitstop.clear(); // a boss-kill freeze / slow motion would otherwise hold the particles still
		clientStore.setVerdict({ status: "skipped", run: ctx.counter, ending: "abandoned", code: "tutorial" });
		logInfo(`[Sim] tutorial run ${ctx.counter} finished at tick ${ctx.run.state.tick}`);
	}

	/**
	 * A tutorial run is being played (not yet finished), or is being built under the stage loader's cover: lobby run
	 * starts must not take it over.
	 */
	inRunningTutorial(): boolean {
		return (this.ctx?.tutorial === true && !this.frozen) || this.startingTutorial;
	}

	// --- developer mode (DevModeController, docs/DEV_MODE.md) ------------------------------------

	/**
	 * Starts a developer mode run now (world `dev`, local): `options.startFloor` (clamped to the panel's range) of the
	 * endless run on `seed`, god mode per `options.invulnerable`. The current solo run is left as by Play solo
	 * (submitted as abandoned when it qualifies). Ignored while a party run is on. The caller (DevModeController) is
	 * only reachable for players the server allowed (shared/config DEV_MODE). `character` (docs/ARCHER.md AR5): default
	 * the selected one; `options.bothWeapons` arms both weapons with its roll. R keeps both.
	 */
	startDev(options: DevRunOptions, seed: number, character?: CharacterId): void {
		if (this.ctx?.coop !== undefined && !this.ctx.coop.isOver()) return;
		if (!isValidRunSeed(seed)) return;
		this.clearExits();
		if (this.ctx?.live !== undefined) this.submissions.submit("abandoned");
		this.nextRunLobbyId = "";
		this.runCharacter = this.pickCharacter(character);
		this.devRun = {
			startFloor: clampDevFloor(options.startFloor),
			invulnerable: options.invulnerable,
			vault: options.vault,
			modifier: options.modifier,
			secret: options.secret,
			silver: options.silver,
			bothWeapons: options.bothWeapons,
			upgrades: options.upgrades,
		};
		this.devSeed = seed;
		this.beginDev();
	}

	/** The current run is a developer mode run. */
	isDevRun(): boolean {
		return this.ctx?.dev === true;
	}

	/** Developer mode: god mode as the sim has it now (state.dev), or undefined outside a dev run. */
	getGodMode(): boolean | undefined {
		const d = this.ctx?.dev === true ? this.ctx.run.state.dev : undefined;
		return d !== undefined ? d.invulnerable !== 0 : undefined;
	}

	/** Developer mode: a toggle is waiting for the next stepped tick (the panel shows it as pending). */
	isGodTogglePending(): boolean {
		return this.pendingGodToggle && this.ctx?.dev === true;
	}

	/**
	 * Developer mode: flips god mode in the running dev run (DEV_GOD_BUTTON on the next frame that steps a tick, so it
	 * is recorded and replays). A second call before that cancels the first. Nothing outside a dev run.
	 */
	toggleGodMode(): void {
		if (this.ctx?.dev !== true) return;
		this.pendingGodToggle = !this.pendingGodToggle;
	}

	/** Builds the dev run of `devRun` / `devSeed` (startDev, and R / Again in a dev run). */
	private beginDev(): void {
		this.frozen = false;
		this.startingTutorial = false;
		this.pendingGodToggle = false;
		this.debug = Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		this.inputController.setDebug(this.debug);
		this.awaitingStart = undefined; // a ranked start still waiting is dropped (the server replaces that session)
		this.startReply = undefined;
		this.startRun(this.devSeed, false, 0, DEV_WORLD_KIND, undefined, "", false);
	}

	// --- menu actions (pause overlay, settings panel) -------------------------------------------

	/** Resume a paused run (pause overlay "Resume"; P / Start toggle it too). */
	resume(): void {
		this.pausedByMenu = false;
		this.pausedByUi = false;
		this.unpause(this.ctx?.live);
	}

	/**
	 * A paused solo run plays again: every pad button held now is blocked until released first
	 * (InputController.blockHeldPadInputs), because paused frames never step the sim's prevButtons, so the B / A that
	 * resumed it would read as a fresh press (skill 2 / skill 1) on the first unpaused tick.
	 */
	private unpause(run: LiveRun | undefined): void {
		if (run === undefined || !run.isPaused()) return;
		this.inputController.blockHeldPadInputs();
		run.setPaused(false);
	}

	/**
	 * Pause a solo run being played (the on-screen pause button; P / Start toggle through the sim's PAUSE bit). Not
	 * a co-op run (MenuController opens the party overlay), a finished run or the frozen tutorial.
	 */
	pause(): void {
		const run = this.ctx?.live;
		if (run === undefined || this.frozen || run.outcome() !== "playing") return;
		if (this.stage?.blocksInput() === true) return; // nothing pauses under the stage cover
		run.setPaused(true);
	}

	/** Restart on the next frame (pause overlay "Restart", run-over "Again"; same as R). */
	requestRestart(): void {
		this.pendingReset = true;
	}

	/**
	 * The run-over panel's Character (docs/ARCHER.md AR7, owner answer 8): the finished solo run again as `character`,
	 * exactly Again's restart otherwise (the run's world, a dev run's options and seed; R and Again keep the new pick).
	 * Ignored for a party run or an id that is no character.
	 */
	restartAs(character: CharacterId): void {
		if (this.ctx?.coop !== undefined || !isCharacterId(character)) return;
		// docs/SILVER.md SV18: never a character the wallet does not own (the Knight instead).
		this.runCharacter = ownedCharacterOr(this.walletStatus(), character);
		this.requestRestart();
	}

	/**
	 * Starts a solo run now (the menu's Play solo; `lobbyId` for a one-player lobby's `lobbyRunStart`): ranked unless
	 * a debug attribute says otherwise (beginRun). `worldKind`: the world the ranked start asks for (default
	 * RANKED_WORLD_KIND; the Daily: shared/daily DAILY_WORLD_KIND, whose seed the server picks for the day).
	 * `character` (docs/ARCHER.md AR5): the character to play (a lobby's pick); default the selected one (client/store
	 * selectSelectedCharacter). Ignored while a party run is on.
	 */
	startSolo(lobbyId?: string, worldKind: RunWorldKind = RANKED_WORLD_KIND, character?: CharacterId): void {
		if (this.ctx?.coop !== undefined && !this.ctx.coop.isOver()) return;
		this.clearExits();
		if (this.ctx?.live !== undefined) this.submissions.submit("abandoned"); // (only if not submitted yet, as R does)
		this.nextRunLobbyId = lobbyId ?? "";
		this.rankedWorld = worldKind;
		this.runCharacter = this.pickCharacter(character);
		this.beginRun();
	}

	/**
	 * `character` when it is a character id, else the selected one (client/store selectSelectedCharacter); either way
	 * the Knight when the wallet does not own it (docs/SILVER.md SV18: a stored pick of a locked character reads as the
	 * Knight; an unknown wallet owns the Knight only).
	 */
	private pickCharacter(character: CharacterId | undefined): CharacterId {
		const pick =
			character !== undefined && isCharacterId(character)
				? character
				: selectSelectedCharacter(clientStore.getState());
		return ownedCharacterOr(this.walletStatus(), pick);
	}

	/** The latest wallet push (client/store `wallet`; undefined until the first). */
	private walletStatus(): WalletStatus | undefined {
		return clientStore.getState().wallet.status;
	}

	/**
	 * docs/COSMETICS.md CS5: a solo run's look: a ranked run the session's (StartRunReply.look), any other the wallet's
	 * equipped slots for the run's character (no character: the Knight, CSD12; an unknown wallet: the default look).
	 */
	private soloLook(runId: string | undefined, character: CharacterId | undefined): CosmeticLook {
		if (runId !== undefined && this.rankedLook !== undefined) return this.rankedLook;
		const wallet = this.walletStatus();
		if (wallet === undefined || !wallet.loaded) return {};
		return cosmeticLookOf(equippedMapOf(wallet.equipped), character ?? DEFAULT_CHARACTER);
	}

	/**
	 * docs/SILVER.md SV18: a listener told when the server refused a run start with `locked_character` (the pick is then
	 * reset to the Knight: WalletController resets the stored DisplaySettings.character through SettingsController).
	 */
	onLockedCharacter(listener: (refused: CharacterId) => void): void {
		this.lockedListeners.push(listener);
	}

	/** The character the current or next solo run plays (docs/ARCHER.md AR5: Again / R keep it). */
	getRunCharacter(): CharacterId {
		return this.runCharacter;
	}

	/**
	 * Leave run (pause overlay / party overlay, after the confirm). Solo: the run is forfeited (the next frame steps
	 * the forfeit tick: a death, submitted like any death), then its run-over panel shows the run's stats (the player
	 * goes on with Again or Main menu, as after any death). Party: `lockstepLeave` (the server plays this
	 * player as disconnected; the others play on), the run is ended on this client and its run-over panel shows the
	 * run up to the leave (Back to lobby from there goes at once). A tutorial run (Skip tutorial) is left
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
				logInfo(`[Sim] left co-op run ${ctx.counter} (${coop.runId}): its run-over panel shows`);
				// The party plays on without this client; here the run ends where it was left, and its run-over panel
				// shows the stats so far (Back to lobby goes at once: exitRun).
				coop.end(LEFT_RUN_END_REASON);
				this.leftPartyRun = true;
				clientStore.setRunLeft(ctx.counter);
				this.hudTimer = HUD_SNAPSHOT_INTERVAL_SEC;
				clientStore.setSnapshot(coopSnapshot(coop, this.ctx, this.getSpectateView(), this.rumour.chip()));
				return;
			}
			coop.stop();
			this.stopRun("left");
			return;
		}
		if (ctx.tutorial || ctx.dev) {
			// Skip tutorial / leaving a dev run: never submitted (submit records the skipped verdict) or forfeited.
			this.submissions.submit("abandoned");
			this.stopRun("left");
			return;
		}
		const live = ctx.live;
		if (live !== undefined && live.requestForfeit()) {
			this.restartAfterForfeit = false;
			this.leaveAfterForfeit = true;
			logInfo(`[Sim] run ${ctx.counter}: leaving (forfeit; counts as a death)`);
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
			const step = partyExitStep(
				coop.isOver(),
				this.leftPartyRun,
				this.submissions.rankedRuns.get(coop.runId)?.decided === true,
			);
			if (step === "leave") {
				this.leaveRun();
				return;
			}
			if (step === "exit") {
				coop.stop();
				this.stopRun("exited");
			} else if (!this.exitAfterVerdict) {
				this.exitAfterVerdict = true;
				logInfo("[Sim] the party's verdict is still being decided; back to the lobby once it arrives");
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
			this.unpause(run);
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
		this.draftGate.reset();
		this.startingTutorial = false;
		this.debug = Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		this.inputController.setDebug(this.debug);
		const seed = readSeed();
		const world = readWorld();
		// Endless runs always start at floor 1's entrance and never run the stress emitter.
		const atBossDoor =
			!isEndlessWorld(world) && this.debug && Workspace.GetAttribute(RUN_ATTRIBUTES.spawnBoss) === true;
		const stress = !isEndlessWorld(world) ? stressTargetFrom(Workspace.GetAttribute(RUN_ATTRIBUTES.stress)) : 0;
		const ranked = shouldRequestServerRun({
			seedAttributeSet: Workspace.GetAttribute(RUN_ATTRIBUTES.seed) !== undefined,
			worldAttributeSet: Workspace.GetAttribute(RUN_ATTRIBUTES.world) !== undefined,
			stress,
		});
		if (!ranked) {
			this.startRun(seed, atBossDoor, stress, world, undefined, "", false);
			return;
		}
		// The old run stops here; views see no run until the server answers (or the timeout falls back). The stage
		// loader's cover ("Starting run...") goes up now.
		this.ctx = undefined;
		this.stage?.awaitServer();
		this.startRequests++;
		this.startReply = undefined;
		const rankedWorld = this.rankedWorld;
		const request: StartRunRequest = {
			requestId: this.startRequests,
			worldKind: rankedWorld,
			atBossDoor: atBossDoor && !isEndlessWorld(rankedWorld) ? true : undefined,
			characterId: this.runCharacter,
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
		this.leftPartyRun = false;
		this.restartAfterForfeit = false;
		this.exitAfterVerdict = false;
		this.pendingReset = false;
	}

	/** No run any more (the menu takes over): no context, no pending start, the HUD inactive; tells the listeners. */
	private stopRun(how: "left" | "exited"): void {
		this.clearExits();
		this.draftGate.reset();
		this.ctx = undefined;
		this.frozen = false;
		this.awaitingStart = undefined;
		this.startReply = undefined;
		this.pausedByMenu = false;
		this.pausedByUi = false;
		this.hitstop.clear();
		this.startingTutorial = false;
		this.stage?.cancel();
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
		this.debug = Workspace.GetAttribute(RUN_ATTRIBUTES.debug) === true;
		this.inputController.setDebug(this.debug);
		const localIndex = start.members.indexOf(Players.LocalPlayer.UserId);
		if (localIndex < 0 || !isValidRunSeed(start.seed)) return;
		// Never pulled out of a running tutorial (the server refuses lobby starts while the player is in it too; this
		// is a late or stray start). A finished tutorial (frozen on its outro) is over: a lobby run may take over.
		if (this.inRunningTutorial()) {
			logWarn(`[Sim] ignored party run ${start.runId}: in the tutorial`);
			return;
		}
		// Consent: only the party run of the lobby this client is in (its Start began it).
		const myLobby = clientStore.getState().lobby.mine?.lobbyId;
		if (!lobbyStartAccepted(start.lobbyId, myLobby)) {
			logWarn(`[Sim] ignored party run ${start.runId}: lobby ${start.lobbyId} is not this client's lobby`);
			return;
		}
		this.clearExits();
		// The owner's own `runStarted` reply follows; it must not start a solo run on top of this one.
		this.awaitingStart = undefined;
		this.startReply = undefined;
		// docs/ARCHER.md AR5: every member's character from the payload, so every client builds the server's config (a
		// malformed list throws here: the run is not joined).
		const characters = start.characters;
		const [ok, result] = pcall(() =>
			buildWorldSetup(start.worldKind, start.seed, {
				atBossDoor: false,
				partySize: start.members.size(),
				characters,
				// docs/SILVER.md SV6: every member's levels as the server built the session.
				upgrades: start.upgrades,
			}),
		);
		if (!ok) {
			logWarn(`[Sim] co-op run ${start.runId} could not start: ${errorMessage(result)}`);
			return;
		}
		const setup = result as ReturnType<typeof buildWorldSetup>;
		const spawn = setup.spawn ?? { x: 0, z: 0 };
		this.draftGate.reset();
		const { client, pacingOff, leadOff, predictOff } = buildCoopClient(start, setup, spawn, localIndex);
		// A new run: nothing to glide from (LP5's run-start snap).
		this.drawnLocal.reset();
		this.counter++;
		this.submissions.submitted = false;
		this.hudTimer = 0;
		this.hitstop.clear();
		const floor = client.state.endless?.floor ?? 0;
		const spectate = new SpectateTracker(localIndex); // a fresh session: the local player, no hold
		this.spectateView = undefined;
		copyInput(EMPTY_INPUT, this.spectatePrevRaw);
		const ctx: RunContext = {
			run: client,
			live: undefined,
			coop: client,
			localIndex,
			spectate,
			memberNames: start.members.map((id) => memberName(id)),
			seed: start.seed,
			world: start.worldKind,
			atBossDoor: false,
			runId: start.runId,
			stress: 0,
			scoring: false,
			config: setup.endlessFloor !== undefined ? setup.endlessFloor(floor).config : setup.config,
			dungeon: setup.dungeon,
			characters: setup.characters,
			character: setup.characters?.[localIndex],
			// docs/COSMETICS.md CS5: every member's look as the server stored it (read: an untrusted wire value).
			looks: start.members.map((_, i) => readCosmeticLook(start.looks?.[i])),
			counter: this.counter,
			floor,
			endlessFloor: setup.endlessFloor,
			lobbyId: start.lobbyId,
			tutorial: false,
			dev: false,
			latencyProbe: this.debug ? new LatencyProbe() : undefined,
			arrivalLog: this.debug ? new ArrivalLog() : undefined,
			pacingOff,
			leadOff,
			predictOff,
		};
		this.frozen = false;
		this.ctx = ctx;
		this.submissions.rankedRuns.set(start.runId, { run: this.counter, decided: false });
		clientStore.startRun(
			runInfo(this.theme.getPack(), ctx, "", this.debug),
			coopSnapshot(client, this.ctx, this.getSpectateView(), this.rumour.chip()),
		);
		publishLatencyProbe(ctx, client, this.drawnLocal.isActive(), this.drawnLocal.snapCount());
		logInfo(
			`[Sim] co-op run ${this.counter} started: ${start.runId} seed ${start.seed}, player ${localIndex + 1} of ` +
				`${start.members.size()}`,
		);
		// The views rebuild under the stage cover; the lockstep keeps stepping meanwhile (never held).
		this.stageOrNow("coopStart", { notify: () => this.notifyRunStarted(), floor });
	}

	/** One rendered frame of a co-op run: step the merged frames that arrived, send inputs / hashes / the final. */
	private coopFrame(ctx: RunContext, coop: LockstepClient, dt: number): void {
		const me = playerAt(coop.state, ctx.localIndex);
		// docs/LOCAL_PREDICTION.md Design 6: the aim (and the touch facing / auto-target) from the knight as drawn last
		// frame; the shot that input fires leaves from where the sim will have it.
		const drawn = this.getDrawnPlayer(coop.state, ctx.localIndex);
		const aimX = this.drawnLocal.aimX(drawn, me.x);
		const aimZ = this.drawnLocal.aimZ(drawn, me.z);
		// A menu over the run (party overlay, Options, a rebind capture, leaderboards, the Roblox menu): the pad and
		// keys drive the menu, never the character (solo pauses instead).
		const covered = this.stage?.blocksInput() === true; // the stage loader's cover (docs/STAGE_LOADER.md SL7)
		const menuOpen = this.inputController.menuOwnsInput() || this.robloxMenuOpen || covered;
		const sampled = this.inputController.sample(aimX, aimZ, this.input, {
			state: coop.state,
			playerIndex: ctx.localIndex,
			blocked: ctx.config.isBulletBlocked,
			player: drawn,
		});
		// Co-op spectating (docs/SPECTATE.md): the switch press comes from the raw buttons (the gate below rewrites the
		// sampled frame in place), never while a menu owns the controls or from a click that began on a HUD button
		// (the pause button's mouse-down comes before the overlay it opens).
		const raw = copyInput(sampled, this.spectateRaw);
		const guiClick = this.inputController.mousePressOnGui();
		const cmd = menuOpen || guiClick ? undefined : spectateCommand(this.spectatePrevRaw, raw);
		copyInput(raw, this.spectatePrevRaw);
		// Dead (spectating, or the hold on the own corpse): neutral input like under a menu, so Attack / Alt switch the
		// view instead of reaching the sim (a dead player's input never acts anyway), and the buttons held at the
		// floor change's revive stay masked until released. The debug bits (K / J / the floor skip N, present only
		// when debug keys are on: InputController masks them otherwise) still go through outside a menu, so a dead
		// player can skip the floor in a KV_Debug session.
		const dead = me.dead !== 0;
		const input = this.coopMenuGate.apply(sampled, menuOpen || dead);
		// Under the stage cover only the debug bits go through (KV_Debug: the floor skip still works while covered).
		if (covered || (dead && !menuOpen)) input.buttons = bit32.band(raw.buttons, ALL_DEBUG_BUTTONS);
		// The local draft reveal holds the confirm until it settled (a press skips it; docs/DRAFT_REVEAL.md DR6).
		this.gateDraftConfirm(input, false);
		// KV_Debug latency probe (docs/FEEL.md J9): watches the frame's input and the ticks it goes out for; the
		// input handed to the pump is the same either way.
		const probe = ctx.latencyProbe;
		// The pump's own deadline checks (mismatches: the measured lead counts echoed lates as misses on receive).
		const mismatchesBefore = coop.mismatches;
		let sample: InputSampler = () => input;
		if (probe !== undefined) {
			// With the buttons latched from a fall's skipped tick: a tap carried into a later frame keeps its press time.
			probe.frame(bit32.bor(input.buttons, coop.latchedButtons()), os.clock());
			// Only a sample that is sent is a send (a fall's skipped tick latches its buttons into the next one sent).
			sample = (sending) => {
				if (sending) probe.sent(bit32.bor(input.buttons, coop.latchedButtons()), coop.nextInputTick());
				return input;
			};
		}
		// The playout clock (docs/FRAME_PACING.md Design 6): the same local clock the arrivals are stamped with.
		const now = os.clock();
		const res = coop.pump(dt, sample, now);
		const stepMs = this.debug ? (os.clock() - now) * MS_PER_SECOND : 0;
		probe?.stepped(coop.state.tick, os.clock(), coop.mismatches > mismatchesBefore);
		logArrivals(ctx, coop, now, dt);
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
			const entry = this.submissions.rankedRuns.get(runId);
			if (entry !== undefined) {
				entry.ending = "death";
				entry.claim = this.submissions.finishedClaim(ctx, coop.state);
			}
			clientStore.setVerdict({
				status: "pending",
				run: ctx.counter,
				ending: "death",
				claimedHash: res.final.claimedHash,
			});
			Events.lockstepFinal.fire(res.final);
			logInfo(
				`[Sim] co-op run ${ctx.counter} over at tick ${res.final.finalTick}, hash ${res.final.claimedHash}`,
			);
		}
		const floor = coop.state.endless?.floor;
		const floorChanged = floor !== undefined && floor !== ctx.floor;
		if (floor !== undefined && floor !== ctx.floor) {
			if (this.debug) logInfo(`[Stage] floor step ${string.format(MS_FORMAT, stepMs)} ms (to floor ${floor})`);
			this.changeFloor(ctx, floor);
		}
		// After the step (and the floor change's reset): whose player the views follow this frame.
		const viewBefore = this.spectateView?.viewIndex;
		const activeBefore = this.spectateView?.active === true;
		const view = ctx.spectate?.update(coop.state, dt, cmd);
		this.spectateView = view;
		const spectateChanged = view !== undefined && (view.viewIndex !== viewBefore || view.active !== activeBefore);
		this.drawnLocal.update(
			coop,
			ctx.localIndex,
			this.getViewPlayerIndex() === ctx.localIndex,
			this.stage?.blocksInput() === true,
			dt,
			floorChanged || spectateChanged,
		);
		// KV_Debug latency probe (LP6): press -> drawn, once the drawn knight shows the ticks a press was sent for.
		probe?.drawn(coop.state.tick, this.getPredictionAheadTicks(), os.clock());
		// M2 progression: the local player's toasts; while any draft is open (the world frozen until every player
		// confirmed) the overlay follows the stick and the "waiting for N teammates" line every frame.
		this.pushToasts(coop);
		this.hudTimer += math.max(dt, 0);
		if (coop.runEvents.size() > 0 || isDraftOpen(coop.state) || spectateChanged) {
			this.hudTimer = HUD_SNAPSHOT_INTERVAL_SEC;
		}
		if (this.hudTimer >= HUD_SNAPSHOT_INTERVAL_SEC) {
			this.hudTimer = 0;
			clientStore.setSnapshot(coopSnapshot(coop, this.ctx, this.getSpectateView(), this.rumour.chip()));
			publishLatencyProbe(ctx, coop, this.drawnLocal.isActive(), this.drawnLocal.snapCount());
		}
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
				logInfo(`[Sim] server busy (${reply.reason ?? ""}); retrying the ranked start`);
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
				const world = reply.worldKind ?? waiting.request.worldKind;
				// The character the session validates (the server's echo; the request's when absent).
				if (reply.characterId !== undefined && isCharacterId(reply.characterId)) {
					this.runCharacter = reply.characterId;
				}
				this.rankedUpgrades = reply.upgrades;
				this.rankedLook = reply.look !== undefined ? readCosmeticLook(reply.look) : undefined;
				this.startRun(reply.seed, reply.atBossDoor === true, 0, world, reply.runId, "", false);
			} else if (reply.code === "locked_character" && waiting.request.characterId !== DEFAULT_CHARACTER) {
				// docs/SILVER.md SV18: the server says this player does not own the pick. Never the unranked fallback as
				// that character: the pick resets to the Knight and the ranked start is asked again as the Knight.
				const asked = waiting.request.characterId;
				const refused: CharacterId = isCharacterId(asked) ? asked : DEFAULT_CHARACTER;
				logWarn(`[Sim] ranked run refused (locked_character: ${reply.reason ?? ""}); starting as the Knight`);
				this.runCharacter = DEFAULT_CHARACTER;
				for (const l of this.lockedListeners) l(refused);
				this.startRequests++;
				const request: StartRunRequest = {
					...waiting.request,
					requestId: this.startRequests,
					characterId: DEFAULT_CHARACTER,
				};
				this.awaitingStart = { ...waiting, requestId: this.startRequests, sentAt: os.clock(), request };
				Events.startRun.fire(request);
				return true;
			} else {
				logWarn(`[Sim] ranked run refused (${reply.code ?? "?"}: ${reply.reason ?? ""}); playing unranked`);
				this.startRun(waiting.seed, waiting.atBossDoor, 0, waiting.world, undefined, "", false);
			}
			return false;
		}
		if (os.clock() - waiting.sentAt < RUN_START_TIMEOUT_SECONDS) return true;
		this.awaitingStart = undefined;
		logWarn(`[Sim] no answer to startRun after ${RUN_START_TIMEOUT_SECONDS} s; playing unranked`);
		this.startRun(waiting.seed, waiting.atBossDoor, 0, waiting.world, undefined, "", false);
		return false;
	}

	/**
	 * Starts a solo run (ranked answer, unranked fallback, debug world, the tutorial). With the stage loader the context
	 * is cleared now (views see no run) and the run is built under its cover on a later frame (`forgeRun`), its
	 * listeners on the frame after (`notifyRunStarted`); without one, both at once.
	 */
	private startRun(
		seed: number,
		atBossDoor: boolean,
		stress: number,
		requestedWorld: RunWorldKind,
		requestedRunId: string | undefined,
		startNotice: string,
		tutorial: boolean,
	): void {
		const floor =
			requestedWorld === DEV_WORLD_KIND
				? clampDevFloor(this.devRun?.startFloor ?? ENDLESS_FIRST_FLOOR)
				: isEndlessWorld(requestedWorld) || requestedWorld === TUTORIAL_WORLD_KIND
				? ENDLESS_FIRST_FLOOR
				: 0;
		this.draftGate.reset();
		if (this.stage !== undefined) {
			this.ctx = undefined; // the old run stops here; the new one is built under the cover
			this.startingTutorial = tutorial;
		}
		const forge = () => {
			this.startingTutorial = false;
			const [ok, err] = pcall(() =>
				this.forgeRun(seed, atBossDoor, stress, requestedWorld, requestedRunId, startNotice, tutorial),
			);
			if (ok) return;
			// No run: back to the menu (or the lobby room), as after Leave run, instead of a stranded empty screen.
			logWarn(`[Sim] the run could not start (${errorMessage(err)}); back to the menu`);
			this.stopRun("left");
		};
		this.stageOrNow("runStart", { forge, notify: () => this.notifyRunStarted(), floor });
	}

	/** startRun's build: the world (makeRun, with its fallbacks), the context, the store's run, `[Sim] run N started`. */
	private forgeRun(
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
			!isEndlessWorld(world) &&
			world !== DEV_WORLD_KIND &&
			runId === undefined &&
			Workspace.GetAttribute(RUN_ATTRIBUTES.scoring) === true;

		let made = this.makeRun(seed, atBossDoor, stress, world, runId, scoring);
		if (typeIs(made, "string") && runId !== undefined) {
			// The server built this world; the client could not. Play it unranked (the fallback below may apply).
			logWarn(`[Sim] ranked run ${runId} could not start (${made}); playing unranked`);
			runId = undefined;
			made = this.makeRun(seed, atBossDoor, stress, world, runId, scoring);
		}
		if (typeIs(made, "string") && world === "game") {
			notice = made;
			logWarn(`[Sim] enemies unavailable (${made}); playing the floor without enemies`);
			world = "dungeonNoEncounter";
			made = this.makeRun(seed, atBossDoor, stress, world, undefined, scoring);
			runId = undefined;
		}
		if (typeIs(made, "string") && tutorial) {
			// The menu takes over, as after Leave run (the normal flow: the main menu, or the lobby room in a lobby).
			logWarn(`[Sim] the tutorial could not start (${made}); back to the menu`);
			this.stopRun("left");
			return;
		}
		if (typeIs(made, "string")) {
			error(`[Sim] could not start a run: ${made}`);
		}
		const { run, config, dungeon, endlessFloor, characters } = made;
		this.counter++;
		this.submissions.submitted = false;
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
			spectate: undefined,
			memberNames: [],
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
			characters,
			character: characters?.[0],
			looks: [this.soloLook(runId, characters?.[0])],
			tutorial,
			dev: world === DEV_WORLD_KIND,
		};
		this.nextRunLobbyId = ""; // a restart (R) is a plain solo run
		this.ctx = ctx;
		if (runId !== undefined) this.submissions.rankedRuns.set(runId, { run: this.counter, decided: false });

		const info = runInfo(pack, ctx, notice, this.debug);
		clientStore.startRun(info, soloSnapshot(run, this.rumour.chip()));
		logInfo(
			`[Sim] run ${this.counter} started: seed ${seed}, world ${world}${atBossDoor ? ", boss door" : ""}` +
				(runId !== undefined ? `, ranked run ${runId}` : "") +
				(tutorial ? " (tutorial: local, not submitted)" : "") +
				(world === DEV_WORLD_KIND ? ` (dev: floor ${floor}, local, not submitted)` : ""),
		);
	}

	/** Hands a run start / floor change to the stage loader, or (none registered) runs its work at once. */
	private stageOrNow(kind: StageKind, work: StageWork): void {
		if (this.stage !== undefined) {
			this.stage.stage(kind, work);
			return;
		}
		work.forge?.();
		work.notify();
	}

	/** The run-start listeners, with the context current now (a floor change since the cut is in it). */
	private notifyRunStarted(): void {
		const ctx = this.ctx;
		if (ctx !== undefined) callListeners(this.listeners, ctx, `run ${ctx.counter} start`, this.debug);
	}

	/** The floor-change listeners, with the context current now. */
	private notifyFloorChanged(): void {
		const ctx = this.ctx;
		if (ctx !== undefined) callListeners(this.floorListeners, ctx, `floor ${ctx.floor}`, this.debug);
	}

	/**
	 * Endless mode: the run is on another floor than the context says; switch the context now (renderers read the state)
	 * and tell the views under the stage loader's card (StageWork.notify, a frame or two later).
	 */
	private changeFloor(ctx: RunContext, floor: number): void {
		const endlessFloor = ctx.endlessFloor;
		if (endlessFloor === undefined) return;
		const w = endlessFloor(floor);
		const moved: RunContext = { ...ctx, floor, config: w.config, dungeon: w.dungeon };
		moved.spectate?.reset(); // everyone dead and still here comes back at the entrance
		this.ctx = moved;
		clientStore.changeFloor(
			runInfo(this.theme.getPack(), moved, clientStore.getState().game.run.notice, this.debug),
		);
		logInfo(`[Sim] run ${moved.counter}: floor ${floor} (${w.dungeon.name}${w.bossFloor ? ", boss floor" : ""})`);
		// The views rebuild under the stage loader's card (a frame later), except the tutorial's ending change.
		const work: StageWork = { notify: () => this.notifyFloorChanged(), floor };
		if (floorChangeStaged(floor, moved.tutorial, TUTORIAL.lastFloor)) {
			this.stageOrNow("floorChange", work);
		} else {
			this.stage?.cancel(); // an earlier card's pending rebuild is this one now (it reads the newest context)
			work.notify();
		}
	}

	/** The solo build (sim/solo.ts makeSoloRun) with this controller's dev options, wallet, ranked upgrades and character. */
	private makeRun(
		seed: number,
		atBossDoor: boolean,
		stress: number,
		world: RunWorldKind,
		runId: string | undefined,
		scoring: boolean,
	): MadeRun | string {
		return makeSoloRun(
			{
				devRun: this.devRun,
				wallet: this.walletStatus(),
				rankedUpgrades: this.rankedUpgrades,
				runCharacter: this.runCharacter,
			},
			seed,
			atBossDoor,
			stress,
			world,
			runId,
			scoring,
		);
	}

	private frame(dt: number): void {
		// The stage loader first: its covered work (forge, listeners, pre-generation) and its clock.
		this.stage?.frame(dt);
		if (this.pendingReset) {
			this.pendingReset = false;
			if (!this.isHeldByLoader()) this.handleReset(); // R under a run start's cover does nothing
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
		if (this.isHeldByLoader()) {
			// A run start under the stage cover: on screen, no tick, nothing recorded (like the frozen tutorial).
			run.frame(dt, EMPTY_INPUT, FROZEN_PACER);
			return;
		}
		if (this.pendingReplayCheck) {
			this.pendingReplayCheck = false;
			this.replayCheck(run);
		}

		const p = run.state.player;
		// Under the stage cover (a floor change's card) the sim gets neutral input: no blind draft confirm, no pause.
		// The debug bits (K / J / the floor skip, present only with KV_Debug) still go through, so a floor skip works.
		const sampled = this.inputController.sample(p.x, p.z, this.input, {
			state: run.state,
			playerIndex: 0,
			blocked: ctx.config.isBulletBlocked,
		});
		const covered = this.stage?.blocksInput() === true;
		const debugButtons = bit32.band(sampled.buttons, ALL_DEBUG_BUTTONS);
		const input = this.coverGate.apply(sampled, covered);
		if (covered) input.buttons = debugButtons;
		// The draft reveal holds the confirm until it settled (a press skips it; docs/DRAFT_REVEAL.md DR6). A solo
		// pause freezes the reveal, so nothing is held (or skipped) under the pause overlay.
		this.gateDraftConfirm(input, run.isPaused());
		// Developer mode's god-mode toggle: one press edge, held until a frame steps a tick (paused under the panel).
		const godPulse = this.pendingGodToggle && ctx.dev;
		if (godPulse) input.buttons = bit32.bor(input.buttons, DEV_GOD_BUTTON);
		const stepStart = this.debug ? os.clock() : 0;
		const pausedBefore = run.isPaused();
		const ticks = run.frame(dt, input, simPacerFor(partySize(run.state), this.hitstop)); // solo: the hitstop clock paces
		// P / Start resumed it (the PAUSE edge; that frame steps nothing): held pad buttons wait for a release, as in unpause.
		if (pausedBefore && !run.isPaused()) this.inputController.blockHeldPadInputs();
		if (godPulse && ticks > 0) this.pendingGodToggle = false;
		const floor = run.state.endless?.floor;
		if (floor !== undefined && floor !== ctx.floor) {
			if (this.debug) {
				const ms = string.format(MS_FORMAT, (os.clock() - stepStart) * MS_PER_SECOND);
				logInfo(`[Stage] floor step ${ms} ms (to floor ${floor})`);
			}
			this.changeFloor(ctx, floor);
		}
		this.submissions.uploadSegments(this.ctx ?? ctx);
		// P / Start inside the settings panel: the run resumes when the panel closes, not under it.
		if (this.uiPauseOpen && !run.isPaused()) {
			run.setPaused(true);
			this.pausedByUi = true;
		}

		const outcome = run.outcome();
		if (outcome !== "playing" && !this.submissions.submitted)
			this.submissions.submit(outcome === "dead" ? "death" : "victory");
		// Leave run / a forfeiting restart: the forfeit tick ran and its death was submitted. Leave run stays on the
		// finished run, so its run-over panel shows the run's stats ("You left the run"; Again / Main menu from there);
		// the pause it was asked from is lifted so the panel reads like any death.
		const afterForfeit = afterForfeitStep(
			this.leaveAfterForfeit,
			this.restartAfterForfeit,
			outcome !== "playing",
			this.submissions.submitted,
		);
		if (afterForfeit === "runOver") {
			this.leaveAfterForfeit = false;
			clientStore.setRunLeft((this.ctx ?? ctx).counter);
			this.unpause(run);
			this.hudTimer = HUD_SNAPSHOT_INTERVAL_SEC;
		} else if (afterForfeit === "restart") {
			this.restartAfterForfeit = false;
			this.beginRun();
			return;
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
			clientStore.setSnapshot(soloSnapshot(run, this.rumour.chip()));
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
		if (ctx.dev) {
			// Developer mode: the same seed and start floor again at once (never submitted, so nothing to forfeit), god
			// mode as it is now (a toggle still pending counts).
			const god = this.getGodMode();
			if (god !== undefined && this.devRun !== undefined) {
				this.devRun = { ...this.devRun, invulnerable: god !== this.pendingGodToggle };
			}
			this.submissions.submit("abandoned");
			this.beginDev();
			return;
		}
		if (restartForfeits(ctx.runId !== undefined, live.outcome() === "playing") && live.requestForfeit()) {
			this.restartAfterForfeit = true;
			logInfo(`[Sim] run ${ctx.counter}: restarting (forfeit; counts as a death)`);
			return;
		}
		this.submissions.submit("abandoned");
		this.beginRun();
	}

	/**
	 * M2 progression toasts for the local player's events of the last frame (solo or co-op), then expiry. The Codex's
	 * frame runs first (ToastChipSource): a toast whose entry it found for the first time ever this frame wears the
	 * NEW! chip (claude/codex-plan.md CX6, R14: ToastView.codexNew).
	 */
	private pushToasts(view: RunView): void {
		const now = os.clock();
		const chips = this.toastChipSource?.toastChips(view);
		for (const e of view.runEvents) {
			this.toastSerial++;
			const spec = toastFor(e.kind, e.index, e.build);
			const codexNew = chips !== undefined && codexToastChip(chips, e.kind, e.index, e.build);
			clientStore.pushToast(
				codexNew
					? { id: this.toastSerial, ...spec, codexNew, until: now + PROGRESSION_VIEW.toastSeconds }
					: { id: this.toastSerial, ...spec, until: now + PROGRESSION_VIEW.toastSeconds },
				PROGRESSION_VIEW.maxToasts,
			);
		}
		clientStore.expireToasts(now);
	}

	private replayCheck(run: LiveRun): void {
		const r = run.replayCheck();
		clientStore.setReplayCheck(r);
		const line = `[Sim] replay check @ tick ${run.state.tick}: ${r.match ? "MATCH" : "MISMATCH"} live=${
			r.liveHash
		} replay=${r.replayHash}`;
		if (r.match) logInfo(line);
		else logWarn(line);
	}

	// --- verdicts (submission itself: sim/submissions.ts) ---------------------------------------

	private onRunFinished(v: RunFinishVerdict): void {
		const entry = this.submissions.rankedRuns.get(v.runId);
		if (entry === undefined || entry.decided) return;
		entry.decided = true;
		// Records (pendingRunClaims): an accepted run that counted keeps its board with the server's numbers until the
		// records push that follows; anything else no longer raises a baseline.
		// A Daily run's claim (docs/DAILY.md DS10) stays with the server's numbers when its entry write completed (the
		// dailyStatus push follows the verdict), else it no longer raises a baseline.
		const claim = entry.claim;
		if (claim !== undefined && claim.daily !== undefined) {
			entry.claim =
				v.ok && v.daily !== undefined && v.daily.posted
					? { board: claim.board, score: v.score.score, floor: v.score.floor, daily: v.daily.day }
					: undefined;
		} else
			entry.claim =
				v.ok && v.records !== undefined && claim !== undefined
					? { board: v.records.board, score: v.score.score, floor: v.score.floor }
					: undefined;
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
				clientStore.setSnapshot(coopSnapshot(coop, this.ctx, this.getSpectateView(), this.rumour.chip()));
				logWarn(
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
			logInfo(`[Sim] run ${entry.run} (${v.runId}) closed: ${v.reason ?? "abandoned"}`);
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
			records: v.records,
			serverScore: v.score.score,
			serverFloor: v.score.floor,
			daily: v.daily,
			silver: v.silver,
			runId: v.runId,
		};
		if (current) clientStore.setVerdict(view);
		const where = v.failedSegment !== undefined ? ` (segment ${v.failedSegment})` : "";
		const line = `[Sim] ranked verdict for run ${entry.run}${current ? "" : " (left)"}: ${
			v.ok ? "ACCEPTED" : `REJECTED ${v.code ?? ""}`
		}${where} ${v.reason ?? ""} score ${v.score.score} floor ${v.score.floor} ${v.leaderboard ?? ""}`;
		if (v.ok) logInfo(line);
		else logWarn(line);
	}
}
