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
 * The layout is rebindable (task L4b): every mapping function takes a `Bindings` (shared/play bindings.ts), default
 * DEFAULT_BINDINGS (the layout above); the exported tables below are that default layout's.
 *
 * @module
 */
import { CAMERA_YAW_DEG } from "shared/config";
import {
	Button,
	DEBUG_DROP_BUTTON,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	PORT_BUTTONS,
	SQRT1_2,
	quantizeInput,
	type InputFrame,
} from "shared/sim";
import {
	ACTION_BUTTONS,
	DEFAULT_BINDINGS,
	KBM_ACTIONS,
	PAD_ACTIONS,
	isMouseButtonName,
	type Bindings,
} from "./bindings";
import { DEBUG_REPLAY_CHECK_KEYS, FIXED_INPUTS, STICK_DEADZONE, TRIGGER_THRESHOLD } from "./config";
import type { TouchSnapshot } from "./touch";

// ---------------------------------------------------------------------------------------------
// Bindings (bindings.ts holds the rebindable layout; this compiles one into lookup tables)

/** Analog trigger names: pressed when held OR their analog value passes TRIGGER_THRESHOLD, whatever they are bound to. */
export const LEFT_TRIGGER = "ButtonL2";
export const RIGHT_TRIGGER = "ButtonR2";

/** One Bindings as lookup tables: input name -> button bits, the move keys, the restart and map inputs. */
interface CompiledBindings {
	readonly source: Bindings;
	/** Enum.KeyCode name -> button bits (the rebindable actions plus the fixed pause and debug keys). */
	readonly keyBits: ReadonlyMap<string, number>;
	/** Enum.UserInputType mouse button name -> button bits. */
	readonly mouseBits: ReadonlyMap<string, number>;
	/** Gamepad Enum.KeyCode name -> button bits (plus the fixed Start pause). */
	readonly padBits: ReadonlyMap<string, number>;
	readonly up: ReadonlyArray<string>;
	readonly down: ReadonlyArray<string>;
	readonly left: ReadonlyArray<string>;
	readonly right: ReadonlyArray<string>;
	readonly restartKbm: ReadonlyArray<string>;
	readonly restartPad: string;
	readonly mapKbm: ReadonlyArray<string>;
	readonly mapPad: string;
}

function orInto(map: Map<string, number>, name: string, bit: number): void {
	map.set(name, bit32.bor(map.get(name) ?? 0, bit));
}

function compile(b: Bindings): CompiledBindings {
	const keyBits = new Map<string, number>();
	const mouseBits = new Map<string, number>();
	const padBits = new Map<string, number>();
	orInto(keyBits, FIXED_INPUTS.pause, Button.PAUSE); // web: Escape (Roblox: the game menu)
	orInto(keyBits, FIXED_INPUTS.debugHit, Button.DEBUG_HIT); // debug: one normal hit on the player
	orInto(keyBits, FIXED_INPUTS.debugBoss, Button.DEBUG_BOSS); // debug: 10% of max hp off an engaged boss
	orInto(keyBits, FIXED_INPUTS.debugFloor, DEBUG_FLOOR_BUTTON); // debug (endless): end the floor now (Roblox port)
	orInto(keyBits, FIXED_INPUTS.debugDrop, DEBUG_DROP_BUTTON); // debug (drops): the next boost kind ahead (Roblox port)
	orInto(padBits, FIXED_INPUTS.padPause, Button.PAUSE);
	for (const action of KBM_ACTIONS) {
		const bit = ACTION_BUTTONS.get(action);
		if (bit === undefined) continue;
		for (const name of b.kbm[action]) orInto(isMouseButtonName(name) ? mouseBits : keyBits, name, bit);
	}
	for (const action of PAD_ACTIONS) {
		const bit = ACTION_BUTTONS.get(action);
		if (bit !== undefined) orInto(padBits, b.pad[action], bit);
	}
	return {
		source: b,
		keyBits,
		mouseBits,
		padBits,
		up: b.kbm.moveUp,
		down: b.kbm.moveDown,
		left: b.kbm.moveLeft,
		right: b.kbm.moveRight,
		restartKbm: b.kbm.restart,
		restartPad: b.pad.restart,
		mapKbm: b.kbm.map,
		mapPad: b.pad.map,
	};
}

const DEFAULT_COMPILED = compile(DEFAULT_BINDINGS);
/** One-entry cache: Bindings are immutable values (every edit returns a new one), so identity is enough. */
let lastCompiled = DEFAULT_COMPILED;

function compiled(b: Bindings): CompiledBindings {
	if (b === DEFAULT_COMPILED.source) return DEFAULT_COMPILED;
	if (b !== lastCompiled.source) lastCompiled = compile(b);
	return lastCompiled;
}

/** Enum.KeyCode name -> button bit, default layout (web KEY_BINDINGS with the Roblox remaps: E swap, P pause). */
export const KEY_BINDINGS: ReadonlyMap<string, number> = DEFAULT_COMPILED.keyBits;

/** Movement keys of the default layout (web: WASD; the arrows are a Roblox convenience). */
export const MOVE_KEYS = {
	up: DEFAULT_COMPILED.up,
	down: DEFAULT_COMPILED.down,
	left: DEFAULT_COMPILED.left,
	right: DEFAULT_COMPILED.right,
} as const;

/** Enum.UserInputType name -> button bit, default layout (web MOUSE_BINDINGS). */
export const MOUSE_BINDINGS: ReadonlyMap<string, number> = DEFAULT_COMPILED.mouseBits;

/** Gamepad Enum.KeyCode name -> button bit, default layout (web PAD_BINDINGS, standard mapping). */
export const PAD_BINDINGS: ReadonlyMap<string, number> = DEFAULT_COMPILED.padBits;

/** Driver keys (not sim input; web driverKeys.ts): the default restart key (run over, or any time in a dev run). */
export const RESTART_KEY = DEFAULT_BINDINGS.kbm.restart[0];
/** F8 as in the web build; L as well, because Roblox Studio can take F8 for itself while playing. Fixed. */
export const REPLAY_CHECK_KEYS: ReadonlyArray<string> = DEBUG_REPLAY_CHECK_KEYS;
/** Default gamepad restart: only while the run is over (dead / victory) or paused, so a stray press never ends a run. */
export const PAD_RESTART_KEY = DEFAULT_BINDINGS.pad.restart;

/** Button bits that only exist for debugging: stripped unless debug keys are on (web DEBUG_BUTTONS). */
export const DEBUG_BUTTONS = bit32.bor(Button.DEBUG_HIT, Button.DEBUG_BOSS);
/** Every debug bit maskDebugButtons strips: DEBUG_BUTTONS plus the port's endless floor skip (N) and boost drop (Semicolon, MD11). */
export const ALL_DEBUG_BUTTONS = bit32.bor(DEBUG_BUTTONS, DEBUG_FLOOR_BUTTON, DEBUG_DROP_BUTTON);

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

export type AimDevice = "none" | "mouse" | "stick" | "touch";
export type InputDeviceKind = "keyboard" | "gamepad" | "touch";

export interface DeviceSnapshot {
	readonly kbm: KeyboardMouseSnapshot;
	readonly pad: GamepadSnapshot | undefined;
	/** One frame of touch input (MB4); absent when no touch device is in use. Optional, so older snapshots still compile. */
	readonly touch?: TouchSnapshot;
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

const NO_NAMES: ReadonlySet<string> = new Set<string>();

function anyHeld(keys: ReadonlySet<string>, mouse: ReadonlySet<string>, names: ReadonlyArray<string>): boolean {
	for (const n of names) if (keys.has(n) || mouse.has(n)) return true;
	return false;
}

/**
 * The bound move keys (default WASD / arrows) -> screen-relative (right, up), diagonals normalized to length 1.
 * A move slot may hold a mouse button: pass the held mouse buttons for those.
 */
export function keyboardMoveVector(
	keys: ReadonlySet<string>,
	bindings: Bindings = DEFAULT_BINDINGS,
	mouseButtons: ReadonlySet<string> = NO_NAMES,
): Vec2 {
	const c = compiled(bindings);
	const x = (anyHeld(keys, mouseButtons, c.right) ? 1 : 0) - (anyHeld(keys, mouseButtons, c.left) ? 1 : 0);
	const y = (anyHeld(keys, mouseButtons, c.up) ? 1 : 0) - (anyHeld(keys, mouseButtons, c.down) ? 1 : 0);
	if (x !== 0 && y !== 0) return { x: x * SQRT1_2, y: y * SQRT1_2 };
	return { x, y };
}

export function keyboardMouseButtons(kbm: KeyboardMouseSnapshot, bindings: Bindings = DEFAULT_BINDINGS): number {
	const c = compiled(bindings);
	let bits = 0;
	for (const key of kbm.keys) bits = bit32.bor(bits, c.keyBits.get(key) ?? 0);
	for (const b of kbm.mouseButtons) bits = bit32.bor(bits, c.mouseBits.get(b) ?? 0);
	return bits;
}

/** Held, or (a trigger, whatever action it is bound to) its analog value is past TRIGGER_THRESHOLD. */
function padButtonDown(pad: GamepadSnapshot, name: string): boolean {
	if (pad.buttons.has(name)) return true;
	if (name === LEFT_TRIGGER) return finite(pad.leftTrigger) > TRIGGER_THRESHOLD;
	if (name === RIGHT_TRIGGER) return finite(pad.rightTrigger) > TRIGGER_THRESHOLD;
	return false;
}

export function gamepadButtons(pad: GamepadSnapshot, bindings: Bindings = DEFAULT_BINDINGS): number {
	let bits = 0;
	for (const [name, bit] of compiled(bindings).padBits) if (padButtonDown(pad, name)) bits = bit32.bor(bits, bit);
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
export function isPadActive(
	pad: GamepadSnapshot | undefined,
	deadzone: number = STICK_DEADZONE,
	bindings: Bindings = DEFAULT_BINDINGS,
): boolean {
	if (pad === undefined) return false;
	if (gamepadButtons(pad, bindings) !== 0) return true;
	const ls = gamepadMoveVector(pad, deadzone);
	return ls.x !== 0 || ls.y !== 0 || isStickAiming(pad, deadzone);
}

/**
 * Combines every device into one quantized, world-space InputFrame (web mapDevicesToInput) through `bindings`
 * (default: today's layout). A rebound layout pressed with the equivalent inputs gives the same frame, bit for bit.
 */
export function mapDevicesToInput(
	snap: DeviceSnapshot,
	out: InputFrame = { ...EMPTY_INPUT },
	bindings: Bindings = DEFAULT_BINDINGS,
): InputFrame {
	// Move: keyboard + left stick + touch stick, summed and clamped to unit length, then rotated to world.
	const kb = keyboardMoveVector(snap.kbm.keys, bindings, snap.kbm.mouseButtons);
	const ls = snap.pad !== undefined ? gamepadMoveVector(snap.pad) : ZERO;
	const tm = snap.touch;
	const moveScreen = clampUnit(kb.x + ls.x + (tm?.moveX ?? 0), kb.y + ls.y + (tm?.moveY ?? 0));
	const move = screenToWorld(moveScreen.x, moveScreen.y);

	// Aim: a direction only, from whichever device was used last.
	let aim = ZERO;
	if (snap.aimDevice === "mouse") {
		aim = normalizeOrZero(finite(snap.pointerAimX), finite(snap.pointerAimZ));
	} else if (snap.aimDevice === "stick" && snap.pad !== undefined) {
		const rs = gamepadAimVector(snap.pad);
		const w = screenToWorld(rs.x, rs.y);
		aim = normalizeOrZero(w.x, w.z);
	} else if (snap.aimDevice === "touch" && tm !== undefined) {
		// Touch aim is already world space (TouchSnapshot): normalize it, as the mouse pointer is.
		aim = normalizeOrZero(finite(tm.aimX), finite(tm.aimZ));
	}

	let buttons = keyboardMouseButtons(snap.kbm, bindings);
	if (snap.pad !== undefined) buttons = bit32.bor(buttons, gamepadButtons(snap.pad, bindings));
	if (tm !== undefined) buttons = bit32.bor(buttons, tm.buttons);

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
	/** The layout whose pad buttons count as "using the pad". */
	bindings: Bindings = DEFAULT_BINDINGS;

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

	/** A touch on the controls: the last-used device is touch (UI hints only, never the sim). */
	touched(): void {
		this.device = "touch";
	}

	/** Touch aim (a centre stick or a manual drag) is the aim device until the mouse moves again. */
	touchAimed(): void {
		this.aimDevice = "touch";
	}

	/**
	 * A pad button was pressed, or a stick pushed past STICK_DEADZONE, outside a run's sample (the menus before the
	 * first run poll nothing: docs/GAMEPAD_MENUS.md GM2 needs the device to read gamepad there too). Any button counts,
	 * bound or not; the aim device is unchanged.
	 */
	padPressed(): void {
		this.device = "gamepad";
	}

	/** Called once per sample with the current pad (or undefined). */
	padSampled(pad: GamepadSnapshot | undefined): void {
		if (isStickAiming(pad)) this.aimDevice = "stick";
		if (isPadActive(pad, STICK_DEADZONE, this.bindings)) this.device = "gamepad";
	}
}

/**
 * The key-name table to read for a device: the keyboard or the gamepad hint tables. Touch has no key names of its own;
 * it reads the keyboard's, and the touch prompts hide those lines (MB10) rather than index a missing field.
 */
export function keyDevice(device: InputDeviceKind): "keyboard" | "gamepad" {
	return device === "gamepad" ? "gamepad" : "keyboard";
}

/** `buttons` without the debug bits unless `debugAllowed` (web maskDebugButtons). */
export function maskDebugButtons(buttons: number, debugAllowed: boolean): number {
	return debugAllowed ? buttons : bit32.band(buttons, bit32.bnot(ALL_DEBUG_BUTTONS));
}

export type DriverKeyAction = "replayCheck" | "reset" | undefined;

/** The run facts the restart input reads (SimController; no run counts as over). */
export interface RestartWindow {
	/** The run is over (dead / victory), or there is no run. */
	readonly over: boolean;
	/** A solo run is paused. */
	readonly paused: boolean;
	/** A developer mode run (docs/DEV_MODE.md): the restart key acts any time. */
	readonly devRun: boolean;
}

/** No run state known yet: the restart input acts nowhere but the menu's "ask again" (InputController's default). */
export const CLOSED_RESTART_WINDOW: RestartWindow = { over: false, paused: false, devRun: false };

/**
 * A pressed key / button name -> driver action (web driverKeyAction, port rule). The restart key (default R) restarts
 * only once the run is over, or any time in a dev run, so a stray press never ends a run being played or paused; the
 * pad's restart (default D-pad down) only while the run is over or paused; F8 / L only with debug keys on.
 */
export function driverKeyAction(
	name: string,
	debugKeys: boolean,
	restart: RestartWindow,
	bindings: Bindings = DEFAULT_BINDINGS,
): DriverKeyAction {
	const c = compiled(bindings);
	if (c.restartKbm.includes(name)) return restart.over || restart.devRun ? "reset" : undefined;
	if (name === c.restartPad && (restart.over || restart.paused)) return "reset";
	if (debugKeys && REPLAY_CHECK_KEYS.includes(name)) return "replayCheck";
	return undefined;
}

/**
 * True when `name` (an Enum.KeyCode / mouse Enum.UserInputType / gamepad Enum.KeyCode name) is bound to the `map`
 * action, the full map toggle (docs/MINIMAP.md M9): no sim input, any time (the client decides whether the map may
 * open). Key, mouse and pad names never collide, so one lookup covers every device.
 */
export function isMapInput(name: string, bindings: Bindings = DEFAULT_BINDINGS): boolean {
	const c = compiled(bindings);
	return name === c.mapPad || c.mapKbm.includes(name);
}

/**
 * Every Enum.KeyCode name the game reads (bindings, movement, restart, map, the fixed pause and debug keys): the
 * InputController polls / sinks these. Not the leaderboard key (its controller reads it unsunk) nor mouse buttons
 * (boundMouseButtonNames).
 */
export function boundKeyNames(bindings: Bindings = DEFAULT_BINDINGS): ReadonlyArray<string> {
	const out = new Array<string>();
	for (const action of KBM_ACTIONS) {
		if (action === "leaderboard") continue;
		for (const name of bindings.kbm[action]) if (!isMouseButtonName(name)) out.push(name);
	}
	out.push(
		FIXED_INPUTS.pause,
		FIXED_INPUTS.debugHit,
		FIXED_INPUTS.debugBoss,
		FIXED_INPUTS.debugFloor,
		FIXED_INPUTS.debugDrop,
	);
	for (const k of REPLAY_CHECK_KEYS) out.push(k);
	return out;
}

/** Every mouse button (Enum.UserInputType name) a game action is bound to (default: MouseButton1, MouseButton2). */
export function boundMouseButtonNames(bindings: Bindings = DEFAULT_BINDINGS): ReadonlyArray<string> {
	const out = new Array<string>();
	for (const action of KBM_ACTIONS) {
		if (action === "leaderboard") continue;
		for (const name of bindings.kbm[action]) if (isMouseButtonName(name)) out.push(name);
	}
	return out;
}

/** Every gamepad Enum.KeyCode name the game reads (bindings, the pad restart and the fixed Start pause). */
export function boundPadButtonNames(bindings: Bindings = DEFAULT_BINDINGS): ReadonlyArray<string> {
	const out = new Array<string>();
	for (const action of PAD_ACTIONS) out.push(bindings.pad[action]);
	out.push(FIXED_INPUTS.padPause);
	return out;
}
