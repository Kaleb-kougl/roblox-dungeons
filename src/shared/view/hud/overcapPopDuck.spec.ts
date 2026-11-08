// docs/BUILDS_V2.md BV11d: the overcap pops' bullet duck (Studio checklist 10, "never over a boss bullet"): the floor
// box a pop covers on screen and the opacity it drops to while an enemy bullet is under it.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import { TILE_SIZE } from "shared/sim";
import {
	BUILDS_V2_FX,
	FX_VIEW,
	SCORE_POP_BASE_PX,
	SCORE_POP_GLYPH_PX,
	SCORE_POP_LIFE,
	overcapPopRise,
	scorePopAlpha,
} from "shared/view/fx";
import { degToRad, dot, isoBasis, type Vec3 } from "../iso";
import type { ShoutBox, ShoutBullets } from "./combo";
import { OVERCAP_POP_DUCK, overcapPopBox, overcapPopDucked, overcapPopOpacity } from "./overcapPopDuck";

class FakeBullets implements ShoutBullets {
	readonly xs: number[] = [];
	readonly zs: number[] = [];
	readonly visible: boolean[] = [];
	private readonly pos = { x: 0, z: 0 };
	add(x: number, z: number, visible = true): void {
		this.xs.push(x);
		this.zs.push(z);
		this.visible.push(visible);
	}
	highWater(): number {
		return this.xs.size();
	}
	isVisible(i: number): boolean {
		return this.visible[i];
	}
	positionAt(i: number): Readonly<{ x: number; z: number }> {
		this.pos.x = this.xs[i];
		this.pos.z = this.zs[i];
		return this.pos;
	}
}

function emptyBox(): ShoutBox {
	return { x: 0, z: 0, rightX: 0, rightZ: 0, halfWidth: 0, halfDepth: 0 };
}

/** Render px -> sim units. */
const PX = (FX_VIEW.pxStuds * TILE_SIZE) / STUDS_PER_TILE;
const GLYPH_H = SCORE_POP_GLYPH_PX.h * BUILDS_V2_FX.overcap.scale;
const GLYPH_W = SCORE_POP_GLYPH_PX.w * BUILDS_V2_FX.overcap.scale;

describe("overcapPopBox", () => {
	it("centres the box on the floor point the pop's billboard covers on screen", () => {
		const basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		for (const rise of [0, 12, 30]) {
			const box = overcapPopBox(emptyBox(), 3, -2, 4, rise);
			const height = (SCORE_POP_BASE_PX + BUILDS_V2_FX.overcap.liftPx + rise + GLYPH_H / 2) * PX;
			const pop: Vec3 = [3, height, -2];
			const floor: Vec3 = [box.x, 0, box.z];
			expect(dot(floor, basis.right)).toBeCloseTo(dot(pop, basis.right), 6);
			expect(dot(floor, basis.up)).toBeCloseTo(dot(pop, basis.up), 6);
		}
	});

	it("reads along the screen's right axis and sizes the box to the label", () => {
		const box = overcapPopBox(emptyBox(), 0, 0, 5, 0);
		const basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		expect(box.rightX).toBeCloseTo(basis.right[0], 9);
		expect(box.rightZ).toBeCloseTo(basis.right[2], 9);
		expect(box.halfWidth).toBeCloseTo((5 * GLYPH_W * PX) / 2, 9);
		// Foreshortened by the pitch: the floor depth that covers half a glyph's height on screen.
		expect(box.halfDepth * math.sin(degToRad(CAMERA_PITCH_DEG))).toBeCloseTo((GLYPH_H * PX) / 2, 9);
		// An empty label still has one glyph's width.
		expect(overcapPopBox(emptyBox(), 0, 0, 0, 0).halfWidth).toBeCloseTo((GLYPH_W * PX) / 2, 9);
	});

	it("moves screen-up as the pop rises", () => {
		const low = overcapPopBox(emptyBox(), 0, 0, 3, 0);
		const high = overcapPopBox(emptyBox(), 0, 0, 3, overcapPopRise(0.8, 1));
		const basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		expect(dot([high.x, 0, high.z], basis.up)).toBeGreaterThan(dot([low.x, 0, low.z], basis.up));
	});
});

describe("overcapPopDucked", () => {
	it("ducks for an enemy bullet under the pop, not for one at the boss's feet or an invisible one", () => {
		const box = overcapPopBox(emptyBox(), 10, 10, 4, 0);
		const under = new FakeBullets();
		under.add(box.x, box.z);
		expect(overcapPopDucked(box, under)).toBe(true);
		// Just inside the margin along the label's reading axis.
		const edge = new FakeBullets();
		const d = box.halfWidth + OVERCAP_POP_DUCK.marginTiles * TILE_SIZE - 0.01;
		edge.add(box.x + box.rightX * d, box.z + box.rightZ * d);
		expect(overcapPopDucked(box, edge)).toBe(true);
		const feet = new FakeBullets();
		feet.add(10, 10);
		expect(overcapPopDucked(box, feet)).toBe(false);
		const hidden = new FakeBullets();
		hidden.add(box.x, box.z, false);
		expect(overcapPopDucked(box, hidden)).toBe(false);
		expect(overcapPopDucked(box, new FakeBullets())).toBe(false);
	});
});

describe("overcapPopOpacity", () => {
	it("is the score pops' alpha, a teammate's at teammateOpacity, ducked at the duck opacity", () => {
		expect(overcapPopOpacity(0.1, true, false)).toBe(scorePopAlpha(0.1));
		expect(overcapPopOpacity(0.1, false, false)).toBeCloseTo(BUILDS_V2_FX.teammateOpacity, 9);
		expect(overcapPopOpacity(0.1, true, true)).toBeCloseTo(OVERCAP_POP_DUCK.opacity, 9);
		expect(overcapPopOpacity(0.1, false, true)).toBeCloseTo(
			BUILDS_V2_FX.teammateOpacity * OVERCAP_POP_DUCK.opacity,
			9,
		);
		expect(overcapPopOpacity(SCORE_POP_LIFE, true, false)).toBe(0);
		expect(overcapPopOpacity(SCORE_POP_LIFE - 0.05, true, false)).toBeLessThan(1);
	});
});
