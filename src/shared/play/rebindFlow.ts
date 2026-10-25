/**
 * The Options screen's rebinding flow, the pure half (task L4b client): what one captured input does (bind it, ask
 * to swap, or refuse), which captured events count, the capture countdown, which actions are held (the input test
 * strip), and the "a key held across a bindings change reads as released" gate. Input NAMES only (Enum.KeyCode /
 * Enum.UserInputType names), so it runs headlessly; the client's RebindController / InputController wrap it.
 */
import {
	KBM_ACTIONS,
	PAD_ACTIONS,
	findBinding,
	inputsFor,
	isMouseButtonName,
	rebind,
	slotInput,
	type BindingDevice,
	type BindingRef,
	type BindingRefusal,
	type BindingSlot,
	type Bindings,
	type GameAction,
} from "./bindings";
import { REBIND } from "./config";

/** The slot being captured. */
export interface CaptureTarget {
	readonly device: BindingDevice;
	readonly action: GameAction;
	readonly slot: BindingSlot;
}

/**
 * What a captured input does to the target slot:
 *   same      it is already in that slot (nothing changes)
 *   apply     free (or the action's own other slot: the two swap): bind it now
 *   conflict  another action holds it: ask first ("X is already used by Y. Swap / Cancel"); `bindings` is the result
 *             of Swap (`holder` takes this slot's old input, or loses the input when this slot was empty)
 *   refused   reserved / unknown input, or Swap would leave the holder without any input (`onlyInput`)
 */
export type RebindPlan =
	| { readonly kind: "same" }
	| { readonly kind: "apply"; readonly bindings: Bindings }
	| { readonly kind: "conflict"; readonly holder: BindingRef; readonly bindings: Bindings }
	| { readonly kind: "refused"; readonly reason: BindingRefusal };

export function planRebind(b: Bindings, target: CaptureTarget, input: string): RebindPlan {
	const { device, action, slot } = target;
	if (slotInput(b, device, action, slot) === input) return { kind: "same" };
	const result = rebind(b, device, action, slot, input);
	if (!result.ok) return { kind: "refused", reason: result.reason };
	const holder = findBinding(b, device, input);
	if (holder === undefined || holder.action === action) return { kind: "apply", bindings: result.bindings };
	return { kind: "conflict", holder, bindings: result.bindings };
}

/** What one input event means while a capture is open. */
export type CaptureEvent =
	| { readonly kind: "input"; readonly name: string }
	| { readonly kind: "cancel" }
	| { readonly kind: "ignore" };

/** The keyboard key that cancels a capture (also Roblox's menu key: opening the menu cancels too). */
export const CAPTURE_CANCEL_KEY = "Escape";

const IGNORE: CaptureEvent = { kind: "ignore" };
const CANCEL: CaptureEvent = { kind: "cancel" };

/**
 * One InputBegan (Enum.UserInputType name, Enum.KeyCode name) during a capture for `device`: Escape cancels (any
 * device); a keyboard key or mouse button is the input on "kbm", a gamepad button on "pad"; everything else (the
 * other device, mouse movement, sticks, Unknown keys) is ignored. Reserved keys come through as inputs, so the screen
 * can say why they are refused.
 */
export function captureEvent(device: BindingDevice, inputType: string, keyCode: string): CaptureEvent {
	if (inputType === "Keyboard" && keyCode === CAPTURE_CANCEL_KEY) return CANCEL;
	if (device === "kbm") {
		if (inputType === "Keyboard") return keyCode === "Unknown" ? IGNORE : { kind: "input", name: keyCode };
		if (isMouseButtonName(inputType)) return { kind: "input", name: inputType };
		return IGNORE;
	}
	const [gamepad] = string.match(inputType, "^Gamepad%d+$");
	if (gamepad === undefined || keyCode === "Unknown") return IGNORE;
	// The sticks only move (InputChanged); a stick click is ButtonL3 / ButtonR3.
	if (keyCode === "Thumbstick1" || keyCode === "Thumbstick2") return IGNORE;
	return { kind: "input", name: keyCode };
}

/** Whole seconds a capture still shows ("Press a key... (5)"); 0 = timed out. */
export function captureSecondsLeft(elapsedSeconds: number, timeout: number = REBIND.captureTimeoutSeconds): number {
	return math.max(0, math.ceil(timeout - math.max(0, elapsedSeconds)));
}

/** The actions on `device` whose inputs are in `held` (the input test strip), in settings order. */
export function pressedActions(b: Bindings, device: BindingDevice, held: ReadonlySet<string>): Array<GameAction> {
	const out = new Array<GameAction>();
	const actions: ReadonlyArray<GameAction> = device === "kbm" ? KBM_ACTIONS : PAD_ACTIONS;
	for (const action of actions) {
		for (const input of inputsFor(b, device, action)) {
			if (held.has(input)) {
				out.push(action);
				break;
			}
		}
	}
	return out;
}

/**
 * Inputs held when the bindings changed read as released until they are actually let go (a key captured into a
 * slot, or one that moved to another action, must not fire that action until it is pressed again). One gate per held
 * set (keys, mouse buttons, pad buttons): `filter` unblocks every blocked name missing from the set it is given.
 */
export class HeldInputGate {
	private readonly blocked = new Set<string>();

	/** Blocks every input in `held` until it is released. */
	block(held: ReadonlySet<string>): void {
		for (const name of held) this.blocked.add(name);
	}

	/** True while an input is blocked. */
	isBlocked(name: string): boolean {
		return this.blocked.has(name);
	}

	/** Removes blocked inputs from `held` (this frame's held set, modified) and unblocks those no longer held. */
	filter(held: Set<string>): void {
		if (this.blocked.size() === 0) return;
		const released = new Array<string>();
		for (const name of this.blocked) {
			if (held.has(name)) held.delete(name);
			else released.push(name);
		}
		for (const name of released) this.blocked.delete(name);
	}

	clear(): void {
		this.blocked.clear();
	}
}
