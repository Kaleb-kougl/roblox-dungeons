/**
 * Item tooltips (claude/item-tooltips-plan.md, docs/ITEM_TOOLTIPS.md once built; presentation only): this run's owned
 * items as refs, the tooltip text model for each, the Build list's sections, the tooltip's placement and the hover /
 * focus / tap tracker that decides what is shown. Pure and headless (tooltip.spec.ts); the client's TooltipController
 * feeds the tracker every frame and ItemTooltip draws the model.
 *
 * CONTRACT (IT skeleton): the types and signatures below are what the client builds against; IT1 / IT2 filled the
 * bodies and added `TooltipLine.varRoles`, `itemNameLine`, `clearZoneIn` and `sameTooltipTarget`.
 *
 * @module
 */
import { BOONS, CURSES, DUOS, RELICS, boonMaxLevel } from "shared/sim";
import { BOOST_KINDS, boostId, boostStringKey, type ColorRole } from "shared/theme";
import { BUILD_DUO_ROLE, BUILD_EVOLVED_ROLE, boonLevelNameKey, boonLineKey, textOf, type HudText } from "./draftCards";
import { buildListRows, type BuildListRow } from "./buildHud";
import { HUD_CLEAR_ZONE, type ScreenRect } from "./footprint";
import {
	CURSE_COLOR_ROLE,
	PROGRESSION_STRINGS,
	RELIC_COLOR_ROLE,
	boonEvoDescKey,
	boonEvoNameKey,
	itemDescKey,
	itemNameKey,
	rarityColorRole,
	rarityNameKey,
} from "./progression";
import { ITEM_TOOLTIP } from "./tooltipConfig";

// --- Refs (IT1) ---------------------------------------------------------------------------------------------------

/** What an item is. A boon's evolution is still kind `boon` (its level says it evolved). */
export type ItemKind = "boon" | "duo" | "relic" | "curse" | "boost";

/** One owned item: its kind and its index in that kind's table (BOONS, DUOS, RELICS, CURSES, Boost index). */
export interface ItemRef {
	readonly kind: ItemKind;
	readonly index: number;
}

/** A stable string key of a ref ("boon:3"), for React keys and equality. */
export function itemRefKey(ref: ItemRef): string {
	return `${ref.kind}:${ref.index}`;
}

/**
 * Whether two refs name the same owned item (same kind and index). Two undefined refs are equal; one undefined ref
 * equals nothing.
 */
export function itemRefsEqual(a: ItemRef | undefined, b: ItemRef | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return a.kind === b.kind && a.index === b.index;
}

/** The snapshot facts a tooltip and the Build list read (all the local player's but `boosts`: the shown player's). */
export interface TooltipFacts {
	readonly boons: ReadonlyArray<number>;
	/** Parallel to `boons` (empty without builds: no levels). */
	readonly boonLevels: ReadonlyArray<number>;
	readonly duos: ReadonlyArray<number>;
	readonly relics: ReadonlyArray<number>;
	readonly curses: ReadonlyArray<number>;
	/** Running boosts (snapshot BoostHudEntry: Boost index and seconds left). */
	readonly boosts: ReadonlyArray<{ readonly kind: number; readonly secondsLeft: number }>;
}

// --- Model (IT1) --------------------------------------------------------------------------------------------------

/**
 * One line of a tooltip: its text as a theme key plus vars (never composed here) and the colour role it is drawn in.
 */
export interface TooltipLine {
	readonly text: HudText;
	readonly role: ColorRole;
	/**
	 * Optional colours of some of the line's vars (a duo's `{a}` / `{b}` in their boons' rarity colours, an evolution's
	 * `{evo}` in boon.evolved): the client may draw each var's text in its role (RichText), the rest in `role`.
	 */
	readonly varRoles?: Readonly<Record<string, ColorRole>>;
}

/** What ItemTooltip draws: title in its colour (level `level` / `maxLevel` at its right, 0 / 0 none), a kind line, body lines. */
export interface TooltipModel {
	readonly key: string;
	readonly title: HudText;
	readonly titleRole: ColorRole;
	readonly level: number;
	readonly maxLevel: number;
	readonly kindLine: TooltipLine;
	readonly lines: ReadonlyArray<TooltipLine>;
}

/** The tooltip of one owned item (the plan's rules table), or undefined when the ref is not owned / unknown. */
export function itemTooltip(ref: ItemRef, facts: TooltipFacts): TooltipModel | undefined {
	switch (ref.kind) {
		case "boon":
			return boonTooltip(ref, facts);
		case "duo":
			return duoTooltip(ref, facts);
		case "relic": {
			const def = facts.relics.includes(ref.index) ? RELICS[ref.index] : undefined;
			if (def === undefined) return undefined;
			return plainTooltip(ref, def.id, RELIC_COLOR_ROLE, line(TOOLTIP_STRINGS.kindRelic, DIM_ROLE));
		}
		case "curse": {
			const def = facts.curses.includes(ref.index) ? CURSES[ref.index] : undefined;
			if (def === undefined) return undefined;
			return plainTooltip(ref, def.id, CURSE_COLOR_ROLE, line(TOOLTIP_STRINGS.kindCurse, CURSE_COLOR_ROLE));
		}
		default:
			return boostTooltip(ref, facts);
	}
}

/** The status panel's "+N" cell: `{n} more` and the hidden items' names, one per line, in their colours. */
export function moreTooltip(refs: ReadonlyArray<ItemRef>, facts: TooltipFacts): TooltipModel {
	const lines: TooltipLine[] = [];
	for (const r of refs) {
		const name = itemNameLine(r, facts);
		if (name !== undefined) lines.push(name);
	}
	return {
		key: `${MORE_KEY_PREFIX}${refs.size()}`,
		title: textOf(PROGRESSION_STRINGS.buildTitle),
		titleRole: TEXT_ROLE,
		level: 0,
		maxLevel: 0,
		kindLine: { text: textOf(TOOLTIP_STRINGS.more, { count: refs.size() }), role: DIM_ROLE },
		lines,
	};
}

/**
 * An owned item's name as one line in its colour (moreTooltip's body): a boon by its level's name (the evolution's
 * at its top level, in boon.evolved), a duo in boon.duo, a relic / curse in their roles, a boost in its kind's colour.
 * undefined when the ref is not owned.
 */
export function itemNameLine(ref: ItemRef, facts: TooltipFacts): TooltipLine | undefined {
	const m = itemTooltip(ref, facts);
	return m === undefined ? undefined : { text: m.title, role: m.titleRole };
}

/** The role of the tooltip's plain body text and of its dim lines (kind line, Next, recipe, seconds left). */
const TEXT_ROLE: ColorRole = "uiText";
const DIM_ROLE: ColorRole = "uiTextDim";
/** moreTooltip's model key: `more:<count>`. */
const MORE_KEY_PREFIX = "more:";

function line(key: string, role: ColorRole): TooltipLine {
	return { text: textOf(key), role };
}

function boonTooltip(ref: ItemRef, facts: TooltipFacts): TooltipModel | undefined {
	const b = ref.index;
	const i = facts.boons.indexOf(b);
	const def = BOONS[b];
	if (i < 0 || def === undefined) return undefined;
	const id = def.id;
	const level = facts.boonLevels[i] ?? 0;
	const max = boonMaxLevel(b);
	const rarityRole = rarityColorRole(def.rarity);
	const rarityKind: TooltipLine = {
		text: textOf(TOOLTIP_STRINGS.kindBoon, undefined, { rarity: rarityNameKey(def.rarity) }),
		role: DIM_ROLE,
	};
	if (level <= 0 || max <= 1) {
		// No levels (a legendary, or a run without builds): its one line.
		return {
			key: itemRefKey(ref),
			title: textOf(itemNameKey(id)),
			titleRole: rarityRole,
			level: 0,
			maxLevel: 0,
			kindLine: rarityKind,
			lines: [line(itemDescKey(id), TEXT_ROLE)],
		};
	}
	if (level >= max) {
		// Evolved: the evolution's name and line, "Evolution of {boon}".
		return {
			key: itemRefKey(ref),
			title: textOf(boonLevelNameKey(b, level)),
			titleRole: BUILD_EVOLVED_ROLE,
			level: max,
			maxLevel: max,
			kindLine: {
				text: textOf(TOOLTIP_STRINGS.kindEvolved, undefined, { boon: itemNameKey(id) }),
				role: BUILD_EVOLVED_ROLE,
				varRoles: { boon: rarityRole },
			},
			lines: [line(boonLineKey(b, level), TEXT_ROLE)],
		};
	}
	const after: TooltipLine =
		level + 1 >= max
			? {
					text: textOf(TOOLTIP_STRINGS.evolves, undefined, {
						evo: boonEvoNameKey(id),
						desc: boonEvoDescKey(id),
					}),
					role: DIM_ROLE,
					varRoles: { evo: BUILD_EVOLVED_ROLE },
			  }
			: { text: textOf(TOOLTIP_STRINGS.next, undefined, { desc: boonLineKey(b, level + 1) }), role: DIM_ROLE };
	return {
		key: itemRefKey(ref),
		title: textOf(boonLevelNameKey(b, level)),
		titleRole: rarityRole,
		level,
		maxLevel: max,
		kindLine: rarityKind,
		lines: [line(boonLineKey(b, level), TEXT_ROLE), after],
	};
}

function duoTooltip(ref: ItemRef, facts: TooltipFacts): TooltipModel | undefined {
	const duo = facts.duos.includes(ref.index) ? DUOS[ref.index] : undefined;
	if (duo === undefined) return undefined;
	const a = BOONS[duo.a];
	const b = BOONS[duo.b];
	const lines: TooltipLine[] = [line(itemDescKey(duo.id), TEXT_ROLE)];
	if (a !== undefined && b !== undefined) {
		lines.push({
			text: textOf(TOOLTIP_STRINGS.duoFrom, undefined, { a: itemNameKey(a.id), b: itemNameKey(b.id) }),
			role: DIM_ROLE,
			varRoles: { a: rarityColorRole(a.rarity), b: rarityColorRole(b.rarity) },
		});
	}
	return {
		key: itemRefKey(ref),
		title: textOf(itemNameKey(duo.id)),
		titleRole: BUILD_DUO_ROLE,
		level: 0,
		maxLevel: 0,
		kindLine: line(TOOLTIP_STRINGS.kindDuo, BUILD_DUO_ROLE),
		lines,
	};
}

function plainTooltip(ref: ItemRef, id: string, role: ColorRole, kindLine: TooltipLine): TooltipModel {
	return {
		key: itemRefKey(ref),
		title: textOf(itemNameKey(id)),
		titleRole: role,
		level: 0,
		maxLevel: 0,
		kindLine,
		lines: [line(itemDescKey(id), TEXT_ROLE)],
	};
}

/** The running boost of Boost index `kind` in `facts.boosts`, or undefined. */
function runningBoost(
	facts: TooltipFacts,
	kind: number,
): { readonly kind: number; readonly secondsLeft: number } | undefined {
	for (const e of facts.boosts) if (e.kind === kind) return e;
	return undefined;
}

/** `{seconds} s left`: the snapshot's tenths rounded up to whole seconds (the tooltip ticks once a second). */
function secondsLeftText(secondsLeft: number): HudText {
	return textOf(TOOLTIP_STRINGS.secondsLeft, { seconds: math.max(0, math.ceil(secondsLeft - SECONDS_EPSILON)) });
}
/** Below this a quantised tenths value counts as whole (12.0000001 shows 12). */
const SECONDS_EPSILON = 1e-6;

function boostTooltip(ref: ItemRef, facts: TooltipFacts): TooltipModel | undefined {
	const k = BOOST_KINDS[ref.index];
	const e = runningBoost(facts, ref.index);
	if (k === undefined || e === undefined) return undefined;
	return {
		key: itemRefKey(ref),
		title: textOf(boostStringKey(k, "name")),
		titleRole: boostId(k),
		level: 0,
		maxLevel: 0,
		kindLine: line(TOOLTIP_STRINGS.kindBoost, DIM_ROLE),
		lines: [line(boostStringKey(k, "desc"), TEXT_ROLE), { text: secondsLeftText(e.secondsLeft), role: DIM_ROLE }],
	};
}

// --- Build list sections (IT1) ------------------------------------------------------------------------------------

/** A section of the Build list, in the order `buildListSections` emits them. */
export type BuildSectionKind = "boons" | "duos" | "relics" | "curses" | "boosts";

/**
 * One section of the pause / run-over Build list: its heading and its rows (never empty: `buildListSections` leaves an
 * empty section out).
 */
export interface BuildListSection {
	readonly kind: BuildSectionKind;
	readonly title: HudText;
	readonly rows: ReadonlyArray<BuildListRow>;
}

/**
 * The pause / run-over Build list in sections (Boons, Duos, Relics, Curses, then Boosts when `withBoosts`); empty
 * sections left out; empty for nothing owned. Boon / duo rows exactly as buildListRows makes them. Relic / curse rows:
 * name in their role, no level, their line. Boost rows: name in the kind's colour, no level, `{seconds} s left` as the
 * row's line (the full description is the tooltip's: its "for 30 s" would read like the time left).
 */
export function buildListSections(facts: TooltipFacts, withBoosts: boolean): BuildListSection[] {
	const out: BuildListSection[] = [];
	const push = (kind: BuildSectionKind, title: string, rows: BuildListRow[]) => {
		if (rows.size() > 0) out.push({ kind, title: textOf(title), rows });
	};
	push("boons", TOOLTIP_STRINGS.sectionBoons, buildListRows(facts.boons, facts.boonLevels, []));
	push("duos", TOOLTIP_STRINGS.sectionDuos, buildListRows([], [], facts.duos));
	const relics: BuildListRow[] = [];
	for (const x of facts.relics) {
		const def = RELICS[x];
		if (def !== undefined) relics.push(plainRow(`r${x}`, def.id, RELIC_COLOR_ROLE, { kind: "relic", index: x }));
	}
	push("relics", TOOLTIP_STRINGS.sectionRelics, relics);
	const curses: BuildListRow[] = [];
	for (const c of facts.curses) {
		const def = CURSES[c];
		if (def !== undefined) curses.push(plainRow(`c${c}`, def.id, CURSE_COLOR_ROLE, { kind: "curse", index: c }));
	}
	push("curses", TOOLTIP_STRINGS.sectionCurses, curses);
	if (withBoosts) {
		const boosts: BuildListRow[] = [];
		for (const e of facts.boosts) {
			const k = BOOST_KINDS[e.kind];
			if (k === undefined) continue;
			boosts.push({
				key: `x${e.kind}`,
				name: textOf(boostStringKey(k, "name")),
				level: "",
				desc: secondsLeftText(e.secondsLeft),
				color: boostId(k),
				ref: { kind: "boost", index: e.kind },
			});
		}
		push("boosts", TOOLTIP_STRINGS.sectionBoosts, boosts);
	}
	return out;
}

function plainRow(key: string, id: string, color: ColorRole, ref: ItemRef): BuildListRow {
	return { key, name: textOf(itemNameKey(id)), level: "", desc: textOf(itemDescKey(id)), color, ref };
}

// --- Placement (IT2) ----------------------------------------------------------------------------------------------

/** Who shows the tooltip: a modal list (pause, run over) or the live in-run HUD. */
export type TooltipSource = "menu" | "hud";

/**
 * What `tooltipPlacement` reads. Every rect and size is in screen px in one coordinate space (the tooltip's ScreenGui).
 */
export interface PlacementInput {
	/** The hovered / focused target. */
	readonly anchor: ScreenRect;
	/** The tooltip's measured size. */
	readonly size: { readonly w: number; readonly h: number };
	/** The safe area (px) it must stay inside. */
	readonly safe: ScreenRect;
	readonly source: TooltipSource;
	/** `hud` only: the panel the anchor sits in (the tooltip goes under it, never at the pointer). */
	readonly panel?: ScreenRect;
	/** The gap to the anchor / panel, px. */
	readonly offset: number;
}

/**
 * The tooltip's top-left (px).
 *
 * `menu`: right of the anchor (top-aligned), else left, else below (left-aligned), else above; a side is taken when
 * the tooltip fits the safe area along that side's axis, then the other axis is clamped into the safe area. When no
 * side fits, the side that needs the smallest move is clamped into the safe area (a tooltip larger than the safe area
 * keeps its top-left corner on the safe area's).
 *
 * `hud`: under `panel` (the anchor's corner panel; the anchor itself without one), left-aligned with it; else right
 * of the panel (top-aligned); else under the clear zone or above it (left-aligned with the panel). Never at the
 * pointer, and never overlapping HUD_CLEAR_ZONE (a fraction of `safe`): the first candidate that fits the safe area
 * (clamped) without touching the zone wins; when none can (a tooltip too big for every strip around the zone), the
 * clamped candidate that covers the least of the zone.
 */
export function tooltipPlacement(input: PlacementInput): { readonly x: number; readonly y: number } {
	return input.source === "hud" ? hudPlacement(input) : menuPlacement(input);
}

/** `v` moved into [lo, lo + room - size] (lo when it does not fit). Never math.clamp: its min may pass its max. */
function clampInto(v: number, lo: number, room: number, size: number): number {
	return math.max(lo, math.min(v, lo + room - size));
}

function menuPlacement(input: PlacementInput): { readonly x: number; readonly y: number } {
	const a = input.anchor;
	const safe = input.safe;
	const w = input.size.w;
	const h = input.size.h;
	const off = input.offset;
	const right = a.x + a.w + off;
	const left = a.x - off - w;
	const below = a.y + a.h + off;
	const above = a.y - off - h;
	const safeRight = safe.x + safe.w;
	const safeBottom = safe.y + safe.h;
	const clampX = (x: number) => clampInto(x, safe.x, safe.w, w);
	const clampY = (y: number) => clampInto(y, safe.y, safe.h, h);
	if (right + w <= safeRight) return { x: right, y: clampY(a.y) };
	if (left >= safe.x) return { x: left, y: clampY(a.y) };
	if (below + h <= safeBottom) return { x: clampX(a.x), y: below };
	if (above >= safe.y) return { x: clampX(a.x), y: above };
	// Nothing fits: the side needing the smallest move, clamped (ties: the plan's order).
	const moves = [right + w - safeRight, safe.x - left, below + h - safeBottom, safe.y - above];
	let best = 0;
	for (let i = 1; i < moves.size(); i++) if (moves[i] < moves[best]) best = i;
	if (best === 0) return { x: clampX(right), y: clampY(a.y) };
	if (best === 1) return { x: clampX(left), y: clampY(a.y) };
	if (best === 2) return { x: clampX(a.x), y: clampY(below) };
	return { x: clampX(a.x), y: clampY(above) };
}

/** HUD_CLEAR_ZONE in px inside `safe` (footprint.ts clearZoneRect for any safe rect). */
export function clearZoneIn(safe: ScreenRect): ScreenRect {
	const z = HUD_CLEAR_ZONE;
	return {
		x: safe.x + safe.w * z.x0,
		y: safe.y + safe.h * z.y0,
		w: safe.w * (z.x1 - z.x0),
		h: safe.h * (z.y1 - z.y0),
	};
}

/** The area two rects share (0 when they only touch). */
function overlapArea(ax: number, ay: number, aw: number, ah: number, b: ScreenRect): number {
	const ow = math.min(ax + aw, b.x + b.w) - math.max(ax, b.x);
	const oh = math.min(ay + ah, b.y + b.h) - math.max(ay, b.y);
	return ow > 0 && oh > 0 ? ow * oh : 0;
}

function hudPlacement(input: PlacementInput): { readonly x: number; readonly y: number } {
	const p = input.panel ?? input.anchor;
	const safe = input.safe;
	const w = input.size.w;
	const h = input.size.h;
	const off = input.offset;
	const zone = clearZoneIn(safe);
	// Candidates in order: under the panel, right of it, under the clear zone, above it (in the band over the zone).
	const xs = [p.x, p.x + p.w + off, p.x, p.x + p.w + off];
	const ys = [p.y + p.h + off, p.y, zone.y + zone.h, zone.y - h];
	let bestX = 0;
	let bestY = 0;
	let bestArea = math.huge;
	for (let i = 0; i < xs.size(); i++) {
		const x = clampInto(xs[i], safe.x, safe.w, w);
		const y = clampInto(ys[i], safe.y, safe.h, h);
		const area = overlapArea(x, y, w, h, zone);
		if (area <= 0) return { x, y };
		if (area < bestArea) {
			bestArea = area;
			bestX = x;
			bestY = y;
		}
	}
	return { x: bestX, y: bestY };
}

// --- Hover / focus / tap tracker (IT2) ----------------------------------------------------------------------------

/** A target the pointer / selection / tap is on. */
export interface TooltipTargetHit {
	readonly ref: ItemRef;
	readonly rect: ScreenRect;
	readonly source: TooltipSource;
	/** `hud`: the panel the target sits in (placement). */
	readonly panel?: ScreenRect;
	/** The "+N" cell: the refs it hides (the tooltip is moreTooltip of them). */
	readonly more?: ReadonlyArray<ItemRef>;
}

/** One frame's input to the tracker (the client's TooltipController builds it). */
export interface HoverFrame {
	readonly nowSec: number;
	/** The mouse position (px) when the aim device is the mouse, else undefined (no hover at all). */
	readonly pointer?: { readonly x: number; readonly y: number };
	/** The registered target under the pointer, if any. */
	readonly hit?: TooltipTargetHit;
	/** The gamepad-selected target (GuiService.SelectedObject is a registered target), if any. */
	readonly focus?: TooltipTargetHit;
	/** A touch tap this frame: on a target, or "elsewhere". */
	readonly tap?: TooltipTargetHit | "elsewhere";
	/** Attack or Alt is held / was pressed this frame. */
	readonly weaponHeld: boolean;
	readonly weaponPressed: boolean;
	/** The hit's corner panel is faded by the occlusion rule (hud only). */
	readonly panelFaded: boolean;
	/** Live HUD tooltips allowed now: in a run, no draft / stage cover / pause / run over, the setting on. */
	readonly hudAllowed: boolean;
}

/** What the tracker shows. */
export interface HoverShown {
	readonly target: TooltipTargetHit;
	/** Pinned by a tap (stays until tapped again or elsewhere). */
	readonly pinned: boolean;
	readonly shownAtSec: number;
}

/** Two targets are the same item (ref, source and, for a "+N" cell, the same hidden refs); rects are not compared. */
export function sameTooltipTarget(a: TooltipTargetHit | undefined, b: TooltipTargetHit | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	if (a === b) return true;
	if (a.source !== b.source || !itemRefsEqual(a.ref, b.ref)) return false;
	const am = a.more;
	const bm = b.more;
	if (am === undefined || bm === undefined) return am === bm;
	if (am.size() !== bm.size()) return false;
	for (let i = 0; i < am.size(); i++) if (!itemRefsEqual(am[i], bm[i])) return false;
	return true;
}

function sameRect(a: ScreenRect | undefined, b: ScreenRect | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Same target drawn at the same place (a new rect or panel needs a new HoverShown: the client re-places it). */
function sameShownTarget(a: TooltipTargetHit, b: TooltipTargetHit): boolean {
	return sameTooltipTarget(a, b) && sameRect(a.rect, b.rect) && sameRect(a.panel, b.panel);
}

/**
 * Dwell / stillness / press / fade / gate rules (ITEM_TOOLTIP), focus beats hover, a tap pins and a second tap closes.
 *
 * Per frame, in priority order: the gamepad `focus` (at once); a target pinned by a tap (touch: a tap on a target pins
 * it, the same target again or "elsewhere" unpins); the pointer's hover (`pointer` and `hit` both set). A `menu`
 * hover shows after `menuDwellSec` on the same target. A `hud` hover shows after `hudDwellSec` with the pointer moved
 * less than `hudStillPx` since the dwell began, and is blocked (hidden at once, its dwell restarting once unblocked)
 * while `!hudAllowed`, `weaponHeld`, `panelFaded` or within `hudAfterPressSec` of a `weaponPressed`; once shown,
 * moving inside the target keeps it. A new target restarts the dwell. A pinned `hud` target unpins while
 * `!hudAllowed`.
 *
 * Returns the same HoverShown object for as long as the same target shows at the same rect (no allocation on a quiet
 * frame); a new object when the target, its rect / panel or `pinned` changes (`shownAtSec` kept across a rect change).
 * The client calls reset() when its list closes (pause resumed, run-over panel gone) so no pin outlives it.
 */
export class HoverTracker {
	private shown: HoverShown | undefined;
	private pinned: TooltipTargetHit | undefined;
	/** The hover being dwelt on, when the dwell began, and the pointer there. */
	private dwell: TooltipTargetHit | undefined;
	private dwellSec = 0;
	private dwellX = 0;
	private dwellY = 0;
	/** The hover target is shown (it stays while the pointer moves inside it). */
	private hoverShown = false;
	private pressSec = -math.huge;

	step(frame: HoverFrame): HoverShown | undefined {
		const now = frame.nowSec;
		if (frame.weaponPressed) this.pressSec = now;
		const tap = frame.tap;
		if (tap === "elsewhere") this.pinned = undefined;
		else if (tap !== undefined) this.pinned = sameTooltipTarget(this.pinned, tap) ? undefined : tap;
		if (this.pinned !== undefined && this.pinned.source === "hud" && !frame.hudAllowed) this.pinned = undefined;
		const hover = this.stepHover(frame);
		if (frame.focus !== undefined) return this.show(frame.focus, false, now);
		if (this.pinned !== undefined) return this.show(this.pinned, true, now);
		if (hover !== undefined) return this.show(hover, false, now);
		this.shown = undefined;
		return undefined;
	}

	reset(): void {
		this.shown = undefined;
		this.pinned = undefined;
		this.dwell = undefined;
		this.hoverShown = false;
		this.pressSec = -math.huge;
	}

	/** The hover target to show this frame, or undefined (dwell / stillness / gates). */
	private stepHover(frame: HoverFrame): TooltipTargetHit | undefined {
		const pointer = frame.pointer;
		const hit = frame.hit;
		const now = frame.nowSec;
		if (pointer === undefined || hit === undefined) {
			this.dwell = undefined;
			this.hoverShown = false;
			return undefined;
		}
		if (!sameTooltipTarget(this.dwell, hit)) this.beginDwell(hit, now, pointer.x, pointer.y);
		else this.dwell = hit;
		const T = ITEM_TOOLTIP;
		if (hit.source === "menu") {
			if (!this.hoverShown && now - this.dwellSec >= T.menuDwellSec) this.hoverShown = true;
			return this.hoverShown ? hit : undefined;
		}
		const blocked =
			!frame.hudAllowed ||
			frame.weaponHeld ||
			frame.weaponPressed ||
			frame.panelFaded ||
			now - this.pressSec < T.hudAfterPressSec;
		if (blocked) {
			this.beginDwell(hit, now, pointer.x, pointer.y);
			return undefined;
		}
		if (this.hoverShown) return hit;
		const dx = pointer.x - this.dwellX;
		const dy = pointer.y - this.dwellY;
		if (dx * dx + dy * dy >= T.hudStillPx * T.hudStillPx) {
			this.beginDwell(hit, now, pointer.x, pointer.y);
			return undefined;
		}
		if (now - this.dwellSec < T.hudDwellSec) return undefined;
		this.hoverShown = true;
		return hit;
	}

	private beginDwell(hit: TooltipTargetHit, now: number, x: number, y: number): void {
		this.dwell = hit;
		this.dwellSec = now;
		this.dwellX = x;
		this.dwellY = y;
		this.hoverShown = false;
	}

	private show(target: TooltipTargetHit, pinned: boolean, now: number): HoverShown {
		const cur = this.shown;
		if (cur !== undefined && cur.pinned === pinned && sameShownTarget(cur.target, target)) return cur;
		const keep = cur !== undefined && sameTooltipTarget(cur.target, target);
		const fresh: HoverShown = { target, pinned, shownAtSec: keep ? cur.shownAtSec : now };
		this.shown = fresh;
		return fresh;
	}
}

// --- Strings (IT3) ------------------------------------------------------------------------------------------------

/** Theme string keys the tooltips and the sectioned Build list read (IT3 adds them to every pack and l10n context). */
export const TOOLTIP_STRINGS = {
	/** `{rarity} boon` (rarity: a varKey to boon.rarity.*). */
	kindBoon: "hud.tip.kind.boon",
	/** `Evolution of {boon}` (varKey). */
	kindEvolved: "hud.tip.kind.evolved",
	kindDuo: "hud.tip.kind.duo",
	kindRelic: "hud.tip.kind.relic",
	kindCurse: "hud.tip.kind.curse",
	kindBoost: "hud.tip.kind.boost",
	/** `Next: {desc}` (varKey). */
	next: "hud.tip.next",
	/** `Evolves into {evo}: {desc}` (varKeys). */
	evolves: "hud.tip.evolves",
	/** `From {a} + {b}` (varKeys). */
	duoFrom: "hud.tip.duoFrom",
	/** `{seconds} s left`. */
	secondsLeft: "hud.tip.secondsLeft",
	/** `{count} more`. */
	more: "hud.tip.more",
	sectionBoons: "hud.build.boons",
	sectionDuos: "hud.build.duos",
	sectionRelics: "hud.build.relics",
	sectionCurses: "hud.build.curses",
	sectionBoosts: "hud.build.boosts",
	/** Upright pause panel: show the Build list / show the map (ITD7). */
	pauseBuild: "pause.build",
	pauseMap: "pause.map",
} as const;
