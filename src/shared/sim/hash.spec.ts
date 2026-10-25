import { describe, expect, it } from "@rbxts/jest-globals";
import hashFixture from "shared/fixtures-generated/hash";
import { createSimState, float64FromHex, float64Hex, hashNumbers, hashState, writeHashFields } from "shared/sim";

describe("hashNumbers parity (fixtures/hash.json)", () => {
	it("matches every vector (values decoded from their exact bits, NaN and -0 included)", () => {
		for (const vector of hashFixture.vectors) {
			const values = vector.hex.map((h) => float64FromHex(h));
			expect(values.size()).toBe(vector.values.size());
			for (let i = 0; i < values.size(); i++) expect(float64Hex(values[i])).toBe(vector.hex[i]);
			expect(`${vector.name}: ${hashNumbers(values)}`).toBe(`${vector.name}: ${vector.hash}`);
		}
	});

	it("matches the numeric literals too (the generated fixture keeps them bit-exact)", () => {
		for (const vector of hashFixture.vectors) {
			const literal = vector.values.every((v) => typeIs(v, "number"));
			if (!literal) continue;
			expect(hashNumbers(vector.values as ReadonlyArray<number>)).toBe(vector.hash);
		}
	});

	it("freshState: writeHashFields(createSimState(1337, 0, 0)) field by field, and its hash", () => {
		const state = createSimState(1337, 0, 0);
		const values = writeHashFields(state, []);
		const fresh = hashFixture.freshState;
		expect(values.size()).toBe(fresh.hex.size());
		for (let i = 0; i < values.size(); i++) {
			expect(`#${i} ${float64Hex(values[i])}`).toBe(`#${i} ${fresh.hex[i]}`);
		}
		expect(hashNumbers(values)).toBe(fresh.hash);
		expect(hashState(state)).toBe(fresh.hashState);
	});
});

describe("float64 hex helpers", () => {
	it("round-trip -0, NaN payloads and subnormals", () => {
		for (const hex of [
			"8000000000000000", // check-asset-ids: allow (float64 bits)
			"7ff8000000000000",
			"fff8000000000000",
			"0000000000000001", // check-asset-ids: allow (float64 bits)
			"3ff0000000000000",
		]) {
			expect(float64Hex(float64FromHex(hex))).toBe(hex);
		}
		expect(float64Hex(-0)).toBe("8000000000000000"); // check-asset-ids: allow (float64 bits)
		expect(float64Hex(1)).toBe("3ff0000000000000");
	});
});
