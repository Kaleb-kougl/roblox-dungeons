import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { createKvBillboardGui } from "client/ui";
import { STUDS_PER_TILE } from "shared/config";
import { pactAltarsPlaced, type RunState, type SimState } from "shared/sim";
import type { ImageRef } from "shared/theme";
import { RENDER_ORDER, SPRITE_VIEW, floorStudsY, studsX, studsZ, uprightImageBillboard } from "shared/view";
import { MARKER_USED_COLOR_ROLE, PEDESTAL_COLOR_ROLE, PROGRESSION_VIEW, SHRINE_COLOR_ROLE } from "shared/view/hud";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { renderPart } from "./placeholders";

const RENDER_STEP = "KV_RunMarkers";
const FOLDER_NAME = "KV_RunMarkers";
const HALF = 0.5;
/** Fully transparent (the beam anchor, the label background). */
const HIDDEN = 1;
/** A Cylinder's axis is X: turn it upright. */
const UPRIGHT = CFrame.Angles(0, 0, math.pi * HALF);

interface Marker {
	readonly part: Part;
	/** Pedestal index into RunState.pedestalTaken, or -1 for the shrine. */
	readonly pedestal: number;
	/** The `ui.marker.pedestal` beam over a live pedestal (when the pack has the image). */
	readonly beam: BillboardGui | undefined;
	used: boolean;
}

/**
 * M2 in-run progression in the world (endless runs): a relic pedestal on each TREASURE room's centre tile and the
 * curse shrine's zone in the SHRINE room, as placeholder primitives (Cylinders) tinted by theme colour roles
 * (shared/view/hud PEDESTAL_COLOR_ROLE / SHRINE_COLOR_ROLE; a taken pedestal or used shrine dims to
 * MARKER_USED_COLOR_ROLE). When the pack has the `ui.marker.pedestal` image, a camera-facing beam (BillboardGui, its
 * pivot (the image's own, else its bottom centre) on the pedestal's top, PROGRESSION_VIEW.pedestalBeamHeightTiles tall) stands on each live pedestal and
 * is hidden once it is taken. Rebuilt on run start and every floor change from the floor's encounter rooms; their state
 * read from the sim's RunState every frame. Read-only on the sim.
 */
@Controller({})
export class RunMarkerController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly floorJanitor = new Janitor();
	private readonly markers = new Array<Marker>();

	constructor(private readonly sim: SimController, private readonly theme: ThemeController) {}

	onStart(): void {
		this.sim.onRunStarted((ctx) => this.build(ctx));
		this.sim.onFloorChanged((ctx) => this.build(ctx));
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
		this.janitor.Add(this.floorJanitor, "Cleanup");
	}

	private build(ctx: RunContext): void {
		this.floorJanitor.Cleanup();
		this.markers.clear();
		const run = ctx.run.state.run;
		const encounter = ctx.config.encounter;
		if (run === undefined || encounter === undefined) return;
		const folder = this.floorJanitor.Add(new Instance("Folder"));
		folder.Name = FOLDER_NAME;
		const v = PROGRESSION_VIEW;
		const beam = this.theme.getPack().image(v.pedestalBeamVisualId);
		for (let k = 0; k < run.pedestalRooms.size(); k++) {
			const room = encounter.rooms[run.pedestalRooms[k]];
			if (room === undefined) continue;
			this.add(folder, room.cx, room.cz, v.pedestalRadiusTiles, v.pedestalHeightTiles, k, beam);
		}
		const shrine = encounter.rooms[run.shrineRoom];
		if (shrine !== undefined) {
			this.add(folder, shrine.cx, shrine.cz, v.shrineRadiusTiles, v.shrineHeightTiles, -1, undefined);
		}
		folder.Parent = Workspace;
		this.refresh(ctx.run.state, run, true);
	}

	private add(
		folder: Folder,
		x: number,
		z: number,
		radius: number,
		height: number,
		pedestal: number,
		beamImage: ImageRef | undefined,
	): void {
		const S = STUDS_PER_TILE;
		const part = renderPart("Part", pedestal >= 0);
		part.Shape = Enum.PartType.Cylinder;
		part.Name = pedestal >= 0 ? `Pedestal${pedestal}` : "Shrine";
		part.Size = new Vector3(height * S, radius * 2 * S, radius * 2 * S);
		part.CFrame = new CFrame(studsX(x), floorStudsY() + height * S * HALF, studsZ(z)).mul(UPRIGHT);
		part.Material = Enum.Material.Neon;
		part.Parent = folder;
		const beam =
			beamImage !== undefined
				? buildBeam(folder, beamImage, new Vector3(studsX(x), floorStudsY() + height * S, studsZ(z)))
				: undefined;
		this.markers.push({ part, pedestal, beam, used: false });
	}

	private frame(): void {
		const state = this.sim.getContext()?.run.state;
		const run = state?.run;
		if (state !== undefined && run !== undefined) this.refresh(state, run, false);
	}

	/**
	 * Colours each marker for its state (only when it changed, unless `force`). The shrine's reads as used on a floor
	 * whose pact altars stand (docs/FORTUNE.md FO7: the classic zone at the crystal is off there; the altars' flames and
	 * cards carry the offer).
	 */
	private refresh(state: Readonly<SimState>, run: Readonly<RunState>, force: boolean): void {
		const pack = this.theme.getPack();
		const altars = pactAltarsPlaced(state);
		for (const m of this.markers) {
			const used = m.pedestal >= 0 ? run.pedestalTaken[m.pedestal] === 1 : run.shrineUsed === 1 || altars;
			if (used === m.used && !force) continue;
			m.used = used;
			const live = m.pedestal >= 0 ? PEDESTAL_COLOR_ROLE : SHRINE_COLOR_ROLE;
			m.part.Color = pack.color(used ? MARKER_USED_COLOR_ROLE : live);
			m.part.Transparency = used ? PROGRESSION_VIEW.usedTransparency : 0;
			if (m.beam !== undefined) m.beam.Enabled = !used;
		}
	}
}

/** A camera-facing beam standing on `top` (an invisible anchor Part there; the billboard's bottom centre on it). */
function buildBeam(folder: Folder, image: ImageRef, top: Vector3): BillboardGui {
	const anchor = renderPart("Part", false);
	anchor.Name = "PedestalBeam";
	anchor.Transparency = HIDDEN;
	anchor.Size = new Vector3(SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds, SPRITE_VIEW.anchorStuds);
	anchor.CFrame = new CFrame(top);
	const b = uprightImageBillboard(image.w, image.h, PROGRESSION_VIEW.pedestalBeamHeightTiles, image.pivot);
	const gui = createKvBillboardGui("Beam");
	gui.Size = new UDim2(b.w, 0, b.h, 0);
	gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ);
	gui.LightInfluence = 0;
	gui.AlwaysOnTop = false;
	gui.Adornee = anchor;
	const label = new Instance("ImageLabel");
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.Size = UDim2.fromScale(1, 1);
	label.Image = image.assetId;
	label.Parent = gui;
	gui.Parent = anchor;
	anchor.Parent = folder;
	return gui;
}
