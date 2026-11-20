import { describe, expect, it } from "@rbxts/jest-globals";

import { runOf } from "./runOf";

describe("runOf (docs/CODEBASE_SCALE.md DX4)", () => {
	const list = ["a", "b", "c", "d", "e"];

	it("is the ids themselves when they sit together and in order, anywhere in the list", () => {
		expect(runOf(list, ["a", "b"])).toEqual(["a", "b"]);
		expect(runOf(list, ["c", "d"])).toEqual(["c", "d"]);
		expect(runOf(list, ["d", "e"])).toEqual(["d", "e"]);
		expect(runOf(list, ["c"])).toEqual(["c"]);
	});

	it("differs from the ids when they are split, reordered, cut off by the list's end or missing", () => {
		expect(runOf(list, ["b", "d"])).toEqual(["b", "c"]);
		expect(runOf(list, ["d", "c"])).toEqual(["d", "e"]);
		expect(runOf(list, ["e", "f"])).toEqual(["e"]);
		expect(runOf(list, ["x", "a"])).toEqual([]);
		expect(runOf(list, [])).toEqual([]);
	});

	it("still holds after a later entry is appended, or one is put in front", () => {
		expect(runOf([...list, "z"], ["d", "e"])).toEqual(["d", "e"]);
		expect(runOf(["z", ...list], ["a", "b"])).toEqual(["a", "b"]);
	});
});
