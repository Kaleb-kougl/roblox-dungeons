/**
 * Gamepad menus (docs/GAMEPAD_MENUS.md sections 1, 2 and 5, GM1): the pure half of the client's FocusController.
 *
 *   - Focus scopes: every surface that takes the pad mounts a scope (client useFocusScope) on a layer. The pad belongs
 *     to one scope at a time, the topmost (pickFocusScope): FOCUS_LAYERS' order, then the latest mounted. While the
 *     stage cover is up nobody owns it (the join loading screen draws above the cover and still does); while a rebind
 *     capture runs nobody does either (navigation is off, as before).
 *   - Recovery: focusAction says what to do with the engine's selection (keep it, select the owner's default, restore
 *     the owner's remembered button, or clear it), from facts the client reads off Instances.
 *   - Memory: FocusMemory keeps, per scope memory key, the path (Names under the scope's root) of the button that was
 *     selected when the scope lost the pad. Session only, never stored (GMD9); a scope without a memory key opts out.
 *   - Scrolling: scrollToShow, the canvas position that keeps a selected row inside a list's frame.
 *
 * Nothing here touches Roblox APIs: the client turns GuiObjects into the plain facts below.
 */
import type { InputDeviceKind } from "shared/play";

/** A focus layer (section 1). */
export type FocusLayer = "loading" | "rebind" | "confirm" | "panel" | "invites" | "overlay" | "screen";

/**
 * Every layer, topmost first: the join loading screen (display order 30, above the stage cover), a rebind prompt, a
 * confirm (leave / skip / swap / reset), a panel (Options, Leaderboards), the invite toasts (only once jumped to by
 * Y), an overlay (pause, party, run over, outro), a menu screen (main, lobbies, lobby, credits).
 */
export const FOCUS_LAYERS: ReadonlyArray<FocusLayer> = [
	"loading",
	"rebind",
	"confirm",
	"panel",
	"invites",
	"overlay",
	"screen",
];

/** A layer's height: higher is on top (loading highest, screen 1). 0 for an unknown layer. */
export function focusLayerRank(layer: FocusLayer): number {
	const i = FOCUS_LAYERS.indexOf(layer);
	return i < 0 ? 0 : FOCUS_LAYERS.size() - i;
}

/** A mounted focus scope, as the client registers it. */
export interface FocusScopeEntry {
	readonly id: string;
	readonly layer: FocusLayer;
	/** Increases with every mount: among scopes on one layer the latest mounted owns the pad. */
	readonly mountOrder: number;
	/** False: mounted but not taking the pad (the invite toasts until Y jumps to them). Default true. */
	readonly active?: boolean;
}

/** What decides the owner and the selection besides the scopes. */
export interface FocusContext {
	/** The stage cover is up (StageController): nobody owns the pad (the loading screen above it still does). */
	readonly stageCovered: boolean;
	/** A rebind capture is listening (GuiNavigationEnabled off): nobody owns the pad and the selection is left alone. */
	readonly rebindCapturing: boolean;
	/** The last-used input device. The owner does not depend on it (B / Backspace go back by owner on any device). */
	readonly device: InputDeviceKind;
}

/** The scope that owns the pad, or undefined (none mounted, the stage cover, a rebind capture). */
export function pickFocusScope(
	mounted: ReadonlyArray<FocusScopeEntry>,
	ctx: FocusContext,
): FocusScopeEntry | undefined {
	let best: FocusScopeEntry | undefined;
	let bestRank = 0;
	for (const s of mounted) {
		if (s.active === false) continue;
		if (s.layer !== "loading" && (ctx.stageCovered || ctx.rebindCapturing)) continue;
		const rank = focusLayerRank(s.layer);
		if (rank <= 0) continue;
		if (best === undefined || rank > bestRank || (rank === bestRank && s.mountOrder > best.mountOrder)) {
			best = s;
			bestRank = rank;
		}
	}
	return best;
}

/** The engine's current selection, as the client sees it against the owner. */
export interface FocusSelection {
	/** It is the owner's root or one of its descendants. */
	readonly insideOwner: boolean;
	/** It and every ancestor are Visible (and it is on screen: under a ScreenGui that is Enabled). */
	readonly visible: boolean;
	/** It is Selectable. */
	readonly selectable: boolean;
}

/** One decision's facts. */
export interface FocusState extends FocusContext {
	/** The owning scope (pickFocusScope), or undefined. */
	readonly owner: FocusScopeEntry | undefined;
	/** The selection, or undefined (SelectedObject nil). */
	readonly selection: FocusSelection | undefined;
	/** The owner's remembered path resolves to a live, visible, selectable button under its root. */
	readonly memoryAvailable: boolean;
}

/**
 * What to do with the selection: leave it, `GuiService:Select(ownerRoot)` (lands on the default: its negative
 * SelectionOrder), select the remembered button, or set SelectedObject to nil.
 */
export type FocusAction = "keep" | "selectDefault" | "restoreMemory" | "clear";

/** The selection is usable: inside the owner, shown and selectable. */
export function selectionValid(sel: FocusSelection | undefined): boolean {
	return sel !== undefined && sel.insideOwner && sel.visible && sel.selectable;
}

/**
 * Section 2: a rebind capture leaves the selection alone; off the gamepad (mouse, touch) or with no owner the
 * selection is cleared (GMD6); on the gamepad a usable selection stays, and a missing, outside, hidden or unselectable
 * one goes back to the remembered button when it still exists, else to the owner's default.
 */
export function focusAction(state: FocusState): FocusAction {
	if (state.rebindCapturing) return "keep";
	const none = state.selection === undefined;
	if (state.device !== "gamepad" || state.owner === undefined) return none ? "keep" : "clear";
	if (selectionValid(state.selection)) return "keep";
	return state.memoryAvailable ? "restoreMemory" : "selectDefault";
}

/** A path of Instance Names from a scope's root (exclusive) down to a button (inclusive). */
export type FocusPath = ReadonlyArray<string>;

/**
 * `path` relative to `rootPath` (both from the same ancestor, e.g. PlayerGui, root first): the Names below the root,
 * or undefined when `path` is not strictly under it.
 */
export function pathUnder(path: FocusPath, rootPath: FocusPath): FocusPath | undefined {
	if (path.size() <= rootPath.size()) return undefined;
	for (let i = 0; i < rootPath.size(); i++) if (path[i] !== rootPath[i]) return undefined;
	const out = new Array<string>();
	for (let i = rootPath.size(); i < path.size(); i++) out.push(path[i]);
	return out;
}

/** Session-only focus memory (section 2, GMD9): per memory key, the last button's path under its scope's root. */
export class FocusMemory {
	private readonly paths = new Map<string, FocusPath>();

	/** Remember `path` for `key` (a copy); an empty or undefined path forgets it. */
	remember(key: string, path: FocusPath | undefined): void {
		if (path === undefined || path.size() === 0) {
			this.paths.delete(key);
			return;
		}
		const copy = new Array<string>();
		for (const name of path) copy.push(name);
		this.paths.set(key, copy);
	}

	/** The remembered path for `key`, or undefined. */
	recall(key: string): FocusPath | undefined {
		return this.paths.get(key);
	}

	forget(key: string): void {
		this.paths.delete(key);
	}

	clear(): void {
		this.paths.clear();
	}

	size(): number {
		return this.paths.size();
	}
}

/**
 * Section 5 (`followSelection`): the canvas Y that shows a row at `itemTop` (canvas pixels from the canvas top) of
 * `itemHeight` inside a frame `viewHeight` tall, `margin` from its edges, moving as little as possible from `canvasY`.
 * A row taller than the frame (less the margins) aligns its top. Never below 0; with `canvasHeight`, never past its
 * end.
 */
export function scrollToShow(
	canvasY: number,
	itemTop: number,
	itemHeight: number,
	viewHeight: number,
	margin: number,
	canvasHeight?: number,
): number {
	let y = canvasY;
	const top = itemTop - margin;
	const bottom = itemTop + itemHeight + margin;
	if (top < y || bottom - top > viewHeight) y = top;
	else if (bottom > y + viewHeight) y = bottom - viewHeight;
	if (canvasHeight !== undefined) y = math.min(y, math.max(0, canvasHeight - viewHeight));
	return math.max(0, y);
}
