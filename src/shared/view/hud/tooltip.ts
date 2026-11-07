/**
 * Item tooltips (claude/item-tooltips-plan.md, docs/ITEM_TOOLTIPS.md once built; presentation only): this run's owned
 * items as refs, the tooltip text model for each, the Build list's sections, the tooltip's placement and the hover /
 * focus / tap tracker that decides what is shown. Pure and headless (tooltip.spec.ts); the client's TooltipController
 * feeds the tracker every frame and ItemTooltip draws the model.
 *
 * CONTRACT (IT skeleton): the types and signatures below are what the client builds against. IT1 / IT2 fill the bodies.
 */
import type { ColorRole } from "shared/theme";
import type { HudText } from "./draftCards";
import type { BuildListRow } from "./buildHud";
import type { ScreenRect } from "./footprint";

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

export interface TooltipLine {
	readonly text: HudText;
	readonly role: ColorRole;
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
	error(`IT1: itemTooltip not implemented (${itemRefKey(ref)}, ${facts.boons.size()})`, 0);
}

/** The status panel's "+N" cell: `{n} more` and the hidden items' names, one per line, in their colours. */
export function moreTooltip(refs: ReadonlyArray<ItemRef>, facts: TooltipFacts): TooltipModel {
	error(`IT1: moreTooltip not implemented (${refs.size()}, ${facts.boons.size()})`, 0);
}

// --- Build list sections (IT1) ------------------------------------------------------------------------------------

export type BuildSectionKind = "boons" | "duos" | "relics" | "curses" | "boosts";

export interface BuildListSection {
	readonly kind: BuildSectionKind;
	readonly title: HudText;
	readonly rows: ReadonlyArray<BuildListRow>;
}

/**
 * The pause / run-over Build list in sections (Boons, Duos, Relics, Curses, then Boosts when `withBoosts`); empty
 * sections left out; empty for nothing owned. Boon / duo rows exactly as buildListRows makes them.
 */
export function buildListSections(facts: TooltipFacts, withBoosts: boolean): BuildListSection[] {
	error(`IT1: buildListSections not implemented (${facts.boons.size()}, ${withBoosts})`, 0);
}

// --- Placement (IT2) ----------------------------------------------------------------------------------------------

/** Who shows the tooltip: a modal list (pause, run over) or the live in-run HUD. */
export type TooltipSource = "menu" | "hud";

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

/** The tooltip's top-left (px): menu right / left / below of the anchor; hud under the panel, never in HUD_CLEAR_ZONE. */
export function tooltipPlacement(input: PlacementInput): { readonly x: number; readonly y: number } {
	error(`IT2: tooltipPlacement not implemented (${input.source})`, 0);
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

/** Dwell / stillness / press / fade / gate rules (ITEM_TOOLTIP), focus beats hover, a tap pins and a second tap closes. */
export class HoverTracker {
	step(frame: HoverFrame): HoverShown | undefined {
		error(`IT2: HoverTracker.step not implemented (${frame.nowSec})`, 0);
	}
	reset(): void {}
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
