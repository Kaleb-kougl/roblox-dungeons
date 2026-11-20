/**
 * The simulation's only view of player input (source: `src/sim/input.ts`).
 *
 * Axes are integers in [-AXIS_MAX, AXIS_MAX] and already in WORLD space (rotated from screen space by the camera yaw
 * in the client's input mapping). Quantizing to integers is what makes replays exact: the sim never sees a raw float
 * from a device, so a recording of InputFrames reproduces the run bit for bit.
 *
 * @module
 */

import { jsRound, u32 } from "shared/jsmath";
import { isIntegerNumber } from "./jsnum";
import { DEBUG_FLOOR_BUTTON } from "./endlessData";
import { DEBUG_DROP_BUTTON } from "./drops/dropsData";
import { DEV_GOD_BUTTON } from "./dev/devData";

export const AXIS_MAX = 1000;

/** Button bits of InputFrame.buttons. */
export const Button = {
	FIRE: 1,
	ALT: 2,
	ROLL: 4,
	EMBER: 8,
	SKILL1: 16,
	SKILL2: 32,
	SKILL3: 64,
	SKILL4: 128,
	FLASK: 256,
	SWAP: 512,
	PAUSE: 1024,
	/** Debug: deals one normal hit through damagePlayer() (K). An input bit so replays reproduce it. */
	DEBUG_HIT: 2048,
	/**
	 * Debug (E1.8 boss): J. Takes 10% of max hp off every engaged boss (bypassing its damage cap, never skipping a
	 * phase transition). An input bit so replays reproduce it; stripped outside debug builds like DEBUG_HIT.
	 */
	DEBUG_BOSS: 4096,
} as const;

export type ButtonName = keyof typeof Button;
export type ButtonBit = (typeof Button)[ButtonName];

/** Every button, in bit order (Object.values order in the source). */
export const BUTTON_NAMES: ReadonlyArray<ButtonName> = [
	"FIRE",
	"ALT",
	"ROLL",
	"EMBER",
	"SKILL1",
	"SKILL2",
	"SKILL3",
	"SKILL4",
	"FLASK",
	"SWAP",
	"PAUSE",
	"DEBUG_HIT",
	"DEBUG_BOSS",
];

function allButtons(): number {
	let m = 0;
	for (const name of BUTTON_NAMES) m = bit32.bor(m, Button[name]);
	return m;
}

/** Mask of every defined button bit (8191). */
export const ALL_BUTTONS = allButtons();

/**
 * Roblox-port button bits beyond the web build's table (which fixtures/input.json pins: ALL_BUTTONS, isValidInput,
 * quantizeButtons and the JSON recordings keep rejecting / stripping them): the endless debug floor skip (8192) and
 * the debug boost drop (32768, docs/BOOSTS.md; only a run with SimConfig.drops reads it) and developer mode's god-mode
 * toggle (65536, docs/DEV_MODE.md; only a run with SimConfig.dev reads it). 16384 is the leave / forfeit bit
 * (partyData.ts), deliberately outside SIM_BUTTONS.
 */
export const PORT_BUTTONS = bit32.bor(DEBUG_FLOOR_BUTTON, DEBUG_DROP_BUTTON, DEV_GOD_BUTTON);

/** Every bit the sim reads: ALL_BUTTONS plus PORT_BUTTONS (114687). The binary recording codec accepts these. */
export const SIM_BUTTONS = bit32.bor(ALL_BUTTONS, PORT_BUTTONS);

export interface InputFrame {
	/** World-space move vector, integers in [-1000, 1000]. Length may exceed 1000 slightly; the sim clamps. */
	moveX: number;
	moveZ: number;
	/** World-space aim direction, integers in [-1000, 1000]. (0, 0) means "no aim": facing follows movement. */
	aimX: number;
	aimZ: number;
	/** Bitmask of Button values. */
	buttons: number;
}

export const EMPTY_INPUT: Readonly<InputFrame> = table.freeze({
	moveX: 0,
	moveZ: 0,
	aimX: 0,
	aimZ: 0,
	buttons: 0,
});

/** Float in [-1, 1] -> integer in [-1000, 1000]. NaN becomes 0, -0 becomes 0; halves round toward +Infinity (JS). */
export function quantizeAxis(v: number): number {
	if (v !== v) return 0; // NaN
	const q = jsRound(v * AXIS_MAX);
	if (q > AXIS_MAX) return AXIS_MAX;
	if (q < -AXIS_MAX) return -AXIS_MAX;
	return q === 0 ? 0 : q; // normalize -0
}

/** Integer axis -> float in [-1, 1]. */
export function dequantizeAxis(q: number): number {
	return q / AXIS_MAX;
}

/** Keeps only defined button bits, as an unsigned integer (`(buttons & ALL_BUTTONS) >>> 0`, ToInt32 first). */
export function quantizeButtons(buttons: number): number {
	return bit32.band(u32(buttons), ALL_BUTTONS);
}

/** Builds a quantized frame from float axes in [-1, 1]. */
export function quantizeInput(
	moveX: number,
	moveZ: number,
	aimX: number,
	aimZ: number,
	buttons: number,
	out: InputFrame = { ...EMPTY_INPUT },
): InputFrame {
	out.moveX = quantizeAxis(moveX);
	out.moveZ = quantizeAxis(moveZ);
	out.aimX = quantizeAxis(aimX);
	out.aimZ = quantizeAxis(aimZ);
	out.buttons = quantizeButtons(buttons);
	return out;
}

export interface DequantizedInput {
	moveX: number;
	moveZ: number;
	aimX: number;
	aimZ: number;
	buttons: number;
}

export function dequantizeInput(frame: Readonly<InputFrame>): DequantizedInput {
	return {
		moveX: dequantizeAxis(frame.moveX),
		moveZ: dequantizeAxis(frame.moveZ),
		aimX: dequantizeAxis(frame.aimX),
		aimZ: dequantizeAxis(frame.aimZ),
		buttons: frame.buttons,
	};
}

export function copyInput(src: Readonly<InputFrame>, out: InputFrame = { ...EMPTY_INPUT }): InputFrame {
	out.moveX = src.moveX;
	out.moveZ = src.moveZ;
	out.aimX = src.aimX;
	out.aimZ = src.aimZ;
	out.buttons = src.buttons;
	return out;
}

export function inputsEqual(a: Readonly<InputFrame>, b: Readonly<InputFrame>): boolean {
	return (
		a.moveX === b.moveX && a.moveZ === b.moveZ && a.aimX === b.aimX && a.aimZ === b.aimZ && a.buttons === b.buttons
	);
}

export function isDown(frame: Readonly<InputFrame>, button: ButtonBit): boolean {
	return bit32.band(frame.buttons, button) !== 0;
}

/** True on the tick the button goes from up to down. */
export function wasPressed(prev: Readonly<InputFrame>, cur: Readonly<InputFrame>, button: ButtonBit): boolean {
	return bit32.band(cur.buttons, button) !== 0 && bit32.band(prev.buttons, button) === 0;
}

function axisOk(v: unknown): boolean {
	return isIntegerNumber(v) && v >= -AXIS_MAX && v <= AXIS_MAX;
}

/** True if the frame is well-formed (integers in range, known button bits only). Fields may be any value. */
export function isValidInput(frame: Readonly<InputFrame>): boolean {
	return isValidInputFor(frame, ALL_BUTTONS);
}

/** isValidInput that also accepts the port's own bits (PORT_BUTTONS): the binary recording codec's check. */
export function isValidSimInput(frame: Readonly<InputFrame>): boolean {
	return isValidInputFor(frame, SIM_BUTTONS);
}

function isValidInputFor(frame: Readonly<InputFrame>, mask: number): boolean {
	const buttons: unknown = frame.buttons;
	return (
		axisOk(frame.moveX) &&
		axisOk(frame.moveZ) &&
		axisOk(frame.aimX) &&
		axisOk(frame.aimZ) &&
		isIntegerNumber(buttons) &&
		buttons >= 0 &&
		bit32.band(u32(buttons), bit32.bnot(mask)) === 0
	);
}
