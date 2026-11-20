// Co-op name tags (docs/PLAYER_NAMES.md): who gets a tag, its floor place above the head (below the feet by a wall),
// the duck and the fade.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG } from "shared/config";
import { TileType } from "shared/dungeon";
import {
	NAME_TAGS,
	NameTagLook,
	degToRad,
	nameTagAboveClear,
	nameTagCanvasSize,
	nameTagCentre,
	nameTagDucked,
	nameTagNear,
	nameTagOffsetTiles,
	nameTagShown,
	nameTagTextSize,
	type NameTagAxes,
	type NameTagBullets,
	type NameTagGrid,
} from "shared/view";

/** Screen-up = -z, screen-right = +x (a yaw-0 camera), so the strip runs straight along the grid. */
const AXES: NameTagAxes = { rightX: 1, rightZ: 0, upX: 0, upZ: -1 };

/** A W x H floor with WALL cells at `walls` ([gx, gy] pairs). */
function grid(w: number, h: number, walls: ReadonlyArray<readonly [number, number]> = []): NameTagGrid {
	const cells = new Array<number>();
	for (let i = 0; i < w * h; i++) cells.push(TileType.FLOOR);
	for (const [x, y] of walls) cells[y * w + x] = TileType.WALL;
	return { W: w, H: h, grid: cells };
}

function bullets(points: ReadonlyArray<readonly [number, number, boolean?]>): NameTagBullets {
	return {
		highWater() {
			return points.size();
		},
		isVisible(i) {
			return points[i][2] !== false;
		},
		positionAt(i) {
			return { x: points[i][0], z: points[i][1] };
		},
	};
}

describe("nameTagShown", () => {
	it("tags living teammates in a party run only, never the watched player, and only with the setting on", () => {
		expect(nameTagShown(2, 1, 0, false, "Ada", true)).toBe(true);
		expect(nameTagShown(4, 3, 0, false, "Ada", true)).toBe(true);
		expect(nameTagShown(1, 0, 0, false, "Ada", true)).toBe(false); // solo
		expect(nameTagShown(2, 0, 0, false, "Ada", true)).toBe(false); // yourself
		expect(nameTagShown(3, 2, 2, false, "Ada", true)).toBe(false); // the teammate you spectate
		expect(nameTagShown(2, 1, 0, true, "Ada", true)).toBe(false); // dead
		expect(nameTagShown(2, 1, 0, false, "", true)).toBe(false); // no name
		expect(nameTagShown(2, 1, 0, false, "Ada", false)).toBe(false); // the setting
	});
});

describe("nameTag placement", () => {
	it("puts the tag's bottom edge gapTiles above the head on screen, or its top edge belowGapTiles under the feet", () => {
		const s = math.sin(degToRad(CAMERA_PITCH_DEG));
		const above = nameTagOffsetTiles("above");
		const below = nameTagOffsetTiles("below");
		// Screen distance of the near edge (floor distance x sin(pitch)).
		expect((above - NAME_TAGS.depthTiles / 2) * s).toBeCloseTo(NAME_TAGS.headTiles + NAME_TAGS.gapTiles, 9);
		expect((-below - NAME_TAGS.depthTiles / 2) * s).toBeCloseTo(NAME_TAGS.belowGapTiles, 9);
		expect(above).toBeGreaterThan(0);
		expect(below).toBeLessThan(0);
		const out = { x: 0, z: 0 };
		nameTagCentre(10, 20, "above", AXES, out);
		expect(out.x).toBe(10);
		expect(out.z).toBeCloseTo(20 - above, 9);
		nameTagCentre(10, 20, "below", AXES, out);
		expect(out.z).toBeCloseTo(20 - below, 9);
	});

	it("is clear above on open floor and in the greybox, not when a wall or the void stands in the strip", () => {
		const open = grid(20, 20);
		expect(nameTagAboveClear(open, 10, 10, AXES)).toBe(true);
		expect(nameTagAboveClear(undefined, 10, 10, AXES)).toBe(true);
		// A far wall two rows up, under the tag.
		expect(nameTagAboveClear(grid(20, 20, [[10, 8]]), 10, 10, AXES)).toBe(false);
		// At the tag's side edge (half the width across) still counts.
		expect(nameTagAboveClear(grid(20, 20, [[12, 8]]), 10, 10, AXES)).toBe(false);
		// Beyond the tag's far edge or behind the player: no effect.
		const far = math.ceil(nameTagOffsetTiles("above") + NAME_TAGS.depthTiles / 2) + 1;
		expect(nameTagAboveClear(grid(20, 20, [[10, 10 - far]]), 10, 10, AXES)).toBe(true);
		expect(nameTagAboveClear(grid(20, 20, [[10, 12]]), 10, 10, AXES)).toBe(true);
		// Off the grid is void.
		expect(nameTagAboveClear(open, 10, 1, AXES)).toBe(false);
		// A pool is flat: clear.
		const pool = grid(20, 20);
		(pool.grid as Array<number>)[8 * 20 + 10] = TileType.POOL;
		expect(nameTagAboveClear(pool, 10, 10, AXES)).toBe(true);
	});
});

describe("nameTagDucked / nameTagNear", () => {
	it("ducks for a visible enemy bullet in the box grown by the margin, not for one outside or hidden", () => {
		const halfW = NAME_TAGS.widthTiles / 2 + NAME_TAGS.duckMarginTiles;
		const halfD = NAME_TAGS.depthTiles / 2 + NAME_TAGS.duckMarginTiles;
		expect(nameTagDucked(0, 0, AXES, bullets([]))).toBe(false);
		expect(nameTagDucked(0, 0, AXES, bullets([[0, 0]]))).toBe(true);
		expect(nameTagDucked(0, 0, AXES, bullets([[halfW, halfD]]))).toBe(true);
		expect(nameTagDucked(0, 0, AXES, bullets([[halfW + 0.01, 0]]))).toBe(false);
		expect(nameTagDucked(0, 0, AXES, bullets([[0, halfD + 0.01]]))).toBe(false);
		expect(nameTagDucked(0, 0, AXES, bullets([[0, 0, false]]))).toBe(false);
	});

	it("is near within nearTiles of the watched player", () => {
		expect(nameTagNear(0, 0, NAME_TAGS.nearTiles, 0)).toBe(true);
		expect(nameTagNear(0, 0, NAME_TAGS.nearTiles + 0.01, 0)).toBe(false);
	});
});

describe("NameTagLook", () => {
	it("fades in from 0 on a reset, to maxOpacity, nearOpacity or duckOpacity", () => {
		const look = new NameTagLook();
		look.reset();
		expect(look.opacity).toBe(0);
		look.step(NAME_TAGS.fadeSec / 2, true, false, false);
		expect(look.opacity).toBeCloseTo(NAME_TAGS.maxOpacity / 2, 9);
		for (let i = 0; i < 20; i++) look.step(0.05, true, false, false);
		expect(look.opacity).toBe(NAME_TAGS.maxOpacity);
		for (let i = 0; i < 20; i++) look.step(0.05, true, false, true);
		expect(look.opacity).toBe(NAME_TAGS.nearOpacity);
		for (let i = 0; i < 20; i++) look.step(0.05, true, true, true);
		expect(look.opacity).toBe(NAME_TAGS.duckOpacity);
		// A hitch is capped.
		look.reset();
		look.step(10, true, false, false);
		expect(look.opacity).toBeCloseTo((NAME_TAGS.maxOpacity / NAME_TAGS.fadeSec) * NAME_TAGS.maxDtSec, 9);
	});

	it("takes the wanted side at once on a reset, then only after it held sideHoldSec", () => {
		const look = new NameTagLook();
		look.reset();
		look.step(0.016, false, false, false);
		expect(look.side).toBe("below");
		// Steps of a quarter of the hold (under the dt cap).
		const quarter = NAME_TAGS.sideHoldSec / 4;
		expect(quarter).toBeLessThanOrEqual(NAME_TAGS.maxDtSec);
		look.step(quarter, true, false, false);
		look.step(quarter, true, false, false);
		expect(look.side).toBe("below");
		look.step(0.016, false, false, false); // the wanted side flipped back: the hold restarts
		look.step(quarter, true, false, false);
		look.step(quarter, true, false, false);
		look.step(quarter, true, false, false);
		expect(look.side).toBe("below");
		look.step(quarter, true, false, false);
		expect(look.side).toBe("above");
	});
});

describe("nameTag canvas", () => {
	it("is widthTiles x canvasPxPerTile wide and foreshortened tall; the text fits in it", () => {
		const [w, h] = nameTagCanvasSize();
		expect(w).toBe(NAME_TAGS.widthTiles * NAME_TAGS.canvasPxPerTile);
		const s = math.sin(degToRad(CAMERA_PITCH_DEG));
		expect(h).toBe(math.round(NAME_TAGS.depthTiles * NAME_TAGS.canvasPxPerTile * s));
		expect(nameTagTextSize()).toBeLessThanOrEqual(h);
		expect(nameTagTextSize()).toBeGreaterThan(0);
	});
});
