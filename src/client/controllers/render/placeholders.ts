import type { PlaceholderVisual, ThemePack } from "shared/theme";

/**
 * Builds the Parts for a theme placeholder (shared/theme PLACEHOLDER_VISUALS): Ball / Block / Cylinder / Wedge, a
 * Capsule (a Cylinder capped by two Balls), a Diamond (a boost drop's gem: a cube stood on a corner, turned 45
 * degrees about the vertical and then about its own depth axis, as wide and tall as the smaller of the visual's width
 * and height, so it never stands taller than the visual), a Cone (the imp, docs/ENEMY_VARIANTS.md: Roblox has no cone
 * Part, so a stepped spire of CONE_TIERS upright Cylinders, each narrower, together the visual's width and height) or a
 * Dome (the Ooze: a Ball as wide as the visual whose top sits at the visual's height; the rest of the ball hangs below
 * it, under the floor slab for a base-anchored body, where the depth test hides it). Shape, size, material and colour all come from the visual and the pack;
 * nothing here names a colour or an asset.
 *
 * The model's origin is its anchor point: the floor point under it for anchor "base", its centre for "center". Each
 * piece keeps its offset from that origin, so a renderer moves the whole model with BulkMoveTo:
 * `cframes[i] = origin * piece.offset`.
 */

export interface PlaceholderPiece {
	readonly part: BasePart;
	readonly offset: CFrame;
}

export interface PlaceholderModel {
	readonly visualId: string;
	readonly pieces: ReadonlyArray<PlaceholderPiece>;
	/** Overall size in studs after scaling: x width, y height, z depth (along the facing). */
	readonly size: Vector3;
	readonly baseColor: Color3;
	readonly faces: boolean;
}

/** Collision-free, anchored, query-free: render-only parts. */
export function renderPart<T extends "Part" | "WedgePart">(className: T, castShadow: boolean): CreatableInstances[T] {
	const part = new Instance(className);
	part.Anchored = true;
	part.CanCollide = false;
	part.CanQuery = false;
	part.CanTouch = false;
	part.CastShadow = castShadow;
	part.Locked = true;
	part.TopSurface = Enum.SurfaceType.Smooth;
	part.BottomSurface = Enum.SurfaceType.Smooth;
	return part;
}

const UPRIGHT = CFrame.Angles(0, 0, math.pi / 2); // a Cylinder's axis is X: turn it to Y
/** The Diamond: a cube turned an eighth of a turn about Y, then about its own Z (it stands on a corner). */
const EIGHTH_TURN = math.pi / 4;
const DIAMOND_TURN = CFrame.Angles(0, EIGHTH_TURN, 0).mul(CFrame.Angles(0, 0, EIGHTH_TURN));
/** A cube of side s turned about Z by 45 degrees spans s x sqrt(2) across and up. */
const SQRT2 = math.sqrt(2);
/** The Cone's stepped tiers (bottom = full width, each next one narrower by width / CONE_TIERS). */
const CONE_TIERS = 3;

/**
 * The parts of `visual` scaled by `scale`, parented to `parent`. `castShadow` for bodies; markings and bullets pass
 * false (shadows from hundreds of small parts cost more than they show).
 */
export function buildPlaceholder(
	pack: ThemePack,
	visualId: string,
	visual: PlaceholderVisual,
	scale: number,
	parent: Instance,
	castShadow: boolean,
): PlaceholderModel {
	const [sx, sy, sz] = visual.size;
	const w = sx * scale;
	const h = sy * scale;
	const d = sz * scale;
	const color = pack.visualColor(visual.color);
	const material = Enum.Material[visual.material];
	const baseY = visual.anchor === "base" ? h / 2 : 0;
	const pieces = new Array<PlaceholderPiece>();

	const add = (part: BasePart, size: Vector3, offset: CFrame) => {
		part.Size = size;
		part.Color = color;
		part.Material = material;
		part.Name = visualId;
		part.Parent = parent;
		pieces.push({ part, offset });
	};

	switch (visual.shape) {
		case "Ball": {
			const p = renderPart("Part", castShadow);
			p.Shape = Enum.PartType.Ball;
			add(p, new Vector3(w, w, w), new CFrame(0, visual.anchor === "base" ? w / 2 : 0, 0));
			break;
		}
		case "Cylinder": {
			const p = renderPart("Part", castShadow);
			p.Shape = Enum.PartType.Cylinder;
			add(p, new Vector3(h, w, d), new CFrame(0, baseY, 0).mul(UPRIGHT));
			break;
		}
		case "Wedge": {
			add(renderPart("WedgePart", castShadow), new Vector3(w, h, d), new CFrame(0, baseY, 0));
			break;
		}
		case "Capsule": {
			const radius = w / 2;
			const length = math.max(h - w, 0);
			const body = renderPart("Part", castShadow);
			body.Shape = Enum.PartType.Cylinder;
			add(body, new Vector3(math.max(length, radius), w, w), new CFrame(0, baseY, 0).mul(UPRIGHT));
			const top = renderPart("Part", castShadow);
			top.Shape = Enum.PartType.Ball;
			add(top, new Vector3(w, w, w), new CFrame(0, baseY + length / 2, 0));
			const bottom = renderPart("Part", castShadow);
			bottom.Shape = Enum.PartType.Ball;
			add(bottom, new Vector3(w, w, w), new CFrame(0, baseY - length / 2, 0));
			break;
		}
		case "Diamond": {
			const span = math.min(w, h);
			const side = span / SQRT2;
			const centreY = visual.anchor === "base" ? span / 2 : 0;
			add(
				renderPart("Part", castShadow),
				new Vector3(side, side, side),
				new CFrame(0, centreY, 0).mul(DIAMOND_TURN),
			);
			break;
		}
		case "Cone": {
			const tierH = h / CONE_TIERS;
			const bottom = visual.anchor === "base" ? 0 : -h / 2;
			for (let k = 0; k < CONE_TIERS; k++) {
				const across = (w * (CONE_TIERS - k)) / CONE_TIERS;
				const p = renderPart("Part", castShadow);
				p.Shape = Enum.PartType.Cylinder;
				add(p, new Vector3(tierH, across, across), new CFrame(0, bottom + (k + 0.5) * tierH, 0).mul(UPRIGHT));
			}
			break;
		}
		case "Dome": {
			const top = visual.anchor === "base" ? h : h / 2;
			const p = renderPart("Part", castShadow);
			p.Shape = Enum.PartType.Ball;
			add(p, new Vector3(w, w, w), new CFrame(0, top - w / 2, 0));
			break;
		}
		default: {
			add(renderPart("Part", castShadow), new Vector3(w, h, math.max(d, 0)), new CFrame(0, baseY, 0));
			break;
		}
	}
	return { visualId, pieces, size: new Vector3(w, h, d), baseColor: color, faces: visual.faces };
}

export function setModelColor(model: PlaceholderModel, color: Color3): void {
	for (const piece of model.pieces) piece.part.Color = color;
}

export function setModelTransparency(model: PlaceholderModel, transparency: number): void {
	for (const piece of model.pieces) piece.part.Transparency = transparency;
}

/** Reparents every piece of `model` to `parent` (a piece already there is not written). */
export function setModelParent(model: PlaceholderModel, parent: Instance): void {
	for (const piece of model.pieces) if (piece.part.Parent !== parent) piece.part.Parent = parent;
}

export function destroyModel(model: PlaceholderModel): void {
	for (const piece of model.pieces) piece.part.Destroy();
}
