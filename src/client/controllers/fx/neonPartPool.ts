import { STUDS_PER_TILE } from "shared/config";
import { floorStudsY, studsX, studsZ } from "shared/view";
import { FX_VIEW, FULL_RING_HALF_ANGLE, type WaveOneRingView } from "shared/view/fx";
import { renderPart } from "../render/placeholders";

const PARKED = new CFrame(FX_VIEW.parkedStuds[0], FX_VIEW.parkedStuds[1], FX_VIEW.parkedStuds[2]);
/** Transparency writes are quantized to this step (a write only on a change). */
const ALPHA_QUANTUM = 0.05;

/** One pooled Neon part and the properties last written to it. */
interface NeonPart {
	readonly part: Part;
	color: Color3 | undefined;
	alpha: number;
	size: Vector3 | undefined;
}

/**
 * A grow-only pool of Neon parts used front to back each frame (BuildFxController's construction, docs/BUILDS.md BU8):
 * `begin`, `place` per part into the frame's BulkMoveTo lists, `end` parks the ones this frame left unused. Builds v2
 * BV11d's Wrecker rings and Full Heart beams draw through it.
 */
export class NeonPartPool {
	private readonly parts = new Array<NeonPart>();
	private used = 0;
	private lastUsed = 0;

	constructor(
		private readonly folder: Folder,
		private readonly name: string,
		private readonly shape: Enum.PartType,
	) {}

	begin(): void {
		this.used = 0;
	}

	/** The next part, styled; its CFrame goes into the frame's move lists. */
	place(
		cf: CFrame,
		size: Vector3,
		color: Color3,
		transparency: number,
		moveParts: BasePart[],
		moveCFrames: CFrame[],
	): void {
		if (this.used >= this.parts.size()) {
			const part = renderPart("Part", false);
			part.Name = this.name;
			part.Shape = this.shape;
			part.Material = Enum.Material.Neon;
			part.CFrame = PARKED;
			part.Parent = this.folder;
			this.parts.push({ part, color: undefined, alpha: -1, size: undefined });
		}
		const p = this.parts[this.used];
		this.used++;
		if (p.color !== color) {
			p.color = color;
			p.part.Color = color;
		}
		const a = math.clamp(math.round(transparency / ALPHA_QUANTUM) * ALPHA_QUANTUM, 0, 1);
		if (a !== p.alpha) {
			p.alpha = a;
			p.part.Transparency = a;
		}
		if (p.size !== size) {
			p.size = size;
			p.part.Size = size;
		}
		moveParts.push(p.part);
		moveCFrames.push(cf);
	}

	/** Parks every part this frame left unused. */
	end(moveParts: BasePart[], moveCFrames: CFrame[]): void {
		for (let i = this.used; i < this.lastUsed; i++) {
			moveParts.push(this.parts[i].part);
			moveCFrames.push(PARKED);
		}
		this.lastUsed = this.used;
	}

	size(): number {
		return this.parts.size();
	}
}

/**
 * One wave 1 floor ring (shared/view/fx WaveOneRingView) as `ring.segments` flat chords round (x, z) at its radius,
 * sized by its block (widthStuds radial, thicknessStuds tall, liftStuds over the floor), at 1 - fade transparency; a fan
 * (halfAngleRad < pi) spreads its segments over dir +- halfAngleRad instead of the full turn.
 */
export function placeWaveOneRing(
	pool: NeonPartPool,
	ring: Readonly<WaveOneRingView>,
	color: Color3,
	moveParts: BasePart[],
	moveCFrames: CFrame[],
): void {
	const n = ring.segments;
	const radius = ring.radius * STUDS_PER_TILE;
	if (n <= 0 || radius <= 0 || ring.fade <= 0) return;
	const b = ring.block;
	const full = ring.halfAngleRad >= FULL_RING_HALF_ANGLE;
	const span = full ? 2 * math.pi : 2 * math.max(ring.halfAngleRad, 0);
	if (span <= 0) return;
	const start = full ? 0 : math.atan2(ring.dirZ, ring.dirX) - ring.halfAngleRad;
	const step = span / n;
	const chord = 2 * radius * math.sin(step / 2);
	if (chord <= 0) return;
	const y = floorStudsY() + b.liftStuds;
	const cx = studsX(ring.x);
	const cz = studsZ(ring.z);
	const size = new Vector3(b.widthStuds, b.thicknessStuds, chord);
	const alpha = 1 - ring.fade;
	for (let i = 0; i < n; i++) {
		const angle = start + step * (i + 0.5);
		const px = cx + radius * math.cos(angle);
		const pz = cz + radius * math.sin(angle);
		// The chord runs along the tangent: look along (-sin, cos).
		const cf = CFrame.lookAlong(new Vector3(px, y, pz), new Vector3(-math.sin(angle), 0, math.cos(angle)));
		pool.place(cf, size, color, alpha, moveParts, moveCFrames);
	}
}
