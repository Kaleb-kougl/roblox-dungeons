import { createKvBillboardGui, createKvSurfaceGui } from "client/ui";
import { CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import type { SpriteSet, WorldVisual } from "shared/theme";
import {
	DECOR_VIEW,
	SPRITE_VIEW,
	degToRad,
	floorImageOffset,
	floorImageSize,
	spriteBillboard,
	type SpriteLayout,
} from "shared/view";
import { renderPart } from "./placeholders";

/**
 * Instance builders of the decor renderers (docs/DECOR.md R4 / R9; DecorController, DecorFxController): an upright
 * camera-facing billboard for world art (an image region or a sprite set's frame) that can be scaled about its pivot,
 * faded, tinted and stepped through frames, and a flat floor image (a top-face SurfaceGui on a thin invisible Part, the
 * way breakable debris and the co-op ring lie). Every number comes from the art and shared/view helpers.
 */

const HIDDEN = 1;
const WHITE = new Color3(1, 1, 1);
/** Flat floor images turn with the camera, so their x axis is the screen's right. */
const CAMERA_YAW = CFrame.Angles(0, degToRad(CAMERA_YAW_DEG), 0);
/** A scale change smaller than this is not written (flames ease every frame). */
const SCALE_EPSILON = 0.005;

/** The billboard layout of world art: an image region's size / pivot / pixelsPerTile, or the sprite set's own. */
export function visualLayout(art: WorldVisual): SpriteLayout {
	if (art.kind === "image") {
		return { frameW: art.size.X, frameH: art.size.Y, pivot: art.pivot, pixelsPerTile: art.pixelsPerTile };
	}
	return art.set;
}

/** `layout` resized to `heightTiles` tall (its aspect and pivot kept). */
export function heightLayout(layout: SpriteLayout, heightTiles: number): SpriteLayout {
	if (!(heightTiles > 0) || !(layout.frameH > 0)) return layout;
	return { ...layout, pixelsPerTile: layout.frameH / heightTiles };
}

/** `layout` resized to `widthTiles` across (its aspect and pivot kept). */
export function widthLayout(layout: SpriteLayout, widthTiles: number): SpriteLayout {
	if (!(widthTiles > 0) || !(layout.frameW > 0)) return layout;
	return { ...layout, pixelsPerTile: layout.frameW / widthTiles };
}

/** A sprite set's resting animation name: `preferred` when it has it, else its first. */
export function restingAnimation(set: SpriteSet, preferred: string): string | undefined {
	return set.has(preferred) ? preferred : set.animationNames[0];
}

/**
 * An upright billboard of world art on an invisible anchor Part (the owner places the anchor on the art's ground spot):
 * Size / StudsOffset from spriteBillboard (the pivot pixel on the anchor, the part under it clearing the surface),
 * pushed `extraDepthStuds` further toward the camera. Not AlwaysOnTop, LightInfluence 0 (self-lit like the sprites).
 * Writes only on change.
 */
export class ArtBillboard {
	readonly anchor: Part;
	readonly gui: BillboardGui;
	readonly label: ImageLabel;
	private readonly w: number;
	private readonly h: number;
	private readonly ox: number;
	private readonly oy: number;
	private readonly oz: number;
	private scale = 1;
	private transparency = 0;
	private tint = WHITE;
	private enabled = true;
	private shownKey = "";

	constructor(
		readonly art: WorldVisual,
		parent: Instance,
		name: string,
		layout: SpriteLayout = visualLayout(art),
		extraDepthStuds = 0,
	) {
		const anchor = renderPart("Part", false);
		anchor.Name = name;
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		this.anchor = anchor;
		const b = spriteBillboard(layout);
		this.w = b.w;
		this.h = b.h;
		this.ox = b.offsetX;
		this.oy = b.offsetY;
		this.oz = b.offsetZ + extraDepthStuds;
		const gui = createKvBillboardGui(name);
		gui.Size = new UDim2(b.w, 0, b.h, 0);
		gui.StudsOffset = new Vector3(this.ox, this.oy, this.oz);
		gui.LightInfluence = 0;
		gui.AlwaysOnTop = false;
		gui.ResetOnSpawn = false;
		gui.Adornee = anchor;
		this.gui = gui;
		const label = new Instance("ImageLabel");
		label.Name = "Art";
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = UDim2.fromScale(1, 1);
		label.ImageColor3 = WHITE;
		if (art.kind === "image") {
			label.Image = art.image;
			label.ImageRectOffset = art.offset;
			label.ImageRectSize = art.size;
		} else {
			label.ResampleMode = Enum.ResamplerMode[art.set.resample];
		}
		label.Parent = gui;
		this.label = label;
		gui.Parent = anchor;
		anchor.Parent = parent;
		if (art.kind === "sprites") {
			const anim = restingAnimation(art.set, DECOR_VIEW.idleAnimation);
			if (anim !== undefined) this.setFrame(anim, 0, 0);
		}
	}

	/** A sprite set's frame (image art: nothing). Written only when it changes. */
	setFrame(anim: string, facing: number, frame: number): void {
		const art = this.art;
		if (art.kind !== "sprites") return;
		const key = `${anim}/${facing}/${frame}`;
		if (key === this.shownKey) return;
		this.shownKey = key;
		const f = art.set.frame(anim, facing, frame);
		if (this.label.Image !== f.image) this.label.Image = f.image;
		this.label.ImageRectOffset = f.offset;
		this.label.ImageRectSize = f.size;
	}

	/** Scales the billboard about its pivot (the anchor stays on the ground spot). */
	setScale(scale: number): void {
		if (math.abs(scale - this.scale) < SCALE_EPSILON) return;
		this.scale = scale;
		this.gui.Size = new UDim2(this.w * scale, 0, this.h * scale, 0);
		this.gui.StudsOffset = new Vector3(this.ox * scale, this.oy * scale, this.oz);
	}

	setTransparency(t: number): void {
		const v = math.clamp(t, 0, 1);
		if (v === this.transparency) return;
		this.transparency = v;
		this.label.ImageTransparency = v;
		this.setEnabled(v < 1);
	}

	setTint(color: Color3): void {
		if (color === this.tint) return;
		this.tint = color;
		this.label.ImageColor3 = color;
	}

	setEnabled(on: boolean): void {
		if (on === this.enabled) return;
		this.enabled = on;
		this.gui.Enabled = on;
	}

	destroy(): void {
		this.anchor.Destroy();
	}
}

/** A flat floor image: the Part (owned by the caller), its SurfaceGui (lighting) and its label (transparency / tint). */
export interface FloorArt {
	readonly part: Part;
	readonly gui: SurfaceGui;
	readonly label: ImageLabel;
}

/**
 * World art laid flat on the floor with its pivot on `at` (studs): an invisible Part `thickness` studs thick (its top
 * `lift` above `at`), turned by the camera yaw, with a top-face SurfaceGui showing the image region (a Decal cannot crop
 * an atlas region), sized like the co-op ring (floorImageSize: depth stretched by 1 / sin(pitch)). A sprite set shows
 * `facing`'s first frame of its resting animation. `layout` overrides the art's own size (an effect drawn to a size).
 * Undefined when a sprite set has no animation.
 */
export function buildFloorArt(
	name: string,
	art: WorldVisual,
	at: Vector3,
	parent: Instance,
	thickness: number,
	lift: number,
	facing = 0,
	layout: SpriteLayout = visualLayout(art),
): FloorArt | undefined {
	let image: string;
	let offset: Vector2;
	let size: Vector2;
	let resample: Enum.ResamplerMode = Enum.ResamplerMode.Default;
	if (art.kind === "image") {
		image = art.image;
		offset = art.offset;
		size = art.size;
	} else {
		const anim = restingAnimation(art.set, DECOR_VIEW.idleAnimation);
		if (anim === undefined) return undefined;
		const f = art.set.frame(anim, facing, 0);
		image = f.image;
		offset = f.offset;
		size = f.size;
		resample = Enum.ResamplerMode[art.set.resample];
	}
	const [w, d] = floorImageSize(layout.frameW, layout.frameH, layout.pixelsPerTile, STUDS_PER_TILE);
	const [ox, oz] = floorImageOffset(layout.frameW, layout.frameH, layout.pixelsPerTile, layout.pivot);
	const part = renderPart("Part", false);
	part.Name = name;
	part.Transparency = HIDDEN;
	part.Size = new Vector3(w, thickness, d);
	part.CFrame = new CFrame(at.X, at.Y + lift - thickness / 2, at.Z).mul(CAMERA_YAW).mul(new CFrame(ox, 0, oz));
	const gui = createKvSurfaceGui("Floor");
	gui.Face = Enum.NormalId.Top;
	gui.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize;
	gui.CanvasSize = size;
	gui.LightInfluence = 1;
	gui.AlwaysOnTop = false;
	gui.ResetOnSpawn = false;
	const label = new Instance("ImageLabel");
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Size = UDim2.fromScale(1, 1);
	label.Image = image;
	label.ImageRectOffset = offset;
	label.ImageRectSize = size;
	label.ResampleMode = resample;
	label.Parent = gui;
	gui.Parent = part;
	part.Parent = parent;
	return { part, gui, label };
}
