import { createBinding, type Binding } from "@rbxts/react";

/**
 * The combo row and meter's per-frame values (docs/COMBO.md CB6): module-level React bindings, one per drawn property
 * the ComboDisplay's frame drives, written by the client's ComboController once per rendered frame and read by
 * ComboRow / ComboMeter (ScorePanel rows 3 and 4). Like cornerFade.ts: a binding update changes the one property it is
 * bound to and never re-renders the tree, and each value is written only when it changed, so a steady combo costs no
 * property writes at all. Colours and strings are resolved by the controller (theme roles, theme strings), so the
 * components hold no theme logic of their own.
 */

/** One bound value: the binding the components read and a write that skips unchanged values. */
export class ComboUiValue<T> {
	readonly binding: Binding<T>;
	private readonly setter: (v: T) => void;
	private last: T;

	constructor(private readonly initial: T) {
		const [binding, setter] = createBinding(initial);
		this.binding = binding;
		this.setter = setter;
		this.last = initial;
	}

	/** Sets the value (no-op when unchanged; Color3 / UDim2 compare by value). */
	write(v: T): void {
		if (v === this.last) return;
		this.last = v;
		this.setter(v);
	}

	/** Back to the value it was built with (no run, an unscored run). */
	reset(): void {
		this.write(this.initial);
	}
}

const NO_COLOR = new Color3();

/** Draw order inside the score panel (ZIndexBehavior Sibling): the row's drop over the meter, the meter over row 5. */
export const COMBO_ROW_Z = 3;
export const COMBO_METER_Z = 2;

/** Every value the combo row and meter draw. */
export const COMBO_UI = {
	// --- row 3: the tier slot (left) and the multiplier (right) ---
	/** The tier name, COMBO LOST, BEST xN.N or "". */
	slotText: new ComboUiValue(""),
	slotColor: new ComboUiValue(NO_COLOR),
	/** 1 - ComboDisplayFrame.slotAlpha. */
	slotTransparency: new ComboUiValue(0),
	/** HUD_STRINGS.combo of the shown tenths ("x1.3"), RichText-escaped; wrapped in `<s>` while struck (a break). */
	multText: new ComboUiValue(""),
	/** lerp(role, combo.broken, greyMix). */
	multColor: new ComboUiValue(NO_COLOR),
	/** The tier slot's UIScale (the tier-up slam). */
	slotScale: new ComboUiValue(1),
	/** The multiplier's UIScale (the feed pop). */
	multScale: new ComboUiValue(1),
	/** The row's horizontal shake, reference px. */
	shakePx: new ComboUiValue(0),
	/** UNSTOPPABLE's shine sweep 0..1, or -1 (none). */
	shine: new ComboUiValue(-1),
	/** The crack's `-xN.N` and its drop progress 0..1, or -1 (none: hidden). */
	dropText: new ComboUiValue(""),
	drop: new ComboUiValue(-1),
	/** The drop's fall (px; 0 under reduced motion) and transparency (shared/view/hud comboDropAt). */
	dropFallPx: new ComboUiValue(0),
	dropTransparency: new ComboUiValue(0),
	// --- row 4: the meter ---
	/** Fill 0..1. */
	fill: new ComboUiValue(0),
	/** The fill's colour: the multiplier's, brightened by the pulse. */
	fillColor: new ComboUiValue(NO_COLOR),
	/** The warning blink's dim half. */
	dim: new ComboUiValue(false),
	/** The flash overlay (tier up: uiText; crack: uiHealth) and its opacity 0..1. */
	flashColor: new ComboUiValue(NO_COLOR),
	flashAlpha: new ComboUiValue(0),
	/** The track's grey (ComboDisplayFrame.trackGrey 0..1: its uiPanel lerped toward combo.broken). */
	trackGrey: new ComboUiValue(0),
	/** The shatter of the whole track: progress 0..1, or -1 (none), and the lost tier's colour. */
	shards: new ComboUiValue(-1),
	shardColor: new ComboUiValue(NO_COLOR),
} as const;

/** Every COMBO_UI value back to its initial value. */
export function resetComboUi(): void {
	for (const [, v] of pairs(COMBO_UI)) v.reset();
}
