import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { createKvBillboardGui } from "client/ui";
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import { SIM_HZ, pactAltarsPlaced, partySize, pedestalOffered, type RunState, type SimState } from "shared/sim";
import {
	TREASURE_CHEST_ID,
	TREASURE_CHEST_OPEN_ID,
	TREASURE_COLUMN_FX_ID,
	treasureFloorRole,
	type ImageRef,
	type ThemePack,
	type TreasurePiece,
} from "shared/theme";
import {
	RENDER_ORDER,
	ReadinessCursor,
	SPRITE_VIEW,
	animDtSec,
	degToRad,
	floorStudsY,
	isoBasis,
	lookWhenReady,
	studsX,
	studsZ,
	uprightImageBillboard,
} from "shared/view";
import { burstSeed, effectiveParticles } from "shared/view/fx";
import { MARKER_USED_COLOR_ROLE, PROGRESSION_VIEW, SHRINE_COLOR_ROLE } from "shared/view/hud";
import {
	PedestalChestTracker,
	TREASURE_VIEW,
	newPedestalChestLook,
	type PedestalChestLook,
} from "shared/view/treasure";
import { FreezeFrameController } from "../fx/FreezeFrameController";
import { FxTrackerController } from "../fx/FxTrackerController";
import { ParticleController } from "../fx/ParticleController";
import { PreloadController } from "../game/PreloadController";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { renderPart } from "./placeholders";
import {
	buildPieceBody,
	buildTreasureColumn,
	destroyPieceBody,
	drawTreasureColumn,
	hidePieceBody,
	placePieceBody,
	type PieceBody,
	type TreasureColumn,
} from "./treasureBody";

const RENDER_STEP = "KV_RunMarkers";
const FOLDER_NAME = "KV_RunMarkers";
const HALF = 0.5;
/** Fully transparent (the beam anchor, the label background). */
const HIDDEN = 1;
/** A Cylinder's axis is X: turn it upright. */
const UPRIGHT = CFrame.Angles(0, 0, math.pi * HALF);
const P = TREASURE_VIEW.pedestal;

/** A relic pedestal drawn as the vault's chest (docs/TREASURE.md "Relic pedestals"). */
interface Pedestal {
	/** Index into RunState.pedestalTaken. */
	readonly index: number;
	readonly x: number;
	readonly z: number;
	/** The chest's base on the floor, turned toward TREASURE_VIEW.pedestal's facing. */
	readonly rest: CFrame;
	/** Rebuilt when the chest art's readiness flips (docs/STAGE_ASSETS.md SA18). */
	closed: PieceBody;
	opened: PieceBody;
	readonly column: TreasureColumn;
	/** The `ui.marker.pedestal` beam over a live pedestal (when the pack has the image). */
	readonly beam: BillboardGui | undefined;
	readonly look: PedestalChestLook;
	/** What was last drawn (bodies are placed only when it changes). */
	drawnShown: boolean;
	drawnOpen: boolean;
	drawnLift: number;
	columnOn: boolean;
	/** Bodies rebuilt (SA18): placed on the next draw whatever was drawn. */
	redraw: boolean;
}

/** The curse shrine's zone. */
interface Shrine {
	readonly part: Part;
	used: boolean | undefined;
}

/**
 * M2 in-run progression in the world (endless runs): a relic pedestal on each TREASURE room's centre tile and the
 * curse shrine's zone in the SHRINE room.
 *
 * A pedestal is drawn as the vault's chest (`treasure.chest`: the pack's art, else its placeholder model; shared
 * treasureBody helpers), turned to TREASURE_VIEW.pedestal's facing. Taking its relic plays the vault's opening (pure
 * PedestalChestTracker on sim time: the lid's jolt, the pop to `treasure.chestopen` with the solo freeze, the `stamp`
 * nudge and the ring burst, then the light column, both in TREASURE_VIEW.pedestal.tier's floor colour) and the open
 * chest stays. The take's own toast, `fx.relic.take` and `sfx.relic.take` are unchanged (other views). When the pack
 * has the `ui.marker.pedestal` image, a camera-facing beam (BillboardGui, its pivot (the image's own, else its bottom
 * centre) PROGRESSION_VIEW.pedestalHeightTiles above the chest's base, behind the chest's billboard,
 * PROGRESSION_VIEW.pedestalBeamHeightTiles tall) stands on each live pedestal and is hidden once it is taken. A pedestal
 * nobody can take (every living player already owns every relic: shared/sim pedestalOffered) is not drawn at all, beam
 * included.
 *
 * Stand-ins (docs/STAGE_ASSETS.md SA18): the chests draw their placeholder until `treasure.chest` / `.chestopen` have
 * downloaded, rebuilt on the readiness flip (swapLooks); the column picks the Neon block or its art every frame.
 *
 * The shrine is a placeholder Cylinder tinted SHRINE_COLOR_ROLE, dimmed to MARKER_USED_COLOR_ROLE once used (or on a
 * floor whose pact altars stand). Rebuilt on run start and every floor change from the floor's encounter rooms; their
 * state read from the sim's RunState every frame. Read-only on the sim.
 */
@Controller({})
export class RunMarkerController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly floorJanitor = new Janitor();
	private readonly pedestals = new Array<Pedestal>();
	private readonly tracker = new PedestalChestTracker();
	private readonly basis = isoBasis(degToRad(CAMERA_YAW_DEG), degToRad(CAMERA_PITCH_DEG));
	private shrine: Shrine | undefined;
	private lastSimSec: number | undefined;
	/** The folder of the current floor's pedestals (bodies rebuilt into it). */
	private folder: Folder | undefined;
	/** The readiness flips this view has not handled yet (docs/STAGE_ASSETS.md SA18). */
	private cursor: ReadinessCursor | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly particles: ParticleController,
		private readonly freeze: FreezeFrameController,
		private readonly preload: PreloadController,
	) {}

	onStart(): void {
		this.cursor = new ReadinessCursor(this.preload.getReadiness());
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
		this.pedestals.clear();
		this.shrine = undefined;
		this.lastSimSec = undefined;
		const run = ctx.run.state.run;
		const encounter = ctx.config.encounter;
		if (run === undefined || encounter === undefined) return;
		const folder = this.floorJanitor.Add(new Instance("Folder"));
		folder.Name = FOLDER_NAME;
		this.folder = folder;
		const pack = this.theme.getPack();
		const beam = pack.image(PROGRESSION_VIEW.pedestalBeamVisualId);
		const chest = run.pedestalRooms.size() > 0 ? this.lookOf(pack, TREASURE_CHEST_ID) : undefined;
		const open = run.pedestalRooms.size() > 0 ? this.lookOf(pack, TREASURE_CHEST_OPEN_ID) : undefined;
		for (let k = 0; k < run.pedestalRooms.size(); k++) {
			const room = encounter.rooms[run.pedestalRooms[k]];
			if (room === undefined || chest === undefined || open === undefined) continue;
			const closed = buildPieceBody(pack, chest, folder, TREASURE_VIEW.maxHeightTiles);
			const opened = buildPieceBody(pack, open, folder, TREASURE_VIEW.openMaxHeightTiles);
			hidePieceBody(closed);
			hidePieceBody(opened);
			const base = new Vector3(studsX(room.cx), floorStudsY() + TREASURE_VIEW.liftStuds, studsZ(room.cz));
			const beamTop = new Vector3(
				base.X,
				floorStudsY() + PROGRESSION_VIEW.pedestalHeightTiles * STUDS_PER_TILE,
				base.Z,
			);
			this.pedestals.push({
				index: k,
				x: room.cx,
				z: room.cz,
				rest: CFrame.lookAt(base, base.add(new Vector3(P.faceX, 0, P.faceZ))),
				closed,
				opened,
				column: buildTreasureColumn(pack, folder),
				beam: beam !== undefined ? buildBeam(folder, beam, beamTop) : undefined,
				look: newPedestalChestLook(),
				drawnShown: false,
				drawnOpen: false,
				drawnLift: 0,
				columnOn: false,
				redraw: false,
			});
		}
		const pedestals = [...this.pedestals];
		this.floorJanitor.Add(() => {
			for (const p of pedestals) {
				destroyPieceBody(p.closed);
				destroyPieceBody(p.opened);
			}
		}, true);
		this.tracker.reset(run.pedestalTaken);
		const shrine = encounter.rooms[run.shrineRoom];
		if (shrine !== undefined) this.shrine = { part: buildShrine(folder, shrine.cx, shrine.cz), used: undefined };
		folder.Parent = Workspace;
		this.frame();
	}

	private frame(): void {
		const ctx = this.sim.getContext();
		const state = ctx?.run.state;
		const run = state?.run;
		if (state === undefined || run === undefined) return;
		const simSec = (state.tick + this.sim.getAlpha()) / SIM_HZ;
		const dtSec = animDtSec(this.lastSimSec, simSec);
		this.lastSimSec = simSec;
		if (this.pedestals.size() > 0) {
			this.swapLooks();
			this.drawPedestals(state, run, simSec, dtSec);
		}
		if (this.shrine !== undefined) this.drawShrine(state, run, this.shrine);
	}

	private drawPedestals(state: Readonly<SimState>, run: Readonly<RunState>, simSec: number, dtSec: number): void {
		const settings = this.fx.settings();
		const particles = effectiveParticles(settings) !== "off";
		const color = this.theme.getPack().color(treasureFloorRole(P.tier));
		for (const p of this.pedestals) {
			const look = this.tracker.update(
				p.index,
				run.pedestalTaken[p.index] === 1,
				pedestalOffered(state, p.index),
				simSec,
				settings.reducedMotion,
				particles,
				p.look,
			);
			if (
				p.redraw ||
				look.shown !== p.drawnShown ||
				look.open !== p.drawnOpen ||
				look.liftStuds !== p.drawnLift
			) {
				p.redraw = false;
				p.drawnShown = look.shown;
				p.drawnOpen = look.open;
				p.drawnLift = look.liftStuds;
				const show = look.open ? p.opened : p.closed;
				hidePieceBody(look.open ? p.closed : p.opened);
				if (!look.shown) hidePieceBody(show);
				else {
					const origin = look.liftStuds !== 0 ? p.rest.add(new Vector3(0, look.liftStuds, 0)) : p.rest;
					placePieceBody(show, origin, this.basis, dtSec, P.faceX, P.faceZ);
				}
				if (p.beam !== undefined) p.beam.Enabled = look.shown && run.pedestalTaken[p.index] !== 1;
			}
			if (look.popEdge) {
				if (partySize(state) <= 1) this.sim.hitstop.request(TREASURE_VIEW.open.freezeMs, settings);
				this.freeze.requestNudge("stamp");
				this.particles.treasureBurst(
					p.x,
					p.z,
					P.tier,
					burstSeed(p.index, state.tick, TREASURE_VIEW.open.seedSalt),
				);
			}
			if (look.column.shown || p.columnOn) {
				p.columnOn = look.column.shown;
				drawTreasureColumn(
					p.column,
					look.column,
					p.rest.Position,
					color,
					look.openAge,
					this.preload.isArtReady(TREASURE_COLUMN_FX_ID),
				);
			}
		}
	}

	/** A chest look: its art once downloaded, else the stand-in placeholder (docs/STAGE_ASSETS.md SA18). */
	private lookOf(pack: ThemePack, id: string): TreasurePiece {
		return lookWhenReady(pack.treasurePiece(id), this.preload.isArtReady(id));
	}

	/**
	 * docs/STAGE_ASSETS.md SA18: a chest id whose art readiness flipped gets every pedestal's body of it rebuilt in the
	 * new look; the next draw places the right one (drawnShown reset).
	 */
	private swapLooks(): void {
		const flipped = this.cursor?.take();
		const folder = this.folder;
		if (flipped === undefined || flipped.size() === 0 || folder === undefined) return;
		const pack = this.theme.getPack();
		const closed = flipped.includes(TREASURE_CHEST_ID);
		const opened = flipped.includes(TREASURE_CHEST_OPEN_ID);
		if (!closed && !opened) return;
		const chest = this.lookOf(pack, TREASURE_CHEST_ID);
		const open = this.lookOf(pack, TREASURE_CHEST_OPEN_ID);
		for (const p of this.pedestals) {
			if (closed) {
				destroyPieceBody(p.closed);
				p.closed = buildPieceBody(pack, chest, folder, TREASURE_VIEW.maxHeightTiles);
				hidePieceBody(p.closed);
			}
			if (opened) {
				destroyPieceBody(p.opened);
				p.opened = buildPieceBody(pack, open, folder, TREASURE_VIEW.openMaxHeightTiles);
				hidePieceBody(p.opened);
			}
			// redraw on the next frame: the new bodies start hidden
			p.redraw = true;
		}
	}

	/** The shrine reads as used on a floor whose pact altars stand (docs/FORTUNE.md FO7). */
	private drawShrine(state: Readonly<SimState>, run: Readonly<RunState>, shrine: Shrine): void {
		const used = run.shrineUsed === 1 || pactAltarsPlaced(state);
		if (used === shrine.used) return;
		shrine.used = used;
		shrine.part.Color = this.theme.getPack().color(used ? MARKER_USED_COLOR_ROLE : SHRINE_COLOR_ROLE);
		shrine.part.Transparency = used ? PROGRESSION_VIEW.usedTransparency : 0;
	}
}

/** The shrine's zone: a flat self-lit Cylinder on the SHRINE room's centre. */
function buildShrine(folder: Folder, x: number, z: number): Part {
	const S = STUDS_PER_TILE;
	const v = PROGRESSION_VIEW;
	const part = renderPart("Part", false);
	part.Shape = Enum.PartType.Cylinder;
	part.Name = "Shrine";
	part.Size = new Vector3(v.shrineHeightTiles * S, v.shrineRadiusTiles * 2 * S, v.shrineRadiusTiles * 2 * S);
	part.CFrame = new CFrame(studsX(x), floorStudsY() + v.shrineHeightTiles * S * HALF, studsZ(z)).mul(UPRIGHT);
	part.Material = Enum.Material.Neon;
	part.Parent = folder;
	return part;
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
