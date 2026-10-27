import { describe, expect, it } from "@rbxts/jest-globals";
import { STUDS_PER_TILE } from "shared/config";
import { sheetSpriteLayout } from "../spriteCell";
import { spriteBillboard, type SpriteBillboard, type SpriteLayout } from "../sprites";
import { FEEL_SQUASH } from "./motionFxConfig";
import {
	RollEdgeWatch,
	SquashBook,
	roundToArtPixels,
	squashAt,
	squashLengthSec,
	squashedBillboard,
	type SquashKind,
	type SquashScale,
} from "./squash";

const KINDS: ReadonlyArray<SquashKind> = ["rollStart", "rollEnd", "hit", "spawn", "death"];
const AXIS_KINDS: ReadonlyArray<Exclude<SquashKind, "spawn">> = ["rollStart", "rollEnd", "hit", "death"];
const EPS = 1e-9;
/** The knight's cell (docs/ART.md): 98 x 74 at 38 px per tile, feet at (49, 60). */
const KNIGHT: SpriteLayout = { frameW: 98, frameH: 74, pivot: { x: 49, y: 60 }, pixelsPerTile: 38 };

function samples(kind: SquashKind, steps = 90): number[] {
	const out: number[] = [];
	const len = squashLengthSec(kind);
	for (let i = 0; i <= steps; i++) out.push((len * i) / steps);
	return out;
}

/** Where the billboard's pivot pixel lands relative to the feet anchor (camera space x, y), for pivot (px, py). */
function pivotOnScreen(b: SpriteBillboard, layout: SpriteLayout, sx: number, sy: number): [number, number] {
	const left = b.offsetX - b.w / 2;
	const top = b.offsetY + b.h / 2;
	const pxW = b.w / layout.frameW;
	const pxH = b.h / layout.frameH;
	expect(pxW).toBeCloseTo((sx * STUDS_PER_TILE) / layout.pixelsPerTile, 9);
	expect(pxH).toBeCloseTo((sy * STUDS_PER_TILE) / layout.pixelsPerTile, 9);
	return [left + layout.pivot.x * pxW, top - layout.pivot.y * pxH];
}

describe("FEEL_SQUASH (JD4)", () => {
	it("keeps every curve within 15 % and 180 ms", () => {
		for (const kind of AXIS_KINDS) {
			const c = FEEL_SQUASH[kind];
			expect(math.abs(c.sx - 1) <= FEEL_SQUASH.maxDeform + EPS).toBe(true);
			expect(math.abs(c.sy - 1) <= FEEL_SQUASH.maxDeform + EPS).toBe(true);
			expect(c.lengthSec <= FEEL_SQUASH.maxSec).toBe(true);
		}
		expect(FEEL_SQUASH.spawn.peak <= 1 + FEEL_SQUASH.maxDeform).toBe(true);
		expect(FEEL_SQUASH.spawn.lengthSec <= FEEL_SQUASH.maxSec).toBe(true);
		expect(FEEL_SQUASH.maxDeform).toBe(0.15);
		expect(FEEL_SQUASH.maxSec).toBe(0.18);
	});
});

describe("squashAt", () => {
	it("starts a roll at its peak and eases back to 1 x 1 by its length", () => {
		expect(squashAt("rollStart", 0, 1)).toEqual({ sx: 1.15, sy: 0.85 });
		expect(squashAt("rollEnd", 0, 1)).toEqual({ sx: 1.1, sy: 0.9 });
		expect(squashAt("hit", 0, 1)).toEqual({ sx: 1.1, sy: 0.9 });
		const mid = squashAt("rollStart", 0.045, 1);
		expect(mid.sx > 1 && mid.sx < 1.15).toBe(true);
		expect(mid.sy < 1 && mid.sy > 0.85).toBe(true);
		expect(squashAt("rollStart", 0.09, 1)).toEqual({ sx: 1, sy: 1 });
		expect(squashAt("rollEnd", 0.08, 1)).toEqual({ sx: 1, sy: 1 });
		expect(squashAt("hit", 0.07, 1)).toEqual({ sx: 1, sy: 1 });
		expect(squashAt("death", 0.1, 1)).toEqual({ sx: 1, sy: 1 });
	});

	it("eases a roll back monotonically", () => {
		let last = math.huge;
		for (const age of samples("rollStart")) {
			const s = squashAt("rollStart", age, 1);
			expect(s.sx <= last + EPS).toBe(true);
			last = s.sx;
		}
	});

	it("reaches the death slump a little in, then settles", () => {
		expect(squashAt("death", 0, 1)).toEqual({ sx: 1, sy: 1 });
		const peakAge = FEEL_SQUASH.death.attack * FEEL_SQUASH.death.lengthSec;
		const peak = squashAt("death", peakAge, 1);
		expect(peak.sx).toBeCloseTo(1.12, 9);
		expect(peak.sy).toBeCloseTo(0.88, 9);
		const later = squashAt("death", (peakAge + FEEL_SQUASH.death.lengthSec) / 2, 1);
		expect(later.sx > 1 && later.sx < peak.sx).toBe(true);
	});

	it("grows a spawn in from 0.6, overshoots to 1.08 and settles at 1, uniformly", () => {
		const c = FEEL_SQUASH.spawn;
		expect(squashAt("spawn", 0, 1)).toEqual({ sx: 0.6, sy: 0.6 });
		const peak = squashAt("spawn", c.peakAt * c.lengthSec, 1);
		expect(peak.sx).toBeCloseTo(1.08, 9);
		expect(peak.sy).toBe(peak.sx);
		expect(squashAt("spawn", c.lengthSec, 1)).toEqual({ sx: 1, sy: 1 });
		let max = 0;
		for (const age of samples("spawn")) {
			const s = squashAt("spawn", age, 1);
			expect(s.sx).toBe(s.sy);
			max = math.max(max, s.sx);
		}
		expect(max <= 1.08 + EPS).toBe(true);
	});

	it("never deforms past 15 % on any axis (the spawn's grow-in aside)", () => {
		for (const kind of AXIS_KINDS) {
			for (const age of samples(kind)) {
				const s = squashAt(kind, age, 1);
				expect(math.abs(s.sx - 1) <= FEEL_SQUASH.maxDeform + EPS).toBe(true);
				expect(math.abs(s.sy - 1) <= FEEL_SQUASH.maxDeform + EPS).toBe(true);
			}
		}
	});

	it("is 1 x 1 under reduced motion (motionScale 0), at every age of every kind", () => {
		for (const kind of KINDS) {
			for (const age of samples(kind, 20)) expect(squashAt(kind, age, 0)).toEqual({ sx: 1, sy: 1 });
		}
	});

	it("scales the deformation by motion", () => {
		const half = squashAt("rollStart", 0, 0.5);
		expect(half.sx).toBeCloseTo(1.075, 9);
		expect(half.sy).toBeCloseTo(0.925, 9);
		expect(squashAt("spawn", 0, 0.5).sx).toBeCloseTo(0.8, 9);
	});

	it("is 1 x 1 for a negative, NaN or very late age", () => {
		for (const kind of KINDS) {
			expect(squashAt(kind, -0.01, 1)).toEqual({ sx: 1, sy: 1 });
			expect(squashAt(kind, 0 / 0, 1)).toEqual({ sx: 1, sy: 1 });
			expect(squashAt(kind, 10, 1)).toEqual({ sx: 1, sy: 1 });
		}
	});
});

describe("roundToArtPixels (JD4)", () => {
	it("keeps 1 exactly 1", () => {
		for (const px of [1, 7, 74, 98, 113, 333]) expect(roundToArtPixels(1, px)).toBe(1);
	});

	it("snaps to a whole number of art pixels", () => {
		expect(roundToArtPixels(1.15, 98)).toBe(113 / 98); // 112.7 -> 113
		expect(roundToArtPixels(0.85, 74)).toBe(63 / 74); // 62.9 -> 63
		for (const px of [17, 74, 98, 113]) {
			for (let s = 0.6; s <= 1.15; s += 0.0137) {
				const r = roundToArtPixels(s, px);
				const drawn = r * px;
				expect(math.abs(drawn - math.floor(drawn + 0.5)) < 1e-9).toBe(true);
				expect(math.abs(r - s) <= 0.5 / px + EPS).toBe(true);
			}
		}
	});

	it("keeps at least one pixel and leaves bad input alone", () => {
		expect(roundToArtPixels(0.001, 10)).toBe(1 / 10);
		expect(roundToArtPixels(1.1, 0)).toBe(1.1);
		expect(roundToArtPixels(0, 98)).toBe(0);
	});
});

describe("squashedBillboard", () => {
	it("is the billboard itself at 1 x 1", () => {
		const b = spriteBillboard(KNIGHT);
		expect(squashedBillboard(b, 1, 1)).toBe(b);
	});

	it("keeps the pivot pixel on the feet anchor through every curve", () => {
		const b = spriteBillboard(KNIGHT);
		const [x0, y0] = pivotOnScreen(b, KNIGHT, 1, 1);
		expect(x0).toBeCloseTo(0, 9);
		expect(y0).toBeCloseTo(0, 9);
		for (const kind of KINDS) {
			for (const age of samples(kind, 12)) {
				const s = squashAt(kind, age, 1);
				const sx = roundToArtPixels(s.sx, KNIGHT.frameW);
				const sy = roundToArtPixels(s.sy, KNIGHT.frameH);
				const [x, y] = pivotOnScreen(squashedBillboard(b, sx, sy), KNIGHT, sx, sy);
				expect(x).toBeCloseTo(0, 9);
				expect(y).toBeCloseTo(0, 9);
			}
		}
	});

	it("keeps the pivot for a per-sheet cell too", () => {
		const sheet = sheetSpriteLayout(KNIGHT, KNIGHT, 44, 78, { x: 24, y: 67 });
		const b = spriteBillboard(sheet);
		const [x, y] = pivotOnScreen(squashedBillboard(b, 1.1, 0.9), sheet, 1.1, 0.9);
		expect(x).toBeCloseTo(0, 9);
		expect(y).toBeCloseTo(0, 9);
	});

	it("only ever adds floor clearance (a taller cell hangs lower), never moves a squashed one in depth", () => {
		const b = spriteBillboard(KNIGHT);
		expect(squashedBillboard(b, 1.15, 0.85).offsetZ).toBe(b.offsetZ);
		const tall = squashedBillboard(b, 0.9, 1.1);
		expect(tall.offsetZ > b.offsetZ).toBe(true);
		// the grown cell's floor clearance is what spriteBillboard gives a cell hanging that far below the feet
		const grown = spriteBillboard({ ...KNIGHT, frameH: KNIGHT.pivot.y + (KNIGHT.frameH - KNIGHT.pivot.y) * 1.1 });
		expect(tall.offsetZ).toBeCloseTo(grown.offsetZ, 9);
	});
});

describe("RollEdgeWatch", () => {
	it("gives no edge the first frame a player is seen", () => {
		const w = new RollEdgeWatch(2);
		expect(w.edge(0, 21, false)).toBe("none");
		expect(w.edge(1, 0, false)).toBe("none");
	});

	it("sees a roll start, its ticks counting down, and its end", () => {
		const w = new RollEdgeWatch(1);
		w.edge(0, 0, false);
		expect(w.edge(0, 21, false)).toBe("start");
		expect(w.edge(0, 18, false)).toBe("none");
		expect(w.edge(0, 1, false)).toBe("none");
		expect(w.edge(0, 0, false)).toBe("end");
		expect(w.edge(0, 0, false)).toBe("none");
	});

	it("sees a roll chained straight off the last as a new start", () => {
		const w = new RollEdgeWatch(1);
		w.edge(0, 3, false);
		expect(w.edge(0, 21, false)).toBe("start");
	});

	it("gives no edge to a dead player and none after a reset", () => {
		const w = new RollEdgeWatch(1);
		w.edge(0, 5, false);
		expect(w.edge(0, 0, true)).toBe("none");
		w.edge(0, 0, false);
		w.reset();
		expect(w.edge(0, 21, false)).toBe("none");
		expect(w.edge(5, 21, false)).toBe("none"); // out of range
	});
});

describe("SquashBook", () => {
	const out: SquashScale = { sx: 1, sy: 1 };

	it("starts a squash at its peak on the first frame after it", () => {
		const book = new SquashBook(4);
		book.setNow(1);
		expect(book.start(2, 7, "hit")).toBe(true);
		book.setNow(1.016);
		expect(book.lookInto(out, 2, 7, 1)).toEqual({ sx: 1.1, sy: 0.9 });
		book.setNow(1.016 + 0.035);
		const mid = book.lookInto(out, 2, 7, 1);
		expect(mid.sx > 1 && mid.sx < 1.1).toBe(true);
		book.setNow(1.016 + 0.07);
		expect(book.lookInto(out, 2, 7, 1)).toEqual({ sx: 1, sy: 1 });
	});

	it("is 1 x 1 for another actor in the slot and for an empty slot", () => {
		const book = new SquashBook(4);
		book.start(1, 7, "hit");
		expect(book.lookInto(out, 1, 8, 1)).toEqual({ sx: 1, sy: 1 });
		expect(book.lookInto(out, 0, 7, 1)).toEqual({ sx: 1, sy: 1 });
		expect(book.lookInto(out, 9, 7, 1)).toEqual({ sx: 1, sy: 1 });
	});

	it("lets a death cut a hit short, never a hit cut a death", () => {
		const book = new SquashBook(1);
		book.start(0, 3, "hit");
		book.lookInto(out, 0, 3, 1);
		expect(book.start(0, 3, "death")).toBe(true);
		expect(book.start(0, 3, "hit")).toBe(false);
		expect(book.lookInto(out, 0, 3, 1)).toEqual({ sx: 1, sy: 1 }); // the death's first frame (attack 0.3)
		book.setNow(0.03);
		expect(book.lookInto(out, 0, 3, 1).sx).toBeCloseTo(1.12, 9);
	});

	it("keeps a spawn over a hit, and lets the same priority replace (latest wins)", () => {
		const book = new SquashBook(1);
		book.start(0, 3, "spawn");
		expect(book.start(0, 3, "hit")).toBe(false);
		const players = new SquashBook(1);
		players.start(0, 1, "rollEnd");
		expect(players.start(0, 1, "rollStart")).toBe(true);
		expect(players.lookInto(out, 0, 1, 1)).toEqual({ sx: 1.15, sy: 0.85 });
	});

	it("restarts a hit at most every hitMinSec", () => {
		const book = new SquashBook(1);
		book.setNow(5);
		expect(book.start(0, 3, "hit")).toBe(true);
		book.setNow(5 + FEEL_SQUASH.hitMinSec / 2);
		expect(book.start(0, 3, "hit")).toBe(false);
		book.setNow(5 + FEEL_SQUASH.hitMinSec);
		expect(book.start(0, 3, "hit")).toBe(true);
	});

	it("clears every slot when the clock goes back (a new run)", () => {
		const book = new SquashBook(2);
		book.setNow(10);
		book.start(0, 3, "spawn");
		book.setNow(0);
		expect(book.lookInto(out, 0, 3, 1)).toEqual({ sx: 1, sy: 1 });
	});

	it("is 1 x 1 under reduced motion", () => {
		const book = new SquashBook(1);
		book.start(0, 3, "death");
		book.setNow(0.03);
		book.lookInto(out, 0, 3, 0);
		expect(out).toEqual({ sx: 1, sy: 1 });
	});
});
