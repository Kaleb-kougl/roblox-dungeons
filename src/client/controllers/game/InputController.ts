import { Controller, OnStart } from "@flamework/core";
import { ContextActionService, TextChatService, UserInputService, Workspace } from "@rbxts/services";
import { clientStore } from "client/store";
import {
	InputDeviceTracker,
	boundKeyNames,
	boundPadButtonNames,
	driverKeyAction,
	mapDevicesToInput,
	maskDebugButtons,
	LEFT_TRIGGER,
	RIGHT_TRIGGER,
	type DriverKeyAction,
	type GamepadSnapshot,
} from "shared/play";
import { EMPTY_INPUT, type InputFrame } from "shared/sim";
import { pointerAimFromRay } from "shared/view";

const SINK_ACTION = "KV_GameInput";
/** Sticks the default controls read (movement, camera): sunk so the stock character / camera never act. */
const SUNK_STICKS = ["Thumbstick1", "Thumbstick2"];
/**
 * Gamepad keys Roblox's GUI selection uses (move the selection, press / back). While a menu is open (pause overlay,
 * juice settings) they pass through to the GUI instead of being sunk, and their driver actions (D-pad down restart)
 * are off: the menu has its own Restart button.
 */
const UI_NAV_KEYS = new Set(["ButtonA", "ButtonB", "DPadUp", "DPadDown", "DPadLeft", "DPadRight", "Thumbstick1"]);

type DriverListener = (action: Exclude<DriverKeyAction, undefined>) => void;

function keyCodeByName(): Map<string, Enum.KeyCode> {
	const out = new Map<string, Enum.KeyCode>();
	for (const item of Enum.KeyCode.GetEnumItems()) out.set(item.Name, item);
	return out;
}

/**
 * Roblox devices -> one quantized InputFrame per rendered frame (the pure mapping is shared/play inputMapping.ts, a
 * port of the web build's devices.ts). Keyboard and mouse buttons and the gamepad are POLLED in `sample` (no stuck
 * keys after focus changes); events only track which device was used last (aim device, HUD hint).
 *
 * Every bound key / button and both thumbsticks are bound in ContextActionService at High priority and SUNK, so the
 * default PlayerModule controls never see them (the player is a sim entity, not a Humanoid). The same binding reports
 * the driver keys (R restart, F8 replay check, D-pad down pad restart) to the SimController. CAS does not fire while a
 * TextBox (chat) has focus, and `sample` ignores the keyboard then too. The TextChatService chat bar lives in CoreGui,
 * where GetFocusedTextBox cannot see it, so its own IsFocused flag is checked as well (chatFocused).
 *
 * Mouse aim: the camera ray through the pointer (Camera:ViewportPointToRay on UserInputService:GetMouseLocation)
 * onto the floor plane, as a world vector from the player's sim position (shared/view pointerAimFromRay).
 */
/** A TextBox has focus: one of ours / legacy chat (GetFocusedTextBox) or the TextChatService input bar (CoreGui). */
function chatFocused(): boolean {
	if (UserInputService.GetFocusedTextBox() !== undefined) return true;
	const bar = TextChatService.FindFirstChildOfClass("ChatInputBarConfiguration");
	return bar !== undefined && bar.IsFocused;
}

@Controller({})
export class InputController implements OnStart {
	private readonly tracker = new InputDeviceTracker();
	private readonly keyCodes = new Array<[Enum.KeyCode, string]>();
	private readonly padCodes = new Array<[Enum.KeyCode, string]>();
	private readonly keys = new Set<string>();
	private readonly mouse = new Set<string>();
	private readonly padButtons = new Set<string>();
	private readonly driverListeners = new Array<DriverListener>();
	private debugButtons = false;
	private uiNavigation = false;
	/** A menu button was clicked: ignore the mouse buttons until they are released (no swing on resume). */
	private mouseSuppressed = false;
	private runOverOrPaused: () => boolean = () => false;
	private pointerAimX = 0;
	private pointerAimZ = 0;
	/** Connected gamepads, kept by GamepadConnected / GamepadDisconnected (no per-frame GetConnectedGamepads). */
	private pads = new Array<Enum.UserInputType>();

	onStart(): void {
		const codes = keyCodeByName();
		for (const name of boundKeyNames()) {
			const code = codes.get(name);
			if (code !== undefined) this.keyCodes.push([code, name]);
		}
		for (const name of boundPadButtonNames()) {
			const code = codes.get(name);
			if (code !== undefined) this.padCodes.push([code, name]);
		}

		const sunk = new Array<Enum.KeyCode>();
		for (const [code] of this.keyCodes) sunk.push(code);
		for (const [code] of this.padCodes) sunk.push(code);
		for (const name of SUNK_STICKS) {
			const code = codes.get(name);
			if (code !== undefined) sunk.push(code);
		}
		ContextActionService.BindActionAtPriority(
			SINK_ACTION,
			(_, state, input) => {
				if (this.uiNavigation && UI_NAV_KEYS.has(input.KeyCode.Name)) return Enum.ContextActionResult.Pass;
				if (state === Enum.UserInputState.Begin) {
					const action = driverKeyAction(input.KeyCode.Name, this.debugButtons, this.runOverOrPaused());
					if (action !== undefined) for (const listener of this.driverListeners) listener(action);
				}
				return Enum.ContextActionResult.Sink;
			},
			false,
			Enum.ContextActionPriority.High.Value,
			...sunk,
		);

		UserInputService.InputBegan.Connect((input) => {
			const t = input.UserInputType;
			if (t === Enum.UserInputType.Keyboard) this.tracker.keyPressed();
			else if (t === Enum.UserInputType.MouseButton1 || t === Enum.UserInputType.MouseButton2) {
				this.tracker.mouseClicked();
			}
			this.publishDevice();
		});
		UserInputService.InputChanged.Connect((input) => {
			if (input.UserInputType === Enum.UserInputType.MouseMovement) this.tracker.mouseMoved();
		});
		const refreshPads = () => (this.pads = UserInputService.GetConnectedGamepads());
		refreshPads();
		UserInputService.GamepadConnected.Connect(refreshPads);
		UserInputService.GamepadDisconnected.Connect(refreshPads);
	}

	/** Debug keys on: K / J reach the sim (else stripped), F8 checks the replay. */
	setDebug(debug: boolean): void {
		this.debugButtons = debug;
	}

	/**
	 * A menu is open (pause overlay, juice settings): gamepad navigation keys go to the GUI selection instead of the
	 * game. The sim is paused then, so nothing they would press reaches a tick.
	 */
	setUiNavigation(on: boolean): void {
		this.uiNavigation = on;
	}

	/** Called when a menu button is activated: mouse buttons read as released until they actually are. */
	suppressMouseUntilRelease(): void {
		this.mouseSuppressed = true;
	}

	/** Lets the pad restart (D-pad down) know when it is allowed. */
	setRunOverOrPaused(query: () => boolean): void {
		this.runOverOrPaused = query;
	}

	/** Driver key presses (restart, replay check). */
	onDriverAction(listener: DriverListener): void {
		this.driverListeners.push(listener);
	}

	/**
	 * Polls every device ONCE for this rendered frame and returns the quantized, world-space frame. (playerX, playerZ)
	 * is the player's current sim position (mouse aim is a vector from it).
	 */
	sample(playerX: number, playerZ: number, out: InputFrame = { ...EMPTY_INPUT }): InputFrame {
		this.pollKeyboardMouse();
		const pad = this.pollGamepad();
		this.tracker.padSampled(pad);
		this.publishDevice();
		if (this.tracker.aimDevice === "mouse") this.updatePointerAim(playerX, playerZ);
		const frame = mapDevicesToInput(
			{
				kbm: { keys: this.keys, mouseButtons: this.mouse },
				pad,
				aimDevice: this.tracker.aimDevice,
				pointerAimX: this.pointerAimX,
				pointerAimZ: this.pointerAimZ,
			},
			out,
		);
		frame.buttons = maskDebugButtons(frame.buttons, this.debugButtons);
		return frame;
	}

	private pollKeyboardMouse(): void {
		this.keys.clear();
		this.mouse.clear();
		if (chatFocused()) return; // typing in chat
		for (const [code, name] of this.keyCodes) if (UserInputService.IsKeyDown(code)) this.keys.add(name);
		const left = UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton1);
		const right = UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton2);
		if (this.mouseSuppressed) {
			if (left || right) return;
			this.mouseSuppressed = false;
		}
		if (left) this.mouse.add("MouseButton1");
		if (right) this.mouse.add("MouseButton2");
	}

	private pollGamepad(): GamepadSnapshot | undefined {
		const pads = this.pads;
		if (pads.size() === 0) return undefined;
		const gamepad = pads.includes(Enum.UserInputType.Gamepad1) ? Enum.UserInputType.Gamepad1 : pads[0];
		let leftX = 0;
		let leftY = 0;
		let rightX = 0;
		let rightY = 0;
		let leftTrigger = 0;
		let rightTrigger = 0;
		for (const obj of UserInputService.GetGamepadState(gamepad)) {
			const code = obj.KeyCode;
			if (code === Enum.KeyCode.Thumbstick1) {
				leftX = obj.Position.X;
				leftY = obj.Position.Y;
			} else if (code === Enum.KeyCode.Thumbstick2) {
				rightX = obj.Position.X;
				rightY = obj.Position.Y;
			} else if (code.Name === LEFT_TRIGGER) {
				leftTrigger = obj.Position.Z;
			} else if (code.Name === RIGHT_TRIGGER) {
				rightTrigger = obj.Position.Z;
			}
		}
		this.padButtons.clear();
		for (const [code, name] of this.padCodes) {
			if (UserInputService.IsGamepadButtonDown(gamepad, code)) this.padButtons.add(name);
		}
		return { leftX, leftY, rightX, rightY, leftTrigger, rightTrigger, buttons: this.padButtons };
	}

	private updatePointerAim(playerX: number, playerZ: number): void {
		const camera = Workspace.CurrentCamera;
		if (camera === undefined) return;
		const mouse = UserInputService.GetMouseLocation();
		const ray = camera.ViewportPointToRay(mouse.X, mouse.Y);
		const o = ray.Origin;
		const d = ray.Direction;
		const aim = pointerAimFromRay([o.X, o.Y, o.Z], [d.X, d.Y, d.Z], playerX, playerZ);
		if (aim !== undefined) {
			this.pointerAimX = aim[0];
			this.pointerAimZ = aim[1];
		}
	}

	private publishDevice(): void {
		const device = this.tracker.device;
		if (clientStore.getState().game.inputDevice !== device) clientStore.setInputDevice(device);
	}
}
