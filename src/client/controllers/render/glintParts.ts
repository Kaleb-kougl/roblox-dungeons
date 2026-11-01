import { createKvBillboardGui } from "client/ui";
import type { DecorPiece } from "shared/theme";
import type { SpriteBillboard } from "shared/view";
import { restingAnimation } from "./decorParts";

const HIDDEN = 1;
const SELF_LIT = 0;
const WHITE = new Color3(1, 1, 1);

/**
 * The pack's `decor.fx.glint` (the treasure sparkle) as a BillboardGui on an anchor Part: a boost drop's glint and
 * pickup flash (BoostDropRenderController, docs/BOOST_ART.md BA3) and a loaded breakable's hint
 * (BreakableRenderController, docs/BREAKABLE_DROPS.md BL6). Untinted, self-lit, depth-tested (never AlwaysOnTop).
 */
export interface Glint {
	readonly gui: BillboardGui;
	readonly label: ImageLabel;
	readonly piece: DecorPiece;
	/** The sprite set's loop (its `preferred` animation, else its first); undefined for image art. */
	readonly anim: string | undefined;
	readonly frames: number;
	readonly fps: number;
	shownFrame: number;
	shown: number;
}

/**
 * The glint billboard on `anchor`, drawn as `board`, its loop `preferred` (restingAnimation), hidden until a
 * transparency is set, on frame 0.
 */
export function buildGlint(piece: DecorPiece, anchor: Part, board: SpriteBillboard, preferred: string): Glint {
	const art = piece.art;
	let anim: string | undefined;
	let frames = 1;
	let fps = 0;
	const gui = createKvBillboardGui("Glint");
	gui.LightInfluence = SELF_LIT;
	gui.AlwaysOnTop = false;
	gui.ResetOnSpawn = false;
	gui.Adornee = anchor;
	const label = new Instance("ImageLabel");
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Size = UDim2.fromScale(1, 1);
	label.ImageColor3 = WHITE;
	label.ImageTransparency = HIDDEN;
	if (art.kind === "image") {
		label.Image = art.image;
		label.ImageRectOffset = art.offset;
		label.ImageRectSize = art.size;
	} else {
		label.ResampleMode = Enum.ResamplerMode[art.set.resample];
		anim = restingAnimation(art.set, preferred);
		const def = anim !== undefined ? art.set.animation(anim) : undefined;
		if (def !== undefined) {
			frames = math.max(1, def.frames);
			fps = def.fps;
		}
	}
	label.Parent = gui;
	gui.Parent = anchor;
	const glint: Glint = { gui, label, piece, anim, frames, fps, shownFrame: -1, shown: HIDDEN };
	setGlintBoard(glint, board);
	setGlintFrame(glint, 0);
	return glint;
}

/** The glint's size and camera-space offset. */
export function setGlintBoard(glint: Glint, b: SpriteBillboard): void {
	glint.gui.Size = new UDim2(b.w, 0, b.h, 0);
	glint.gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ);
}

/** A sprite glint's frame (image art: nothing). Written only when it changes. */
export function setGlintFrame(glint: Glint, frame: number): void {
	const art = glint.piece.art;
	if (art.kind !== "sprites" || glint.anim === undefined || frame === glint.shownFrame) return;
	glint.shownFrame = frame;
	const f = art.set.frame(glint.anim, 0, frame);
	if (glint.label.Image !== f.image) glint.label.Image = f.image;
	glint.label.ImageRectOffset = f.offset;
	glint.label.ImageRectSize = f.size;
}

/** The glint's ImageTransparency (1 = hidden). Written only when it changes. */
export function setGlintTransparency(glint: Glint, t: number): void {
	if (t === glint.shown) return;
	glint.shown = t;
	glint.label.ImageTransparency = t;
}
