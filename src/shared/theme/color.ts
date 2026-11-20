/**
 * Pure color helpers (no Roblox types): hex parsing, WCAG 2.x contrast and (Roblox port, docs/DECOR.md) the CIE76
 * colour difference.
 *
 * Ported from project-kaleb-vale `src/theme/color.ts` @ 42897e2. Lua patterns replace the RegExp;
 * parse failures return `undefined` (the source's `null`); a malformed contrast input gives NaN.
 *
 * @module
 */

import type { HexColor } from "./types";

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

const HEX_PATTERN = "^#%x%x%x%x%x%x$";
const CHANNEL_MAX = 255;
const BYTE = 256;

/** True for '#rrggbb', the only color format packs may use. */
export function isHexColor(value: unknown): value is HexColor {
	return typeIs(value, "string") && value.match(HEX_PATTERN)[0] !== undefined;
}

/** '#rrggbb' -> 0..255 channels. Returns undefined for anything else. */
export function parseHex(hex: string): Rgb | undefined {
	if (!isHexColor(hex)) {
		return undefined;
	}
	const n = tonumber(hex.sub(2), 16) as number;
	return { r: math.floor(n / (BYTE * BYTE)) % BYTE, g: math.floor(n / BYTE) % BYTE, b: n % BYTE };
}

export function toHex(rgb: Rgb): HexColor {
	const h = (v: number) => math.clamp(math.round(v), 0, CHANNEL_MAX);
	return "#%02x%02x%02x".format(h(rgb.r), h(rgb.g), h(rgb.b)) as HexColor;
}

/**
 * Roblox port (docs/MINIMAP.md): one channel moved `m` (0..1) of the way from `a` toward `b`, in whatever unit both are
 * in. The minimap painter (shared/view/minimap paint.ts) mixes its 0..1 channels with it and the validator its tinted
 * floors (mixRgb), so the two agree on every pixel.
 */
export function mixChannel(a: number, b: number, m: number): number {
	return a + (b - a) * m;
}

/** A 0..1 channel to a 0..255 byte, rounded half up and clamped (the minimap painter's rule). */
export function channelToByte(v: number): number {
	return math.clamp(math.floor(v * CHANNEL_MAX + 0.5), 0, CHANNEL_MAX);
}

/**
 * Roblox port (docs/MINIMAP.md): `a` mixed `m` toward `b` exactly as the minimap painter writes it (0..1 channels,
 * mixChannel, then channelToByte), so a validated tinted floor is the pixel the map draws.
 */
export function mixRgb(a: Rgb, b: Rgb, m: number): Rgb {
	const mix = (x: number, y: number) => channelToByte(mixChannel(x / CHANNEL_MAX, y / CHANNEL_MAX, m));
	return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b) };
}

/** WCAG 2.x relative luminance of an sRGB color, 0 (black) .. 1 (white). */
export function relativeLuminance(rgb: Rgb): number {
	const lin = (c: number) => {
		const s = c / CHANNEL_MAX;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** CIELAB L*, a*, b* (D65 white) of an sRGB colour: L* 0 (black) .. 100 (white). */
export interface Lab {
	l: number;
	a: number;
	b: number;
}

// sRGB (IEC 61966-2-1) -> CIE XYZ (D65) -> CIELAB (CIE 15). Standard constants, not tunables.
const SRGB_LINEAR_KNEE = 0.04045;
const D65_WHITE = { x: 0.95047, y: 1, z: 1.08883 };
const LAB_EPSILON = (6 / 29) * (6 / 29) * (6 / 29);
const LAB_KAPPA_DIV = 3 * (6 / 29) * (6 / 29);
const LAB_OFFSET = 4 / 29;

/** sRGB (0..255 channels) -> CIELAB under D65 (Lab: Delta E is measured here). */
export function toLab(rgb: Rgb): Lab {
	const lin = (c: number) => {
		const s = c / CHANNEL_MAX;
		return s <= SRGB_LINEAR_KNEE ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const r = lin(rgb.r);
	const g = lin(rgb.g);
	const b = lin(rgb.b);
	const f = (t: number) => (t > LAB_EPSILON ? t ** (1 / 3) : t / LAB_KAPPA_DIV + LAB_OFFSET);
	const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / D65_WHITE.x);
	const fy = f((0.2126 * r + 0.7152 * g + 0.0722 * b) / D65_WHITE.y);
	const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / D65_WHITE.z);
	return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

// sRGB transfer function (IEC 61966-2-1). Standard constants, not tunables.
const SRGB_OUT_KNEE = 0.0031308;
const SRGB_SLOPE = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;

/**
 * Roblox port (docs/DECOR.md R8; moved here from shared/view/decor for docs/VOID_DECOR.md VD1): `hex` lit by `light`
 * (0..1, clamped) instead of 1: each channel scaled in linear light (what a dimmer ambient does to an unlit surface),
 * back to sRGB. Its relative luminance is `light` times the original's (to rounding). Malformed input comes back as is.
 */
export function dimHex(hex: string, light: number): string {
	const rgb = parseHex(hex);
	if (rgb === undefined) {
		return hex;
	}
	const k = math.clamp(light, 0, 1);
	const toLinear = (c: number) => {
		const s = c / CHANNEL_MAX;
		return s <= SRGB_LINEAR_KNEE ? s / SRGB_SLOPE : ((s + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_GAMMA;
	};
	const fromLinear = (l: number) => {
		const s = l <= SRGB_OUT_KNEE ? l * SRGB_SLOPE : SRGB_SCALE * l ** (1 / SRGB_GAMMA) - SRGB_OFFSET;
		return s * CHANNEL_MAX;
	};
	return toHex({
		r: fromLinear(toLinear(rgb.r) * k),
		g: fromLinear(toLinear(rgb.g) * k),
		b: fromLinear(toLinear(rgb.b) * k),
	});
}

/**
 * CIE LCh chroma C* (sqrt(a*^2 + b*^2) in CIELAB under D65): 0 for a neutral grey, ~100+ for a vivid primary. NaN for
 * malformed input. The combo's broken grey is held under a ceiling (contract.ts COMBO_COLOR_RULES.maxBrokenChroma).
 */
export function labChroma(c: Rgb | string): number {
	const rgb = typeIs(c, "string") ? parseHex(c) : c;
	if (rgb === undefined) {
		return 0 / 0;
	}
	const lab = toLab(rgb);
	return math.sqrt(lab.a * lab.a + lab.b * lab.b);
}

/**
 * CIE76 colour difference (Delta E*ab): Euclidean distance in CIELAB, 0 (identical) .. ~259 (blue vs yellow-green).
 * About 2.3 is a just-noticeable difference; colours of one hue family sit under ~20. Order doesn't matter. NaN for
 * malformed input. Where contrastRatio measures lightness only, this measures hue, chroma and lightness together
 * (the decor fx vs enemy bullet check, contract.ts MIN_DECOR_FX_BULLET_DIFFERENCE).
 */
export function colorDifference(a: Rgb | string, b: Rgb | string): number {
	const ca = typeIs(a, "string") ? parseHex(a) : a;
	const cb = typeIs(b, "string") ? parseHex(b) : b;
	if (ca === undefined || cb === undefined) {
		return 0 / 0;
	}
	const la = toLab(ca);
	const lb = toLab(cb);
	const dl = la.l - lb.l;
	const da = la.a - lb.a;
	const db = la.b - lb.b;
	return math.sqrt(dl * dl + da * da + db * db);
}

/** WCAG 2.x contrast ratio, 1 (identical) .. 21 (black on white). Order doesn't matter. NaN for malformed input. */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
	const ca = typeIs(a, "string") ? parseHex(a) : a;
	const cb = typeIs(b, "string") ? parseHex(b) : b;
	if (ca === undefined || cb === undefined) {
		return 0 / 0;
	}
	const la = relativeLuminance(ca);
	const lb = relativeLuminance(cb);
	return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}
