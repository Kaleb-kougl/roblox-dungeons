// The guidance arrow's TutorialGuide (docs/TUTORIAL_ARROW.md A2) on small hand-made grids: straight with a clear
// walk; the corner (not the wall) round a bend and a pillar; hidden near the target, with the target on screen and in
// sight, and without a target; the hold against flicker; shortest-way damping across +-pi; the snap after a floor
// change; an unreachable target; field rebuilds (one per target tile, the boss throttled) and no per-frame garbage.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, clearWalk, walkBlocker, type Dungeon } from "shared/dungeon";
import { TUTORIAL_VIEW } from "shared/view/hud";
import { TutorialGuide, type GuideView, type TutorialMarker, type TutorialMarkerKind } from ".";

const V = TUTORIAL_VIEW;
const DT = 1 / 60;
/** Frames of the hold and of a full fade (nominal: the specs keep a 2-frame margin either side of them). */
const HOLD_FRAMES = math.round(V.arrowHoldSeconds / DT);
const FADE_FRAMES = math.round(V.arrowFadeSeconds / DT);
const MARGIN = 2;
/** Long enough to show (hold, fade) and settle the heading (10 time constants). */
const SETTLE_FRAMES = HOLD_FRAMES + FADE_FRAMES + 2 * MARGIN + math.ceil((10 * V.arrowTurnTau) / DT);

/** A bare grid from rows (row = grid y = world z): '#' WALL, '.' FLOOR, anything else VOID. */
function grid(rows: ReadonlyArray<string>): Dungeon {
	const W = rows[0].size();
	const cells: number[] = [];
	for (const row of rows)
		for (let x = 1; x <= W; x++) {
			const c = string.sub(row, x, x);
			cells.push(c === "#" ? TileType.WALL : c === "." ? TileType.FLOOR : TileType.VOID);
		}
	return { W, H: rows.size(), grid: cells } as unknown as Dungeon;
}

/** A W x H room of FLOOR inside a WALL border. */
function room(W: number, H: number): Dungeon {
	const rows: string[] = [];
	for (let y = 0; y < H; y++) {
		let row = "";
		for (let x = 0; x < W; x++) row += x === 0 || y === 0 || x === W - 1 || y === H - 1 ? "#" : ".";
		rows.push(row);
	}
	return grid(rows);
}

// prettier-ignore
const L_BEND = grid([
	"##########",
	"#........#",
	"#######..#",
	"#######..#",
	"#######..#",
	"##########",
]);

const PILLAR_ROOM = grid([
	"###########",
	"#.........#",
	"#.........#",
	"#...###...#",
	"#...###...#",
	"#...###...#",
	"#.........#",
	"#.........#",
	"###########",
]);

const POCKET = grid(["#############", "#.....#.....#", "#.....#.....#", "#############"]);

function marker(x: number, z: number, kind: TutorialMarkerKind = "door"): TutorialMarker {
	return { kind, x, z };
}

/** The guide's input, mutated between frames (one object: the specs allocate nothing per frame either). */
interface Frame {
	dungeon: Dungeon;
	target: TutorialMarker | undefined;
	px: number;
	pz: number;
	targetOnScreen: boolean;
	dt: number;
}

function frameOf(dungeon: Dungeon, px: number, pz: number, target: TutorialMarker | undefined): Frame {
	return { dungeon, target, px, pz, targetOnScreen: false, dt: DT };
}

/** `n` updates of `g` with `f`; the last view. */
function run(g: TutorialGuide, f: Frame, n: number): Readonly<GuideView> {
	let v = g.getView();
	for (let i = 0; i < n; i++) v = g.update(f);
	return v;
}

describe("TutorialGuide aim", () => {
	it("points straight at the target with a clear walk, orbiting arrowOrbitTiles from the player", () => {
		const g = new TutorialGuide(V);
		const v = run(g, frameOf(room(21, 21), 3, 10, marker(15, 10)), SETTLE_FRAMES);
		expect([v.visible, v.alpha, v.unreachable, v.pathTiles]).toEqual([true, 1, false, 12]);
		expect([v.aimX, v.aimZ]).toEqual([15, 10]);
		expect(v.heading).toBeCloseTo(math.pi / 2, 9); // +X
		expect(v.x).toBeCloseTo(3 + V.arrowOrbitTiles, 9);
		expect(v.z).toBeCloseTo(10, 9);
	});

	it("round a bend it points at the corner along the corridor, not crow-flies into the wall", () => {
		const g = new TutorialGuide(V);
		const v = run(g, frameOf(L_BEND, 2, 1, marker(8, 4)), SETTLE_FRAMES);
		expect(v.visible).toBe(true);
		// The farthest tile of the path ahead with a clear walk is the corner tile (7, 1): due east.
		expect([v.aimX, v.aimZ]).toEqual([7, 1]);
		expect(v.heading).toBeCloseTo(math.pi / 2, 6);
		// Crow-flies would aim at atan2(6, 3) through the wall.
		expect(clearWalk(walkBlocker(L_BEND), 2, 1, 8, 4, 0)).toBe(false);
		expect(clearWalk(walkBlocker(L_BEND), 2, 1, v.aimX, v.aimZ, 0.35)).toBe(true);
	});

	it("round a solid pillar it points past the pillar's side, at a point with a clear walk", () => {
		const g = new TutorialGuide(V);
		const f = frameOf(PILLAR_ROOM, 5, 1.2, marker(5, 7));
		const v = run(g, f, SETTLE_FRAMES);
		expect(v.visible).toBe(true);
		expect(clearWalk(walkBlocker(PILLAR_ROOM), f.px, f.pz, 5, 7, 0.35)).toBe(false);
		expect(clearWalk(walkBlocker(PILLAR_ROOM), f.px, f.pz, v.aimX, v.aimZ, 0.35)).toBe(true);
		// Off to one side (the pillar spans x 4-6), and forward (toward the target's row).
		expect(math.abs(v.aimX - 5) >= 2).toBe(true);
		expect(v.aimZ > f.pz).toBe(true);
		// The arrow itself stands on floor, not on the pillar.
		expect(PILLAR_ROOM.grid[math.floor(v.z + 0.5) * PILLAR_ROOM.W + math.floor(v.x + 0.5)]).toBe(TileType.FLOOR);
	});

	it("an unreachable target: straight-line heading, the unreachable flag, still shown when far", () => {
		const g = new TutorialGuide(V);
		const v = run(g, frameOf(POCKET, 2, 1, marker(10, 2)), SETTLE_FRAMES);
		expect([v.unreachable, v.pathTiles, v.visible]).toEqual([true, math.huge, true]);
		expect([v.aimX, v.aimZ]).toEqual([10, 2]);
		expect(v.heading).toBeCloseTo(math.atan2(8, 1), 6);
	});
});

describe("TutorialGuide show rule", () => {
	it("hides within arrowHideTiles of the target (after the hold, then the fade)", () => {
		const g = new TutorialGuide(V);
		const f = frameOf(room(24, 3), 2, 1, marker(18, 1));
		expect(run(g, f, SETTLE_FRAMES).alpha).toBe(1);
		f.px = 18 - V.arrowHideTiles; // exactly arrowHideTiles: hidden
		let v = run(g, f, HOLD_FRAMES - MARGIN);
		expect([v.pathTiles, v.alpha]).toEqual([V.arrowHideTiles, 1]); // still held
		v = run(g, f, 2 * MARGIN + FADE_FRAMES);
		expect([v.alpha, v.visible]).toEqual([0, false]);
		f.px = 18 - V.arrowHideTiles - 1;
		expect(run(g, f, SETTLE_FRAMES).visible).toBe(true);
	});

	it("hides with the target on screen and a clear walk; on screen but blocked (behind a pillar) it shows", () => {
		const g = new TutorialGuide(V);
		const f = frameOf(room(21, 21), 3, 10, marker(15, 10));
		f.targetOnScreen = true;
		for (let i = 0; i < SETTLE_FRAMES; i++) expect(g.update(f).visible).toBe(false);
		const h = new TutorialGuide(V);
		const blocked = frameOf(PILLAR_ROOM, 5, 1.2, marker(5, 7));
		blocked.targetOnScreen = true;
		expect(run(h, blocked, SETTLE_FRAMES).visible).toBe(true);
	});

	it("without a target it fades out at once (no hold) and keeps its last heading", () => {
		const g = new TutorialGuide(V);
		const f = frameOf(room(21, 21), 3, 10, marker(15, 10));
		const shown = run(g, f, SETTLE_FRAMES);
		const h = shown.heading;
		f.target = undefined;
		let v = g.update(f);
		expect(v.alpha < 1).toBe(true);
		v = run(g, f, FADE_FRAMES + MARGIN);
		expect([v.alpha, v.visible, v.pathTiles, v.unreachable]).toEqual([0, false, math.huge, false]);
		expect(v.heading).toBe(h);
		// Shown again: the hold first, then it fades in.
		f.target = marker(15, 10);
		expect(run(g, f, HOLD_FRAMES - MARGIN).visible).toBe(false);
		expect(run(g, f, 2 * MARGIN + FADE_FRAMES).alpha).toBe(1);
	});

	it("the hold stops flicker: an on-screen input alternating faster than arrowHoldSeconds never hides it", () => {
		const g = new TutorialGuide(V);
		const f = frameOf(room(21, 21), 3, 10, marker(15, 10));
		run(g, f, SETTLE_FRAMES);
		for (let i = 0; i < 240; i++) {
			f.targetOnScreen = i % 2 === 0;
			expect(g.update(f).alpha).toBe(1);
		}
		const flip = HOLD_FRAMES - MARGIN; // just under the hold
		for (let i = 0; i < 240; i++) {
			f.targetOnScreen = math.floor(i / flip) % 2 === 0;
			expect(g.update(f).alpha).toBe(1);
		}
		// A change that lasts does take effect.
		f.targetOnScreen = true;
		expect(run(g, f, HOLD_FRAMES + FADE_FRAMES + 2 * MARGIN).visible).toBe(false);
	});
});

describe("TutorialGuide heading", () => {
	it("damps toward the aim the shortest way, across +-pi (never swinging through 0)", () => {
		const g = new TutorialGuide(V);
		const f = frameOf(room(31, 31), 15, 15, marker(16, 4));
		const hA = math.atan2(1, -11);
		let v = run(g, f, SETTLE_FRAMES);
		expect(v.heading).toBeCloseTo(hA, 6);
		f.target = marker(14, 4);
		const hB = math.atan2(-1, -11);
		v = g.update(f);
		const k = 1 - math.exp(-DT / V.arrowTurnTau);
		const step = 2 * math.pi - (hA - hB); // the short way round, through pi
		let expected = hA + step * k;
		if (expected >= math.pi) expected -= 2 * math.pi;
		expect(v.heading).toBeCloseTo(expected, 9);
		for (let i = 0; i < SETTLE_FRAMES; i++) {
			v = g.update(f);
			expect(math.abs(v.heading) >= math.abs(hB) - 1e-9).toBe(true);
			expect(v.heading >= -math.pi && v.heading < math.pi).toBe(true);
		}
		expect(v.heading).toBeCloseTo(hB, 6);
	});

	it("snaps on the first shown frame, and after a floor change (a new dungeon object)", () => {
		const g = new TutorialGuide(V);
		const f = frameOf(room(21, 21), 3, 10, marker(15, 10));
		let v = g.update(f);
		while (!v.visible) v = g.update(f);
		expect(v.heading).toBe(math.atan2(12, 0));
		run(g, f, SETTLE_FRAMES);
		// Floor change: same layout, new object; the target now due -Z.
		f.dungeon = room(21, 21);
		f.target = marker(3, 2);
		v = g.update(f);
		expect([v.visible, v.alpha]).toEqual([false, 0]);
		let frames = 1;
		while (!v.visible && frames < SETTLE_FRAMES) {
			v = g.update(f);
			frames++;
		}
		expect(v.visible).toBe(true);
		expect(math.abs(v.heading)).toBeCloseTo(math.pi, 12); // no damping from the old floor's +X
		expect(v.x).toBeCloseTo(3, 9);
		expect(v.z).toBeCloseTo(10 - V.arrowOrbitTiles, 9);
	});
});

describe("TutorialGuide fields and garbage", () => {
	it("builds one field per target tile; a moving boss rebuilds at most every arrowFieldSeconds", () => {
		const g = new TutorialGuide(V);
		const f = frameOf(room(41, 21), 3, 10, marker(30, 10));
		run(g, f, 30);
		expect(g.fieldBuildCount()).toBe(1);
		// Same tile (the director re-resolves the marker every frame): no rebuild.
		f.target = marker(30.3, 9.8);
		run(g, f, 30);
		expect(g.fieldBuildCount()).toBe(1);
		// A non-boss target on a new tile: rebuilt that frame.
		f.target = marker(31, 10);
		g.update(f);
		expect(g.fieldBuildCount()).toBe(2);
		// The boss walking a tile every frame for one second.
		const seconds = 1;
		const frames = math.round(seconds / DT);
		for (let i = 0; i < frames; i++) {
			f.target = marker(10 + (i % 20), 5, "boss");
			g.update(f);
		}
		const bossBuilds = g.fieldBuildCount() - 2;
		expect(bossBuilds <= math.ceil(seconds / V.arrowFieldSeconds) + 1).toBe(true);
		expect(bossBuilds >= math.floor(seconds / V.arrowFieldSeconds)).toBe(true);
	});

	it("returns one reused view and makes no per-frame garbage in the steady state", () => {
		const g = new TutorialGuide(V);
		const f = frameOf(PILLAR_ROOM, 5, 1.2, marker(5, 7));
		const first = g.update(f);
		run(g, f, SETTLE_FRAMES);
		expect(g.update(f)).toBe(first);
		expect(g.getView()).toBe(first);
		const before = gcinfo();
		for (let i = 0; i < 3000; i++) {
			f.px = 2 + (i % 100) * 0.06; // walking about the top rows: string pulling every frame
			g.update(f);
		}
		const grownKb = gcinfo() - before;
		expect(grownKb < 16).toBe(true);
		expect(g.fieldBuildCount()).toBe(1);
	});
});
