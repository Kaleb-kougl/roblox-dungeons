// The Daily's rank layer strings (docs/DAILY.md DS10): the id map is the contract's required DAILY_RANK_STRING_KEYS, in
// order, every key exists in both bundled packs, the placeholder English fills its vars, and the two port audio IDs
// are required and silent in the placeholder.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DAILY_RANK_STRING_KEYS,
	PLACEHOLDER_MANIFEST,
	PORT_AUDIO_EVENTS,
	REQUIRED_ASSET_IDS,
	REQUIRED_STRING_KEYS,
	ThemePack,
	slotFor,
} from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { DAILY_RANK_STRINGS } from "shared/view/hud";

const quiet = (): void => {};

describe("the daily rank layer's strings and sounds", () => {
	it("are the contract's required DAILY_RANK_STRING_KEYS and exist in every bundled pack", () => {
		const keys: string[] = [];
		const K = DAILY_RANK_STRINGS;
		for (const key of [
			K.toGo,
			K.over,
			K.newBest,
			K.shout,
			K.ribbon,
			K.first,
			K.scoreRow,
			K.target,
			K.rung,
			K.rungShort,
			K.top,
			K.topShort,
			K.friend,
			K.cutoff,
			K.chaseShort,
			K.passed,
			K.shout100,
			K.shout10,
			K.shout3,
			K.shout1,
			K.passedLabel,
			K.passedMore,
		])
			keys.push(key);
		expect(keys).toEqual([...DAILY_RANK_STRING_KEYS]);
		for (const key of keys) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const manifest of [PLACEHOLDER_MANIFEST, VALE_MANIFEST]) {
			const pack = new ThemePack(manifest, { warn: quiet });
			for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
		}
	});

	it("fill their vars in the placeholder English", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		const K = DAILY_RANK_STRINGS;
		expect(pack.str(K.toGo, { points: 310 })).toBe("310 TO BEST TODAY");
		expect(pack.str(K.over, { points: 42 })).toBe("NEW BEST TODAY +42");
		expect(pack.str(K.rung, { from: 41, to: 40, points: 310 })).toBe("#41 -> #40 · 310");
		expect(pack.str(K.rungShort, { to: 40, points: 310 })).toBe("#40 -310");
		expect(pack.str(K.friend, { name: "Alex", points: 12 })).toBe("Alex · 12");
		expect(pack.str(K.cutoff, { n: 100, points: 900 })).toBe("TOP 100 · 900");
		expect(pack.str(K.passed, { name: "Alex", score: 21900 })).toBe("Beat Alex's high score (21900)");
		expect(pack.str(K.scoreRow, { old: 1, new: 5, delta: 4 })).toBe("Best today 1 -> 5 pts (+4)");
		expect(pack.str(K.target, { score: 23410 })).toBe("Best today 23410 pts");
		expect(pack.str(K.passedMore, { n: 2 })).toBe("+2 more");
		expect([pack.str(K.shout100), pack.str(K.shout10), pack.str(K.shout3), pack.str(K.shout1)]).toEqual([
			"TOP 100!",
			"TOP 10!",
			"TOP 3!",
			"#1 TODAY!",
		]);
	});

	it("append sfx.rank.up and sfx.friend.passed to the port's audio IDs, silent in the placeholder", () => {
		// after the build sounds (builds v2's beam last, docs/BUILDS_V2.md BV10); later features append after them
		// (docs/BREAKABLE_DROPS.md BL5)
		const n = (PORT_AUDIO_EVENTS as ReadonlyArray<string>).indexOf("sfx.friend.passed") + 1;
		expect([PORT_AUDIO_EVENTS[n - 3], PORT_AUDIO_EVENTS[n - 2], PORT_AUDIO_EVENTS[n - 1]]).toEqual([
			"sfx.build.beam",
			"sfx.rank.up",
			"sfx.friend.passed",
		]);
		const assets = PLACEHOLDER_MANIFEST.assets as unknown as Record<string, { kind: string }>;
		for (const id of ["sfx.rank.up", "sfx.friend.passed"]) {
			expect([id, slotFor(id)?.soundGroup, REQUIRED_ASSET_IDS.includes(id), assets[id].kind]).toEqual([
				id,
				"sfx",
				true,
				"silent",
			]);
		}
	});
});
