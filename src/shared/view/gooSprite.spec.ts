// Goo art on screen (docs/GOO_ART.md GA3): the floor sprite's timeline (land cell while young, then a hold variant,
// the disc's fade, no pop), the slot-derived variant / mirror, and the cover-the-hit size at the camera's pitch.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG } from "shared/config";
import { GOO_BULLET_RADIUS, SIM_DT, SLIME } from "shared/sim";
import {
	gooDecalLook,
	gooSpriteLook,
	gooSpritePlacement,
	gooSpriteSize,
	type GooLook,
	type GooSpriteLook,
} from "./variants";
import { GOO_ART_VIEW, GOO_VIEW } from "./variantsConfig";

const fresh = (): GooSpriteLook => ({ frame: "hold", variant: 0, mirror: false, transparency: 0 });
const TOTAL = SLIME.data.goo.life;
/** Just past a boundary (life arithmetic in float seconds). */
const EPS = 1e-6;
/** A slower bullet clock (the Hourglass steps enemy bullets by SIM_DT x a scale under 1). */
const SLOW = 0.5;

/** Ticks a puddle shows its land cell when its life runs down by SIM_DT x `scale` a tick. */
function landTicks(scale: number): number {
	const out = fresh();
	let ticks = 0;
	for (let t = 0; t < 1000; t++) {
		const lifeLeft = TOTAL - t * SIM_DT * scale;
		if (gooSpriteLook(lifeLeft, TOTAL, 0, out).frame !== "land") break;
		ticks++;
	}
	return ticks;
}

describe("gooSpriteLook (docs/GOO_ART.md GA3)", () => {
	it("config: land over the disc's pop window, the sim's hit radius and the camera pitch", () => {
		expect(GOO_ART_VIEW.landSec).toBe(GOO_VIEW.popSec);
		expect(GOO_ART_VIEW.hitRadius).toBe(GOO_BULLET_RADIUS);
		expect(GOO_ART_VIEW.cameraPitchDeg).toBe(CAMERA_PITCH_DEG);
	});

	it("shows the land cell only while age < landSec, then the hold cell to the end", () => {
		const out = fresh();
		expect(gooSpriteLook(TOTAL, TOTAL, 0, out).frame).toBe("land");
		expect(gooSpriteLook(TOTAL - GOO_ART_VIEW.landSec / 2, TOTAL, 0, out).frame).toBe("land");
		expect(gooSpriteLook(TOTAL - GOO_ART_VIEW.landSec - EPS, TOTAL, 0, out).frame).toBe("hold");
		expect(gooSpriteLook(TOTAL / 2, TOTAL, 0, out).frame).toBe("hold");
		expect(gooSpriteLook(0, TOTAL, 0, out).frame).toBe("hold");
		// the window is in bullet time: a longer life (the Hourglass's stretched one) lands for the same age
		expect(gooSpriteLook(2 * TOTAL - GOO_ART_VIEW.landSec / 2, 2 * TOTAL, 0, out).frame).toBe("land");
		expect(gooSpriteLook(2 * TOTAL - GOO_ART_VIEW.landSec - EPS, 2 * TOTAL, 0, out).frame).toBe("hold");
	});

	it("the Hourglass's slower bullet clock stretches the land window", () => {
		const normal = landTicks(1);
		expect(normal).toBe(math.ceil(GOO_ART_VIEW.landSec / SIM_DT - 1e-9));
		expect(landTicks(SLOW)).toBeGreaterThan(normal);
		expect(landTicks(SLOW)).toBe(math.ceil(GOO_ART_VIEW.landSec / (SIM_DT * SLOW) - 1e-9));
	});

	it("fades exactly as the disc does, with no pop (opaque from the first frame)", () => {
		const out = fresh();
		const disc: GooLook = { scale: 0, transparency: 0 };
		for (const lifeLeft of [TOTAL, TOTAL - 0.05, TOTAL / 2, GOO_VIEW.fadeSec, GOO_VIEW.fadeSec / 2, 0.1, 0]) {
			expect([lifeLeft, gooSpriteLook(lifeLeft, TOTAL, 3, out).transparency]).toEqual([
				lifeLeft,
				gooDecalLook(lifeLeft, TOTAL, disc).transparency,
			]);
		}
		expect(gooSpriteLook(TOTAL, TOTAL, 0, out).transparency).toBe(0);
		expect(gooSpriteLook(0, TOTAL, 0, out).transparency).toBe(1);
	});

	it("the same slot always gives the same variant and mirror, whatever its age", () => {
		const out = fresh();
		for (let slot = 0; slot < 16; slot++) {
			const first = gooSpriteLook(TOTAL, TOTAL, slot, out, 2);
			const v = first.variant;
			const m = first.mirror;
			for (const lifeLeft of [TOTAL - 0.2, TOTAL / 2, 0.2]) {
				const later = gooSpriteLook(lifeLeft, TOTAL, slot, out, 2);
				expect([slot, later.variant, later.mirror]).toEqual([slot, v, m]);
			}
		}
	});

	it("slots 0..3 give all four looks of two variants; one variant still mirrors both ways", () => {
		const out = fresh();
		const seen = new Set<string>();
		for (let slot = 0; slot < 4; slot++) {
			const l = gooSpriteLook(1, TOTAL, slot, out, 2);
			seen.add(`${l.variant}:${l.mirror}`);
		}
		expect(seen.size()).toBe(4);
		const mirrors = new Set<boolean>();
		for (let slot = 0; slot < 4; slot++) {
			const l = gooSpriteLook(1, TOTAL, slot, out, 1);
			expect(l.variant).toBe(0);
			mirrors.add(l.mirror);
		}
		expect(mirrors.size()).toBe(2);
		// a variant index never reaches the hold count
		for (let slot = 0; slot < 32; slot++) {
			expect(gooSpriteLook(1, TOTAL, slot, out, 3).variant < 3).toBe(true);
		}
	});
});

describe("gooSpriteSize / gooSpritePlacement (docs/GOO_ART.md GAD3 / GAD4)", () => {
	const sinPitch = math.sin(math.rad(CAMERA_PITCH_DEG));

	it("31 x 17 at radius 0.35, pitch 55: about 1.05 wide, 0.70 deep", () => {
		const s = gooSpriteSize(31, 17);
		expect(s.widthTiles).toBeCloseTo(1.0456, 3);
		expect(s.depthTiles).toBeCloseTo(0.7, 9);
		// the screen shows the art's own aspect: the depth stretched by 1 / sin(pitch)
		expect((s.depthTiles * sinPitch) / s.widthTiles).toBeCloseTo(17 / 31, 9);
	});

	it("the lit ellipse on screen covers the hit circle's on-screen ellipse, and touches it on one axis", () => {
		for (const [w, h] of [
			[31, 17],
			[24, 11],
			[20, 20],
			[10, 30],
		]) {
			const s = gooSpriteSize(w, h, GOO_BULLET_RADIUS, CAMERA_PITCH_DEG);
			const hitWide = 2 * GOO_BULLET_RADIUS;
			const hitTall = hitWide * sinPitch;
			const screenTall = s.depthTiles * sinPitch;
			expect([w, h, s.widthTiles >= hitWide - 1e-9, screenTall >= hitTall - 1e-9]).toEqual([w, h, true, true]);
			const tight = math.min(s.widthTiles - hitWide, screenTall - hitTall);
			expect(math.abs(tight) < 1e-9).toBe(true);
			// every point of the hit's screen ellipse lies inside the art's (concentric, axis-aligned)
			for (let k = 0; k < 16; k++) {
				const a = (k / 16) * 2 * math.pi;
				const x = (hitWide / 2) * math.cos(a);
				const y = (hitTall / 2) * math.sin(a);
				const inside = (x / (s.widthTiles / 2)) ** 2 + (y / (screenTall / 2)) ** 2;
				expect(inside <= 1 + 1e-9).toBe(true);
			}
		}
	});

	it("places the whole cell around the lit box: the pivot on the puddle, mirrored across", () => {
		const size = gooSpriteSize(31, 17);
		const centred = gooSpritePlacement(33, 19, 16.5, 9.5, 31, 17, size, false);
		expect(centred.widthTiles).toBeCloseTo((33 / 31) * size.widthTiles, 9);
		expect(centred.depthTiles).toBeCloseTo((19 / 17) * size.depthTiles, 9);
		expect([centred.rightTiles, centred.downTiles]).toEqual([0, 0]);
		// a lit box left of and above the cell centre: the cell centre lies right of and below the puddle
		const off = gooSpritePlacement(64, 64, 20, 30, 31, 17, size, false);
		expect(off.rightTiles).toBeCloseTo((12 * size.widthTiles) / 31, 9);
		expect(off.downTiles).toBeCloseTo((2 * size.depthTiles) / 17, 9);
		const mirrored = gooSpritePlacement(64, 64, 20, 30, 31, 17, size, true);
		expect(mirrored.rightTiles).toBeCloseTo(-off.rightTiles, 9);
		expect(mirrored.downTiles).toBe(off.downTiles);
	});
});
