import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, RunService, UserInputService } from "@rbxts/services";
import { clientStore, selectBindings, selectOptions, selectPanelOpen } from "client/store";
import {
	KBM_MOUSE_NAMES,
	PAD_BUTTON_NAMES,
	LEFT_TRIGGER,
	RIGHT_TRIGGER,
	TRIGGER_THRESHOLD,
	captureEvent,
	captureSecondsLeft,
	clearSlot,
	findBinding,
	planRebind,
	pressedActions,
	resetDevice,
	type BindingDevice,
	type CaptureTarget,
	type GameAction,
} from "shared/play";
import { SettingsController } from "./SettingsController";

function keyCodeByName(): Map<string, Enum.KeyCode> {
	const out = new Map<string, Enum.KeyCode>();
	for (const item of Enum.KeyCode.GetEnumItems()) out.set(item.Name, item);
	return out;
}

const KEY_CODES = keyCodeByName();
const MOUSE_TYPES = Enum.UserInputType.GetEnumItems().filter((t) => KBM_MOUSE_NAMES.includes(t.Name));

/**
 * The Options screen's rebinding (task L4b client; the pure flow is shared/play rebindFlow.ts):
 *
 *   capture   `startCapture(target)` shows "Press a key... (5)" (options.capture), counting down from
 *             REBIND.captureTimeoutSeconds; a timeout, Escape or opening the Roblox menu cancels. The capture OWNS the
 *             input from its start until the frame after it ends (`options.inputCaptured`): InputController sinks
 *             everything and reports no driver keys, SettingsController / LeaderboardController ignore their keys,
 *             and Roblox's GUI selection is switched off (GuiNavigationEnabled, SelectedObject cleared), so the
 *             captured input fires no gameplay or menu action. The press that started it (A / click) never counts:
 *             input is taken from the next frame on.
 *   result    planRebind: a free input binds at once (SettingsController.setBindings: stored, synced); one held by
 *             another action opens the swap prompt (options.conflict: Swap applies, Cancel / B drops it); a reserved,
 *             unknown or unswappable input leaves a note (options.notice).
 *   also      Clear on a keyboard / mouse secondary, Reset device (after options.confirmReset), and the input test
 *             strip: while the Controls tab is open, the actions whose inputs are held light up (options.pressed).
 */
@Controller({})
export class RebindController implements OnStart {
	private readonly janitor = new Janitor();
	private captureJanitor: Janitor | undefined;
	private armed = false;
	private startedAt = 0;
	private savedNavigation: boolean | undefined;

	constructor(private readonly settings: SettingsController) {}

	onStart(): void {
		this.janitor.Add(
			UserInputService.InputBegan.Connect((input) => {
				const capture = selectOptions(clientStore.getState()).capture;
				if (capture === undefined || !this.armed) return;
				const ev = captureEvent(capture.device, input.UserInputType.Name, input.KeyCode.Name);
				if (ev.kind === "ignore") return;
				if (ev.kind === "cancel") {
					this.endCapture();
					return;
				}
				this.captured(capture, ev.name);
			}),
		);
		this.janitor.Add(GuiService.MenuOpened.Connect(() => this.cancelCapture()));
		this.janitor.Add(
			clientStore.subscribe(selectPanelOpen, (open) => {
				if (!open) this.cancelCapture();
			}),
		);
		this.janitor.Add(RunService.Heartbeat.Connect(() => this.updateTestStrip()));
	}

	/** Starts listening for the input to put in `target` (ignored while a capture or a prompt is open). */
	startCapture(target: CaptureTarget): void {
		const o = selectOptions(clientStore.getState());
		if (o.capture !== undefined || o.conflict !== undefined || o.confirmReset !== undefined) return;
		if (this.captureJanitor !== undefined) this.endCapture(); // a stale capture: restore the GUI navigation first
		clientStore.setRebindNotice(undefined);
		clientStore.setInputCaptured(true);
		this.startedAt = os.clock();
		clientStore.setCapture({ ...target, secondsLeft: captureSecondsLeft(0) });

		this.captureJanitor?.Destroy();
		const j = new Janitor();
		this.captureJanitor = j;
		// Keep the GUI selection from acting on the captured press (pad A would click the selected button).
		const [ok, nav] = pcall(() => GuiService.GuiNavigationEnabled);
		this.savedNavigation = ok ? nav : undefined;
		pcall(() => {
			GuiService.SelectedObject = undefined;
			GuiService.GuiNavigationEnabled = false;
		});
		this.armed = false;
		j.Add(RunService.Heartbeat.Once(() => (this.armed = true)));
		j.Add(
			RunService.Heartbeat.Connect(() => {
				const left = captureSecondsLeft(os.clock() - this.startedAt);
				if (left <= 0) this.endCapture();
				else clientStore.setCaptureSeconds(left);
			}),
		);
	}

	/** Cancels a running capture (nothing changes). Also when the store's capture was already cleared (screen closed). */
	cancelCapture(): void {
		if (this.captureJanitor !== undefined || selectOptions(clientStore.getState()).capture !== undefined) {
			this.endCapture();
		}
	}

	/** The swap prompt's answer: Swap applies the swapped layout, Cancel keeps the old one. */
	answerConflict(swap: boolean): void {
		const conflict = selectOptions(clientStore.getState()).conflict;
		if (conflict === undefined) return;
		clientStore.setConflict(undefined);
		if (swap) this.settings.setBindings(conflict.bindings);
	}

	/** Empties a keyboard / mouse secondary slot. */
	clearSecondary(action: GameAction): void {
		const result = clearSlot(selectBindings(clientStore.getState()), "kbm", action, 1);
		if (result.ok) this.settings.setBindings(result.bindings);
	}

	/** Asks to reset a device's bindings (undefined: the confirmation is dismissed). */
	askReset(device: BindingDevice | undefined): void {
		clientStore.setConfirmReset(device);
	}

	/** The confirmed reset: every binding of `device` back to the default layout. */
	confirmReset(): void {
		const device = selectOptions(clientStore.getState()).confirmReset;
		if (device === undefined) return;
		clientStore.setConfirmReset(undefined);
		clientStore.setRebindNotice(undefined);
		this.settings.setBindings(resetDevice(selectBindings(clientStore.getState()), device));
	}

	private captured(target: CaptureTarget, input: string): void {
		const b = selectBindings(clientStore.getState());
		const plan = planRebind(b, target, input);
		// The swap prompt opens before the capture closes, so the screen never sees "no prompt" in between (it would
		// hand the gamepad selection back too early).
		if (plan.kind === "apply") this.settings.setBindings(plan.bindings);
		else if (plan.kind === "conflict") {
			clientStore.setConflict({ target, input, holder: plan.holder, bindings: plan.bindings });
		} else if (plan.kind === "refused") {
			const holder = plan.reason === "onlyInput" ? findBinding(b, target.device, input) : undefined;
			clientStore.setRebindNotice({ reason: plan.reason, input, action: holder?.action ?? target.action });
		}
		this.endCapture();
	}

	/** Closes the capture now; the input stays captured until the next frame (the same press reaches no one). */
	private endCapture(): void {
		this.captureJanitor?.Destroy();
		this.captureJanitor = undefined;
		this.armed = false;
		clientStore.setCapture(undefined);
		const nav = this.savedNavigation;
		this.savedNavigation = undefined;
		if (nav !== undefined) pcall(() => (GuiService.GuiNavigationEnabled = nav));
		RunService.Heartbeat.Once(() => {
			if (selectOptions(clientStore.getState()).capture === undefined) clientStore.setInputCaptured(false);
		});
	}

	/** The test strip: while the Controls tab is open, which of its device's actions are held. */
	private updateTestStrip(): void {
		const state = clientStore.getState();
		const o = state.options;
		if (!state.settings.panelOpen || o.tab !== "controls") {
			if (o.pressed.size() > 0) clientStore.setPressed([]);
			return;
		}
		const held = o.controlsDevice === "kbm" ? this.heldKbm() : this.heldPad();
		clientStore.setPressed(pressedActions(selectBindings(state), o.controlsDevice, held));
	}

	private heldKbm(): Set<string> {
		const held = new Set<string>();
		for (const obj of UserInputService.GetKeysPressed()) held.add(obj.KeyCode.Name);
		for (const t of MOUSE_TYPES) if (UserInputService.IsMouseButtonPressed(t)) held.add(t.Name);
		return held;
	}

	private heldPad(): Set<string> {
		const held = new Set<string>();
		const pads = UserInputService.GetConnectedGamepads();
		if (pads.size() === 0) return held;
		const gamepad = pads.includes(Enum.UserInputType.Gamepad1) ? Enum.UserInputType.Gamepad1 : pads[0];
		for (const name of PAD_BUTTON_NAMES) {
			const code = KEY_CODES.get(name);
			if (code !== undefined && UserInputService.IsGamepadButtonDown(gamepad, code)) held.add(name);
		}
		for (const obj of UserInputService.GetGamepadState(gamepad)) {
			const name = obj.KeyCode.Name;
			if ((name === LEFT_TRIGGER || name === RIGHT_TRIGGER) && obj.Position.Z > TRIGGER_THRESHOLD) held.add(name);
		}
		return held;
	}
}
