import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { HapticService, UserInputService } from "@rbxts/services";
import { clientStore, selectDisplay, selectInputDevice } from "client/store";
import { hapticTimeline, menuHapticsOn, type MenuHaptic, type MenuHapticMotor } from "shared/view/menu";

/** The engine's motor for a MENU_HAPTICS motor name. */
const MOTORS: { readonly [K in MenuHapticMotor]: Enum.VibrationMotor } = {
	Small: Enum.VibrationMotor.Small,
	Large: Enum.VibrationMotor.Large,
};

/** The pad a menu cue vibrates: the navigation gamepad, else the first connected one, else none. */
function activePad(): Enum.UserInputType | undefined {
	const [okNav, nav] = pcall(() => UserInputService.GetNavigationGamepads());
	if (okNav && nav.size() > 0) return nav[0];
	const [okAll, all] = pcall(() => UserInputService.GetConnectedGamepads());
	if (okAll && all.size() > 0) return all[0];
	return undefined;
}

/** The pad can vibrate `motor` (every engine call behind pcall: unsupported pads and platforms answer false). */
function motorSupported(pad: Enum.UserInputType, motor: Enum.VibrationMotor): boolean {
	const [okVib, vib] = pcall(() => HapticService.IsVibrationSupported(pad));
	if (!okVib || !vib) return false;
	const [okMotor, has] = pcall(() => HapticService.IsMotorSupported(pad, motor));
	return okMotor && has;
}

/**
 * Menu haptics on the pad (docs/GAMEPAD_MENUS.md GM9): plays a cue's MENU_HAPTICS pulses (shared/view/menu
 * hapticTimeline) on the active pad through HapticService:SetMotor, every call behind pcall and only on a motor the
 * pad reports (IsVibrationSupported / IsMotorSupported). Silent unless the last-used device is the gamepad and Options
 * > Controls > Gamepad > Vibration is On (DisplaySettings.padVibration, menuHapticsOn), so a mouse, a keyboard or
 * touch never buzzes. A newer cue on a motor wins: an older cue's later events on that motor are dropped (each motor
 * keeps a generation). Every motor it touched goes back to 0 on cleanup. HapticEffect is not used (GM0 has not shown
 * it works in this engine version; SetMotor is the path every pad has had).
 */
@Controller({})
export class PadHapticsController implements OnStart {
	private readonly janitor = new Janitor();
	/** Per motor: the latest cue's generation (a scheduled event of an older one is skipped). */
	private readonly generation = new Map<MenuHapticMotor, number>();
	/** Pads and motors set above 0, to turn off on cleanup. */
	private readonly touched = new Map<Enum.UserInputType, Set<Enum.VibrationMotor>>();

	/** Cleaned up: scheduled events do nothing more. */
	private stopped = false;

	onStart(): void {
		this.janitor.Add(() => {
			this.stopped = true;
			this.stopAll();
		}, true);
	}

	/** Plays `cue` on the active pad (nothing off the pad, with vibration Off, or on a pad without that motor). */
	play(cue: MenuHaptic): void {
		const state = clientStore.getState();
		if (this.stopped) return;
		if (!menuHapticsOn(selectInputDevice(state), selectDisplay(state).padVibration)) return;
		const pad = activePad();
		if (pad === undefined) return;
		const gens = new Map<MenuHapticMotor, number>();
		for (const e of hapticTimeline(cue)) {
			if (!gens.has(e.motor)) {
				const g = (this.generation.get(e.motor) ?? 0) + 1;
				this.generation.set(e.motor, g);
				gens.set(e.motor, g);
			}
			const gen = gens.get(e.motor) ?? 0;
			const motor = MOTORS[e.motor];
			if (!motorSupported(pad, motor)) continue;
			const apply = () => {
				if (this.stopped || this.generation.get(e.motor) !== gen) return;
				this.setMotor(pad, motor, e.strength);
			};
			if (e.atSec <= 0) apply();
			// Not kept in the Janitor (one entry per pulse would pile up): cleanup sets `stopped` and turns the motors off.
			else task.delay(e.atSec, apply);
		}
	}

	private setMotor(pad: Enum.UserInputType, motor: Enum.VibrationMotor, strength: number): void {
		pcall(() => HapticService.SetMotor(pad, motor, strength));
		let set = this.touched.get(pad);
		if (set === undefined) {
			set = new Set();
			this.touched.set(pad, set);
		}
		if (strength > 0) set.add(motor);
		else set.delete(motor);
	}

	private stopAll(): void {
		for (const [pad, motors] of this.touched) {
			for (const motor of motors) pcall(() => HapticService.SetMotor(pad, motor, 0));
		}
		this.touched.clear();
	}
}
