import { Controller, OnStart } from "@flamework/core";
import { RunService } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore } from "client/store";
import { sightingStringKey } from "shared/onboarding";
import { isDraftOpen } from "shared/sim";
import { RENDER_ORDER } from "shared/view";
import { SIGHTING_VIEW, SightingQueue, sightingsInView } from "shared/view/sighting";
import { SimController } from "./SimController";

const RENDER_STEP = "KV_Sightings";

/**
 * First-sighting toasts (docs/ENEMY_VARIANTS.md EV12, EVD10: once per account). The pure shared/view/sighting
 * SightingQueue holds this account's seen set (every `onboardingStatus`, which the server sends after its join load
 * and in answer to `requestOnboarding`; this controller asks once itself, since the join status may reach an earlier
 * listener only) and the queue. Once per rendered frame, after the FX tracker, it scans the watched view
 * (sightingsInView: living Imps, Oozes / slimelets, Summoners and affixed enemies near the view player, the spectated
 * teammate after a co-op death) and queues the unseen ones; then, one at a time (SIGHTING_VIEW toastSeconds +
 * gapSeconds), it shows the line on the SightingCard (the left edge under the status panel, not the top-centre toasts:
 * those hang over the far side of the room where the new enemy walks in; theme string `bestiary.<id>`), hides it again
 * after toastSeconds and reports the id
 * (`bestiarySeen`; the server validates and stores it). Never in the tutorial, under the stage cover or after the run
 * is over (no scan at all); a toast waits while a boon draft is open or the solo run is paused. A run exit drops the
 * queued ids that were never shown. Nothing at all until a LOADED status arrived (a failed join load: the stored set is
 * unknown).
 */
@Controller({})
export class SightingController implements OnStart {
	private readonly queue = new SightingQueue();
	private readonly found = new Array<string>();
	private serial = 0;

	constructor(private readonly sim: SimController) {}

	onStart(): void {
		Events.onboardingStatus.connect((status) => this.queue.receive(status));
		Events.requestOnboarding.fire();
		this.sim.onRunExited(() => {
			this.queue.clear();
			clientStore.setSighting(undefined);
		});
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Input.Value + RENDER_ORDER.tutorialAfterFx, () =>
			this.frame(),
		);
	}

	private frame(): void {
		const now = os.clock();
		const shown = clientStore.getState().game.sighting;
		if (shown !== undefined && (shown.until <= now || this.sim.isRunOver())) clientStore.setSighting(undefined);
		const ctx = this.sim.getContext();
		if (ctx === undefined || ctx.tutorial || !this.queue.isLoaded()) return;
		if (this.sim.isInputCovered() || this.sim.isRunOver()) return;
		const state = ctx.run.state;
		this.queue.observe(sightingsInView(state, this.sim.getViewPlayerIndex(), this.found));
		const canShow = !isDraftOpen(state) && ctx.live?.isPaused() !== true;
		const id = this.queue.next(now, canShow);
		if (id === undefined) return;
		this.serial++;
		clientStore.setSighting({
			id: SIGHTING_VIEW.toastIdBase - this.serial,
			key: sightingStringKey(id),
			until: now + SIGHTING_VIEW.toastSeconds,
		});
		Events.bestiarySeen.fire(id);
	}
}
