import type { Pivot, SpriteSet } from "shared/theme";
import {
	ACTOR_OUTLINE,
	SPRITE_VIEW,
	sheetSpriteLayout,
	spriteBillboard,
	spriteFacing,
	spriteFrame,
	spriteOutlineVisible,
	type IsoBasis,
	type SpriteAnimChoice,
	type SpriteBillboard,
	type SpriteClock,
	type SpriteLayout,
} from "shared/view";
import {
	pushOffsetStuds,
	roundToArtPixels,
	spriteRimShown,
	squashedBillboard,
	type GhostSnapshot,
} from "shared/view/fx";
import { renderPart } from "./placeholders";

const WHITE = new Color3(1, 1, 1);
const HIDDEN = 1;

/**
 * One pooled sprite (docs/ART.md S4): a BillboardGui + ImageLabel on an invisible feet-anchor Part, for a theme
 * `sprites` asset. The owner moves `anchor` (BulkMoveTo, a CFrame at the actor's feet) and calls `update` with the
 * chosen animation (shared/view sprites.ts) every frame; the label's Image / ImageRect are written only when the
 * frame, facing or sheet changes. Tint / transparency / visibility are written only when they change.
 *
 * The anchor is its own Part, not the placeholder model: placeholder pieces sit at shape offsets and turn with the
 * facing (and tumble while rolling), which would drag the billboard. The billboard's StudsOffset (camera space) puts
 * the set's pivot pixel on the feet. `layout` sizes the billboard (default: the set's own frame size, pivot and
 * pixelsPerTile); breakables pass one scaled down to their height cap (shared/view breakableArtLayout).
 * `extraDepthStuds` pushes the billboard further toward the camera (decor wall pieces: off their wall face).
 *
 * Per-sheet cells (docs/DEMON_ART.md DD4): a frame whose sheet has its own cell (SpriteFrame.size / pivot differ from
 * the set's) re-sizes and re-offsets the billboard for that cell (sheetSpriteLayout over `layout`), written only when
 * the drawn cell changes; every sheet's pivot is the same point of the art, so the feet stay on the anchor. A set
 * without per-sheet cells never writes them again after the constructor.
 *
 * Baked rim (enemy outline plan O4), opt in with `outline` (the rim colour): a second ImageLabel "Outline" under the
 * frame (ZIndex, Sibling behaviour) showing the frame's outline sheet (SpriteFrame.outlineImage) with the frame's rect,
 * written in the same branch as the frame. It draws while spriteOutlineVisible: the view is visible (setVisible hides
 * both labels), the rim is shown (setOutlineShown: the owner hides it at death while the corpse fades through
 * setTransparency, which touches the frame only) and the frame's sheet has an outline. Without `outline` nothing of
 * this runs.
 *
 * Squash & stretch (docs/FEEL.md J6): `setScale(sx, sy)` resizes the billboard around the pivot pixel (shared/view/fx
 * squashedBillboard), each axis snapped to whole art pixels of the drawn cell (roundToArtPixels), written only when the
 * snapped scale or the cell changes. The billboard is kept as `base` (the current cell's spriteBillboard, recomputed by
 * placeBillboard) and every Size / StudsOffset write goes through writeBillboard (base x scale + extraDepthStuds): a
 * hit push (setPushTexels) writes StudsOffsetWorldSpace instead, a separate property, so the two compose.
 * `snapshot` copies the drawn frame for an afterimage (J7).
 */
export class SpriteView {
	readonly anchor: Part;
	private readonly gui: BillboardGui;
	private readonly label: ImageLabel;
	/** The rim label, only when built with `outline`. */
	private readonly outline: ImageLabel | undefined;
	/** The current frame's outline image (undefined: its sheet has none). */
	private outlineImage: string | undefined;
	private outlineShown = true;
	/** The rim label's Visible as last written. */
	private outlineDrawn = false;
	private clock: SpriteClock | undefined;
	private facing = 0;
	private shownAnim = "";
	private shownFacing = -1;
	private shownFrame = -1;
	private image = "";
	/** The cell the billboard is sized for (initially the set's): width, height, pivot x / y in pixels. */
	private cellW: number;
	private cellH: number;
	private cellPivotX: number;
	private cellPivotY: number;
	private tint = WHITE;
	private transparency = 0;
	private visible = true;
	/** Hit reaction (docs/FEEL.md J4): the rim's own colour, the flash colour drawn instead, hold and push. */
	private rimColor: Color3 | undefined;
	private rimFlash: Color3 | undefined;
	private held = false;
	private pushX = 0;
	private pushY = 0;
	private readonly pushStuds = [0, 0, 0];
	/** Squash (J6): the billboard of the current cell at 1 x 1, the scale asked for and the snapped scale drawn. */
	private base: SpriteBillboard | undefined;
	private scaleX = 1;
	private scaleY = 1;
	private drawnScaleX = 1;
	private drawnScaleY = 1;
	/** The billboard as last written (base x the drawn scale), and the frame's rect, for snapshot (J7). */
	private drawn: SpriteBillboard | undefined;
	private rectOffset = Vector2.zero;
	private rectSize = Vector2.zero;

	constructor(
		readonly set: SpriteSet,
		parent: Instance,
		private readonly layout: SpriteLayout = set,
		private readonly extraDepthStuds = 0,
		outline?: Color3,
	) {
		const anchor = renderPart("Part", false);
		anchor.Name = `${set.id}.anchor`;
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		this.anchor = anchor;

		const gui = new Instance("BillboardGui");
		gui.Name = set.id;
		this.gui = gui;
		this.cellW = set.frameW;
		this.cellH = set.frameH;
		this.cellPivotX = set.pivot.x;
		this.cellPivotY = set.pivot.y;
		this.placeBillboard(layout);
		gui.LightInfluence = 0;
		gui.AlwaysOnTop = false;
		gui.ResetOnSpawn = false;
		gui.Adornee = anchor;
		gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;

		const label = new Instance("ImageLabel");
		label.Name = "Frame";
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = UDim2.fromScale(1, 1);
		label.ResampleMode = Enum.ResamplerMode[set.resample];
		label.ImageColor3 = WHITE;
		label.ZIndex = ACTOR_OUTLINE.spriteZIndex.frame;
		label.Parent = gui;
		this.label = label;

		if (outline !== undefined) {
			const rim = new Instance("ImageLabel");
			rim.Name = ACTOR_OUTLINE.spriteLabelName;
			rim.BackgroundTransparency = HIDDEN;
			rim.BorderSizePixel = 0;
			rim.Size = UDim2.fromScale(1, 1);
			rim.ResampleMode = label.ResampleMode;
			rim.ImageColor3 = outline;
			this.rimColor = outline;
			rim.ZIndex = ACTOR_OUTLINE.spriteZIndex.outline;
			rim.Visible = false; // until a frame with an outline image
			rim.Parent = gui;
			this.outline = rim;
		}

		gui.Parent = anchor;
		anchor.Parent = parent;
	}

	/** Back to a fresh state for a new actor in this pooled view (clock, facing, juice). */
	reset(): void {
		this.clock = undefined;
		this.facing = 0;
		this.setTint(WHITE);
		this.setTransparency(0);
		this.setVisible(true);
		this.setOutlineShown(true);
		this.setScale(1, 1);
		this.held = false;
		this.shownAnim = "";
		this.shownFrame = -1;
		this.shownFacing = -1;
		this.gui.Enabled = true;
	}

	/** Parked: the billboard stops drawing (the owner parks the anchor). */
	park(): void {
		this.gui.Enabled = false;
	}

	/** Shows `choice` facing the sim direction (dirX, dirZ) under the camera `basis`; `dtSec` steps the clock. */
	update(choice: SpriteAnimChoice, dirX: number, dirZ: number, basis: IsoBasis, dtSec: number): void {
		// Hit hold (setHold): frame, facing and clock stay; only once a frame was drawn since reset (a pooled view must
		// not hold the previous actor's last frame).
		if (this.held && this.shownFrame >= 0) return;
		const set = this.set;
		const facing = spriteFacing(dirX, dirZ, set.facings, basis, this.facing);
		this.facing = facing;
		const pick = spriteFrame(set, choice, this.clock, dtSec);
		this.clock = pick;
		if (pick.anim === this.shownAnim && pick.frame === this.shownFrame && facing === this.shownFacing) return;
		this.shownAnim = pick.anim;
		this.shownFrame = pick.frame;
		this.shownFacing = facing;
		const f = set.frame(pick.anim, facing, pick.frame);
		this.syncCell(f.size.X, f.size.Y, f.pivot);
		if (f.image !== this.image) {
			this.image = f.image;
			this.label.Image = f.image;
		}
		this.label.ImageRectOffset = f.offset;
		this.label.ImageRectSize = f.size;
		this.rectOffset = f.offset;
		this.rectSize = f.size;
		const rim = this.outline;
		if (rim !== undefined) {
			const image = f.outlineImage;
			if (image !== this.outlineImage) {
				this.outlineImage = image;
				if (image !== undefined) rim.Image = image;
				this.syncOutline();
			}
			if (image !== undefined) {
				rim.ImageRectOffset = f.offset;
				rim.ImageRectSize = f.size;
			}
		}
	}

	/** Billboard Size / StudsOffset for `layout` (the pivot pixel on the anchor). */
	private placeBillboard(layout: SpriteLayout): void {
		this.base = spriteBillboard(layout);
		this.writeBillboard();
	}

	/** Per-sheet cells: re-places the billboard when the drawn frame's cell differs from the one it is sized for. */
	private syncCell(w: number, h: number, pivot: Readonly<Pivot>): void {
		if (w === this.cellW && h === this.cellH && pivot.x === this.cellPivotX && pivot.y === this.cellPivotY) return;
		this.cellW = w;
		this.cellH = h;
		this.cellPivotX = pivot.x;
		this.cellPivotY = pivot.y;
		this.placeBillboard(sheetSpriteLayout(this.layout, this.set, w, h, pivot));
	}

	/** ImageColor3 (multiplies the art: a tint, never a white flash). */
	setTint(color: Color3): void {
		if (color === this.tint) return;
		this.tint = color;
		this.label.ImageColor3 = color;
	}

	/**
	 * Hit flash (docs/FEEL.md J4): the rim label shows `color` instead of the outline colour, drawn even where the rim
	 * is hidden (setOutlineShown false: a corpse's killing blow, KV_EnemyOutline off); undefined ends it. No-op without
	 * `outline` or on a sheet with no outline image.
	 */
	setRimFlash(color: Color3 | undefined): void {
		if (color === this.rimFlash) return;
		this.rimFlash = color;
		const rim = this.outline;
		if (rim === undefined) return;
		const shown = color ?? this.rimColor;
		if (shown !== undefined) rim.ImageColor3 = shown;
		this.syncOutline();
	}

	/** Hit hold (docs/FEEL.md J4): while true, update() leaves the frame, facing and sprite clock as they are. */
	setHold(hold: boolean): void {
		this.held = hold;
	}

	/**
	 * Hit push (docs/FEEL.md J4): (x, y) whole render texels along `basis`'s right / up, as the billboard's
	 * StudsOffsetWorldSpace (the anchor is never rotated, so that is world space; StudsOffset keeps the pivot). Written
	 * only on change.
	 */
	setPushTexels(x: number, y: number, basis: IsoBasis): void {
		if (x === this.pushX && y === this.pushY) return;
		this.pushX = x;
		this.pushY = y;
		const o = pushOffsetStuds(x, y, basis, this.pushStuds);
		this.gui.StudsOffsetWorldSpace = new Vector3(o[0], o[1], o[2]);
	}

	setTransparency(t: number): void {
		if (t === this.transparency) return;
		this.transparency = t;
		this.label.ImageTransparency = t;
	}

	/**
	 * Squash & stretch (J6): draws the billboard `sx` x `sy` times its size around the pivot (1 x 1: as placed), each
	 * axis snapped to whole art pixels of the drawn cell. Written only when the snapped scale changes.
	 */
	setScale(sx: number, sy: number): void {
		if (sx === this.scaleX && sy === this.scaleY) return;
		this.scaleX = sx;
		this.scaleY = sy;
		if (
			roundToArtPixels(sx, this.cellW) === this.drawnScaleX &&
			roundToArtPixels(sy, this.cellH) === this.drawnScaleY
		) {
			return;
		}
		this.writeBillboard();
	}

	/** Size / StudsOffset: the current cell's billboard x the snapped scale, plus extraDepthStuds (see the class doc). */
	private writeBillboard(): void {
		const base = this.base;
		if (base === undefined) return;
		const sx = roundToArtPixels(this.scaleX, this.cellW);
		const sy = roundToArtPixels(this.scaleY, this.cellH);
		this.drawnScaleX = sx;
		this.drawnScaleY = sy;
		const b = squashedBillboard(base, sx, sy);
		this.drawn = b;
		this.gui.Size = new UDim2(b.w, 0, b.h, 0);
		this.gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ + this.extraDepthStuds);
	}

	/**
	 * Afterimage (J7): the frame as drawn now (image, rect, billboard size and offset with the squash) into `out`;
	 * false (out untouched) before the first frame and while hidden (setVisible false: a blink leaves no ghost).
	 */
	snapshot(out: GhostSnapshot): boolean {
		const b = this.drawn;
		if (b === undefined || this.image === "" || !this.visible) return false;
		out.image = this.image;
		out.rectX = this.rectOffset.X;
		out.rectY = this.rectOffset.Y;
		out.rectW = this.rectSize.X;
		out.rectH = this.rectSize.Y;
		out.w = b.w;
		out.h = b.h;
		out.offsetX = b.offsetX;
		out.offsetY = b.offsetY;
		out.offsetZ = b.offsetZ + this.extraDepthStuds;
		out.resample = this.set.resample;
		return true;
	}

	setVisible(v: boolean): void {
		if (v === this.visible) return;
		this.visible = v;
		this.label.Visible = v;
		this.syncOutline();
	}

	/** Shows or hides the rim (no-op without `outline`); the frame is untouched. The owner passes actorOutlined. */
	setOutlineShown(shown: boolean): void {
		if (shown === this.outlineShown) return;
		this.outlineShown = shown;
		this.syncOutline();
	}

	/** Writes the rim label's Visible when spriteOutlineVisible changes. */
	private syncOutline(): void {
		const rim = this.outline;
		if (rim === undefined) return;
		const drawn = spriteOutlineVisible(
			this.visible,
			spriteRimShown(this.outlineShown, this.rimFlash !== undefined),
			this.outlineImage,
		);
		if (drawn === this.outlineDrawn) return;
		this.outlineDrawn = drawn;
		rim.Visible = drawn;
	}

	destroy(): void {
		this.anchor.Destroy();
	}
}

/** The neutral tint (ImageColor3 white = the art as authored). */
export const SPRITE_TINT_NONE = WHITE;
