import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore, selectAnyPanelOpen, selectMapView, type ClientState } from "client/store";
import {
	TUTORIAL_NO_STEP_ID,
	type OnboardingStatus,
	type TutorialEntry,
	type TutorialOutroChoice,
} from "shared/onboarding";
import { RUN_ATTRIBUTES } from "shared/play";
import {
	TutorialDirector,
	TutorialOutroBeat,
	tutorialAttribute,
	tutorialDeviceFor,
	tutorialHudFrom,
	tutorialMapPromptShown,
	tutorialMapSeen,
	type FirstRunDecision,
	type TutorialMarker,
	type TutorialStuckReport,
	type TutorialView,
} from "shared/tutorial";
import { JoinGate, RENDER_ORDER } from "shared/view";
import { PROGRESSION_VIEW, TUTORIAL_VIEW } from "shared/view/hud";
import { FirstJoinGate, firstJoinDispatchChoice, firstJoinGateReason, pauseOverlayShown } from "shared/view/menu";
import { PreloadController } from "./PreloadController";
import { SimController, type RunContext } from "./SimController";

const RENDER_STEP = "KV_Tutorial";

/** A finish report's step id: the director's current step id, TUTORIAL_NO_STEP_ID when it has none (finished). */
function finishStepId(view: Readonly<TutorialView> | undefined): string {
	const id = view?.stepId ?? "";
	return id !== "" ? id : TUTORIAL_NO_STEP_ID;
}

/** One stuck report as a fresh table (the director's report arrays are reused every frame). */
function sendStuck(report: Readonly<TutorialStuckReport>): void {
	Events.tutorialStuck.fire({ prompt: report.prompt, seconds: report.seconds });
}

/**
 * The solo pause overlay is on screen with its full map (PauseOverlay: `pauseOverlayShown` and not co-op, then
 * FullMapOverlay PauseMap: `game.map.available`). The same store fields the overlay renders from, so the tutorial's
 * map step counts exactly what the player saw (docs/TUTORIAL_MAP.md §5).
 */
function pauseMapShowing(state: ClientState): boolean {
	const s = state.game.snapshot;
	const coop = state.game.run.coop;
	const shown = pauseOverlayShown({
		active: state.game.active,
		coop,
		playing: s.outcome === "playing",
		paused: s.paused,
		coopOverlay: state.menu.coopOverlay,
		panelOpen: selectAnyPanelOpen(state),
		menuScreen: false,
		robloxMenuOpen: state.menu.robloxMenuOpen,
		tutorialEnded: state.tutorial.ended,
	});
	return shown && !coop && selectMapView(state).available;
}

/**
 * The first-run tutorial on the client (docs/TUTORIAL.md §4, docs/CLIENT.md "The tutorial run"):
 *
 * - **First-run gate.** On join it asks the server (`requestOnboarding`; the server also sends `onboardingStatus`
 *   after its join load) and waits up to TUTORIAL.statusTimeoutSeconds (shared/tutorial FirstRunGate): a loaded doc
 *   that is not done starts the tutorial at once (no main menu first); done, a failed load or no answer is the normal
 *   flow (MenuController: the main menu, or a solo run with KV_SkipMenu). Workspace `KV_Tutorial` (boolean, read once
 *   on join) forces it on or off. MenuController shows nothing until the gate decided (`onFirstRunDecided`).
 *   **Join intent (docs/INVITES.md ID6):** the gate is shared/view/menu FirstJoinGate: a choice that would start the
 *   tutorial also waits for the server's `joinIntent` (LobbyController keeps it in the `lobby` slice), at most
 *   INVITE.intentWaitSeconds from join; `lobby` / `party` (an invite or party arrival already in a lobby) get the
 *   normal flow instead (the main menu's Tutorial still plays it); `none` or no intent in time: the tutorial as before.
 *   The latched choice is re-checked when it is dispatched (firstJoinDispatchChoice): a player the server placed in
 *   a lobby meanwhile (or whose `joinIntent` was upgraded to lobby / party) gets the normal flow.
 *   **Join gate (docs/PRELOAD.md P5):** the decision is only DISPATCHED (the tutorial start, the `onFirstRunDecided`
 *   listeners) once the join loading screen released too (PreloadController.whenReleased), whichever comes last
 *   (shared/view JoinGate), so the tutorial, the main menu or KV_SkipMenu's solo run start under no cover; until
 *   then `menu.awaitingFirstRun` stays true (the backdrop alone under the loading screen).
 * - **Each tutorial run** (first join, Restart tutorial, a replay): a fresh TutorialDirector and `tutorialStarted`.
 *   Once per rendered frame, right after the FX tracker (RENDER_ORDER.tutorialAfterFx), the director reads the
 *   frame's state, events and raw buttons (not while paused); its view goes to the Reflex `tutorial` slice when its
 *   revision moved, each newly reached funnel step to `tutorialStep`, callouts to the toasts, the ghost half heart
 *   to the status panel. The world marker reads `getMarker()`. The `map` step's client facts (docs/TUTORIAL_MAP.md
 *   §5): `mapAvailable` is Reflex `game.map.available`, `mapSeen` is tutorialMapSeen over the input device, the full
 *   map open, or a latch set on a paused frame where the player was on touch, the map prompt was on screen
 *   (tutorialMapPromptShown) and the solo pause overlay showed its map (pauseMapShowing); handed over on the next
 *   unpaused update and then cleared.
 * - **The end** (the floor 2 -> 3 change): the run freezes and `tutorialFinished("completed")` goes out at once
 *   (SimController.freezeTutorialRun: no floor 3 draft; the slice's `ended` hides the panel and the draft overlay),
 *   then after TUTORIAL.outroDelaySeconds the outro card. Outro: Start my first run (HudController: the main menu's
 *   Play solo) / Play the tutorial again.
 * - **Pause overlay**: Restart tutorial (a fresh run and director), Skip tutorial (after a confirm:
 *   `tutorialFinished("skipped")`, then the run is left for the menu like Leave run). The main menu's Tutorial
 *   replays it.
 * - **Telemetry (docs/TUTORIAL_FUNNEL.md TF6; docs/CLIENT.md "The tutorial run").** `tutorialStarted({ entry,
 *   device })` per tutorial run (the entry threaded through `playTutorial(entry)`, `firstJoin` for the gate's start;
 *   the store's input device at the start); every director update's `newLessonReports` / `newStuckReports` as
 *   `tutorialLesson` / `tutorialStuck` (before the finish on the finish frame); a skip, a restart (or any run replacing
 *   an unfinished tutorial run, before its `tutorialStarted`) and leaving an unfinished tutorial run flush the open
 *   stuck episode first (flushOpenAttempt); `tutorialFinished` carries the director's current step id.
 *   `onboardingReport` `gate` once per session at the dispatch (firstJoinGateReason), `outro` once per attempt when the
 *   outro card closes (choice, real seconds the card was open: the server logs these, not its own clock, which starts
 *   at the finish before the beat). `loaded` is PreloadController's (the release).
 */
@Controller({})
export class TutorialController implements OnStart {
	private gate: FirstJoinGate | undefined = new FirstJoinGate();
	/** What the first-run gate decided (undefined while it waits). */
	private decided: FirstRunDecision | undefined;
	private forced: boolean | undefined;
	private director: TutorialDirector | undefined;
	/** The run counter of the tutorial run the director belongs to. */
	private runCounter = -1;
	private lastRevision = -1;
	/** Set once the director reported the end: the beat before the outro. */
	private beat: TutorialOutroBeat | undefined;
	/** Tutorial callout toasts use negative ids (the SimController's progression toasts count up from 1). */
	private calloutSerial = 0;
	private readonly decidedListeners = new Array<(choice: FirstRunDecision) => void>();
	/** Dispatches the gate's decision once the loading screen released too (docs/PRELOAD.md P5). */
	private readonly join = new JoinGate<FirstRunDecision>();
	/** The onboarding status the gate had when it latched (the gate reason). */
	private gateStatus: OnboardingStatus | undefined;
	/** The gate report went out (once per session). */
	private gateReported = false;
	/** How the next tutorial run began (set by every start, read by onRunStarted). */
	private pendingEntry: TutorialEntry = "firstJoin";
	/** os.clock() when this attempt's outro card opened; undefined: not open (or already reported). */
	private outroOpenedAt: number | undefined;
	/** The solo pause overlay showed its map while paused; read and cleared by the next unpaused update. */
	private pauseMapLatch = false;

	constructor(private readonly sim: SimController, private readonly preload: PreloadController) {}

	onStart(): void {
		this.forced = tutorialAttribute(Workspace.GetAttribute(RUN_ATTRIBUTES.tutorial));
		Events.onboardingStatus.connect((status) => this.gate?.receive(status));
		if (this.forced === undefined) Events.requestOnboarding.fire();
		else print(`[Tutorial] ${RUN_ATTRIBUTES.tutorial} = ${tostring(this.forced)}: the server is not asked`);
		this.preload.whenReleased(() => this.dispatch(this.join.release(), true));
		this.sim.onRunStarted((ctx) => this.onRunStarted(ctx));
		this.sim.onRunExited(() => this.onRunExited());
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Input.Value + RENDER_ORDER.tutorialAfterFx, (dt) =>
			this.frame(dt),
		);
	}

	/** Where the world marker points this frame (world XZ, sim units), or undefined: no tutorial / no target / ended. */
	getMarker(): TutorialMarker | undefined {
		if (this.director === undefined || this.beat !== undefined) return undefined;
		const ctx = this.sim.getContext();
		if (ctx === undefined || !ctx.tutorial || ctx.counter !== this.runCounter) return undefined;
		return this.director.getView().marker;
	}

	/**
	 * Calls `listener` once the first-run gate decided (at once if it already did): "tutorial" (this controller starts
	 * it) or "normal" (MenuController's join flow: the main menu, or KV_SkipMenu's solo run).
	 */
	onFirstRunDecided(listener: (choice: FirstRunDecision) => void): void {
		const decided = this.decided;
		if (decided !== undefined) listener(decided);
		else this.decidedListeners.push(listener);
	}

	// --- menu actions (HudController) ------------------------------------------------------------

	/** The outro's "Start my first run": closes the card (HudController then does the main menu's Play solo). */
	closeOutro(): void {
		this.reportOutro("firstRun");
		clientStore.setTutorialOutroOpen(false);
	}

	/**
	 * Starts a tutorial run: outro "Play the tutorial again" (`again`), pause "Restart tutorial" (`restart`) and the
	 * main menu's "Tutorial" (`menu`). Any restart while the outro card is open closes it as `again`.
	 */
	playTutorial(entry: TutorialEntry): void {
		this.reportOutro("again");
		clientStore.setTutorialOutroOpen(false);
		clientStore.setTutorialSkipConfirm(false);
		this.startTutorial(entry);
	}

	/**
	 * Pause "Skip tutorial" -> "Skip": counts as done (`tutorialFinished("skipped")`), then the run is left for the
	 * menu exactly like Leave run (SimController.leaveRun -> MenuController: the lobby room while in a lobby, else the
	 * main menu).
	 */
	skipTutorial(): void {
		clientStore.setTutorialSkipConfirm(false);
		if (!this.sim.isTutorialRun() || this.beat !== undefined) return; // already finished: the outro handles it
		// The open stuck episode ends here (a long one reports), then the skip with the current step.
		const director = this.director;
		this.flushOpenAttempt();
		const stepId = finishStepId(director?.getView());
		Events.tutorialFinished.fire({ outcome: "skipped", stepId });
		print(`[Tutorial] skipped at ${stepId}`);
		this.director = undefined;
		clientStore.endTutorial();
		this.sim.leaveRun();
	}

	/** Pause "Skip tutorial" asks first ("Skip the tutorial?"); "Keep playing" closes the question. */
	setSkipConfirm(open: boolean): void {
		clientStore.setTutorialSkipConfirm(open && this.sim.isTutorialRun());
	}

	// --- per run / per frame ---------------------------------------------------------------------

	private onRunStarted(ctx: RunContext): void {
		// A run replacing a tutorial run still being played (Restart tutorial, a lobby start): its open stuck episode
		// reports first, while the server still has its attempt open (before this run's tutorialStarted closes it).
		this.flushOpenAttempt();
		// Another run took the player off the outro card (a lobby start): `menu`. Play again / Start my first run
		// reported their own choice before this.
		this.reportOutro("menu");
		this.beat = undefined;
		this.lastRevision = -1;
		this.pauseMapLatch = false;
		if (!ctx.tutorial) {
			this.director = undefined;
			this.runCounter = -1;
			clientStore.clearTutorial();
			return;
		}
		const director = new TutorialDirector();
		this.director = director;
		this.runCounter = ctx.counter;
		// Every tutorial start is a new funnel attempt (and marks the player busy for lobbies): how it began and the
		// last-used input device now (TFD9).
		const entry = this.pendingEntry;
		this.pendingEntry = "firstJoin";
		const device = tutorialDeviceFor(clientStore.getState().game.inputDevice);
		Events.tutorialStarted.fire({ entry, device });
		clientStore.beginTutorial(tutorialHudFrom(director.getView()));
		print(`[Tutorial] run ${ctx.counter}: practice descent started (${entry}, ${device})`);
	}

	/** The run was left for the menu (Skip tutorial, or any Leave run / exit): no tutorial on screen any more. */
	private onRunExited(): void {
		// Left while the tutorial was still being played (not Skip: that flushed and cleared the director already).
		this.flushOpenAttempt();
		this.reportOutro("menu");
		this.director = undefined;
		this.runCounter = -1;
		this.beat = undefined;
		this.lastRevision = -1;
		this.pauseMapLatch = false;
		clientStore.clearTutorial();
	}

	/**
	 * The join flow, once the gate decided and the loading screen released (JoinGate; undefined: not yet, or already
	 * dispatched): the tutorial starts here, the listeners (MenuController) take "normal".
	 */
	private dispatch(latched: FirstRunDecision | undefined, onRelease: boolean): void {
		if (latched === undefined) return;
		const lobby = clientStore.getState().lobby;
		const choice = firstJoinDispatchChoice(latched, {
			forced: this.forced,
			inLobby: lobby.mine !== undefined,
			intent: lobby.joinIntent,
		});
		if (choice !== latched) {
			print(`[Tutorial] first run: ${latched} -> ${choice} (placed in a lobby, join intent ${lobby.joinIntent})`);
		}
		this.decided = choice;
		if (onRelease) print(`[Tutorial] first run: ${choice} (dispatched as the loading screen released)`);
		if (!this.gateReported) {
			this.gateReported = true;
			const reason = firstJoinGateReason(choice, {
				forced: this.forced,
				inLobby: lobby.mine !== undefined,
				intent: lobby.joinIntent,
				status: this.gateStatus,
			});
			Events.onboardingReport.fire({ kind: "gate", reason });
			print(`[Tutorial] first run gate: ${reason}`);
		}
		if (choice === "tutorial") this.startTutorial("firstJoin");
		for (const listener of this.decidedListeners) listener(choice);
		this.decidedListeners.clear();
	}

	private frame(dt: number): void {
		const gate = this.gate;
		if (gate !== undefined) {
			const intent = clientStore.getState().lobby.joinIntent;
			if (intent !== undefined) gate.receiveIntent(intent);
			const choice = gate.poll(dt, this.forced);
			if (choice === "wait") return;
			this.gate = undefined;
			this.gateStatus = gate.seenStatus();
			print(
				`[Tutorial] first run: ${choice} (after ${string.format("%.1f", gate.waitedSeconds())} s, join intent ${
					gate.seenIntent() ?? "not received"
				})`,
			);
			const fire = this.join.decide(choice);
			if (fire === undefined) print(`[Tutorial] first run: ${choice} waits for the loading screen`);
			this.dispatch(fire, false);
			return;
		}
		const director = this.director;
		const ctx = this.sim.getContext();
		if (director === undefined || ctx === undefined || !ctx.tutorial || ctx.counter !== this.runCounter) return;
		const live = ctx.live;
		if (live === undefined) return;

		const beat = this.beat;
		if (beat !== undefined) {
			clientStore.expireToasts(os.clock()); // the frozen run no longer expires them
			if (beat.update(dt)) this.showOutro();
			return;
		}
		// Paused (P, the Roblox menu, a panel): nothing happens in the run, and a click on a menu button must not
		// count as the objective card's Continue. Held under the stage loader's run-start cover: not started yet.
		// The pause overlay's map is latched first: the director only hears of it on the next unpaused update.
		const store = clientStore.getState();
		const paused = live.isPaused();
		// Decided at pause time (docs/TUTORIAL_MAP.md TMD2): the device then (touch only) and the map prompt on screen.
		const device = tutorialDeviceFor(store.game.inputDevice);
		if (
			paused &&
			tutorialMapPromptShown(director.getView()) &&
			tutorialMapSeen(device, false, pauseMapShowing(store))
		)
			this.pauseMapLatch = true;
		if (paused || this.sim.isFrozen() || this.sim.isHeldByLoader()) return;

		const map = selectMapView(store);
		const mapSeen = map.open || this.pauseMapLatch;
		this.pauseMapLatch = false;
		const view = director.update({
			state: live.state,
			config: live.setup.config,
			events: live.frameEvents,
			buttons: this.sim.getFrameButtons(),
			dt,
			mapSeen,
			mapAvailable: map.available,
		});
		for (const step of view.newFunnelSteps) Events.tutorialStep.fire(step);
		// Metrics (not in `revision`: read every update). On the finish frame these go out before tutorialFinished;
		// that frame's prompt change already ended the open stuck episode.
		for (const r of view.newLessonReports)
			Events.tutorialLesson.fire({ step: r.step, seconds: r.seconds, hits: r.hits });
		for (const r of view.newStuckReports) sendStuck(r);
		if (view.callouts.size() > 0) {
			const expires = os.clock() + TUTORIAL_VIEW.calloutSeconds;
			for (const key of view.callouts) {
				this.calloutSerial++;
				clientStore.pushToast({ id: -this.calloutSerial, key, until: expires }, PROGRESSION_VIEW.maxToasts);
			}
		}
		if (view.ghostHeart) clientStore.pulseGhostHeart();
		if (view.revision !== this.lastRevision) {
			this.lastRevision = view.revision;
			clientStore.setTutorialHud(tutorialHudFrom(view));
		}
		if (view.finished) this.finish(ctx, view);
	}

	/** The floor 2 -> 3 change: freeze the run and report the completion now, the outro after the beat. */
	private finish(ctx: RunContext, view: Readonly<TutorialView>): void {
		this.sim.freezeTutorialRun();
		// The step id current at the finish frame (the director clears it once finished: TUTORIAL_NO_STEP_ID).
		const stepId = finishStepId(view);
		Events.tutorialFinished.fire({ outcome: "completed", stepId });
		clientStore.endTutorial();
		this.beat = new TutorialOutroBeat();
		print(`[Tutorial] run ${ctx.counter}: completed at ${stepId}; the outro follows`);
	}

	private showOutro(): void {
		this.outroOpenedAt = os.clock();
		clientStore.setTutorialOutroOpen(true);
	}

	/**
	 * The outro card closed (once per attempt; nothing when it is not open): `onboardingReport({ kind: "outro" })` with
	 * the choice and the real seconds it was open. Leaving the game on it is the server's (`left`).
	 */
	private reportOutro(choice: TutorialOutroChoice): void {
		const openedAt = this.outroOpenedAt;
		if (openedAt === undefined) return;
		this.outroOpenedAt = undefined;
		const seconds = math.max(0, os.clock() - openedAt);
		Events.onboardingReport.fire({ kind: "outro", choice, seconds });
		print(`[Tutorial] outro closed: ${choice} after ${string.format("%.1f", seconds)} s`);
	}

	/**
	 * Ends the director's open stuck episode (a long one reports as `tutorialStuck`) while its attempt is still open:
	 * a director exists and its run has not finished (no beat; after the finish the server's attempt is closed). Call it
	 * before the director is discarded mid-attempt (skip, a restart or another run replacing it, the run left).
	 * flushMetrics is idempotent, so a second call sends nothing.
	 */
	private flushOpenAttempt(): void {
		const director = this.director;
		if (director === undefined || this.beat !== undefined) return;
		for (const report of director.flushMetrics()) sendStuck(report);
	}

	/** Every tutorial start goes through here: the entry for onRunStarted's `tutorialStarted`, then the run. */
	private startTutorial(entry: TutorialEntry): void {
		this.pendingEntry = entry;
		this.sim.startTutorial();
	}
}
