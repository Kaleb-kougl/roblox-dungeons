import { Controller, OnStart } from "@flamework/core";
import { ContextActionService, RunService, TextChatService, UserInputService, Workspace } from "@rbxts/services";
import { clientStore, selectBindings, selectDisplay, selectInputCaptured } from "client/store";
import { TOUCH } from "shared/config";
import {
	DEFAULT_BINDINGS,
	HeldInputGate,
	InputDeviceTracker,
	KBM_MOUSE_NAMES,
	PAD_BUTTON_NAMES,
	TRIGGER_THRESHOLD,
	boundKeyNames,
	boundMouseButtonNames,
	boundPadButtonNames,
	CLOSED_RESTART_WINDOW,
	driverKeyAction,
	isMapInput,
	isMouseButtonName,
	mapDevicesToInput,
	maskDebugButtons,
	LEFT_TRIGGER,
	RIGHT_TRIGGER,
	STICK_DEADZONE,
	type AimDevice,
	type Bindings,
	type DriverKeyAction,
	type GamepadSnapshot,
	type RestartWindow,
	draftStatus,
	dropDraftGuiMouse,
	pickAutoTarget,
	TouchControls,
	type TouchMode,
	type TouchSnapshot,
} from "shared/play";
import { Button, EMPTY_INPUT, playerAt, type InputFrame, type PlayerState, type SimState } from "shared/sim";
import type { BulletBlocker } from "shared/dungeon";
import { pointerAimFromRay } from "shared/view";
import {
	GAMEPAD_MENU,
	MENU_PAD_INPUT_KEYS,
	PAD_KEYS,
	PadStickRepeat,
	isMenuPadInputKey,
	type MenuPadInput,
} from "shared/view/menu";

const SINK_ACTION = "KV_GameInput";
/** Sticks the default controls read (movement, camera): sunk so the stock character / camera never act. */
const SUNK_STICKS = ["Thumbstick1", "Thumbstick2"];
/**
 * Gamepad keys Roblox's GUI selection uses (move the selection, press / back). While a menu is open (pause overlay,
 * Options) they pass through to the GUI instead of being sunk, and their driver actions (D-pad down restart) are off:
 * the menu has its own Restart button.
 */
const UI_NAV_KEYS = new Set(["ButtonA", "ButtonB", "DPadUp", "DPadDown", "DPadLeft", "DPadRight", "Thumbstick1"]);
/** The weapon buttons (Attack, Alt) in a sampled frame: what the item tooltips' shy HUD rule reads (weaponHeld). */
const WEAPON_BUTTONS = bit32.bor(Button.FIRE, Button.ALT);

type DriverListener = (action: Exclude<DriverKeyAction, undefined>) => void;
type MapListener = () => void;
type MenuPadListener = (input: MenuPadInput) => void;

/** What a touch frame needs from the run (SimController passes it to sample). */
export interface TouchAimContext {
	readonly state: SimState;
	readonly playerIndex: number;
	readonly blocked: BulletBlocker | undefined;
	/**
	 * The player as drawn (docs/LOCAL_PREDICTION.md LP5: SimController.getDrawnPlayer): the touch facing and the
	 * auto-target aim from it. Absent: the merged player.
	 */
	readonly player?: Readonly<PlayerState>;
}

function keyCodeByName(): Map<string, Enum.KeyCode> {
	const out = new Map<string, Enum.KeyCode>();
	for (const item of Enum.KeyCode.GetEnumItems()) out.set(item.Name, item);
	return out;
}

const KEY_CODES = keyCodeByName();

function mouseTypeByName(): Map<string, Enum.UserInputType> {
	const out = new Map<string, Enum.UserInputType>();
	for (const item of Enum.UserInputType.GetEnumItems()) {
		if (KBM_MOUSE_NAMES.includes(item.Name)) out.set(item.Name, item);
	}
	return out;
}

const MOUSE_TYPES = mouseTypeByName();

/** A thumbstick pushed past STICK_DEADZONE (an InputChanged from a pad). */
function isStickInput(input: InputObject): boolean {
	const code = input.KeyCode;
	if (code !== Enum.KeyCode.Thumbstick1 && code !== Enum.KeyCode.Thumbstick2) return false;
	const p = input.Position;
	return p.X * p.X + p.Y * p.Y > STICK_DEADZONE * STICK_DEADZONE;
}

/** The gamepad the game reads: Gamepad1 when connected, else the first one. */
function activePad(pads: ReadonlyArray<Enum.UserInputType>): Enum.UserInputType | undefined {
	if (pads.size() === 0) return undefined;
	return pads.includes(Enum.UserInputType.Gamepad1) ? Enum.UserInputType.Gamepad1 : pads[0];
}

/**
 * Roblox devices -> one quantized InputFrame per rendered frame (the pure mapping is shared/play inputMapping.ts, a
 * port of the web build's devices.ts). Keyboard and mouse buttons and the gamepad are POLLED in `sample` (no stuck
 * keys after focus changes); events only track which device was used last (aim device, HUD hint).
 *
 * Every bound key / button and both thumbsticks are bound in ContextActionService at High priority and SUNK, so the
 * default PlayerModule controls never see them (the player is a sim entity, not a Humanoid). The same binding reports
 * the driver keys (R restart, F8 replay check, D-pad down pad restart) to the SimController and the map toggle
 * (M / D-pad left, `onMapAction`) to whoever subscribes. CAS does not fire while a
 * TextBox (chat) has focus, and `sample` ignores the keyboard then too. The TextChatService chat bar lives in CoreGui,
 * where GetFocusedTextBox cannot see it, so its own IsFocused flag is checked as well (chatFocused).
 *
 * Mouse aim: the camera ray through the pointer (Camera:ViewportPointToRay on UserInputService:GetMouseLocation)
 * onto the floor plane, as a world vector from the player's sim position (shared/view pointerAimFromRay).
 *
 * Bindings (task L4b): the player's layout comes from the store (`selectBindings`: DEFAULT_BINDINGS plus the saved
 * controls overrides) and goes to every mapping call. When it changes, the CAS sink is bound again with the new key
 * list, and every input held at that moment reads as released until it is let go (HeldInputGate), so a key just
 * captured into a slot (or moved to another action) does not fire. While a rebind capture owns the input
 * (`options.inputCaptured`) the sink swallows everything and reports no driver keys (R would otherwise restart).
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
	private bindings: Bindings = DEFAULT_BINDINGS;
	private sinkBound = false;
	private keyCodes = new Array<[Enum.KeyCode, string]>();
	private padCodes = new Array<[Enum.KeyCode, string]>();
	private mouseTypes = new Array<[Enum.UserInputType, string]>();
	private readonly keyGate = new HeldInputGate();
	private readonly mouseGate = new HeldInputGate();
	private readonly padGate = new HeldInputGate();
	private readonly keys = new Set<string>();
	private readonly mouse = new Set<string>();
	private readonly padButtons = new Set<string>();
	private readonly driverListeners = new Array<DriverListener>();
	private readonly mapListeners = new Array<MapListener>();
	private readonly menuPadListeners = new Array<MenuPadListener>();
	/** The right stick's scroll repeat while a menu owns the pad (onMenuPadInput). */
	private readonly menuStick = new PadStickRepeat();
	private debugButtons = false;
	private uiNavigation = false;
	/** A rebind capture owns the input (Options screen): nothing reaches the game or the driver keys. */
	private inputCaptured = false;
	/** A menu button was clicked: ignore the mouse buttons until they are released (no swing on resume). */
	private mouseSuppressed = false;
	/**
	 * Mouse buttons whose press began over a GUI (InputBegan's gameProcessedEvent: a HUD button such as the top-bar
	 * pause button), until released (mousePressOnGui).
	 */
	private readonly guiMouse = new Set<Enum.UserInputType>();
	private restartWindow: () => RestartWindow = () => CLOSED_RESTART_WINDOW;
	private pointerAimX = 0;
	private pointerAimZ = 0;
	/** Connected gamepads, kept by GamepadConnected / GamepadDisconnected (no per-frame GetConnectedGamepads). */
	private pads = new Array<Enum.UserInputType>();
	/** The touch controls' state machine (MB3): fingers in, one TouchSnapshot per frame out. */
	private readonly touch = new TouchControls();
	/** The boon draft reveal's tap filter (setDraftTapFilter), if registered. */
	private draftTapFilter: (() => boolean) | undefined;
	/** The touch surface the screen shows (MB6 touchMode); hidden until the touch controls go up. */
	private touchMode: TouchMode = "hidden";
	private touchStickRadiusPx: number = TOUCH.stickRadiusRef;
	/** The Attack / Alt centre-stick auto-target setting (DisplaySettings.touchAutoTarget). */
	private touchAutoTarget = true;
	/** The last auto-target: its ActorState.id (0 = none) and its world position. */
	private targetId = 0;
	private targetX = 0;
	private targetZ = 0;
	/** os.clock() at the previous sample: the touch frame's dt. */
	private lastSampleClock = os.clock();
	/** The last sampled frame's buttons (weaponHeld). */
	private lastButtons = 0;

	onStart(): void {
		// A touch-only device (no keyboard, no gamepad): the touch controls are the input from the first frame.
		if (UserInputService.TouchEnabled && !UserInputService.KeyboardEnabled && !UserInputService.GamepadEnabled) {
			this.tracker.touched();
		}
		const refreshPads = () => (this.pads = UserInputService.GetConnectedGamepads());
		refreshPads();
		UserInputService.GamepadConnected.Connect(refreshPads);
		UserInputService.GamepadDisconnected.Connect(refreshPads);

		this.applyBindings(selectBindings(clientStore.getState()));
		clientStore.subscribe(selectBindings, (b) => this.applyBindings(b));
		this.inputCaptured = selectInputCaptured(clientStore.getState());
		clientStore.subscribe(selectInputCaptured, (on) => (this.inputCaptured = on));
		this.touchAutoTarget = selectDisplay(clientStore.getState()).touchAutoTarget;
		clientStore.subscribe(selectDisplay, (d) => (this.touchAutoTarget = d.touchAutoTarget));

		UserInputService.InputBegan.Connect((input, processed) => {
			const t = input.UserInputType;
			if (t === Enum.UserInputType.Keyboard) this.tracker.keyPressed();
			else if (t === Enum.UserInputType.MouseButton1 || t === Enum.UserInputType.MouseButton2) {
				// A phone can report a touch as a mouse click: the mouse counts only when one is attached.
				if (UserInputService.MouseEnabled) this.tracker.mouseClicked();
			} else if (this.pads.includes(t)) {
				// A pad press: the menus before a run sample nothing, so the device must follow the pad here too.
				this.tracker.padPressed();
			}
			this.publishDevice();
			// A restart bound to a mouse button (CAS sinks keys only): not over a GUI, not during a capture.
			if (!processed && !this.inputCaptured && isMouseButtonName(t.Name)) this.reportDriver(t.Name);
			if (processed && isMouseButtonName(t.Name)) this.guiMouse.add(t);
			// A menu's bumpers / triggers / X / Y (sunk by the CAS sink, so `processed` is set: not read).
			const key = input.KeyCode.Name;
			if (this.menuPadInputOpen() && isMenuPadInputKey(key)) this.emitMenuPad({ keyName: key, x: 0, y: 0 });
		});
		UserInputService.InputEnded.Connect((input) => {
			this.guiMouse.delete(input.UserInputType);
		});
		UserInputService.TouchStarted.Connect(() => {
			this.tracker.touched();
			this.publishDevice();
		});
		UserInputService.InputChanged.Connect((input) => {
			if (input.UserInputType === Enum.UserInputType.MouseMovement && UserInputService.MouseEnabled) {
				this.tracker.mouseMoved();
			} else if (this.pads.includes(input.UserInputType) && isStickInput(input)) {
				this.tracker.padPressed();
				this.publishDevice();
			}
		});
		RunService.RenderStepped.Connect((dt) => this.stepMenuStick(dt));
	}

	/** The layout in use (the store's: applied in onStart and on every change). */
	getBindings(): Bindings {
		return this.bindings;
	}

	/** Debug keys on: K / J reach the sim (else stripped), F8 checks the replay. */
	setDebug(debug: boolean): void {
		this.debugButtons = debug;
	}

	/**
	 * A menu is open (pause overlay, Options): gamepad navigation keys go to the GUI selection instead of the game.
	 * A solo sim is paused then, so nothing they would press reaches a tick; a co-op run never pauses, so the
	 * SimController sends neutral input instead while `menuOwnsInput()` (shared/lockstep CoopMenuInputGate).
	 */
	setUiNavigation(on: boolean): void {
		// Held pad buttons are blocked by blockHeldPadInputs (a real menu closing, a resume), not here: this also turns
		// off when the stage cover or the loading screen ends, which must not stop a trigger held through a stairwell card.
		if (!on) this.menuStick.reset();
		this.uiNavigation = on;
	}

	/**
	 * Control goes back to the game from a menu (docs/GAMEPAD_MENUS.md GM4 and the review fixes): every pad button and
	 * trigger held right now reads released until it is let go (`padGate.block`), so the B / A / Start that resumed a
	 * solo run never reaches its first unpaused tick as skill 2 / skill 1, and an LB held through a tab change never
	 * rolls. `alsoHeld`: key names to block as well (the key that drove the menu action, in case the engine does not
	 * report it down yet); a name not held unblocks on the next sample. The mouse keeps its own suppression
	 * (suppressMouseUntilRelease).
	 */
	blockHeldPadInputs(alsoHeld?: ReadonlyArray<string>): void {
		const held = this.heldPadButtons() ?? new Set<string>();
		if (alsoHeld !== undefined) for (const name of alsoHeld) held.add(name);
		if (held.size() > 0) this.padGate.block(held);
	}

	/** A menu (HUD / menu shell) is open or a rebind capture owns the input: `sample()` is not meant for the game. */
	menuOwnsInput(): boolean {
		return this.uiNavigation || this.inputCaptured;
	}

	/**
	 * A mouse button whose press began over a GUI (a HUD or top-bar button) is still held: that click belongs to the
	 * GUI, not the game. The polled frame still carries it (solo pauses under the menu it opens); co-op spectating
	 * ignores its switch edge (SimController). A release missed by InputEnded (focus loss) is dropped here.
	 */
	mousePressOnGui(): boolean {
		for (const t of this.guiMouse) if (!UserInputService.IsMouseButtonPressed(t)) this.guiMouse.delete(t);
		return this.guiMouse.size() > 0;
	}

	/**
	 * Attack or Alt is held in the last sampled frame, through the player's bindings (keyboard, mouse, pad or touch;
	 * a press that began over a GUI counts too: the frame carries it). The item tooltips' live HUD rule reads it
	 * (docs/ITEM_TOOLTIPS.md IT6, ITD3: no tooltip while a weapon is held or just pressed). No sample yet: false.
	 */
	weaponHeld(): boolean {
		return bit32.band(this.lastButtons, WEAPON_BUTTONS) !== 0;
	}

	/** The aim device used last (mouse / stick / touch / none): the item tooltips hover only for the mouse. */
	getAimDevice(): AimDevice {
		return this.tracker.aimDevice;
	}

	/** Called when a menu button is activated: mouse buttons read as released until they actually are. */
	suppressMouseUntilRelease(): void {
		this.mouseSuppressed = true;
	}

	/** Lets the restart key (R) and the pad restart (D-pad down) know when they are allowed (driverKeyAction). */
	setRestartWindow(query: () => RestartWindow): void {
		this.restartWindow = query;
	}

	/** Driver key presses (restart, replay check). */
	onDriverAction(listener: DriverListener): void {
		this.driverListeners.push(listener);
	}

	/**
	 * The bound `map` input was pressed (default M / D-pad left; docs/MINIMAP.md M9): the full map toggle. Reported like
	 * the driver keys (the CAS sink for keys and pad buttons, InputBegan for a mouse button), so never while typing, during
	 * a rebind capture or (pad) while a menu owns the D-pad; the listener decides whether the map may open. Returns a
	 * disconnect function.
	 */
	onMapAction(listener: MapListener): () => void {
		this.mapListeners.push(listener);
		return () => {
			const i = this.mapListeners.indexOf(listener);
			if (i >= 0) this.mapListeners.remove(i);
		};
	}

	/**
	 * Menu pad input (docs/GAMEPAD_MENUS.md GM4): while a menu owns the pad (`setUiNavigation`) and no rebind capture
	 * runs, a press of LB / RB / LT / RT / X / Y (shared/view/menu MENU_PAD_INPUT_KEYS; axes 0) and right-stick scroll
	 * steps (`PAD_KEYS.rightStick` with the stick's axes, past GAMEPAD_MENU.stickDeadZone, every scrollRepeatSec). They
	 * stay sunk (the CAS sink), so the game never sees them as actions. FocusController hands them to the owning menu
	 * scope. Returns a disconnect function.
	 */
	onMenuPadInput(listener: MenuPadListener): () => void {
		this.menuPadListeners.push(listener);
		return () => {
			const i = this.menuPadListeners.indexOf(listener);
			if (i >= 0) this.menuPadListeners.remove(i);
		};
	}

	/**
	 * Polls every device ONCE for this rendered frame and returns the quantized, world-space frame. (playerX, playerZ)
	 * is the player's current sim position (mouse aim is a vector from it). touchCtx is the run the touch controls read
	 * (auto-target, facing, the draft); undefined means no touch frame.
	 */
	sample(
		playerX: number,
		playerZ: number,
		out: InputFrame = { ...EMPTY_INPUT },
		touchCtx?: TouchAimContext,
	): InputFrame {
		this.pollKeyboardMouse();
		// A click on a draft card picks it through the tap path (queueDraftPick, on Activated); its mouse press must not
		// also reach the sim as the confirm (it would take the card under the stick before the click's column push).
		if (touchCtx !== undefined && this.mousePressOnGui()) {
			const guiPressed = new Set<string>();
			for (const [t, name] of this.mouseTypes) if (this.guiMouse.has(t)) guiPressed.add(name);
			dropDraftGuiMouse(this.mouse, guiPressed, draftStatus(touchCtx.state, touchCtx.playerIndex).open);
		}
		const pad = this.pollGamepad();
		this.tracker.padSampled(pad);
		this.publishDevice();
		if (this.tracker.aimDevice === "mouse") this.updatePointerAim(playerX, playerZ);
		const now = os.clock();
		const dt = math.clamp(now - this.lastSampleClock, 0, TOUCH.maxFrameSec);
		this.lastSampleClock = now;
		let touchSnap: TouchSnapshot | undefined;
		if (touchCtx !== undefined && (this.touchMode !== "hidden" || this.touch.hasDraftPick())) {
			touchSnap = this.touchFrame(touchCtx, dt);
			if (touchSnap.aimX !== 0 || touchSnap.aimZ !== 0) this.tracker.touchAimed();
		}
		const frame = mapDevicesToInput(
			{
				kbm: { keys: this.keys, mouseButtons: this.mouse },
				pad,
				aimDevice: this.tracker.aimDevice,
				pointerAimX: this.pointerAimX,
				pointerAimZ: this.pointerAimZ,
				touch: touchSnap,
			},
			out,
			this.bindings,
		);
		frame.buttons = maskDebugButtons(frame.buttons, this.debugButtons);
		this.lastButtons = frame.buttons;
		return frame;
	}

	/** The touch controls' state machine (the TouchControlsController feeds and draws from it, MB9). */
	getTouch(): TouchControls {
		return this.touch;
	}

	/**
	 * The touch surface the screen shows. Changing it drops every finger and the aim latch, so a surface that hides
	 * cannot leave a stick held. A queued draft pick survives (the draft may still be open).
	 */
	setTouchMode(mode: TouchMode): void {
		if (mode === this.touchMode) return;
		this.touch.reset();
		this.touchMode = mode;
	}

	getTouchMode(): TouchMode {
		return this.touchMode;
	}

	/** The stick's full-deflection radius in raw px (the controls scale with the screen). */
	setTouchStickRadiusPx(px: number): void {
		this.touchStickRadiusPx = px;
	}

	/**
	 * A draft card was tapped: the stick is pushed into its column and a FIRE pulse confirms it, unless the draft
	 * tap filter takes the tap (the boon draft reveal, docs/DRAFT_REVEAL.md DR6: a tap during the reveal skips it and
	 * its pick is dropped).
	 */
	queueDraftPick(column: number): void {
		if (this.draftTapFilter?.() === true) return;
		this.touch.queueDraftPick(column);
	}

	/**
	 * DraftRevealController registers its tap filter here (one injection direction: this controller never injects it):
	 * called on every draft card tap; true = the tap was taken (a skip), no pick is queued.
	 */
	setDraftTapFilter(filter: () => boolean): void {
		this.draftTapFilter = filter;
	}

	/** Fires every map listener, as the bound map input does (the touch Map button, MB9). */
	emitMapAction(): void {
		for (const listener of this.mapListeners) listener();
	}

	/**
	 * The auto-target's world position while the last Attack / Alt aim came from it, in play mode; undefined otherwise
	 * (the target ring draws only then).
	 */
	getTouchTarget(): { readonly x: number; readonly z: number } | undefined {
		if (this.touchMode !== "play" || !this.touch.lastAimWasAuto() || this.targetId === 0) return undefined;
		return { x: this.targetX, z: this.targetZ };
	}

	/**
	 * Switches to `b`: the poll lists, the CAS sink's key list, the device tracker; inputs held at a change read as
	 * released until let go. The default layout gives exactly the pre-rebinding key lists.
	 */
	private applyBindings(b: Bindings): void {
		const changed = this.sinkBound && b !== this.bindings;
		this.bindings = b;
		this.tracker.bindings = b;
		const keyCodes = new Array<[Enum.KeyCode, string]>();
		for (const name of boundKeyNames(b)) {
			const code = KEY_CODES.get(name);
			if (code !== undefined) keyCodes.push([code, name]);
		}
		const padCodes = new Array<[Enum.KeyCode, string]>();
		for (const name of boundPadButtonNames(b)) {
			const code = KEY_CODES.get(name);
			if (code !== undefined) padCodes.push([code, name]);
		}
		const mouseTypes = new Array<[Enum.UserInputType, string]>();
		for (const name of boundMouseButtonNames(b)) {
			const t = MOUSE_TYPES.get(name);
			if (t !== undefined) mouseTypes.push([t, name]);
		}
		this.keyCodes = keyCodes;
		this.padCodes = padCodes;
		this.mouseTypes = mouseTypes;
		if (changed) this.blockHeldInputs();
		this.bindSink();
	}

	/** Every keyboard key, mouse button and pad button held right now reads as released until it is let go. */
	private blockHeldInputs(): void {
		const keys = new Set<string>();
		for (const obj of UserInputService.GetKeysPressed()) keys.add(obj.KeyCode.Name);
		this.keyGate.block(keys);
		const mouse = new Set<string>();
		for (const [name, t] of MOUSE_TYPES) if (UserInputService.IsMouseButtonPressed(t)) mouse.add(name);
		this.mouseGate.block(mouse);
		const pad = this.heldPadButtons();
		if (pad !== undefined) this.padGate.block(pad);
	}

	/** The active pad's buttons and triggers held right now (undefined: no pad). */
	private heldPadButtons(): Set<string> | undefined {
		const gamepad = activePad(this.pads);
		if (gamepad === undefined) return undefined;
		const pad = new Set<string>();
		for (const name of PAD_BUTTON_NAMES) {
			const code = KEY_CODES.get(name);
			if (code !== undefined && UserInputService.IsGamepadButtonDown(gamepad, code)) pad.add(name);
		}
		for (const obj of UserInputService.GetGamepadState(gamepad)) {
			const name = obj.KeyCode.Name;
			if ((name === LEFT_TRIGGER || name === RIGHT_TRIGGER) && obj.Position.Z > TRIGGER_THRESHOLD) pad.add(name);
		}
		return pad;
	}

	/** Menu pad input is reported: a menu owns the pad and no rebind capture runs. */
	private menuPadInputOpen(): boolean {
		return this.uiNavigation && !this.inputCaptured;
	}

	private emitMenuPad(input: MenuPadInput): void {
		for (const listener of this.menuPadListeners) listener(input);
	}

	/** The right stick's menu scroll steps (onMenuPadInput), once per rendered frame while a menu owns the pad. */
	private stepMenuStick(dt: number): void {
		if (!this.menuPadInputOpen() || this.menuPadListeners.size() === 0) {
			this.menuStick.reset();
			return;
		}
		const gamepad = activePad(this.pads);
		if (gamepad === undefined) {
			this.menuStick.reset();
			return;
		}
		let x = 0;
		let y = 0;
		for (const obj of UserInputService.GetGamepadState(gamepad)) {
			if (obj.KeyCode !== Enum.KeyCode.Thumbstick2) continue;
			x = obj.Position.X;
			y = obj.Position.Y;
		}
		const m = GAMEPAD_MENU;
		if (this.menuStick.step(x, y, dt, m.stickDeadZone, m.scrollRepeatSec)) {
			this.emitMenuPad({ keyName: PAD_KEYS.rightStick, x, y });
		}
	}

	/** (Re)binds the CAS sink to the current key list and both sticks. */
	private bindSink(): void {
		if (this.sinkBound) ContextActionService.UnbindAction(SINK_ACTION);
		const sunk = new Array<Enum.KeyCode>();
		for (const [code] of this.keyCodes) sunk.push(code);
		for (const [code] of this.padCodes) sunk.push(code);
		for (const name of SUNK_STICKS) {
			const code = KEY_CODES.get(name);
			if (code !== undefined) sunk.push(code);
		}
		// The menus' pad buttons, bound or not (docs/GAMEPAD_MENUS.md GM4): sunk, so nothing else acts on them.
		for (const name of MENU_PAD_INPUT_KEYS) {
			const code = KEY_CODES.get(name);
			if (code !== undefined && !sunk.includes(code)) sunk.push(code);
		}
		ContextActionService.BindActionAtPriority(
			SINK_ACTION,
			(_, state, input) => {
				if (this.inputCaptured) return Enum.ContextActionResult.Sink;
				const name = input.KeyCode.Name;
				if (this.uiNavigation && UI_NAV_KEYS.has(name)) return Enum.ContextActionResult.Pass;
				// A menu's bumper / trigger / X / Y is the menu's (onMenuPadInput), never the map; it still reports the
				// driver keys, so a pad restart bound to one of them works on the run over / pause (driverKeyAction gates it
				// by the RestartWindow; FocusController drops that key's menu shortcut, menuPadAction `restartPad`).
				if (this.uiNavigation && isMenuPadInputKey(name)) {
					if (state === Enum.UserInputState.Begin) this.reportDriverOnly(name);
					return Enum.ContextActionResult.Sink;
				}
				if (state === Enum.UserInputState.Begin) this.reportDriver(name);
				return Enum.ContextActionResult.Sink;
			},
			false,
			Enum.ContextActionPriority.High.Value,
			...sunk,
		);
		this.sinkBound = true;
	}

	private reportDriver(name: string): void {
		this.reportDriverOnly(name);
		if (isMapInput(name, this.bindings)) for (const listener of this.mapListeners) listener();
	}

	/** The driver keys only (restart, replay check), not the map. */
	private reportDriverOnly(name: string): void {
		const action = driverKeyAction(name, this.debugButtons, this.restartWindow(), this.bindings);
		if (action !== undefined) for (const listener of this.driverListeners) listener(action);
	}

	private pollKeyboardMouse(): void {
		this.keys.clear();
		this.mouse.clear();
		if (chatFocused()) return; // typing in chat
		for (const [code, name] of this.keyCodes) if (UserInputService.IsKeyDown(code)) this.keys.add(name);
		this.keyGate.filter(this.keys);
		// Phones can report touches as mouse input: the mouse buttons are read only when a mouse is attached.
		if (UserInputService.MouseEnabled) {
			for (const [t, name] of this.mouseTypes) if (UserInputService.IsMouseButtonPressed(t)) this.mouse.add(name);
		}
		if (this.mouseSuppressed) {
			if (this.mouse.size() > 0) {
				this.mouse.clear();
				return;
			}
			this.mouseSuppressed = false;
		}
		this.mouseGate.filter(this.mouse);
	}

	private pollGamepad(): GamepadSnapshot | undefined {
		const gamepad = activePad(this.pads);
		if (gamepad === undefined) return undefined;
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
		// A blocked trigger (held across a bindings change) also reads 0 on its analog axis until it is let go.
		if (leftTrigger > TRIGGER_THRESHOLD) this.padButtons.add(LEFT_TRIGGER);
		if (rightTrigger > TRIGGER_THRESHOLD) this.padButtons.add(RIGHT_TRIGGER);
		this.padGate.filter(this.padButtons);
		if (this.padGate.isBlocked(LEFT_TRIGGER)) leftTrigger = 0;
		if (this.padGate.isBlocked(RIGHT_TRIGGER)) rightTrigger = 0;
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

	/** One touch frame: the controls' snapshot, with the auto-target and the draft read from the run. */
	private touchFrame(ctx: TouchAimContext, dt: number): TouchSnapshot {
		const me = ctx.player ?? playerAt(ctx.state, ctx.playerIndex);
		const draft = draftStatus(ctx.state, ctx.playerIndex);
		return this.touch.frame({
			dt,
			stickRadiusPx: this.touchStickRadiusPx,
			autoTarget: this.touchAutoTarget,
			facingX: me.faceX,
			facingZ: me.faceZ,
			autoAim: () => {
				const t = pickAutoTarget({
					state: ctx.state,
					playerIndex: ctx.playerIndex,
					blocked: ctx.blocked,
					previousId: this.targetId,
					player: me,
				});
				this.targetId = t !== undefined ? t.id : 0;
				if (t === undefined) return undefined;
				this.targetX = t.x;
				this.targetZ = t.z;
				return { x: t.x - me.x, z: t.z - me.z };
			},
			draftOpen: draft.open,
			draftReady: draft.ready,
			draftDeal: draft.deal,
		});
	}

	private publishDevice(): void {
		const device = this.tracker.device;
		if (clientStore.getState().game.inputDevice !== device) clientStore.setInputDevice(device);
	}
}
