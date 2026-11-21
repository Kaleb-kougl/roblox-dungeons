/**
 * The PARRY! floor flash, drawn (docs/GRAZE_PARRY.md GP7, GPD5 / GPD6). shared/view/fx NearMissDirector decides WHEN a
 * flash shows and its pop / fade / count (ParryFlash); the client's ParryFlashController paints it with the combo
 * shout's construction (CD9: a SurfaceGui on a thin floor Part under every bullet, telegraph, marking, effect and
 * body; COMBO_SHOUT's box, canvas and layer) and these small pure pieces:
 *   - where its centre is: NEAR_MISS_VIEW.flash.offsetTiles screen-DOWN of the guarding player's feet (the combo shout
 *     stands COMBO_SHOUT.offsetTiles screen-UP and slides further up, so the two never overlap);
 *   - how much of the shout's box its text fills: scale x pop / popScale (the view player's text fills the box at the
 *     pop's peak and 1 / popScale of it at rest; a teammate's is flash.teammateScale of that), which is also the
 *     duck box's share (shoutBoxAt's sizeScale), so the duck test follows the drawn text;
 *   - its opacity: the shout's cap x the flash's fade, never above the duck ceiling (ShoutDuck, CD9's numbers);
 *   - its label: `fx.parry.text`, or `fx.parry.count` ("{text} x{n}": "PARRY! x5") once the guard erased
 *     flash.countFrom or more.
 * Presentation only.
 *
 * @module
 */
import { TILE_SIZE } from "shared/sim";
import type { StringVars } from "shared/theme";
import { NEAR_MISS_VIEW } from "shared/view/fx";
import { COMBO_SHOUT } from "./comboConfig";
import type { FloorAxes } from "./comboDraw";

/** The flash's theme strings (required: the contract's NEAR_MISS_STRING_KEYS, same order). */
export const PARRY_FLASH_STRINGS = {
	/** "PARRY!" */
	text: "fx.parry.text",
	/** "x{n}": `n` = the guard's erase count. */
	count: "fx.parry.count",
} as const;

/** The flash's drawing: its Workspace folder and its colour role (the rest is COMBO_SHOUT / COMBO_SHOUT_DRAW's). */
export const PARRY_FLASH_DRAW = {
	folderName: "KV_ParryFlash",
	role: "nearMiss.parry",
} as const;

/**
 * Studio check aid (CLAUDE.md working agreement: off by default). Set the Workspace string attribute `attribute` to a
 * whole number n >= 1: every CHANGE to it forces one PARRY! flash of n erases on the view player of a run on the next frame
 * (drawn only: no sound, no sparks, no freeze; nothing under the stage cover or after run over). Absent / anything else: nothing.
 */
export const PARRY_DEBUG = {
	attribute: "KV_ParryDebug",
} as const;

/** A floor point in sim units. Mutable, reused. */
export interface ParryFlashPoint {
	x: number;
	z: number;
}

/**
 * Fills `out` with the flash's centre: NEAR_MISS_VIEW.flash.offsetTiles screen-down of the feet at (feetX, feetZ), i.e.
 * along minus the camera's floor up-screen axis (floorAxes; the combo shout goes along plus it).
 */
export function parryFlashCentre(out: ParryFlashPoint, feetX: number, feetZ: number, axes: FloorAxes): ParryFlashPoint {
	const down = NEAR_MISS_VIEW.flash.offsetTiles * TILE_SIZE;
	out.x = feetX - axes.upX * down;
	out.z = feetZ - axes.upZ * down;
	return out;
}

/**
 * The share (0..1) of the shout's box the flash's text fills: scale x pop / flash.popScale, so the view player's text
 * fills the box at the pop's peak (pop = popScale) and 1 / popScale of it at rest; never above the box (the SurfaceGui
 * clips at its canvas).
 */
export function parryFlashSize(scale: number, pop: number): number {
	const p = NEAR_MISS_VIEW.flash.popScale;
	return math.clamp((scale * pop) / p, 0, 1);
}

/** The flash's opacity: COMBO_SHOUT.maxOpacity x `fade`, never above the duck ceiling (ShoutDuck) or below 0. */
export function parryFlashOpacity(fade: number, ceiling: number): number {
	return math.max(0, math.min(COMBO_SHOUT.maxOpacity * math.clamp(fade, 0, 1), ceiling));
}

/** What parryFlashLabel reads of a theme pack (ThemePack fits as is). */
export interface ParryFlashStrings {
	str(key: string, vars?: StringVars): string;
}

/** The flash's label: "PARRY!", or "PARRY! x5" when `showCount` (ParryFlash.showCount; `count` its erases). */
export function parryFlashLabel(strings: ParryFlashStrings, count: number, showCount: boolean): string {
	const text = strings.str(PARRY_FLASH_STRINGS.text);
	if (!showCount) return text;
	return strings.str(PARRY_FLASH_STRINGS.count, { text, n: count });
}
