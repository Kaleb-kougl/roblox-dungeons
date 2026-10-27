import { describe, expect, it } from "@rbxts/jest-globals";
import { BOOST_KINDS } from "shared/theme";
import { BOOST_VIEW } from "shared/view/boosts";
import { HUD_FOOTPRINT, HUD_VIEW, PROGRESSION_VIEW, statusRowMaxWidth, wrapGrid } from "shared/view/hud";

describe("wrapGrid", () => {
	it("no cells: an empty grid", () => {
		expect(wrapGrid(0, 10, 10, 2, 100)).toEqual({ cols: 1, rows: 0, width: 0, height: 0 });
	});
	it("fits as many cells per row as the width allows, then wraps", () => {
		// (100 + 2) / (10 + 2) = 8.5 -> 8 per row
		expect(wrapGrid(5, 10, 10, 2, 100)).toEqual({ cols: 5, rows: 1, width: 58, height: 10 });
		expect(wrapGrid(8, 10, 10, 2, 100)).toEqual({ cols: 8, rows: 1, width: 94, height: 10 });
		expect(wrapGrid(9, 10, 10, 2, 100)).toEqual({ cols: 8, rows: 2, width: 94, height: 22 });
	});
	it("a cell wider than the limit still gets one column", () => {
		expect(wrapGrid(3, 200, 10, 2, 100)).toEqual({ cols: 1, rows: 3, width: 200, height: 34 });
	});
	it("the status rows wrap inside the status footprint", () => {
		const max = statusRowMaxWidth();
		expect(max).toBe(HUD_FOOTPRINT.status.maxW - 2 * HUD_VIEW.pad);
		const items = wrapGrid(10, PROGRESSION_VIEW.iconSize, PROGRESSION_VIEW.iconSize, HUD_VIEW.gap, max);
		expect(items.width <= max).toBe(true);
		const entryW = BOOST_VIEW.iconSize + BOOST_VIEW.iconBarGap + BOOST_VIEW.barWidth;
		const boosts = wrapGrid(BOOST_KINDS.size(), entryW, BOOST_VIEW.iconSize, HUD_VIEW.gap, max);
		expect(boosts.width <= max).toBe(true);
	});
});
