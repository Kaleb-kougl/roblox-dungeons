import { Workspace } from "@rbxts/services";
import { createKvSurfaceGui, currentHudFont } from "client/ui";
import { CAMERA_PITCH_DEG, STUDS_PER_TILE } from "shared/config";
import { archetypeAt } from "shared/sim";
import type { ThemePack } from "shared/theme";
import { ACTOR_VIEW, degToRad, floorStudsY, studsX, studsZ } from "shared/view";
import { ActorSizeCache, FX_SPRITE_VIEW, FX_VIEW, placeholderScreenSize, type DrawnSize } from "shared/view/fx";
import { COMBO_SHOUT, COMBO_SHOUT_DRAW, shoutCanvasSize } from "shared/view/hud";
import { floorCanvasPartSize } from "../render/floorCanvas";
import { renderPart } from "../render/placeholders";

const PITCH = degToRad(CAMERA_PITCH_DEG);

/**
 * Per archetype kind: the drawn size of its placeholder model in render px (width across the view, top edge above the
 * feet), scaled exactly as ActorRenderController builds it (spriteScale, bosses at least ACTOR_VIEW.bossMinDrawPx
 * wide). Health bars sit on that top edge, damage numbers above it.
 */
export function placeholderSizeCache(pack: ThemePack): ActorSizeCache {
	return new ActorSizeCache((kind) => {
		const data = archetypeAt(kind).data;
		const visual = pack.placeholder(data.spriteId);
		const boss = data.boss === true;
		let scale = data.spriteScale ?? 1;
		if (boss && visual.cellPx.w * scale < ACTOR_VIEW.bossMinDrawPx)
			scale = ACTOR_VIEW.bossMinDrawPx / visual.cellPx.w;
		const out: DrawnSize = { w: 0, h: 0 };
		placeholderScreenSize(visual.size, scale, PITCH, FX_VIEW.pxStuds, out);
		return { w: out.w, h: out.h, boss };
	});
}

/** The studs position of a sim floor point (x, z). */
export function floorPoint(x: number, z: number): Vector3 {
	return new Vector3(studsX(x), floorStudsY(), studsZ(z));
}

/** A folder under Workspace for one juice view's instances. */
export function fxFolder(name: string): Folder {
	const folder = new Instance("Folder");
	folder.Name = name;
	folder.Parent = Workspace;
	return folder;
}

/** An invisible anchored holder part for attachments (BillboardGui adornees), parked at the world origin. */
export function attachmentHolder(parent: Instance, name: string): Part {
	const part = new Instance("Part");
	part.Name = name;
	part.Anchored = true;
	part.CanCollide = false;
	part.CanQuery = false;
	part.CanTouch = false;
	part.CastShadow = false;
	part.Transparency = 1;
	part.Size = Vector3.one;
	part.CFrame = new CFrame(0, floorStudsY(), 0);
	part.Parent = parent;
	return part;
}

const HIDDEN = 1;
const CENTRE = new Vector2(0.5, 0.5);

/** One floor text on the combo shout's construction (floorText). */
export interface FloorText {
	readonly part: Part;
	readonly surface: SurfaceGui;
	readonly label: TextLabel;
}

/**
 * A floor text on the combo shout's construction (docs/COMBO.md CD9, shared by the PARRY! flash and the SYNC! callout):
 * ONE SurfaceGui on the Top face of a thin invisible floor Part of COMBO_SHOUT's box (sized for FLOOR_CANVAS_YAW), shoutCanvasSize's canvas, a
 * TextScaled HUD-font label centred on it in `color` with the background-coloured stroke, lit like the HUD. Built
 * hidden (the surface disabled, the label transparent) and `parked`, under `folder`. The caller places the Part (the
 * shout's layer under the sprite effects, turned by FLOOR_CANVAS_YAW) and writes the label's text, size and transparency.
 */
export function floorText(name: string, folder: Instance, color: Color3, stroke: Color3, parked: CFrame): FloorText {
	const part = renderPart("Part", false);
	part.Name = name;
	part.Transparency = HIDDEN;
	part.Size = floorCanvasPartSize(
		COMBO_SHOUT.widthTiles * STUDS_PER_TILE,
		FX_SPRITE_VIEW.thicknessStuds,
		COMBO_SHOUT.depthTiles * STUDS_PER_TILE,
	);
	part.CFrame = parked;
	const [w, h] = shoutCanvasSize();
	const surface = createKvSurfaceGui("Shout");
	surface.Face = Enum.NormalId.Top;
	surface.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize;
	surface.CanvasSize = new Vector2(w, h);
	surface.AlwaysOnTop = false;
	surface.LightInfluence = COMBO_SHOUT_DRAW.lightInfluence;
	surface.ResetOnSpawn = false;
	surface.Enabled = false;
	const label = new Instance("TextLabel");
	label.Name = "Text";
	label.AnchorPoint = CENTRE;
	label.Position = UDim2.fromScale(CENTRE.X, CENTRE.Y);
	label.Size = UDim2.fromScale(1, 1);
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Font = currentHudFont();
	label.TextScaled = true;
	label.TextColor3 = color;
	label.TextStrokeColor3 = stroke;
	label.TextTransparency = HIDDEN;
	label.TextStrokeTransparency = HIDDEN;
	label.Parent = surface;
	surface.Parent = part;
	part.Parent = folder;
	return { part, surface, label };
}

/** The floor texts' Part top (studs): the combo shout's layer, COMBO_SHOUT_DRAW.layerStepsBelowEffects under the effects. */
export function floorTextTopStuds(): number {
	const V = FX_SPRITE_VIEW;
	return floorStudsY() + V.liftStuds - COMBO_SHOUT_DRAW.layerStepsBelowEffects * V.layerStepStuds;
}
