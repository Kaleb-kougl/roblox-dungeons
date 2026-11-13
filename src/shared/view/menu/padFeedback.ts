/**
 * Gamepad menus (docs/GAMEPAD_MENUS.md 4.2 and GM9): the pure halves of the hint bar's glyphs and of the menu
 * haptics.
 *
 *   - padGlyph: what the hint bar draws for one pad key. The engine's own platform art first
 *     (UserInputService:GetImageForKeyCode; GMD8: engine content, not a theme asset), else the engine's text for the
 *     key (GetStringForKeyCode) when it says more than the KeyCode's own name, else our label (shared/play inputLabel).
 *   - menuHapticsOn / hapticTimeline: whether a menu cue may vibrate at all, and a cue's pulses as motor on / off
 *     events in time order (client fx HapticsController schedules them). The timeline itself, its event type and
 *     HapticGenerations (which scheduled motor event is still current, per pad and motor) live in shared/view/fx
 *     haptics.ts since docs/HAPTICS.md HP1 (the play cues share them) and are re-exported here.
 *   - padConfirmFeedback: what a MenuButton activation means for the pad's haptics (a confirm, a disabled press, or
 *     nothing: not on the pad, or not from A).
 */
import type { InputDeviceKind } from "shared/play";
import { hapticTimeline as pulseTimeline, type HapticEvent, type HapticPulse } from "../fx/haptics";
import { MENU_HAPTICS, MENU_HAPTIC_KINDS, type MenuHaptic, type MenuHapticPulse } from "./config";

export { HapticGenerations, type HapticEvent } from "../fx/haptics";

/** One drawn glyph: the engine's image, or a text label. */
export type PadGlyph =
	| { readonly kind: "image"; readonly image: string }
	| { readonly kind: "text"; readonly text: string };

/**
 * A key's glyph from what the engine answered: `image` (GetImageForKeyCode, undefined when it threw), `engineText`
 * (GetStringForKeyCode, undefined when it threw) and `label` (our inputLabel, always there). An engine text equal to the
 * key's name (`keyName`, e.g. "ButtonA") or empty says nothing and falls back to the label.
 */
export function padGlyph(
	keyName: string,
	image: string | undefined,
	engineText: string | undefined,
	label: string,
): PadGlyph {
	if (image !== undefined && image !== "") return { kind: "image", image };
	if (engineText !== undefined && engineText !== "" && engineText !== keyName) {
		return { kind: "text", text: engineText };
	}
	return { kind: "text", text: label };
}

/** A menu cue may vibrate: the gamepad is the last-used device and Options' vibration is On. */
export function menuHapticsOn(device: InputDeviceKind, vibration: boolean): boolean {
	return device === "gamepad" && vibration;
}

/** Menu cues have no ramps: the timeline's ramp step is never used for them. */
const MENU_RAMP_STEP_SEC = 0;

/** A menu pulse as the shared pulse type (its `delaySec` is the start offset). */
export function menuHapticPulse(p: MenuHapticPulse): HapticPulse {
	return { motor: p.motor, strength: p.strength, seconds: p.seconds, atSec: p.delaySec };
}

/** Every menu cue's pulses as shared pulses, built once. */
const MENU_PULSES = new Map<MenuHaptic, ReadonlyArray<HapticPulse>>();
for (const cue of MENU_HAPTIC_KINDS) {
	const pulses = new Array<HapticPulse>();
	for (const p of MENU_HAPTICS[cue]) pulses.push(menuHapticPulse(p));
	MENU_PULSES.set(cue, pulses);
}

/**
 * A menu cue's pulses (MENU_HAPTICS) as motor events, in time order (shared/view/fx haptics.ts hapticTimeline: ties
 * offs first; each pulse on at its `delaySec`, off `seconds` later; strength clamped to 0..1, durations never
 * negative). Given a pulse list and a ramp step instead, the shared timeline itself (play cues).
 */
export function hapticTimeline(cue: MenuHaptic): ReadonlyArray<HapticEvent>;
export function hapticTimeline(pulses: ReadonlyArray<HapticPulse>, rampStepSec: number): ReadonlyArray<HapticEvent>;
export function hapticTimeline(
	cue: MenuHaptic | ReadonlyArray<HapticPulse>,
	rampStepSec?: number,
): ReadonlyArray<HapticEvent> {
	if (typeIs(cue, "string")) return pulseTimeline(MENU_PULSES.get(cue) ?? [], MENU_RAMP_STEP_SEC);
	return pulseTimeline(cue, rampStepSec ?? MENU_RAMP_STEP_SEC);
}

/** What a menu button press means for the pad's haptics. */
export type PadPressFeedback = "confirm" | "disabled" | "none";

/**
 * A MenuButton activation's haptic: none off the pad (mouse, touch, keyboard) or when A was not pressed within
 * `windowSec` before it (`sinceAPressSec`: seconds since the last ButtonA press, undefined if never); else a disabled
 * button's double buzz or a confirm tick.
 */
export function padConfirmFeedback(
	device: InputDeviceKind,
	sinceAPressSec: number | undefined,
	windowSec: number,
	disabled: boolean,
): PadPressFeedback {
	if (device !== "gamepad" || sinceAPressSec === undefined) return "none";
	if (sinceAPressSec < 0 || sinceAPressSec > windowSec) return "none";
	return disabled ? "disabled" : "confirm";
}
