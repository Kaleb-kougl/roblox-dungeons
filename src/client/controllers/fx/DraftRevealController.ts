import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import { clientStore, selectTutorialEnded } from "client/store";
import { DRAFT_SLOT_Z_RAISED, DRAFT_SLOT_Z_REST, DRAFT_UI, resetDraftUi } from "client/ui";
import { draftConfirmHeld, draftNeverRevealed } from "shared/play";
import { isPortrait } from "shared/view";
import { DRAFT_MIN_OPEN_TICKS, DRAFT_OFFER_COUNT, PactKind, pactDraftKind } from "shared/sim";
import { GreedDealGap, draftTitleKey } from "shared/view/pacts";
import { getActiveThemePack } from "shared/theme";
import type { JuiceSettings } from "shared/settings";
import {
	DRAFT_REVEAL_VIEW,
	DraftBeat,
	DraftReveal,
	characterDraftCard,
	draftCardKinds,
	draftCardLook,
	draftCardModel,
	draftRedealt,
	rarityTone,
	type DraftBeatId,
	type DraftTone,
	draftOverlayLook,
	draftSlotOffset,
	newDraftCardLook,
	parseDraftRevealDebug,
} from "shared/view/hud";
import { AudioController } from "../audio/AudioController";
import { InputController } from "../game/InputController";
import { SimController, type DraftRevealDriver, type RunContext } from "../game/SimController";
import { StageController } from "../game/StageController";
import { FxTrackerController } from "./FxTrackerController";

const HALF = 0.5;
const NONE = -1;

/** The local player's draft as the reveal reads it (shared/sim RunPlayerState's draft fields). */
interface LocalDraft {
	readonly draftOpen: number;
	readonly draftTicks: number;
	readonly draftSelected: number;
	readonly draftOffers: ReadonlyArray<number>;
}

function localDraft(ctx: RunContext): LocalDraft | undefined {
	return ctx.run.state.run?.players[ctx.localIndex];
}

/**
 * The boon draft reveal's driver (docs/DRAFT_REVEAL.md DR6). Once per rendered frame (an FxTrackerController frame
 * handler, after the frame's sim ticks) it reads the LOCAL player's draft (`run.state.run.players[localIndex]`) and:
 *   - begin: on the first frame the draft is open and the stage cover is fading or gone (StageController
 *     coverLifting), one shared/view/hud DraftReveal over every offer, each card read once for the local player
 *     (docs/BUILDS.md BU9: draftCardKinds / draftCardModel, written to DRAFT_UI with its beat, tone and the re-deal's
 *     "Pick again" flag, draftRedealt): an evolution or a duo plays the legendary beat, any other card its rarity's;
 *     while the KV_DraftRevealDebug Workspace string attribute parses (DRAFT_REVEAL_VIEW.debugAttribute, off by
 *     default; display only: the faces stay the real cards) its beats replace those of the first cards (with the
 *     rarity colours), the rest keep their own
 *     (every real offer always shows: the stick can select and confirm each one); reduced motion from the juice
 *     settings. Never for a draft that is never revealed (shared/play draftNeverRevealed: the tutorial ended, or a
 *     tutorial floor past TUTORIAL.lastFloor: the finished tutorial's floor 3 draft opens a frame before the tutorial
 *     marks itself ended);
 *   - pick: the frame the draft closes, the local "boon" run event of that frame names the card taken (its offer
 *     index in this controller's copy of the offers): the stamp and the exit fade; a draft closed without a pick
 *     (a player who left) drops the reveal;
 *   - skip: SimController's DraftRevealGate (both input paths, after the cover gate) masks the confirm while
 *     `blocksConfirm()` (shared/play draftConfirmHeld: the reveal plays, or the local draft is open and its reveal has
 *     not begun yet: the frame the cover ends under reduced motion runs SimController's input before this frame
 *     handler begins the reveal) and calls `skip()` on a press edge then (a no-op before the begin: the press stays
 *     held until released); a touch tap during the reveal is a skip too (InputController's draft tap filter: its pick
 *     is dropped, as is a tap while leaving or before the reveal began);
 *   - step: on every unpaused frame (a solo pause or the frozen tutorial freezes it) with the real frame dt; its
 *     cues go through AudioController.playCue (no min interval: the reveal spaces its own cues, and every one due in
 *     a long frame plays), its `duck` to duckFor;
 *   - draw: writes DRAFT_UI (client/ui/hud draftUi.ts) from draftOverlayLook / draftCardLook, each value only on
 *     change; the selection only once settled (the card under the stick, or the one taken while leaving); the hint's
 *     keys once settled and the sim's draftReady; each slot's ray position (draftSlotOffsetX) and its z (raised while
 *     its card is drawn larger than the slot).
 * Pacts (docs/FORTUNE.md FO7): Greed's Legendary deal opens mid-floor; its begin waits PACTS_VIEW.greed.dealDelaySec of
 * unpaused real time after the draft opened (shared/view/pacts GreedDealGap: the take's pulse and toast first, the
 * confirm held meanwhile like any open draft whose reveal has not begun), and the title reads `hud.draft.title.greed`
 * (DRAFT_UI.titleKey from shared/sim pactDraftKind, written at the begin).
 * Cleared on run start / exit (and a new run counter), a floor change without a local draft, and the tutorial's end.
 * Registers with SimController (setDraftRevealDriver) and InputController (setDraftTapFilter), so neither injects
 * this (no Flamework cycle). Presentation and client input only: nothing here writes the sim.
 */
@Controller({})
export class DraftRevealController implements OnStart, DraftRevealDriver {
	private readonly janitor = new Janitor();
	private readonly reveal = new DraftReveal();
	private readonly look = newDraftCardLook();
	/** Greed's 0.5 s before its deal (docs/FORTUNE.md FO7). */
	private readonly greedGap = new GreedDealGap();
	/** The local draft's offers at begin (the overlay's content through the pick's exit fade). */
	private offers: number[] = [];
	/** Cards shown (the offers, or KV_DraftRevealDebug's count). */
	private count = 0;
	/** A reveal was begun for the draft open now (on `floor`). */
	private begun = false;
	private floor = NONE;
	private wasOpen = false;
	/** The offer index taken (leaving), or -1. */
	private chosen = NONE;
	/** The local draft's draftTicks seen last frame (a drop while open is a builds re-deal). */
	private lastDraftTicks = 0;
	/** RunContext.counter of the run the reveal belongs to. */
	private runCounter = NONE;
	/** DRAFT_UI shows something (reset once when it stops). */
	private drawn = false;
	private debugBeats: DraftBeatId[] | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly stage: StageController,
		private readonly audio: AudioController,
		private readonly input: InputController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		this.sim.setDraftRevealDriver(this);
		this.input.setDraftTapFilter(() => this.takeTap());
		this.sim.onRunStarted(() => this.off());
		this.sim.onRunExited(() => this.off());
		this.sim.onFloorChanged((ctx) => {
			if (localDraft(ctx)?.draftOpen === 0) this.off();
		});
		this.fx.onFrame((_, settings, dt) => this.frame(settings, dt));
		this.readDebug();
		this.janitor.Add(
			Workspace.GetAttributeChangedSignal(DRAFT_REVEAL_VIEW.debugAttribute).Connect(() => this.readDebug()),
		);
	}

	// --- DraftRevealDriver (SimController's confirm gate) ---------------------------------------

	blocksConfirm(): boolean {
		const f = this.reveal.frame;
		const revealing = f.active && !f.settled;
		const ctx = this.sim.getContext();
		if (ctx === undefined) return revealing;
		return draftConfirmHeld({
			draftOpen: localDraft(ctx)?.draftOpen === 1,
			revealBegun: this.begun && this.floor === ctx.floor,
			revealing,
			neverRevealed: this.neverRevealed(ctx),
		});
	}

	skip(): void {
		this.reveal.skip();
	}

	// --- the frame ---------------------------------------------------------------------------------

	private frame(settings: Readonly<JuiceSettings>, dt: number): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			this.off();
			return;
		}
		if (ctx.counter !== this.runCounter) {
			this.off();
			this.runCounter = ctx.counter;
		}
		const me = localDraft(ctx);
		const open = me !== undefined && me.draftOpen !== 0;
		const fr = this.reveal.frame;
		const never = this.neverRevealed(ctx);
		if (never && (fr.active || this.begun)) this.off();

		// Builds' boss double draft (docs/BUILDS.md BUD4): a pick that re-deals keeps the draft open with new offers and
		// its timer back at 0; deal the new cards at once (the cover is long gone), so the confirm gate never waits on a
		// reveal that would not begin. A timer drop alone can be missed (a co-op catch-up frame may step past the re-deal
		// by more ticks than the old timer held), so a change of the offers counts too: the faces always show the cards
		// the sim will grant.
		if (
			open &&
			me !== undefined &&
			this.begun &&
			!never &&
			(me.draftTicks < this.lastDraftTicks || this.offersChanged(me))
		) {
			this.begin(ctx, me, settings.reducedMotion);
		}
		this.lastDraftTicks = open && me !== undefined ? me.draftTicks : 0;

		// The pick: the draft closed this frame; its "boon" run event names the card.
		if (this.wasOpen && !open && this.begun && fr.active && !fr.leaving) {
			const chosen = this.chosenOffer(ctx);
			if (chosen >= 0) {
				this.chosen = chosen;
				this.reveal.pick(chosen);
			} else {
				this.off();
			}
		}
		if (!open || (this.begun && ctx.floor !== this.floor)) this.begun = false;
		const paused = ctx.live?.isPaused() === true || this.sim.isFrozen();
		const greed = pactDraftKind(ctx.run.state, ctx.localIndex) === PactKind.GREED;
		const gapDone = this.greedGap.step(open, greed, paused ? 0 : dt);
		if (open && me !== undefined && !this.begun && !never && gapDone && this.stage.coverLifting()) {
			this.begin(ctx, me, settings.reducedMotion);
		}
		this.wasOpen = open;

		if (!paused) {
			const out = this.reveal.step(dt);
			for (const c of out.cues) this.audio.playCue(c.id, c.volume, c.speed);
			if (out.duck > 0) this.audio.duckFor(out.duck);
		}
		this.draw(open ? me : undefined);
	}

	/** True when the open draft's offers are not the cards this reveal dealt (a re-deal). No allocation. */
	private offersChanged(me: LocalDraft): boolean {
		const offers = me.draftOffers;
		if (offers.size() !== this.offers.size()) return true;
		for (let i = 0; i < offers.size(); i++) if (offers[i] !== this.offers[i]) return true;
		return false;
	}

	private begin(ctx: RunContext, me: LocalDraft, reducedMotion: boolean): void {
		const offers: number[] = [];
		for (const b of me.draftOffers) offers.push(b);
		// Every real offer shows; KV_DraftRevealDebug only overrides the first cards' beats (display only).
		const debug = this.debugBeats;
		this.offers = offers;
		this.count = math.min(offers.size(), DRAFT_OFFER_COUNT);
		// docs/BUILDS.md BU9: each card's kind for the local player now (the deal), before the pick raises a level.
		const kinds = draftCardKinds(ctx.run.state, ctx.localIndex, offers);
		// docs/BUILDS_V2.md BV8: the local build at the deal, for the New cards' duo hints (none without builds).
		const build = ctx.run.state.builds?.players[ctx.localIndex];
		// docs/ARCHER.md AR10: the cards' texts read the local player's character's overrides (characterDraftCard).
		const character = this.sim.getPlayerCharacter(ctx.localIndex);
		const pack = getActiveThemePack();
		const has = (key: string) => pack?.hasString(key) === true;
		const beats: DraftBeatId[] = [];
		const tones: DraftTone[] = [];
		for (let i = 0; i < this.count; i++) {
			const dealt = draftCardModel(offers[i], kinds[i], build?.levels, build?.duos);
			const model = dealt !== undefined ? characterDraftCard(dealt, character, has) : undefined;
			const override = debug !== undefined && i < debug.size() ? debug[i] : undefined;
			beats.push(override ?? model?.beat ?? DraftBeat.COMMON);
			tones.push(override !== undefined ? rarityTone(override) : model?.tone ?? "common");
			DRAFT_UI.cards[i].model.write(model);
		}
		this.begun = true;
		this.floor = ctx.floor;
		this.chosen = NONE;
		this.reveal.begin(beats, reducedMotion);
		DRAFT_UI.again.write(draftRedealt(ctx.run.state, ctx.localIndex));
		DRAFT_UI.titleKey.write(draftTitleKey(pactDraftKind(ctx.run.state, ctx.localIndex)));
		for (let i = 0; i < DRAFT_OFFER_COUNT; i++) {
			const ui = DRAFT_UI.cards[i];
			if (i >= this.count) ui.model.write(undefined);
			ui.beat.write(i < this.count ? beats[i] : DraftBeat.COMMON);
			ui.tone.write(i < this.count ? tones[i] : "common");
		}
	}

	/** The offer index of this frame's local "boon" run event (the card taken), or -1. */
	private chosenOffer(ctx: RunContext): number {
		for (const e of ctx.run.runEvents) {
			if (e.kind === "boon") return this.offers.indexOf(e.index);
		}
		return NONE;
	}

	/**
	 * A draft card tap (InputController's filter; touch): during the reveal it skips (and the pick is dropped); while
	 * leaving, or while the draft is open but its reveal has not begun (under the stage cover), it is dropped.
	 */
	private takeTap(): boolean {
		const f = this.reveal.frame;
		if (f.active && !f.settled) {
			this.reveal.skip();
			return true;
		}
		if (f.leaving) return true;
		return this.blocksConfirm();
	}

	/** This run's open draft is never revealed (shared/play draftNeverRevealed). */
	private neverRevealed(ctx: RunContext): boolean {
		return draftNeverRevealed(ctx.tutorial, ctx.floor, selectTutorialEnded(clientStore.getState()));
	}

	// --- DRAFT_UI ----------------------------------------------------------------------------------

	private draw(me: LocalDraft | undefined): void {
		const fr = this.reveal.frame;
		const ov = draftOverlayLook(fr);
		const U = DRAFT_UI;
		if (!ov.visible) {
			if (this.drawn) {
				this.drawn = false;
				resetDraftUi();
			}
			return;
		}
		this.drawn = true;
		U.visible.write(true);
		U.panelT.write(1 - ov.panelAlpha);
		U.titleT.write(1 - ov.titleAlpha);
		U.hintT.write(1 - ov.hintAlpha);
		const ready = me !== undefined && me.draftTicks + 1 >= DRAFT_MIN_OPEN_TICKS;
		U.hintReady.write(fr.leaving || (fr.settled && ready));
		const selected = !fr.settled ? NONE : fr.leaving ? this.chosen : me !== undefined ? me.draftSelected : NONE;
		// Upright the cards stack in a column (docs/PORTRAIT.md PT7; DraftOverlay reads the same viewport rule).
		const vp = Workspace.CurrentCamera?.ViewportSize;
		const column = vp !== undefined && isPortrait(vp.X, vp.Y);
		for (let i = 0; i < DRAFT_OFFER_COUNT; i++) {
			const ui = U.cards[i];
			const look = draftCardLook(fr.cards[i], fr.overlayAlpha, i === selected, this.look);
			ui.shown.write(look.shown);
			if (!look.shown) continue;
			ui.position.write(new UDim2(HALF, look.offsetX, HALF, look.offsetY));
			ui.size.write(UDim2.fromScale(look.width, 1));
			ui.scale.write(look.scale);
			ui.surface.write(look.surface);
			ui.backT.write(1 - look.backAlpha);
			ui.backFillT.write(1 - look.backFillAlpha);
			ui.backStrokeT.write(1 - look.backStrokeAlpha);
			ui.faceT.write(1 - look.faceAlpha);
			ui.faceFillT.write(1 - look.faceFillAlpha);
			ui.faceStrokeT.write(1 - look.faceStrokeAlpha);
			ui.eyesT.write(1 - look.eyesAlpha);
			ui.ornamentT.write(1 - look.ornamentAlpha);
			ui.textT.write(1 - look.textAlpha);
			ui.glowT.write(1 - look.glowAlpha);
			ui.flashT.write(1 - look.flashAlpha);
			ui.dimT.write(1 - look.dimAlpha);
			ui.shine.write(look.shine);
			ui.burstVisible.write(look.burstVisible);
			ui.burstScale.write(look.burstScale);
			ui.burstT.write(1 - look.burstAlpha);
			ui.haloVisible.write(look.haloAlpha > 0);
			ui.haloT.write(1 - look.haloAlpha);
			ui.rayAngle.write(look.rayAngle);
			const slot = draftSlotOffset(i, fr.count, column);
			ui.rayX.write(slot.x);
			ui.rayY.write(slot.y);
			ui.selected.write(look.selected);
			ui.z.write(look.raised ? DRAFT_SLOT_Z_RAISED : DRAFT_SLOT_Z_REST);
		}
	}

	/** No reveal: nothing drawn, nothing held (run start / exit, a floor change without a draft, the tutorial's end). */
	private off(): void {
		this.reveal.clear();
		this.greedGap.reset();
		this.begun = false;
		this.floor = NONE;
		this.wasOpen = false;
		this.chosen = NONE;
		this.lastDraftTicks = 0;
		this.offers = [];
		this.count = 0;
		if (this.drawn) {
			this.drawn = false;
			resetDraftUi();
		}
	}

	private readDebug(): void {
		const raw = Workspace.GetAttribute(DRAFT_REVEAL_VIEW.debugAttribute);
		if (!typeIs(raw, "string") || raw === "") {
			this.debugBeats = undefined;
			return;
		}
		this.debugBeats = parseDraftRevealDebug(raw);
		if (this.debugBeats === undefined)
			warn(`[DraftReveal] ${DRAFT_REVEAL_VIEW.debugAttribute} = "${raw}" is not 1 to 3 of c / r / l; ignored`);
	}
}
