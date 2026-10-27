import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore } from "client/store";
import { RUN_ATTRIBUTES } from "shared/play";
import {
	TutorialDirector,
	TutorialOutroBeat,
	tutorialAttribute,
	tutorialHudFrom,
	type FirstRunDecision,
	type TutorialMarker,
} from "shared/tutorial";
import { JoinGate, RENDER_ORDER } from "shared/view";
import { PROGRESSION_VIEW, TUTORIAL_VIEW } from "shared/view/hud";
import { FirstJoinGate } from "shared/view/menu";
import { PreloadController } from "./PreloadController";
import { SimController, type RunContext } from "./SimController";

const RENDER_STEP = "KV_Tutorial";

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
 *   **Join gate (docs/PRELOAD.md P5):** the decision is only DISPATCHED (the tutorial start, the `onFirstRunDecided`
 *   listeners) once the join loading screen released too (PreloadController.whenReleased), whichever comes last
 *   (shared/view JoinGate), so the tutorial, the main menu or KV_SkipMenu's solo run start under no cover; until
 *   then `menu.awaitingFirstRun` stays true (the backdrop alone under the loading screen).
 * - **Each tutorial run** (first join, Restart tutorial, a replay): a fresh TutorialDirector and `tutorialStarted`.
 *   Once per rendered frame, right after the FX tracker (RENDER_ORDER.tutorialAfterFx), the director reads the
 *   frame's state, events and raw buttons (not while paused); its view goes to the Reflex `tutorial` slice when its
 *   revision moved, each newly reached funnel step to `tutorialStep`, callouts to the toasts, the ghost half heart
 *   to the status panel. The world marker reads `getMarker()`.
 * - **The end** (the floor 2 -> 3 change): the run freezes and `tutorialFinished("completed")` goes out at once
 *   (SimController.freezeTutorialRun: no floor 3 draft; the slice's `ended` hides the panel and the draft overlay),
 *   then after TUTORIAL.outroDelaySeconds the outro card. Outro: Start my first run (HudController: the main menu's
 *   Play solo) / Play the tutorial again.
 * - **Pause overlay**: Restart tutorial (a fresh run and director), Skip tutorial (after a confirm:
 *   `tutorialFinished("skipped")`, then the run is left for the menu like Leave run). The main menu's Tutorial
 *   replays it.
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

	/** Closes the outro card (its "Start my first run" then does the main menu's Play solo: HudController). */
	closeOutro(): void {
		clientStore.setTutorialOutroOpen(false);
	}

	/** Outro "Play the tutorial again", pause "Restart tutorial" and the main menu's "Tutorial". */
	playTutorial(): void {
		clientStore.setTutorialOutroOpen(false);
		clientStore.setTutorialSkipConfirm(false);
		this.sim.startTutorial();
	}

	/**
	 * Pause "Skip tutorial" -> "Skip": counts as done (`tutorialFinished("skipped")`), then the run is left for the
	 * menu exactly like Leave run (SimController.leaveRun -> MenuController: the lobby room while in a lobby, else the
	 * main menu).
	 */
	skipTutorial(): void {
		clientStore.setTutorialSkipConfirm(false);
		if (!this.sim.isTutorialRun() || this.beat !== undefined) return; // already finished: the outro handles it
		Events.tutorialFinished.fire("skipped");
		print("[Tutorial] skipped");
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
		this.beat = undefined;
		this.lastRevision = -1;
		if (!ctx.tutorial) {
			this.director = undefined;
			this.runCounter = -1;
			clientStore.clearTutorial();
			return;
		}
		const director = new TutorialDirector();
		this.director = director;
		this.runCounter = ctx.counter;
		// Every tutorial start is a new funnel attempt (and marks the player busy for lobbies).
		Events.tutorialStarted.fire();
		clientStore.beginTutorial(tutorialHudFrom(director.getView()));
		print(`[Tutorial] run ${ctx.counter}: practice descent started`);
	}

	/** The run was left for the menu (Skip tutorial, or any Leave run / exit): no tutorial on screen any more. */
	private onRunExited(): void {
		this.director = undefined;
		this.runCounter = -1;
		this.beat = undefined;
		this.lastRevision = -1;
		clientStore.clearTutorial();
	}

	/**
	 * The join flow, once the gate decided and the loading screen released (JoinGate; undefined: not yet, or already
	 * dispatched): the tutorial starts here, the listeners (MenuController) take "normal".
	 */
	private dispatch(choice: FirstRunDecision | undefined, onRelease: boolean): void {
		if (choice === undefined) return;
		this.decided = choice;
		if (onRelease) print(`[Tutorial] first run: ${choice} (dispatched as the loading screen released)`);
		if (choice === "tutorial") this.sim.startTutorial();
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
		// count as the objective card's Continue.
		if (live.isPaused() || this.sim.isFrozen()) return;

		const view = director.update({
			state: live.state,
			config: live.setup.config,
			events: live.frameEvents,
			buttons: this.sim.getFrameButtons(),
			dt,
		});
		for (const step of view.newFunnelSteps) Events.tutorialStep.fire(step);
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
		if (view.finished) this.finish(ctx);
	}

	/** The floor 2 -> 3 change: freeze the run and report the completion now, the outro after the beat. */
	private finish(ctx: RunContext): void {
		this.sim.freezeTutorialRun();
		Events.tutorialFinished.fire("completed");
		clientStore.endTutorial();
		this.beat = new TutorialOutroBeat();
		print(`[Tutorial] run ${ctx.counter}: completed; the outro follows`);
	}

	private showOutro(): void {
		clientStore.setTutorialOutroOpen(true);
	}
}
