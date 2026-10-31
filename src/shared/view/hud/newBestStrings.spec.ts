// The new-best celebration's strings (docs/NEW_BEST.md NB4): the id map is the contract's required NEW_BEST_STRING_KEYS,
// in order, and every key exists in both bundled packs.
import { describe, expect, it } from "@rbxts/jest-globals";
import { NEW_BEST_STRING_KEYS, PLACEHOLDER_MANIFEST, REQUIRED_STRING_KEYS, ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { NEW_BEST_STRINGS } from "shared/view/hud";

const quiet = (): void => {};

describe("the new best's strings", () => {
	it("are the contract's required NEW_BEST_STRING_KEYS and exist in every bundled pack", () => {
		const K = NEW_BEST_STRINGS;
		const keys = [
			K.toGo,
			K.toGoShort,
			K.newBest,
			K.over,
			K.shout,
			K.stageToGo,
			K.stageOneToGo,
			K.stageRecordFloor,
			K.stageNewDeepest,
			K.stageDeeperYet,
			K.ribbon,
			K.first,
			K.scoreRow,
			K.floorRow,
			K.saved,
			K.unsaved,
			K.target,
			K.menu,
		];
		expect(keys).toEqual([...NEW_BEST_STRING_KEYS]);
		for (const key of keys) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const manifest of [PLACEHOLDER_MANIFEST, VALE_MANIFEST]) {
			const pack = new ThemePack(manifest, { warn: quiet });
			for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
		}
	});
});
