/**
 * The actor renderer's Instance builders and small helpers (docs/ACTOR_RENDER.md): the shared outline Highlight, a
 * player's ring and empty view, the move batch's placement of a placeholder model, the pools' free lists.
 *
 * @module
 */
import type { SpriteSet, ThemePack } from "shared/theme";
import { ACTOR_OUTLINE, ACTOR_VIEW, SPRITE_VIEW, floorImageOffset, floorImageSize } from "shared/view";
import type { Rgb8 } from "shared/view/cosmetics";
import { destroyModel, renderPart, type PlaceholderModel } from "../placeholders";
import { HIDDEN, PARKED, PIP_SCALE, PIP_THICKNESS, UNWRITTEN, type PlayerView, type Ring } from "./actorViews";

/**
 * Lists every piece of `model` at `origin` in the frame's move batch (`parts` / `cframes`, moved together by the
 * controller's one BulkMoveTo).
 */
export function placeModel(parts: BasePart[], cframes: CFrame[], model: PlaceholderModel, origin: CFrame): void {
	for (const piece of model.pieces) {
		parts.push(piece.part);
		cframes.push(origin.mul(piece.offset));
	}
}

/** A player's view: the facing pip now; the body (sprite or capsule) on its first draw (usePlayerBody). */
export function buildPlayerView(pack: ThemePack, folder: Instance, visualId: string): PlayerView {
	const pipVisual = pack.placeholder(ACTOR_VIEW.facingPipVisualId);
	const pip = renderPart("Part", false);
	pip.Name = "FacingPip";
	pip.Size = new Vector3(pipVisual.size[0] * PIP_SCALE, PIP_THICKNESS, pipVisual.size[0] * PIP_SCALE);
	pip.Color = pack.visualColor(pipVisual.color);
	pip.Material = Enum.Material[pipVisual.material];
	pip.Parent = folder;
	return {
		visualId,
		model: undefined,
		sprite: undefined,
		pip,
		ring: undefined,
		drawn: undefined,
		look: undefined,
		transparency: -1,
		outlined: false,
		dyeKey: UNWRITTEN,
		rimKey: UNWRITTEN,
		trailKey: UNWRITTEN,
		rimColor: undefined,
		cosmeticRef: undefined,
		cosmeticVisual: "",
		cosmeticAnimated: false,
	};
}

/** A cosmetic colour (whole channels) as a Color3, or undefined. */
export function color3Of(c: Rgb8 | undefined): Color3 | undefined {
	return c !== undefined ? Color3.fromRGB(c.r, c.g, c.b) : undefined;
}

/** Destroys a player's view (its sprite or capsule, facing pip and ring). */
export function destroyPlayerView(view: PlayerView): void {
	view.sprite?.destroy();
	if (view.model !== undefined) destroyModel(view.model);
	view.pip.Destroy();
	view.ring?.part.Destroy();
}

/** Puts `item` on the free list of `key` (the pools' per-key stacks). */
export function pushFree<T extends defined>(free: Map<string, T[]>, key: string, item: T): void {
	const list = free.get(key);
	if (list !== undefined) list.push(item);
	else free.set(key, [item]);
}

/**
 * The `ui.ring.player` image as a Decal on a flat, invisible floor Part, sized from the player set's texel density
 * (shared/view floorImageSize), or undefined when the pack has no such image.
 */
export function buildRing(pack: ThemePack, set: SpriteSet, folder: Instance): Ring | undefined {
	const image = pack.image(ACTOR_VIEW.ringVisualId);
	if (image === undefined) return undefined;
	const [w, d] = floorImageSize(image.w, image.h, set.pixelsPerTile);
	const [ox, oz] = floorImageOffset(image.w, image.h, set.pixelsPerTile, image.pivot);
	const part = renderPart("Part", false);
	part.Name = "PlayerRing";
	part.Transparency = HIDDEN;
	part.Size = new Vector3(w, SPRITE_VIEW.ringThicknessStuds, d);
	part.CFrame = PARKED;
	const decal = new Instance("Decal");
	decal.Face = Enum.NormalId.Top;
	decal.Texture = image.assetId;
	decal.Parent = part;
	part.Parent = folder;
	return { part, decal, offset: new CFrame(ox, 0, oz), color: undefined };
}

/**
 * The shared enemy outline (shared/view ACTOR_OUTLINE): one Highlight on the enemies Model, rim only, in the pack's
 * outline role, hidden behind walls like the bodies.
 */
export function buildOutline(pack: ThemePack, enemies: Model): Highlight {
	const highlight = new Instance("Highlight");
	highlight.Name = ACTOR_OUTLINE.highlightName;
	highlight.FillTransparency = ACTOR_OUTLINE.fillTransparency;
	highlight.OutlineTransparency = ACTOR_OUTLINE.outlineTransparency;
	highlight.OutlineColor = pack.color(ACTOR_OUTLINE.role);
	highlight.DepthMode = Enum.HighlightDepthMode[ACTOR_OUTLINE.depthMode];
	highlight.Adornee = enemies;
	highlight.Parent = enemies;
	return highlight;
}
