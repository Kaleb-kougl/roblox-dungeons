// docs/COMBO.md CB6 / CB7: the combo row / meter drawing helpers and the floor shout's timeline.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import { degToRad, isoBasis } from "../iso";
import { COMBO_SHOUT, COMBO_VIEW } from "./comboConfig";
import {
	COMBO_DRAW,
	COMBO_SHOUT_DRAW,
	ComboShout,
	comboDropAt,
	comboBestRichText,
	comboDropText,
	comboMultRichText,
	comboShardAt,
	comboShardWidth,
	comboShineOffset,
	comboShoutText,
	floorAxes,
	richTextEscape,
	shoutCanvasSize,
	type ComboDropLook,
	type ComboShardLook,
} from "./comboDraw";

const STEP = 1 / 60;
const EPS = 1e-9;

function shard(): ComboShardLook {
	return { xScale: 0, dxPx: 0, dyPx: 0, rotationDeg: 0, transparency: 0 };
}

/** Runs a shout `sec` seconds; returns the opacities and slides seen. */
function run(s: ComboShout, sec: number, ducked = false, reduced = false): { op: number[]; slide: number[] } {
	const op: number[] = [];
	const slide: number[] = [];
	const frames = math.round(sec / STEP);
	for (let i = 0; i < frames; i++) {
		const l = s.frame(STEP, ducked, reduced);
		op.push(l.opacity);
		slide.push(l.slideTiles);
	}
	return { op, slide };
}

describe("combo shards", () => {
	it("start at the centre of their piece of the whole track, fly outward symmetrically, end faded", () => {
		const n = COMBO_VIEW.break.shards;
		const o = shard();
		for (let i = 0; i < n; i++) {
			comboShardAt(i, n, 0, o);
			expect(o.xScale).toBeCloseTo((i + 0.5) / n, 9);
			for (const v of [o.dxPx, o.dyPx, o.rotationDeg, o.transparency]) expect(v).toBeCloseTo(0, 9);
			const mirror = shard();
			comboShardAt(n - 1 - i, n, 0.7, mirror);
			comboShardAt(i, n, 0.7, o);
			expect(o.dxPx).toBeCloseTo(-mirror.dxPx, 9);
			expect(o.rotationDeg).toBeCloseTo(-mirror.rotationDeg, 9);
			expect(o.dyPx).toBeCloseTo(mirror.dyPx, 9);
			comboShardAt(i, n, 1, o);
			expect(o.transparency).toBe(1);
			expect(o.dyPx).toBeCloseTo(COMBO_DRAW.shards.fallPx - COMBO_DRAW.shards.risePx, 9);
			expect(math.abs(o.dxPx) <= COMBO_DRAW.shards.spreadPx + EPS).toBe(true);
		}
		// They rise first (y up is negative), then fall.
		comboShardAt(0, n, 0.1, o);
		expect(o.dyPx < 0).toBe(true);
		// Out of range progress clamps.
		comboShardAt(0, n, 2, o);
		expect(o.transparency).toBe(1);
	});

	it("tile the whole track edge to edge, whatever the fill was (a real break's fill is ~0)", () => {
		const n = COMBO_VIEW.break.shards;
		const w = comboShardWidth(n);
		expect(w).toBeCloseTo(1 / n, 9);
		expect(n * w).toBeCloseTo(1, 9);
		const o = shard();
		comboShardAt(0, n, 0, o);
		expect(o.xScale - w / 2).toBeCloseTo(0, 9);
		comboShardAt(n - 1, n, 0, o);
		expect(o.xScale + w / 2).toBeCloseTo(1, 9);
		expect(comboShardWidth(0)).toBe(0);
	});
});

describe("combo row helpers", () => {
	it("the shine band enters left of the label and leaves right of it", () => {
		const half = COMBO_DRAW.shine.bandWidth / 2;
		expect(comboShineOffset(0)).toBeCloseTo(-(0.5 + half), 9);
		expect(comboShineOffset(1)).toBeCloseTo(0.5 + half, 9);
		expect(comboShineOffset(0.5)).toBeCloseTo(0, 9);
		expect(comboShineOffset(-1)).toBeCloseTo(comboShineOffset(0), 9);
	});

	it("the crack's drop falls and fades into one reused look; texts", () => {
		const out: ComboDropLook = { fallPx: -1, transparency: -1 };
		expect(comboDropAt(0, false, out)).toBe(out);
		expect(out).toEqual({ fallPx: 0, transparency: 0 });
		expect(comboDropAt(1, false, out)).toEqual({ fallPx: COMBO_DRAW.dropFallPx, transparency: 1 });
		comboDropAt(0.5, false, out);
		expect(out.fallPx).toBeCloseTo(COMBO_DRAW.dropFallPx / 2, 9);
		expect(out.transparency).toBeCloseTo(0.5, 9);
		expect(comboDropAt(2, false, out)).toEqual({ fallPx: COMBO_DRAW.dropFallPx, transparency: 1 });
		expect(comboDropText("x1.2")).toBe("-x1.2");
		expect(comboShoutText("RAMPAGE")).toBe(`RAMPAGE${COMBO_SHOUT_DRAW.bang}`);
	});

	it("reduced motion: the crack's drop fades in place, never falls", () => {
		const out: ComboDropLook = { fallPx: -1, transparency: -1 };
		for (const u of [0, 0.25, 0.5, 1]) {
			comboDropAt(u, true, out);
			expect(out.fallPx).toBe(0);
			expect(out.transparency).toBeCloseTo(u, 9);
		}
	});

	it("the multiplier's RichText: escaped, struck through only while broken", () => {
		expect(comboMultRichText("x3.4", false)).toBe("x3.4");
		expect(comboMultRichText("x3.4", true)).toBe("<s>x3.4</s>");
		expect(richTextEscape(`a<b>&"c'`)).toBe("a&lt;b&gt;&amp;&quot;c&apos;");
		expect(comboMultRichText("<x>", true)).toBe("<s>&lt;x&gt;</s>");
	});

	it("the run-over best combo carries its tier name in its colour, nothing below x2", () => {
		expect(comboBestRichText("x3.4", "CARNAGE", "#ff2050")).toBe('x3.4 <font color="#ff2050">CARNAGE</font>');
		expect(comboBestRichText("x1.6", undefined, "#ff2050")).toBe("x1.6");
		expect(comboBestRichText("x3.4", "CARNAGE", "")).toBe("x3.4 CARNAGE");
		expect(comboBestRichText("x1.6", "", "#ff2050")).toBe("x1.6");
		expect(comboBestRichText("x2.0", "A&B", "#f88088")).toBe('x2.0 <font color="#f88088">A&amp;B</font>');
	});
});

describe("floor axes and the shout canvas", () => {
	it("screen-right and screen-up on the floor are unit, orthogonal and match the camera basis", () => {
		const a = floorAxes();
		const b = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		expect(a.rightX).toBeCloseTo(b.right[0], 9);
		expect(a.rightZ).toBeCloseTo(b.right[2], 9);
		const fl = math.sqrt(b.forward[0] * b.forward[0] + b.forward[2] * b.forward[2]);
		expect(a.upX).toBeCloseTo(b.forward[0] / fl, 9);
		expect(a.upZ).toBeCloseTo(b.forward[2] / fl, 9);
		expect(a.rightX * a.upX + a.rightZ * a.upZ).toBeCloseTo(0, 9);
		expect(a.upX * a.upX + a.upZ * a.upZ).toBeCloseTo(1, 9);
		// up-screen is away from the camera: the camera sits at -forward, so up . (focus - camera) > 0.
		expect(a.upX * b.forward[0] + a.upZ * b.forward[2] > 0).toBe(true);
	});

	it("the canvas undoes the pitch's foreshortening", () => {
		const [w, h] = shoutCanvasSize();
		expect(w).toBe(COMBO_SHOUT.widthTiles * COMBO_SHOUT_DRAW.canvasPxPerTile);
		const want = (w * COMBO_SHOUT.depthTiles * math.sin(degToRad(CAMERA_PITCH_DEG))) / COMBO_SHOUT.widthTiles;
		expect(math.abs(h - want) <= 0.5).toBe(true);
		const [, flat] = shoutCanvasSize(90);
		expect(flat).toBe(math.round((w * COMBO_SHOUT.depthTiles) / COMBO_SHOUT.widthTiles));
	});
});

describe("ComboShout", () => {
	it("idle until started; fades in, peaks at maxOpacity, fades out and ends at lifeSec", () => {
		const s = new ComboShout();
		expect(s.frame(STEP, false, false).active).toBe(false);
		s.start(2);
		expect(s.look.tier).toBe(2);
		const { op, slide } = run(s, COMBO_SHOUT.lifeSec + 0.1);
		let peak = 0;
		for (const o of op) peak = math.max(peak, o);
		expect(peak).toBeCloseTo(COMBO_SHOUT.maxOpacity, 1);
		expect(peak <= COMBO_SHOUT.maxOpacity + EPS).toBe(true);
		expect(op[0] > 0 && op[0] < peak).toBe(true);
		expect(op[op.size() - 1]).toBe(0);
		expect(s.look.active).toBe(false);
		// Slides up-screen monotonically, never past slideTiles.
		for (let i = 1; i < slide.size(); i++) {
			if (op[i] === 0) continue;
			expect(slide[i] >= slide[i - 1]).toBe(true);
			expect(slide[i] <= COMBO_SHOUT.slideTiles + EPS).toBe(true);
		}
	});

	it("reduced motion: no slide, the same fade", () => {
		const a = new ComboShout();
		const b = new ComboShout();
		a.start(1);
		b.start(1);
		const moving = run(a, COMBO_SHOUT.lifeSec / 2);
		const still = run(b, COMBO_SHOUT.lifeSec / 2, false, true);
		for (const x of still.slide) expect(x).toBe(0);
		expect(still.op).toEqual(moving.op);
		expect(moving.slide[moving.slide.size() - 1] > 0).toBe(true);
	});

	it("ducks to duckOpacity within duckSec while a bullet is in its box and comes back when clear", () => {
		const s = new ComboShout();
		s.start(3);
		run(s, COMBO_SHOUT_DRAW.fadeInSec);
		const ducked = run(s, COMBO_SHOUT.duckSec + STEP, true).op;
		expect(ducked[ducked.size() - 1]).toBeCloseTo(COMBO_SHOUT.duckOpacity, 9);
		// It eases, never jumps in one frame (duckSec spans several frames).
		expect(ducked[0] > COMBO_SHOUT.duckOpacity).toBe(true);
		const back = run(s, COMBO_SHOUT.duckSec + STEP, false).op;
		expect(back[back.size() - 1] > COMBO_SHOUT.duckOpacity + 0.1).toBe(true);
	});

	it("a new tier-up replaces a showing shout and restarts it; clear drops it", () => {
		const s = new ComboShout();
		s.start(1);
		run(s, COMBO_SHOUT.lifeSec / 2);
		s.start(2);
		expect(s.look.tier).toBe(2);
		expect(s.look.opacity).toBe(0);
		const after = run(s, COMBO_SHOUT.lifeSec - STEP * 2).op;
		expect(after[after.size() - 1] > 0).toBe(true);
		s.clear();
		expect(s.look.active).toBe(false);
		expect(s.frame(STEP, false, false).opacity).toBe(0);
	});
});
