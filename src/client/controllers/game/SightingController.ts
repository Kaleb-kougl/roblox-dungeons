import { Controller, OnStart } from "@flamework/core";
import { RunService } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore } from "client/store";
import { codexDocOfStatus } from "shared/codex";
import { sightingStringKey } from "shared/onboarding";
import { isDraftOpen } from "shared/sim";
import { RENDER_ORDER } from "shared/view";
import { SFX } from "shared/view/audio";
import { CODEX_HUD_STRINGS, codexSeenSightings, codexToastNameKey } from "shared/view/codex";
import { SIGHTING_VIEW, SightingQueue, sightingsInView, withRumourSighting } from "shared/view/sighting";
import { AudioController } from "../audio/AudioController";
import { CodexController } from "../fx/CodexController";
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
 * (`bestiarySeen`; the server validates and stores it). The Goldling rumours' card (`golden.rumour`, docs/
 * GOLDLING_RUMOURS.md GR7) is found once this floor's first rumour cue played (SimController's GoldenRumourClock.heard,
 * shared/view/sighting withRumourSighting): one card at a time, so never on top of the Goldling's own. Never in the tutorial, under the stage cover or after the run
 * is over (no scan at all); a toast waits while a boon draft is open or the solo run is paused. A run exit drops the
 * queued ids that were never shown. Nothing at all until a LOADED status arrived (a failed join load: the stored set is
 * unknown).
 *
 * The Codex (claude/codex-plan.md CX6, R11): a card wears the NEW! chip when the Codex tracker says the entry rose this
 * run (CodexController.sightingChip; text and timing unchanged). Once a `codexStatus` carries a SEEDED doc, its
 * sightings are unioned into the seen set (codexSeenSightings; the onboarding list stays the record before the seed).
 * The card's slot also shows the Codex's own toasts (CodexController.takeToast: a first kill, a vault chest's relic, a
 * boss down; one line `NEW! {name} · Codex`, `sfx.codex.new`): one at a time with the sightings (a queued sighting goes
 * first, SightingQueue.claimSlot), under the same gates (never in the tutorial, under the cover or after run over; they
 * wait while a draft is open or the run is paused), whether or not the onboarding status loaded.
 */
@Controller({})
export class SightingController implements OnStart {
	private readonly queue = new SightingQueue();
	private readonly found = new Array<string>();
	private serial = 0;

	constructor(
		private readonly sim: SimController,
		private readonly codex: CodexController,
		private readonly audio: AudioController,
	) {}

	onStart(): void {
		Events.onboardingStatus.connect((status) => this.queue.receive(status));
		Events.codexStatus.connect((status) => this.queue.learn(codexSeenSightings(codexDocOfStatus(status))));
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
		if (ctx === undefined || ctx.tutorial) return;
		if (this.sim.isInputCovered() || this.sim.isRunOver()) return;
		const state = ctx.run.state;
		const canShow = !isDraftOpen(state) && ctx.live?.isPaused() !== true;
		if (this.queue.isLoaded()) {
			const found = sightingsInView(state, this.sim.getViewPlayerIndex(), this.found);
			// docs/GOLDLING_RUMOURS.md GR7: the rumours' first-time card, queued on this floor's first rumour cue
			this.queue.observe(withRumourSighting(found, this.sim.getGoldenRumour().heard()));
			const id = this.queue.next(now, canShow);
			if (id !== undefined) {
				this.serial++;
				const card = {
					id: SIGHTING_VIEW.toastIdBase - this.serial,
					key: sightingStringKey(id),
					until: now + SIGHTING_VIEW.toastSeconds,
				};
				clientStore.setSighting(this.codex.sightingChip(id) ? { ...card, codexNew: true } : card);
				Events.bestiarySeen.fire(id);
				return;
			}
		}
		if (!this.codex.hasToast() || !this.queue.claimSlot(now, canShow)) return;
		const entry = this.codex.takeToast() as string;
		this.serial++;
		clientStore.setSighting({
			id: SIGHTING_VIEW.toastIdBase - this.serial,
			key: CODEX_HUD_STRINGS.toast,
			nameKey: codexToastNameKey(entry),
			codexNew: true,
			codexId: entry,
			until: now + SIGHTING_VIEW.toastSeconds,
		});
		this.audio.play(SFX.codexNew, 1);
	}
}
