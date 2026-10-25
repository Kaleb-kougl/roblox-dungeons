/**
 * Keyboard + mouse + gamepad -> quantized InputFrame: the pure half of the client's input (port of project-kaleb-vale
 * src/sim/devices.ts @ 42897e2, "Pure mapping"). The InputController reads Roblox devices into the snapshots below
 * (Enum.KeyCode / Enum.UserInputType NAMES, so this runs headlessly) and calls mapDevicesToInput once per frame.
 *
 * Move and stick input are SCREEN-relative (right, up); screenToWorld rotates them by the camera yaw into world X/Z, so
 * "up" moves toward screen-up. The sim only ever sees the quantized integers this produces.
 *
 * Roblox remaps (Roblox reserves Escape and Tab): PAUSE is P (web: Escape), SWAP is E (web: Tab). Gamepad bindings
 * are the web build's standard mapping: RT fire, LT alt, LB roll, RB Ember, Y swap, dpad up flask, Start pause.
 */
import { CAMERA_YAW_DEG } from "shared/config";
import {
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	PORT_BUTTONS,
	SQRT1_2,
	quantizeInput,
	type InputFrame,
} from "shared/sim";
import { STICK_DEADZONE, TRIGGER_THRESHOLD } from "./config";

// ---------------------------------------------------------------------------------------------
// Bindings

/** Enum.KeyCode name -> button bit (web KEY_BINDINGS with the Roblox remaps). */
export const KEY_BINDINGS: ReadonlyMap<string, number> = new Map<string, number>([
	["Space", Button.ROLL],
	["Q", Button.EMBER],
	["One", Button.SKILL1],
	["Two", Button.SKILL2],
	["Three", Button.SKILL3],
	["Four", Button.SKILL4],
	["F", Button.FLASK],
	["E", Button.SWAP], // web: Tab (Roblox: player list)
	["P", Button.PAUSE], // web: Escape (Roblox: the game menu)
	["K", Button.DEBUG_HIT], // debug: one normal hit on the player
	["J", Button.DEBUG_BOSS], // debug: 10% of max hp off an engaged boss
	["N", DEBUG_FLOOR_BUTTON], // debug (endless): end the floor now (Roblox port)
]);

/** Movement keys (web: WASD; the arrows are a Roblox convenience). */
export const MOVE_KEYS = {
	up: ["W", "Up"],
	down: ["S", "Down"],
	left: ["A", "Left"],
	right: ["D", "Right"],
} as const;

/** Enum.UserInputType name -> button bit (web MOUSE_BINDINGS). */
export const MOUSE_BINDINGS: ReadonlyMap<string, number> = new Map<string, number>([
	["MouseButton1", Button.FIRE],
	["MouseButton2", Button.ALT],
]);

/** Gamepad Enum.KeyCode name -> button bit (web PAD_BINDINGS, standard mapping). */
export const PAD_BINDINGS: ReadonlyMap<string, number> = new Map<string, number>([
	["ButtonR2", Button.FIRE], // RT
	["ButtonL2", Button.ALT], // LT
	["ButtonL1", Button.ROLL], // LB
	["ButtonR1", Button.EMBER], // RB
	["ButtonA", Button.SKILL1],
	["ButtonB", Button.SKILL2],
	["ButtonX", Button.SKILL3],
	["ButtonY", Button.SWAP],
	["DPadRight", Button.SKILL4],
	["DPadUp", Button.FLASK],
	["ButtonStart", Button.PAUSE],
]);

/** Analog trigger names: pressed when held OR their analog value passes TRIGGER_THRESHOLD. */
export const LEFT_TRIGGER = "ButtonL2";
export const RIGHT_TRIGGER = "ButtonR2";

/** Driver keys (not sim input; web driverKeys.ts): restart (any time), replay check (debug only). */
export const RESTART_KEY = "R";
/** F8 as in the web build; L as well, because Roblox Studio can take F8 for itself while playing. */
export const REPLAY_CHECK_KEYS: ReadonlyArray<string> = ["F8", "L"];
/** Gamepad restart: only while the run is over (dead / victory) or paused, so a stray press never ends a run. */
export const PAD_RESTART_KEY = "DPadDown";

/** The key the HUD names for SWAP, per device (web: Tab / Y). */
export const SWAP_HINT = { keyboard: "E", gamepad: "Y" } as const;
/** The key the HUD names for restart, per device. */
export const RESTART_HINT = { keyboard: RESTART_KEY, gamepad: "D-pad down" } as const;

/** Button bits that only exist for debugging: stripped unless debug keys are on (web DEBUG_BUTTONS). */
export const DEBUG_BUTTONS = bit32.bor(Button.DEBUG_HIT, Button.DEBUG_BOSS);
/** Every debug bit maskDebugButtons strips: DEBUG_BUTTONS plus the port's endless floor skip (N). */
export const ALL_DEBUG_BUTTONS = bit32.bor(DEBUG_BUTTONS, DEBUG_FLOOR_BUTTON);

// ---------------------------------------------------------------------------------------------
// Device snapshots

export interface KeyboardMouseSnapshot {
	/** Held Enum.KeyCode names. */
	readonly keys: ReadonlySet<string>;
	/** Held mouse buttons as Enum.UserInputType names (MouseButton1, MouseButton2). */
	readonly mouseButtons: ReadonlySet<string>;
}

/** One gamepad. Roblox thumbstick Y is UP-positive (the web Gamepad API's is down-positive). */
export interface GamepadSnapshot {
	readonly leftX: number;
	readonly leftY: number;
	readonly rightX: number;
	readonly rightY: number;
	/** ButtonL2 / ButtonR2 analog values (InputObject.Position.Z), 0..1. */
	readonly leftTrigger: number;
	readonly rightTrigger: number;
	/** Held gamepad button Enum.KeyCode names. */
	readonly buttons: ReadonlySet<string>;
}

export type AimDevice = "none" | "mouse" | "stick";
export type InputDeviceKind = "keyboard" | "gamepad";

export interface DeviceSnapshot {
	readonly kbm: KeyboardMouseSnapshot;
	readonly pad: GamepadSnapshot | undefined;
	/** Which aim device was used most recently. */
	readonly aimDevice: AimDevice;
	/** World-space (sim units) vector from the player to the pointer's floor hit (any length). */
	readonly pointerAimX: number;
	readonly pointerAimZ: number;
}

export interface Vec2 {
	readonly x: number;
	readonly y: number;
}

const ZERO: Vec2 = { x: 0, y: 0 };

// ---------------------------------------------------------------------------------------------
// Pure mapping

const YAW = (CAMERA_YAW_DEG * math.pi) / 180;
const YAW_COS = math.cos(YAW);
const YAW_SIN = math.sin(YAW);

/** Screen-relative (right, up) -> world (x, z) on the ground plane, for the iso camera's yaw (web screenToWorld). */
export function screenToWorld(right: number, up: number): { x: number; z: number } {
	return {
		x: right * YAW_COS - up * YAW_SIN,
		z: -right * YAW_SIN - up * YAW_COS,
	};
}

function finite(v: number): number {
	return v === v && v !== math.huge && v !== -math.huge ? v : 0;
}

/** Radial deadzone with rescale: |v| <= dz -> 0, else magnitude remapped from [dz, 1] to [0, 1]. */
export function applyRadialDeadzone(x: number, y: number, deadzone: number = STICK_DEADZONE): Vec2 {
	const len = math.sqrt(x * x + y * y);
	if (!(len > deadzone)) return ZERO;
	const scaled = math.min(1, (len - deadzone) / (1 - deadzone));
	const k = scaled / len;
	return { x: x * k, y: y * k };
}

/** Clamps a vector to length <= 1. */
export function clampUnit(x: number, y: number): Vec2 {
	const len2 = x * x + y * y;
	if (len2 <= 1) return { x, y };
	const inv = 1 / math.sqrt(len2);
	return { x: x * inv, y: y * inv };
}

/** Normalizes to length 1, or (0, 0) if (nearly) zero. */
export function normalizeOrZero(x: number, y: number, minLength = 1e-6): Vec2 {
	const len = math.sqrt(x * x + y * y);
	if (!(len > minLength)) return ZERO;
	return { x: x / len, y: y / len };
}

function anyHeld(keys: ReadonlySet<string>, names: ReadonlyArray<string>): boolean {
	for (const n of names) if (keys.has(n)) return true;
	return false;
}

/** WASD / arrows -> screen-relative (right, up), diagonals normalized to length 1. */
export function keyboardMoveVector(keys: ReadonlySet<string>): Vec2 {
	const x = (anyHeld(keys, MOVE_KEYS.right) ? 1 : 0) - (anyHeld(keys, MOVE_KEYS.left) ? 1 : 0);
	const y = (anyHeld(keys, MOVE_KEYS.up) ? 1 : 0) - (anyHeld(keys, MOVE_KEYS.down) ? 1 : 0);
	if (x !== 0 && y !== 0) return { x: x * SQRT1_2, y: y * SQRT1_2 };
	return { x, y };
}

export function keyboardMouseButtons(kbm: KeyboardMouseSnapshot): number {
	let bits = 0;
	for (const key of kbm.keys) bits = bit32.bor(bits, KEY_BINDINGS.get(key) ?? 0);
	for (const b of kbm.mouseButtons) bits = bit32.bor(bits, MOUSE_BINDINGS.get(b) ?? 0);
	return bits;
}

function padButtonDown(pad: GamepadSnapshot, name: string): boolean {
	if (pad.buttons.has(name)) return true;
	if (name === LEFT_TRIGGER) return finite(pad.leftTrigger) > TRIGGER_THRESHOLD;
	if (name === RIGHT_TRIGGER) return finite(pad.rightTrigger) > TRIGGER_THRESHOLD;
	return false;
}

export function gamepadButtons(pad: GamepadSnapshot): number {
	let bits = 0;
	for (const [name, bit] of PAD_BINDINGS) if (padButtonDown(pad, name)) bits = bit32.bor(bits, bit);
	return bits;
}

/** Left stick, deadzoned, as screen-relative (right, up). */
export function gamepadMoveVector(pad: GamepadSnapshot, deadzone: number = STICK_DEADZONE): Vec2 {
	return applyRadialDeadzone(finite(pad.leftX), finite(pad.leftY), deadzone);
}

/** Right stick, deadzoned, as screen-relative (right, up). (0, 0) inside the deadzone. */
export function gamepadAimVector(pad: GamepadSnapshot, deadzone: number = STICK_DEADZONE): Vec2 {
	return applyRadialDeadzone(finite(pad.rightX), finite(pad.rightY), deadzone);
}

/** True if the right stick is outside the deadzone (switches the active aim device to the stick). */
export function isStickAiming(pad: GamepadSnapshot | undefined, deadzone: number = STICK_DEADZONE): boolean {
	if (pad === undefined) return false;
	const v = gamepadAimVector(pad, deadzone);
	return v.x !== 0 || v.y !== 0;
}

/** True if any mapped pad button is down or either stick is outside the deadzone (the player is using the pad). */
export function isPadActive(pad: GamepadSnapshot | undefined, deadzone: number = STICK_DEADZONE): boolean {
	if (pad === undefined) return false;
	if (gamepadButtons(pad) !== 0) return true;
	const ls = gamepadMoveVector(pad, deadzone);
	return ls.x !== 0 || ls.y !== 0 || isStickAiming(pad, deadzone);
}

/** Combines every device into one quantized, world-space InputFrame (web mapDevicesToInput). */
export function mapDevicesToInput(snap: DeviceSnapshot, out: InputFrame = { ...EMPTY_INPUT }): InputFrame {
	// Move: keyboard + left stick, summed and clamped to unit length, then rotated to world.
	const kb = keyboardMoveVector(snap.kbm.keys);
	const ls = snap.pad !== undefined ? gamepadMoveVector(snap.pad) : ZERO;
	const moveScreen = clampUnit(kb.x + ls.x, kb.y + ls.y);
	const move = screenToWorld(moveScreen.x, moveScreen.y);

	// Aim: a direction only, from whichever device was used last.
	let aim = ZERO;
	if (snap.aimDevice === "mouse") {
		aim = normalizeOrZero(finite(snap.pointerAimX), finite(snap.pointerAimZ));
	} else if (snap.aimDevice === "stick" && snap.pad !== undefined) {
		const rs = gamepadAimVector(snap.pad);
		const w = screenToWorld(rs.x, rs.y);
		aim = normalizeOrZero(w.x, w.z);
	}

	let buttons = keyboardMouseButtons(snap.kbm);
	if (snap.pad !== undefined) buttons = bit32.bor(buttons, gamepadButtons(snap.pad));

	quantizeInput(move.x, move.z, aim.x, aim.y, buttons, out);
	// quantizeButtons keeps the web build's bits only; the port's own bits (PORT_BUTTONS) pass through here.
	out.buttons = bit32.bor(out.buttons, bit32.band(buttons, PORT_BUTTONS));
	return out;
}

/**
 * Which aim device and which input device the player used last (web InputSampler's aimDevice + inputDevice.ts).
 * Aim: the mouse wins on a move or a click, the right stick when pushed past the deadzone; releasing the stick keeps
 * stick aim (zero aim = face the movement) until the mouse moves again. Device (for UI hints only, never the sim):
 * a key or click -> keyboard, an active pad -> gamepad.
 */
export class InputDeviceTracker {
	aimDevice: AimDevice = "none";
	device: InputDeviceKind = "keyboard";

	keyPressed(): void {
		this.device = "keyboard";
	}

	mouseClicked(): void {
		this.aimDevice = "mouse";
		this.device = "keyboard";
	}

	mouseMoved(): void {
		this.aimDevice = "mouse";
	}

	/** Called once per sample with the current pad (or undefined). */
	padSampled(pad: GamepadSnapshot | undefined): void {
		if (isStickAiming(pad)) this.aimDevice = "stick";
		if (isPadActive(pad)) this.device = "gamepad";
	}
}

/** `buttons` without the debug bits unless `debugAllowed` (web maskDebugButtons). */
export function maskDebugButtons(buttons: number, debugAllowed: boolean): number {
	return debugAllowed ? buttons : bit32.band(buttons, bit32.bnot(ALL_DEBUG_BUTTONS));
}

export type DriverKeyAction = "replayCheck" | "reset" | undefined;

/**
 * A pressed key / button name -> driver action (web driverKeyAction). R restarts any time, the pad's restart only
 * while the run is over or paused; F8 / L only with debug keys on.
 */
export function driverKeyAction(name: string, debugKeys: boolean, runOverOrPaused: boolean): DriverKeyAction {
	if (name === RESTART_KEY) return "reset";
	if (name === PAD_RESTART_KEY && runOverOrPaused) return "reset";
	if (debugKeys && REPLAY_CHECK_KEYS.includes(name)) return "replayCheck";
	return undefined;
}

/** Every Enum.KeyCode name the game reads (bindings, movement, driver keys): the InputController polls / sinks these. */
export function boundKeyNames(): ReadonlyArray<string> {
	const out = new Array<string>();
	for (const [name] of KEY_BINDINGS) out.push(name);
	for (const names of [MOVE_KEYS.up, MOVE_KEYS.down, MOVE_KEYS.left, MOVE_KEYS.right]) {
		for (const n of names) out.push(n);
	}
	out.push(RESTART_KEY);
	for (const k of REPLAY_CHECK_KEYS) out.push(k);
	return out;
}

/** Every gamepad Enum.KeyCode name the game reads (bindings and the pad restart). */
export function boundPadButtonNames(): ReadonlyArray<string> {
	const out = new Array<string>();
	for (const [name] of PAD_BINDINGS) out.push(name);
	out.push(PAD_RESTART_KEY);
	return out;
}
