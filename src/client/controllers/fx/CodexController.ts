import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService } from "@rbxts/services";
import { Events } from "client/network";
import { clientStore } from "client/store";
import {
	CodexOutbox,
	codexDay,
	codexDocOfStatus,
	codexEligibility,
	type CodexClaim,
	type CodexStatus,
	type CodexTierId,
} from "shared/codex";
import { findBoss, type RunView } from "shared/play";
import { archetypeAt } from "shared/sim";
import {
	CodexTracker,
	clearCodexFrameEvents,
	newCodexFrame,
	pushCodexDeath,
	readCodexFrame,
	type CodexRunSummary,
	type CodexTrackerOutput,
} from "shared/view/codex";
import type { FxEvent } from "shared/view/fx";
import { SimController, type RunContext, type ToastChipSource } from "../game/SimController";
import { FxTrackerController } from "./FxTrackerController";

const NO_CHIPS: ReadonlyArray<string> = [];

/** A codex toast waiting for the SightingCard: the entry and the tier it rose to (its art: seen or found). */
export interface CodexToast {
	readonly id: string;
	readonly tier: CodexTierId;
}

/**
 * The Codex in the client (claude/codex-plan.md CX6). It owns the session's pure CodexTracker (shared/view/codex) and
 * CodexOutbox (shared/codex), and keeps the store's `codex` slice (client/store codex.ts) as the local copy:
 *
 *   status     every `codexStatus` (asked once at start: `requestCodex`; the server also pushes one at its join load's
 *              end) goes to the tracker (`receive`: its held entries come back as rises and are claimed too), the
 *              outbox (queued claims go out once loaded; a failed load drops them) and the store (codexReceive, with
 *              the outbox's still-queued views so their dots stay cleared); a load that resolves finds of a run whose
 *              summary already froze rebuilds it (the tracker) and the store gets the new one
 *   run        `startRun(codexEligibility(...))` at every run start (world, KV_Debug at the start: SimController
 *              isDebugRun, dev, stress, Studio; decision R9), `endRun()` at the run's exit; the summary is frozen into
 *              the store (setCodexRunSummary) on the frame the run is over or the local player left, or at the exit
 *   frame      SimController's ToastChipSource: once per sim frame, right before its toasts are pushed, readCodexFrame
 *              plus this frame's pedestal relics (the run events' `relic`), a boss's engage (FrameEvents.bossEngaged:
 *              findBoss) and run over, plus the kills (FxTracker `killed`, pushCodexDeath on the corpse frame) and boss
 *              deaths (`bossDefeated`) the FX tracker reported since the last sim frame (it runs after the sim, so a kill
 *              counts one frame later); `update`; its chips go back to pushToasts (ToastView.codexNew), its codex
 *              toasts queue for the SightingCard (SightingController takes them one at a time, takeToast). Skipped
 *              (no readCodexFrame, no kills buffered) while the tracker is not counting (an ineligible run, a failed
 *              load). The frame the run is over or the local player left is the last: its update waits for that
 *              frame's FX events (FxTracker onFrame), so the kill that ended the run and the buffered ones count
 *   claims     each frame's rises go to the outbox and onto the store's copy at once (applyClaims on the client's day;
 *              the server sends no echo); the outbox flushes on Heartbeat (batches of at most CODEX.claimMaxItems, at
 *              most every CODEX_OUTBOX.flushSeconds, hurried at run over, each remote under callsPerWindow per window)
 *   viewed     sendViewed(ids) for the Codex screen (CX7): markViewed on the store's copy, `codexViewed` batches of at
 *              most CODEX.viewedMaxIds through the outbox, hurried
 *
 * For CX7-CX9: showsNewTag(id) (the draft card's NEW tag), codexNewThisRun(id) (BO's callout line), codexRunSummary()
 * (live; also frozen in the store's `runSummary`), sightingChip(sighting), sendViewed(ids). Read-only on the sim.
 */
@Controller({})
export class CodexController implements OnStart, ToastChipSource {
	private readonly janitor = new Janitor();
	private readonly tracker = new CodexTracker();
	private readonly outbox = new CodexOutbox();
	private readonly frame = newCodexFrame();
	/** Codex toasts waiting for the SightingCard, oldest first. */
	private readonly toasts: CodexToast[] = [];
	private inRun = false;
	/** This run's summary went to the store (the run is over, or the local player left). */
	private summarySent = false;
	/** The summary object last given to the store (a rebuilt one is sent again). */
	private sentSummary: CodexRunSummary | undefined;
	/** The run's last frame was seen (run over / left): its update runs after that frame's FX events. */
	private finalPending = false;
	/** The run's last update ran: nothing more for this run. */
	private finalDone = false;

	constructor(private readonly sim: SimController, private readonly fx: FxTrackerController) {}

	onStart(): void {
		this.janitor.Add(Events.codexStatus.connect((status) => this.receive(status)));
		Events.requestCodex.fire();
		this.sim.setToastChipSource(this);
		this.sim.onRunStarted((ctx) => this.startRun(ctx));
		this.sim.onRunExited(() => this.endRun());
		this.fx.onEvent((e) => this.onFx(e));
		// After the frame's FX events: the run's last update (the run-over frame's kills are in the frame by then).
		this.fx.onFrame(() => this.finish());
		this.janitor.Add(RunService.Heartbeat.Connect(() => this.flush()));
	}

	// --- for the HUD and the menus (CX7-CX9) ----------------------------------------------------------------

	/** A draft card for entry `id` wears the NEW tag (CX8; shared/view/codex CodexTracker.showsNewTag). */
	showsNewTag(id: string | undefined): boolean {
		return this.tracker.showsNewTag(id);
	}

	/** Entry `id` was found for the first time ever this run (BO's callout line, CX9). */
	codexNewThisRun(id: string): boolean {
		return this.tracker.codexNewThisRun(id);
	}

	/** The run-over line's data: live during the run, frozen once it is over (the store's `runSummary` holds it then). */
	codexRunSummary(): CodexRunSummary {
		return this.tracker.codexRunSummary();
	}

	/** The SightingCard for first-sighting id `sighting` wears the NEW! chip (R11). */
	sightingChip(sighting: string): boolean {
		return this.tracker.sightingChip(sighting);
	}

	/** The Codex screen's viewed entries (their NEW dots clear now on the local copy; `codexViewed` goes out soon). */
	sendViewed(ids: ReadonlyArray<string>): void {
		if (ids.size() === 0) return;
		this.outbox.view(ids);
		clientStore.codexMarkViewed(ids);
		this.outbox.hurry();
	}

	/** A codex toast is waiting for the SightingCard. */
	hasToast(): boolean {
		return this.toasts.size() > 0;
	}

	/** The next codex toast (removed from the queue), or undefined. SightingController shows it. */
	takeToast(): CodexToast | undefined {
		return this.toasts.size() > 0 ? this.toasts.remove(0) : undefined;
	}

	// --- ToastChipSource ------------------------------------------------------------------------------------

	toastChips(view: RunView): ReadonlyArray<string> {
		const ctx = this.sim.getContext();
		if (!this.inRun || ctx === undefined || this.finalPending || this.finalDone) return NO_CHIPS;
		const state = ctx.run.state;
		const counting = this.tracker.isCounting();
		const f = this.frame;
		// Not counting (an ineligible run, a failed load): only the run's end matters, so the state is not read.
		if (counting) {
			readCodexFrame(state, ctx.config, this.sim.getLocalPlayerIndex(), this.sim.getViewPlayerIndex(), f);
		}
		f.runOver = this.sim.isRunOver();
		if (f.runOver || f.left) {
			// The last frame: its update runs once this frame's FX events are in (finish, from FxTracker's onFrame).
			this.finalPending = true;
			return NO_CHIPS;
		}
		if (!counting) return NO_CHIPS;
		for (const e of view.runEvents) if (e.kind === "relic") f.pedestalRelics.push(e.index);
		if (view.frameEvents.bossEngaged > 0) {
			const boss = findBoss(state);
			if (boss !== undefined) f.bossEngaged = archetypeAt(boss.kind).id;
		}
		const out = this.tracker.update(f);
		clearCodexFrameEvents(f);
		this.deliver(out);
		return out.chips;
	}

	// --- internals ------------------------------------------------------------------------------------------

	private receive(status: CodexStatus): void {
		const doc = codexDocOfStatus(status);
		const held = this.tracker.receive(doc);
		this.outbox.receive(doc !== undefined);
		clientStore.codexReceive(doc, this.outbox.pendingViews());
		if (doc === undefined) return;
		// Claims queued before this status (none normally: the tracker holds until a doc loads) show on the copy too.
		const queued = this.outbox.pendingClaims();
		if (queued.size() > 0) clientStore.codexApplyClaims(queued, this.day());
		if (held.size() > 0) this.claim(held);
		// A late load moved held finds into a run whose summary already froze: the store gets the rebuilt one.
		if (this.summarySent) {
			const summary = this.tracker.codexRunSummary();
			if (summary !== this.sentSummary) {
				this.sentSummary = summary;
				clientStore.setCodexRunSummary(summary);
			}
		}
	}

	/** One update's rises (claimed) and codex toasts (queued for the SightingCard). */
	private deliver(out: CodexTrackerOutput): void {
		if (out.rises.size() > 0) this.claim(out.rises);
		for (let i = 0; i < out.codexToasts.size(); i++) {
			this.toasts.push({ id: out.codexToasts[i], tier: (out.codexToastTiers[i] ?? 0) as CodexTierId });
		}
	}

	/**
	 * The run's last update (the frame it was over or the local player left, with that frame's FX kills and the ones
	 * buffered before), then the summary to the store. Once per run; FxTracker's onFrame calls it every frame.
	 */
	private finish(): void {
		if (!this.finalPending) return;
		this.finalPending = false;
		this.finalDone = true;
		const out = this.tracker.update(this.frame);
		clearCodexFrameEvents(this.frame);
		this.deliver(out);
		this.sendSummary();
	}

	private claim(rises: ReadonlyArray<CodexClaim>): void {
		this.outbox.claim(rises);
		clientStore.codexApplyClaims(rises, this.day());
	}

	private day(): number {
		return codexDay(os.time());
	}

	private flush(): void {
		if (this.outbox.pendingCount() === 0) return;
		for (const send of this.outbox.flush(os.clock())) {
			if (send.kind === "claim") Events.codexClaim.fire(send.items);
			else Events.codexViewed.fire(send.ids);
		}
	}

	private startRun(ctx: RunContext): void {
		this.tracker.startRun(
			codexEligibility({
				world: ctx.world,
				debug: this.sim.isDebugRun(),
				dev: ctx.dev,
				stress: ctx.stress,
				studio: RunService.IsStudio(),
			}),
		);
		clearCodexFrameEvents(this.frame);
		this.frame.runOver = false;
		this.frame.left = false;
		this.toasts.clear();
		this.inRun = true;
		this.summarySent = false;
		this.sentSummary = undefined;
		this.finalPending = false;
		this.finalDone = false;
		clientStore.setCodexRunSummary(undefined);
	}

	private endRun(): void {
		// An exit before the last frame's update ran: run it now (the buffered kills still count).
		if (this.inRun && !this.finalDone) {
			if (!this.frame.left) this.frame.runOver = true;
			this.finalPending = true;
			this.finish();
		}
		this.tracker.endRun();
		if (this.inRun) this.sendSummary();
		this.inRun = false;
		clearCodexFrameEvents(this.frame);
		this.toasts.clear();
	}

	/** The run is over (or left): its frozen summary into the store, and the claims out soon. Once per run. */
	private sendSummary(): void {
		if (this.summarySent) return;
		this.summarySent = true;
		this.sentSummary = this.tracker.codexRunSummary();
		clientStore.setCodexRunSummary(this.sentSummary);
		this.outbox.hurry();
	}

	/**
	 * A kill or a boss death since the last sim frame (read on its corpse frame: the slot still holds the actor). Only
	 * while the tracker counts and the run's last update has not run.
	 */
	private onFx(e: FxEvent): void {
		if (!this.inRun || this.finalDone || !this.tracker.isCounting()) return;
		if (e.type === "killed") {
			const state = this.sim.getState();
			if (state !== undefined) pushCodexDeath(state, this.frame, e.slot);
		} else if (e.type === "bossDefeated") this.frame.bossDefeated = archetypeAt(e.kind).id;
	}
}
