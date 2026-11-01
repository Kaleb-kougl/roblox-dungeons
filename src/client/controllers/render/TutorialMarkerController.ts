import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { createKvBillboardGui } from "client/ui";
import { STUDS_PER_TILE } from "shared/config";
import type { ImageRef } from "shared/theme";
import { RENDER_ORDER, SPRITE_VIEW, floorStudsY, studsX, studsZ, uprightImageBillboard } from "shared/view";
import { motionScale } from "shared/view/fx";
import { TUTORIAL_VIEW, tutorialMarkerLook } from "shared/view/hud";
import { FxTrackerController } from "../fx/FxTrackerController";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { TutorialController } from "../game/TutorialController";
import { renderPart } from "./placeholders";

const RENDER_STEP = "KV_TutorialMarker";
const FOLDER_NAME = "KV_TutorialMarker";
const HALF = 0.5;
const HIDDEN = 1;
/** A Cylinder's axis is X: turn it upright. */
const UPRIGHT = CFrame.Angles(0, 0, math.pi * HALF);

interface Marker {
	readonly part: Part;
	/** The `ui.marker.tutorial` beam (only when the pack has that image) and its anchor. */
	readonly beam: BillboardGui | undefined;
	readonly beamAnchor: Part | undefined;
	shown: boolean;
}

/**
 * The tutorial's world marker (docs/TUTORIAL.md §4): one upright beam on the target the TutorialDirector names for the
 * current step (the next lesson room's door, the pedestal, the shrine, the stairwell, the live boss), placed at the
 * view's world XZ (sim units -> studs through shared/view studsX / studsZ). A placeholder Cylinder in the theme role
 * TUTORIAL_VIEW.markerRole (`uiAccent`); when the pack has the image TUTORIAL_VIEW.markerImageId (`ui.marker.tutorial`)
 * a camera-facing beam (BillboardGui) stands on it as well. It bobs and breathes gently, scaled by the juice
 * motionScale (still under reduced motion). Hidden when the view has no marker, outside tutorial runs and once the
 * tutorial ended; built per tutorial run (Janitor), nothing at all for other runs. Read-only on the sim.
 */
@Controller({})
export class TutorialMarkerController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly runJanitor = new Janitor();
	private marker: Marker | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly tutorial: TutorialController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		this.janitor.Add(this.runJanitor, "Cleanup");
		this.sim.onRunStarted((ctx) => this.build(ctx));
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private build(ctx: RunContext): void {
		this.runJanitor.Cleanup();
		this.marker = undefined;
		if (!ctx.tutorial) return;
		const v = TUTORIAL_VIEW;
		const S = STUDS_PER_TILE;
		const pack = this.theme.getPack();
		const folder = this.runJanitor.Add(new Instance("Folder"));
		folder.Name = FOLDER_NAME;
		const part = renderPart("Part", false);
		part.Name = "TutorialMarker";
		part.Shape = Enum.PartType.Cylinder;
		part.Size = new Vector3(v.markerHeightTiles * S, v.markerRadiusTiles * 2 * S, v.markerRadiusTiles * 2 * S);
		part.Material = Enum.Material.Neon;
		part.Color = pack.color(v.markerRole);
		part.Transparency = HIDDEN;
		part.Parent = folder;
		const image = pack.image(v.markerImageId);
		let beam: BillboardGui | undefined;
		let beamAnchor: Part | undefined;
		if (image !== undefined) [beam, beamAnchor] = buildBeam(folder, image);
		folder.Parent = Workspace;
		this.marker = { part, beam, beamAnchor, shown: false };
	}

	private frame(): void {
		const m = this.marker;
		if (m === undefined) return;
		const target = this.tutorial.getMarker();
		if (target === undefined) {
			if (m.shown) {
				m.shown = false;
				m.part.Transparency = HIDDEN;
				if (m.beam !== undefined) m.beam.Enabled = false;
			}
			return;
		}
		const v = TUTORIAL_VIEW;
		const S = STUDS_PER_TILE;
		const look = tutorialMarkerLook(os.clock(), motionScale(this.fx.settings()));
		const x = studsX(target.x);
		const z = studsZ(target.z);
		const bottom = floorStudsY() + look.liftTiles * S;
		m.part.CFrame = new CFrame(x, bottom + v.markerHeightTiles * S * HALF, z).mul(UPRIGHT);
		m.part.Transparency = look.transparency;
		if (m.beamAnchor !== undefined) m.beamAnchor.CFrame = new CFrame(x, bottom + v.markerHeightTiles * S, z);
		if (!m.shown) {
			m.shown = true;
			if (m.beam !== undefined) m.beam.Enabled = true;
		}
	}
}

/** A camera-facing beam (the theme image) whose pivot stands on an invisible anchor Part (moved with the marker). */
function buildBeam(folder: Folder, image: ImageRef): [BillboardGui, Part] {
	const anchor = renderPart("Part", false);
	anchor.Name = "TutorialMarkerBeam";
	anchor.Transparency = HIDDEN;
	anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
	const b = uprightImageBillboard(image.w, image.h, TUTORIAL_VIEW.markerImageHeightTiles, image.pivot);
	const gui = createKvBillboardGui("Beam");
	gui.Size = new UDim2(b.w, 0, b.h, 0);
	gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ);
	gui.LightInfluence = 0;
	gui.AlwaysOnTop = false;
	gui.Enabled = false;
	gui.Adornee = anchor;
	const label = new Instance("ImageLabel");
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Size = UDim2.fromScale(1, 1);
	label.Image = image.assetId;
	label.Parent = gui;
	gui.Parent = anchor;
	anchor.Parent = folder;
	return [gui, anchor];
}
