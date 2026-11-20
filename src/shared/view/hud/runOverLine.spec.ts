// The solo run-over panel's main line (runOverLine.ts), with its "You left the run" text in the placeholder pack.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PLACEHOLDER_MANIFEST, REQUIRED_STRING_KEYS, ThemePack } from "shared/theme";
import { HUD_STRINGS, soloRunOverLineKey } from ".";

function quietPack(warnings: string[]): ThemePack {
	return new ThemePack(PLACEHOLDER_MANIFEST, { warn: (m) => warnings.push(m) });
}

describe("solo run-over line", () => {
	it("a left run says so; a death and a victory keep their lines", () => {
		expect(soloRunOverLineKey(false, true)).toBe(HUD_STRINGS.left);
		expect(soloRunOverLineKey(false, false)).toBe(HUD_STRINGS.dead);
		expect(soloRunOverLineKey(true, false)).toBe(HUD_STRINGS.victory);
		expect(soloRunOverLineKey(true, true)).toBe(HUD_STRINGS.victory);
	});

	it("the left line is a required string with the restart key in it", () => {
		expect(REQUIRED_STRING_KEYS.includes(HUD_STRINGS.left)).toBe(true);
		const warnings: string[] = [];
		const pack = quietPack(warnings);
		expect(pack.hasString(HUD_STRINGS.left)).toBe(true);
		expect(pack.str(HUD_STRINGS.left, { key: "R" })).toBe("You left the run — press R to play again");
		expect(pack.str(HUD_STRINGS.left, { key: "R" }) === pack.str(HUD_STRINGS.dead, { key: "R" })).toBe(false);
		expect(warnings).toEqual([]);
	});
});
