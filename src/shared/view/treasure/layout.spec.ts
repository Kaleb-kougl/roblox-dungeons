// Where a vault's pieces go (docs/TREASURE.md TR7): in front of the chest, the placeholder cage's bars round its
// footprint (every side closed, its `dash` spacing), the floor texts' duck boxes and canvases, the plate's pip row.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG } from "shared/config";
import { PLACEHOLDER_MANIFEST, TREASURE_CAGE_ID, TREASURE_CHEST_ID, ThemePack } from "shared/theme";
import { degToRad } from "shared/view";
import {
	TREASURE_VIEW,
	cageBarOffsets,
	floorTextBoxAt,
	floorTextCanvas,
	forwardPoint,
	pipCentres,
	type FloorTextBox,
} from ".";

describe("vault layout", () => {
	it("puts points in front of the chest along its facing", () => {
		expect(forwardPoint(10.5, 4.5, 0, 1, 1.3)).toEqual([10.5, 5.8]);
		expect(forwardPoint(10.5, 4.5, -1, 0, 2)).toEqual([8.5, 4.5]);
	});

	it("closes the placeholder cage on all four sides at the bar's dash spacing", () => {
		const bars = cageBarOffsets(4, 2, 0.25, 0.75, 0);
		// 4 + 1 bars on the front and back rows (pitch 1 stud over 4 studs), 2 - 1 per side between them.
		expect(bars.size()).toBe(5 * 2 + 1 * 2);
		const xs = new Set<number>();
		for (const [x, z] of bars) {
			expect(math.abs(x) === 2 || math.abs(z) === 1).toBe(true);
			xs.add(x);
		}
		expect(xs.has(-2) && xs.has(2) && xs.has(0)).toBe(true);
		expect(cageBarOffsets(0, 0, 0.25, 0.75, 0).size()).toBe(0);
		expect(cageBarOffsets(4, 2, 0, 0, 0).size()).toBe(0);
	});

	it("builds the placeholder pack's cage round its chest with bars on every side", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => {} });
		const chest = pack.treasurePiece(TREASURE_CHEST_ID).placeholder.size;
		const bar = pack.treasurePiece(TREASURE_CAGE_ID).placeholder;
		expect(bar.dash !== undefined).toBe(true);
		const bars = cageBarOffsets(chest[0], chest[2], bar.dash!.length, bar.dash!.gap, TREASURE_VIEW.cageMarginStuds);
		expect(bars.size() >= 8).toBe(true);
		// The bars stand over the chest (taller) and outside its footprint.
		expect(bar.size[1] > chest[1]).toBe(true);
		for (const [x, z] of bars) {
			expect(math.abs(x) > chest[0] / 2 || math.abs(z) > chest[2] / 2).toBe(true);
		}
	});

	it("fills a floor text's duck box and sizes its canvas for the camera's pitch", () => {
		const box: FloorTextBox = { x: 0, z: 0, rightX: 0, rightZ: 0, halfWidth: 0, halfDepth: 0 };
		floorTextBoxAt(box, 3, 4, 1, 0, 2.6, 0.9);
		expect(box).toEqual({ x: 3, z: 4, rightX: 1, rightZ: 0, halfWidth: 1.3, halfDepth: 0.45 });
		const [w, h] = floorTextCanvas(2.6, 0.9);
		expect(w).toBe(math.round(2.6 * TREASURE_VIEW.plate.canvasPxPerTile));
		expect(h).toBe(math.round((w * 0.9 * math.sin(degToRad(CAMERA_PITCH_DEG))) / 2.6));
	});

	it("centres the plate's pip row", () => {
		expect(pipCentres(1, 20, 10, 200)).toEqual([0.5]);
		const three = pipCentres(3, 20, 10, 200);
		expect(three.size()).toBe(3);
		expect(three[1]).toBeCloseTo(0.5, 9);
		expect(three[2] - three[1]).toBeCloseTo(30 / 200, 9);
		expect(pipCentres(0, 20, 10, 200)).toEqual([]);
	});
});
