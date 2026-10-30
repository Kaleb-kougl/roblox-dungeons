// docs/GRAZE_PARRY.md GP7: the PARRY! floor flash's pure drawing pieces (placement, size, opacity, label) and the
// shared CD9 duck ceiling (ShoutDuck) the combo shout now uses too.
import { describe, expect, it } from "@rbxts/jest-globals";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import { TILE_SIZE } from "shared/sim";
import { NEAR_MISS_STRING_KEYS, PLACEHOLDER_MANIFEST, REQUIRED_STRING_KEYS, ThemePack } from "shared/theme";
import { VALE_MANIFEST } from "shared/theme/packs/vale";
import { NEAR_MISS_VIEW } from "shared/view/fx";
import { degToRad, isoBasis } from "../iso";
import { COMBO_SHOUT, COMBO_VIEW } from "./comboConfig";
import { ShoutDuck, floorAxes } from "./comboDraw";
import { shoutBoxAt, type ShoutBox } from "./combo";
import {
	PARRY_FLASH_DRAW,
	PARRY_FLASH_STRINGS,
	parryFlashCentre,
	parryFlashLabel,
	parryFlashOpacity,
	parryFlashSize,
} from "./parryFlash";

const quiet = (): void => {};
const STEP = 1 / 60;
const F = NEAR_MISS_VIEW.flash;

function box(): ShoutBox {
	return { x: 0, z: 0, rightX: 0, rightZ: 0, halfWidth: 0, halfDepth: 0 };
}

describe("parryFlashCentre", () => {
	it("is flash.offsetTiles screen-down of the feet: opposite the combo shout's up-screen", () => {
		const a = floorAxes();
		const c = parryFlashCentre({ x: 0, z: 0 }, 10, -4, a);
		const dx = c.x - 10;
		const dz = c.z + 4;
		expect(math.sqrt(dx * dx + dz * dz)).toBeCloseTo(F.offsetTiles * TILE_SIZE, 9);
		// Along minus up-screen, nothing along screen-right.
		expect(dx * a.upX + dz * a.upZ).toBeCloseTo(-F.offsetTiles * TILE_SIZE, 9);
		expect(dx * a.rightX + dz * a.rightZ).toBeCloseTo(0, 9);
		// Screen-down is toward the camera: its floor offset points against the camera's forward.
		const b = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
		expect(dx * b.forward[0] + dz * b.forward[2] < 0).toBe(true);
	});

	it("never overlaps the combo shout's box, even after its slide and with both at full size", () => {
		const down = F.offsetTiles;
		const up = COMBO_SHOUT.offsetTiles;
		// Nearest edges along the up-screen axis (tiles): the flash's top edge vs the shout's bottom edge (no slide).
		expect(-down + COMBO_SHOUT.depthTiles / 2 < up - COMBO_SHOUT.depthTiles / 2).toBe(true);
	});

	it("fills and returns `out`", () => {
		const out = { x: 1, z: 2 };
		expect(parryFlashCentre(out, 0, 0, floorAxes())).toBe(out);
	});
});

describe("parryFlashSize", () => {
	it("fills the box at the pop's peak and 1 / popScale of it at rest; a teammate's is teammateScale of that", () => {
		expect(parryFlashSize(1, F.popScale)).toBe(1);
		expect(parryFlashSize(1, 1)).toBeCloseTo(1 / F.popScale, 12);
		expect(parryFlashSize(F.teammateScale, 1)).toBeCloseTo(F.teammateScale / F.popScale, 12);
		expect(parryFlashSize(F.teammateScale, F.popScale)).toBeCloseTo(F.teammateScale, 12);
	});

	it("is clamped to 0..1", () => {
		expect(parryFlashSize(2, F.popScale)).toBe(1);
		expect(parryFlashSize(0, 1)).toBe(0);
		expect(parryFlashSize(-1, 1)).toBe(0);
	});

	it("scales the duck box with the drawn text (shoutBoxAt's sizeScale; 1 is the combo shout's box exactly)", () => {
		const full = shoutBoxAt(box(), 0, 0, 1, 0);
		const same = shoutBoxAt(box(), 0, 0, 1, 0, 1);
		expect(same.halfWidth).toBe(full.halfWidth);
		expect(same.halfDepth).toBe(full.halfDepth);
		expect(full.halfWidth).toBe((COMBO_SHOUT.widthTiles * TILE_SIZE) / 2);
		const k = parryFlashSize(1, 1);
		const small = shoutBoxAt(box(), 0, 0, 1, 0, k);
		expect(small.halfWidth).toBeCloseTo(full.halfWidth * k, 12);
		expect(small.halfDepth).toBeCloseTo(full.halfDepth * k, 12);
	});
});

describe("parryFlashOpacity", () => {
	it("is the shout's cap x fade, under the duck ceiling", () => {
		expect(parryFlashOpacity(1, COMBO_SHOUT.maxOpacity)).toBe(COMBO_SHOUT.maxOpacity);
		expect(parryFlashOpacity(0.5, COMBO_SHOUT.maxOpacity)).toBeCloseTo(COMBO_SHOUT.maxOpacity * 0.5, 12);
		expect(parryFlashOpacity(1, COMBO_SHOUT.duckOpacity)).toBe(COMBO_SHOUT.duckOpacity);
		expect(parryFlashOpacity(0, COMBO_SHOUT.maxOpacity)).toBe(0);
	});

	it("never exceeds COMBO_SHOUT.maxOpacity (55 %) or goes below 0", () => {
		expect(parryFlashOpacity(3, 1)).toBe(COMBO_SHOUT.maxOpacity);
		expect(parryFlashOpacity(-1, 1)).toBe(0);
		expect(parryFlashOpacity(1, -1)).toBe(0);
	});
});

describe("ShoutDuck", () => {
	it("starts and resets at maxOpacity", () => {
		const d = new ShoutDuck();
		expect(d.value()).toBe(COMBO_SHOUT.maxOpacity);
		d.step(1, true);
		expect(d.value()).toBe(COMBO_SHOUT.duckOpacity);
		d.reset();
		expect(d.value()).toBe(COMBO_SHOUT.maxOpacity);
	});

	it("eases to duckOpacity over duckSec while ducked and back up when clear", () => {
		const d = new ShoutDuck();
		const frames = math.ceil(COMBO_SHOUT.duckSec / STEP);
		let v = 0;
		for (let i = 0; i < frames; i++) v = d.step(STEP, true);
		expect(v).toBeCloseTo(COMBO_SHOUT.duckOpacity, 9);
		const first = d.step(STEP, false);
		expect(first > COMBO_SHOUT.duckOpacity).toBe(true);
		for (let i = 0; i < frames; i++) v = d.step(STEP, false);
		expect(v).toBeCloseTo(COMBO_SHOUT.maxOpacity, 9);
	});

	it("clamps a long frame to COMBO_VIEW.maxFrameDtSec and a negative one to 0", () => {
		const a = new ShoutDuck();
		const b = new ShoutDuck();
		a.step(10, true);
		b.step(COMBO_VIEW.maxFrameDtSec, true);
		expect(a.value()).toBe(b.value());
		const c = new ShoutDuck();
		expect(c.step(-1, true)).toBe(COMBO_SHOUT.maxOpacity);
	});
});

describe("parryFlashLabel and the flash's theme bits", () => {
	it("reads PARRY!, then PARRY! xN once showCount", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: quiet });
		expect(parryFlashLabel(pack, 1, false)).toBe("PARRY!");
		expect(parryFlashLabel(pack, 2, false)).toBe("PARRY!");
		expect(parryFlashLabel(pack, 5, true)).toBe("PARRY! x5");
		expect(parryFlashLabel(pack, 12, true)).toBe("PARRY! x12");
	});

	it("uses the contract's required NEAR_MISS_STRING_KEYS (in order), present in both bundled packs", () => {
		const keys = [PARRY_FLASH_STRINGS.text, PARRY_FLASH_STRINGS.count];
		expect(keys).toEqual([...NEAR_MISS_STRING_KEYS]);
		for (const k of keys) expect([k, REQUIRED_STRING_KEYS.includes(k)]).toEqual([k, true]);
		for (const manifest of [PLACEHOLDER_MANIFEST, VALE_MANIFEST]) {
			const pack = new ThemePack(manifest, { warn: quiet });
			for (const k of keys) expect([k, pack.hasString(k)]).toEqual([k, true]);
			// The colour role exists (color() would warn / fall back otherwise).
			expect(typeOf(pack.color(PARRY_FLASH_DRAW.role))).toBe("Color3");
		}
	});
});
