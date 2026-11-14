import { Controller, OnStart } from "@flamework/core";
import { RunService } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore } from "client/store";
import { codexDocOfStatus } from "shared/codex";
import { isDraftOpen } from "shared/sim";
import { RENDER_ORDER } from "shared/view";
import { SFX } from "shared/view/audio";
import { CODEX_HUD_STRINGS, codexSeenSightings, codexToastNameKey } from "shared/view/codex";
import { FirstKnockLatch } from "shared/view/secrets";
import {
	SIGHTING_VIEW,
	SightingQueue,
	sightingCardKey,
	sightingsInView,
	withRumourSighting,
	withSecretSighting,
} from "shared/view/sighting";
import { AudioController } from "../audio/AudioController";
import { CodexController } from "../fx/CodexController";
import { SimController } from "./SimController";
import { ThemeController } from "./ThemeController";

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
 * shared/view/sighting withRumourSighting): one card at a time, so never on top of the Goldling's own. A secret room's
 * crack card (`secret.crack`, docs/SECRET_ROOMS.md SR9 / SRD5) is found from the local player's first knock (a
 * shared/view/secrets FirstKnockLatch, reset on run exit; withSecretSighting); every card's text is read as the local
 * player's character (sightingCardKey: the Archer's `bestiary.secret.crack.archer`). Never in the tutorial, under the stage cover or after the run
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
	/** The local player's first knock on a secret room's crack this session (docs/SECRET_ROOMS.md SR9). */
	private readonly knock = new FirstKnockLatch();
	private readonly hasString = (key: string) => this.theme.getPack().hasString(key);
	private serial = 0;

	constructor(
		private readonly sim: SimController,
		private readonly codex: CodexController,
		private readonly audio: AudioController,
		private readonly theme: ThemeController,
	) {}

	onStart(): void {
		Events.onboardingStatus.connect((status) => this.queue.receive(status));
		Events.codexStatus.connect((status) => this.queue.learn(codexSeenSightings(codexDocOfStatus(status))));
		Events.requestOnboarding.fire();
		this.sim.onRunExited(() => {
			this.queue.clear();
			this.knock.reset();
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
		// docs/SECRET_ROOMS.md SR9: every frame's knocks (the run view's events are this frame's only), before any gate
		this.knock.observe(ctx.run.secrets, ctx.localIndex);
		if (this.sim.isInputCovered() || this.sim.isRunOver()) return;
		const state = ctx.run.state;
		const canShow = !isDraftOpen(state) && ctx.live?.isPaused() !== true;
		if (this.queue.isLoaded()) {
			const found = sightingsInView(state, this.sim.getViewPlayerIndex(), this.found);
			// docs/GOLDLING_RUMOURS.md GR7: the rumours' first-time card, queued on this floor's first rumour cue
			this.queue.observe(
				// docs/SECRET_ROOMS.md SR9 / SRD5: the crack's first-time card from the local player's first knock
				withSecretSighting(withRumourSighting(found, this.sim.getGoldenRumour().heard()), this.knock.knocked()),
			);
			const id = this.queue.next(now, canShow);
			if (id !== undefined) {
				this.serial++;
				const card = {
					id: SIGHTING_VIEW.toastIdBase - this.serial,
					// the local player's character's text (the Archer's crack card names the charged arrow)
					key: sightingCardKey(id, ctx.character, this.hasString),
					until: now + SIGHTING_VIEW.toastSeconds,
				};
				clientStore.setSighting(this.codex.sightingChip(id) ? { ...card, codexNew: true } : card);
				Events.bestiarySeen.fire(id);
				return;
			}
		}
		if (!this.codex.hasToast() || !this.queue.claimSlot(now, canShow)) return;
		const toast = this.codex.takeToast();
		if (toast === undefined) return;
		this.serial++;
		clientStore.setSighting({
			id: SIGHTING_VIEW.toastIdBase - this.serial,
			key: CODEX_HUD_STRINGS.toast,
			nameKey: codexToastNameKey(toast.id),
			codexNew: true,
			codexId: toast.id,
			codexTier: toast.tier,
			until: now + SIGHTING_VIEW.toastSeconds,
		});
		this.audio.play(SFX.codexNew, 1);
	}
}
