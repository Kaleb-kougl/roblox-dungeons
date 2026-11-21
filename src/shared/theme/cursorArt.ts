/**
 * Roblox port (docs/CURSOR.md C2): the menus' gauntlet cursor art and its rules, in their own module (validate.ts and
 * contract.ts sit near Luau's 200-locals-per-function limit): `cursorArtProblems` is folded into variantColors.ts'
 * `variantColorProblems`, so validate.ts takes no new name.
 *
 *   - `ui.cursor` (contract.ts UI_IDS, required in every pack): the pointer. A placeholder (the placeholder pack's, and
 *     vale's until its PNG is uploaded) means the system pointer: `cursorArt` is undefined. As an image it carries a
 *     `pivot`, the click point (pixels from the image's, or its rect's, top-left; absent: the top-left corner). The
 *     facing pip borrows the id but reads `placeholder(id)`, never the image, so it stays the placeholder diamond;
 *   - `ui.cursor.hover` (port-only, OPTIONAL, no placeholder entry): the pointer over a button. Absent, the hover state
 *     shows `ui.cursor`. Present, it must register with `ui.cursor` (an image too, the same drawn size and pivot:
 *     `cursorArtProblems`), so swapping the two never moves a pixel or the click point. The generic ui image checks
 *     (validate.ts: the pivot inside the image or rect) apply to both.
 *
 * @module
 */

import type { ImageRef, PixelRect } from "./core";
import type { Pivot } from "./types";
import { isObj } from "./util";

/** The cursor's logical ids, by state. */
export const CURSOR_IMAGE_IDS = {
	/** The pointer (required). */
	normal: "ui.cursor",
	/** The pointer over a button (optional; falls back to `normal`). */
	hover: "ui.cursor.hover",
} as const;

/** A cursor state: the plain pointer or the pointer over a button. */
export type CursorState = keyof typeof CURSOR_IMAGE_IDS;

/** Every cursor state, in a fixed order. */
export const CURSOR_STATES: ReadonlyArray<CursorState> = ["normal", "hover"];

/** The optional cursor ids (a pack may leave them out: no placeholder entry). */
export function cursorOptionalIds(): ReadonlyArray<string> {
	return [CURSOR_IMAGE_IDS.hover];
}

/** One state's art, as the renderer draws it. */
export interface CursorStateArt {
	/** The logical id drawn (the hover state may fall back to `ui.cursor`): the id to ask art readiness about. */
	readonly id: string;
	/** The image's content id. */
	readonly assetId: string;
	/** The drawn region's pixel size (the rect's, or the whole image's). */
	readonly size: { readonly w: number; readonly h: number };
	/** The click point, pixels from the drawn region's top-left (the image's pivot; none: (0, 0)). */
	readonly pivot: Readonly<Pivot>;
	/** The region of the image to draw (ImageRectOffset / ImageRectSize); undefined: the whole image. */
	readonly rect: Readonly<PixelRect> | undefined;
}

/** The cursor's art per state. */
export type CursorArt = Readonly<Record<CursorState, CursorStateArt>>;

/** What `cursorArt` reads: a ThemePack or a ThemeCore. */
export interface CursorImageSource {
	image(id: string): ImageRef | undefined;
}

function stateArt(pack: CursorImageSource, id: string): CursorStateArt | undefined {
	const image = pack.image(id);
	if (image === undefined) {
		return undefined;
	}
	const r = image.rect;
	const p = image.pivot;
	return {
		id,
		assetId: image.assetId,
		size: r !== undefined ? { w: r.w, h: r.h } : { w: image.w, h: image.h },
		pivot: p !== undefined ? { x: p.x, y: p.y } : { x: 0, y: 0 },
		rect: r !== undefined ? { x: r.x, y: r.y, w: r.w, h: r.h } : undefined,
	};
}

/**
 * The gauntlet cursor's art per state, or undefined while `ui.cursor` is not an image (a placeholder: keep the system
 * pointer). The hover state is `ui.cursor.hover`'s image, or the normal state's art when the pack has none. Pure: a
 * fresh object every call.
 */
export function cursorArt(pack: CursorImageSource): CursorArt | undefined {
	const normal = stateArt(pack, CURSOR_IMAGE_IDS.normal);
	if (normal === undefined) {
		return undefined;
	}
	return { normal, hover: stateArt(pack, CURSOR_IMAGE_IDS.hover) ?? normal };
}

/** A validator message: where (a manifest path) and what. */
export interface CursorArtProblem {
	path: Array<string>;
	msg: string;
}

/** An image's drawn size (its rect's, or the whole image's) and pivot, from raw manifest data. */
interface Drawn {
	w: unknown;
	h: unknown;
	x: unknown;
	y: unknown;
}

/** An `image` asset's Drawn, or undefined when it is not an image. */
function drawnOf(def: unknown): Drawn | undefined {
	if (!isObj(def) || def.kind !== "image") {
		return undefined;
	}
	const rect = isObj(def.rect) ? def.rect : undefined;
	const pivot = isObj(def.pivot) ? def.pivot : undefined;
	return {
		w: rect !== undefined ? rect.w : def.w,
		h: rect !== undefined ? rect.h : def.h,
		x: pivot !== undefined ? pivot.x : 0,
		y: pivot !== undefined ? pivot.y : 0,
	};
}

/**
 * The hover cursor's registration (variantColorProblems adds them; path `assets.ui.cursor.hover[.<field>]`): a
 * `ui.cursor.hover` image needs `ui.cursor` as an image (without it the hover art is never drawn) with the same drawn
 * size and pivot. Nothing for a pack without the hover image.
 */
export function cursorArtProblems(manifest: unknown): Array<CursorArtProblem> {
	const out = new Array<CursorArtProblem>();
	const assets = isObj(manifest) && isObj(manifest.assets) ? manifest.assets : undefined;
	if (assets === undefined) {
		return out;
	}
	const hover = drawnOf(assets[CURSOR_IMAGE_IDS.hover]);
	if (hover === undefined) {
		return out;
	}
	const at = ["assets", CURSOR_IMAGE_IDS.hover];
	const normal = drawnOf(assets[CURSOR_IMAGE_IDS.normal]);
	if (normal === undefined) {
		out.push({
			path: at,
			msg: `a hover cursor needs "${CURSOR_IMAGE_IDS.normal}" as an image too: without it the system pointer is shown and the hover art is never drawn`,
		});
		return out;
	}
	const normalId = CURSOR_IMAGE_IDS.normal;
	const size = (d: Drawn) => `${tostring(d.w)}x${tostring(d.h)}`;
	const point = (d: Drawn) => `(${tostring(d.x)}, ${tostring(d.y)})`;
	if (hover.w !== normal.w || hover.h !== normal.h) {
		out.push({
			path: at,
			msg: `the hover cursor is drawn ${size(hover)} but "${normalId}" ${size(
				normal,
			)}: the two states must be the same size (art:build's sameCropAs)`,
		});
	}
	if (hover.x !== normal.x || hover.y !== normal.y) {
		out.push({
			path: [...at, "pivot"],
			msg: `the hover cursor's pivot ${point(hover)} differs from "${normalId}"'s ${point(
				normal,
			)}: the click point would move between the states`,
		});
	}
	return out;
}
