/**
 * How the boon draft reveal is drawn (docs/DRAFT_REVEAL.md DR5): the overlay's draw constants (the card art's scale,
 * the legendary skulls' placement, the eyes' red, the glow stroke, the flash, the shine band, the ray ring) and the
 * pure mapping from one DraftReveal card frame (draftReveal.ts) to the values the client's DRAFT_UI bindings carry
 * (`draftCardLook`). DraftRevealController (client) calls it once per card per rendered frame and writes the result;
 * DraftOverlay (client/ui/hud) binds to it with no further logic. Presentation only; checked headlessly
 * (draftRevealView.spec.ts). Timings live in draftRevealConfig.ts; the card size stays PROGRESSION_VIEW's 240 x 150.
 *
 * @module
 */
import { DraftBeat, type DraftBeatId, type DraftRevealCardFrame, type DraftRevealFrame } from "./draftReveal";
import { HUD_VIEW } from "./layout";
import { PROGRESSION_VIEW } from "./progression";

/** The card art's logical ui ids (theme contract draftSkinIds: every one optional, absent = the flat card). */
export const DRAFT_SKIN = {
	back: "ui.draft.back",
	backEyes: "ui.draft.back.eyes",
	common: "ui.draft.card.common",
	rare: "ui.draft.card.rare",
	skullLeft: "ui.draft.skull.left",
	skullRight: "ui.draft.skull.right",
} as const;

/**
 * The draft overlay's draw constants, read by `draftCardLook` and the client's DraftOverlay: the card art's scale
 * (reference px per art px), the flip widths (0..1) under which text and strokes are hidden, each card image's opaque
 * body in art px, the legendary skulls' placement, the eyes' red, the glow stroke, the flash, the shine band and the
 * ray ring, plus the debug attribute's name.
 */
export const DRAFT_REVEAL_VIEW = {
	/** Workspace string attribute (DR6, off by default): `c,l,r` etc., the next reveals' rarities (display only). */
	debugAttribute: "KV_DraftRevealDebug",
	/** The card art: one art pixel = this many reference px (ImageLabel SliceScale; the unsliced skulls' size). */
	artScale: 2,
	/** The name / rarity / effect (and the legendary skulls) are not drawn while the flip width is below this. */
	textMinWidth: 0.9,
	/**
	 * Strokes (the flat card's outline, the rarity glow) are not drawn while the flip width is below this: a UIStroke on
	 * a nearly zero-wide frame is a bright vertical line mid-flip with no card around it.
	 */
	strokeMinWidth: 0.05,
	/**
	 * Each card image's opaque body (art px in from the image's left / top / right / bottom edges, and its corner radius
	 * in art px), measured on the art/atlases.json crops: with the art present, the flash, the shine, the glow stroke
	 * and the selection stroke are drawn on this box (UICorner) instead of the full card rectangle, so they never show
	 * as a box over the art's transparent corners (the rare face's top corners beside its tab, the back's rounded
	 * corners). Insets stay inside the 9-slice corners, so they scale by artScale. The rare face: rows 3..58 and columns
	 * 1..85 of its 87 x 61 are opaque (its studs and tab poke out of that box); the common face is the whole 90 x 44,
	 * rounded by 5; the back's panel is rounded by about 5 under its two skulls (row 0: the skulls' tops only).
	 */
	body: {
		back: { left: 2, top: 1, right: 1, bottom: 0, corner: 5 },
		common: { left: 0, top: 0, right: 0, bottom: 0, corner: 5 },
		rare: { left: 1, top: 3, right: 1, bottom: 2, corner: 0 },
	},
	/**
	 * With the rare face art (rare and legendary cards), the name and rarity rows move down this many reference px:
	 * the face's top 30 art px are a fixed slice (60 px) whose tab and trim reach 22 px down, where the flat card's
	 * name row (from 12 px) would sit on them. The effect row keeps its place (it starts below the band's art).
	 */
	rareArtTextNudgePx: { name: 10, rarity: 6 },
	/**
	 * The legendary skulls' pivots land on these art pixels of the rare face (`ui.draft.card.rare`): the left one on
	 * (1, 3) from the face's top-left, the right one on (86, 3) of the 87-wide face (so 87 - 86 = 1 art px in from the
	 * right edge). The corners are fixed-size slices, so these scale by artScale from the card's nearest top corner.
	 */
	skullLeftAt: { x: 1, y: 3 },
	skullRightAt: { x: 86, y: 3 },
	/** The face art width the right skull's x is measured on, used when the pack's face has no width (never 0). */
	skullFaceWidth: 87,
	/** The eyes mask's tint: the red-eyed skulls' red, #5b0000 (0..255 RGB). */
	eyeRgb: [0x5b, 0x00, 0x00] as const,
	/** The rarity-coloured edge glow (rare stroke flare, legendary charge / halo pulse), reference px. */
	glowStroke: 3,
	/** The flash colour: uiText mixed this far toward the card's rarity colour (white-gold on a legendary). */
	flashRarityMix: 0.35,
	/** The rare shine: a band of bandWidth (0..1 of the card) at bandTransparency in its middle, tilted rotationDeg. */
	shine: { bandWidth: 0.3, bandTransparency: 0.55, rotationDeg: 20 },
	/**
	 * The ray ring behind a legendary card (burst and halo), code-drawn: `beams` thin Frames through the ring's centre
	 * (each one is two opposite rays), lengthPx across, widthPx thick, fading from rootTransparency at the centre to
	 * clear at the tips (UIGradient). Drawn in boon.legendary, outside the layout (it never moves a card).
	 */
	rays: { beams: 8, lengthPx: 420, widthPx: 6, rootTransparency: 0.15 },
} as const;

/** Half a turn: each beam is two opposite rays, so `beams` beams spread over 180 degrees. */
const HALF_TURN_DEG = 180;
const HALF = 0.5;
const NONE = -1;

/** One beam's Rotation (degrees) in the ray ring: beam k of `beams`, spread evenly over half a turn. */
export function draftRayAngle(k: number, beams: number): number {
	return beams > 0 ? (k * HALF_TURN_DEG) / beams : 0;
}

/** Which image a card shows: its back, the plain face (common) or the studded face (rare and legendary). */
export type DraftSurface = "back" | "common" | "rare";

/** The surface a card shows now: its back until the flip's midpoint (face < 0.5), then its beat's face. */
export function draftSurfaceOf(beat: DraftBeatId, face: number): DraftSurface {
	if (face < HALF) return "back";
	return beat === DraftBeat.COMMON ? "common" : "rare";
}

/** A surface's theme ui image id (DRAFT_SKIN). */
export function draftSurfaceImageId(surface: DraftSurface): string {
	return surface === "back" ? DRAFT_SKIN.back : surface === "common" ? DRAFT_SKIN.common : DRAFT_SKIN.rare;
}

/** Where a card's overlays (flash, shine, glow, selection) are drawn: insets from the card's edges and a corner, ref px. */
export interface DraftBodyBox {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly corner: number;
}

const FULL_CARD_BOX: DraftBodyBox = { left: 0, top: 0, right: 0, bottom: 0, corner: 0 };

/**
 * The overlay box of `surface`: its art's opaque body (DRAFT_REVEAL_VIEW.body, at artScale) when the pack has the
 * art (`hasArt`), else the whole card, square (the flat fallback, unchanged).
 */
export function draftBodyBox(surface: DraftSurface, hasArt: boolean): DraftBodyBox {
	if (!hasArt) return FULL_CARD_BOX;
	const b = DRAFT_REVEAL_VIEW.body[surface];
	const s = DRAFT_REVEAL_VIEW.artScale;
	return { left: b.left * s, top: b.top * s, right: b.right * s, bottom: b.bottom * s, corner: b.corner * s };
}

/** The name and rarity rows' downward nudge, reference px (DRAFT_REVEAL_VIEW.rareArtTextNudgePx; 0 on the flat card). */
export function draftTextNudge(
	beat: DraftBeatId,
	rareArt: boolean,
): { readonly name: number; readonly rarity: number } {
	if (!rareArt || beat === DraftBeat.COMMON) return { name: 0, rarity: 0 };
	return DRAFT_REVEAL_VIEW.rareArtTextNudgePx;
}

/**
 * Card slot `index`'s centre, reference px right of the card row's centre, with `count` cards shown (the row lays the
 * shown slots out centred, PROGRESSION_VIEW.cardWidth wide, HUD_VIEW.gap apart; hidden slots take no room). The ray
 * layer under the row draws a legendary's rays there.
 */
export function draftSlotOffsetX(index: number, count: number): number {
	const pitch = PROGRESSION_VIEW.cardWidth + HUD_VIEW.gap;
	return (index - (count - 1) * HALF) * pitch;
}

/**
 * Card slot `index`'s centre from the card row's centre, reference px, with `count` shown: along the row
 * (draftSlotOffsetX), or down a column upright (`column`, docs/PORTRAIT.md PT7: the cards stack
 * PROGRESSION_VIEW.cardHeight tall, HUD_VIEW.gap apart; +y is down the screen).
 */
export function draftSlotOffset(
	index: number,
	count: number,
	column: boolean,
): { readonly x: number; readonly y: number } {
	if (!column) return { x: draftSlotOffsetX(index, count), y: 0 };
	const pitch = PROGRESSION_VIEW.cardHeight + HUD_VIEW.gap;
	return { x: 0, y: (index - (count - 1) * HALF) * pitch };
}

/** The face art of a beat: common -> the plain panel; rare and legendary (evolution, duo) -> the studded panel. */
export function draftFaceImageId(beat: DraftBeatId): string {
	return beat === DraftBeat.COMMON ? DRAFT_SKIN.common : DRAFT_SKIN.rare;
}

/** 9-slice insets of a ui image (theme ImageRef.slice), art pixels. */
export interface DraftSliceInsets {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** A sliced image's SliceCenter rectangle (art px: min x, min y, max x, max y), from its size and insets. */
export interface DraftSliceRect {
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
}

/** SliceCenter = Rect(left, top, w - right, h - bottom). */
export function draftSliceCenter(w: number, h: number, slice: Readonly<DraftSliceInsets>): DraftSliceRect {
	return { x0: slice.left, y0: slice.top, x1: w - slice.right, y1: h - slice.bottom };
}

/** Where one legendary skull is drawn on the card (reference px; the card's own top-left or top-right corner). */
export interface DraftSkullPlacement {
	/** Measured from the card's right edge (the right skull) instead of its left. */
	readonly fromRight: boolean;
	/** Offset from that edge (inward) and from the card's top, reference px: where the skull's pivot sits. */
	readonly x: number;
	readonly y: number;
	/** Drawn size (art size x artScale) and AnchorPoint (pivot / size; the centre without a pivot). */
	readonly w: number;
	readonly h: number;
	readonly anchorX: number;
	readonly anchorY: number;
}

/**
 * A legendary skull's placement: its pivot (art px of the skull image) on the rare face's art pixel
 * DRAFT_REVEAL_VIEW.skullLeftAt / skullRightAt, at artScale. `faceW`: the rare face's art width (the right skull is
 * measured from the face's right edge).
 */
export function draftSkullPlacement(
	side: "left" | "right",
	skull: { readonly w: number; readonly h: number; readonly pivot?: { readonly x: number; readonly y: number } },
	faceW: number,
): DraftSkullPlacement {
	const V = DRAFT_REVEAL_VIEW;
	const s = V.artScale;
	const right = side === "right";
	const at = right ? V.skullRightAt : V.skullLeftAt;
	const width = faceW > 0 ? faceW : V.skullFaceWidth;
	const x = right ? (width - at.x) * s : at.x * s;
	const px = skull.pivot !== undefined ? skull.pivot.x : skull.w * HALF;
	const py = skull.pivot !== undefined ? skull.pivot.y : skull.h * HALF;
	return {
		fromRight: right,
		x,
		y: at.y * s,
		w: skull.w * s,
		h: skull.h * s,
		anchorX: skull.w > 0 ? px / skull.w : HALF,
		anchorY: skull.h > 0 ? py / skull.h : HALF,
	};
}

/** The shine band's UIGradient X offset for sweep progress u (0: just off the left edge, 1: just off the right). */
export function draftShineOffset(u: number): number {
	const reach = HALF + DRAFT_REVEAL_VIEW.shine.bandWidth * HALF;
	return -reach + 2 * reach * math.clamp(u, 0, 1);
}

/** What one card slot draws this frame (DRAFT_UI's per-card values). Mutable: one per slot, refilled each frame. */
export interface DraftCardLook {
	shown: boolean;
	/** The card body's offset from its slot's centre, reference px (tremble; rise + drop). */
	offsetX: number;
	offsetY: number;
	/** The flip: the body's width factor (its X scale about the centre). */
	width: number;
	/** The body's UIScale: pop * stamp, times PROGRESSION_VIEW.selectedScale while selected. */
	scale: number;
	/** The image the card shows now (back / common / rare face): the dim silhouette and the overlay box follow it. */
	surface: DraftSurface;
	/** Opacities 0..1 (the overlay's exit fade and the card's own alpha folded in). */
	backAlpha: number;
	/** The flat back's / face's outline (no art): their alphas, 0 while the card is a sliver (strokeMinWidth). */
	backStrokeAlpha: number;
	faceStrokeAlpha: number;
	/** The flat back's panel fill (no back art): backAlpha at uiPanel's usual transparency. */
	backFillAlpha: number;
	faceAlpha: number;
	/** The flat face's panel fill (no face art): opaque while selected (today's look), else panelTransparency. */
	faceFillAlpha: number;
	eyesAlpha: number;
	/** The legendary skulls: the face's opacity, hidden while the card is thin (like the text). */
	ornamentAlpha: number;
	textAlpha: number;
	glowAlpha: number;
	flashAlpha: number;
	dimAlpha: number;
	/** Shine sweep 0..1, or -1 (none). */
	shine: number;
	burstVisible: boolean;
	burstScale: number;
	burstAlpha: number;
	haloAlpha: number;
	/** The ray ring's Rotation, degrees. */
	rayAngle: number;
	/** Draw the selection (uiAccent stroke, selectedScale): settled, and the card under the stick (or the one taken). */
	selected: boolean;
	/**
	 * The card is drawn larger than its slot (pop, stamp, selection: scale > 1), so its slot draws over the others (its
	 * overhang is in front of the neighbours). The rays are on their own layer under the whole row.
	 */
	raised: boolean;
}

/**
 * A fresh, hidden card look: not shown, every alpha 0, width and scale 1, the back surface, no shine, burst or halo,
 * neither selected nor raised. The client's DraftRevealController makes one and hands it to `draftCardLook` as `out`
 * every frame, so no table is allocated per card.
 */
export function newDraftCardLook(): DraftCardLook {
	return {
		shown: false,
		offsetX: 0,
		offsetY: 0,
		width: 1,
		scale: 1,
		surface: "back",
		backAlpha: 0,
		backStrokeAlpha: 0,
		faceStrokeAlpha: 0,
		backFillAlpha: 0,
		faceAlpha: 0,
		faceFillAlpha: 0,
		eyesAlpha: 0,
		ornamentAlpha: 0,
		textAlpha: 0,
		glowAlpha: 0,
		flashAlpha: 0,
		dimAlpha: 0,
		shine: NONE,
		burstVisible: false,
		burstScale: 1,
		burstAlpha: 0,
		haloAlpha: 0,
		rayAngle: 0,
		selected: false,
		raised: false,
	};
}

/**
 * One card's look from its reveal frame: `overlayAlpha` (DraftRevealFrame.overlayAlpha, the exit fade) multiplies
 * every opacity; `selected` is whether this card is the selection (the caller passes it only once settled). Back and
 * face are drawn at (1 - face) and face (a step at the flip's midpoint, a crossfade under reduced motion).
 */
export function draftCardLook(
	card: Readonly<DraftRevealCardFrame>,
	overlayAlpha: number,
	selected: boolean,
	out: DraftCardLook,
): DraftCardLook {
	out.shown = card.shown;
	const a = card.shown ? math.clamp(card.alpha * overlayAlpha, 0, 1) : 0;
	const face = math.clamp(card.face, 0, 1);
	const wide = card.width >= DRAFT_REVEAL_VIEW.textMinWidth;
	const thin = card.width < DRAFT_REVEAL_VIEW.strokeMinWidth;
	const fill = 1 - HUD_VIEW.panelTransparency;
	out.offsetX = card.tremble;
	out.offsetY = card.rise + card.drop;
	out.width = math.max(0, card.width);
	out.selected = card.shown && selected;
	out.scale = card.pop * card.stamp * (out.selected ? PROGRESSION_VIEW.selectedScale : 1);
	out.surface = draftSurfaceOf(card.beat, face);
	out.backAlpha = a * (1 - face);
	out.backStrokeAlpha = thin ? 0 : out.backAlpha;
	out.backFillAlpha = out.backAlpha * fill;
	out.faceAlpha = a * face;
	out.faceStrokeAlpha = thin ? 0 : out.faceAlpha;
	out.faceFillAlpha = out.faceAlpha * (out.selected ? 1 : fill);
	out.eyesAlpha = out.backAlpha * math.clamp(card.eyes, 0, 1);
	out.ornamentAlpha = wide ? out.faceAlpha : 0;
	out.textAlpha = wide ? a * math.clamp(card.textAlpha, 0, 1) : 0;
	out.glowAlpha = thin ? 0 : a * math.clamp(card.glow, 0, 1);
	out.flashAlpha = a * math.clamp(card.flash, 0, 1);
	out.dimAlpha = a * math.clamp(card.dim, 0, 1);
	out.shine = card.shown ? card.shine : NONE;
	out.burstVisible = card.shown && card.burst >= 0;
	out.burstScale = card.burstScale;
	out.burstAlpha = out.burstVisible ? a * math.clamp(card.burstAlpha, 0, 1) : 0;
	out.haloAlpha = a * math.clamp(card.haloAlpha, 0, 1);
	out.rayAngle = card.haloAngle;
	out.raised = card.shown && out.scale > 1;
	return out;
}

/** The overlay's own opacities: the panel and title fade in with the title, everything fades out after a pick. */
export interface DraftOverlayLook {
	readonly visible: boolean;
	/** The panel's uiPanel fill opacity (its usual 1 - panelTransparency at full). */
	readonly panelAlpha: number;
	readonly titleAlpha: number;
	/** The hint and the co-op waiting line. */
	readonly hintAlpha: number;
}

/**
 * The overlay's own look from the reveal's frame: drawn while the reveal is active; the title, the hint and the panel
 * behind them fade with the frame's title alpha times its overlay alpha (the exit fade), each clamped to 0..1, the
 * panel up to the HUD panels' opacity.
 */
export function draftOverlayLook(frame: Readonly<DraftRevealFrame>): DraftOverlayLook {
	const o = math.clamp(frame.overlayAlpha, 0, 1);
	const title = math.clamp(frame.titleAlpha, 0, 1) * o;
	return {
		visible: frame.active,
		panelAlpha: (1 - HUD_VIEW.panelTransparency) * title,
		titleAlpha: title,
		hintAlpha: title,
	};
}
