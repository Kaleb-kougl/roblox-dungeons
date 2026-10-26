// The co-op spectate bar's pure rules (docs/SPECTATE.md S5): its string keys exist in the placeholder pack with the
// tokens the bar fills, the name line drops "pos / count" without a position, the hint hides with fewer than two
// teammates to switch between and during a hold, and the fade-in is instant under reduced motion.
import { describe, expect, it } from "@rbxts/jest-globals";
import { spectateHint } from "shared/play";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import {
	SPECTATE_BAR_VIEW,
	SPECTATE_HUD_STRINGS,
	spectateBarTransparency,
	spectateHintShown,
	spectateStringKeys,
	spectateWatchingKey,
} from "shared/view/hud";

function quietPack(warnings: string[]): ThemePack {
	return new ThemePack(PLACEHOLDER_MANIFEST, { warn: (m) => warnings.push(m) });
}

describe("spectate bar", () => {
	it("every key exists in the placeholder pack and fills its tokens", () => {
		const warnings: string[] = [];
		const pack = quietPack(warnings);
		const keys = spectateStringKeys();
		expect(keys.size()).toBe(4);
		for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
		expect(pack.str(SPECTATE_HUD_STRINGS.watching, { name: "Ada", pos: 2, count: 3 })).toBe(
			"Spectating Ada  ·  2 / 3",
		);
		expect(pack.str(SPECTATE_HUD_STRINGS.watchingName, { name: "Ada" })).toBe("Spectating Ada");
		const keysOf = spectateHint().keyboard;
		expect(pack.str(SPECTATE_HUD_STRINGS.hint, { next: keysOf.next, previous: keysOf.previous })).toBe(
			"Click next · Right click previous",
		);
		expect(pack.str(SPECTATE_HUD_STRINGS.back)).toBe("You're back on the next floor");
		expect(warnings).toEqual([]);
	});

	it("drops the position without one and hides the hint with one teammate or during a hold", () => {
		expect(spectateWatchingKey(1)).toBe(SPECTATE_HUD_STRINGS.watching);
		expect(spectateWatchingKey(0)).toBe(SPECTATE_HUD_STRINGS.watchingName);
		expect([
			spectateHintShown(1, 0),
			spectateHintShown(1, 1),
			spectateHintShown(1, 2),
			spectateHintShown(3, 4),
		]).toEqual([false, false, true, true]);
		// during a hold on a corpse (position 0) presses are ignored: no hint, whatever the count
		expect([spectateHintShown(0, 2), spectateHintShown(0, 4)]).toEqual([false, false]);
	});

	it("fades in over fadeSec, at once under reduced motion", () => {
		const f = SPECTATE_BAR_VIEW.fadeSec;
		expect(spectateBarTransparency(0, 1)).toBe(1);
		expect(spectateBarTransparency(f / 2, 1)).toBeCloseTo(0.5);
		expect(spectateBarTransparency(f, 1)).toBe(0);
		expect(spectateBarTransparency(f * 4, 1)).toBe(0);
		expect(spectateBarTransparency(0, 0)).toBe(0);
	});
});
