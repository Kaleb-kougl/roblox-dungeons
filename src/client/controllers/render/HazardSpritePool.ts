import { Workspace } from "@rbxts/services";
import type { BulletSimulation } from "shared/sim";
import { BULLET_ART, type HazardSprite, type SpriteFrame } from "shared/theme";
import {
	BULLET_ART_VIEW,
	HAZARD_ART_VIEW,
	ScorchTracker,
	emberSpriteLook,
	flatCellPlacement,
	floorStudsY,
	gooSpritePlacement,
	gooSpriteSize,
	newHazardCellLook,
	scorchLook,
	strikeFlashLook,
	strikeTilesPerPixel,
	studsX,
	studsZ,
	type HazardCellLook,
} from "shared/view";
import { FLOOR_CANVAS_YAW, floorCanvasPartSize } from "./floorCanvas";
import { createSpriteAnchor } from "./SpriteBulletPool";

/** What a floor sprite drawer reads besides the bullets (docs/HAZARD_ART.md HA5): sim seconds, the floor, motion. */
export interface HazardClock {
	/** (state.tick + alpha) / SIM_HZ: freezes with the run. */
	readonly simSec: number;
	/** state.endless.floor (0 outside endless): a change drops every scorch. */
	readonly floorKey: number;
	/** False under reduced motion (the ember holds its frame). */
	readonly motion: boolean;
}

/** A DecalPool's sprite mode: the goo's FloorSpritePool, the strike's and the embers' pools below. */
export interface FloorSpriteDrawer {
	frame(sim: BulletSimulation, clock: HazardClock): void;
	poolSize(): number;
	/**
	 * Parks every anchor (surfaces disabled), in one BulkMoveTo: the DecalPool draws its discs (the stand-in) instead
	 * while the art is not ready (docs/STAGE_ASSETS.md SA17).
	 */
	parkAll(): void;
}

/** No cell written yet. */
const NO_KEY = -1;
/** Cell keys pack the cell index with its two flips. */
const FLIP_X_KEY = 1;
const FLIP_Y_KEY = 2;
const FLIP_KEYS = 4;

/**
 * A list of flat floor sprite anchors (createSpriteAnchor: an invisible Part with a Top-face SurfaceGui, LightInfluence
 * 0, a Pixelated ImageLabel), all one size, turned by FLOOR_CANVAS_YAW so the art's up is screen-up, tinted `color`
 * (ImageColor3: the art is grey). Per anchor the cell (Image / ImageRectOffset / ImageRectSize, a flip a negative size
 * from the far edge), the ImageTransparency and the CFrame are written only when they change; every move of a frame
 * in ONE BulkMoveTo (`flush`). Grows lazily; `park` disables an anchor's surface and moves it to `parked`.
 */
class FloorAnchors {
	private readonly parts = new Array<Part>();
	private readonly surfaces = new Array<SurfaceGui>();
	private readonly labels = new Array<ImageLabel>();
	private readonly shown = new Array<boolean>();
	private readonly cellKey = new Array<number>();
	private readonly alphaKey = new Array<number>();
	private readonly imageKey = new Array<string>();
	/** The CFrame each anchor was last moved to (`parked` while parked). */
	private readonly at = new Array<CFrame>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();

	constructor(
		private readonly folder: Folder,
		private readonly name: string,
		private readonly parked: CFrame,
		private readonly size: Vector3,
		private readonly canvas: Vector2,
		private readonly color: Color3,
	) {}

	/** Anchors created so far. */
	count(): number {
		return this.parts.size();
	}

	/** Shows anchor `i` with `frame` (key `cell`, flipped), at `transparency`, placed at `cframe`. */
	show(
		i: number,
		cell: number,
		frame: SpriteFrame,
		look: HazardCellLook,
		transparency: number,
		cframe: CFrame,
	): void {
		while (this.parts.size() <= i) this.grow();
		const key = cell * FLIP_KEYS + (look.flipX ? FLIP_X_KEY : 0) + (look.flipY ? FLIP_Y_KEY : 0);
		const label = this.labels[i];
		if (key !== this.cellKey[i]) {
			this.cellKey[i] = key;
			if (frame.image !== this.imageKey[i]) {
				this.imageKey[i] = frame.image;
				label.Image = frame.image;
			}
			const w = frame.size.X;
			const h = frame.size.Y;
			label.ImageRectOffset = new Vector2(
				frame.offset.X + (look.flipX ? w : 0),
				frame.offset.Y + (look.flipY ? h : 0),
			);
			label.ImageRectSize = new Vector2(look.flipX ? -w : w, look.flipY ? -h : h);
		}
		if (transparency !== this.alphaKey[i]) {
			this.alphaKey[i] = transparency;
			label.ImageTransparency = transparency;
		}
		// callers pass a cached CFrame while the anchor stays put (PlaceCache): moved only when it is another one
		if (!this.shown[i] || this.at[i] !== cframe) {
			this.at[i] = cframe;
			this.moveParts.push(this.parts[i]);
			this.moveCFrames.push(cframe);
		}
		if (!this.shown[i]) {
			this.shown[i] = true;
			this.surfaces[i].Enabled = true;
		}
	}

	park(i: number): void {
		if (i >= this.parts.size() || !this.shown[i]) return;
		this.shown[i] = false;
		this.at[i] = this.parked;
		this.surfaces[i].Enabled = false;
		this.moveParts.push(this.parts[i]);
		this.moveCFrames.push(this.parked);
	}

	parkFrom(n: number): void {
		for (let i = n; i < this.parts.size(); i++) this.park(i);
	}

	/** Parks every anchor and flushes. */
	parkAll(): void {
		this.parkFrom(0);
		this.flush();
	}

	flush(): void {
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
		this.moveParts.clear();
		this.moveCFrames.clear();
	}

	private grow(): void {
		const { part, surface, label } = createSpriteAnchor(this.name, this.parked);
		part.Size = this.size;
		surface.CanvasSize = this.canvas;
		label.ImageColor3 = this.color;
		part.Parent = this.folder;
		this.parts.push(part);
		this.surfaces.push(surface);
		this.labels.push(label);
		this.shown.push(false);
		this.cellKey.push(NO_KEY);
		this.alphaKey.push(0);
		this.imageKey.push("");
		this.at.push(this.parked);
	}
}

/**
 * Per anchor index the last CFrame made and what it was made from (a spot and a flip key), so a stationary sprite hands
 * FloorAnchors the same CFrame object every frame (no move) and a new one only when it shows somewhere else.
 */
class PlaceCache {
	private readonly x = new Array<number>();
	private readonly z = new Array<number>();
	private readonly key = new Array<number>();
	private readonly cf = new Array<CFrame>();

	get(i: number, x: number, z: number, key: number, make: () => CFrame): CFrame {
		while (this.x.size() <= i) {
			this.x.push(math.huge);
			this.z.push(math.huge);
			this.key.push(-1);
			this.cf.push(CFrame.identity);
		}
		if (x !== this.x[i] || z !== this.z[i] || key !== this.key[i]) {
			this.x[i] = x;
			this.z[i] = z;
			this.key[i] = key;
			this.cf[i] = make();
		}
		return this.cf[i];
	}
}

/** The canvas of a `frameW` x `frameH` cell (BULLET_ART_VIEW.canvasPixelsPerArtPixel, like every bullet sprite). */
function canvasOf(sprite: HazardSprite): Vector2 {
	return new Vector2(sprite.set.frameW, sprite.set.frameH).mul(BULLET_ART_VIEW.canvasPixelsPerArtPixel);
}

/** A look's flips as 0..3 (flipX + 2 flipY): the index of StrikeSpritePool's turns and the PlaceCache key. */
function flipKey(look: HazardCellLook): number {
	return (look.flipX ? FLIP_X_KEY : 0) + (look.flipY ? FLIP_Y_KEY : 0);
}

/** The turned anchor's local offset for a placement (its x runs screen-down, its z screen-left: floorCanvas.ts). */
function offsetOf(downTiles: number, rightTiles: number, studsPerTile: number): CFrame {
	return new CFrame(downTiles * studsPerTile, 0, -rightTiles * studsPerTile);
}

/**
 * The Stormcaller's strikes as sprites (docs/HAZARD_ART.md HA5): DecalPool's sprite mode for STRIKE_DECAL when the pack's
 * `bullet.enemy.strike` has hazard art. Flash anchor i = bullet SLOT i: the `flash` cell over the strike's life
 * (strikeFlashLook), flipped by the slot, at the disc's top face; the art's rim lies on the hit circle (laid flat
 * unstretched: strikeTilesPerPixel). The scorches (ScorchTracker) are a second anchor list just under the flashes: the
 * `scorch` cells (scorchLook), at the strike's spot after it is gone. Both tinted HAZARD_ART_VIEW.strike.role. A new
 * simulation (a new run) parks everything and drops the scorches; a floor change drops them too.
 */
export class StrikeSpritePool implements FloorSpriteDrawer {
	private readonly flashes: FloorAnchors;
	private readonly scorchAnchors: FloorAnchors;
	private readonly scorches = new ScorchTracker();
	private readonly look = newHazardCellLook();
	private readonly flashY: number;
	private readonly scorchY: number;
	/** Per flip combination (flipX + 2 flipY): the anchor's rotation and offset. */
	private readonly turns = new Array<CFrame>();
	private readonly flashFrames: number;
	private readonly scorchFrames: number;
	private readonly flashPlaces = new PlaceCache();
	private readonly scorchPlaces = new PlaceCache();
	private sim: BulletSimulation | undefined;

	constructor(
		folder: Folder,
		scorchFolder: Folder,
		parked: CFrame,
		private readonly sprite: HazardSprite,
		color: Color3,
		private readonly accepts: (payload: number) => boolean,
		/** A strike's whole life, seconds (bullet time). */
		private readonly totalLife: number,
		/** The flash anchor's top face over the floor, studs. */
		topStuds: number,
		thicknessStuds: number,
		private readonly quantum: number,
		studsPerTile: number,
	) {
		const s = strikeTilesPerPixel(sprite.rimPx);
		const set = sprite.set;
		const base = flatCellPlacement(set.frameW, set.frameH, set.pivot.x, set.pivot.y, s, false, false);
		const size = floorCanvasPartSize(
			base.widthTiles * studsPerTile,
			thicknessStuds,
			base.depthTiles * studsPerTile,
		);
		const canvas = canvasOf(sprite);
		this.flashes = new FloorAnchors(folder, "StrikeSprite", parked, size, canvas, color);
		this.scorchAnchors = new FloorAnchors(scorchFolder, "Scorch", parked, size, canvas, color);
		this.flashY = floorStudsY() + topStuds - thicknessStuds / 2;
		this.scorchY = this.flashY - HAZARD_ART_VIEW.scorch.belowFlashStuds;
		for (let k = 0; k < 4; k++) {
			const p = flatCellPlacement(set.frameW, set.frameH, set.pivot.x, set.pivot.y, s, k % 2 === 1, k >= 2);
			this.turns.push(FLOOR_CANVAS_YAW.mul(offsetOf(p.downTiles, p.rightTiles, studsPerTile)));
		}
		this.flashFrames = sprite.frames(BULLET_ART.flash);
		this.scorchFrames = sprite.frames(BULLET_ART.scorch);
	}

	frame(sim: BulletSimulation, clock: HazardClock): void {
		if (sim !== this.sim) {
			this.sim = sim;
			this.scorches.reset();
		}
		const now = clock.simSec;
		const tracker = this.scorches;
		tracker.begin(clock.floorKey, now);
		const n = sim.highWater();
		const look = this.look;
		const q = this.quantum;
		for (let i = 0; i < n; i++) {
			if (!sim.isVisible(i) || !this.accepts(sim.payloadAt(i))) {
				this.flashes.park(i);
				continue;
			}
			const p = sim.positionAt(i);
			tracker.seen(i, p.x, p.z);
			strikeFlashLook(sim.lifeAt(i), this.totalLife, i, this.flashFrames, look);
			const frame = this.sprite.frame(BULLET_ART.flash, look.cell);
			const cf = this.flashPlaces.get(i, p.x, p.z, flipKey(look), () => this.place(p.x, this.flashY, p.z, look));
			this.flashes.show(i, look.cell, frame, look, 0, cf);
		}
		this.flashes.parkFrom(n);
		tracker.finish(now);
		for (let k = 0; k < tracker.capacity; k++) {
			if (!tracker.live(k, now)) {
				this.scorchAnchors.park(k);
				continue;
			}
			scorchLook(now - tracker.start[k], tracker.seed[k], this.scorchFrames, look);
			const alpha = math.min(1, math.round(look.transparency / q) * q);
			if (alpha >= 1) {
				this.scorchAnchors.park(k);
				continue;
			}
			const frame = this.sprite.frame(BULLET_ART.scorch, look.cell);
			const x = tracker.x[k];
			const z = tracker.z[k];
			const cf = this.scorchPlaces.get(k, x, z, flipKey(look), () => this.place(x, this.scorchY, z, look));
			this.scorchAnchors.show(k, look.cell, frame, look, alpha, cf);
		}
		this.flashes.flush();
		this.scorchAnchors.flush();
	}

	/** Flash anchors and scorch anchors created so far. */
	poolSize(): number {
		return this.flashes.count() + this.scorchAnchors.count();
	}

	/** Parks every flash and scorch and drops the scorches (the discs draw meanwhile: no scorch of theirs to keep). */
	parkAll(): void {
		this.scorches.reset();
		this.flashes.parkAll();
		this.scorchAnchors.parkAll();
	}

	/** Live scorches (debug / specs in Studio). */
	scorchCount(nowSec: number): number {
		return this.scorches.liveCount(nowSec);
	}

	private place(x: number, y: number, z: number, look: HazardCellLook): CFrame {
		return new CFrame(studsX(x), y, studsZ(z)).mul(this.turns[flipKey(look)]);
	}
}

/**
 * The build embers as sprites (docs/HAZARD_ART.md HA5): DecalPool's sprite mode for EMBER_DECAL when the pack's
 * `bullet.player.ember` has hazard art. Anchor i = bullet SLOT i: the `burn` loop (emberSpriteLook: sim time, a phase
 * per slot, held under reduced motion), mirrored by the slot, fading like the disc, tinted HAZARD_ART_VIEW.ember.role.
 * The art is a 3/4 view: its burning patch (`lit`) covers the disc on screen with the depth stretched by 1 / sin(pitch)
 * (gooSpriteSize / gooSpritePlacement, the goo's rule), the pivot (the patch centre) on the bullet. Embers never move:
 * an anchor moves only when its slot shows an ember at a new spot.
 */
export class EmberSpritePool implements FloorSpriteDrawer {
	private readonly anchors: FloorAnchors;
	private readonly look = newHazardCellLook();
	private readonly y: number;
	private readonly plain: CFrame;
	private readonly mirrored: CFrame;
	private readonly frames: number;
	private readonly fps: number;
	private readonly places = new PlaceCache();

	constructor(
		folder: Folder,
		parked: CFrame,
		private readonly sprite: HazardSprite,
		color: Color3,
		private readonly accepts: (payload: number) => boolean,
		topStuds: number,
		thicknessStuds: number,
		private readonly quantum: number,
		studsPerTile: number,
	) {
		const set = sprite.set;
		const e = HAZARD_ART_VIEW.ember;
		const size = gooSpriteSize(sprite.litW, sprite.litH, e.coverRadius, e.cameraPitchDeg);
		const at = (mirror: boolean) =>
			gooSpritePlacement(
				set.frameW,
				set.frameH,
				set.pivot.x,
				set.pivot.y,
				sprite.litW,
				sprite.litH,
				size,
				mirror,
			);
		const plain = at(false);
		const mirrored = at(true);
		const partSize = floorCanvasPartSize(
			plain.widthTiles * studsPerTile,
			thicknessStuds,
			plain.depthTiles * studsPerTile,
		);
		this.anchors = new FloorAnchors(folder, "EmberSprite", parked, partSize, canvasOf(sprite), color);
		this.y = floorStudsY() + topStuds - thicknessStuds / 2;
		this.plain = FLOOR_CANVAS_YAW.mul(offsetOf(plain.downTiles, plain.rightTiles, studsPerTile));
		this.mirrored = FLOOR_CANVAS_YAW.mul(offsetOf(mirrored.downTiles, mirrored.rightTiles, studsPerTile));
		this.frames = sprite.frames(BULLET_ART.burn);
		this.fps = sprite.fps(BULLET_ART.burn);
	}

	frame(sim: BulletSimulation, clock: HazardClock): void {
		const n = sim.highWater();
		const look = this.look;
		const q = this.quantum;
		for (let i = 0; i < n; i++) {
			if (!sim.isVisible(i) || !this.accepts(sim.payloadAt(i))) {
				this.anchors.park(i);
				continue;
			}
			emberSpriteLook(sim.lifeAt(i), i, clock.simSec, this.frames, this.fps, clock.motion, look);
			const alpha = math.min(1, math.round(look.transparency / q) * q);
			if (alpha >= 1) {
				this.anchors.park(i);
				continue;
			}
			const p = sim.positionAt(i);
			const mirror = look.flipX;
			const cf = this.places.get(i, p.x, p.z, mirror ? 1 : 0, () =>
				new CFrame(studsX(p.x), this.y, studsZ(p.z)).mul(mirror ? this.mirrored : this.plain),
			);
			this.anchors.show(i, look.cell, this.sprite.frame(BULLET_ART.burn, look.cell), look, alpha, cf);
		}
		this.anchors.parkFrom(n);
		this.anchors.flush();
	}

	poolSize(): number {
		return this.anchors.count();
	}

	parkAll(): void {
		this.anchors.parkAll();
	}
}
