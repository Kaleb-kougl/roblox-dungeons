/**
 * Pure color helpers (no Roblox types): hex parsing and WCAG 2.x contrast.
 *
 * Ported from project-kaleb-vale `src/theme/color.ts` @ 42897e2. Lua patterns replace the RegExp;
 * parse failures return `undefined` (the source's `null`); a malformed contrast input gives NaN.
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

/** WCAG 2.x relative luminance of an sRGB color, 0 (black) .. 1 (white). */
export function relativeLuminance(rgb: Rgb): number {
	const lin = (c: number) => {
		const s = c / CHANNEL_MAX;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
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
