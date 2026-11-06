import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Players, RunService, UserInputService, Workspace } from "@rbxts/services";
import { BulletPattern, clientStore, selectBulletSpike } from "client/store";
import { createKvSurfaceGui } from "client/ui";
import { BULLET_SPIKE, STUDS_PER_TILE } from "shared/config";
import { SPIKE_ENGINE_TEXTURES, type SpriteFrame, type ThemePack } from "shared/theme";
import {
	BULLET_ART_VIEW,
	bulletYawAxes,
	floorCanvasOffset,
	floorCanvasRotation,
	type BulletYawAxes,
	type FloorCanvasPoint,
} from "shared/view";
import { ThemeController } from "../game/ThemeController";
import {
	createSpriteAnchor,
	spriteAnchorCFrame,
	spriteAnchorSize,
	spriteBulletLook,
	spriteBulletLookFrom,
	type SpriteBulletLook,
} from "../render/SpriteBulletPool";
import { watchSpikeFlag } from "./spikeFlags";

const COUNT_KEYS: ReadonlyArray<Enum.KeyCode> = [
	Enum.KeyCode.One,
	Enum.KeyCode.Two,
	Enum.KeyCode.Three,
	Enum.KeyCode.Four,
];
/** PA0's render modes, in BULLET_SPIKE.modes order (N / A / B / C). */
const MODE_KEYS: ReadonlyArray<Enum.KeyCode> = [
	Enum.KeyCode.Five,
	Enum.KeyCode.Six,
	Enum.KeyCode.Seven,
	Enum.KeyCode.Eight,
];
const PATTERN_KEY = Enum.KeyCode.P;
const PLAYERS_KEY = Enum.KeyCode.Zero;
const TAU = 2 * math.pi;
const MS_PER_SEC = 1000;
const DEG_PER_RAD = 180 / math.pi;
const HIDDEN = 1;
const SELF_LIT = 0;
const CENTRE = new Vector2(0.5, 0.5);
const S = BULLET_SPIKE.sprite;
/** Option (A) only: the Decal's turn (Decals keep the -Z-up convention SurfaceGuis do not; FX_SPRITE_VIEW). */
const DECAL_YAW_RAD = S.decalYawOffsetDeg / DEG_PER_RAD;
const DECAL_COS = math.cos(DECAL_YAW_RAD);
const DECAL_SIN = math.sin(DECAL_YAW_RAD);

type ModeId = (typeof BULLET_SPIKE.modes)[number]["id"];

/** The flipbook the sprite modes draw (S.frames frames). */
interface SpikeArt {
	/** "pack": ThemePack.bullet(S.lookId); "engine": SPIKE_ENGINE_TEXTURES (B / C read its strip as cells). */
	readonly source: string;
	/** Option (A): one texture per frame (a Decal cannot crop an atlas rect, so always the engine textures). */
	readonly decalTextures: ReadonlyArray<string>;
	/** Options (B) / (C): per frame, the image and its rect. */
	readonly images: ReadonlyArray<string>;
	readonly offsets: ReadonlyArray<Vector2>;
	readonly sizes: ReadonlyArray<Vector2>;
	/** Every frame is in the same image (an atlas or the strip): a frame change writes only ImageRectOffset / Size. */
	readonly oneImage: boolean;
	/**
	 * Option (B)'s look, built as production builds it (SpriteBulletPool spriteBulletLook: the art's size, canvas at
	 * BULLET_ART_VIEW.canvasPixelsPerArtPixel); with the engine stand-in, the bolt's S.artPx / S.lengthStuds / S.widthStuds.
	 */
	readonly look: SpriteBulletLook;
}

function spikeArt(pack: ThemePack): SpikeArt {
	const decalTextures = SPIKE_ENGINE_TEXTURES.decalFrames;
	const sprite = pack.bullet(S.lookId);
	const images = new Array<string>();
	const offsets = new Array<Vector2>();
	const sizes = new Array<Vector2>();
	if (sprite !== undefined) {
		for (let f = 0; f < S.frames; f++) {
			const r = sprite.frame(f);
			images.push(r.image);
			offsets.push(r.offset);
			sizes.push(r.size);
		}
	} else {
		const cellW = math.floor(S.fallbackStripPx[0] / S.frames);
		for (let f = 0; f < S.frames; f++) {
			images.push(SPIKE_ENGINE_TEXTURES.strip);
			offsets.push(new Vector2(f * cellW, 0));
			sizes.push(new Vector2(cellW, S.fallbackStripPx[1]));
		}
	}
	let oneImage = true;
	for (const image of images) if (image !== images[0]) oneImage = false;
	let look: SpriteBulletLook;
	if (sprite !== undefined) {
		look = spriteBulletLook(sprite, STUDS_PER_TILE);
	} else {
		const frames = new Array<SpriteFrame>();
		for (let f = 0; f < S.frames; f++) {
			const size = sizes[f];
			frames.push({ image: images[f], offset: offsets[f], size, pivot: { x: size.X / 2, y: size.Y / 2 } });
		}
		const artPx = new Vector2(S.artPx[0], S.artPx[1]);
		look = spriteBulletLookFrom(frames, S.fps, S.lengthStuds, S.widthStuds, artPx, Enum.ResamplerMode.Pixelated, 1);
	}
	return { source: sprite !== undefined ? "pack" : "engine", decalTextures, images, offsets, sizes, oneImage, look };
}

function colorOf(rgb: ReadonlyArray<number>): Color3 {
	return Color3.fromRGB(rgb[0], rgb[1], rgb[2]);
}

/** An invisible-to-physics render Part (anchored; no collision, queries, touch or shadows), as spike A's spheres. */
function spikePart(name: string): Part {
	const part = new Instance("Part");
	part.Name = name;
	part.Anchored = true;
	part.CanCollide = false;
	part.CanQuery = false;
	part.CanTouch = false;
	part.CastShadow = false;
	part.Locked = true;
	return part;
}

/** A Top-face SurfaceGui drawn unlit (FxSpriteController's floor construction), FixedSize at `canvas` pixels. */
function floorSurface(canvas: Vector2): SurfaceGui {
	const surface = createKvSurfaceGui("Surface");
	surface.Face = Enum.NormalId.Top;
	surface.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize;
	surface.CanvasSize = canvas;
	surface.AlwaysOnTop = false;
	surface.ResetOnSpawn = false;
	surface.LightInfluence = SELF_LIT;
	return surface;
}

/** A Pixelated ImageLabel showing frame 0 of `art`, tinted `tint`. */
function spriteLabel(art: SpikeArt, tint: Color3): ImageLabel {
	const label = new Instance("ImageLabel");
	label.Name = "Frame";
	label.BackgroundTransparency = HIDDEN;
	label.BorderSizePixel = 0;
	label.ResampleMode = Enum.ResamplerMode.Pixelated;
	label.Image = art.images[0];
	label.ImageRectOffset = art.offsets[0];
	label.ImageRectSize = art.sizes[0];
	label.ImageColor3 = tint;
	return label;
}

/**
 * One pool of spike bullets in one render mode. Every frame: RingLayout.fill writes positions (studs) and, for the
 * sprite modes, unit headings (the velocity's direction) into xs / zs / hxs / hzs; `build`
 * turns them into CFrames or GUI values (timed as compute with the layout), `move` hands them to the engine
 * (BulkMoveTo, or property writes for the canvas), `flip` writes the flipbook frame where it changed.
 */
abstract class SpikePool {
	count = 0;
	readonly xs = new Array<number>();
	readonly zs = new Array<number>();
	readonly hxs = new Array<number>();
	readonly hzs = new Array<number>();
	/** Last frame written per slot (-1: none). */
	protected readonly shown = new Array<number>();

	constructor(
		/** The sprite modes turn their bullets along the velocity; the neon spheres need no heading. */
		readonly headings: boolean,
		protected readonly tintOf: (index: number) => Color3,
	) {}

	abstract resize(count: number): void;
	abstract build(y: number): void;
	abstract move(): void;
	/** Frame of slot i = (frameBase + i) mod S.frames (PAD8: the phase from the slot index); written only on change. */
	abstract flip(frameBase: number): void;
	abstract destroy(): void;
}

/** Modes N / A / B: a Part per slot, created on first use, parked (Parent = nil) past the count, one BulkMoveTo. */
abstract class PartPool extends SpikePool {
	private readonly pool = new Array<BasePart>();
	private parts = new Array<BasePart>();
	protected cframes = new Array<CFrame>();

	constructor(headings: boolean, tintOf: (index: number) => Color3, private readonly folder: Folder) {
		super(headings, tintOf);
	}

	protected abstract create(index: number): BasePart;

	resize(count: number): void {
		while (this.pool.size() < count) {
			this.pool.push(this.create(this.pool.size()));
			this.shown.push(-1);
		}
		const parts = table.create<BasePart>(count);
		this.pool.forEach((part, i) => {
			part.Parent = i < count ? this.folder : undefined;
			if (i < count) {
				parts.push(part);
			}
		});
		this.parts = parts;
		this.cframes = table.create(count, CFrame.identity);
		this.count = count;
	}

	build(y: number): void {
		const cframes = this.cframes;
		const xs = this.xs;
		const zs = this.zs;
		if (!this.headings) {
			for (let i = 0; i < this.count; i++) {
				cframes[i] = new CFrame(xs[i], y, zs[i]);
			}
			return;
		}
		// (A) Flat on the floor, top face at y, LookVector (-Z) along the heading turned by S.decalYawOffsetDeg: a
		// Decal's Top-face up is assumed to be -Z (the Decal convention; SurfaceGuis differ, see SurfacePool).
		const hxs = this.hxs;
		const hzs = this.hzs;
		const cy = y - S.thicknessStuds / 2;
		for (let i = 0; i < this.count; i++) {
			const hx = hxs[i] * DECAL_COS - hzs[i] * DECAL_SIN;
			const hz = hzs[i] * DECAL_COS + hxs[i] * DECAL_SIN;
			cframes[i] = new CFrame(xs[i], cy, zs[i], -hz, 0, -hx, 0, 1, 0, hx, 0, -hz);
		}
	}

	move(): void {
		if (this.count > 0) {
			Workspace.BulkMoveTo(this.parts, this.cframes, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	flip(_frameBase: number): void {}

	destroy(): void {
		this.pool.forEach((part) => part.Destroy());
		this.pool.clear();
		this.parts.clear();
		this.count = 0;
	}
}

/** (N) Today's neon spheres: the baseline, exactly spike A's parts. */
class NeonPool extends PartPool {
	constructor(tintOf: (index: number) => Color3, folder: Folder) {
		super(false, tintOf, folder);
	}

	protected create(index: number): BasePart {
		const part = spikePart("Bullet");
		part.Shape = Enum.PartType.Ball;
		part.Size = Vector3.one.mul(BULLET_SPIKE.diameterStuds);
		part.Material = Enum.Material.Neon;
		part.Color = this.tintOf(index);
		return part;
	}
}

/** (A) A flat Part per slot with a Top-face Decal; the flicker swaps Decal.Texture between the frame textures. */
class DecalPool extends PartPool {
	private readonly decals = new Array<Decal>();

	constructor(tintOf: (index: number) => Color3, folder: Folder, private readonly art: SpikeArt) {
		super(true, tintOf, folder);
	}

	protected create(index: number): BasePart {
		const part = spikePart("Bullet");
		part.Size = new Vector3(S.widthStuds, S.thicknessStuds, S.lengthStuds);
		part.Transparency = HIDDEN;
		const decal = new Instance("Decal");
		decal.Face = Enum.NormalId.Top;
		decal.Texture = this.art.decalTextures[0];
		decal.Color3 = this.tintOf(index);
		decal.Parent = part;
		this.decals.push(decal);
		return part;
	}

	flip(frameBase: number): void {
		const shown = this.shown;
		const textures = this.art.decalTextures;
		const frames = textures.size();
		for (let i = 0; i < this.count; i++) {
			const f = (frameBase + i) % frames;
			if (shown[i] !== f) {
				shown[i] = f;
				this.decals[i].Texture = textures[f];
			}
		}
	}
}

/** Writes slot i's frame into its ImageLabel where it changed (options B and C). */
function flipLabels(
	labels: ReadonlyArray<ImageLabel>,
	shown: Array<number>,
	count: number,
	art: SpikeArt,
	base: number,
) {
	const offsets = art.offsets;
	const frames = offsets.size();
	for (let i = 0; i < count; i++) {
		const f = (base + i) % frames;
		if (shown[i] !== f) {
			shown[i] = f;
			const label = labels[i];
			if (!art.oneImage) {
				label.Image = art.images[f];
				label.ImageRectSize = art.sizes[f];
			}
			label.ImageRectOffset = offsets[f];
		}
	}
}

/**
 * (B) Production's SpriteBulletPool construction exactly: its anchor (createSpriteAnchor), canvas (the look's art
 * size x BULLET_ART_VIEW.canvasPixelsPerArtPixel), Part size (spriteAnchorSize: the length along local X under
 * BULLET_ART_VIEW.canvasTurnDeg 90) and CFrame (bulletYawAxes of the velocity + spriteAnchorCFrame, with the pool's
 * lift and per-slot layer step). Turning BULLET_ART_VIEW.canvasTurnDeg turns these bolts and production's alike.
 */
class SurfacePool extends PartPool {
	private readonly labels = new Array<ImageLabel>();
	private readonly axes: BulletYawAxes = { c: 1, s: 0 };

	constructor(
		tintOf: (index: number) => Color3,
		folder: Folder,
		private readonly art: SpikeArt,
		private readonly liftStuds: number,
	) {
		super(true, tintOf, folder);
	}

	protected create(index: number): BasePart {
		const look = this.art.look;
		const { part, surface, label } = createSpriteAnchor("Bullet", CFrame.identity);
		part.Size = spriteAnchorSize(look, 1);
		surface.CanvasSize = look.canvas;
		surface.Enabled = true;
		label.ResampleMode = look.resample;
		label.Image = this.art.images[0];
		label.ImageRectOffset = this.art.offsets[0];
		label.ImageRectSize = this.art.sizes[0];
		label.ImageColor3 = this.tintOf(index);
		this.labels.push(label);
		return part;
	}

	build(y: number): void {
		const cframes = this.cframes;
		const xs = this.xs;
		const zs = this.zs;
		const hxs = this.hxs;
		const hzs = this.hzs;
		const axes = this.axes;
		const V = BULLET_ART_VIEW;
		const base = y + this.liftStuds;
		for (let i = 0; i < this.count; i++) {
			const a = bulletYawAxes(hxs[i], hzs[i], axes);
			cframes[i] = spriteAnchorCFrame(xs[i], base + (i % V.layers) * V.layerStepStuds, zs[i], a);
		}
	}

	flip(frameBase: number): void {
		flipLabels(this.labels, this.shown, this.count, this.art, frameBase);
	}
}

/**
 * (C) ONE flat, unturned Part over the spike area with a Top-face SurfaceGui; an ImageLabel per slot, moved by
 * Position and Rotation writes (no Part moves). Positions and rotations follow production's canvas convention
 * (shared/view floorCanvasOffset / floorCanvasRotation: the canvas's up is -Z turned BULLET_ART_VIEW.canvasTurnDeg
 * anticlockwise seen from above; 90: up = world -X, right = world -Z), so the same knob turns B and C. The canvas
 * density stays BULLET_SPIKE.canvas.pxPerStud (one canvas over the whole area; production's 4 px per art pixel would
 * need a canvas of several thousand pixels).
 */
class CanvasPool extends SpikePool {
	private readonly part: Part;
	private readonly surface: SurfaceGui;
	private readonly labels = new Array<ImageLabel>();
	private readonly positions = new Array<UDim2>();
	private readonly rotations = new Array<number>();
	private readonly point: FloorCanvasPoint = { x: 0, y: 0 };
	private readonly cx: number;
	private readonly cz: number;
	private readonly halfPx: number;

	constructor(
		tintOf: (index: number) => Color3,
		folder: Folder,
		private readonly art: SpikeArt,
		cx: number,
		y: number,
		cz: number,
		lift: number,
	) {
		super(true, tintOf);
		const C = BULLET_SPIKE.canvas;
		const half = BULLET_SPIKE.maxRadiusStuds + C.marginStuds;
		this.cx = cx;
		this.cz = cz;
		this.halfPx = half * C.pxPerStud;
		const part = spikePart("Canvas");
		part.Size = new Vector3(2 * half, C.thicknessStuds, 2 * half);
		part.Transparency = HIDDEN;
		part.CFrame = new CFrame(cx, y + lift - C.thicknessStuds / 2, cz);
		const px = 2 * half * C.pxPerStud;
		this.surface = floorSurface(new Vector2(px, px));
		this.surface.Parent = part;
		part.Parent = folder;
		this.part = part;
	}

	resize(count: number): void {
		const C = BULLET_SPIKE.canvas;
		while (this.labels.size() < count) {
			const label = spriteLabel(this.art, this.tintOf(this.labels.size()));
			label.AnchorPoint = CENTRE;
			label.Size = UDim2.fromOffset(S.widthStuds * C.pxPerStud, S.lengthStuds * C.pxPerStud);
			label.Parent = this.surface;
			this.labels.push(label);
			this.shown.push(-1);
		}
		this.labels.forEach((label, i) => {
			label.Visible = i < count;
		});
		this.count = count;
	}

	build(_y: number): void {
		const pps = BULLET_SPIKE.canvas.pxPerStud;
		const xs = this.xs;
		const zs = this.zs;
		const hxs = this.hxs;
		const hzs = this.hzs;
		const positions = this.positions;
		const rotations = this.rotations;
		const point = this.point;
		const h = this.halfPx;
		for (let i = 0; i < this.count; i++) {
			floorCanvasOffset(xs[i] - this.cx, zs[i] - this.cz, pps, point);
			positions[i] = UDim2.fromOffset(h + point.x, h + point.y);
			rotations[i] = floorCanvasRotation(hxs[i], hzs[i]);
		}
	}

	move(): void {
		const labels = this.labels;
		const positions = this.positions;
		const rotations = this.rotations;
		for (let i = 0; i < this.count; i++) {
			const label = labels[i];
			label.Position = positions[i];
			label.Rotation = rotations[i];
		}
	}

	flip(frameBase: number): void {
		flipLabels(this.labels, this.shown, this.count, this.art, frameBase);
	}

	destroy(): void {
		this.part.Destroy();
		this.labels.clear();
		this.count = 0;
	}
}

/**
 * Rings (or a spiral) of bullets flying out from the emitter, as spike A always drew them: ring r's radius grows at
 * `speed` and wraps at maxRadiusStuds; the spiral also spins the rings, so its headings lean by atan2(r * spin, speed).
 */
class RingLayout {
	private readonly cos = new Array<number>();
	private readonly sin = new Array<number>();

	constructor(private readonly perRing: number, private readonly speed: number, private readonly offsetRad: number) {
		// Unit circle for one ring, rotated per ring with the angle-addition identity.
		for (let k = 0; k < perRing; k++) {
			this.cos.push(math.cos((k * TAU) / perRing));
			this.sin.push(math.sin((k * TAU) / perRing));
		}
	}

	fill(pool: SpikePool, pattern: BulletPattern, elapsed: number, cx: number, cz: number): void {
		const count = pool.count;
		const perRing = this.perRing;
		const ringCos = this.cos;
		const ringSin = this.sin;
		const xs = pool.xs;
		const zs = pool.zs;
		const hxs = pool.hxs;
		const hzs = pool.hzs;
		const headings = pool.headings;
		const spiral = pattern === "spiral";
		const rings = math.ceil(count / perRing);
		const spacing = BULLET_SPIKE.maxRadiusStuds / math.max(rings, 1);
		const travel = elapsed * this.speed;
		for (let ring = 0; ring < rings; ring++) {
			const radius = (travel + ring * spacing) % BULLET_SPIKE.maxRadiusStuds;
			const offset =
				this.offsetRad +
				(spiral
					? ring * BULLET_SPIKE.spiralStepRad + elapsed * BULLET_SPIKE.spiralSpinRadPerSec
					: (ring % 2) * (math.pi / perRing));
			const co = math.cos(offset);
			const so = math.sin(offset);
			const base = ring * perRing;
			const last = math.min(perRing, count - base);
			if (!headings) {
				for (let k = 0; k < last; k++) {
					const c = ringCos[k] * co - ringSin[k] * so;
					const s = ringSin[k] * co + ringCos[k] * so;
					xs[base + k] = cx + c * radius;
					zs[base + k] = cz + s * radius;
				}
				continue;
			}
			const lean = spiral ? math.atan2(radius * BULLET_SPIKE.spiralSpinRadPerSec, this.speed) : 0;
			const cd = math.cos(lean);
			const sd = math.sin(lean);
			for (let k = 0; k < last; k++) {
				const c = ringCos[k] * co - ringSin[k] * so;
				const s = ringSin[k] * co + ringCos[k] * so;
				const i = base + k;
				xs[i] = cx + c * radius;
				zs[i] = cz + s * radius;
				hxs[i] = c * cd - s * sd;
				hzs[i] = s * cd + c * sd;
			}
		}
	}
}

interface Pools {
	readonly mode: ModeId;
	readonly enemy: SpikePool;
	readonly player: SpikePool;
}

/**
 * Spike A (docs/SPIKES.md): can Roblox draw the web build's 1,000 enemy bullets at 60 fps? Extended by spike PA0
 * (docs/PROJECTILE_ART.md PA0, docs/SPIKES.md "Spike PA0"): the same bullets drawn as sprites.
 *
 * Positions are analytic rings or a spiral around a fixed emitter, standing in for the sim's bullets. Render modes
 * (BULLET_SPIKE.modes, keys 5-8): (N) today's neon spheres (Anchored; no collision, queries, touch or shadows) moved
 * with exactly one `workspace:BulkMoveTo(parts, cframes, FireCFrameChanged)` a pool, the baseline; (A) a flat Part per
 * bullet with a Top-face Decal; (B) a flat anchor Part per bullet with a Top-face SurfaceGui + ImageLabel (A and B
 * turned along the velocity by the BulkMoveTo CFrames); (C) one canvas SurfaceGui per pool with an ImageLabel per
 * bullet moved by Position / Rotation writes. The sprite modes flicker through a 3-frame flipbook, written only when a
 * slot's frame changes. Key 0 adds a second, "player" pool of BULLET_SPIKE.players.count bullets in the same mode.
 * Art: ThemePack.bullet(S.lookId) when the pack has it, else shared/theme SPIKE_ENGINE_TEXTURES.
 *
 * Reports fps and the per-frame cost of the update (layout + CFrame / GUI value construction, the BulkMoveTo or the
 * property writes, the flipbook writes) to the spike HUD; the update is also a MicroProfiler label.
 *
 * Off unless `KV_SpikeBullets` (or SPIKE_DEFAULTS.bullets) is true; everything it creates is owned by one Janitor
 * (a mode's pools by a child Janitor, rebuilt on a mode change) and removed when the flag goes false.
 */
@Controller({})
export class BulletSpikeController implements OnStart {
	private session?: Janitor;

	constructor(private readonly theme: ThemeController) {}

	onStart(): void {
		watchSpikeFlag("bullets", (enabled) => (enabled ? this.start() : this.stop()));
	}

	private stop(): void {
		this.session?.Destroy();
		this.session = undefined;
	}

	private start(): void {
		if (this.session) {
			return;
		}
		const janitor = new Janitor();
		this.session = janitor;

		clientStore.setBulletsActive(true);
		janitor.Add(() => clientStore.setBulletsActive(false), true);

		const folder = new Instance("Folder");
		folder.Name = BULLET_SPIKE.folderName;
		folder.Parent = Workspace;
		janitor.Add(folder);

		// Emitter: where the local character stood when the spike started; with no character (the game spawns
		// none), the floor under the camera's focus (else the origin).
		const root = Players.LocalPlayer.Character?.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
		let cx = 0;
		let cz = 0;
		let y = BULLET_SPIKE.heightStuds;
		if (root) {
			cx = root.Position.X;
			cz = root.Position.Z;
			y = root.Position.Y - root.Size.Y + BULLET_SPIKE.heightStuds;
		} else {
			const camera = Workspace.CurrentCamera;
			if (camera) {
				const focus = camera.Focus.Position;
				const probe = BULLET_SPIKE.floorProbeStuds;
				const hit = Workspace.Raycast(focus.add(new Vector3(0, probe, 0)), new Vector3(0, -2 * probe, 0));
				cx = focus.X;
				cz = focus.Z;
				y = (hit ? hit.Position.Y : 0) + BULLET_SPIKE.heightStuds;
			}
		}

		const art = spikeArt(this.theme.getPack());
		const P = BULLET_SPIKE.players;
		const enemyLayout = new RingLayout(BULLET_SPIKE.perRing, BULLET_SPIKE.speedStuds, 0);
		const playerLayout = new RingLayout(P.perRing, P.speedStuds, P.offsetRad);
		const ringColors = BULLET_SPIKE.colors.map(colorOf);
		const enemyTint = (i: number) => ringColors[math.floor(i / BULLET_SPIKE.perRing) % ringColors.size()];
		const playerColor = colorOf(P.color);
		const playerTint = () => playerColor;

		// A mode's pools live in their own folder and Janitor: a mode change tears them down and builds the next.
		const modeJanitor = janitor.Add(new Janitor());
		const makePool = (mode: ModeId, modeFolder: Folder, tintOf: (i: number) => Color3, player: boolean) => {
			switch (mode) {
				case "decal":
					return new DecalPool(tintOf, modeFolder, art);
				case "surface":
					return new SurfacePool(
						tintOf,
						modeFolder,
						art,
						player ? BULLET_ART_VIEW.liftStuds.player : BULLET_ART_VIEW.liftStuds.enemy,
					);
				case "canvas": {
					const lift = player ? BULLET_SPIKE.canvas.playerLiftStuds : 0;
					return new CanvasPool(tintOf, modeFolder, art, cx, y, cz, lift);
				}
				default:
					return new NeonPool(tintOf, modeFolder);
			}
		};
		const buildPools = (modeIndex: number): Pools => {
			modeJanitor.Cleanup();
			const mode = BULLET_SPIKE.modes[modeIndex].id;
			const modeFolder = new Instance("Folder");
			modeFolder.Name = mode;
			modeFolder.Parent = folder;
			const enemy = makePool(mode, modeFolder, enemyTint, false);
			const player = makePool(mode, modeFolder, playerTint, true);
			modeJanitor.Add(() => {
				enemy.destroy();
				player.destroy();
			}, true);
			modeJanitor.Add(modeFolder);
			return { mode, enemy, player };
		};

		let settings = selectBulletSpike(clientStore.getState());
		let pools = buildPools(settings.modeIndex);
		const resizeAll = () => {
			pools.enemy.resize(BULLET_SPIKE.counts[settings.countIndex]);
			pools.player.resize(settings.playerBullets ? P.count : 0);
		};
		resizeAll();

		const startedAt = os.clock();
		let windowStart = startedAt;
		let frames = 0;
		let computeSec = 0;
		let moveSec = 0;
		let frameSec = 0;
		let worstSec = 0;
		const resetWindow = () => {
			windowStart = os.clock();
			frames = 0;
			computeSec = 0;
			moveSec = 0;
			frameSec = 0;
			worstSec = 0;
		};

		janitor.Add(
			clientStore.subscribe(selectBulletSpike, (latest) => {
				const previous = settings;
				settings = latest;
				if (latest.modeIndex !== previous.modeIndex) {
					pools = buildPools(latest.modeIndex);
					resizeAll();
					resetWindow();
				} else if (
					latest.countIndex !== previous.countIndex ||
					latest.playerBullets !== previous.playerBullets
				) {
					resizeAll();
					resetWindow();
				}
			}),
			true,
		);

		janitor.Add(
			UserInputService.InputBegan.Connect((input, processed) => {
				if (processed) {
					return;
				}
				const countIndex = COUNT_KEYS.indexOf(input.KeyCode);
				const modeIndex = MODE_KEYS.indexOf(input.KeyCode);
				if (countIndex >= 0) {
					clientStore.setBulletCountIndex(countIndex);
				} else if (modeIndex >= 0) {
					clientStore.setBulletModeIndex(modeIndex);
				} else if (input.KeyCode === PATTERN_KEY) {
					clientStore.toggleBulletPattern();
				} else if (input.KeyCode === PLAYERS_KEY) {
					clientStore.toggleBulletPlayers();
				}
			}),
		);

		janitor.Add(
			RunService.RenderStepped.Connect(() => {
				const { enemy, player } = pools;
				const pattern: BulletPattern = settings.pattern;
				const elapsed = os.clock() - startedAt;

				debug.profilebegin(BULLET_SPIKE.profileLabel);
				const t0 = os.clock();
				enemyLayout.fill(enemy, pattern, elapsed, cx, cz);
				playerLayout.fill(player, pattern, elapsed, cx, cz);
				enemy.build(y);
				player.build(y);
				const t1 = os.clock();
				enemy.move();
				player.move();
				const t2 = os.clock();
				const frameBase = math.floor(elapsed * S.fps);
				enemy.flip(frameBase);
				player.flip(frameBase);
				const t3 = os.clock();
				debug.profileend();

				frames += 1;
				computeSec += t1 - t0;
				moveSec += t2 - t1;
				frameSec += t3 - t2;
				worstSec = math.max(worstSec, t3 - t0);
				const windowSec = t3 - windowStart;
				if (windowSec >= BULLET_SPIKE.statsIntervalSec) {
					clientStore.reportBulletStats({
						fps: frames / windowSec,
						computeMs: (computeSec / frames) * MS_PER_SEC,
						moveMs: (moveSec / frames) * MS_PER_SEC,
						frameMs: (frameSec / frames) * MS_PER_SEC,
						worstMs: worstSec * MS_PER_SEC,
						live: enemy.count,
						players: player.count,
						art: art.source,
					});
					resetWindow();
				}
			}),
		);
	}
}
