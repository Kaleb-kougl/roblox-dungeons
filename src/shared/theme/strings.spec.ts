// Ported from the web build's src/theme/strings.test.ts @ 42897e2.
import { describe, expect, it } from "@rbxts/jest-globals";
import { interpolate, placeholders, templateProblem } from "./strings";

describe("string interpolation", () => {
	it("fills {name} placeholders", () => {
		expect(interpolate("Lv {level}", { level: 7 })).toBe("Lv 7");
		expect(interpolate("{a} and {b} and {a}", { a: "x", b: "y" })).toBe("x and y and x");
		expect(interpolate("You died — press {key} to retry", { key: "R" })).toBe("You died — press R to retry");
	});

	it("leaves placeholders without a var visible", () => {
		expect(interpolate("{amount} gold", {})).toBe("{amount} gold");
		expect(interpolate("{amount} gold")).toBe("{amount} gold");
	});

	it("does not touch braces that are not placeholders", () => {
		expect(interpolate("{not a var} {x}", { x: 1 })).toBe("{not a var} 1");
	});

	it("does not read inherited properties", () => {
		expect(interpolate("{toString}", {})).toBe("{toString}");
	});

	it("does not treat replacement text as a pattern", () => {
		expect(interpolate("{p}", { p: "100%" })).toBe("100%");
		expect(interpolate("{p}", { p: "%1 {p}" })).toBe("%1 {p}");
	});

	it("lists placeholders and spots malformed ones", () => {
		expect(placeholders("Ember {count} / {max}")).toEqual(["count", "max"]);
		expect(templateProblem("Lv {level}")).toBeUndefined();
		expect(templateProblem("Lv {level")).toBeDefined();
		expect(templateProblem("Lv {lev el}")).toBeDefined();
	});
});
