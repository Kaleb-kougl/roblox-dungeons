// Minimap transform (docs/MINIMAP.md M4): under the play camera's 45 degree yaw, the world direction the Up input moves
// the player (shared/play's move mapping) lands straight up on the map and Right straight right; the view player maps
// to the panel centre; worldToMap / mapToWorld round trip within 1e-9; the grid image placed by its rotation puts every
// cell centre where worldToMap puts it.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import { gridToWorld } from "shared/dungeon";
import { EMPTY_INPUT, dequantizeInput } from "shared/sim";
import { DEFAULT_BINDINGS, mapDevicesToInput, type DeviceSnapshot } from "shared/play";
import {
	MINIMAP_VIEW,
	degToRad,
	gridCellToMap,
	gridImageLayout,
	isoBasis,
	mapToWorld,
	minimapBasis,
	worldToMap,
} from "shared/view";

const EPS = 1e-9;

/** The quantized world move of holding `keys` (and nothing else), as shared/play maps it. */
function moveOf(keys: ReadonlyArray<string>): { x: number; z: number } {
	const snap: DeviceSnapshot = {
		kbm: { keys: new Set(keys), mouseButtons: new Set() },
		pad: undefined,
		aimDevice: "none",
		pointerAimX: 0,
		pointerAimZ: 0,
	};
	const d = dequantizeInput(mapDevicesToInput(snap, { ...EMPTY_INPUT }));
	return { x: d.moveX, z: d.moveZ };
}

describe("minimap transform", () => {
	const b = minimapBasis(CAMERA_YAW_DEG);
	const ppt = MINIMAP_VIEW.pxPerTile;

	it("the Up / Right inputs move the player straight up / right on the map; Down / Left the other way", () => {
		const cx = 31.25;
		const cz = -7.5;
		const cases: ReadonlyArray<[ReadonlyArray<string>, number, number]> = [
			[DEFAULT_BINDINGS.kbm.moveUp, 0, -1],
			[DEFAULT_BINDINGS.kbm.moveRight, 1, 0],
			[DEFAULT_BINDINGS.kbm.moveDown, 0, 1],
			[DEFAULT_BINDINGS.kbm.moveLeft, -1, 0],
		];
		for (const [keys, du, dv] of cases) {
			const m = moveOf([keys[0]]);
			expect(math.abs(m.x) + math.abs(m.z) > 0.5).toBe(true);
			const p = worldToMap(b, cx + m.x, cz + m.z, cx, cz, ppt);
			const len = math.sqrt(p.u * p.u + p.v * p.v);
			// the quantized axis is 1/1000 accurate: the direction within 2e-3
			expect(math.abs(p.u / len - du) < 2e-3).toBe(true);
			expect(math.abs(p.v / len - dv) < 2e-3).toBe(true);
		}
	});

	it("matches the camera: map right / up are isoBasis right / up on the ground (pitch dropped)", () => {
		const iso = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		expect(b.rightX).toBeCloseTo(iso.right[0], 12);
		expect(b.rightZ).toBeCloseTo(iso.right[2], 12);
		const len = math.sqrt(iso.forward[0] * iso.forward[0] + iso.forward[2] * iso.forward[2]);
		expect(b.upX).toBeCloseTo(iso.forward[0] / len, 12);
		expect(b.upZ).toBeCloseTo(iso.forward[2] / len, 12);
		expect(b.rotationDeg).toBe(CAMERA_YAW_DEG);
	});

	it("the view player maps to the panel centre; a tile is pxPerTile pixels", () => {
		const p = worldToMap(b, 12.5, 40.25, 12.5, 40.25, ppt);
		expect(p.u).toBe(0);
		expect(p.v).toBe(0);
		const q = worldToMap(b, 13.5, 40.25, 12.5, 40.25, ppt);
		expect(math.sqrt(q.u * q.u + q.v * q.v)).toBeCloseTo(ppt, 12);
	});

	it("round trip worldToMap -> mapToWorld within 1e-9, for several yaws", () => {
		for (const yaw of [0, 45, 90, 135, -30, 200]) {
			const basis = minimapBasis(yaw);
			for (const [x, z] of [
				[0, 0],
				[17.3, -4.2],
				[-250, 611.75],
				[1023.5, 0.001],
			] as const) {
				const p = worldToMap(basis, x, z, 3.25, -9, 3);
				const w = mapToWorld(basis, p.u, p.v, 3.25, -9, 3);
				expect(math.abs(w.x - x) < EPS && math.abs(w.z - z) < EPS).toBe(true);
			}
		}
	});

	it("the grid image turned by its Rotation puts every cell centre where worldToMap does", () => {
		for (const yaw of [CAMERA_YAW_DEG, 0, 90, -30, 200]) {
			const basis = minimapBasis(yaw);
			const W = 37;
			const H = 23;
			const cx = 11.4;
			const cz = 15.8;
			const layout = gridImageLayout(basis, W, H, cx, cz, ppt);
			expect(layout.rotationDeg).toBe(yaw);
			expect([layout.width, layout.height]).toEqual([W * ppt, H * ppt]);
			for (const [gx, gy] of [
				[0, 0],
				[W - 1, 0],
				[0, H - 1],
				[W - 1, H - 1],
				[11, 16],
				[20, 3],
			] as const) {
				const viaImage = gridCellToMap(layout, gx, gy);
				const direct = worldToMap(basis, gridToWorld(gx), gridToWorld(gy), cx, cz, ppt);
				if (math.abs(viaImage.u - direct.u) > EPS || math.abs(viaImage.v - direct.v) > EPS)
					error(
						`yaw ${yaw} cell (${gx}, ${gy}): image (${viaImage.u}, ${viaImage.v}), direct (${direct.u}, ${direct.v})`,
					);
			}
		}
	});

	it("at the play yaw (45), world +x goes down-right on screen and world +z down-left (the clockwise Rotation)", () => {
		const px = worldToMap(b, 1, 0, 0, 0, 1);
		expect(px.u > 0 && px.v > 0).toBe(true);
		const pz = worldToMap(b, 0, 1, 0, 0, 1);
		expect(pz.u < 0 && pz.v > 0).toBe(true);
	});
});
