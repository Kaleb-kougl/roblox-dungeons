/**
 * Phone haptics gate (docs/HAPTICS.md HP5, HPD6): whether an in-run cue may vibrate the phone at all, the touch twin of
 * shared/view/menu `menuHapticsOn` (the gamepad's gate, DisplaySettings.padVibration).
 */
import type { InputDeviceKind } from "shared/play";

/**
 * A play cue may vibrate the phone: touch is the last-used device and Options > Controls > Touch > Vibration is On
 * (DisplaySettings.touchVibration). A keyboard, a mouse or a gamepad (even one on a phone, HPD11) never does.
 */
export function touchHapticsOn(device: InputDeviceKind, touchVibration: boolean): boolean {
	return device === "touch" && touchVibration;
}
