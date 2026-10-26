/**
 * Depth profile (docs/DECOR.md Phase 2 part 1, task R8): how a floor's decoration changes with depth. Pure; the decor
 * plan (./decorPlan.ts) applies it under the R3 rules, as thinning (the flat clutter share), swaps (whole vs broken
 * columns and wall segments, lit vs dark torches) and re-weights (which clutter a full room keeps). It never touches a
 * Forge param (`decorDensity` included): that would move the Forge's rng stream and every endless layout.
 *
 * Bands go by endless floor (DECOR_DEPTH: kept 1-4, worn 5-9, ruined 10-14, abyss 15+), so every co-op client and
 * the replay viewer see the same floor. M1 and the tutorial plan with floor 1 (kept).
 *
 * Contrast (the darkest-band check): enemy bullets are self-lit Neon, so a band's lower ambient light darkens the floor
 * and walls they fly over, never the bullet. `decorBandContrastReport` checks the enemy bullet against every biome's
 * floor and wall at a band's light multiplier (the validator's 3:1 rule, MIN_ENEMY_BULLET_CONTRAST); the spec runs it
 * for every bundled pack at every band. The enemy outline (enemy outline plan O1) is self-lit too (a Highlight rim, a
 * baked sprite rim drawn unlit), so the same report checks `enemyOutline` (DECOR_BAND_CONTRAST_CHECKS).
 */
import {
	BIOMES,
	MIN_ENEMY_BULLET_CONTRAST,
	MIN_ENEMY_OUTLINE_CONTRAST,
	contrastRatio,
	isHexColor,
	parseHex,
	toHex,
	type BiomeId,
	type ColorRole,
} from "shared/theme";
import type { ThemeKey } from "shared/dungeon";
import { DECOR_DEPTH, type DecorDepthBand } from "./config";

/** A floor's resolved depth profile. Every share is in [0, 1]. */
export interface DecorProfile {
	/** Index into DECOR_DEPTH.bands. */
	readonly band: number;
	readonly bandName: string;
	readonly floor: number;
	/** The run's Depth (state.endless.depth: 1 + boss kills) when the floor was planned; carried for the director. */
	readonly depth: number;
	readonly themeKey: ThemeKey;
	readonly biome: BiomeId;
	/** Flat clutter cap per room, share of its floor tiles (the plan never goes above MAX_DECOR_SHARE). */
	readonly flatShare: number;
	readonly columnBrokenShare: number;
	readonly wallBrokenShare: number;
	readonly clutterWeight: number;
	readonly litTorchShare: number;
	/** Ambient light multiplier (and ambient particle rate, R9). */
	readonly light: number;
}

/** The band index of endless floor `floor` (the last band whose fromFloor <= floor; floors below 1 are kept). */
export function decorBandIndex(floor: number): number {
	const bands = DECOR_DEPTH.bands;
	let out = 0;
	for (let i = 0; i < bands.size(); i++) if (floor >= bands[i].fromFloor) out = i;
	return out;
}

/** The biome a Forge theme is drawn as (BIOMES: ancient -> biome.1, ...). */
export function biomeOfTheme(themeKey: ThemeKey): BiomeId {
	const b = BIOMES.find((x) => x.forgeTheme === themeKey);
	return b !== undefined ? b.id : BIOMES[0].id;
}

/**
 * The decor profile of endless floor `floor` at the run's Depth `depth`, for a floor of Forge theme `themeKey`.
 * `forceBand` (KV_DecorBand in Studio) replaces the floor's band; out-of-range values are clamped.
 */
export function decorProfile(floor: number, depth: number, themeKey: ThemeKey, forceBand?: number): DecorProfile {
	const bands = DECOR_DEPTH.bands;
	const band =
		forceBand !== undefined ? math.clamp(math.floor(forceBand), 0, bands.size() - 1) : decorBandIndex(floor);
	const b: DecorDepthBand = bands[band];
	return {
		band,
		bandName: b.name,
		floor,
		depth,
		themeKey,
		biome: biomeOfTheme(themeKey),
		flatShare: math.clamp(b.flatShare, 0, 1),
		columnBrokenShare: math.clamp(b.columnBrokenShare, 0, 1),
		wallBrokenShare: math.clamp(b.wallBrokenShare, 0, 1),
		clutterWeight: math.max(b.clutterWeight, 0),
		litTorchShare: math.clamp(b.litTorchShare, 0, 1),
		light: math.clamp(b.light, 0, 1),
	};
}

/** The weight of flat kind `kind` when profile `p` thins a full room (DECOR_DEPTH.clutterKinds get clutterWeight). */
export function flatKindWeight(p: DecorProfile, kind: string): number {
	return DECOR_DEPTH.clutterKinds.includes(kind) ? p.clutterWeight : 1;
}

/** The darkest band's index (lowest light multiplier; the first on a tie). */
export function darkestDecorBand(): number {
	const bands = DECOR_DEPTH.bands;
	let out = 0;
	for (let i = 1; i < bands.size(); i++) if (bands[i].light < bands[out].light) out = i;
	return out;
}

const CHANNEL_MAX = 255;
const SRGB_LINEAR_KNEE = 0.04045;
const SRGB_LINEAR_SLOPE = 12.92;
const SRGB_OUT_KNEE = 0.0031308;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;

function toLinear(c: number): number {
	const s = c / CHANNEL_MAX;
	return s <= SRGB_LINEAR_KNEE ? s / SRGB_LINEAR_SLOPE : ((s + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_GAMMA;
}

function fromLinear(l: number): number {
	const s = l <= SRGB_OUT_KNEE ? l * SRGB_LINEAR_SLOPE : SRGB_SCALE * l ** (1 / SRGB_GAMMA) - SRGB_OFFSET;
	return s * CHANNEL_MAX;
}

/**
 * `hex` lit by `light` (0..1) instead of 1: each channel scaled in linear light (what a dimmer ambient does to an
 * unlit surface), back to sRGB. Its relative luminance is `light` times the original's (to rounding).
 */
export function dimHex(hex: string, light: number): string {
	const rgb = parseHex(hex);
	if (rgb === undefined) return hex;
	const k = math.clamp(light, 0, 1);
	return toHex({
		r: fromLinear(toLinear(rgb.r) * k),
		g: fromLinear(toLinear(rgb.g) * k),
		b: fromLinear(toLinear(rgb.b) * k),
	});
}

/** A self-lit colour role drawn over the floors and walls, and the WCAG ratio it must keep against them. */
export interface DecorBandContrastCheck {
	readonly role: ColorRole;
	readonly min: number;
}

/** The enemy bullet (MIN_ENEMY_BULLET_CONTRAST): decorBandContrastReport's default check. */
export const ENEMY_BULLET_BAND_CHECK: DecorBandContrastCheck = {
	role: "enemyBullet",
	min: MIN_ENEMY_BULLET_CONTRAST,
};

/** The enemy outline (enemy outline plan O1, MIN_ENEMY_OUTLINE_CONTRAST). */
export const ENEMY_OUTLINE_BAND_CHECK: DecorBandContrastCheck = {
	role: "enemyOutline",
	min: MIN_ENEMY_OUTLINE_CONTRAST,
};

/** Every self-lit role the darkest-band check covers (the spec runs each for every bundled pack at every band). */
export const DECOR_BAND_CONTRAST_CHECKS: ReadonlyArray<DecorBandContrastCheck> = [
	ENEMY_BULLET_BAND_CHECK,
	ENEMY_OUTLINE_BAND_CHECK,
];

/** One row of decorBandContrastReport. */
export interface DecorBandContrastEntry {
	/** The checked role and its minimum ratio. */
	readonly role: ColorRole;
	readonly min: number;
	readonly band: string;
	readonly light: number;
	readonly biome: string;
	readonly surface: "floor" | "wall";
	/** The surface colour at the band's light. */
	readonly color: string;
	readonly ratio: number;
	readonly ok: boolean;
}

const SURFACES = ["floor", "wall"] as const;

/**
 * `check.role` (default: the enemy bullet) vs every biome's floor and wall of `manifest`, at band `band`'s light
 * multiplier (default: the darkest band), >= `check.min`. Reads `colors.<role>` and `biomes.<id>.floor` / `.wall` (hex);
 * a manifest without them gives no rows. The role's own colour is never dimmed (it is self-lit).
 */
export function decorBandContrastReport(
	manifest: unknown,
	band: number = darkestDecorBand(),
	check: DecorBandContrastCheck = ENEMY_BULLET_BAND_CHECK,
): DecorBandContrastEntry[] {
	const out: DecorBandContrastEntry[] = [];
	const b = DECOR_DEPTH.bands[band];
	if (b === undefined || !typeIs(manifest, "table")) return out;
	const m = manifest as { colors?: unknown; biomes?: unknown };
	if (!typeIs(m.colors, "table") || !typeIs(m.biomes, "table")) return out;
	const lit = (m.colors as Record<string, unknown>)[check.role];
	if (!isHexColor(lit)) return out;
	const biomes = m.biomes as Record<string, unknown>;
	for (const bd of BIOMES) {
		const def = biomes[bd.id];
		if (!typeIs(def, "table")) continue;
		for (const surface of SURFACES) {
			const hex = (def as Record<string, unknown>)[surface];
			if (!isHexColor(hex)) continue;
			const color = dimHex(hex, b.light);
			const ratio = contrastRatio(lit, color);
			out.push({
				role: check.role,
				min: check.min,
				band: b.name,
				light: b.light,
				biome: bd.id,
				surface,
				color,
				ratio,
				ok: ratio >= check.min,
			});
		}
	}
	return out;
}
