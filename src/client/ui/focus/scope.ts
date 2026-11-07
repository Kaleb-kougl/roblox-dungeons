import React, { useContext, useEffect, useRef } from "@rbxts/react";
import type { FocusLayer, MenuPadAction, MenuPadInput, PadContext, PadSurface } from "shared/view/menu";

/** A ref to a GuiObject (useRef<TextButton>() and friends). */
export interface GuiRef {
	readonly current: GuiObject | undefined;
}

/**
 * A focus scope's options (docs/GAMEPAD_MENUS.md section 1, GM2). Read again on every render: a scope can change its
 * layer, surface, default, pad context or handler as its surface changes (the pause overlay's confirm, a tab).
 */
export interface FocusScopeOptions {
	/** Unique among mounted scopes; a new id is a new registration (a new mount order). */
	readonly id: string;
	/** Its layer (shared/view/menu FOCUS_LAYERS): the topmost active scope owns the pad. */
	readonly layer: FocusLayer;
	/** Its pad table (shared/view/menu PAD_SURFACES): what B, the bumpers, triggers, X / Y and the right stick mean. */
	readonly surface: PadSurface;
	/** The button selected when nothing usable is (it gets GAMEPAD_MENU.defaultSelectionOrder); else Select(root). */
	readonly defaultRef?: GuiRef;
	/** Session focus memory (GMD9): the last selected button comes back when the scope owns the pad again. */
	readonly memoryKey?: string;
	/** False: mounted but not taking the pad (hidden, or the invite toasts until Y). Default true. */
	readonly active?: boolean;
	/** The surface facts the pad table reads (absent = false). */
	readonly padContext?: PadContext;
	/**
	 * The scope's main list (a ScrollingFrame; GM5): the right stick scrolls it by GAMEPAD_MENU.scrollStepPx per step
	 * (FocusController, with the list end's haptic tick), and `scroll` never reaches `onPadAction`. Pass
	 * `padContext.scrollList` while it is shown, so the hint bar names the stick.
	 */
	readonly scrollRef?: GuiRef;
	/**
	 * What a pad press means here, while this scope owns the pad: B (back / close / resume / cancel / holdExit), the
	 * bumpers and triggers (tabPrev / tabNext / subTabPrev / subTabNext), X / Y (shortcutX / shortcutY) and right-stick
	 * steps (scroll, `input.x` / `input.y` the stick's axes). Never called for `none` or `select`.
	 */
	readonly onPadAction?: (action: MenuPadAction, input: MenuPadInput) => void;
}

/** One mounted scope, as the registry sees it. */
export interface FocusScopeHandle {
	/** The latest options (this render's). */
	options(): FocusScopeOptions;
	/** The scope's root GuiObject, or undefined while its surface is not drawn. */
	root(): GuiObject | undefined;
}

/** Where scopes register (client FocusController); HudController and LoadingController provide it. */
export interface FocusScopeRegistry {
	/** Registers a mounted scope; the returned function unregisters it. */
	register(handle: FocusScopeHandle): () => void;
	/** A scope's options changed (layer, surface, active, memory): the owner and the selection are checked again. */
	changed(): void;
	/**
	 * A MenuButton was activated (`disabled`: it is greyed out and did nothing). On the pad, right after A, this is the
	 * menu's confirm / disabled-press haptic (GM9); anything else ignores it.
	 */
	buttonPressed(disabled: boolean): void;
}

class NoRegistry implements FocusScopeRegistry {
	register(): () => void {
		return () => undefined;
	}

	changed(): void {
		// Nothing is registered, so nothing to check.
	}

	buttonPressed(): void {
		// No pad feedback without a registry.
	}
}

/** The focus scope registry (FocusController); a tree without a provider registers nowhere. */
export const FocusScopesContext = React.createContext<FocusScopeRegistry>(new NoRegistry());

/**
 * Registers `rootRef`'s GuiObject as a focus scope while the component is mounted (docs/GAMEPAD_MENUS.md GM2):
 * FocusController makes the root a SelectionGroup that stops on all four sides, gives the default button a negative
 * SelectionOrder, keeps a usable selection on it while it owns the pad (default / memory / recovery, gamepad only),
 * and hands it its pad actions (`onPadAction`).
 */
export function useFocusScope(rootRef: GuiRef, options: FocusScopeOptions): void {
	const registry = useContext(FocusScopesContext);
	const optionsRef = useRef(options);
	optionsRef.current = options;
	useEffect(() => {
		const handle: FocusScopeHandle = {
			options() {
				return optionsRef.current;
			},
			root() {
				return rootRef.current;
			},
		};
		return registry.register(handle);
	}, [registry, options.id]);
	useEffect(() => {
		registry.changed();
	}, [options.layer, options.surface, options.active, options.memoryKey]);
}

/** The last opening id handed out (useOpeningId): unique for the session, across every component and remount. */
let lastOpenId = 0;

/**
 * An id for the current opening of a surface: a new one (unique for the session) each time `open` goes from false to
 * true, kept while it stays open (0 before the first opening). A surface that should start on its default each time
 * it opens (the pause overlay, Options) but keep its memory while something sits over it (a panel, a confirm) puts
 * this in its memory key.
 */
export function useOpeningId(open: boolean): number {
	const id = useRef(0);
	const wasOpen = useRef(false);
	if (open && !wasOpen.current) {
		lastOpenId += 1;
		id.current = lastOpenId;
	}
	wasOpen.current = open;
	return id.current;
}
