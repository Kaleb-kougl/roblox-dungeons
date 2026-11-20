import { createContext, useContext, useEffect, useRef } from "@rbxts/react";
import { itemRefsEqual, type HudCorner, type ItemRef, type TooltipSource } from "shared/view/hud";

/**
 * The item tooltips' target registry (docs/ITEM_TOOLTIPS.md IT4, ITD2): every GuiObject that can show a tooltip (a
 * Build list row, a status panel cell, a boost cell) registers here through useTooltipTarget with its ItemRef, its
 * source (`menu`: the pause / run-over lists; `hud`: the live status panel) and, for a `hud` target, its corner panel.
 * TooltipController hit-tests the registered rects every frame (AbsolutePosition / AbsoluteSize); nothing here is a
 * button or Active and no MouseEnter is connected, so a press that starts over a HUD target still reaches the game.
 *
 * An entry is created once per mounted component and keeps its identity across the ~10 Hz snapshot re-renders: a new
 * ref / hidden refs / source / panel / clip bumps its `version` (the controller then drops its cached hit), anything
 * else leaves it untouched. Unmounting (or `enabled` false) unregisters it.
 */
export interface TooltipTarget {
	instance: GuiObject | undefined;
	ref: ItemRef;
	source: TooltipSource;
	/** `hud`: the corner panel it sits in (the tooltip goes under it; its occlusion fade blocks the tooltip). */
	panel: HudCorner | undefined;
	/** The status panel's "+N" cell: the refs it hides (the tooltip is moreTooltip of them). */
	more: ReadonlyArray<ItemRef> | undefined;
	/** The ScrollingFrame it scrolls in: only the part inside it can be hovered or tapped. */
	clip: GuiObject | undefined;
	/** Bumped whenever a field above but `instance` changes. */
	version: number;
	enabled: boolean;
}

const targets = new Set<TooltipTarget>();

/** Every registered (mounted, enabled) target. Read-only: register through useTooltipTarget. */
export function tooltipTargets(): ReadonlySet<TooltipTarget> {
	return targets;
}

/** Whether `target` is still registered (a shown or pinned tooltip whose target unmounted is dropped). */
export function tooltipTargetRegistered(target: TooltipTarget): boolean {
	return targets.has(target);
}

/** The ScrollingFrame a Build list's rows scroll in (their hover / tap is clipped to it). */
export const TooltipClipContext = createContext<GuiObject | undefined>(undefined);

/**
 * The "+N" cell's ref: never an owned item (index -1), only a stable identity; its tooltip is moreTooltip of `more`.
 */
export const MORE_CELL_REF: ItemRef = { kind: "boon", index: -1 };

function sameRefs(a: ReadonlyArray<ItemRef> | undefined, b: ReadonlyArray<ItemRef> | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	if (a.size() !== b.size()) return false;
	for (let i = 0; i < a.size(); i++) if (!itemRefsEqual(a[i], b[i])) return false;
	return true;
}

function sync(e: TooltipTarget): void {
	if (e.enabled && e.instance !== undefined) targets.add(e);
	else targets.delete(e);
}

/**
 * `useTooltipTarget`'s optional settings: the corner panel a `hud` target sits in, the refs a "+N" cell hides (its
 * tooltip lists them), and whether the target is registered at all. They become the same-named fields of the
 * `TooltipTarget`.
 */
export interface TooltipTargetOptions {
	readonly panel?: HudCorner;
	readonly more?: ReadonlyArray<ItemRef>;
	/** False: not registered (a RunItems row on the touch strip, ITD9). Default true. */
	readonly enabled?: boolean;
}

/**
 * Registers the component's GuiObject as a tooltip target; returns the stable ref callback to pass as its `ref`. The
 * object must stay a plain, non-Active GuiObject (ITD2). The clip comes from TooltipClipContext.
 */
export function useTooltipTarget(
	ref: ItemRef,
	source: TooltipSource,
	options?: TooltipTargetOptions,
): (instance: GuiObject | undefined) => void {
	const clip = useContext(TooltipClipContext);
	const panel = options?.panel;
	const more = options?.more;
	const enabled = options?.enabled !== false;
	const entry = useRef<TooltipTarget>();
	let e = entry.current;
	if (e === undefined) {
		e = { instance: undefined, ref, source, panel, more, clip, version: 0, enabled };
		entry.current = e;
	}
	const target = e;
	if (
		!itemRefsEqual(e.ref, ref) ||
		!sameRefs(e.more, more) ||
		e.source !== source ||
		e.panel !== panel ||
		e.clip !== clip
	) {
		e.ref = ref;
		e.more = more;
		e.source = source;
		e.panel = panel;
		e.clip = clip;
		e.version += 1;
	}
	if (e.enabled !== enabled) {
		e.enabled = enabled;
		sync(e);
	}
	const callback = useRef<(instance: GuiObject | undefined) => void>();
	let cb = callback.current;
	if (cb === undefined) {
		cb = (instance) => {
			target.instance = instance;
			sync(target);
		};
		callback.current = cb;
	}
	useEffect(
		() => () => {
			target.instance = undefined;
			targets.delete(target);
		},
		[],
	);
	return cb;
}
