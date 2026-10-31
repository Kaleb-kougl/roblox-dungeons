import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import React, { createBinding } from "@rbxts/react";
import { ReflexProvider } from "@rbxts/react-reflex";
import { createPortal, createRoot } from "@rbxts/react-roblox";
import { GuiService, Players, RunService } from "@rbxts/services";
import { clientStore, selectJuice } from "client/store";
import { StageCard } from "client/ui";
import { TUTORIAL } from "shared/config";
import { ENDLESS_FIRST_FLOOR } from "shared/dungeon";
import type { ContentRef } from "shared/theme";
import {
	PregenTracker,
	StageLoad,
	bossContentIds,
	stageMerge,
	type StageKind,
	type StagePhase,
	type StageWorkItem,
} from "shared/view";
import { AudioController } from "../audio/AudioController";
import { PreloadController } from "./PreloadController";
import { SimController, type RunContext, type StageDriver, type StageWork } from "./SimController";
import { ThemeController } from "./ThemeController";

const LOG = "[Stage]";
const ROOT_NAME = "KV_StageRoot";
/** Bound last in the render step: everything before it in a frame runs before that frame's render. */
const RENDER_END_STEP = "KV_StageRenderEnd";
const MS_PER_SECOND = 1000;
const MS = "%.0f";
const SECONDS = "%.2f";

function ms(sec: number): string {
	return string.format(MS, sec * MS_PER_SECOND);
}

function seconds(sec: number): string {
	return string.format(SECONDS, sec);
}

/**
 * The stage loader's driver (docs/STAGE_LOADER.md SL3-SL7): covers the screen while a stage (a dungeon floor) is built
 * and its views rebuild, at every run start and floor change, and pre-generates the next floor while the world is
 * frozen. Presentation only: it never writes sim state (pre-generation calls the run's own pure, cached floor builder,
 * RunContext.endlessFloor, which returns the identical world the sim would build mid-tick).
 *
 *   driver     SimController.setStageDriver(this) in onStart (one injection direction: SimController never injects
 *              this). SimController hands over each run start / floor change as a StageWork (`stage`; `awaitServer`
 *              for a ranked start's wait) and calls `frame(dt)` first thing in its render step, so the work runs in
 *              SimController's frame, before the sim steps. One shared/view StageLoad per cover; a new request merges
 *              with the current one by shared/view stageMerge ("continue" the server wait, "absorb" a floor change
 *              while the run-start listeners are still pending: they read the newest context, "new" otherwise).
 *   sequence   frame N (the event): `begin` sets the cover's React bindings synchronously (StageCard's ScreenGui
 *              Enabled, opacity 1, the serial that keeps the label rows hidden until the Reflex `stage` slice, flushed
 *              on Heartbeat, has the new text), reads the ScreenGui's Enabled back and clears the gamepad selection.
 *              Inside the render step (`inRender`: from SimController's frame until RENDER_END_STEP, bound last) the
 *              cover is drawn by frame N's own render, so it is reported at once (StageLoad.coverShown); outside one
 *              (a click, a remote event) the report waits for the next frame's start. STAGE_LOADER.coverDrawFrames (1)
 *              frame later the work runs, one item per frame (StageLoad.due): solo run start `forge` (makeRun, floor 1),
 *              then `notify` (the listeners), then `pregen` (floor 2; the tutorial: every tutorial floor); co-op start
 *              and floor change `notify` only. Then the assets wait, `settleFrames` frames, the card's minimum
 *              (`minCardSec`, floor changes; neither when the floor change opened no local draft: `worldLive`), and
 *              the reveal: the fade, driven by the opacity binding every frame (StageLoad.coverOpacity; under reduced
 *              motion the load ends as the reveal starts), then hideStage. Input stays blocked through the fade.
 *   hold       a solo run start holds the run until the reveal (SimController.isHeldByLoader: no tick, no pause menu,
 *              R ignored); co-op never holds (the lockstep keeps stepping; only the views wait). Until the reveal the
 *              cover owns the input (blocksInput: SimController sends neutral input, client/store selectMenuOpen
 *              treats it as a menu), so a floor change's draft cannot be confirmed blind.
 *   assets     after the listeners (AudioController and the boss push have requested them): the floor's beds
 *              (AudioController.floorBeds) and, on a boss floor, shared/view bossContentIds, through
 *              PreloadController.whenLoaded, up to STAGE_LOADER.assetCapSec. Co-op covers skip this wait (SL7: the
 *              cover lasts the build and settle only, plus the floor card, so nobody waits on one client's downloads).
 *   pregen     shared/view PregenTracker per run (lastFloor: TUTORIAL.lastFloor in a tutorial run): at a solo run start
 *              under the cover (`pregen` work), and every frame outside covered work and the fade, floor n + 1 once
 *              the local player's draft on floor n has been open a rendered frame (solo and co-op, SD1). A floor
 *              reached without it was built mid-tick by the sim, as before (logged). Co-op starts pre-generate
 *              nothing under their cover (it would hold the cover while the party plays): floor 2 is built mid-tick.
 *   cancel     SimController.stopRun (Leave run, exit) cancels: the cover goes, pending work is dropped. A restart, a
 *              new run or a party start replaces the load (stageMerge "new").
 *
 * Log lines start with `[Stage]`: `run N: forged in t ms, built in t ms, revealed at t s`, `floor N: built in t ms,
 * revealed at t s`, `floor X pre-generated in T ms (run start | during floor N's draft)`, `floor N: built mid-tick (not
 * pre-generated)`, `floor N: assets ready in T s (k ids)` / `asset wait capped at T s`, and failures (warn).
 */
@Controller({ loadOrder: 2 })
export class StageController implements OnStart, StageDriver {
	private readonly janitor = new Janitor();
	private readonly opacity = createBinding(0);
	private readonly visible = createBinding(false);
	private readonly shownSerial = createBinding(0);
	/** StageCard's ScreenGui, once mounted. */
	private gui: ScreenGui | undefined;
	/** Inside the render step, before the frame's render (SimController's frame .. RENDER_END_STEP). */
	private inRender = false;
	/** A cover reported outside a render step: StageLoad.coverShown at the start of the next frame (this serial). */
	private pendingAck = -1;
	private load: StageLoad | undefined;
	private work: StageWork | undefined;
	private serial = 0;
	private tracker: PregenTracker | undefined;
	/** RunContext.counter the tracker belongs to. */
	private trackerRun = -1;
	private lastLabelKey = "";
	private lastFloor = -1;
	private lastFraction = -1;
	private revealedSerial = -1;
	private assetsLogged = false;
	private assetsStartedAt = 0;
	private assetsReadyIn = -1;
	private assetCount = 0;
	private forgeSec = 0;
	private buildSec = 0;
	private runCounter = 0;

	constructor(
		private readonly sim: SimController,
		private readonly preload: PreloadController,
		private readonly audio: AudioController,
		private readonly theme: ThemeController,
	) {}

	onStart(): void {
		const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui");
		const container = new Instance("Folder");
		container.Name = ROOT_NAME;
		const root = createRoot(container);
		this.janitor.Add(() => {
			root.unmount();
			container.Destroy();
		}, true);
		const [opacity] = this.opacity;
		const [visible] = this.visible;
		const [serial] = this.shownSerial;
		root.render(
			createPortal(
				<ReflexProvider producer={clientStore}>
					<StageCard
						visible={visible}
						opacity={opacity}
						serial={serial}
						onCovered={(s) => this.onCovered(s)}
						onGui={(gui) => (this.gui = gui)}
					/>
				</ReflexProvider>,
				playerGui,
			),
		);
		RunService.BindToRenderStep(RENDER_END_STEP, Enum.RenderPriority.Last.Value, () => (this.inRender = false));
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_END_STEP), true);
		this.sim.setStageDriver(this);
	}

	// --- StageDriver ---------------------------------------------------------------------------

	awaitServer(): void {
		this.begin("runStart", undefined, true);
	}

	stage(kind: StageKind, work: StageWork): void {
		const current = this.load;
		const merge = stageMerge(current, kind);
		if (merge === "absorb") return; // the pending run-start listeners will read this floor's context
		if (merge === "continue" && current !== undefined) {
			this.work = work;
			current.serverAnswered(work.floor);
			this.publish(current);
			return;
		}
		this.begin(kind, work, false);
	}

	cancel(): void {
		if (this.load === undefined) return;
		this.load = undefined;
		this.work = undefined;
		this.pendingAck = -1;
		this.hideCover();
	}

	frame(dt: number): void {
		this.inRender = true; // SimController's render step: what happens until RENDER_END_STEP is drawn this frame
		const load = this.load;
		let worked = false;
		if (load !== undefined) {
			load.frame(dt);
			if (this.pendingAck === this.serial) {
				// Reported outside a render step: this frame's render is the first that surely drew it.
				this.pendingAck = -1;
				load.coverShown();
			}
			const item = load.due();
			if (item !== undefined) {
				worked = true;
				this.runWork(load, item);
			}
		}
		const now = this.load;
		// One stall per frame: no draft pre-generation in a frame that already ran covered work.
		if (!worked) this.pregenFrame(now?.phase());
		if (now === undefined) return;
		this.publish(now);
		// Under reduced motion there is no fade: the cover (and the input block) ends as the reveal starts.
		if (now.isDone() || (now.phase() === "revealing" && this.reducedMotion())) this.finish(now);
	}

	holdsSim(): boolean {
		return this.load?.holdSim() === true;
	}

	blocksInput(): boolean {
		return this.load?.blocksInput() === true;
	}

	/**
	 * What is under the cover can be seen: no cover, or the cover fading or gone (StagePhase `revealing` / `done`).
	 * The boon draft reveal starts on the first such frame (docs/DRAFT_REVEAL.md "Rules", DraftRevealController).
	 */
	coverLifting(): boolean {
		const load = this.load;
		if (load === undefined) return true;
		const phase = load.phase();
		return phase === "revealing" || phase === "done";
	}

	// --- the load --------------------------------------------------------------------------------

	private begin(kind: StageKind, work: StageWork | undefined, waitServer: boolean): void {
		const ctx = this.sim.getContext();
		const solo = kind === "runStart";
		// A floor change that opened no draft for the local player (nothing to offer): the world is live under the
		// card, so it only covers the rebuild and the settle frames (SD5 kept: no hold).
		const me = ctx?.run.state.run?.players[ctx.localIndex];
		const worldLive = kind === "floorChange" && (me === undefined || me.draftOpen === 0);
		const load = new StageLoad(kind, {
			waitServer,
			forge: solo && (waitServer || work?.forge !== undefined),
			pregen: solo,
			floor: work?.floor ?? (waitServer ? 0 : ctx?.floor ?? 0),
			worldLive,
		});
		this.load = load;
		this.work = work;
		this.serial += 1;
		this.revealedSerial = -1;
		this.assetsLogged = false;
		this.assetsReadyIn = -1;
		this.assetCount = 0;
		this.forgeSec = 0;
		this.buildSec = 0;
		this.lastLabelKey = "";
		this.lastFloor = -1;
		this.lastFraction = -1;
		const label = load.label();
		let biomeKey = "";
		let boss = false;
		if (kind === "floorChange" && ctx !== undefined) {
			biomeKey = clientStore.getState().game.run.placeKey;
			boss = ctx.endlessFloor !== undefined && ctx.floor > 0 && ctx.endlessFloor(ctx.floor).bossFloor;
			const tracker = this.trackerFor(ctx);
			if (ctx.floor > ENDLESS_FIRST_FLOOR && !tracker.wasBuilt(ctx.floor)) {
				print(`${LOG} floor ${ctx.floor}: built mid-tick (not pre-generated)`);
			}
		}
		this.showCover(load);
		clientStore.showStage({
			serial: this.serial,
			card: kind === "floorChange",
			labelKey: label.key,
			floor: label.vars.floor,
			biomeKey,
			boss,
			fraction: load.fraction(),
		});
	}

	/**
	 * The cover goes on screen now, through bindings (applied to the ScreenGui synchronously, unlike the Reflex slice):
	 * Enabled, opaque, the label rows hidden until the slice catches up. Reported drawn when the ScreenGui reads back
	 * enabled: at once inside the render step (this frame's render draws it), else at the next frame's start.
	 */
	private showCover(load: StageLoad): void {
		this.shownSerial[1](this.serial);
		this.opacity[1](load.coverOpacity(this.reducedMotion()));
		this.visible[1](true);
		GuiService.SelectedObject = undefined; // nothing under the cover keeps the gamepad selection
		this.pendingAck = -1;
		if (this.gui === undefined || !this.gui.Enabled) return; // not mounted: StageCard's commit reports it
		if (this.inRender) load.coverShown();
		else this.pendingAck = this.serial;
	}

	private hideCover(): void {
		this.visible[1](false);
		this.opacity[1](0);
		clientStore.hideStage();
	}

	/** StageCard committed the slice's cover for load `serial` (the fallback report: from the next frame on). */
	private onCovered(serial: number): void {
		if (serial === this.serial && this.load !== undefined) this.pendingAck = serial;
	}

	/** One covered work item (protected: a failure warns and the cover lifts, never a stuck screen). */
	private runWork(load: StageLoad, item: StageWorkItem): void {
		const work = this.work;
		const t0 = os.clock();
		if (item === "forge") {
			const [ok, err] = pcall(() => work?.forge?.());
			if (this.load !== load) return; // the forge stopped the run (the tutorial could not start): cancelled
			if (!ok) {
				warn(`${LOG} the run could not start: ${tostring(err)}`);
				this.cancel();
				return;
			}
			this.forgeSec = os.clock() - t0;
			load.forged();
			return;
		}
		if (item === "notify") {
			const [ok, err] = pcall(() => work?.notify());
			if (this.load !== load) return;
			if (!ok) warn(`${LOG} a view rebuild failed: ${tostring(err)}`);
			this.buildSec = os.clock() - t0;
			load.built();
			const [waitOk, waitErr] = pcall(() => this.waitAssets(load));
			if (!waitOk) {
				warn(`${LOG} the assets wait failed: ${tostring(waitErr)}`);
				load.assetsDone();
			}
			return;
		}
		const ctx = this.sim.getContext();
		if (ctx !== undefined && ctx.endlessFloor !== undefined) {
			const tracker = this.trackerFor(ctx);
			for (const f of tracker.startTargets(ctx.floor)) this.pregenerate(ctx, tracker, f, "run start");
		}
		load.pregenerated();
	}

	/**
	 * After the listeners: wait for the floor's beds (and a boss floor's sheets), up to assetCapSec. Co-op never waits,
	 * nor a floor change whose world is live (StageLoad.waitsForAssets).
	 */
	private waitAssets(load: StageLoad): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined || ctx.coop !== undefined || !load.waitsForAssets()) {
			this.assetsLogged = true;
			load.assetsDone();
			return;
		}
		const refs: ContentRef[] = this.audio.floorBeds(ctx);
		if (ctx.endlessFloor !== undefined && ctx.floor > 0) {
			const kind = ctx.endlessFloor(ctx.floor).layout.bossKind;
			if (kind !== undefined) for (const ref of bossContentIds(this.theme.getPack(), kind)) refs.push(ref);
		}
		this.assetCount = refs.size();
		this.assetsStartedAt = os.clock();
		if (refs.size() === 0) {
			this.assetsLogged = true; // nothing to wait for: no line
			load.assetsDone();
			return;
		}
		this.preload.whenLoaded(
			refs,
			() => {
				if (this.load !== load) return;
				this.assetsReadyIn = os.clock() - this.assetsStartedAt;
				load.assetsDone();
			},
			`stage floor ${ctx.floor}`,
		);
	}

	/** Pushes the frame's opacity (binding), the label / bar (on a change), the reveal (once). */
	private publish(load: StageLoad): void {
		this.opacity[1](load.coverOpacity(this.reducedMotion()));
		const label = load.label();
		const fraction = load.fraction();
		if (label.key !== this.lastLabelKey || label.vars.floor !== this.lastFloor || fraction !== this.lastFraction) {
			this.lastLabelKey = label.key;
			this.lastFloor = label.vars.floor;
			this.lastFraction = fraction;
			clientStore.setStageProgress(label.key, label.vars.floor, fraction);
		}
		if (!this.assetsLogged && load.assetWait() !== "pending" && load.assetWait() !== "skipped") {
			this.assetsLogged = true;
			const where = `floor ${load.floor()}`;
			if (load.assetWait() === "ready") {
				const t = this.assetsReadyIn >= 0 ? this.assetsReadyIn : 0;
				print(`${LOG} ${where}: assets ready in ${seconds(t)} s (${this.assetCount} ids)`);
			} else {
				print(`${LOG} ${where}: asset wait capped at ${seconds(os.clock() - this.assetsStartedAt)} s`);
			}
		}
		const phase = load.phase();
		if ((phase === "revealing" || phase === "done") && this.revealedSerial !== this.serial) {
			this.revealedSerial = this.serial;
			clientStore.setStageRevealing();
			this.logReveal(load);
		}
	}

	private logReveal(load: StageLoad): void {
		const at = seconds(load.elapsedSec());
		const capped = load.capped() ? " (cover cap reached)" : "";
		const built = ms(this.buildSec);
		if (load.kind === "floorChange") {
			print(`${LOG} floor ${load.floor()}: built in ${built} ms, revealed at ${at} s${capped}`);
			return;
		}
		const run = this.sim.getContext()?.counter ?? this.runCounter;
		const forged = load.kind === "runStart" ? `forged in ${ms(this.forgeSec)} ms, ` : "";
		print(`${LOG} run ${run}: ${forged}built in ${built} ms, revealed at ${at} s${capped}`);
	}

	private finish(load: StageLoad): void {
		if (this.load !== load) return;
		this.load = undefined;
		this.work = undefined;
		this.pendingAck = -1;
		this.hideCover();
	}

	// --- pre-generation --------------------------------------------------------------------------

	/** The run's tracker (a new one per run: RunContext.counter). */
	private trackerFor(ctx: RunContext): PregenTracker {
		let tracker = this.tracker;
		if (tracker === undefined || this.trackerRun !== ctx.counter) {
			tracker = new PregenTracker(ctx.tutorial ? TUTORIAL.lastFloor : undefined);
			this.tracker = tracker;
			this.trackerRun = ctx.counter;
			this.runCounter = ctx.counter;
		}
		return tracker;
	}

	/** Every frame without covered work: floor n + 1 during floor n's draft (shared/view pregenTarget). */
	private pregenFrame(phase: StagePhase | undefined): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined || ctx.endlessFloor === undefined || ctx.floor <= 0) return;
		const me = ctx.run.state.run?.players[ctx.localIndex];
		const draftOpen = me !== undefined && me.draftOpen !== 0;
		const tracker = this.trackerFor(ctx);
		const target = tracker.frame(ctx.floor, draftOpen, phase);
		if (target !== undefined) this.pregenerate(ctx, tracker, target, `during floor ${ctx.floor}'s draft`);
	}

	/** Builds `floor` through the run's own cached floor builder (the sim then finds it in the cache). */
	private pregenerate(ctx: RunContext, tracker: PregenTracker, floor: number, why: string): void {
		const build = ctx.endlessFloor;
		if (build === undefined) return;
		tracker.markBuilt(floor); // once, even if it fails (the sim then builds it mid-tick, as before)
		const t0 = os.clock();
		const [ok, err] = pcall(() => build(floor));
		if (!ok) {
			warn(`${LOG} floor ${floor} could not be pre-generated: ${tostring(err)}`);
			return;
		}
		print(`${LOG} floor ${floor} pre-generated in ${ms(os.clock() - t0)} ms (${why})`);
	}

	private reducedMotion(): boolean {
		return selectJuice(clientStore.getState()).reducedMotion;
	}
}
