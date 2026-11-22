import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { logWarn } from "client/log";
import { STUDS_PER_TILE } from "shared/config";
import { playerAt } from "shared/sim";
import type { ImageRef, ThemePack } from "shared/theme";
import { TutorialGuide, type TutorialMarker } from "shared/tutorial";
import { MARKING_VIEW, RENDER_ORDER, floorStudsY, lerp, studsX, studsZ } from "shared/view";
import { motionScale } from "shared/view/fx";
import {
	TUTORIAL_VIEW,
	tutorialArrowArm,
	tutorialArrowImageSize,
	tutorialArrowLook,
	tutorialArrowOnScreen,
} from "shared/view/hud";
import { FxTrackerController } from "../fx/FxTrackerController";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { TutorialController } from "../game/TutorialController";
import { renderPart } from "./placeholders";

const RENDER_STEP = "KV_TutorialArrow";
const FOLDER_NAME = "KV_TutorialArrow";
const HIDDEN = 1;
/** The image's top edge is the Decal-on-Top carrier's -Z (front) side: turn it half a turn so it points ahead. */
const IMAGE_AHEAD = CFrame.Angles(0, math.pi, 0);

interface Arrow {
	/** Placeholder: the chevron's two arms; image: the flat invisible Decal carrier. */
	readonly parts: ReadonlyArray<BasePart>;
	/** Each part's CFrame in the arrow's frame (origin at the chevron's centre, +Z along the heading), studs. */
	readonly offsets: ReadonlyArray<CFrame>;
	/** The `ui.arrow.tutorial` Decal (its transparency fades instead of the carrier's). */
	readonly decal: Decal | undefined;
	/** The last transparency written (HIDDEN while hidden), so unchanged frames write none. */
	transparency: number;
}

/**
 * The tutorial's guidance arrow (docs/TUTORIAL_ARROW.md §4): a flat chevron on the floor beside the player pointing
 * along the walkable path to the director's marker target. shared/tutorial TutorialGuide decides where it points,
 * whether it shows and its fade from the marker (TutorialController.getMarker), the floor's dungeon
 * (SimController.getContext), the interpolated local player and whether the target's floor point is on screen
 * (Camera:WorldToViewportPoint, inset by TUTORIAL_VIEW.arrowScreenInset: shared/view/hud tutorialArrowOnScreen);
 * shared/view/hud tutorialArrowLook adds the forward slide (scaled by the juice motionScale) and the transparency.
 *
 * Placeholder: two thin Neon Parts in TUTORIAL_VIEW.arrowRole (`uiAccent`) forming the chevron
 * (arrowLengthTiles x arrowWidthTiles, arms arrowBarTiles wide). With the pack image TUTORIAL_VIEW.arrowImageId
 * (`ui.arrow.tutorial`; none in the placeholder pack) a Decal on a flat invisible Part instead. Both lie at
 * arrowLiftFraction of MARKING_VIEW.liftTiles above the floor, under the telegraph / weapon markings and bullets.
 * Per shown frame: one CFrame write per Part, a transparency write only when it changed; hidden frames write nothing
 * once hidden. Built per tutorial run (Janitor), nothing at all for other runs. Read-only on the sim.
 */
@Controller({})
export class TutorialArrowController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly runJanitor = new Janitor();
	private arrow: Arrow | undefined;
	private guide: TutorialGuide | undefined;
	/** The run already warned that its target has no path (GuideView.unreachable). */
	private warned = false;

	constructor(
		private readonly sim: SimController,
		private readonly tutorial: TutorialController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		this.janitor.Add(this.runJanitor, "Cleanup");
		this.sim.onRunStarted((ctx) => this.build(ctx));
		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			(dt) => this.frame(dt),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private build(ctx: RunContext): void {
		this.runJanitor.Cleanup();
		this.arrow = undefined;
		this.guide = undefined;
		this.warned = false;
		if (!ctx.tutorial) return;
		const pack = this.theme.getPack();
		const folder = this.runJanitor.Add(new Instance("Folder"));
		folder.Name = FOLDER_NAME;
		const image = pack.image(TUTORIAL_VIEW.arrowImageId);
		this.arrow = image !== undefined ? buildImage(folder, image) : buildChevron(folder, pack);
		folder.Parent = Workspace;
		this.guide = new TutorialGuide(TUTORIAL_VIEW);
	}

	private frame(dt: number): void {
		const a = this.arrow;
		const guide = this.guide;
		if (a === undefined || guide === undefined) return;
		const ctx = this.sim.getContext();
		const state = this.sim.getState();
		const dungeon = ctx?.dungeon;
		if (ctx === undefined || state === undefined || dungeon === undefined) {
			hide(a);
			return;
		}
		const target = this.tutorial.getMarker();
		const alpha = this.sim.getAlpha();
		const p = playerAt(state, ctx.localIndex);
		const px = lerp(p.prevX, p.x, alpha);
		const pz = lerp(p.prevZ, p.z, alpha);
		const view = guide.update({
			dungeon,
			target,
			px,
			pz,
			targetOnScreen: target !== undefined && targetOnScreen(target),
			dt,
		});
		if (view.unreachable && !this.warned && target !== undefined) {
			this.warned = true;
			logWarn(
				`[TutorialArrow] no path to the ${target.kind} marker at (${target.x}, ${target.z}) from ` +
					`(${px}, ${pz}); pointing straight at it`,
			);
		}
		if (!view.visible) {
			hide(a);
			return;
		}
		const v = TUTORIAL_VIEW;
		const S = STUDS_PER_TILE;
		const look = tutorialArrowLook(os.clock(), motionScale(this.fx.settings()), view.alpha);
		const h = view.heading;
		const sin = math.sin(h);
		const cos = math.cos(h);
		const y = floorStudsY() + MARKING_VIEW.liftTiles * S * v.arrowLiftFraction;
		const frame = new CFrame(studsX(view.x + sin * look.slideTiles), y, studsZ(view.z + cos * look.slideTiles)).mul(
			CFrame.Angles(0, h, 0),
		);
		for (let i = 0; i < a.parts.size(); i++) a.parts[i].CFrame = frame.mul(a.offsets[i]);
		if (look.transparency !== a.transparency) setTransparency(a, look.transparency);
	}
}

/** The target's floor point is in front of the camera and inside the inset viewport (TutorialGuide's targetOnScreen). */
function targetOnScreen(target: TutorialMarker): boolean {
	const camera = Workspace.CurrentCamera;
	if (camera === undefined) return false;
	const [point] = camera.WorldToViewportPoint(new Vector3(studsX(target.x), floorStudsY(), studsZ(target.z)));
	const size = camera.ViewportSize;
	return tutorialArrowOnScreen(point.X, point.Y, point.Z, size.X, size.Y);
}

function setTransparency(a: Arrow, t: number): void {
	a.transparency = t;
	if (a.decal !== undefined) a.decal.Transparency = t;
	else for (const part of a.parts) part.Transparency = t;
}

function hide(a: Arrow): void {
	if (a.transparency !== HIDDEN) setTransparency(a, HIDDEN);
}

/** The placeholder chevron: two thin Neon bars from the tail corners to the tip (shared/view/hud tutorialArrowArm). */
function buildChevron(folder: Folder, pack: ThemePack): Arrow {
	const v = TUTORIAL_VIEW;
	const S = STUDS_PER_TILE;
	const arm = tutorialArrowArm();
	const color = pack.color(v.arrowRole);
	const parts = new Array<BasePart>();
	const offsets = new Array<CFrame>();
	for (const side of [1, -1]) {
		const part = renderPart("Part", false);
		part.Name = "TutorialArrowArm";
		part.Size = new Vector3(v.arrowBarTiles * S, v.arrowThicknessStuds, arm.lengthTiles * S);
		part.Material = Enum.Material.Neon;
		part.Color = color;
		part.Transparency = HIDDEN;
		part.Parent = folder;
		parts.push(part);
		offsets.push(new CFrame(side * arm.centreAcrossTiles * S, 0, 0).mul(CFrame.Angles(0, side * arm.yaw, 0)));
	}
	return { parts, offsets, decal: undefined, transparency: HIDDEN };
}

/** The `ui.arrow.tutorial` image as a Decal on a flat invisible Part (shared/view/hud tutorialArrowImageSize). */
function buildImage(folder: Folder, image: ImageRef): Arrow {
	const S = STUDS_PER_TILE;
	const [across, along] = tutorialArrowImageSize(image.w, image.h);
	const part = renderPart("Part", false);
	part.Name = "TutorialArrowImage";
	part.Transparency = HIDDEN;
	part.Size = new Vector3(across * S, TUTORIAL_VIEW.arrowThicknessStuds, along * S);
	const decal = new Instance("Decal");
	decal.Face = Enum.NormalId.Top;
	decal.Texture = image.assetId;
	decal.Transparency = HIDDEN;
	decal.Parent = part;
	part.Parent = folder;
	return { parts: [part], offsets: [IMAGE_AHEAD], decal, transparency: HIDDEN };
}
