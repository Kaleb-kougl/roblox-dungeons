import { describe, expect, it } from "@rbxts/jest-globals";
import { sheetSpriteLayout } from "./spriteCell";
import { spriteBillboard, type SpriteLayout } from "./sprites";

/** A set's own cell (the union of its sheets, as art:build writes it): 99x113, feet at (51, 89), 38 px per tile. */
const SET: SpriteLayout = { frameW: 99, frameH: 113, pivot: { x: 51, y: 89 }, pixelsPerTile: 38 };

describe("sheetSpriteLayout (per-sheet cells, docs/DEMON_ART.md DD4)", () => {
	it("is the caller's layout itself for a sheet in the set's own cell", () => {
		expect(sheetSpriteLayout(SET, SET, 99, 113, { x: 51, y: 89 })).toBe(SET);
		// a caller's adjusted layout (another density, a refitted pivot) comes back untouched too
		const scaled: SpriteLayout = { ...SET, pivot: { x: 50, y: 90 }, pixelsPerTile: 20 };
		expect(sheetSpriteLayout(scaled, SET, 99, 113, { x: 51, y: 89 })).toBe(scaled);
	});

	it("takes the sheet's cell and pivot at the set's density", () => {
		expect(sheetSpriteLayout(SET, SET, 44, 78, { x: 24, y: 67 })).toEqual({
			frameW: 44,
			frameH: 78,
			pivot: { x: 24, y: 67 },
			pixelsPerTile: 38,
		});
	});

	it("carries a caller's pivot adjustment and density over to the sheet", () => {
		const scaled: SpriteLayout = { ...SET, pivot: { x: 50, y: 90 }, pixelsPerTile: 20 };
		expect(sheetSpriteLayout(scaled, SET, 44, 78, { x: 24, y: 67 })).toEqual({
			frameW: 44,
			frameH: 78,
			pivot: { x: 23, y: 68 },
			pixelsPerTile: 20,
		});
	});

	it("keeps the feet planted: every source pixel lands on the same spot whichever cell draws it", () => {
		// The idle sheet is a crop of the set's cell starting (27, 22) in: a source pixel at set-cell (px, py) is at
		// (px - 27, py - 22) in the idle cell. Its offset from the feet, in studs, must not change with the billboard.
		const idle = sheetSpriteLayout(SET, SET, 44, 78, { x: 24, y: 67 });
		const studsPerTile = 4;
		const where = (l: SpriteLayout, px: number, py: number) => {
			const b = spriteBillboard(l, studsPerTile, 0);
			const s = studsPerTile / l.pixelsPerTile;
			// billboard x right / y up from the anchor: centre offset + the pixel's offset from the centre
			return [b.offsetX + (px + 0.5 - l.frameW / 2) * s, b.offsetY - (py + 0.5 - l.frameH / 2) * s];
		};
		for (const [px, py] of [
			[27, 22],
			[51, 88],
			[70, 99],
		]) {
			const [ax, ay] = where(SET, px, py);
			const [bx, by] = where(idle, px - 27, py - 22);
			expect(bx).toBeCloseTo(ax, 9);
			expect(by).toBeCloseTo(ay, 9);
		}
		// and the pivot pixel is the anchor in both
		expect(where(SET, 51, 89)[0]).toBeCloseTo(0.5 * (studsPerTile / 38), 9);
	});
});
