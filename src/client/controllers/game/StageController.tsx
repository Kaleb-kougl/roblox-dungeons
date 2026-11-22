import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import React, { createBinding } from "@rbxts/react";
import { ReflexProvider } from "@rbxts/react-reflex";
import { createPortal, createRoot } from "@rbxts/react-roblox";
import { GuiService, Players, RunService, Workspace } from "@rbxts/services";
import { logInfo, logWarn } from "client/log";
import {
	clientStore,
	selectBaselineRun,
	selectDailyStatus,
	selectJuice,
	selectMenuScreen,
	selectMyLobbyId,
	selectRunBaseline,
	selectSelectedCharacter,
	selectWallet,
	type StageAssetsLine,
} from "client/store";
import { LocaleRoot, StageCard } from "client/ui";
import { TUTORIAL } from "shared/config";
import { ENDLESS_FIRST_FLOOR, endlessRoster, floorModifierKey } from "shared/dungeon";
import { RUN_ATTRIBUTES } from "shared/play";
import { dailyDay } from "shared/daily";
import {
	forecastDailyFirstFloor,
	forecastFirstFloor,
	forecastStageInput,
	rosterUnlockFloors,
	stageInputOf,
} from "shared/run";
import { BIOMES, type ContentRef } from "shared/theme";
import { floorTarget, stageBestLine, stageCardLine, stageRosterLine, type NewBestLineText } from "shared/view/hud";
import { floorModifierStingId } from "shared/view/audio";
import { cosmeticLookOf, equippedMapOf, type CosmeticLook } from "shared/cosmetics";
import { stageDyeSets } from "shared/view/cosmetics";
import { todaysDailySeed } from "shared/view/menu";
import {
	PRELOAD_BIOME_PREFIX,
	PregenTracker,
	STAGE_AUDIT,
	STAGE_CHARACTERS,
	stageCharacters,
	STAGE_LOADER,
	StageAuditLog,
	StageLoad,
	stageAssets,
	stageContentRefs,
	stageIsLogicalId,
	stageMergedAssets,
	stageMerge,
	modifierBannerLook,
	modifierCardHoldSec,
	modifierCardRows,
	type StageAssetInput,
	type StageAssetSet,
	type StageKind,
	type StagePhase,
	type StageWorkItem,
} from "shared/view";
import { AudioController } from "../audio/AudioController";
import { PreloadController, type LoadHandle } from "./PreloadController";
import { SimController, floorModifierOf, type RunContext, type StageDriver, type StageWork } from "./SimController";
import { ThemeController } from "./ThemeController";

/** docs/COSMETICS.md CS5: `input` with the dyes the run's players wear (their sets' dye sheets join the manifest). */
function withDyes(input: StageAssetInput, looks: ReadonlyArray<CosmeticLook> | undefined): StageAssetInput {
	const dyed = stageDyeSets(looks);
	return dyed.size() > 0 ? { ...input, dyed } : input;
}

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
 *   assets     (docs/STAGE_ASSETS.md SA5 / SA19) after the listeners: the floor's stage manifest, shared/view
 *              stageAssets(pack, shared/run stageInputOf(ctx, floor, stageCharacters(ctx.characters), run start)) through
 *              stageContentRefs: `must` to the FRONT lane in manifest order (PreloadController.whenLoaded), `soon` to
 *              `next`. AudioController's and the boss push's own requests are untouched. Only a solo run start waits
 *              (StageLoad.waitsForAssets): at most STAGE_ASSETS.wait.softWaitSec, then the reveal with stand-ins for
 *              whatever is missing (revision 2: renderers draw the placeholder until an id's art lands); the cover's
 *              "Loading {done} / {total}" line (the join screen's `loading.progress`) shows once the wait has run
 *              showProgressAfterSec with something missing. Floor changes and co-op covers never wait (SAD4 / SAD8):
 *              the manifest still goes to the front lane, only the log reads it. Without stand-ins
 *              (`wait.standIns` false) StageLoad waits to hardCapSec; no Skip button is drawn (not built).
 *   prefetch   (SA7) at every reveal, floor n + 1's manifest to the NEXT lane: exact when that floor was already
 *              built (a run start pre-generates it; the tutorial builds every floor), else shared/run
 *              forecastStageInput (no generation); once per run and floor, never past the tutorial's last floor.
 *              On the menu (once the join screen released) and on joining a lobby: the first-floor guess,
 *              forecastFirstFloor for biome 1 then biomes 2..5 (floor 1's biome is the seed's auto theme, any of
 *              the five), merged in that order (stageMergedAssets), all on `next`; computed once per session. Once
 *              today's Daily seed is known (the daily slice, todaysDailySeed) the Daily's own first floor
 *              (forecastDailyFirstFloor: its roster, biome and music, decided by the seed) goes to the HEAD of `next`
 *              ahead of that guess (PreloadController.request `first`), once per visit key and seed, again when the
 *              day's seed changes.
 *   audit      (SA11) Workspace `KV_StageAssetAudit` (RUN_ATTRIBUTES.stageAssetAudit, read at each cut): from the cut
 *              every logical id the views resolve through the pack is recorded (ThemeController.setAuditRecorder,
 *              shared/view StageAuditLog); at the next cut, the run's end (run over) or an exit it is diffed against
 *              the floor's manifest and each miss printed `[StageAudit] floor N used <id>, not in its manifest`.
 *   pregen     shared/view PregenTracker per run (lastFloor: TUTORIAL.lastFloor in a tutorial run): at a solo run start
 *              under the cover (`pregen` work), and every frame outside covered work and the fade, floor n + 1 once
 *              the local player's draft on floor n has been open a rendered frame (solo and co-op, SD1). A floor
 *              reached without it was built mid-tick by the sim, as before (logged). Co-op starts pre-generate
 *              nothing under their cover (it would hold the cover while the party plays): floor 2 is built mid-tick.
 *   lines      the cover's second line (shared/view/hud stageCardLine, docs/DAILY.md DS2 / DSD13): on a floor card the
 *              seeded roster's `New: Imp` (stageRosterLine from the floor layout's roster and endlessRoster of the
 *              floor before) or new best's line, NEW DEEPEST first; under a run start's bar floor 1's roster (`Swarmer ·
 *              Bruiser`), set once the run is built (after the forge, or the listeners for a co-op start), and the
 *              cover then shows at least STAGE_LOADER.rosterStartSec (StageLoad.holdAtLeast) so it can be read.
 *   banner     (docs/FLOOR_MODIFIERS.md FM5) on a floor whose layout has a modifier (floorModifierOf: the run's cached
 *              floor, EndlessFloorLayout.modifier) the card shows its banner, the name and line rows after the boss row
 *              (the slice's `modifier`), and the cover holds at least shared/view modifierCardHoldSec
 *              (FLOOR_MODIFIER_VIEW.modifierCardSec, none with a live world). The stamp is two bindings stepped here
 *              every frame (modifierBannerLook from the banner's start, its transparency times the cover's fade, its
 *              scale through StageCard's UIScale: no re-render per frame); the kind's sting (shared/view/audio
 *              floorModifierStingId, AudioController.play) once, on the first frame the banner shows. A run start past
 *              floor 1 (a dev run) sets the banner under its bar once the run is built, like the roster line, and holds
 *              it modifierCardHoldSec from then.
 *   cancel     SimController.stopRun (Leave run, exit) cancels: the cover goes, pending work is dropped. A restart, a
 *              new run or a party start replaces the load (stageMerge "new").
 *
 * Log lines start with `[Stage]`: `run N: forged in t ms, built in t ms, revealed at t s`, `floor N: built in t ms,
 * revealed at t s`, `floor X pre-generated in T ms (run start | during floor N's draft)`, `floor N: built mid-tick (not
 * pre-generated)`, `floor N: modifier <key>` (a modifier floor's card or run-start banner), `floor N: M ids, ready in
 * T s` / `floor N: M ids, K of C content ids missing at reveal (<ids>)` (and
 * `floor N: ready in T s, after the reveal` once they land), `prefetch floor N (k ids, next lane)`, and failures (warn).
 */
@Controller({ loadOrder: 2 })
export class StageController implements OnStart, StageDriver {
	private readonly janitor = new Janitor();
	private readonly opacity = createBinding(0);
	private readonly visible = createBinding(false);
	private readonly shownSerial = createBinding(0);
	/** The modifier banner's text transparency (the stamp times the cover's fade) and its UIScale (FM5). */
	private readonly bannerTransparency = createBinding(1);
	private readonly bannerScale = createBinding(1);
	/** The banner on the cover (a FloorModifier id), undefined: none. */
	private bannerKind: number | undefined;
	/** os.clock() when the banner went on the cover (its stamp's clock). */
	private bannerStart = 0;
	/** The banner's sting was played (once per banner). */
	private bannerStung = false;
	/** The load serial whose run-start banner was set (once per load). */
	private modifierSerial = -1;
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
	/** The current floor's manifest wait (one per load; its listener checks the serial). */
	private assetHandle: LoadHandle | undefined;
	private assetSet: StageAssetSet | undefined;
	private assetSerial = -1;
	private assetsStartedAt = 0;
	private assetsReadyIn = -1;
	/** The reveal was logged with ids missing: the late "ready" line is due. */
	private assetsLateLog = false;
	private lastAssetsLine: StageAssetsLine | undefined;
	/** `<run counter>:<floor>` of the last floor n + 1 prefetch. */
	private prefetchKey = "";
	/** The menu / lobby key of the last first-floor prefetch ("menu" or the lobby id). */
	private menuPrefetchKey = "";
	private menuPrefetchRefs: ReadonlyArray<ContentRef> | undefined;
	/** The menu visit key and today's Daily seed the Daily's first floor was last queued for ("" = never). */
	private dailyPrefetchKey = "";
	/** The Daily's first-floor refs, built once per seed. */
	private dailyPrefetchRefs: { readonly seed: number; readonly refs: ReadonlyArray<ContentRef> } | undefined;
	private readonly audit = new StageAuditLog();
	private forgeSec = 0;
	private buildSec = 0;
	private runCounter = 0;
	/** The load serial whose run-start roster line was set (once per load). */
	private rosterSerial = -1;

	constructor(
		private readonly sim: SimController,
		private readonly preload: PreloadController,
		private readonly theme: ThemeController,
		private readonly audio: AudioController,
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
		const [bannerTransparency] = this.bannerTransparency;
		const [bannerScale] = this.bannerScale;
		root.render(
			createPortal(
				<ReflexProvider producer={clientStore}>
					<LocaleRoot>
						<StageCard
							visible={visible}
							opacity={opacity}
							serial={serial}
							bannerTransparency={bannerTransparency}
							bannerScale={bannerScale}
							onCovered={(s) => this.onCovered(s)}
							onGui={(gui) => (this.gui = gui)}
						/>
					</LocaleRoot>
				</ReflexProvider>,
				playerGui,
			),
		);
		RunService.BindToRenderStep(RENDER_END_STEP, Enum.RenderPriority.Last.Value, () => (this.inRender = false));
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_END_STEP), true);
		this.sim.setStageDriver(this);
		this.preload.whenReleased(() => this.watchMenu());
		this.janitor.Add(() => this.endAudit(), true);
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
			if (this.audit.isOpen()) this.audit.begin(work.floor); // the answer names the floor; nothing drawn yet
			current.serverAnswered(work.floor);
			this.publish(current);
			return;
		}
		this.begin(kind, work, false);
	}

	cancel(): void {
		this.endAudit(); // Leave run / exit: the floor's audit ends here
		this.assetHandle?.cancel(); // the left run's wait: no stale "ready after the reveal" line (its ids stay queued)
		this.assetHandle = undefined;
		this.assetSet = undefined;
		this.assetSerial = -1;
		this.assetsLateLog = false;
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
			const handle = this.assetHandle;
			if (this.load === load && handle !== undefined && load.phase() === "assets") {
				const [done, total] = handle.progress();
				load.setAssetProgress(done, total);
			}
		}
		if (this.audit.isOpen() && this.sim.isRunOver()) this.endAudit(); // run over: the last floor's audit
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
		this.assetHandle?.cancel(); // the previous floor's wait (its ids stay queued)
		this.assetHandle = undefined;
		this.assetSet = undefined;
		this.assetSerial = -1;
		this.assetsReadyIn = -1;
		this.assetsLateLog = false;
		this.lastAssetsLine = undefined;
		this.endAudit();
		this.beginAudit(load.floor());
		this.forgeSec = 0;
		this.buildSec = 0;
		this.lastLabelKey = "";
		this.lastFloor = -1;
		this.lastFraction = -1;
		const label = load.label();
		let biomeKey = "";
		let boss = false;
		let line: NewBestLineText | undefined;
		let modifier: number | undefined;
		this.setBanner(undefined);
		if (kind === "floorChange" && ctx !== undefined) {
			biomeKey = clientStore.getState().game.run.placeKey;
			boss = ctx.endlessFloor !== undefined && ctx.floor > 0 && ctx.endlessFloor(ctx.floor).bossFloor;
			const floor = work?.floor ?? ctx.floor;
			line = stageCardLine(this.bestLine(ctx, floor), this.rosterLine(ctx, floor));
			modifier = this.bannerOf(ctx, floor);
			if (modifier !== undefined) {
				const hold = modifierCardHoldSec(modifier, worldLive);
				if (hold > 0) load.holdAtLeast(hold);
				this.setBanner(modifier);
			}
			const tracker = this.trackerFor(ctx);
			if (ctx.floor > ENDLESS_FIRST_FLOOR && !tracker.wasBuilt(ctx.floor)) {
				logInfo(`${LOG} floor ${ctx.floor}: built mid-tick (not pre-generated)`);
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
			line,
			fraction: load.fraction(),
			modifier,
		});
	}

	/**
	 * Floor `floor`'s modifier when it has a banner (shared/view modifierCardRows: a known kind), else undefined. Logs
	 * `[Stage] floor N: modifier <key>`.
	 */
	private bannerOf(ctx: RunContext, floor: number): number | undefined {
		const kind = floorModifierOf(ctx, floor);
		if (modifierCardRows(kind) === undefined) return undefined;
		logInfo(`${LOG} floor ${floor}: modifier ${floorModifierKey(kind) ?? kind}`);
		return kind;
	}

	/** The banner on the cover from now (its stamp starts over), or none. */
	private setBanner(kind: number | undefined): void {
		this.bannerKind = kind;
		this.bannerStart = os.clock();
		this.bannerStung = false;
		this.bannerTransparency[1](1);
		this.bannerScale[1](1);
	}

	/**
	 * A run start's banner (docs/FLOOR_MODIFIERS.md FM5: a dev run starting past floor 1 on a modifier floor), once the
	 * run is built, like runStartRoster; the cover then holds the banner modifierCardHoldSec from now. Once per load.
	 */
	private runStartModifier(load: StageLoad): void {
		if (load.kind === "floorChange" || this.modifierSerial === this.serial) return;
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		this.modifierSerial = this.serial;
		const kind = this.bannerOf(ctx, ctx.floor);
		if (kind === undefined) return;
		this.setBanner(kind);
		clientStore.setStageModifier(kind);
		// A solo start holds the sim under its cover (frozen); a co-op start's world plays on (no hold).
		const hold = modifierCardHoldSec(kind, load.kind === "coopStart");
		if (hold > 0) load.holdAtLeast(load.coverSeconds() + hold);
	}

	/** The banner's stamp this frame (bindings) and its sting on the first frame it shows. */
	private stepBanner(load: StageLoad): void {
		const kind = this.bannerKind;
		if (kind === undefined) return;
		const reduced = this.reducedMotion();
		const look = modifierBannerLook(os.clock() - this.bannerStart, reduced);
		const opacity = load.coverOpacity(reduced);
		this.bannerTransparency[1](look.visible ? 1 - opacity * (1 - look.transparency) : 1);
		this.bannerScale[1](look.scale);
		if (!look.visible || this.bannerStung) return;
		this.bannerStung = true;
		const sting = floorModifierStingId(kind);
		if (sting !== undefined) this.audio.play(sting, 1);
	}

	/**
	 * The floor card's new-best line for `floor` (docs/NEW_BEST.md NB8): shared/view/hud stageBestLine from this run's
	 * frozen baseline (client/store records slice, NewBestController), undefined without a floor target or before the
	 * run's baseline is stored. Floors come one at a time, so an earlier floor of the run was already past the record
	 * exactly when this one is more than one past it. The deepest fanfare is not played here: the tracker holds its
	 * edge under the cover and fires it on the reveal's first frame (coverLifting).
	 */
	private bestLine(ctx: RunContext, floor: number): NewBestLineText | undefined {
		const store = clientStore.getState();
		if (selectBaselineRun(store) !== ctx.counter) return undefined;
		const baseline = selectRunBaseline(store);
		const record = floorTarget(baseline);
		if (record === undefined) return undefined;
		return stageBestLine(floor, baseline, floor > record + 1);
	}

	/**
	 * The seeded roster's line for `floor` (docs/DAILY.md DS2, shared/view/hud stageRosterLine): floor 1 every kind,
	 * later floors the kinds that joined there (the floor before's roster is endlessRoster(seed, floor - 1) under the
	 * world's rosterUnlockFloors: cheap and pure, no floor build). `runStart`: every kind on any floor (a dev run starting past floor 1, docs/DEV_MODE.md).
	 * Undefined: no endless floor, a floor without a roster (the tutorial) or no kind joined.
	 */
	private rosterLine(ctx: RunContext, floor: number, runStart = false): NewBestLineText | undefined {
		const build = ctx.endlessFloor;
		if (build === undefined || floor < ENDLESS_FIRST_FLOOR) return undefined;
		const roster = build(floor).layout.roster;
		if (roster === undefined) return undefined;
		const previous =
			!runStart && floor > ENDLESS_FIRST_FLOOR
				? endlessRoster(ctx.seed, floor - 1, rosterUnlockFloors(ctx.world))
				: undefined;
		const pack = this.theme.getPack();
		return stageRosterLine(roster, previous, (key, vars) => pack.str(key, vars));
	}

	/**
	 * A run start's roster line under the bar, once the run is built (called after the forge and after the listeners:
	 * the context is the new run's then); the cover then shows at least STAGE_LOADER.rosterStartSec. Once per load.
	 */
	private runStartRoster(load: StageLoad): void {
		if (load.kind === "floorChange" || this.rosterSerial === this.serial) return;
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const line = this.rosterLine(ctx, ctx.floor, true);
		if (line === undefined) return;
		this.rosterSerial = this.serial;
		clientStore.setStageLine(line);
		load.holdAtLeast(STAGE_LOADER.rosterStartSec);
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
		this.setBanner(undefined);
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
				logWarn(`${LOG} the run could not start: ${tostring(err)}`);
				this.cancel();
				return;
			}
			this.forgeSec = os.clock() - t0;
			load.forged();
			this.runStartRoster(load);
			this.runStartModifier(load);
			return;
		}
		if (item === "notify") {
			const [ok, err] = pcall(() => work?.notify());
			if (this.load !== load) return;
			if (!ok) logWarn(`${LOG} a view rebuild failed: ${tostring(err)}`);
			this.buildSec = os.clock() - t0;
			load.built();
			this.runStartRoster(load);
			this.runStartModifier(load);
			const [waitOk, waitErr] = pcall(() => this.waitAssets(load));
			if (!waitOk) {
				logWarn(`${LOG} the assets wait failed: ${tostring(waitErr)}`);
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
	 * After the listeners: the floor's stage manifest to the front lane (`soon` to next) and, on a solo run start, the
	 * soft wait for it (StageLoad's assets phase; see the class comment). Every other cover passes the phase at once.
	 */
	private waitAssets(load: StageLoad): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			load.assetsDone();
			return;
		}
		const pack = this.theme.getPack();
		const input = withDyes(
			stageInputOf(ctx, ctx.floor, stageCharacters(ctx.characters), load.kind !== "floorChange"),
			ctx.looks,
		);
		const set = stageAssets(pack, input);
		this.audit.setManifest(set);
		const refs = stageContentRefs(pack, set);
		const label = `stage floor ${ctx.floor}`;
		if (refs.soon.size() > 0) this.preload.request(refs.soon, "next", label);
		this.assetSet = set;
		if (refs.must.size() === 0) {
			load.assetsDone(); // nothing to download (the placeholder pack): no line
			return;
		}
		const serial = this.serial;
		this.assetSerial = serial;
		this.assetsStartedAt = os.clock();
		this.assetHandle = this.preload.whenLoaded(
			refs.must,
			() => {
				if (this.assetSerial !== serial) return;
				this.assetsReadyIn = os.clock() - this.assetsStartedAt;
				if (this.load === load && load.waitsForAssets()) load.assetsDone();
				if (this.assetsLateLog) {
					this.assetsLateLog = false;
					logInfo(
						`${LOG} floor ${load.floor()}: ready in ${seconds(this.assetsReadyIn)} s, after the reveal`,
					);
				}
			},
			label,
		);
	}

	/** Pushes the frame's opacity (binding), the label / bar (on a change), the reveal (once). */
	private publish(load: StageLoad): void {
		this.opacity[1](load.coverOpacity(this.reducedMotion()));
		this.stepBanner(load);
		const label = load.label();
		const fraction = load.fraction();
		if (label.key !== this.lastLabelKey || label.vars.floor !== this.lastFloor || fraction !== this.lastFraction) {
			this.lastLabelKey = label.key;
			this.lastFloor = label.vars.floor;
			this.lastFraction = fraction;
			clientStore.setStageProgress(label.key, label.vars.floor, fraction);
		}
		const shown = load.showAssetProgress();
		const [done, total] = load.assetProgress();
		const was = this.lastAssetsLine;
		if (shown ? was === undefined || was.done !== done || was.total !== total : was !== undefined) {
			const line = shown ? { done, total } : undefined;
			this.lastAssetsLine = line;
			clientStore.setStageAssets(line);
		}
		const phase = load.phase();
		if ((phase === "revealing" || phase === "done") && this.revealedSerial !== this.serial) {
			this.revealedSerial = this.serial;
			clientStore.setStageRevealing();
			this.logReveal(load);
			this.logAssetsAtReveal(load);
			this.prefetchNext();
		}
	}

	/** `[Stage] floor N: M ids, ready in T s` or `..., K of C content ids missing at reveal (<first ids>)`. */
	private logAssetsAtReveal(load: StageLoad): void {
		const set = this.assetSet;
		const handle = this.assetHandle;
		if (set === undefined || handle === undefined) return;
		const where = `${LOG} floor ${load.floor()}: ${set.must.size()} ids`;
		const [done, total] = handle.progress();
		if (handle.isDone() || done >= total) {
			const t = this.assetsReadyIn >= 0 ? this.assetsReadyIn : os.clock() - this.assetsStartedAt;
			logInfo(`${where}, ready in ${seconds(t)} s`);
			return;
		}
		const missing = new Array<string>();
		let more = 0;
		for (const id of set.must) {
			if (!stageIsLogicalId(id)) continue; // a biome's or a set's dye content: no readiness of its own
			if (this.preload.isArtReady(id)) continue;
			if (missing.size() < STAGE_LOADER.logMissingIds) missing.push(id);
			else more += 1;
		}
		const tail = more > 0 ? ` +${more}` : "";
		const wait = load.assetWait();
		const names = missing.join(", ");
		logInfo(`${where}, ${total - done} of ${total} content ids missing at reveal (${wait}: ${names}${tail})`);
		this.assetsLateLog = true;
	}

	// --- prefetch (docs/STAGE_ASSETS.md SA7) -------------------------------------------------------

	/** At a reveal of floor n: floor n + 1's manifest to the next lane (once per run and floor). */
	private prefetchNext(): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined || ctx.endlessFloor === undefined || ctx.floor <= 0) return;
		const target = ctx.floor + 1;
		if (ctx.tutorial && target > TUTORIAL.lastFloor) return;
		const key = `${ctx.counter}:${target}`;
		if (key === this.prefetchKey) return;
		this.prefetchKey = key;
		const [ok, err] = pcall(() => {
			const built = ctx.tutorial || this.trackerFor(ctx).wasBuilt(target);
			const input: StageAssetInput = withDyes(
				built
					? stageInputOf(ctx, target, stageCharacters(ctx.characters))
					: forecastStageInput(ctx.seed, target, stageCharacters(ctx.characters), ctx.world),
				ctx.looks,
			);
			const pack = this.theme.getPack();
			const set = stageAssets(pack, input);
			const refs = stageContentRefs(pack, set);
			const label = `prefetch floor ${target}`;
			this.preload.request(refs.must, "next", label);
			if (refs.soon.size() > 0) this.preload.request(refs.soon, "next", label);
			const how = built ? "exact" : "forecast";
			logInfo(`${LOG} prefetch floor ${target} (${set.must.size() + set.soon.size()} ids, ${how}, next lane)`);
		});
		if (!ok) logWarn(`${LOG} floor ${target} could not be prefetched: ${tostring(err)}`);
	}

	/** Once the join screen released: the first-floor prefetch on the menu and on joining a lobby. */
	private watchMenu(): void {
		this.janitor.Add(clientStore.subscribe(selectMenuScreen, () => this.menuPrefetch()));
		this.janitor.Add(clientStore.subscribe(selectMyLobbyId, () => this.menuPrefetch()));
		this.janitor.Add(clientStore.subscribe(selectDailyStatus, () => this.menuPrefetch()));
		this.menuPrefetch();
	}

	/**
	 * The menu or a lobby is up (no run): the first floor's guess to the next lane, every biome (biome 1 first), once
	 * per menu visit key ("menu", or the joined lobby's id); the refs are built once per session.
	 */
	private menuPrefetch(): void {
		if (this.sim.getContext() !== undefined) return;
		const state = clientStore.getState();
		if (selectMenuScreen(state) === undefined) return;
		const key = selectMyLobbyId(state) ?? "menu";
		const seed = todaysDailySeed(selectDailyStatus(state), dailyDay(Workspace.GetServerTimeNow()));
		if (key === this.menuPrefetchKey) {
			// The guess is queued for this visit; a Daily seed that arrived (or changed) since still goes first.
			this.dailyPrefetch(key, seed);
			return;
		}
		this.menuPrefetchKey = key;
		const [ok, err] = pcall(() => {
			let refs = this.menuPrefetchRefs;
			let ids = -1;
			if (refs === undefined) {
				const pack = this.theme.getPack();
				const inputs = new Array<StageAssetInput>();
				for (let b = 1; b <= BIOMES.size(); b++) inputs.push(forecastFirstFloor(STAGE_CHARACTERS, b));
				const set = stageMergedAssets(pack, inputs);
				const both = stageContentRefs(pack, set);
				const all = [...both.must];
				for (const r of both.soon) all.push(r);
				refs = all;
				ids = set.must.size() + set.soon.size();
				this.menuPrefetchRefs = refs;
			}
			if (refs.size() === 0) return;
			this.preload.request(refs, "next", `prefetch floor 1 (${key})`);
			if (ids >= 0) logInfo(`${LOG} prefetch floor 1 (${ids} ids, every biome, next lane)`);
		});
		if (!ok) logWarn(`${LOG} the first floor could not be prefetched: ${tostring(err)}`);
		this.dailyPrefetch(key, seed);
		this.dyePrefetch();
	}

	/**
	 * docs/COSMETICS.md CS5: on the menu, the dye sheets of the local player's equipped dye for the picked character to
	 * the next lane (a run that wears it then finds them in; the queue requests each content id once per session).
	 */
	private dyePrefetch(): void {
		const state = clientStore.getState();
		const wallet = selectWallet(state);
		if (wallet === undefined || !wallet.loaded) return;
		const look = cosmeticLookOf(equippedMapOf(wallet.equipped), selectSelectedCharacter(state));
		const pack = this.theme.getPack();
		const refs = new Array<ContentRef>();
		for (const set of stageDyeSets([look])) for (const r of pack.dyeContentIds(set)) refs.push(r);
		if (refs.size() > 0) this.preload.request(refs, "next", "prefetch dye");
	}

	/**
	 * Today's Daily (`seed`, undefined while unknown) on menu visit `key`: its exact first floor to the head of the next
	 * lane, ahead of the every-biome guess, once per key and seed. The refs are built once per seed.
	 */
	private dailyPrefetch(key: string, seed: number | undefined): void {
		if (seed === undefined) return;
		const visit = `${key}:${seed}`;
		if (visit === this.dailyPrefetchKey) return;
		this.dailyPrefetchKey = visit;
		const [ok, err] = pcall(() => {
			let built = this.dailyPrefetchRefs;
			let ids = -1;
			if (built === undefined || built.seed !== seed) {
				const pack = this.theme.getPack();
				const set = stageAssets(pack, forecastDailyFirstFloor(seed, STAGE_CHARACTERS));
				const both = stageContentRefs(pack, set);
				const all = [...both.must];
				for (const r of both.soon) all.push(r);
				built = { seed, refs: all };
				ids = set.must.size() + set.soon.size();
				this.dailyPrefetchRefs = built;
			}
			if (built.refs.size() === 0) return;
			this.preload.request(built.refs, "next", `prefetch daily floor 1 (${key})`, true);
			if (ids >= 0) logInfo(`${LOG} prefetch daily floor 1 (${ids} ids, seed ${seed}, head of the next lane)`);
		});
		if (!ok) logWarn(`${LOG} the Daily's first floor could not be prefetched: ${tostring(err)}`);
	}

	// --- audit (docs/STAGE_ASSETS.md SA11) ---------------------------------------------------------

	/** At a cut: records the floor's lookups while KV_StageAssetAudit is on (read now). */
	private beginAudit(floor: number): void {
		if (Workspace.GetAttribute(RUN_ATTRIBUTES.stageAssetAudit) !== true) return;
		this.audit.begin(floor);
		this.theme.setAuditRecorder((id) => this.audit.record(id));
	}

	/** Closes the open floor's audit (next cut, run over, exit) and prints its misses. */
	private endAudit(): void {
		if (!this.audit.isOpen()) return;
		this.theme.setAuditRecorder(undefined);
		const pack = this.theme.getPack();
		const result = this.audit.close((id) =>
			id.sub(1, PRELOAD_BIOME_PREFIX.size()) === PRELOAD_BIOME_PREFIX
				? pack.biomeContentIds(id.sub(PRELOAD_BIOME_PREFIX.size() + 1)).size() > 0
				: pack.contentIds(id).size() > 0,
		);
		if (result === undefined) return;
		const where = `[StageAudit] floor ${result.floor}`;
		const misses = result.misses;
		if (misses.size() === 0) {
			logInfo(`${where}: ${result.used} ids used, all in its manifest (${result.listed} ids)`);
			return;
		}
		const shown = math.min(misses.size(), STAGE_AUDIT.maxMissLines);
		for (let i = 0; i < shown; i++) logInfo(`${where} used ${misses[i]}, not in its manifest`);
		if (misses.size() > shown) logInfo(`${where}: ${misses.size() - shown} more not in its manifest`);
	}

	private logReveal(load: StageLoad): void {
		const at = seconds(load.elapsedSec());
		const capped = load.capped() ? " (cover cap reached)" : "";
		const built = ms(this.buildSec);
		if (load.kind === "floorChange") {
			logInfo(`${LOG} floor ${load.floor()}: built in ${built} ms, revealed at ${at} s${capped}`);
			return;
		}
		const run = this.sim.getContext()?.counter ?? this.runCounter;
		const forged = load.kind === "runStart" ? `forged in ${ms(this.forgeSec)} ms, ` : "";
		logInfo(`${LOG} run ${run}: ${forged}built in ${built} ms, revealed at ${at} s${capped}`);
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
			logWarn(`${LOG} floor ${floor} could not be pre-generated: ${tostring(err)}`);
			return;
		}
		logInfo(`${LOG} floor ${floor} pre-generated in ${ms(os.clock() - t0)} ms (${why})`);
	}

	private reducedMotion(): boolean {
		return selectJuice(clientStore.getState()).reducedMotion;
	}
}
