/**
 * The pacts on screen (docs/FORTUNE.md FO7, "Player experience -> Pacts"), pure: what each altar shows the watched
 * player (its flame, its floor card's lines or the dim line), the HUD hint and draft title, the Horde's live room / chip
 * / pops / wave rings, the Greed deal's 0.5 s gap and the take pulse, the debug label. Every read is of hashed sim state
 * through shared/sim's view queries (pactAltarAt, pactAvailability, greedCurseFor, hordePhase, pactDraftKind); nothing
 * here writes the sim. Personal reads (the card, the dim line, Greed's curse, the hint) take the view player
 * (SimController.getViewPlayerIndex: the watched teammate while spectating) or the local player (the hint, like every
 * snapshot hint); the Horde is party state.
 *
 * @module
 */
import {
	CURSES,
	HordePhase,
	NO_KIND,
	PACT_DIM_NAMES,
	PACT_KIND_COUNT,
	PACT_KIND_NAMES,
	PactDim,
	PactKind,
	TILE_SIZE,
	greedCurseFor,
	hordePhase,
	pactAvailability,
	partySize,
	playerAt,
	type SimConfig,
	type SimState,
} from "shared/sim";
import type { ColorRole, StringVars } from "shared/theme";
import { breakableArtLayout } from "../breakables";
// by file, not the decor barrel (it reaches back into much of shared/view)
import { DECOR_CAMERA, floorRectScreen, screenX, screenY, type FloorRect } from "../decor/screen";
import type { SpriteLayout } from "../sprites";
import { HORDE_CHIP_VIEW, PACTS_VIEW } from "./config";

/**
 * The theme's string lookup as the pact texts take it: a string key and its `{name}` variables in, the final text out.
 * The client passes `pack.str`, a spec its fake, so every text helper here runs headlessly.
 */
export type PactStr = (key: string, vars?: StringVars) => string;

/** Every theme string the pacts' view reads (all REQUIRED: theme fortune.ts FORTUNE_STRING_KEYS). */
export const PACT_STRINGS = {
	title: ["pact.greed.title", "pact.horde.title"] as ReadonlyArray<string>,
	take: ["pact.greed.take", "pact.horde.take"] as ReadonlyArray<string>,
	gain: ["pact.greed.gain", "pact.horde.gain"] as ReadonlyArray<string>,
	accept: "pact.accept",
	draftTitleGreed: "hud.draft.title.greed",
	chip: "hud.chip.horde",
	shout: "fx.horde.shout",
	wave: "fx.horde.wave",
	/** A Horde room kill's score pop: `+{points}` with the x2 mark (docs/FORTUNE.md "score pops ... with x2"). */
	popHorde: "hud.score.pop.horde",
} as const;

/** The ordinary draft title (shared/view/hud PROGRESSION_STRINGS.draftTitle's key, written out: no hud import). */
const DRAFT_TITLE = "hud.draft.title";

/** Between the pact's title and its accept line in the one-line HUD hint (like the tally's segment separator). */
export const PACT_HINT_SEPARATOR = "   ";

/** Colour role of pact `kind` (theme PACT_ROLES order: GREED, HORDE). */
export function pactRole(kind: number): ColorRole {
	return kind === PactKind.HORDE ? "pact.horde" : "pact.greed";
}

/** The dim line's key for a PactDim (`pact.dim.<name>`), or undefined for NONE. */
export function pactDimKey(dim: number): string | undefined {
	if (dim === PactDim.NONE) return undefined;
	const name = PACT_DIM_NAMES[dim];
	return name !== undefined ? `pact.dim.${name}` : undefined;
}

// ---------------------------------------------------------------------------------------------
// The altar

/** An altar's flame (AltarLook.flame). */
export const AltarFlame = {
	/** Nothing to give the view player (spent, taken, dimmed): no flame. */
	OFF: 0,
	/** Offered: the pact's colour, flickering. */
	LIT: 1,
	/** The Horde's altar while offered and not armed: a low ember (toward the stone). */
	EMBER: 2,
	/** The Horde armed: full `pact.horde`, larger (the flame turned red). */
	ARMED: 3,
} as const;
/** One `AltarFlame` value (0 off, 1 lit, 2 ember, 3 armed): `AltarLook.flame`. */
export type AltarFlameId = (typeof AltarFlame)[keyof typeof AltarFlame];

/** One altar's look for the view player. Mutable, reused. */
export interface AltarLook {
	/** The floor's altars stand (state.pacts with a shrine room on this floor). */
	placed: boolean;
	flame: AltarFlameId;
	/** The altar gives the view player nothing (pactAvailability not NONE): its body and card dim. */
	dim: boolean;
	/** pactAvailability's PactDim for the view player. */
	availability: number;
}

/**
 * A fresh AltarLook for the renderer to keep per altar and hand to the altar look function every frame. It starts as an
 * altar that is not there: not placed, no flame, dimmed. PactRenderController owns one per altar.
 */
export function newAltarLook(): AltarLook {
	return { placed: false, flame: AltarFlame.OFF, dim: true, availability: PactDim.UNABLE };
}

/** The view player index the reads use: `view` within the party, else 0. */
function viewOf(state: Readonly<SimState>, view: number): number {
	return view >= 0 && view < partySize(state) ? view : 0;
}

/**
 * Altar `kind`'s look for view player `view` (see AltarFlame): Greed lit while it is the view player's to take, else
 * dimmed; the Horde an ember while offered, ARMED (bright red) from the take until a room is roused, then spent. A dead
 * view player (spectating ends at death only for the watched one) reads as UNABLE: every altar dims.
 */
export function pactAltarLook(
	state: Readonly<SimState>,
	config: Readonly<SimConfig>,
	view: number,
	kind: number,
	out: AltarLook,
): AltarLook {
	const p = state.pacts;
	out.placed = p !== undefined && p.room >= 0 && kind >= 0 && kind < p.altarX.size();
	if (!out.placed) {
		out.flame = AltarFlame.OFF;
		out.dim = true;
		out.availability = PactDim.UNABLE;
		return out;
	}
	const v = viewOf(state, view);
	const avail = pactAvailability(state, config, v, kind);
	out.availability = avail;
	out.dim = avail !== PactDim.NONE;
	if (kind === PactKind.HORDE) {
		const phase = hordePhase(state);
		out.flame = phase === HordePhase.ARMED ? AltarFlame.ARMED : out.dim ? AltarFlame.OFF : AltarFlame.EMBER;
	} else out.flame = out.dim ? AltarFlame.OFF : AltarFlame.LIT;
	return out;
}

/** The flame's scale this frame: 1 +- flickerAmount (x motion, 0 under reduced motion), x armedScale when ARMED. */
export function altarFlameScale(flame: AltarFlameId, timeSec: number, motion: number): number {
	if (flame === AltarFlame.OFF) return 0;
	const V = PACTS_VIEW;
	const m = math.clamp(motion, 0, 1);
	const flicker = 1 + V.flickerAmount * m * math.sin(2 * math.pi * V.flickerHz * timeSec);
	return flame === AltarFlame.ARMED ? flicker * V.armedScale : flicker;
}

/** Altar art as drawn: its billboard layout and where its flame stands (docs/FORTUNE.md FO10). */
export interface AltarArtFit {
	/** The art's layout at its own pixelsPerTile, capped at PACTS_VIEW.artMaxHeightTiles above its pivot. */
	readonly layout: SpriteLayout;
	/** The flame's base above the floor, tiles: PACTS_VIEW.artTopTiles, scaled with the cap. */
	readonly topTiles: number;
}

/** How altar art laid out as `art` (an image region's or a sprite set's layout) is drawn (altarArtFit). */
export function altarArtFit(art: SpriteLayout): AltarArtFit {
	const V = PACTS_VIEW;
	const layout = breakableArtLayout(art, V.artMaxHeightTiles);
	const shrink = layout.pixelsPerTile > 0 ? art.pixelsPerTile / layout.pixelsPerTile : 1;
	return { layout, topTiles: V.artTopTiles * shrink };
}

// ---------------------------------------------------------------------------------------------
// The floor card

/** What a card line is: every line of one kind is drawn at one text size on both cards (pactCardTextSizes). */
export const PactLineKind = {
	TITLE: 0,
	/** The take / gain lines and the dim line. */
	LINE: 1,
	/** The curse's short effect under Greed's take. */
	DETAIL: 2,
	ACCEPT: 3,
} as const;
/**
 * One `PactLineKind` value (0 title, 1 line, 2 detail, 3 accept): `PactCardLine.kind`, which picks the line's text
 * size.
 */
export type PactLineKindId = (typeof PactLineKind)[keyof typeof PactLineKind];

/** How many PactLineKind values. */
export const PACT_LINE_KIND_COUNT = 4;

/** A card line: its text, colour role, share of the card's depth and kind. */
export interface PactCardLine {
	readonly text: string;
	readonly role: ColorRole;
	readonly share: number;
	readonly kind: PactLineKindId;
}

/** One altar's card for the view player. */
export interface PactCard {
	readonly kind: number;
	/** The card dims (the altar gives the view player nothing): title + the dim line. */
	readonly dim: boolean;
	readonly lines: ReadonlyArray<PactCardLine>;
}

/**
 * Altar `kind`'s card for view player `view` (FORTUNE.md's card): offered -> the title (pact role), Take (Greed names the
 * exact curse greedCurseFor gives the view player, then its short effect `<curse>.desc` in a smaller dim line), Gain,
 * and `pact.accept` with `key` (the binding-aware shrine key, shared/play shrineHint; undefined on touch, where the
 * shrine button says Accept itself: no accept line); not offered -> the title and the dim line
 * (pactAvailability's reason, `pact.dim.<name>`). Undefined without altars. Pure.
 */
export function pactCard(
	state: Readonly<SimState>,
	config: Readonly<SimConfig>,
	view: number,
	kind: number,
	str: PactStr,
	key: string | undefined,
	layout: Readonly<PactCardLayout> = PACT_CARD_LAYOUT,
): PactCard | undefined {
	const p = state.pacts;
	if (p === undefined || p.room < 0 || kind < 0 || kind >= PACT_KIND_COUNT) return undefined;
	const C = PACTS_VIEW.card;
	const v = viewOf(state, view);
	const avail = pactAvailability(state, config, v, kind);
	const lines: PactCardLine[] = [
		{ text: str(PACT_STRINGS.title[kind]), role: pactRole(kind), share: C.titleShare, kind: PactLineKind.TITLE },
	];
	const dimKey = pactDimKey(avail);
	if (dimKey !== undefined) {
		lines.push({ text: str(dimKey), role: C.dimRole, share: C.lineShare, kind: PactLineKind.LINE });
		return { kind, dim: true, lines: fillCardLines(lines, layout) };
	}
	if (kind === PactKind.GREED) {
		const curse = CURSES[greedCurseFor(state, v)];
		const id = curse?.id ?? "";
		lines.push({
			text: str(PACT_STRINGS.take[kind], { curse: str(`${id}.name`) }),
			role: C.textRole,
			share: C.lineShare,
			kind: PactLineKind.LINE,
		});
		if (curse !== undefined)
			lines.push({
				text: str(`${id}.desc`),
				role: C.detailRole,
				share: C.detailShare,
				kind: PactLineKind.DETAIL,
			});
	} else
		lines.push({
			text: str(PACT_STRINGS.take[kind]),
			role: C.textRole,
			share: C.lineShare,
			kind: PactLineKind.LINE,
		});
	lines.push({ text: str(PACT_STRINGS.gain[kind]), role: C.textRole, share: C.lineShare, kind: PactLineKind.LINE });
	if (key !== undefined)
		lines.push({
			text: str(PACT_STRINGS.accept, { key }),
			role: pactRole(kind),
			share: C.acceptShare,
			kind: PactLineKind.ACCEPT,
		});
	return { kind, dim: false, lines: fillCardLines(lines, layout) };
}

/** The fullest touch card's stack (Greed offered, no accept line): its lines fill layout.fillShare on touch. */
const FULLEST_TOUCH_STACK = PACTS_VIEW.card.titleShare + 2 * PACTS_VIEW.card.lineShare + PACTS_VIEW.card.detailShare;

/**
 * The lines grown to fill layout.fillShare of the card's depth: by ONE factor for every card (the fullest touch card,
 * FULLEST_TOUCH_STACK, fills it; at most layout.maxLineGrow; never shrunk), so a kind of line has the same row on both
 * cards; a stack that would then overflow the card grows only to fill it. The touch card, which has no accept line,
 * gives its lines that depth. maxLineGrow 1 (the desktop layout): unchanged.
 */
function fillCardLines(lines: PactCardLine[], layout: Readonly<PactCardLayout>): PactCardLine[] {
	if (layout.maxLineGrow <= 1) return lines;
	let sum = 0;
	for (const l of lines) sum += l.share;
	if (!(sum > 0)) return lines;
	const grow = math.min(layout.maxLineGrow, layout.fillShare / FULLEST_TOUCH_STACK, 1 / sum);
	if (grow <= 1) return lines;
	const out: PactCardLine[] = [];
	for (const l of lines) out.push({ text: l.text, role: l.role, share: l.share * grow, kind: l.kind });
	return out;
}

/** A line's width in canvas px at a text size (one line, unwrapped): the client's TextService:GetTextSize. */
export type PactTextMeasure = (text: string, sizePx: number) => number;

/**
 * The largest whole text size (card.minTextPx .. min(card.maxTextPx, heightPx)) at which `text` fits `widthPx` on one
 * line by `measure` (min when nothing fits). Text sizes grow its width monotonically, so this is a binary search.
 */
export function pactLineFitSize(measure: PactTextMeasure, text: string, widthPx: number, heightPx: number): number {
	const C = PACTS_VIEW.card;
	let lo: number = C.minTextPx;
	let hi = math.max(lo, math.floor(math.min(C.maxTextPx, heightPx)));
	if (measure(text, hi) <= widthPx) return hi;
	while (hi - lo > 1) {
		const mid = math.floor((lo + hi) / 2);
		if (measure(text, mid) <= widthPx) lo = mid;
		else hi = mid;
	}
	return lo;
}

/**
 * The text size of each PactLineKind (index), canvas px, for cards drawn on a canvasW x canvasH canvas: the smallest
 * pactLineFitSize of every line of that kind on every card (its row: share x canvasH; card.textWidthShare of the
 * width), so both cards draw a kind at one size. 0 for a kind no card has. `out` is rewritten and returned.
 */
export function pactCardTextSizes(
	cards: ReadonlyArray<PactCard>,
	canvasW: number,
	canvasH: number,
	measure: PactTextMeasure,
	out: number[] = [],
): number[] {
	for (let k = 0; k < PACT_LINE_KIND_COUNT; k++) out[k] = 0;
	const widthPx = canvasW * PACTS_VIEW.card.textWidthShare;
	for (const card of cards) {
		for (const l of card.lines) {
			const size = pactLineFitSize(measure, l.text, widthPx, l.share * canvasH);
			out[l.kind] = out[l.kind] === 0 ? size : math.min(out[l.kind], size);
		}
	}
	return out;
}

/** A floor card's size and place (tiles): the desktop card (PACTS_VIEW.card) or the larger touch card. */
export interface PactCardLayout {
	readonly widthTiles: number;
	readonly depthTiles: number;
	/** Its centre this far screen-down of the altar's centre. */
	readonly offsetTiles: number;
	/** The lines grow to fill this share of the depth ... */
	readonly fillShare: number;
	/** ... at most this many times (1: never). */
	readonly maxLineGrow: number;
	/** Each card slides this far outward along screen-right, away from the other altar (pactCardCentreAt). */
	readonly shiftTiles: number;
}

/** The desktop card: PACTS_VIEW.card's box, lines as written. */
export const PACT_CARD_LAYOUT: PactCardLayout = table.freeze({
	widthTiles: PACTS_VIEW.card.widthTiles,
	depthTiles: PACTS_VIEW.card.depthTiles,
	offsetTiles: PACTS_VIEW.card.offsetTiles,
	fillShare: PACTS_VIEW.card.touch.fillShare,
	maxLineGrow: 1,
	shiftTiles: 0,
});

/** Screen-right on the floor (shared/view/hud floorAxes). */
export interface PactRightAxis {
	readonly rightX: number;
	readonly rightZ: number;
}

/**
 * The floor card's layout: PACT_CARD_LAYOUT, or on touch card.touch's larger card. Where it is wider than the two
 * altars' screen-horizontal distance minus touch.altarGapTiles (the room centred cards have), each card slides outward
 * by up to touch.maxShiftTiles so the inner edges keep that gap; past that the width shrinks to the room plus both
 * shifts (never below the desktop card's width). Pure.
 */
export function pactCardLayout(
	touch: boolean,
	altarX: ReadonlyArray<number>,
	altarZ: ReadonlyArray<number>,
	axes: PactRightAxis,
): PactCardLayout {
	if (!touch) return PACT_CARD_LAYOUT;
	const T = PACTS_VIEW.card.touch;
	let room = math.huge;
	for (let i = 0; i < altarX.size(); i++) {
		for (let j = i + 1; j < altarX.size(); j++) {
			const apart = math.abs((altarX[j] - altarX[i]) * axes.rightX + (altarZ[j] - altarZ[i]) * axes.rightZ);
			room = math.min(room, apart / TILE_SIZE - T.altarGapTiles);
		}
	}
	let width: number = T.widthTiles;
	let shift = 0;
	if (room < width) {
		shift = math.min(T.maxShiftTiles, (width - room) / 2);
		if (shift === T.maxShiftTiles) width = room + 2 * shift;
	}
	return {
		widthTiles: math.max(PACTS_VIEW.card.widthTiles, width),
		depthTiles: T.depthTiles,
		offsetTiles: T.offsetTiles,
		fillShare: T.fillShare,
		maxLineGrow: T.maxLineGrow,
		shiftTiles: shift,
	};
}

/** Two layouts are the same card. */
export function pactCardLayoutsEqual(a: Readonly<PactCardLayout>, b: Readonly<PactCardLayout>): boolean {
	return (
		a.widthTiles === b.widthTiles &&
		a.depthTiles === b.depthTiles &&
		a.offsetTiles === b.offsetTiles &&
		a.fillShare === b.fillShare &&
		a.maxLineGrow === b.maxLineGrow &&
		a.shiftTiles === b.shiftTiles
	);
}

/** Two cards show the same thing (the client rebuilds a card's labels only when this is false). */
export function pactCardsEqual(a: PactCard | undefined, b: PactCard | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	if (a.kind !== b.kind || a.dim !== b.dim || a.lines.size() !== b.lines.size()) return false;
	for (let i = 0; i < a.lines.size(); i++) {
		const x = a.lines[i];
		const y = b.lines[i];
		if (x.text !== y.text || x.role !== y.role || x.share !== y.share || x.kind !== y.kind) return false;
	}
	return true;
}

/** Reused by pactCardEnemyOver: floorRectScreen's [x0, y0, x1, y1, far]. */
const CARD_SCREEN: number[] = [];

/**
 * Whether a living enemy's body overlaps the card on screen (its radius either side, feet to card.enemyHeightTiles):
 * the card draws over every wall and body (AlwaysOnTop, so walls never hide it), so the client ducks it like an enemy
 * bullet in its box, and the card reads behind the enemies. Players never duck it (you stand at the altar to read it).
 */
export function pactCardEnemyOver(box: Readonly<FloorRect>, state: Readonly<SimState>): boolean {
	const cam = DECOR_CAMERA;
	const r = floorRectScreen(cam, box, CARD_SCREEN);
	const height = PACTS_VIEW.card.enemyHeightTiles * TILE_SIZE;
	for (const a of state.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const sx = screenX(cam, a.x, 0, a.z);
		if (sx + a.radius < r[0] || sx - a.radius > r[2]) continue;
		const sy0 = screenY(cam, a.x, 0, a.z);
		const sy1 = screenY(cam, a.x, height, a.z);
		if (math.max(sy0, sy1) < r[1] || math.min(sy0, sy1) - a.radius > r[3]) continue;
		return true;
	}
	return false;
}

/** The card's opacity: the shout duck's ceiling (<= COMBO_SHOUT.maxOpacity), x card.dimOpacity on a dimmed card. */
export function pactCardOpacity(ceiling: number, dim: boolean): number {
	return dim ? ceiling * PACTS_VIEW.card.dimOpacity : ceiling;
}

/** Floor axes as the combo shout reads them (shared/view/hud floorAxes). */
export interface PactAxes {
	readonly upX: number;
	readonly upZ: number;
}

/**
 * The card's centre for the altar at (x, z): the layout's offsetTiles (card.offsetTiles by default) SCREEN-DOWN of it
 * (minus the floor's up-screen axis).
 */
export function pactCardCentre(
	x: number,
	z: number,
	axes: PactAxes,
	offsetTiles: number = PACTS_VIEW.card.offsetTiles,
): { x: number; z: number } {
	const d = offsetTiles * TILE_SIZE;
	return { x: x - axes.upX * d, z: z - axes.upZ * d };
}

/**
 * Altar k's card centre: pactCardCentre with the layout's offset, then layout.shiftTiles along screen-right away from
 * the other altars (the side of the altars' mean it stands on; no shift for an altar on the mean). Pure.
 */
export function pactCardCentreAt(
	k: number,
	altarX: ReadonlyArray<number>,
	altarZ: ReadonlyArray<number>,
	axes: PactAxes & PactRightAxis,
	layout: Readonly<PactCardLayout>,
): { x: number; z: number } {
	const c = pactCardCentre(altarX[k], altarZ[k], axes, layout.offsetTiles);
	if (layout.shiftTiles === 0 || altarX.size() < 2) return c;
	let mx = 0;
	let mz = 0;
	for (let i = 0; i < altarX.size(); i++) {
		mx += altarX[i];
		mz += altarZ[i];
	}
	mx /= altarX.size();
	mz /= altarX.size();
	const side = (altarX[k] - mx) * axes.rightX + (altarZ[k] - mz) * axes.rightZ;
	if (side === 0) return c;
	const d = (side > 0 ? layout.shiftTiles : -layout.shiftTiles) * TILE_SIZE;
	return { x: c.x + axes.rightX * d, z: c.z + axes.rightZ * d };
}

/**
 * The card's SurfaceGui CanvasSize, px: the layout's widthTiles x canvasPxPerTile wide; tall enough that, laid on a face
 * of widthTiles x depthTiles and foreshortened by the camera's pitch, a glyph reads unsquashed (the combo shout's rule,
 * shared/view/hud shoutCanvasSize).
 */
export function pactCardCanvasSize(
	pitchDeg: number,
	layout: Readonly<PactCardLayout> = PACT_CARD_LAYOUT,
): readonly [number, number] {
	const w = math.round(layout.widthTiles * PACTS_VIEW.card.canvasPxPerTile);
	const h = (w * layout.depthTiles * math.sin(math.rad(pitchDeg))) / layout.widthTiles;
	return [w, math.max(1, math.round(h))];
}

/** The cards show while view player `view` stands within card.nearRoomTiles of either altar (and the altars stand). */
export function pactCardsNear(state: Readonly<SimState>, view: number): boolean {
	const p = state.pacts;
	if (p === undefined || p.room < 0) return false;
	const pl = playerAt(state, viewOf(state, view));
	const r = (PACTS_VIEW.card.nearRoomTiles + PACTS_VIEW.card.offsetTiles) * TILE_SIZE;
	for (let k = 0; k < p.altarX.size(); k++) {
		const dx = pl.x - p.altarX[k];
		const dz = pl.z - p.altarZ[k];
		if (dx * dx + dz * dz <= r * r) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------------------------
// The HUD: the hint, the draft title, the Horde chip

/**
 * The HUD's shrine hint on an altar (docs/FORTUNE.md FO7): the pact's title, then `pact.accept` with `key` (the
 * binding-aware shrine key); on touch (`key` undefined) the title alone (the shrine button reads Accept).
 */
export function pactHintText(kind: number, key: string | undefined, str: PactStr): string {
	const title = str(PACT_STRINGS.title[kind] ?? PACT_STRINGS.title[PactKind.GREED]);
	if (key === undefined) return title;
	return `${title}${PACT_HINT_SEPARATOR}${str(PACT_STRINGS.accept, { key })}`;
}

/** The draft overlay's title key for a draft of pact kind `draftKind` (shared/sim pactDraftKind): Greed's or the usual. */
export function draftTitleKey(draftKind: number): string {
	return draftKind === PactKind.GREED ? PACT_STRINGS.draftTitleGreed : DRAFT_TITLE;
}

/** The status corner's Horde chip shows: the Horde is armed (taken, no room roused yet). Party state. */
export function hordeChipShown(state: Readonly<SimState>): boolean {
	return hordePhase(state) === HordePhase.ARMED;
}

/**
 * The status panel's chip width (reference px): the status row's width less one boost cell and a gap, so the chip
 * and the first running boost share the boost row (`rowWidth` statusRowMaxWidth, `cellWidth` a boost cell's).
 */
export function hordeChipWidth(rowWidth: number, cellWidth: number, gap: number): number {
	return math.max(0, rowWidth - cellWidth - gap);
}

/** HORDE_CHIP_VIEW re-read for the client (one import for the chip). */
export const HORDE_CHIP = HORDE_CHIP_VIEW;

// ---------------------------------------------------------------------------------------------
// The Horde in the world

/** The horde room's encounter id while its fight is on (FIGHT, TELEGRAPH, WAVE), else -1: its edges show `roomEdge.horde`. */
export function hordeLiveRoom(state: Readonly<SimState>): number {
	const phase = hordePhase(state);
	if (phase !== HordePhase.FIGHT && phase !== HordePhase.TELEGRAPH && phase !== HordePhase.WAVE) return -1;
	return state.pacts!.horde.room;
}

/**
 * A kill pop at (x, z) belongs to the horde room (its doubled pay: drawn in the Horde colour with the x2 mark): a horde
 * room was roused on this floor and (x, z) lies in its record's bounds. The sim's pops carry no member id, so a stray
 * enemy of another room killed inside the horde room's bounds reads as one too (rare; presentation only).
 */
export function inHordeRoom(state: Readonly<SimState>, x: number, z: number): boolean {
	const p = state.pacts;
	if (p === undefined || p.horde.room < 0) return false;
	const r = state.score?.rooms[p.horde.record];
	if (r === undefined) return false;
	return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

/**
 * Wave 2's spawn rings' fill this frame, 0..1 over the telegraph (tick + alpha against waveDueTick and the run's
 * waveTelegraphTicks), or -1 when no telegraph runs. A 0-tick telegraph is full at once.
 */
export function hordeWaveFill(state: Readonly<SimState>, alpha: number): number {
	const p = state.pacts;
	if (p === undefined || hordePhase(state) !== HordePhase.TELEGRAPH) return -1;
	const len = p.config.waveTelegraphTicks;
	if (len <= 0) return 1;
	const start = p.horde.waveDueTick - len;
	return math.clamp((state.tick + alpha - start) / len, 0, 1);
}

/** A ring's disc radius share (fillFrom .. 1) for `fill` (0..1); reduced motion (motion 0): full at once. */
export function hordeRingRadiusShare(fill: number, motion: number): number {
	const R = PACTS_VIEW.horde.ring;
	if (motion <= 0) return 1;
	const u = math.clamp(fill, 0, 1);
	return R.fillFrom + (1 - R.fillFrom) * u;
}

/** A ring's disc opacity for `fill`: climbs to fillOpacity over the telegraph (the reduced-motion cue as well). */
export function hordeRingFillOpacity(fill: number): number {
	return PACTS_VIEW.horde.ring.fillOpacity * math.clamp(fill, 0, 1);
}

// ---------------------------------------------------------------------------------------------
// The Greed take

/**
 * Greed's deal gap (FORTUNE.md: the deal opens at 0.5 s): the draft reveal may begin `dealDelaySec` of unpaused real
 * time after a Greed draft opened; an ordinary draft at once. Stepped once per frame by the client's draft reveal.
 */
export class GreedDealGap {
	private wasOpen = false;
	private waitSec = 0;

	/** A new run / no draft: forget. */
	reset(): void {
		this.wasOpen = false;
		this.waitSec = 0;
	}

	/**
	 * This frame: the local draft `open`, it is Greed's deal (`greed`), `dt` real seconds (0 while paused). True when
	 * the reveal may begin.
	 */
	step(open: boolean, greed: boolean, dt: number): boolean {
		if (!open) {
			this.reset();
			return false;
		}
		if (!this.wasOpen) {
			this.wasOpen = true;
			this.waitSec = greed ? PACTS_VIEW.greed.dealDelaySec : 0;
			return this.waitSec <= 0;
		}
		this.waitSec -= math.max(dt, 0);
		return this.waitSec <= 0;
	}
}

/** The take pulse at `ageSec` (radius in tiles, opacity), or undefined once over. Reduced motion: no growth. */
export function greedPulseAt(ageSec: number, motion: number): { radiusTiles: number; opacity: number } | undefined {
	const P = PACTS_VIEW.greed.pulse;
	if (!(ageSec >= 0) || ageSec >= P.sec) return undefined;
	const u = ageSec / P.sec;
	const ease = 1 - (1 - u) * (1 - u);
	const radiusTiles = motion > 0 ? P.startTiles + (P.endTiles - P.startTiles) * ease : P.endTiles;
	return { radiusTiles, opacity: P.maxOpacity * (1 - u) };
}

// ---------------------------------------------------------------------------------------------
// KV_PactLabel

/** The debug label over altar `kind` (developer English): kind, the view player's availability, the Horde phase. */
export function pactDebugText(
	state: Readonly<SimState>,
	config: Readonly<SimConfig>,
	view: number,
	kind: number,
): string {
	const v = viewOf(state, view);
	const avail = PACT_DIM_NAMES[pactAvailability(state, config, v, kind)] ?? "?";
	const name = PACT_KIND_NAMES[kind] ?? "?";
	const phaseNames = ["idle", "armed", "fight", "telegraph", "wave", "cleared"];
	const phase = phaseNames[hordePhase(state)] ?? "?";
	const curse = kind === PactKind.GREED ? ` curse ${greedCurseFor(state, v)}` : "";
	return `${name} p${v}: ${avail === "none" ? "offered" : avail}${curse}\nhorde ${phase}`;
}
