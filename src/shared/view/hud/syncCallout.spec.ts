// The SYNC! callout's drawing pieces (docs/RUN_RECAP.md CM5): its required strings in every bundled pack, the label
// (SYNC! / SYNC x3), the text's share of the shout's box and the tether's opacity.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PLACEHOLDER_MANIFEST, REQUIRED_STRING_KEYS, TEAM_MOMENT_STRING_KEYS, ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { TEAM_MOMENTS_VIEW } from "shared/view/fx";
import {
	COMBO_SHOUT,
	SYNC_CALLOUT_STRINGS,
	parryFlashOpacity,
	syncCalloutLabel,
	syncCalloutSize,
	syncTetherOpacity,
} from ".";

const quiet = (): void => {};

describe("the SYNC! callout's drawing", () => {
	it("reads required strings that every bundled pack has", () => {
		for (const key of [SYNC_CALLOUT_STRINGS.sync, SYNC_CALLOUT_STRINGS.count]) {
			expect([key, TEAM_MOMENT_STRING_KEYS.includes(key), REQUIRED_STRING_KEYS.includes(key)]).toEqual([
				key,
				true,
				true,
			]);
			for (const manifest of [PLACEHOLDER_MANIFEST, VALE_MANIFEST]) {
				expect([key, new ThemePack(manifest, { warn: quiet }).hasString(key)]).toEqual([key, true]);
			}
		}
	});

	it("labels two players SYNC! and three or more SYNC x{n}", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect([syncCalloutLabel(pack, 2), syncCalloutLabel(pack, 3), syncCalloutLabel(pack, 4)]).toEqual([
			"SYNC!",
			"SYNC x3",
			"SYNC x4",
		]);
	});

	it("fills scale (smallScale at each point) of the shout's box x the pop, never past the box", () => {
		const C = TEAM_MOMENTS_VIEW.callout;
		expect([syncCalloutSize(false, 1), syncCalloutSize(true, 1)]).toEqual([C.scale, C.smallScale]);
		expect(syncCalloutSize(false, C.popScale)).toBe(math.min(1, C.scale * C.popScale));
		expect(syncCalloutSize(false, 10)).toBe(1);
	});

	it("stays under the shout's 55 % cap (the PARRY! flash's opacity rule) and the tether under its own", () => {
		expect(COMBO_SHOUT.maxOpacity).toBe(0.55);
		expect(parryFlashOpacity(1, 1)).toBe(COMBO_SHOUT.maxOpacity);
		expect(parryFlashOpacity(1, COMBO_SHOUT.duckOpacity)).toBe(COMBO_SHOUT.duckOpacity);
		expect([syncTetherOpacity(1), syncTetherOpacity(0), syncTetherOpacity(2)]).toEqual([
			TEAM_MOMENTS_VIEW.tether.maxOpacity,
			0,
			TEAM_MOMENTS_VIEW.tether.maxOpacity,
		]);
	});
});
