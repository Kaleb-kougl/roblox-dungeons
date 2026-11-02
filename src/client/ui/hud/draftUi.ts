import { DRAFT_OFFER_COUNT } from "shared/sim";
import { DraftBeat, type DraftBeatId, type DraftCardModel, type DraftSurface, type DraftTone } from "shared/view/hud";
import { ComboUiValue } from "./comboUi";

/**
 * The boon draft reveal's per-frame values (docs/DRAFT_REVEAL.md DR5): module-level React bindings, written once per
 * rendered frame by the client's DraftRevealController (DR6) from shared/view/hud draftCardLook / draftOverlayLook and
 * read by DraftOverlay. A binding update changes the one property it is bound to and never re-renders the tree; each
 * value is written only when it changed (ComboUiValue). Opacities are stored as Roblox transparencies (1 - alpha).
 * The overlay's content (which boons) is a binding too, so the overlay stays mounted from the controller's copy of the
 * offers after the pick (the snapshot's draft is already closed) and needs no snapshot to draw the reveal.
 */

/** One card slot (by OFFER index). */
export interface DraftCardUi {
	readonly shown: ComboUiValue<boolean>;
	/**
	 * What the card shows (shared/view/hud draftCardModel: name, banner, line, "was" line, level pips, duo chip; the
	 * card's kind for the local player, read at the deal), undefined = none.
	 */
	readonly model: ComboUiValue<DraftCardModel | undefined>;
	/** How the card flips (its face art, skulls, text nudge; KV_DraftRevealDebug may differ from the card's own). */
	readonly beat: ComboUiValue<DraftBeatId>;
	/** The card's colour (stroke, glow, flash, rays): its rarity, or boon.evolved / boon.duo (docs/BUILDS.md BU9). */
	readonly tone: ComboUiValue<DraftTone>;
	/** The body: position in its slot (centre + tremble, rise + drop), size (the flip's width factor), UIScale. */
	readonly position: ComboUiValue<UDim2>;
	readonly size: ComboUiValue<UDim2>;
	readonly scale: ComboUiValue<number>;
	/** The image shown now (back / common / rare face): the dim silhouette and the overlay box follow it. */
	readonly surface: ComboUiValue<DraftSurface>;
	readonly backT: ComboUiValue<number>;
	readonly backFillT: ComboUiValue<number>;
	/** The flat back's / face's outline (hidden while the card is a sliver mid-flip). */
	readonly backStrokeT: ComboUiValue<number>;
	readonly faceT: ComboUiValue<number>;
	readonly faceFillT: ComboUiValue<number>;
	readonly faceStrokeT: ComboUiValue<number>;
	readonly eyesT: ComboUiValue<number>;
	readonly ornamentT: ComboUiValue<number>;
	readonly textT: ComboUiValue<number>;
	readonly glowT: ComboUiValue<number>;
	readonly flashT: ComboUiValue<number>;
	readonly dimT: ComboUiValue<number>;
	/** Shine sweep 0..1, or -1 (hidden). */
	readonly shine: ComboUiValue<number>;
	readonly burstVisible: ComboUiValue<boolean>;
	readonly burstScale: ComboUiValue<number>;
	readonly burstT: ComboUiValue<number>;
	readonly haloVisible: ComboUiValue<boolean>;
	readonly haloT: ComboUiValue<number>;
	readonly rayAngle: ComboUiValue<number>;
	/**
	 * The slot's centre, reference px right of (and, upright, below: docs/PORTRAIT.md PT7) the card row's centre (the
	 * ray layer under the row draws there).
	 */
	readonly rayX: ComboUiValue<number>;
	readonly rayY: ComboUiValue<number>;
	readonly selected: ComboUiValue<boolean>;
	/** The slot's ZIndex in the row (a card drawn larger than its slot draws over the others). */
	readonly z: ComboUiValue<number>;
}

const HIDDEN = 1;
/** The body at rest: its slot's centre, full size. */
const HALF = 0.5;
export const DRAFT_BODY_POSITION = UDim2.fromScale(HALF, HALF);
export const DRAFT_BODY_SIZE = UDim2.fromScale(1, 1);
/**
 * Slot ZIndex in the card row (ZIndexBehavior Sibling): at rest, or raised over the others while its card is drawn
 * larger than its slot (the legendary pop, the pick stamp, the selection), so the overhang is in front.
 */
export const DRAFT_SLOT_Z_REST = 1;
export const DRAFT_SLOT_Z_RAISED = 2;

function newCardUi(): DraftCardUi {
	return {
		shown: new ComboUiValue(false),
		model: new ComboUiValue<DraftCardModel | undefined>(undefined),
		beat: new ComboUiValue<DraftBeatId>(DraftBeat.COMMON),
		tone: new ComboUiValue<DraftTone>("common"),
		position: new ComboUiValue(DRAFT_BODY_POSITION),
		size: new ComboUiValue(DRAFT_BODY_SIZE),
		scale: new ComboUiValue(1),
		surface: new ComboUiValue<DraftSurface>("back"),
		backT: new ComboUiValue(HIDDEN),
		backFillT: new ComboUiValue(HIDDEN),
		backStrokeT: new ComboUiValue(HIDDEN),
		faceT: new ComboUiValue(HIDDEN),
		faceFillT: new ComboUiValue(HIDDEN),
		faceStrokeT: new ComboUiValue(HIDDEN),
		eyesT: new ComboUiValue(HIDDEN),
		ornamentT: new ComboUiValue(HIDDEN),
		textT: new ComboUiValue(HIDDEN),
		glowT: new ComboUiValue(HIDDEN),
		flashT: new ComboUiValue(HIDDEN),
		dimT: new ComboUiValue(HIDDEN),
		shine: new ComboUiValue(-1),
		burstVisible: new ComboUiValue(false),
		burstScale: new ComboUiValue(1),
		burstT: new ComboUiValue(HIDDEN),
		haloVisible: new ComboUiValue(false),
		haloT: new ComboUiValue(HIDDEN),
		rayAngle: new ComboUiValue(0),
		rayX: new ComboUiValue(0),
		rayY: new ComboUiValue(0),
		selected: new ComboUiValue(false),
		z: new ComboUiValue(DRAFT_SLOT_Z_REST),
	};
}

function perCard(): DraftCardUi[] {
	const out: DraftCardUi[] = [];
	for (let i = 0; i < DRAFT_OFFER_COUNT; i++) out.push(newCardUi());
	return out;
}

/** Everything DraftOverlay binds to. */
export const DRAFT_UI = {
	/** The reveal is on (begun, not done): the overlay shows; the co-op waiting-only panel hides. */
	visible: new ComboUiValue(false),
	/** The panel's uiPanel fill, the title and the hint / waiting line, as transparencies. */
	panelT: new ComboUiValue(HIDDEN),
	titleT: new ComboUiValue(HIDDEN),
	hintT: new ComboUiValue(HIDDEN),
	/** The hint shows the keys (settled and the sim's draftReady), else `hud.draft.wait`. */
	hintReady: new ComboUiValue(false),
	/** The deal on screen is the boss double draft's re-deal: the "Pick again" line (docs/BUILDS.md BU9). */
	again: new ComboUiValue(false),
	cards: perCard(),
} as const;

/** Every DRAFT_UI value back to its initial value (no reveal: the overlay hides). */
export function resetDraftUi(): void {
	const U = DRAFT_UI;
	U.visible.reset();
	U.panelT.reset();
	U.titleT.reset();
	U.hintT.reset();
	U.hintReady.reset();
	U.again.reset();
	for (const c of U.cards) for (const [, v] of pairs(c)) (v as ComboUiValue<unknown>).reset();
}
