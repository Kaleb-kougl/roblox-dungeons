// The combo's HUD strings (docs/COMBO.md CB3): the id map is the contract's required COMBO_STRING_KEYS, in order, and
// every key exists in both bundled packs.
import { describe, expect, it } from "@rbxts/jest-globals";
import { COMBO_STRING_KEYS, PLACEHOLDER_MANIFEST, REQUIRED_STRING_KEYS, ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { COMBO_STRINGS } from "shared/view/hud";

const quiet = (): void => {};

describe("the combo's strings", () => {
	it("are the contract's required COMBO_STRING_KEYS and exist in every bundled pack", () => {
		const keys = [
			COMBO_STRINGS.rampage,
			COMBO_STRINGS.carnage,
			COMBO_STRINGS.dominating,
			COMBO_STRINGS.unstoppable,
			COMBO_STRINGS.lost,
			COMBO_STRINGS.best,
			COMBO_STRINGS.shout,
			COMBO_STRINGS.bestNamed,
		];
		expect(keys).toEqual([...COMBO_STRING_KEYS]);
		for (const key of keys) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const manifest of [PLACEHOLDER_MANIFEST, VALE_MANIFEST]) {
			const pack = new ThemePack(manifest, { warn: quiet });
			for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
		}
	});
});
