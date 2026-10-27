import { Workspace } from "@rbxts/services";
import { STUDS_PER_TILE } from "shared/config";
import { BULLET_VIEW, MARKING_VIEW, dashLayout, floorStudsY, studsX, studsZ, type SegmentSink } from "shared/view";
import { renderPart } from "./placeholders";

/** One dash's look: size in studs (length along the line), gap between dashes, colour, material, transparency. */
export interface DashStyle {
	readonly width: number;
	readonly height: number;
	readonly length: number;
	readonly gap: number;
	readonly color: Color3;
	readonly material: Enum.Material;
	readonly transparency: number;
	/**
	 * Height of the dash's bottom above the floor, studs. Absent: MARKING_VIEW.liftTiles (every marking layer); room
	 * edges (docs/ROOM_EDGES.md) sit lower, under the tutorial arrow and the markings.
	 */
	readonly liftStuds?: number;
}

const PARKED = new CFrame(BULLET_VIEW.parkedStuds[0], BULLET_VIEW.parkedStuds[1], BULLET_VIEW.parkedStuds[2]);
const MIN_SEGMENT_STUDS = 1e-4;

/**
 * A layer of floor markings drawn as dashed lines of FIXED-size Parts (no Size writes per frame): each frame,
 * `begin()`, then any number of `seg(x0, z0, x1, z1)` in sim world units (it is a SegmentSink, so the shared/view
 * marking builders draw straight into it), then `finish()`, which grows the pool as needed and moves every dash that
 * changed with ONE workspace:BulkMoveTo (unused dashes are parked far below the world).
 */
export class DashLayer implements SegmentSink {
	private readonly parts = new Array<BasePart>();
	private readonly cframes = new Array<CFrame>();
	/** Where each pooled dash was last moved to (CFrame == compares by value), so a static layout costs no moves. */
	private readonly placed = new Array<CFrame>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	private used = 0;
	private shown = 0;
	private color: Color3;
	private transparency: number;
	private readonly size: Vector3;
	private readonly y: number;

	constructor(private readonly folder: Instance, private readonly name: string, private readonly style: DashStyle) {
		this.color = style.color;
		this.transparency = style.transparency;
		this.size = new Vector3(style.width, style.height, style.length);
		this.y = floorStudsY() + (style.liftStuds ?? MARKING_VIEW.liftTiles * STUDS_PER_TILE) + style.height / 2;
	}

	begin(): void {
		this.used = 0;
	}

	seg(x0: number, z0: number, x1: number, z1: number): void {
		const ax = studsX(x0);
		const az = studsZ(z0);
		const dx = studsX(x1) - ax;
		const dz = studsZ(z1) - az;
		const len = math.sqrt(dx * dx + dz * dz);
		if (len < MIN_SEGMENT_STUDS) return;
		const ux = dx / len;
		const uz = dz / len;
		const layout = dashLayout(len, this.style.length, this.style.gap);
		for (let k = 0; k < layout.count; k++) {
			const t = layout.first + k * layout.step;
			const cx = ax + ux * t;
			const cz = az + uz * t;
			// LookVector (-Z) along the line: the dash's length (Size.Z) runs down it.
			this.cframes[this.used] = CFrame.lookAlong(new Vector3(cx, this.y, cz), new Vector3(ux, 0, uz));
			this.used++;
		}
	}

	/** Recolours every dash (only when the colour actually changes). */
	setColor(color: Color3): void {
		if (color === this.color) return;
		this.color = color;
		for (const p of this.parts) p.Color = color;
	}

	/** Changes every dash's transparency (only when it changes). */
	setTransparency(transparency: number): void {
		if (transparency === this.transparency) return;
		this.transparency = transparency;
		for (const p of this.parts) p.Transparency = transparency;
	}

	finish(): void {
		while (this.parts.size() < this.used) {
			this.parts.push(this.makePart());
			this.placed.push(PARKED);
		}
		this.moveParts.clear();
		this.moveCFrames.clear();
		for (let i = 0; i < this.used; i++) this.move(i, this.cframes[i]);
		for (let i = this.used; i < this.shown; i++) this.move(i, PARKED);
		this.shown = this.used;
		if (this.moveParts.size() > 0) {
			Workspace.BulkMoveTo(this.moveParts, this.moveCFrames, Enum.BulkMoveMode.FireCFrameChanged);
		}
	}

	/** Dashes in the pool (for part budgets). */
	poolSize(): number {
		return this.parts.size();
	}

	destroy(): void {
		for (const p of this.parts) p.Destroy();
		this.parts.clear();
		this.cframes.clear();
		this.placed.clear();
		this.used = 0;
		this.shown = 0;
	}

	private move(i: number, cframe: CFrame): void {
		if (this.placed[i] === cframe) return;
		this.placed[i] = cframe;
		this.moveParts.push(this.parts[i]);
		this.moveCFrames.push(cframe);
	}

	private makePart(): BasePart {
		const p = renderPart("Part", false);
		p.Name = this.name;
		p.Size = this.size;
		p.Color = this.color;
		p.Material = this.style.material;
		p.Transparency = this.transparency;
		p.CFrame = PARKED;
		p.Parent = this.folder;
		return p;
	}
}
