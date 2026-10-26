import type { SpriteSet } from "shared/theme";
import {
	ACTOR_OUTLINE,
	SPRITE_VIEW,
	spriteBillboard,
	spriteFacing,
	spriteFrame,
	spriteOutlineVisible,
	type IsoBasis,
	type SpriteAnimChoice,
	type SpriteClock,
	type SpriteLayout,
} from "shared/view";
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
 * Baked rim (enemy outline plan O4), opt in with `outline` (the rim colour): a second ImageLabel "Outline" under the
 * frame (ZIndex, Sibling behaviour) showing the frame's outline sheet (SpriteFrame.outlineImage) with the frame's rect,
 * written in the same branch as the frame. It draws while spriteOutlineVisible: the view is visible (setVisible hides
 * both labels), the rim is shown (setOutlineShown: the owner hides it at death while the corpse fades through
 * setTransparency, which touches the frame only) and the frame's sheet has an outline. Without `outline` nothing of
 * this runs.
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
	private tint = WHITE;
	private transparency = 0;
	private visible = true;

	constructor(
		readonly set: SpriteSet,
		parent: Instance,
		layout: SpriteLayout = set,
		extraDepthStuds = 0,
		outline?: Color3,
	) {
		const anchor = renderPart("Part", false);
		anchor.Name = `${set.id}.anchor`;
		anchor.Transparency = HIDDEN;
		anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
		this.anchor = anchor;

		const b = spriteBillboard(layout);
		const gui = new Instance("BillboardGui");
		gui.Name = set.id;
		gui.Size = new UDim2(b.w, 0, b.h, 0);
		gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ + extraDepthStuds);
		gui.LightInfluence = 0;
		gui.AlwaysOnTop = false;
		gui.ResetOnSpawn = false;
		gui.Adornee = anchor;
		gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
		this.gui = gui;

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
		this.gui.Enabled = true;
	}

	/** Parked: the billboard stops drawing (the owner parks the anchor). */
	park(): void {
		this.gui.Enabled = false;
	}

	/** Shows `choice` facing the sim direction (dirX, dirZ) under the camera `basis`; `dtSec` steps the clock. */
	update(choice: SpriteAnimChoice, dirX: number, dirZ: number, basis: IsoBasis, dtSec: number): void {
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
		if (f.image !== this.image) {
			this.image = f.image;
			this.label.Image = f.image;
		}
		this.label.ImageRectOffset = f.offset;
		this.label.ImageRectSize = f.size;
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

	/** ImageColor3 (multiplies the art: a tint, never a white flash). */
	setTint(color: Color3): void {
		if (color === this.tint) return;
		this.tint = color;
		this.label.ImageColor3 = color;
	}

	setTransparency(t: number): void {
		if (t === this.transparency) return;
		this.transparency = t;
		this.label.ImageTransparency = t;
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
		const drawn = spriteOutlineVisible(this.visible, this.outlineShown, this.outlineImage);
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
