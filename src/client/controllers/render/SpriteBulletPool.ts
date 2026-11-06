import { Workspace } from "@rbxts/services";
import { createKvSurfaceGui } from "client/ui";
import { SIM_DT, type BulletSimulation, type Vec3 as SimVec3 } from "shared/sim";
import type { BulletSprite, SpriteFrame } from "shared/theme";
import {
	BULLET_ART_VIEW,
	bulletFrame,
	bulletPartSize,
	bulletSizeKey,
	bulletYawAxes,
	lerp,
	studsX,
	studsY,
	studsZ,
	type BulletYawAxes,
} from "shared/view";
import { BulletTrails, type TrailLook } from "./bulletTrails";
import { renderPart } from "./placeholders";

const V = BULLET_ART_VIEW;
const HIDDEN = 1;
const SELF_LIT = 0;
const FULL = UDim2.fromScale(1, 1);

/** One look's art, resolved once: the sprite, its cached loop frames and its drawn size at draw scale 1, studs. */
export interface SpriteBulletLook {
	readonly sprite: BulletSprite;
	/** frame(0) .. frame(frames - 1), so a flicker write never calls into the theme (no allocation per frame). */
	readonly frames: ReadonlyArray<SpriteFrame>;
	/** Along the travel direction (the art's height) and across it (its width), studs. */
	readonly alongStuds: number;
	readonly acrossStuds: number;
	/** The SurfaceGui canvas: frame 0's rect (x across, y along) x BULLET_ART_VIEW.canvasPixelsPerArtPixel. */
	readonly canvas: Vector2;
	readonly resample: Enum.ResamplerMode;
}

/** A look's art for the sprite pool (`studsPerTile` studs a tile). */
export function spriteBulletLook(sprite: BulletSprite, studsPerTile: number): SpriteBulletLook {
	const frames = new Array<SpriteFrame>();
	const n = math.max(1, sprite.frames);
	for (let f = 0; f < n; f++) frames.push(sprite.frame(f));
	return {
		sprite,
		frames,
		alongStuds: sprite.heightTiles * studsPerTile,
		acrossStuds: sprite.widthTiles * studsPerTile,
		canvas: frames[0].size.mul(V.canvasPixelsPerArtPixel),
		resample: Enum.ResamplerMode[sprite.set.resample],
	};
}

/**
 * One bullet simulation's bullets that have sprite art (docs/PROJECTILE_ART.md §4, PA5), slot-indexed like BulletPool
 * (anchor i = bullet SLOT i) behind the same `frame(sim, alpha, fade)` call. Each slot is an invisible anchor Part
 * (render-only, Transparency 1, BULLET_ART_VIEW.thicknessStuds thin) carrying a Top-face SurfaceGui (FixedSize,
 * LightInfluence 0: unlit like the neon, PAD10; AlwaysOnTop false: walls and bodies in front still hide it) with one
 * ImageLabel filling it (Pixelated per the set's resample). FxSpriteController's floor construction, at the bullet's
 * own height (its top face at studsY of the interpolated y, plus the pool's lift and a per-slot layer step), so it
 * draws over every floor decal and marking.
 *
 * Per frame every drawn anchor moves in ONE workspace:BulkMoveTo, its CFrame turned about +Y by the velocity's yaw
 * (shared/view bulletYawAxes: the art's up, its nose, along the velocity), so there is no per-frame Rotation write.
 * Writes happen only on change: Image / CanvasSize / ResampleMode on a look change, ImageRectOffset / ImageRectSize
 * on a look or flicker-frame change (bulletFrame: `fps` loop with a per-slot phase, frame 0 under reduced motion;
 * BULLET_ART_VIEW.maxFlickerWritesPerFrame budget), the anchor's Size (widthTiles / heightTiles x STUDS_PER_TILE x
 * draw scale x end-of-life fade, in bulletSizeKey steps) on a quantized change, ImageTransparency (co-op teammates'
 * fade) on change, SurfaceGui.Enabled when a slot shows or parks. Unused slots park (BULLET_VIEW.parkedStuds).
 * Trails stay neon parts (BulletTrails). Anchors grow lazily to the highest slot drawn.
 *
 * Which bullets: `draws(payload, scale)` = not `skip`ped and `looks` has art for `lookOf(payload, scale)`; the neon
 * BulletPool on the same simulation skips exactly those.
 */
export class SpriteBulletPool {
	private readonly parts = new Array<Part>();
	private readonly surfaces = new Array<SurfaceGui>();
	private readonly labels = new Array<ImageLabel>();
	private readonly shown = new Array<boolean>();
	/** Per slot: the look shown (-1 none yet), size key (-1), loop frame (-1), transparency, image. */
	private readonly lookKey = new Array<number>();
	private readonly sizeKey = new Array<number>();
	private readonly frameKey = new Array<number>();
	private readonly alphaKey = new Array<number>();
	private readonly imageKey = new Array<string>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private readonly prev: SimVec3 = { x: 0, y: 0, z: 0 };
	private readonly axes: BulletYawAxes = { c: 1, s: 0 };
	private readonly trailParts: BulletTrails;
	private sim: BulletSimulation | undefined;

	/** Trails drawn this frame (BulletRenderController sets it every frame). */
	trailsOn = false;
	/** Reduced motion: every sprite holds BULLET_ART_VIEW.reducedMotionFrame (set every frame). */
	reducedMotion = false;

	constructor(
		private readonly folder: Folder,
		private readonly name: string,
		private readonly parked: CFrame,
		/** Art by look index (lookOf's result); a look without an entry is the neon pool's. */
		private readonly looks: ReadonlyMap<number, SpriteBulletLook>,
		/** The look of a bullet by payload and draw scale. */
		private readonly lookOf: (payload: number, scale: number) => number,
		/** Bullets another pool draws whatever their look (the decal pools' kinds), by payload. */
		private readonly skip: ((payload: number) => boolean) | undefined,
		/** Trails by look index (absent entry: none). */
		private readonly trails: ReadonlyMap<number, TrailLook> | undefined,
		/** Extra lift over the bullet's height, studs (BULLET_ART_VIEW.liftStuds). */
		private readonly liftStuds: number,
	) {
		this.trailParts = new BulletTrails(folder, name, parked);
	}

	/** True when this pool draws a bullet with `payload` at draw `scale` (the neon pool skips it). */
	draws(payload: number, scale: number): boolean {
		if (this.skip !== undefined && this.skip(payload)) return false;
		return this.looks.has(this.lookOf(payload, scale));
	}

	/** `fade`: per-bullet transparency from its emitter id (co-op teammates' bullets), or undefined (always opaque). */
	frame(sim: BulletSimulation, alpha: number, fade?: (emitter: number) => number): void {
		if (sim !== this.sim) {
			// A new run built new simulations: everything shown belongs to the old one.
			this.sim = sim;
			this.parkAll();
		}
		this.moveParts.clear();
		this.moveCFrames.clear();
		const n = sim.highWater();
		const seconds = (sim.stepCount + alpha) * SIM_DT;
		const budget = V.maxFlickerWritesPerFrame;
		let flickerWrites = 0;
		const prev = this.prev;
		const slots = math.max(this.parts.size(), n);
		for (let i = 0; i < slots; i++) {
			let lookIndex = -1;
			let scale = 1;
			if (i < n && sim.isVisible(i)) {
				const payload = sim.payloadAt(i);
				if (this.skip === undefined || !this.skip(payload)) {
					scale = sim.scaleAt(i);
					const k = this.lookOf(payload, scale);
					if (this.looks.has(k)) lookIndex = k;
				}
			}
			const look = lookIndex >= 0 ? this.looks.get(lookIndex) : undefined;
			if (look === undefined) {
				if (i < this.parts.size()) {
					this.park(i);
					this.trailParts.park(i, this.moveParts, this.moveCFrames);
				}
				continue;
			}
			while (this.parts.size() <= i) this.grow();
			const lookChanged = this.applyLook(i, lookIndex, look);
			this.resize(i, look, bulletSizeKey(scale, sim.fadeAt(i)), lookChanged);
			const f = bulletFrame(seconds, i, look.frames.size(), look.sprite.fps, this.reducedMotion);
			if (f !== this.frameKey[i] && (lookChanged || budget <= 0 || flickerWrites < budget)) {
				if (!lookChanged) flickerWrites += 1;
				this.setFrame(i, look, f);
			}
			const t = fade !== undefined ? fade(sim.emitterIdAt(i)) : 0;
			if (t !== this.alphaKey[i]) {
				this.alphaKey[i] = t;
				this.labels[i].ImageTransparency = t;
			}
			const cur = sim.positionAt(i);
			sim.previousPositionAt(i, prev);
			const x = studsX(lerp(prev.x, cur.x, alpha));
			const y = studsY(lerp(prev.y, cur.y, alpha));
			const z = studsZ(lerp(prev.z, cur.z, alpha));
			const v = sim.velocityAt(i);
			const a = bulletYawAxes(v.x, v.z, this.axes);
			const top = y + this.liftStuds + (i % V.layers) * V.layerStepStuds;
			// CFrame.Angles(0, yaw, 0) at the anchor's centre, its top face at `top`.
			const c = a.c;
			const s = a.s;
			this.moveParts.push(this.parts[i]);
			this.moveCFrames.push(new CFrame(x, top - V.thicknessStuds / 2, z, c, 0, s, 0, 1, 0, -s, 0, c));
			if (!this.shown[i]) {
				this.shown[i] = true;
				this.surfaces[i].Enabled = true;
			}
			const trail = this.trailsOn ? this.trails?.get(lookIndex) : undefined;
			if (trail !== undefined) {
				const len = math.sqrt(v.x * v.x + v.z * v.z);
				const at = new Vector3(x, y, z);
				const cf = len > 0 ? CFrame.lookAlong(at, new Vector3(v.x, 0, v.z)) : new CFrame(at);
				this.trailParts.place(i, trail, cf.mul(trail.offset), this.moveParts, this.moveCFrames);
			} else {
				this.trailParts.park(i, this.moveParts, this.moveCFrames);
			}
		}
		this.flush();
	}

	/** Anchors created so far. */
	poolSize(): number {
		return this.parts.size();
	}

	/** Trail parts created so far. */
	trailPoolSize(): number {
		return this.trailParts.size();
	}

	/** Writes the look's image, canvas and filtering when slot `i` changes look; true when it did. */
	private applyLook(i: number, lookIndex: number, look: SpriteBulletLook): boolean {
		if (lookIndex === this.lookKey[i]) return false;
		this.lookKey[i] = lookIndex;
		const label = this.labels[i];
		label.ResampleMode = look.resample;
		this.surfaces[i].CanvasSize = look.canvas;
		this.frameKey[i] = -1;
		this.sizeKey[i] = -1;
		return true;
	}

	/** Writes the anchor's Size only when the quantized drawn size or the look changes. */
	private resize(i: number, look: SpriteBulletLook, key: number, lookChanged: boolean): void {
		if (key === this.sizeKey[i] && !lookChanged) return;
		this.sizeKey[i] = key;
		const [sx, sy, sz] = bulletPartSize(look.alongStuds * key, look.acrossStuds * key);
		this.parts[i].Size = new Vector3(sx, sy, sz);
	}

	private setFrame(i: number, look: SpriteBulletLook, f: number): void {
		this.frameKey[i] = f;
		const r = look.frames[f] ?? look.frames[0];
		const label = this.labels[i];
		if (r.image !== this.imageKey[i]) {
			this.imageKey[i] = r.image;
			label.Image = r.image;
		}
		label.ImageRectOffset = r.offset;
		label.ImageRectSize = r.size;
	}

	private park(i: number): void {
		if (!this.shown[i]) return;
		this.shown[i] = false;
		this.surfaces[i].Enabled = false;
		this.moveParts.push(this.parts[i]);
		this.moveCFrames.push(this.parked);
	}

	private parkAll(): void {
		this.moveParts.clear();
		this.moveCFrames.clear();
		for (let i = 0; i < this.parts.size(); i++) {
			this.trailParts.park(i, this.moveParts, this.moveCFrames);
			this.park(i);
		}
		this.flush();
	}

	private flush(): void {
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	private grow(): void {
		const part = renderPart("Part", false);
		part.Name = this.name;
		part.Transparency = HIDDEN;
		part.CFrame = this.parked;
		const [sx, sy, sz] = bulletPartSize(V.thicknessStuds, V.thicknessStuds);
		part.Size = new Vector3(sx, sy, sz);
		const label = new Instance("ImageLabel");
		label.Name = "Frame";
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Size = FULL;
		label.ResampleMode = Enum.ResamplerMode.Pixelated;
		const surface = createKvSurfaceGui("Surface");
		surface.Face = Enum.NormalId.Top;
		surface.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize;
		surface.AlwaysOnTop = false;
		surface.LightInfluence = SELF_LIT;
		surface.ResetOnSpawn = false;
		surface.Enabled = false;
		label.Parent = surface;
		surface.Parent = part;
		part.Parent = this.folder;
		this.parts.push(part);
		this.surfaces.push(surface);
		this.labels.push(label);
		this.shown.push(false);
		this.lookKey.push(-1);
		this.sizeKey.push(-1);
		this.frameKey.push(-1);
		this.alphaKey.push(0);
		this.imageKey.push("");
	}
}
