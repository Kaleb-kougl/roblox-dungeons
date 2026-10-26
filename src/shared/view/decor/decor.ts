/**
 * The pure parts of the decor renderer (docs/DECOR.md R3: the web build's `src/render/decor.ts`, written from the
 * plan since that source was not available; pending comparison with web `35307022`): which standing pieces fade
 * because a player or the boss is behind them, and where a glowing piece's flame / glow / light attaches. The client
 * DecorController (R4) only copies the results onto its instances. Allocation-free per frame (selectDecorFades).
 */
import type { DecorArt } from "shared/theme";
import type { Vec3 } from "../iso";
import type { DecorEntry, DecorPlan } from "./decorPlan";
import { DECOR_CAMERA, rectOverlapsPolygon, screenDepth, screenX, screenY } from "./screen";

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

/** The glow point's offset from the pivot in the camera plane, tiles: [right, up]. [0, 0] without art. */
export function decorGlowOffset(art: DecorArt): readonly [number, number] {
	const a = art.art;
	const pivot = a.kind === "image" ? a.pivot : a.set.pivot;
	const ppt = a.kind === "image" ? a.pixelsPerTile : a.set.pixelsPerTile;
	if (!(ppt > 0)) return [0, 0];
	return [(art.glowAt.x - pivot.x) / ppt, (pivot.y - art.glowAt.y) / ppt];
}

/**
 * Where entry `e`'s flame / glow / light attaches, world tiles: its anchor moved by decorGlowOffset along the
 * camera's right and up axes (the billboard plane), so it sits on the drawn cup or bowl.
 */
export function decorGlowPoint(e: DecorEntry, art: DecorArt): Vec3 {
	const [r, u] = decorGlowOffset(art);
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
