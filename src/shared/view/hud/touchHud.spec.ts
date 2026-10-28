// The touch controls' strings (docs/MOBILE.md MB7): every TOUCH_STRINGS key and every button's label key exists in the
// placeholder pack, with no warnings.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { TOUCH_STRINGS, touchButtonLabelKey, type TouchButtonId } from "shared/view/hud";

const BUTTON_IDS: ReadonlyArray<TouchButtonId> = [
	"attack",
	"alt",
	"roll",
	"ember",
	"flask",
	"swap",
	"shrine",
	"spectateNext",
	"spectatePrev",
];

describe("touch strings", () => {
	it("every TOUCH_STRINGS key and every button label key exists in the placeholder pack (no warnings)", () => {
		const warnings: string[] = [];
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: (m) => warnings.push(m) });
		const keys: string[] = [];
		for (const [, key] of pairs(TOUCH_STRINGS as unknown as Map<string, string>)) keys.push(key);
		for (const id of BUTTON_IDS) keys.push(touchButtonLabelKey(id));
		for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
		expect(warnings).toEqual([]);
	});

	it("a button's label key is touch.<id>", () => {
		expect(touchButtonLabelKey("attack")).toBe("touch.attack");
		expect(touchButtonLabelKey("spectatePrev")).toBe("touch.spectatePrev");
	});
});
