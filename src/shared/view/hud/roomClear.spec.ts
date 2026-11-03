// The room clear celebration's HUD strings and text builders (docs/ROOM_CLEAR.md RC3): every key is required and exists
// in both bundled packs, the stamp and tally read as the design says, and the chip count matches ROOM_CLEAR.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PLACEHOLDER_MANIFEST, REQUIRED_STRING_KEYS, ROOM_CLEAR_STRING_KEYS, ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { ROOM_CLEAR } from "shared/view/fx";
import {
	ROOM_CLEAR_STRINGS,
	ROOM_CLEAR_VIEW,
	roomClearStampText,
	roomClearTallyText,
	type RoomClearStr,
} from "shared/view/hud";

const quiet = (): void => {};

describe("the room clear celebration's strings", () => {
	it("are the contract's required ROOM_CLEAR_STRING_KEYS and exist in every bundled pack", () => {
		const keys = [
			ROOM_CLEAR_STRINGS.clear,
			ROOM_CLEAR_STRINGS.perfect,
			ROOM_CLEAR_STRINGS.multi,
			ROOM_CLEAR_STRINGS.kills,
			ROOM_CLEAR_STRINGS.clearLine,
			ROOM_CLEAR_STRINGS.perfectLine,
			ROOM_CLEAR_STRINGS.fast,
			ROOM_CLEAR_STRINGS.total,
			ROOM_CLEAR_STRINGS.chip,
			ROOM_CLEAR_STRINGS.fly,
			ROOM_CLEAR_STRINGS.pellets,
			ROOM_CLEAR_STRINGS.sweep,
		];
		expect(keys).toEqual([...ROOM_CLEAR_STRING_KEYS]);
		for (const key of keys) expect([key, REQUIRED_STRING_KEYS.includes(key)]).toEqual([key, true]);
		for (const manifest of [PLACEHOLDER_MANIFEST, VALE_MANIFEST]) {
			const pack = new ThemePack(manifest, { warn: quiet });
			for (const key of keys) expect([key, pack.hasString(key)]).toEqual([key, true]);
		}
	});

	it("the stamp reads CLEAR / PERFECT, and PERFECT x2 for several rooms on one tick", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		const s: RoomClearStr = (key, vars) => pack.str(key, vars);
		expect(roomClearStampText(false, 1, s)).toBe("CLEAR");
		expect(roomClearStampText(true, 1, s)).toBe("PERFECT");
		expect(roomClearStampText(true, 2, s)).toBe("PERFECT x2");
	});

	it("the tally lists the started segments and then the total", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		const s: RoomClearStr = (key, vars) => pack.str(key, vars);
		const segs = [
			{ kind: "kills" as const, value: 300, shown: 300, started: true },
			{ kind: "clear" as const, value: 250, shown: 250, started: true },
			{ kind: "perfect" as const, value: 500, shown: 500, started: true },
			{ kind: "fast" as const, value: 90, shown: 90, started: true },
		];
		const notStarted = segs.map((g) => ({ ...g, shown: 0, started: false }));
		expect(roomClearTallyText({ segments: notStarted, segmentCount: 4, total: 0 }, s)).toBe("");
		expect(roomClearTallyText({ segments: segs, segmentCount: 4, total: 1140 }, s)).toBe(
			"Kills 300   Clear +250   No hits +500   Speed +90   = 1140",
		);
		const twoStarted = segs.map((g, i) => (i < 2 ? g : { ...g, shown: 0, started: false }));
		expect(roomClearTallyText({ segments: twoStarted, segmentCount: 4, total: 550 }, s)).toBe(
			"Kills 300   Clear +250   = 550",
		);
	});

	it("the corner chip count is ROOM_CLEAR.chip.max", () => {
		expect(ROOM_CLEAR_VIEW.maxChips).toBe(ROOM_CLEAR.chip.max);
	});
});
