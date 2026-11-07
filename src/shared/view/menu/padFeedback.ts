/**
 * Gamepad menus (docs/GAMEPAD_MENUS.md 4.2 and GM9): the pure halves of the hint bar's glyphs and of the menu
 * haptics.
 *
 *   - padGlyph: what the hint bar draws for one pad key. The engine's own platform art first
 *     (UserInputService:GetImageForKeyCode; GMD8: engine content, not a theme asset), else the engine's text for the
 *     key (GetStringForKeyCode) when it says more than the KeyCode's own name, else our label (shared/play inputLabel).
 *   - menuHapticsOn / hapticTimeline: whether a menu cue may vibrate at all, and a cue's pulses as motor on / off
 *     events in time order (client PadHaptics schedules them).
 *   - HapticGenerations: which scheduled motor event is still current (per pad and motor, so a cue on one pad never
 *     drops another pad's "off").
 *   - padConfirmFeedback: what a MenuButton activation means for the pad's haptics (a confirm, a disabled press, or
 *     nothing: not on the pad, or not from A).
 */
import type { InputDeviceKind } from "shared/play";
import { MENU_HAPTICS, type MenuHaptic, type MenuHapticMotor } from "./config";

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

/** One motor event: at `atSec` after the cue, set `motor` to `strength` (0: off). */
export interface HapticEvent {
	readonly atSec: number;
	readonly motor: MenuHapticMotor;
	readonly strength: number;
}

/**
 * A cue's pulses (MENU_HAPTICS) as motor events, in time order (ties: offs first, so a pulse that starts as another on
 * the same motor ends is not cut): each pulse turns its motor on at `delaySec` and off `seconds` later. Strength
 * clamped to 0..1, durations never negative.
 */
export function hapticTimeline(cue: MenuHaptic): ReadonlyArray<HapticEvent> {
	const out = new Array<HapticEvent>();
	for (const p of MENU_HAPTICS[cue]) {
		const start = math.max(0, p.delaySec);
		out.push({ atSec: start, motor: p.motor, strength: math.clamp(p.strength, 0, 1) });
		out.push({ atSec: start + math.max(0, p.seconds), motor: p.motor, strength: 0 });
	}
	out.sort((a, b) => (a.atSec !== b.atSec ? a.atSec < b.atSec : a.strength < b.strength));
	return out;
}

/**
 * The latest cue per pad + motor (client PadHaptics): `begin` hands a cue its generation for one pad's motor, `current`
 * says whether a scheduled event of that generation still applies. A newer cue on the SAME pad and motor drops an older
 * one's later events (the newer cue schedules its own off); a cue on another pad never does, so every pad's "off"
 * arrives. Generations come from one counter, so after `clear` (every motor off) no older event matches again.
 */
export class HapticGenerations {
	private counter = 0;
	private readonly latest = new Map<string, number>();

	/** A new cue on `pad`'s `motor` (any stable names): its generation. */
	begin(pad: string, motor: MenuHapticMotor): number {
		this.counter += 1;
		this.latest.set(`${pad}/${motor}`, this.counter);
		return this.counter;
	}

	/** An event of generation `gen` on `pad`'s `motor` still applies. */
	current(pad: string, motor: MenuHapticMotor, gen: number): boolean {
		return this.latest.get(`${pad}/${motor}`) === gen;
	}

	/** Every pending event is stale (the motors were turned off). */
	clear(): void {
		this.latest.clear();
	}
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
