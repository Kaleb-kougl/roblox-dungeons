import { describe, expect, it } from "@rbxts/jest-globals";
import inputFixture from "shared/fixtures-generated/input";
import {
	ALL_BUTTONS,
	AXIS_MAX,
	Button,
	BUTTON_NAMES,
	EMPTY_INPUT,
	dequantizeAxis,
	deserializeRecording,
	fixtureNumber,
	float64FromHex,
	float64Hex,
	isValidInput,
	quantizeAxis,
	quantizeButtons,
	quantizeInput,
	serializeRecording,
	wasPressed,
	type InputFrame,
	type Recording,
} from "shared/sim";

function frameOf(values: ReadonlyArray<number | string>): InputFrame {
	return {
		moveX: fixtureNumber(values[0]),
		moveZ: fixtureNumber(values[1]),
		aimX: fixtureNumber(values[2]),
		aimZ: fixtureNumber(values[3]),
		buttons: fixtureNumber(values[4]),
	};
}

describe("input parity (fixtures/input.json)", () => {
	it("has the same constants", () => {
		expect(AXIS_MAX).toBe(inputFixture.AXIS_MAX);
		expect(ALL_BUTTONS).toBe(inputFixture.ALL_BUTTONS);
		for (const name of BUTTON_NAMES) expect(Button[name]).toBe(inputFixture.Button[name]);
	});

	it("quantizeAxis: every case incl. exact halves (JS rounds toward +Infinity), NaN, +/-Infinity and -0", () => {
		for (const c of inputFixture.quantizeAxis) {
			const v = float64FromHex(c.vHex);
			expect(float64Hex(v * AXIS_MAX)).toBe(c.productHex);
			const q = quantizeAxis(v);
			expect(`${c.vHex} -> ${float64Hex(q)}`).toBe(`${c.vHex} -> ${c.qHex}`); // bits: never -0
			expect(q).toBe(c.q);
		}
	});

	it("dequantizeAxis: the exact double for every q in -1000..1000", () => {
		const hexTable = inputFixture.dequantizeAxis.hex;
		expect(hexTable.size()).toBe(2 * AXIS_MAX + 1);
		for (let q = -AXIS_MAX; q <= AXIS_MAX; q++) expect(float64Hex(dequantizeAxis(q))).toBe(hexTable[q + AXIS_MAX]);
	});

	it("quantizeButtons: ToInt32 then mask (fractions, -1, 2^32 + 5, -0)", () => {
		for (const c of inputFixture.quantizeButtons) {
			const out = quantizeButtons(fixtureNumber(c.in));
			expect(float64Hex(out)).toBe(float64Hex(c.out));
		}
	});

	it("quantizeInput", () => {
		for (const c of inputFixture.quantizeInput) {
			const v = c.in.map((x) => fixtureNumber(x));
			const f = quantizeInput(v[0], v[1], v[2], v[3], v[4]);
			expect([f.moveX, f.moveZ, f.aimX, f.aimZ, f.buttons]).toEqual(c.out);
		}
	});

	it("isValidInput", () => {
		for (const c of inputFixture.isValidInput)
			expect(`${c.name}: ${isValidInput(frameOf(c.frame))}`).toBe(`${c.name}: ${c.valid}`);
	});

	it("serializeRecording matches byte for byte, and deserialize -> serialize round-trips", () => {
		for (const c of inputFixture.serializeRecording) {
			const recording: Recording = {
				seed: c.seed,
				spawn: { x: c.spawn[0], z: c.spawn[1] },
				frames: c.frames.map((f) => frameOf(f)),
			};
			expect(serializeRecording(recording)).toBe(c.serialized);
			const back = deserializeRecording(c.serialized);
			expect(back.seed).toBe(c.seed);
			expect(float64Hex(back.spawn.x)).toBe(float64Hex(c.spawn[0]));
			expect(float64Hex(back.spawn.z)).toBe(float64Hex(c.spawn[1]));
			expect(back.frames).toEqual(recording.frames);
			expect(serializeRecording(back)).toBe(c.reserialized);
		}
	});

	it("deserializeRecording throws the web build's exact messages", () => {
		for (const c of inputFixture.deserializeErrors) {
			const [ok, err] = pcall(() => deserializeRecording(c.text));
			expect(ok).toBe(false);
			expect(err).toBe(c.error);
		}
	});
});

// Ported from src/sim/input.test.ts.
describe("input quantization", () => {
	it("round-trips every integer axis value exactly", () => {
		for (let q = -AXIS_MAX; q <= AXIS_MAX; q++) expect(quantizeAxis(dequantizeAxis(q))).toBe(q);
	});

	it("float -> int -> float stays within half a step", () => {
		for (let i = 0; i <= 2000; i++) {
			const v = -1 + i * 0.000999;
			expect(math.abs(dequantizeAxis(quantizeAxis(v)) - v)).toBeLessThanOrEqual(0.5 / AXIS_MAX + 1e-12);
		}
	});

	it("clamps, removes NaN and -0", () => {
		expect(quantizeAxis(2)).toBe(AXIS_MAX);
		expect(quantizeAxis(-7)).toBe(-AXIS_MAX);
		expect(quantizeAxis(0 / 0)).toBe(0);
		expect(float64Hex(quantizeAxis(-0.0001))).toBe(float64Hex(0));
	});

	it("keeps only defined button bits", () => {
		const f = quantizeInput(0, 0, 0, 0, Button.FIRE + Button.PAUSE + 2 ** 20);
		expect(f.buttons).toBe(Button.FIRE + Button.PAUSE);
		expect(isValidInput(f)).toBe(true);
		expect(ALL_BUTTONS).toBe(2 ** 13 - 1);
		expect(Button.DEBUG_HIT).toBe(2 ** 11);
	});

	it("validates frames", () => {
		expect(isValidInput(EMPTY_INPUT)).toBe(true);
		expect(isValidInput({ ...EMPTY_INPUT, moveX: 0.5 })).toBe(false);
		expect(isValidInput({ ...EMPTY_INPUT, aimZ: 1001 })).toBe(false);
		expect(isValidInput({ ...EMPTY_INPUT, buttons: 2 ** 15 })).toBe(false);
	});

	it("detects press edges", () => {
		const up = { ...EMPTY_INPUT };
		const down = { ...EMPTY_INPUT, buttons: Button.ROLL };
		expect(wasPressed(up, down, Button.ROLL)).toBe(true);
		expect(wasPressed(down, down, Button.ROLL)).toBe(false);
	});
});
