/**
 * Key rebinding, the pure half (task L4b): which GAME ACTION each keyboard / mouse / gamepad input triggers, how a
 * rebind swaps inputs, the overrides-only storage form and its sanitizer, and display labels. Works on Enum.KeyCode /
 * Enum.UserInputType NAMES (strings), so it runs headlessly; inputMapping.ts maps a `Bindings` to sim button bits.
 *
 * Presentation only: the sim never sees bindings, only the InputFrame bits they produce, so recordings and replays do
 * not depend on them (a rebound layout pressed the same way gives the same bits; bindings.spec.ts checks it).
 *
 * Rules (both enforced by every operation here, and by the sanitizer on stored overrides):
 *   - nothing is bound twice on a device (one input -> at most one action, at most one slot);
 *   - every action keeps a primary input (keyboard / mouse: a primary and an optional secondary; pad: one button).
 * Not rebindable (FIXED_INPUTS, RESERVED_*_INPUTS in config.ts): pause (P / Start), the settings panel (O), the menus'
 * pad close (B, only while a panel is open), aim (mouse / right stick), pad movement (left stick), UI navigation and
 * the debug keys (K, J, N, F8, L). Roblox's own keys (Escape, Tab, Slash, F9, F11) are refused as well.
 */
import { Button } from "shared/sim";
import {
	FIXED_INPUTS,
	KBM_KEY_NAMES,
	KBM_MOUSE_NAMES,
	PAD_BUTTON_NAMES,
	RESERVED_KBM_INPUTS,
	RESERVED_PAD_INPUTS,
} from "./config";

// ---------------------------------------------------------------------------------------------
// Actions and the bindings shape

/** Every rebindable action. The move actions and the leaderboard exist on the keyboard only. */
export type GameAction =
	| "moveUp"
	| "moveDown"
	| "moveLeft"
	| "moveRight"
	| "fire"
	| "alt"
	| "roll"
	| "ember"
	| "flask"
	| "swap"
	| "skill1"
	| "skill2"
	| "skill3"
	| "skill4"
	| "restart"
	| "leaderboard";

/** Actions a gamepad binds (pad movement is the left stick, fixed; the leaderboard opens from the pause overlay). */
export type PadAction = Exclude<GameAction, "moveUp" | "moveDown" | "moveLeft" | "moveRight" | "leaderboard">;

export type BindingDevice = "kbm" | "pad";
/** 0 = primary, 1 = secondary (keyboard / mouse only). */
export type BindingSlot = 0 | 1;
/** A keyboard / mouse action's inputs: a primary and an optional secondary. */
export type KbmSlots = readonly [string] | readonly [string, string];

export interface Bindings {
	readonly kbm: { readonly [A in GameAction]: KbmSlots };
	readonly pad: { readonly [A in PadAction]: string };
}

/** Keyboard / mouse actions, in settings-panel order (also the fixed iteration order of every loop here). */
export const KBM_ACTIONS: ReadonlyArray<GameAction> = [
	"moveUp",
	"moveDown",
	"moveLeft",
	"moveRight",
	"fire",
	"alt",
	"roll",
	"ember",
	"flask",
	"swap",
	"skill1",
	"skill2",
	"skill3",
	"skill4",
	"restart",
	"leaderboard",
];

/** Gamepad actions, in settings-panel order. */
export const PAD_ACTIONS: ReadonlyArray<PadAction> = [
	"fire",
	"alt",
	"roll",
	"ember",
	"flask",
	"swap",
	"skill1",
	"skill2",
	"skill3",
	"skill4",
	"restart",
];

/** The sim button bit each action presses (move: the move vector; restart / leaderboard: not sim input). */
export const ACTION_BUTTONS: ReadonlyMap<GameAction, number> = new Map<GameAction, number>([
	["fire", Button.FIRE],
	["alt", Button.ALT],
	["roll", Button.ROLL],
	["ember", Button.EMBER],
	["flask", Button.FLASK],
	["swap", Button.SWAP],
	["skill1", Button.SKILL1], // also the curse shrine's accept
	["skill2", Button.SKILL2],
	["skill3", Button.SKILL3],
	["skill4", Button.SKILL4],
]);

/**
 * Today's layout (the web build's bindings with the Roblox remaps, docs/CLIENT.md "Controls"): WASD with the arrows as
 * secondaries, click / right click, Space roll, Q Ember, F flask, E swap (web: Tab), 1-4 skills, R restart,
 * B leaderboard; pad RT / LT fire / alt, LB roll, RB Ember, Y swap, D-pad up flask, A / B / X / D-pad right skills,
 * D-pad down restart.
 */
export const DEFAULT_BINDINGS: Bindings = {
	kbm: {
		moveUp: ["W", "Up"],
		moveDown: ["S", "Down"],
		moveLeft: ["A", "Left"],
		moveRight: ["D", "Right"],
		fire: ["MouseButton1"],
		alt: ["MouseButton2"],
		roll: ["Space"],
		ember: ["Q"],
		flask: ["F"],
		swap: ["E"], // web: Tab (Roblox: player list)
		skill1: ["One"],
		skill2: ["Two"],
		skill3: ["Three"],
		skill4: ["Four"],
		restart: ["R"],
		leaderboard: ["B"], // shared/view/hud LEADERBOARD_KEY
	},
	pad: {
		fire: "ButtonR2", // RT
		alt: "ButtonL2", // LT
		roll: "ButtonL1", // LB
		ember: "ButtonR1", // RB
		flask: "DPadUp",
		swap: "ButtonY",
		skill1: "ButtonA",
		skill2: "ButtonB",
		skill3: "ButtonX",
		skill4: "DPadRight",
		restart: "DPadDown", // only while the run is over or paused (inputMapping driverKeyAction)
	},
};

const KBM_ACTION_SET = new Set<string>(KBM_ACTIONS);
const PAD_ACTION_SET = new Set<string>(PAD_ACTIONS);
const KBM_KEY_SET = new Set<string>(KBM_KEY_NAMES);
const KBM_MOUSE_SET = new Set<string>(KBM_MOUSE_NAMES);
const PAD_BUTTON_SET = new Set<string>(PAD_BUTTON_NAMES);
const RESERVED_KBM_SET = new Set<string>(RESERVED_KBM_INPUTS);
const RESERVED_PAD_SET = new Set<string>(RESERVED_PAD_INPUTS);

/** True for the mouse button names a keyboard / mouse slot can hold (read from the snapshot's mouseButtons). */
export function isMouseButtonName(name: string): boolean {
	return KBM_MOUSE_SET.has(name);
}

/** True when `action` is bindable on `device`. */
export function isActionOn(device: BindingDevice, action: string): boolean {
	return device === "kbm" ? KBM_ACTION_SET.has(action) : PAD_ACTION_SET.has(action);
}

/** True for an input no binding may take on `device` (Roblox's keys, the game's fixed and debug keys). */
export function isReservedInput(device: BindingDevice, name: string): boolean {
	return device === "kbm" ? RESERVED_KBM_SET.has(name) : RESERVED_PAD_SET.has(name);
}

/** True for an input name `device` knows (the allow-lists in config.ts; reserved names may be known too). */
export function isKnownInput(device: BindingDevice, name: string): boolean {
	return device === "kbm" ? KBM_KEY_SET.has(name) || KBM_MOUSE_SET.has(name) : PAD_BUTTON_SET.has(name);
}

function secondaryOf(slots: KbmSlots): string | undefined {
	return slots.size() > 1 ? (slots as readonly [string, string])[1] : undefined;
}

function makeSlots(primary: string | undefined, secondary: string | undefined): KbmSlots | undefined {
	if (primary === undefined) return secondary === undefined ? undefined : [secondary];
	return secondary === undefined || secondary === primary ? [primary] : [primary, secondary];
}

function sameSlots(a: KbmSlots, b: KbmSlots): boolean {
	return a[0] === b[0] && secondaryOf(a) === secondaryOf(b);
}

/** The inputs bound to `action` on `device`: [primary, secondary?]; empty when the action is not on that device. */
export function inputsFor(b: Bindings, device: BindingDevice, action: GameAction): ReadonlyArray<string> {
	if (device === "kbm") return b.kbm[action];
	if (!PAD_ACTION_SET.has(action)) return [];
	return [b.pad[action as PadAction]];
}

/** The input in one slot (undefined: an empty secondary, or the action / slot does not exist on that device). */
export function slotInput(
	b: Bindings,
	device: BindingDevice,
	action: GameAction,
	slot: BindingSlot,
): string | undefined {
	const inputs = inputsFor(b, device, action);
	return slot < inputs.size() ? inputs[slot] : undefined;
}

export interface BindingRef {
	readonly action: GameAction;
	readonly slot: BindingSlot;
}

/** The action and slot `input` is bound to on `device`, if any. */
export function findBinding(b: Bindings, device: BindingDevice, input: string): BindingRef | undefined {
	const actions: ReadonlyArray<GameAction> = device === "kbm" ? KBM_ACTIONS : PAD_ACTIONS;
	for (const action of actions) {
		const inputs = inputsFor(b, device, action);
		for (let i = 0; i < inputs.size(); i++) {
			if (inputs[i] === input) return { action, slot: i === 0 ? 0 : 1 };
		}
	}
	return undefined;
}

function copyKbm(b: Bindings): Record<GameAction, KbmSlots> {
	const out = {} as Record<GameAction, KbmSlots>;
	for (const action of KBM_ACTIONS) out[action] = b.kbm[action];
	return out;
}

function copyPad(b: Bindings): Record<PadAction, string> {
	const out = {} as Record<PadAction, string>;
	for (const action of PAD_ACTIONS) out[action] = b.pad[action];
	return out;
}

// ---------------------------------------------------------------------------------------------
// Editing

/**
 * Why a rebind / clear was refused:
 *   reserved         the input is Roblox's or one of the game's fixed / debug keys
 *   unknown          not an input name this device has (the allow-lists in config.ts)
 *   notRebindable    the action does not exist on this device (pad movement, pad leaderboard)
 *   badSlot          no such slot (pad actions have one, keyboard / mouse actions two)
 *   primaryRequired  clearSlot on a primary (every action keeps one)
 *   onlyInput        the input is the only one of another action and this slot is empty, so taking it would leave
 *                    that action unbound (bind it into a filled slot to swap instead)
 */
export type BindingRefusal = "reserved" | "unknown" | "notRebindable" | "badSlot" | "primaryRequired" | "onlyInput";

export interface BindingSwap extends BindingRef {
	/** What that slot holds now: this slot's previous input (undefined: it was an empty secondary, so cleared). */
	readonly input: string | undefined;
}

export type RebindResult =
	| { readonly ok: true; readonly bindings: Bindings; readonly swappedWith?: BindingSwap }
	| { readonly ok: false; readonly reason: BindingRefusal };

function checkTarget(device: BindingDevice, action: string, slot: number): BindingRefusal | undefined {
	if (!isActionOn(device, action)) return "notRebindable";
	if (slot !== 0 && (device === "pad" || slot !== 1)) return "badSlot";
	return undefined;
}

/** Why `input` cannot be bound on `device` (undefined: it can). */
export function checkInput(device: BindingDevice, input: string): BindingRefusal | undefined {
	if (isReservedInput(device, input)) return "reserved";
	if (!isKnownInput(device, input)) return "unknown";
	return undefined;
}

/**
 * Binds `input` into `action`'s `slot` on `device`. If another action held it, that action's slot takes this slot's
 * old input (`swappedWith`); if this slot was an empty secondary, the other slot is cleared instead (its secondary is
 * promoted when that was its primary), and refused (`onlyInput`) when it was that action's only input. Moving an input
 * between the two slots of the same action swaps them. Never throws; `b` is not modified.
 */
export function rebind(
	b: Bindings,
	device: BindingDevice,
	action: GameAction,
	slot: BindingSlot,
	input: string,
): RebindResult {
	const refusal = checkTarget(device, action, slot) ?? checkInput(device, input);
	if (refusal !== undefined) return { ok: false, reason: refusal };
	const old = slotInput(b, device, action, slot);
	if (old === input) return { ok: true, bindings: b };
	const holder = findBinding(b, device, input);

	if (device === "pad") {
		const pad = copyPad(b);
		const padAction = action as PadAction;
		pad[padAction] = input;
		if (holder === undefined || old === undefined) return { ok: true, bindings: { kbm: b.kbm, pad } };
		pad[holder.action as PadAction] = old;
		return { ok: true, bindings: { kbm: b.kbm, pad }, swappedWith: { ...holder, input: old } };
	}

	const kbm = copyKbm(b);
	const mine = kbm[action];
	if (holder !== undefined && holder.action === action) {
		// The other slot of this action: exchange the two (an empty secondary just stays empty).
		kbm[action] = makeSlots(secondaryOf(mine), mine[0]) ?? mine;
		return { ok: true, bindings: { kbm, pad: b.pad } };
	}
	let swappedWith: BindingSwap | undefined;
	if (holder !== undefined) {
		const theirs = kbm[holder.action];
		const primary = holder.slot === 0 ? old : theirs[0];
		const secondary = holder.slot === 1 ? old : secondaryOf(theirs);
		const theirsNow = makeSlots(primary, secondary);
		if (theirsNow === undefined) return { ok: false, reason: "onlyInput" };
		kbm[holder.action] = theirsNow;
		swappedWith = { ...holder, input: old };
	}
	kbm[action] = (slot === 0 ? makeSlots(input, secondaryOf(mine)) : makeSlots(mine[0], input)) ?? mine;
	return { ok: true, bindings: { kbm, pad: b.pad }, swappedWith };
}

/** Empties a keyboard / mouse SECONDARY slot (primaries and pad buttons cannot be cleared: `primaryRequired`). */
export function clearSlot(b: Bindings, device: BindingDevice, action: GameAction, slot: BindingSlot): RebindResult {
	const refusal = checkTarget(device, action, slot);
	if (refusal !== undefined) return { ok: false, reason: refusal };
	if (device === "pad" || slot === 0) return { ok: false, reason: "primaryRequired" };
	const mine = b.kbm[action];
	if (secondaryOf(mine) === undefined) return { ok: true, bindings: b };
	const kbm = copyKbm(b);
	kbm[action] = [mine[0]];
	return { ok: true, bindings: { kbm, pad: b.pad } };
}

/** `b` with one device back to `defaults` (the settings panel's per-device "Reset"). */
export function resetDevice(b: Bindings, device: BindingDevice, defaults: Bindings = DEFAULT_BINDINGS): Bindings {
	return device === "kbm" ? { kbm: defaults.kbm, pad: b.pad } : { kbm: b.kbm, pad: defaults.pad };
}

/**
 * True when `b` follows the rules on both devices: every action has a primary, every input is known and not reserved,
 * no input is bound twice.
 */
export function isValidBindings(b: Bindings): boolean {
	for (const device of ["kbm", "pad"] as const) {
		const actions: ReadonlyArray<GameAction> = device === "kbm" ? KBM_ACTIONS : PAD_ACTIONS;
		const seen = new Set<string>();
		for (const action of actions) {
			const inputs = inputsFor(b, device, action);
			if (inputs.size() === 0) return false;
			for (const input of inputs) {
				if (checkInput(device, input) !== undefined || seen.has(input)) return false;
				seen.add(input);
			}
		}
	}
	return true;
}

// ---------------------------------------------------------------------------------------------
// Stored overrides (only the actions that differ from the defaults; a later settings doc version embeds them)

/** What a player changed: per device, the actions whose inputs differ from the defaults (their full slots). */
export interface ControlsOverrides {
	readonly kbm?: { readonly [A in GameAction]?: KbmSlots };
	readonly pad?: { readonly [A in PadAction]?: string };
}

function readKbmSlots(raw: unknown): KbmSlots | undefined {
	if (!typeIs(raw, "table")) return undefined;
	const arr = raw as Array<unknown>;
	const primary = arr[0];
	const secondary = arr[1];
	if (arr[2] !== undefined || !typeIs(primary, "string")) return undefined;
	if (checkInput("kbm", primary) !== undefined) return undefined;
	if (secondary === undefined) return [primary];
	if (!typeIs(secondary, "string") || secondary === primary) return undefined;
	if (checkInput("kbm", secondary) !== undefined) return undefined;
	return [primary, secondary];
}

/**
 * Drops candidate overrides until no input is bound twice: each round, every overridden action involved in a
 * duplicate falls back to its default (the defaults alone are duplicate-free, so this ends). The set of drops per round
 * does not depend on iteration order.
 */
function dropDuplicates<A extends GameAction>(
	actions: ReadonlyArray<A>,
	candidates: Map<A, ReadonlyArray<string>>,
	defaultsOf: (action: A) => ReadonlyArray<string>,
): void {
	let changed = true;
	while (changed) {
		changed = false;
		const owners = new Map<string, Array<A>>();
		for (const action of actions) {
			for (const input of candidates.get(action) ?? defaultsOf(action)) {
				const list = owners.get(input);
				if (list === undefined) owners.set(input, [action]);
				else list.push(action);
			}
		}
		for (const [, list] of owners) {
			if (list.size() < 2) continue;
			for (const action of list) {
				if (candidates.delete(action)) changed = true;
			}
		}
	}
}

/**
 * Overrides from an untrusted value (a stored doc, a remote's argument). Keeps only known actions with known,
 * non-reserved input names, drops overrides equal to the defaults, and drops any override that would bind an input
 * twice (those actions fall back to `defaults`), so applying the result always gives valid bindings. Never throws.
 */
export function sanitizeControlsOverrides(raw: unknown, defaults: Bindings = DEFAULT_BINDINGS): ControlsOverrides {
	if (!typeIs(raw, "table")) return {};
	const doc = raw as { kbm?: unknown; pad?: unknown };

	const kbmCandidates = new Map<GameAction, KbmSlots>();
	if (typeIs(doc.kbm, "table")) {
		const rawKbm = doc.kbm as Record<string, unknown>;
		for (const action of KBM_ACTIONS) {
			const slots = readKbmSlots(rawKbm[action]);
			if (slots !== undefined && !sameSlots(slots, defaults.kbm[action])) kbmCandidates.set(action, slots);
		}
	}
	const padCandidates = new Map<PadAction, string>();
	if (typeIs(doc.pad, "table")) {
		const rawPad = doc.pad as Record<string, unknown>;
		for (const action of PAD_ACTIONS) {
			const input = rawPad[action];
			if (!typeIs(input, "string") || checkInput("pad", input) !== undefined) continue;
			if (input !== defaults.pad[action]) padCandidates.set(action, input);
		}
	}

	const kbmLists = new Map<GameAction, ReadonlyArray<string>>();
	for (const [action, slots] of kbmCandidates) kbmLists.set(action, slots);
	dropDuplicates(KBM_ACTIONS, kbmLists, (action) => defaults.kbm[action]);
	const padLists = new Map<PadAction, ReadonlyArray<string>>();
	for (const [action, input] of padCandidates) padLists.set(action, [input]);
	dropDuplicates(PAD_ACTIONS, padLists, (action) => [defaults.pad[action]]);

	const kbm: { [A in GameAction]?: KbmSlots } = {};
	let anyKbm = false;
	for (const action of KBM_ACTIONS) {
		const slots = kbmCandidates.get(action);
		if (slots === undefined || !kbmLists.has(action)) continue;
		kbm[action] = slots;
		anyKbm = true;
	}
	const pad: { [A in PadAction]?: string } = {};
	let anyPad = false;
	for (const action of PAD_ACTIONS) {
		const input = padCandidates.get(action);
		if (input === undefined || !padLists.has(action)) continue;
		pad[action] = input;
		anyPad = true;
	}
	if (anyKbm && anyPad) return { kbm, pad };
	if (anyKbm) return { kbm };
	if (anyPad) return { pad };
	return {};
}

/** The bindings a player uses: `defaults` with the (sanitized) overrides on top. Always valid; never throws. */
export function applyControlsOverrides(defaults: Bindings, overrides: unknown): Bindings {
	const clean = sanitizeControlsOverrides(overrides, defaults);
	const kbm = {} as Record<GameAction, KbmSlots>;
	for (const action of KBM_ACTIONS) kbm[action] = clean.kbm?.[action] ?? defaults.kbm[action];
	const pad = {} as Record<PadAction, string>;
	for (const action of PAD_ACTIONS) pad[action] = clean.pad?.[action] ?? defaults.pad[action];
	return { kbm, pad };
}

/** The overrides to store for `b`: the actions whose inputs differ from `defaults`. */
export function diffControlsOverrides(b: Bindings, defaults: Bindings = DEFAULT_BINDINGS): ControlsOverrides {
	return sanitizeControlsOverrides({ kbm: b.kbm, pad: b.pad }, defaults);
}

// ---------------------------------------------------------------------------------------------
// Labels and hints (HUD text; the `{key}` placeholders of shared/view/hud strings)

/** Display text for input names that do not read as themselves (letters and F-keys do). */
export const INPUT_LABELS: ReadonlyMap<string, string> = new Map<string, string>([
	["MouseButton1", "Click"],
	["MouseButton2", "Right click"],
	["MouseButton3", "Middle click"],
	["Zero", "0"],
	["One", "1"],
	["Two", "2"],
	["Three", "3"],
	["Four", "4"],
	["Five", "5"],
	["Six", "6"],
	["Seven", "7"],
	["Eight", "8"],
	["Nine", "9"],
	["Return", "Enter"],
	["CapsLock", "Caps Lock"],
	["LeftShift", "Left Shift"],
	["RightShift", "Right Shift"],
	["LeftControl", "Left Ctrl"],
	["RightControl", "Right Ctrl"],
	["LeftAlt", "Left Alt"],
	["RightAlt", "Right Alt"],
	["Up", "Up arrow"],
	["Down", "Down arrow"],
	["Left", "Left arrow"],
	["Right", "Right arrow"],
	["PageUp", "Page Up"],
	["PageDown", "Page Down"],
	["Escape", "Esc"],
	["Minus", "-"],
	["Equals", "="],
	["LeftBracket", "["],
	["RightBracket", "]"],
	["BackSlash", "\\"],
	["Semicolon", ";"],
	["Quote", "'"],
	["Comma", ","],
	["Period", "."],
	["Slash", "/"],
	["Backquote", "`"],
	["KeypadZero", "Num 0"],
	["KeypadOne", "Num 1"],
	["KeypadTwo", "Num 2"],
	["KeypadThree", "Num 3"],
	["KeypadFour", "Num 4"],
	["KeypadFive", "Num 5"],
	["KeypadSix", "Num 6"],
	["KeypadSeven", "Num 7"],
	["KeypadEight", "Num 8"],
	["KeypadNine", "Num 9"],
	["KeypadPeriod", "Num ."],
	["KeypadDivide", "Num /"],
	["KeypadMultiply", "Num *"],
	["KeypadMinus", "Num -"],
	["KeypadPlus", "Num +"],
	["KeypadEnter", "Num Enter"],
	["ButtonA", "A"],
	["ButtonB", "B"],
	["ButtonX", "X"],
	["ButtonY", "Y"],
	["ButtonL1", "LB"],
	["ButtonR1", "RB"],
	["ButtonL2", "LT"],
	["ButtonR2", "RT"],
	["ButtonL3", "LS"],
	["ButtonR3", "RS"],
	["DPadUp", "D-pad up"],
	["DPadDown", "D-pad down"],
	["DPadLeft", "D-pad left"],
	["DPadRight", "D-pad right"],
	["ButtonStart", "Start"],
	["ButtonSelect", "Select"],
	["Thumbstick1", "Left stick"],
	["Thumbstick2", "Right stick"],
]);

/** The pad's (fixed) left-stick directions, as the boon draft hint names them. */
export const STICK_DIRECTION_LABELS = { left: "Stick left", right: "Stick right" } as const;

/** Display text for one input name ("MouseButton1" -> "Click", "One" -> "1", "ButtonR2" -> "RT", "Q" -> "Q"). */
export function inputLabel(name: string): string {
	return INPUT_LABELS.get(name) ?? name;
}

/** The label of `action`'s primary input on `device` ("" when the action is not on that device). */
export function actionLabel(b: Bindings, device: BindingDevice, action: GameAction): string {
	const inputs = inputsFor(b, device, action);
	return inputs.size() > 0 ? inputLabel(inputs[0]) : "";
}

/** A key name per last-used device (shared/play InputDeviceKind), as the HUD hints index them. */
export interface DeviceHint {
	readonly keyboard: string;
	readonly gamepad: string;
}

function actionHint(b: Bindings, action: PadAction): DeviceHint {
	return { keyboard: actionLabel(b, "kbm", action), gamepad: actionLabel(b, "pad", action) };
}

/** The weapon-swap hint (defaults: E / Y). */
export function swapHint(b: Bindings = DEFAULT_BINDINGS): DeviceHint {
	return actionHint(b, "swap");
}

/** The restart hint (defaults: R / D-pad down). */
export function restartHint(b: Bindings = DEFAULT_BINDINGS): DeviceHint {
	return actionHint(b, "restart");
}

/** The curse shrine's accept hint: skill 1 (defaults: 1 / A; the HUD's ToastPanel). */
export function shrineHint(b: Bindings = DEFAULT_BINDINGS): DeviceHint {
	return actionHint(b, "skill1");
}

/** The leaderboard panel's close hint (defaults: B / B; the pad's is the fixed menu close button). */
export function leaderboardHint(b: Bindings = DEFAULT_BINDINGS): DeviceHint {
	return { keyboard: actionLabel(b, "kbm", "leaderboard"), gamepad: inputLabel(FIXED_INPUTS.padMenuClose) };
}

export interface DraftHintKeys {
	readonly left: string;
	readonly right: string;
	readonly confirm: string;
}

/** The boon draft's hint (defaults: A / D / Click; Stick left / Stick right / RT; the HUD's DraftOverlay). */
export function draftHint(b: Bindings = DEFAULT_BINDINGS): {
	readonly keyboard: DraftHintKeys;
	readonly gamepad: DraftHintKeys;
} {
	return {
		keyboard: {
			left: actionLabel(b, "kbm", "moveLeft"),
			right: actionLabel(b, "kbm", "moveRight"),
			confirm: actionLabel(b, "kbm", "fire"),
		},
		gamepad: {
			left: STICK_DIRECTION_LABELS.left,
			right: STICK_DIRECTION_LABELS.right,
			confirm: actionLabel(b, "pad", "fire"),
		},
	};
}

/** The spectate bar's switch keys (docs/SPECTATE.md): Attack is next, Alt previous (spectateCommand). */
export interface SpectateHintKeys {
	readonly next: string;
	readonly previous: string;
}

/** Co-op spectating's switch hint (defaults: Click / Right click, RT / LT; the HUD's SpectateBar). */
export function spectateHint(b: Bindings = DEFAULT_BINDINGS): {
	readonly keyboard: SpectateHintKeys;
	readonly gamepad: SpectateHintKeys;
} {
	return {
		keyboard: { next: actionLabel(b, "kbm", "fire"), previous: actionLabel(b, "kbm", "alt") },
		gamepad: { next: actionLabel(b, "pad", "fire"), previous: actionLabel(b, "pad", "alt") },
	};
}
