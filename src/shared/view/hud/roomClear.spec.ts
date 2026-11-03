// The room clear celebration's HUD strings and text builders (docs/ROOM_CLEAR.md RC3): every key is required and exists
// in both bundled packs, the stamp and tally read as the design says, and the chip count matches ROOM_CLEAR.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PLACEHOLDER_MANIFEST, REQUIRED_STRING_KEYS, ROOM_CLEAR_STRING_KEYS, ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { ROOM_CLEAR, roomClearSegments, type RoomClear } from "shared/view/fx";
import {
	HUD_TRANSIENT,
	HUD_VIEW,
	ROOM_CLEAR_STRINGS,
	ROOM_CLEAR_VIEW,
	TOUCH_TEST_VIEWPORTS,
	computeHudScale,
	roomClearFinalTallyText,
	roomClearFoldPellets,
	roomClearStampText,
	roomClearTallyText,
	roomClearTallyTextSize,
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

	it("the tally shows the pellet points like Kills and the Sweep like a bonus (docs/PELLETS.md PL7)", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		const s: RoomClearStr = (key, vars) => pack.str(key, vars);
		const segs = [
			{ kind: "kills" as const, value: 300, shown: 300, started: true },
			{ kind: "pellets" as const, value: 120, shown: 120, started: true },
			{ kind: "clear" as const, value: 250, shown: 250, started: true },
			{ kind: "sweep" as const, value: 250, shown: 250, started: true },
		];
		expect(roomClearTallyText({ segments: segs, segmentCount: 4, total: 920 }, s)).toBe(
			"Kills 300   Pellets 120   Clear +250   Sweep +250   = 920",
		);
	});
});

/** A clear with the given points (the rest of RoomClear does not reach the tally). */
function clearOf(over: Partial<RoomClear>): RoomClear {
	return {
		room: 1,
		rooms: 1,
		perfect: false,
		killPoints: 0,
		clearPoints: 0,
		perfectPoints: 0,
		fastPoints: 0,
		pelletPoints: 0,
		sweepPoints: 0,
		x: 0,
		z: 0,
		slot: -1,
		actorId: 0,
		minX: 0,
		maxX: 1,
		minZ: 0,
		maxZ: 1,
		tick: 1,
		...over,
	};
}

describe("the tally row's fit on the smallest phone (docs/PELLETS.md PL7)", () => {
	const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
	const s: RoomClearStr = (key, vars) => pack.str(key, vars);
	/** Today's full four-segment row (ROOM_CLEAR.md's example): the reference ROOM_CLEAR_VIEW.tallyFit.minText sits at. */
	const FOUR = clearOf({ killPoints: 300, clearPoints: 250, perfectPoints: 500, fastPoints: 90, perfect: true });
	const SIX = clearOf({ ...FOUR, pelletPoints: 120, sweepPoints: 250 });
	const SWEPT = clearOf({ killPoints: 300, clearPoints: 250, pelletPoints: 120, sweepPoints: 250 });

	function size(c: RoomClear, fold: boolean): number {
		return roomClearTallyTextSize(roomClearFinalTallyText(roomClearSegments(c, fold), s));
	}

	/** The smallest HUD scale a touch device draws the slot at (100 % setting, both orientations). */
	function smallestTouchScale(): number {
		let least = math.huge;
		for (const v of TOUCH_TEST_VIEWPORTS) {
			least = math.min(least, computeHudScale(v.x, v.y, false, 100, true));
			least = math.min(least, computeHudScale(v.y, v.x, false, 100, true));
		}
		return least;
	}

	it("the slot is the stamp row's width, and the estimate is the max text size for a short row", () => {
		expect(HUD_TRANSIENT.roomClear.width).toBe(ROOM_CLEAR_VIEW.width);
		expect(roomClearTallyTextSize("")).toBe(ROOM_CLEAR_VIEW.tallyText);
		expect(roomClearTallyTextSize("Clear +250   = 250")).toBe(ROOM_CLEAR_VIEW.tallyText);
	});

	it("today's four-segment row sits at the floor; a pellet room without No hits / Speed keeps its Pellets segment", () => {
		expect(size(FOUR, false)).toBeGreaterThanOrEqual(ROOM_CLEAR_VIEW.tallyFit.minText);
		expect(roomClearFoldPellets(FOUR, s)).toBe(false); // no pellet points: nothing to fold
		expect(size(SWEPT, false)).toBeGreaterThanOrEqual(ROOM_CLEAR_VIEW.tallyFit.minText);
		expect(roomClearFoldPellets(SWEPT, s)).toBe(false);
	});

	it("all six segments do not fit: the pellets fold into Kills (prints the estimates on the smallest phone)", () => {
		expect(size(SIX, false) < ROOM_CLEAR_VIEW.tallyFit.minText).toBe(true);
		expect(roomClearFoldPellets(SIX, s)).toBe(true);
		expect(size(SIX, true)).toBeGreaterThan(size(SIX, false));
		const scale = smallestTouchScale();
		expect(scale <= HUD_VIEW.touchMinScale).toBe(true);
		print(
			string.format(
				"[roomClear] tally text on the smallest phone (HUD scale %.2f): four %.1f px, six %.1f px, six folded %.1f px, swept %.1f px (floor %.1f px)",
				scale,
				size(FOUR, false) * scale,
				size(SIX, false) * scale,
				size(SIX, true) * scale,
				size(SWEPT, false) * scale,
				ROOM_CLEAR_VIEW.tallyFit.minText * scale,
			),
		);
	});
});
