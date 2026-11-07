import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { HapticService, UserInputService } from "@rbxts/services";
import { clientStore, selectDisplay, selectInputDevice } from "client/store";
import {
	HapticGenerations,
	hapticTimeline,
	menuHapticsOn,
	type MenuHaptic,
	type MenuHapticMotor,
} from "shared/view/menu";

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
 * touch never buzzes. A newer cue on the same pad and motor wins: an older cue's later events there are dropped
 * (HapticGenerations, per pad + motor, so a cue on a second pad never drops the first pad's "off"). Every motor it
 * touched, on every pad, goes back to 0 on cleanup, when vibration is turned Off and when the device leaves the
 * gamepad (pending events are dropped then). HapticEffect is not used (GM0 has not shown it works in this engine
 * version; SetMotor is the path every pad has had).
 */
@Controller({})
export class PadHapticsController implements OnStart {
	private readonly janitor = new Janitor();
	/** Per pad + motor: the latest cue's generation (a scheduled event of an older one is skipped). */
	private readonly generations = new HapticGenerations();
	/** Pads and motors set above 0, to turn off on cleanup. */
	private readonly touched = new Map<Enum.UserInputType, Set<Enum.VibrationMotor>>();

	/** Cleaned up: scheduled events do nothing more. */
	private stopped = false;

	onStart(): void {
		this.janitor.Add(() => {
			this.stopped = true;
			this.stopAll();
		}, true);
		// Vibration Off or the device leaving the gamepad: every motor off now, pending pulses dropped.
		const quiet = () => {
			const state = clientStore.getState();
			if (!menuHapticsOn(selectInputDevice(state), selectDisplay(state).padVibration)) this.stopAll();
		};
		this.janitor.Add(clientStore.subscribe(selectInputDevice, quiet));
		this.janitor.Add(clientStore.subscribe((s) => selectDisplay(s).padVibration, quiet));
	}

	/** Plays `cue` on the active pad (nothing off the pad, with vibration Off, or on a pad without that motor). */
	play(cue: MenuHaptic): void {
		const state = clientStore.getState();
		if (this.stopped) return;
		if (!menuHapticsOn(selectInputDevice(state), selectDisplay(state).padVibration)) return;
		const pad = activePad();
		if (pad === undefined) return;
		const padName = pad.Name;
		const gens = new Map<MenuHapticMotor, number>();
		for (const e of hapticTimeline(cue)) {
			const motor = MOTORS[e.motor];
			if (!motorSupported(pad, motor)) continue;
			let gen = gens.get(e.motor);
			if (gen === undefined) {
				gen = this.generations.begin(padName, e.motor);
				gens.set(e.motor, gen);
			}
			const g = gen;
			const apply = () => {
				if (this.stopped || !this.generations.current(padName, e.motor, g)) return;
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

	/** Every motor this controller set, on every pad, back to 0; every pending event is dropped. */
	private stopAll(): void {
		this.generations.clear();
		for (const [pad, motors] of this.touched) {
			for (const motor of motors) pcall(() => HapticService.SetMotor(pad, motor, 0));
		}
		this.touched.clear();
	}
}
