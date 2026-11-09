import { Workspace } from "@rbxts/services";
import type { BulletSimulation } from "shared/sim";
import type { FloorSprite, SpriteFrame } from "shared/theme";
import {
	BULLET_ART_VIEW,
	floorStudsY,
	gooSpriteLook,
	gooSpritePlacement,
	gooSpriteSize,
	studsX,
	studsZ,
	type GooSpriteLook,
} from "shared/view";
import { FLOOR_CANVAS_YAW, floorCanvasPartSize } from "./floorCanvas";
import type { FloorSpriteDrawer } from "./HazardSpritePool";
import { createSpriteAnchor } from "./SpriteBulletPool";

/** The land cell's frame key (hold variants are 0..), and a new anchor's (no cell written yet). */
const LAND_KEY = -1;
const NO_KEY = -2;

/**
 * A floor sprite resolved once for the pool (docs/GOO_ART.md GA4): its cells, the SurfaceGui canvas, the anchor's
 * Size (the whole cell, floorCanvasPartSize for FLOOR_CANVAS_YAW) and the cell centre's offset from the puddle centre
 * in the turned anchor's frame, unmirrored and mirrored (the pivot, the lit box's centre, lies on the bullet).
 */
export interface FloorSpriteLook {
	readonly land: SpriteFrame;
	readonly holds: ReadonlyArray<SpriteFrame>;
	readonly canvas: Vector2;
	readonly resample: Enum.ResamplerMode;
	readonly size: Vector3;
	readonly offset: CFrame;
	readonly mirroredOffset: CFrame;
}

/**
 * The look of `sprite` drawn `thicknessStuds` thin at `studsPerTile`: its lit box sized by shared/view gooSpriteSize
 * (cover the hit on screen, the depth stretched by 1 / sin(pitch): GAD3 / GAD4) and the cell around it by
 * gooSpritePlacement.
 */
export function floorSpriteLook(sprite: FloorSprite, studsPerTile: number, thicknessStuds: number): FloorSpriteLook {
	const set = sprite.set;
	const size = gooSpriteSize(sprite.litW, sprite.litH);
	const at = (mirror: boolean) =>
		gooSpritePlacement(set.frameW, set.frameH, set.pivot.x, set.pivot.y, sprite.litW, sprite.litH, size, mirror);
	const plain = at(false);
	const mirrored = at(true);
	// The turned anchor's local x runs screen-down, its z screen-left (floorCanvas.ts).
	const offset = (p: typeof plain) => new CFrame(p.downTiles * studsPerTile, 0, -p.rightTiles * studsPerTile);
	const holds = new Array<SpriteFrame>();
	for (let v = 0; v < math.max(1, sprite.holdFrames); v++) holds.push(sprite.hold(v));
	return {
		land: sprite.land,
		holds,
		canvas: new Vector2(set.frameW, set.frameH).mul(BULLET_ART_VIEW.canvasPixelsPerArtPixel),
		resample: Enum.ResamplerMode[set.resample],
		size: floorCanvasPartSize(plain.widthTiles * studsPerTile, thicknessStuds, plain.depthTiles * studsPerTile),
		offset: offset(plain),
		mirroredOffset: offset(mirrored),
	};
}

/**
 * The goo puddles as floor sprites (docs/GOO_ART.md GA4): DecalPool's sprite mode, used instead of its discs when the
 * pack's `bullet.enemy.goo` has floor sprite art (ThemePack.floorSprite). Anchor i = bullet SLOT i, each one
 * SpriteBulletPool's anchor (createSpriteAnchor: an invisible Part with a Top-face SurfaceGui, LightInfluence 0, a
 * Pixelated ImageLabel) lying flat at the disc's height (its top face where the disc's is: GOO_VIEW.liftStuds +
 * thicknessStuds over the floor), turned by FLOOR_CANVAS_YAW so the art's up is screen-up (the Top-face canvas turn,
 * floorCanvas.ts), sized by the look (all slots alike: Size and CanvasSize are written once, when the anchor is made).
 * Goo is stationary: an anchor is moved only when its slot shows a puddle at a new spot (it appears, or its slot was
 * reused), never every frame; all moves of a frame in ONE BulkMoveTo. Per slot the look is shared/view gooSpriteLook:
 * the land cell, then the slot's hold variant, mirrored by the slot's bit (a negative ImageRectSize, the offset moved
 * to the cell's right edge); Image / ImageRectOffset / ImageRectSize written only on a cell change, ImageTransparency
 * on the `quantum` (the disc's fade). A slot without a visible accepted bullet, or fully faded, parks (its surface
 * disabled); a new simulation (a new run) parks everything, and a floor change clears the bullets, so their slots park.
 */
export class FloorSpritePool implements FloorSpriteDrawer {
	private readonly parts = new Array<Part>();
	private readonly surfaces = new Array<SurfaceGui>();
	private readonly labels = new Array<ImageLabel>();
	private readonly shown = new Array<boolean>();
	/** Per slot: the cell shown (LAND_KEY, a hold variant, NO_KEY: none yet), mirror, transparency, spot, image. */
	private readonly frameKey = new Array<number>();
	private readonly mirrorKey = new Array<boolean>();
	private readonly alphaKey = new Array<number>();
	private readonly atX = new Array<number>();
	private readonly atZ = new Array<number>();
	private readonly imageKey = new Array<string>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private readonly look: GooSpriteLook = { frame: "land", variant: 0, mirror: false, transparency: 0 };
	private readonly y: number;
	private sim: BulletSimulation | undefined;

	constructor(
		private readonly folder: Folder,
		private readonly name: string,
		private readonly parked: CFrame,
		private readonly sprite: FloorSpriteLook,
		/** Which bullets, by payload. */
		private readonly accepts: (payload: number) => boolean,
		/** A puddle's whole life, seconds (its age, for the land cell, reads from it). */
		private readonly totalLife: number,
		/** The anchor's top face over the floor, studs. */
		topStuds: number,
		/** Transparency write quantum. */
		private readonly quantum: number,
	) {
		this.y = floorStudsY() + topStuds - sprite.size.Y / 2;
	}

	frame(sim: BulletSimulation): void {
		if (sim !== this.sim) {
			this.sim = sim;
			this.parkAll();
		}
		const n = sim.highWater();
		this.moveParts.clear();
		this.moveCFrames.clear();
		const q = this.quantum;
		const holds = this.sprite.holds.size();
		for (let i = 0; i < n; i++) {
			if (!sim.isVisible(i) || !this.accepts(sim.payloadAt(i))) {
				if (i < this.parts.size()) this.park(i);
				continue;
			}
			const look = gooSpriteLook(sim.lifeAt(i), this.totalLife, i, this.look, holds);
			const alpha = math.round(look.transparency / q) * q;
			if (alpha >= 1) {
				if (i < this.parts.size()) this.park(i);
				continue;
			}
			while (this.parts.size() <= i) this.grow();
			const key = look.frame === "land" ? LAND_KEY : look.variant;
			if (key !== this.frameKey[i] || look.mirror !== this.mirrorKey[i]) {
				this.setCell(i, key, look.mirror);
			}
			if (alpha !== this.alphaKey[i]) {
				this.alphaKey[i] = alpha;
				this.labels[i].ImageTransparency = alpha;
			}
			const p = sim.positionAt(i);
			if (!this.shown[i] || p.x !== this.atX[i] || p.z !== this.atZ[i]) {
				this.atX[i] = p.x;
				this.atZ[i] = p.z;
				const offset = look.mirror ? this.sprite.mirroredOffset : this.sprite.offset;
				this.moveParts.push(this.parts[i]);
				this.moveCFrames.push(new CFrame(studsX(p.x), this.y, studsZ(p.z)).mul(FLOOR_CANVAS_YAW).mul(offset));
			}
			if (!this.shown[i]) {
				this.shown[i] = true;
				this.surfaces[i].Enabled = true;
			}
		}
		for (let i = n; i < this.parts.size(); i++) this.park(i);
		this.flush();
	}

	/** Anchors created so far. */
	poolSize(): number {
		return this.parts.size();
	}

	/** Writes cell `key` (LAND_KEY or a hold variant), mirrored by a negative ImageRectSize from the cell's right edge. */
	private setCell(i: number, key: number, mirror: boolean): void {
		this.frameKey[i] = key;
		this.mirrorKey[i] = mirror;
		const r = key === LAND_KEY ? this.sprite.land : this.sprite.holds[key] ?? this.sprite.holds[0];
		const label = this.labels[i];
		if (r.image !== this.imageKey[i]) {
			this.imageKey[i] = r.image;
			label.Image = r.image;
		}
		if (mirror) {
			label.ImageRectOffset = new Vector2(r.offset.X + r.size.X, r.offset.Y);
			label.ImageRectSize = new Vector2(-r.size.X, r.size.Y);
		} else {
			label.ImageRectOffset = r.offset;
			label.ImageRectSize = r.size;
		}
	}

	private park(i: number): void {
		if (!this.shown[i]) return;
		this.shown[i] = false;
		this.surfaces[i].Enabled = false;
		this.moveParts.push(this.parts[i]);
		this.moveCFrames.push(this.parked);
	}

	/** Parks every anchor (surfaces disabled) in one BulkMoveTo (DecalPool's stand-in discs draw meanwhile, SA17). */
	parkAll(): void {
		this.moveParts.clear();
		this.moveCFrames.clear();
		for (let i = 0; i < this.parts.size(); i++) this.park(i);
		this.flush();
	}

	private flush(): void {
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	private grow(): void {
		const { part, surface, label } = createSpriteAnchor(this.name, this.parked);
		part.Size = this.sprite.size;
		surface.CanvasSize = this.sprite.canvas;
		label.ResampleMode = this.sprite.resample;
		part.Parent = this.folder;
		this.parts.push(part);
		this.surfaces.push(surface);
		this.labels.push(label);
		this.shown.push(false);
		this.frameKey.push(NO_KEY);
		this.mirrorKey.push(false);
		this.alphaKey.push(0);
		this.atX.push(0);
		this.atZ.push(0);
		this.imageKey.push("");
	}
}
