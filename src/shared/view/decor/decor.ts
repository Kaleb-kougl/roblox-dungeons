/**
 * The pure parts of the decor renderer (docs/DECOR.md R3: the web build's `src/render/decor.ts`, written from the
 * plan since that source was not available; pending comparison with web `35307022`): which standing pieces fade
 * because a player or the boss is behind them, where a glowing piece's flame / glow / light attaches, and the drawn
 * layouts held inside the footprint rule's boxes (decorPieceLayout, decorFxLayout: the rule only proves DECOR_BOX safe,
 * so art and its effects are never drawn larger). The client DecorController (R4) only copies the results onto its
 * instances. Allocation-free per frame (selectDecorFades).
 */
import type { DecorArt, Pivot } from "shared/theme";
import type { Vec3 } from "../iso";
import type { SpriteLayout } from "../sprites";
import type { DecorEntry, DecorPlan } from "./decorPlan";
import { DECOR_FX } from "./fxConfig";
import { DECOR_REACT } from "./reactConfig";
import {
	DECOR_CAMERA,
	rectFitScale,
	rectOverlapsPolygon,
	screenDepth,
	screenX,
	screenY,
	type ScreenPolygon,
} from "./screen";

/** A body that must stay visible (a player, the boss): its feet on the floor, a radius and a drawn height, tiles. */
export interface DecorBody {
	readonly x: number;
	readonly z: number;
	readonly radius: number;
	readonly height: number;
}

/**
 * Marks `out[i]` true for every fade box i of `plan` that hides part of a body: the body's screen box (its radius
 * either side, feet to `height`) overlaps the piece's screen box and the body stands behind the piece's billboard
 * plane. Returns how many fade. `out` is resized to plan.fadeBoxes.size() and fully rewritten (reuse it per frame).
 */
export function selectDecorFades(plan: DecorPlan, bodies: ReadonlyArray<DecorBody>, out: boolean[]): number {
	const cam = DECOR_CAMERA;
	const boxes = plan.fadeBoxes;
	let count = 0;
	for (let i = 0; i < boxes.size(); i++) {
		const box = boxes[i];
		let fade = false;
		for (let b = 0; b < bodies.size() && !fade; b++) {
			const body = bodies[b];
			if (screenDepth(cam, body.x, body.height / 2, body.z) <= box.depth) continue;
			const sx = screenX(cam, body.x, 0, body.z);
			const sy0 = screenY(cam, body.x, 0, body.z);
			const sy1 = screenY(cam, body.x, body.height, body.z);
			fade = rectOverlapsPolygon(
				box.polygon,
				sx - body.radius,
				math.min(sy0, sy1) - body.radius,
				sx + body.radius,
				math.max(sy0, sy1),
			);
		}
		out[i] = fade;
		if (fade) count++;
	}
	for (let i = out.size() - 1; i >= boxes.size(); i--) out.pop();
	return count;
}

/**
 * The glow point's offset from the pivot in the camera plane, tiles: [right, up]. [0, 0] without art. `layout` is the
 * layout the art is drawn with (decorPieceLayout: scaled / lifted into its box); default the art's own.
 */
export function decorGlowOffset(art: DecorArt, layout?: SpriteLayout): readonly [number, number] {
	const a = art.art;
	const pivot = layout !== undefined ? layout.pivot : a.kind === "image" ? a.pivot : a.set.pivot;
	const ppt =
		layout !== undefined ? layout.pixelsPerTile : a.kind === "image" ? a.pixelsPerTile : a.set.pixelsPerTile;
	if (!(ppt > 0)) return [0, 0];
	return [(art.glowAt.x - pivot.x) / ppt, (pivot.y - art.glowAt.y) / ppt];
}

/**
 * Where entry `e`'s flame / glow / light attaches, world tiles: its anchor moved by decorGlowOffset along the
 * camera's right and up axes (the billboard plane), so it sits on the drawn cup or bowl (drawn with `layout`).
 */
export function decorGlowPoint(e: DecorEntry, art: DecorArt, layout?: SpriteLayout): Vec3 {
	const [r, u] = decorGlowOffset(art, layout);
	const right = DECOR_CAMERA.right;
	const up = DECOR_CAMERA.up;
	return [e.x + right[0] * r + up[0] * u, e.y + right[1] * r + up[1] * u, e.z + right[2] * r + up[2] * u];
}

/** A glow point of the plan: the entry, its room, and the world point (tiles). */
export interface DecorGlowPoint {
	readonly entry: number;
	readonly roomId: number;
	readonly kind: DecorEntry["kind"];
	readonly lit: boolean;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/**
 * Every glowing entry's glow point. `artFor` gives the art an entry is drawn with (the variant's DecorArt, from
 * ThemeCore.decorVariants); entries without art or whose art does not glow are skipped. Plan order.
 */
export function decorGlowPoints(plan: DecorPlan, artFor: (e: DecorEntry) => DecorArt | undefined): DecorGlowPoint[] {
	const out: DecorGlowPoint[] = [];
	plan.entries.forEach((e, entry) => {
		const art = artFor(e);
		if (art === undefined || !art.glow) return;
		const [x, y, z] = decorGlowPoint(e, art);
		out.push({ entry, roomId: e.roomId, kind: e.kind, lit: e.lit, x, y, z });
	});
	return out;
}

// ---------------------------------------------------------------------------------------------
// Drawn sizes held to the footprint rule's boxes

/** rectFitScale of art drawn with `layout` (its pivot row moved to `pivotY`) at `grow` times its size, pivot on (x, y). */
function fitScale(
	layout: SpriteLayout,
	pivotY: number,
	poly: ScreenPolygon,
	x: number,
	y: number,
	grow: number,
): number {
	const s = grow / layout.pixelsPerTile;
	const p = layout.pivot;
	return rectFitScale(poly, x, y, p.x * s, (layout.frameW - p.x) * s, (layout.frameH - pivotY) * s, pivotY * s);
}

/**
 * `layout` drawn (at up to `grow` times its size) with its pivot on screen point (x, y), held inside screen polygon
 * `poly` (tiles): unchanged when it fits; else scaled down uniformly (pixelsPerTile raised, like breakableArtLayout) and,
 * when that fits better, lifted so nothing hangs below its pivot (pivot moved to the bottom row: a box with nothing
 * `below` a wall-top pivot leaves no room under it at any scale). Undefined when no scale fits (the point lies outside
 * `poly`). Pure; the result's billboard at scale `grow` lies inside `poly`.
 */
export function fitArtLayout(
	layout: SpriteLayout,
	poly: ScreenPolygon,
	x: number,
	y: number,
	grow = 1,
): SpriteLayout | undefined {
	if (!(layout.pixelsPerTile > 0) || !(grow > 0)) return undefined;
	const kept = fitScale(layout, layout.pivot.y, poly, x, y, grow);
	if (kept >= 1) return layout;
	const lifted = layout.pivot.y < layout.frameH ? fitScale(layout, layout.frameH, poly, x, y, grow) : -1;
	const k = math.max(kept, lifted);
	if (!(k > 0)) return undefined;
	const pivot: Readonly<Pivot> = lifted > kept ? { x: layout.pivot.x, y: layout.frameH } : layout.pivot;
	return { frameW: layout.frameW, frameH: layout.frameH, pivot, pixelsPerTile: layout.pixelsPerTile / k };
}

/**
 * The layout plan entry `entry` is drawn with, given its art's own `layout`: a standing piece (tall / low, the ones
 * with a fade box) is held inside its DECOR_BOX screen box (the fade box polygon: the unpadded box the footprint rule
 * pads), so the art never covers more than the rule proved safe; flat and wall pieces are not under the footprint rule
 * and keep `layout`. Undefined: the art cannot be drawn inside its box.
 */
export function decorPieceLayout(plan: DecorPlan, entry: number, layout: SpriteLayout): SpriteLayout | undefined {
	const e = plan.entries[entry];
	if (e === undefined || e.fade < 0) return layout;
	const box = plan.fadeBoxes[e.fade];
	const cam = DECOR_CAMERA;
	return fitArtLayout(layout, box.polygon, screenX(cam, e.x, e.y, e.z), screenY(cam, e.x, e.y, e.z));
}

/**
 * The most a flame billboard is scaled (DecorFxController): the engaged height x a full flare (motionScale at most 1;
 * the gutter only shrinks it).
 */
export function decorFlameMaxGrow(): number {
	return DECOR_REACT.engagedFlameScale * (1 + DECOR_FX.flareGrow);
}

/**
 * The layout an effect billboard (flame, glow) on plan entry `entry` is drawn with: `fxLayout` with its pivot on the
 * piece's glow point (`glowAt` on the piece drawn with `pieceLayout`), held inside the piece's box at its largest
 * scale `grow` (decorFlameMaxGrow for flames, 1 for glows), like decorPieceLayout. Pieces without a box (wall pieces)
 * keep `fxLayout`. Undefined: the effect cannot be drawn inside the box.
 */
export function decorFxLayout(
	plan: DecorPlan,
	entry: number,
	pieceLayout: SpriteLayout,
	glowAt: Readonly<Pivot>,
	fxLayout: SpriteLayout,
	grow: number,
): SpriteLayout | undefined {
	const e = plan.entries[entry];
	if (e === undefined || e.fade < 0) return fxLayout;
	const box = plan.fadeBoxes[e.fade];
	const cam = DECOR_CAMERA;
	const ppt = pieceLayout.pixelsPerTile;
	if (!(ppt > 0)) return undefined;
	// the glow offset lies in the billboard plane: screen right / up move by exactly that much
	const x = screenX(cam, e.x, e.y, e.z) + (glowAt.x - pieceLayout.pivot.x) / ppt;
	const y = screenY(cam, e.x, e.y, e.z) + (pieceLayout.pivot.y - glowAt.y) / ppt;
	return fitArtLayout(fxLayout, box.polygon, x, y, grow);
}
