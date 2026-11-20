import { createKvBillboardGui, currentHudFont } from "client/ui";
import { STUDS_PER_TILE } from "shared/config";
import {
	TREASURE_COLUMN_FX_ID,
	isFxId,
	type FxSprite,
	type ThemePack,
	type TreasurePiece,
	type WorldImage,
} from "shared/theme";
import {
	BULLET_VIEW,
	SPRITE_VIEW,
	artPieceTop,
	boxPieceTop,
	breakableArtLayout,
	spriteBillboard,
	type IsoBasis,
	type PieceTop,
	type SpriteAnimChoice,
	type SpriteLayout,
} from "shared/view";
import { charCount } from "shared/l10n";
import { FX_SPRITE_VIEW, FX_VIEW, SCORE_POP_GLYPH_PX } from "shared/view/fx";
import { TREASURE_VIEW, type ColumnLook } from "shared/view/treasure";
import {
	buildPlaceholder,
	destroyModel,
	renderPart,
	setModelTransparency,
	type PlaceholderModel,
} from "./placeholders";
import { SPRITE_TINT_NONE, SpriteView } from "./SpriteView";

/**
 * The treasure chest's drawn pieces, shared by the vault (TreasureRenderController: the closed / open chest, the art
 * cage, the light column) and the relic pedestals (RunMarkerController: the same chest and column, docs/TREASURE.md
 * "Relic pedestals") and a secret room's chest (SecretRenderController, docs/SECRET_ROOMS.md SR7: the chest, its column
 * and its reward cards). A body is a theme TreasurePiece drawn as art (a sprite set's idle or an image billboard, capped at
 * a height above its pivot: breakableArtLayout) or as its placeholder model. Callers pass a look whose art is dropped
 * while its id has not downloaded (shared/view lookWhenReady, docs/STAGE_ASSETS.md SA18) and rebuild the body on the
 * flip. Presentation only.
 */

const HIDDEN = 1;
const WHITE = new Color3(1, 1, 1);
const IDLE: SpriteAnimChoice = { anim: "idle", rate: 1 };
/** Where a hidden piece waits (the bullet pools' parking spot). */
export const TREASURE_PARKED = new CFrame(
	BULLET_VIEW.parkedStuds[0],
	BULLET_VIEW.parkedStuds[1],
	BULLET_VIEW.parkedStuds[2],
);

/** A drawn piece (the closed / open chest, an art cage): exactly one of model / sprite / image. */
export interface PieceBody {
	readonly model: PlaceholderModel | undefined;
	readonly sprite: SpriteView | undefined;
	readonly image: ImageBody | undefined;
	/** Its drawn top (the sparkle's place). */
	readonly top: PieceTop;
	/** Its drawn height, studs (the cage's sink). */
	readonly heightStuds: number;
	shown: boolean;
	transparency: number;
}

/**
 * A piece drawn as image art: an invisible anchor Part carrying an upright BillboardGui with the one ImageLabel. Hidden
 * by disabling the gui and parking the anchor at `TREASURE_PARKED`.
 */
export interface ImageBody {
	readonly anchor: Part;
	readonly gui: BillboardGui;
	readonly label: ImageLabel;
}

/** The opening's light column: a self-lit Neon block, or `fx.treasure.column` as an upright billboard when the pack has it. */
export interface TreasureColumn {
	readonly part: Part;
	readonly anchor: Part;
	readonly fx: FxSprite | undefined;
	readonly gui: BillboardGui | undefined;
	readonly label: ImageLabel | undefined;
}

/** Builds `look` as a body in `folder` (shown; hide it if it should start hidden), `extraDepthStuds` nearer the camera. */
export function buildPieceBody(
	pack: ThemePack,
	look: TreasurePiece,
	folder: Folder,
	maxHeightTiles: number,
	extraDepthStuds = 0,
): PieceBody {
	const art = look.art;
	if (art !== undefined && art.kind === "sprites") {
		const layout = breakableArtLayout(art.set, maxHeightTiles);
		const sprite = new SpriteView(art.set, folder, layout, extraDepthStuds);
		return {
			model: undefined,
			sprite,
			image: undefined,
			top: artPieceTop(layout),
			heightStuds: artHeightStuds(layout),
			shown: true,
			transparency: 0,
		};
	}
	if (art !== undefined && art.kind === "image") {
		const layout = breakableArtLayout(
			{ frameW: art.size.X, frameH: art.size.Y, pivot: art.pivot, pixelsPerTile: art.pixelsPerTile },
			maxHeightTiles,
		);
		return {
			model: undefined,
			sprite: undefined,
			image: buildImage(art, layout, folder, extraDepthStuds),
			top: artPieceTop(layout),
			heightStuds: artHeightStuds(layout),
			shown: true,
			transparency: 0,
		};
	}
	const visual = look.placeholder;
	const model = buildPlaceholder(pack, look.id, visual, 1, folder, true);
	return {
		model,
		sprite: undefined,
		image: undefined,
		top: boxPieceTop(visual.size),
		heightStuds: visual.size[1],
		shown: true,
		transparency: 0,
	};
}

/**
 * Shows `body` with its base at `origin` (a placeholder takes the whole frame: its facing and any roll); `faceX` /
 * `faceZ`: the way a sprite chest faces (the vale art's four facings), 0, 0 keeps its row.
 */
export function placePieceBody(
	body: PieceBody,
	origin: CFrame,
	basis: IsoBasis,
	dtSec: number,
	faceX = 0,
	faceZ = 0,
): void {
	if (!body.shown) {
		body.shown = true;
		if (body.sprite !== undefined) {
			body.sprite.reset();
			body.sprite.setTransparency(body.transparency);
		}
		if (body.image !== undefined) body.image.gui.Enabled = true;
		if (body.model !== undefined) setModelTransparency(body.model, body.transparency);
	}
	if (body.model !== undefined) {
		for (const piece of body.model.pieces) piece.part.CFrame = origin.mul(piece.offset);
	}
	if (body.sprite !== undefined) {
		body.sprite.anchor.CFrame = new CFrame(origin.Position);
		body.sprite.update(IDLE, faceX, faceZ, basis, dtSec);
	}
	if (body.image !== undefined) body.image.anchor.CFrame = new CFrame(origin.Position);
}

/**
 * Hides a shown body without destroying it: a placeholder model or a sprite is parked, an image billboard is disabled
 * and its anchor parked. Nothing is written when it is already hidden.
 */
export function hidePieceBody(body: PieceBody): void {
	if (!body.shown) return;
	body.shown = false;
	if (body.model !== undefined) parkTreasureModel(body.model);
	if (body.sprite !== undefined) body.sprite.park();
	if (body.image !== undefined) {
		body.image.gui.Enabled = false;
		body.image.anchor.CFrame = TREASURE_PARKED;
	}
}

/**
 * Fades the whole body to transparency `t` (0 opaque, 1 invisible), whichever of model, sprite or image it is. Written
 * only when `t` changed.
 */
export function setPieceBodyTransparency(body: PieceBody, t: number): void {
	if (body.transparency === t) return;
	body.transparency = t;
	if (body.model !== undefined) setModelTransparency(body.model, t);
	if (body.sprite !== undefined) body.sprite.setTransparency(t);
	if (body.image !== undefined) body.image.label.ImageTransparency = t;
}

/**
 * Destroys the body's instances (its model's Parts, its sprite, or its image's anchor with the billboard under it).
 * Callers do this when they rebuild a body or tear the view down.
 */
export function destroyPieceBody(body: PieceBody): void {
	if (body.model !== undefined) destroyModel(body.model);
	body.sprite?.destroy();
	body.image?.anchor.Destroy();
}

/**
 * Moves every piece of a placeholder model to `TREASURE_PARKED`, the far-away spot where hidden pieces wait. Pieces
 * already there are not written.
 */
export function parkTreasureModel(model: PlaceholderModel): void {
	for (const piece of model.pieces) if (piece.part.CFrame !== TREASURE_PARKED) piece.part.CFrame = TREASURE_PARKED;
}

/** Builds a hidden light column in `folder` (`fx.treasure.column` when the pack has it, else the Neon block). */
export function buildTreasureColumn(pack: ThemePack, folder: Folder): TreasureColumn {
	const part = renderPart("Part", false);
	part.Name = "TreasureColumn";
	part.Material = Enum.Material.Neon;
	part.Transparency = HIDDEN;
	part.CFrame = TREASURE_PARKED;
	part.Parent = folder;
	const anchor = renderPart("Part", false);
	anchor.Name = "TreasureColumnAnchor";
	anchor.Transparency = HIDDEN;
	anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
	anchor.CFrame = TREASURE_PARKED;
	anchor.Parent = folder;
	const fx = isFxId(TREASURE_COLUMN_FX_ID) ? pack.fx(TREASURE_COLUMN_FX_ID) : undefined;
	if (fx === undefined) return { part, anchor, fx, gui: undefined, label: undefined };
	const gui = createKvBillboardGui("TreasureColumn");
	gui.LightInfluence = 0;
	gui.AlwaysOnTop = false;
	gui.ResetOnSpawn = false;
	gui.Enabled = false;
	gui.Adornee = anchor;
	const label = new Instance("ImageLabel");
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Size = UDim2.fromScale(1, 1);
	label.ImageTransparency = HIDDEN;
	label.ResampleMode = Enum.ResamplerMode[fx.set.resample];
	label.Parent = gui;
	gui.Parent = anchor;
	return { part, anchor, fx, gui, label };
}

/**
 * Draws the column `c` (shared/view/treasure columnAt) standing on `base` in `color` (the tier's floor role), `openAge`
 * sim seconds after the opening began (the art's frame: from TREASURE_VIEW.open.popSec); hidden when `c` is not shown.
 * `artReady` false (`fx.treasure.column` not downloaded yet, docs/STAGE_ASSETS.md SA18) draws the Neon block, the
 * stand-in, even when the pack has the art; the choice is made every frame, so the swap is live.
 */
export function drawTreasureColumn(
	col: TreasureColumn,
	c: ColumnLook,
	base: Vector3,
	color: Color3,
	openAge: number,
	artReady = true,
): void {
	if (!c.shown) {
		hideTreasureColumn(col);
		return;
	}
	const C = TREASURE_VIEW.open.column;
	const h = C.heightTiles * STUDS_PER_TILE * c.height;
	const w = C.widthTiles * STUDS_PER_TILE;
	const fxArt = col.fx;
	if (artReady && fxArt !== undefined && col.gui !== undefined && col.label !== undefined) {
		if (col.part.CFrame !== TREASURE_PARKED) {
			col.part.Transparency = HIDDEN;
			col.part.CFrame = TREASURE_PARKED;
		}
		col.anchor.CFrame = new CFrame(base);
		col.gui.Size = new UDim2(w, 0, h, 0);
		col.gui.StudsOffset = new Vector3(0, h / 2, 0);
		col.gui.Enabled = true;
		const frameIndex = fxArt.fps > 0 ? math.floor((openAge - TREASURE_VIEW.open.popSec) * fxArt.fps) : 0;
		const f = fxArt.frame(math.max(0, frameIndex));
		col.label.Image = f.image;
		col.label.ImageRectOffset = f.offset;
		col.label.ImageRectSize = f.size;
		col.label.ImageColor3 = color;
		col.label.ImageTransparency = HIDDEN - c.opacity;
		return;
	}
	if (col.gui !== undefined && col.gui.Enabled) col.gui.Enabled = false;
	col.part.Size = new Vector3(w, math.max(h, FX_SPRITE_VIEW.thicknessStuds), w);
	col.part.Color = color.Lerp(WHITE, TREASURE_VIEW.columnCoreMix);
	col.part.CFrame = new CFrame(base.add(new Vector3(0, h / 2, 0)));
	col.part.Transparency = HIDDEN - c.opacity;
}

/**
 * Hides the light column: the Neon block goes invisible and back to `TREASURE_PARKED`, the billboard (when the pack has
 * the column art) is disabled. Each is written only when it is showing.
 */
export function hideTreasureColumn(col: TreasureColumn): void {
	if (col.part.CFrame !== TREASURE_PARKED) {
		col.part.Transparency = HIDDEN;
		col.part.CFrame = TREASURE_PARKED;
	}
	if (col.gui !== undefined && col.gui.Enabled) col.gui.Enabled = false;
}

/** The drawn height of art laid out as `layout` above its pivot, studs. */
function artHeightStuds(layout: SpriteLayout): number {
	return (math.min(layout.frameH, math.max(0, layout.pivot.y)) * STUDS_PER_TILE) / layout.pixelsPerTile;
}

/**
 * An upright image billboard (image art) on an invisible anchor, its pivot on the anchor, `extraDepthStuds` nearer the
 * camera (the cage over the chest).
 */
function buildImage(art: WorldImage, layout: SpriteLayout, parent: Instance, extraDepthStuds = 0): ImageBody {
	const anchor = renderPart("Part", false);
	anchor.Name = "TreasureImage";
	anchor.Transparency = HIDDEN;
	anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
	anchor.CFrame = TREASURE_PARKED;
	const b = spriteBillboard(layout);
	const gui = createKvBillboardGui("Treasure");
	gui.Size = new UDim2(b.w, 0, b.h, 0);
	gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ + extraDepthStuds);
	gui.LightInfluence = 0;
	gui.AlwaysOnTop = false;
	gui.ResetOnSpawn = false;
	gui.Adornee = anchor;
	const label = new Instance("ImageLabel");
	label.Name = "Frame";
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Size = UDim2.fromScale(1, 1);
	label.Image = art.image;
	label.ImageRectOffset = art.offset;
	label.ImageRectSize = art.size;
	label.ImageColor3 = SPRITE_TINT_NONE;
	label.Parent = gui;
	gui.Parent = anchor;
	anchor.Parent = parent;
	return { anchor, gui, label };
}

/** A billboard text over a chest (a reward card, a vault's near-miss / kept line, a secret's `Secret cache`). */
export interface TreasureCard {
	readonly att: Attachment;
	readonly gui: BillboardGui;
	readonly label: TextLabel;
	shown: boolean;
	text: string;
}

/** A hidden card: an Attachment in `holder` (an anchor Part) carrying a BillboardGui in `folder`, the HUD font. */
export function buildTreasureCard(pack: ThemePack, holder: Instance, folder: Instance, name: string): TreasureCard {
	const att = new Instance("Attachment");
	att.Name = name;
	att.Parent = holder;
	const gui = createKvBillboardGui(name);
	gui.Adornee = att;
	gui.AlwaysOnTop = true;
	gui.LightInfluence = 0;
	gui.MaxDistance = math.huge;
	gui.ResetOnSpawn = false;
	gui.Enabled = false;
	const label = new Instance("TextLabel");
	label.BackgroundTransparency = HIDDEN;
	label.Size = UDim2.fromScale(1, 1);
	label.Font = currentHudFont();
	label.TextScaled = true;
	label.TextStrokeColor3 = pack.color("background");
	label.Parent = gui;
	gui.Parent = folder;
	return { att, gui, label, shown: false, text: "" };
}

/** A card at floor point `at`, `upStuds` up the screen, sized from its text (the score pops' glyphs x scale). */
export function drawTreasureCard(
	view: TreasureCard,
	at: Vector3,
	text: string,
	scale: number,
	upStuds: number,
	alpha: number,
	color: Color3,
): void {
	if (alpha <= 0) {
		hideTreasureCard(view);
		return;
	}
	const px = FX_VIEW.pxStuds;
	const glyphW = SCORE_POP_GLYPH_PX.w * scale;
	const glyphH = SCORE_POP_GLYPH_PX.h * scale;
	if (text !== view.text) {
		view.text = text;
		view.label.Text = text;
		view.gui.Size = new UDim2(math.max(charCount(text), 1) * glyphW * px, 0, glyphH * px, 0);
	}
	view.att.WorldPosition = at;
	view.gui.StudsOffset = new Vector3(0, upStuds, 0);
	view.label.TextColor3 = color;
	view.label.TextTransparency = HIDDEN - alpha;
	view.label.TextStrokeTransparency = HIDDEN - alpha * (HIDDEN - FX_VIEW.numberStroke);
	if (!view.shown) {
		view.shown = true;
		view.gui.Enabled = true;
	}
}

/**
 * Hides a card by disabling its BillboardGui (nothing when already hidden). The card keeps its text, so showing the
 * same text again costs no size update.
 */
export function hideTreasureCard(view: TreasureCard): void {
	if (!view.shown) return;
	view.shown = false;
	view.gui.Enabled = false;
}
