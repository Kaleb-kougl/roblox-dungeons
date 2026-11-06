import { BUILD_BULLET_VIEW } from "shared/view";
import { renderPart } from "./placeholders";

/** A look's trail (docs/BUILDS.md BU8): its colour, size and offset, studs. */
export interface TrailLook {
	readonly color: Color3;
	readonly size: Vector3;
	/** Offset behind the bolt's centre along its axis (+Z local: CFrame.lookAlong points -Z down the velocity). */
	readonly offset: CFrame;
}

/**
 * The faint neon trail parts of one bullet pool, by bullet slot (created on first use; a Map: Luau arrays cannot
 * hold holes), docs/BUILDS.md BU8. `place` / `park` push into the pool's own BulkMoveTo lists, so a pool still moves
 * everything in one call. Shared by the neon BulletPool and the SpriteBulletPool (trails stay neon parts with sprites).
 */
export class BulletTrails {
	private readonly parts = new Map<number, BasePart>();
	private readonly shown = new Set<number>();
	private folder: Folder | undefined;

	constructor(private readonly parent: Folder, private readonly name: string, private readonly parked: CFrame) {}

	/** Shows slot `i`'s trail at `cf` this frame. */
	place(i: number, trail: TrailLook, cf: CFrame, moveParts: BasePart[], moveCFrames: CFrame[]): void {
		let t = this.parts.get(i);
		if (t === undefined) {
			t = renderPart("Part", false);
			t.Name = `${this.name}Trail`;
			t.Material = Enum.Material.Neon;
			t.Transparency = BUILD_BULLET_VIEW.trail.transparency;
			t.CFrame = this.parked;
			if (this.folder === undefined) {
				const f = new Instance("Folder");
				f.Name = BUILD_BULLET_VIEW.trail.folderName;
				f.Parent = this.parent;
				this.folder = f;
			}
			t.Parent = this.folder;
			this.parts.set(i, t);
		}
		if (t.Color !== trail.color) t.Color = trail.color;
		if (t.Size !== trail.size) t.Size = trail.size;
		moveParts.push(t);
		moveCFrames.push(cf);
		this.shown.add(i);
	}

	/** Parks slot `i`'s trail if it was shown. */
	park(i: number, moveParts: BasePart[], moveCFrames: CFrame[]): void {
		if (!this.shown.has(i)) return;
		const t = this.parts.get(i);
		this.shown.delete(i);
		if (t === undefined) return;
		moveParts.push(t);
		moveCFrames.push(this.parked);
	}

	/** Trail parts created so far. */
	size(): number {
		return this.parts.size();
	}
}
