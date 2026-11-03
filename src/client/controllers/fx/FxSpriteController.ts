import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { createKvBillboardGui, createKvSurfaceGui } from "client/ui";
import { CAMERA_YAW_DEG, STUDS_PER_TILE } from "shared/config";
import { FX_IDS, type FxId, type FxSprite, type ThemePack } from "shared/theme";
import { RENDER_ORDER, degToRad, floorImageSize, floorStudsY, spriteBillboard, studsX, studsZ } from "shared/view";
import {
	FX_SPRITE_MAX_TILES,
	FX_SPRITE_VIEW,
	FX_VIEW,
	FxCueMapper,
	fxLabelRotationDeg,
	type FxCueFrame,
} from "shared/view/fx";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { DecorController } from "../render/DecorController";
import { renderPart } from "../render/placeholders";
import { FxTrackerController } from "./FxTrackerController";
import { fxFolder } from "./fxHelpers";

const V = FX_SPRITE_VIEW;
const PARKED = new CFrame(FX_VIEW.parkedStuds[0], FX_VIEW.parkedStuds[1], FX_VIEW.parkedStuds[2]);
const CAMERA_YAW = CFrame.Angles(0, degToRad(CAMERA_YAW_DEG), 0);
const HIDDEN = 1;
const CENTRE = new Vector2(0.5, 0.5);
const LIT = 1;
const SELF_LIT = 0;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * One pooled effect: an invisible anchor Part carrying a floor SurfaceGui (FX_SPRITE_VIEW.placement "floor") or a
 * BillboardGui ("billboard"), with one ImageLabel showing the flipbook frame. The canvas is a square of the cell's
 * diagonal, so a rotated label never clips; the label is the cell, centred.
 */
interface FxSlot {
	readonly part: Part;
	readonly surface: SurfaceGui | undefined;
	readonly billboard: BillboardGui | undefined;
	readonly label: ImageLabel;
	/** Pool index (picks the floor layer). */
	readonly index: number;
	sprite: FxSprite | undefined;
	startedAt: number;
	shownFrame: number;
	/** The label's Image as last written (read back from the property would cost an Instance read per frame). */
	image: string;
	live: boolean;
}

/**
 * Sprite effects (docs/FX_AUDIO.md F4): the pure FxCueMapper (shared/view/fx fxCues.ts) turns each frame's tracker
 * events, summed sim events and state into cues; this draws them with the theme's `fx.*` art (ThemePack.fx): pooled
 * slots (FxSlot), a flipbook through ImageRectOffset / ImageRectSize (FxSprite.frame), ImageColor3 = the tint,
 * `additive`: LightInfluence 0 and FX_SPRITE_VIEW.additiveBrightness, ImageLabel.Rotation from the cue (slash and
 * shield headings; fxLabelRotationDeg turns a floor SurfaceGui's canvas back to screen-up), the size from the theme (x the cue's scale). The stairwell loop (`mapper.loop`) has a slot of its
 * own while the stairwell is open.
 *
 * Placement (FX_SPRITE_VIEW.placement). "floor" (default): flat on the floor like the decor flats and the co-op ring
 * (floorImageSize: depth stretched by 1 / sin(pitch), turned by the camera yaw), at FX_SPRITE_VIEW.liftStuds plus a
 * per-slot layer step. That is under every floor marking (telegraphs, weapon fans, the aim line: MARKING_VIEW.liftTiles)
 * and every bullet (BULLET_Y), so an effect loses every overlap with them; a depth-tested camera-facing billboard can't
 * (above its anchor it stands in front of the floor behind it, and any shift away from the camera sinks its lower half
 * under the floor). Standing bodies draw over floor effects. "billboard": SpriteView's billboard (floor clearance and
 * SPRITE_VIEW.depthBiasStuds), for comparing in Studio.
 *
 * Time: the effect clock advances by the real frame time (clamped to maxFrameDt) x the hitstop clock's time scale, and
 * not at all while the run is paused or frozen, so effects freeze with hitstop like the particles. Finished one-shots
 * are parked (BulkMoveTo with the frame's starts). A new run, a new floor or no run parks everything. A pack without
 * any fx art (the bundled packs until the atlas is uploaded) makes this controller build nothing at all. Presentation
 * only; read-only on the sim.
 */
@Controller({})
export class FxSpriteController implements OnStart {
	private readonly janitor = new Janitor();
	private mapper: FxCueMapper | undefined;
	private pack: ThemePack | undefined;
	private folder: Folder | undefined;
	private readonly slots = new Array<FxSlot>();
	private readonly free = new Array<FxSlot>();
	private readonly live = new Array<FxSlot>();
	private loopSlot: FxSlot | undefined;
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private clock = 0;
	/** The mapper's frame input, refilled every frame (no allocation per frame). */
	private cueFrame: Mutable<FxCueFrame> | undefined;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly decor: DecorController,
	) {}

	onStart(): void {
		const pack = this.theme.getPack();
		let any = false;
		for (const id of FX_IDS) if (pack.fx(id) !== undefined) any = true;
		if (!any) return; // no effect art: today's look, nothing built
		this.pack = pack;
		this.mapper = new FxCueMapper((id) => {
			const s = pack.fx(id);
			return s !== undefined && s.fps > 0 ? s.frames / s.fps : undefined;
		});
		this.folder = this.janitor.Add(fxFolder(V.folderName));
		RunService.BindToRenderStep(
			V.renderStep,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			(dt) => this.frame(dt),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(V.renderStep), true);
	}

	/** A breakable piece broke at sim (x, z) (BreakableRenderController): splinters, on the next frame. */
	breakableSplinter(x: number, z: number): void {
		this.mapper?.breakableSplinter(x, z);
	}

	/** A boost drop was picked up at sim (x, z) (BoostDropRenderController): fx.boost.collect, on the next frame. */
	boostCollect(x: number, z: number): void {
		this.mapper?.boostCollect(x, z);
	}

	private frame(rawDt: number): void {
		const mapper = this.mapper;
		const ctx = this.sim.getContext();
		if (mapper === undefined) return;
		this.moveParts.clear();
		this.moveCFrames.clear();
		if (ctx === undefined) {
			this.parkAll();
			mapper.reset();
			this.flush();
			return;
		}
		debug.profilebegin(V.profileLabel);
		const paused = ctx.live?.isPaused() === true || this.sim.isFrozen();
		const dt = paused ? 0 : math.min(math.max(rawDt, 0), V.maxFrameDt) * this.sim.hitstop.timeScale();
		this.clock += dt;
		let f = this.cueFrame;
		if (f === undefined) {
			f = {
				now: this.clock,
				state: ctx.run.state,
				alpha: ctx.run.getAlpha(),
				events: ctx.run.frameEvents,
				pellets: ctx.run.pellets,
				fx: this.fx.tracker.events,
				settings: this.fx.settings(),
				spots: this.decor.getScene(),
			};
			this.cueFrame = f;
		} else {
			f.now = this.clock;
			f.state = ctx.run.state;
			f.alpha = ctx.run.getAlpha();
			f.events = ctx.run.frameEvents;
			f.pellets = ctx.run.pellets;
			f.fx = this.fx.tracker.events;
			f.settings = this.fx.settings();
			f.spots = this.decor.getScene();
		}
		const n = mapper.frame(f);
		if (mapper.dropAll) this.parkAll();
		for (let i = 0; i < n; i++) {
			const c = mapper.cues.at(i);
			this.start(c.id, c.x, c.z, c.rotationDeg, c.scale);
		}
		this.animate();
		this.updateLoop();
		this.flush();
		debug.profileend();
	}

	// --- slots -----------------------------------------------------------------------------------

	private slot(): FxSlot {
		const reused = this.free.pop();
		if (reused !== undefined) return reused;
		const index = this.slots.size();
		const part = renderPart("Part", false);
		part.Name = `Fx${index}`;
		part.Transparency = HIDDEN;
		part.CFrame = PARKED;
		const label = new Instance("ImageLabel");
		label.Name = "Frame";
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.AnchorPoint = CENTRE;
		label.Position = UDim2.fromScale(CENTRE.X, CENTRE.Y);
		label.ResampleMode = Enum.ResamplerMode.Pixelated;
		let surface: SurfaceGui | undefined;
		let billboard: BillboardGui | undefined;
		if (V.placement === "floor") {
			surface = createKvSurfaceGui("Surface");
			surface.Face = Enum.NormalId.Top;
			surface.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize;
			surface.AlwaysOnTop = false;
			surface.ResetOnSpawn = false;
			surface.Enabled = false;
			label.Parent = surface;
			surface.Parent = part;
		} else {
			billboard = createKvBillboardGui("Billboard");
			billboard.AlwaysOnTop = false;
			billboard.ResetOnSpawn = false;
			billboard.Enabled = false;
			billboard.Adornee = part;
			label.Parent = billboard;
			billboard.Parent = part;
		}
		part.Parent = this.folder;
		const s: FxSlot = {
			part,
			surface,
			billboard,
			label,
			index,
			sprite: undefined,
			startedAt: 0,
			shownFrame: -1,
			image: "",
			live: false,
		};
		this.slots.push(s);
		return s;
	}

	/** Shows effect `id` at sim (x, z): sizes, tint, blend and rotation for this sprite, frame 0. */
	private show(s: FxSlot, sprite: FxSprite, x: number, z: number, rotationDeg: number, scale: number): void {
		s.sprite = sprite;
		s.startedAt = this.clock;
		s.shownFrame = -1;
		s.live = true;
		const set = sprite.set;
		const side = math.ceil(math.sqrt(set.frameW * set.frameW + set.frameH * set.frameH));
		const tiles = math.min(sprite.sizeTiles * scale, FX_SPRITE_MAX_TILES);
		const pixelsPerTile = math.max(set.frameW, set.frameH) / tiles;
		const label = s.label;
		label.Size = UDim2.fromScale(set.frameW / side, set.frameH / side);
		label.Rotation = fxLabelRotationDeg(rotationDeg, s.surface !== undefined ? "floor" : "billboard");
		label.ImageColor3 = sprite.color;
		label.ResampleMode = Enum.ResamplerMode[set.resample];
		const lightInfluence = sprite.additive ? SELF_LIT : LIT;
		const brightness = sprite.additive ? V.additiveBrightness : 1;
		let cf: CFrame;
		if (s.surface !== undefined) {
			const [w, d] = floorImageSize(side, side, pixelsPerTile, STUDS_PER_TILE);
			s.part.Size = new Vector3(w, V.thicknessStuds, d);
			s.surface.CanvasSize = new Vector2(side, side);
			s.surface.LightInfluence = lightInfluence;
			s.surface.Brightness = brightness;
			s.surface.Enabled = true;
			const top = floorStudsY() + V.liftStuds + (s.index % V.layers) * V.layerStepStuds;
			cf = new CFrame(studsX(x), top - V.thicknessStuds / 2, studsZ(z)).mul(CAMERA_YAW);
		} else {
			const b = spriteBillboard({
				frameW: side,
				frameH: side,
				pivot: { x: side / 2, y: side / 2 },
				pixelsPerTile,
			});
			const gui = s.billboard as BillboardGui;
			gui.Size = new UDim2(b.w, 0, b.h, 0);
			gui.StudsOffset = new Vector3(b.offsetX, b.offsetY, b.offsetZ);
			gui.LightInfluence = lightInfluence;
			gui.Brightness = brightness;
			gui.Enabled = true;
			cf = new CFrame(studsX(x), floorStudsY(), studsZ(z));
		}
		this.moveParts.push(s.part);
		this.moveCFrames.push(cf);
		this.setFrame(s, 0);
	}

	private setFrame(s: FxSlot, f: number): void {
		if (f === s.shownFrame || s.sprite === undefined) return;
		s.shownFrame = f;
		const r = s.sprite.frame(f);
		if (s.image !== r.image) {
			s.image = r.image;
			s.label.Image = r.image;
		}
		s.label.ImageRectOffset = r.offset;
		s.label.ImageRectSize = r.size;
	}

	private park(s: FxSlot): void {
		if (!s.live) return;
		s.live = false;
		s.sprite = undefined;
		if (s.surface !== undefined) s.surface.Enabled = false;
		if (s.billboard !== undefined) s.billboard.Enabled = false;
		this.moveParts.push(s.part);
		this.moveCFrames.push(PARKED);
	}

	private start(id: FxId, x: number, z: number, rotationDeg: number, scale: number): void {
		const sprite = this.pack?.fx(id);
		if (sprite === undefined) return;
		const s = this.slot();
		this.show(s, sprite, x, z, rotationDeg, scale);
		this.live.push(s);
	}

	/** Advances every live one-shot; parks the finished ones (their last frame has been shown its time). */
	private animate(): void {
		let i = 0;
		while (i < this.live.size()) {
			const s = this.live[i];
			const sprite = s.sprite;
			const f = sprite !== undefined ? math.floor((this.clock - s.startedAt) * sprite.fps) : 0;
			if (sprite === undefined || (!sprite.loop && f >= sprite.frames)) {
				this.park(s);
				this.free.push(s);
				this.live[i] = this.live[this.live.size() - 1];
				this.live.pop();
				continue;
			}
			this.setFrame(s, f);
			i++;
		}
	}

	private updateLoop(): void {
		const loop = (this.mapper as FxCueMapper).loop;
		let s = this.loopSlot;
		if (!loop.active) {
			if (s !== undefined) this.park(s);
			return;
		}
		const sprite = this.pack?.fx(loop.id);
		if (sprite === undefined) return;
		if (s === undefined) {
			s = this.slot();
			this.loopSlot = s;
		}
		if (!s.live) this.show(s, sprite, loop.x, loop.z, 0, 1);
		this.setFrame(s, math.floor((this.clock - s.startedAt) * sprite.fps) % math.max(1, sprite.frames));
	}

	private parkAll(): void {
		for (const s of this.live) {
			this.park(s);
			this.free.push(s);
		}
		this.live.clear();
		if (this.loopSlot !== undefined) this.park(this.loopSlot);
	}

	private flush(): void {
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}
}
