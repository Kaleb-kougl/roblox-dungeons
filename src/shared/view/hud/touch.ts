/**
 * The touch controls' string keys (docs/MOBILE.md MB7): the labels of the nine buttons (`touch.<id>`, a TouchButtonId of
 * touchLayout) and the four hint lines that replace the key-name hints on touch (MB10). The theme contract's
 * TOUCH_STRING_KEYS lists the same keys (the theme imports nothing outside shared/theme); touchHud.spec.ts checks each
 * one exists in the placeholder pack.
 *
 * @module
 */
import type { TouchButtonId } from "./touchLayout";

export const TOUCH_STRINGS = {
	attack: "touch.attack",
	alt: "touch.alt",
	roll: "touch.roll",
	ember: "touch.ember",
	flask: "touch.flask",
	swap: "touch.swap",
	shrine: "touch.shrine",
	spectateNext: "touch.spectateNext",
	spectatePrev: "touch.spectatePrev",
	/** Replace the key-name hints on touch (MB10). */
	hintDraft: "touch.hint.draft",
	hintShrine: "touch.hint.shrine",
	hintSpectate: "touch.hint.spectate",
	hintMapClose: "touch.hint.mapClose",
} as const;

/** The label key of a touch button. */
export function touchButtonLabelKey(id: TouchButtonId): string {
	return `touch.${id}`;
}
