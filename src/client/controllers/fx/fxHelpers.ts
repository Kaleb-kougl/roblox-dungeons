import { Workspace } from "@rbxts/services";
import { CAMERA_PITCH_DEG } from "shared/config";
import { archetypeAt } from "shared/sim";
import type { ThemePack } from "shared/theme";
import { ACTOR_VIEW, degToRad, floorStudsY, studsX, studsZ } from "shared/view";
import { ActorSizeCache, FX_VIEW, placeholderScreenSize, type DrawnSize } from "shared/view/fx";

const PITCH = degToRad(CAMERA_PITCH_DEG);

/**
 * Per archetype kind: the drawn size of its placeholder model in render px (width across the view, top edge above the
 * feet), scaled exactly as ActorRenderController builds it (spriteScale, bosses at least ACTOR_VIEW.bossMinDrawPx
 * wide). Health bars sit on that top edge, damage numbers above it.
 */
export function placeholderSizeCache(pack: ThemePack): ActorSizeCache {
	return new ActorSizeCache((kind) => {
		const data = archetypeAt(kind).data;
		const visual = pack.placeholder(data.spriteId);
		const boss = data.boss === true;
		let scale = data.spriteScale ?? 1;
		if (boss && visual.cellPx.w * scale < ACTOR_VIEW.bossMinDrawPx)
			scale = ACTOR_VIEW.bossMinDrawPx / visual.cellPx.w;
		const out: DrawnSize = { w: 0, h: 0 };
		placeholderScreenSize(visual.size, scale, PITCH, FX_VIEW.pxStuds, out);
		return { w: out.w, h: out.h, boss };
	});
}

/** The studs position of a sim floor point (x, z). */
export function floorPoint(x: number, z: number): Vector3 {
	return new Vector3(studsX(x), floorStudsY(), studsZ(z));
}

/** A folder under Workspace for one juice view's instances. */
export function fxFolder(name: string): Folder {
	const folder = new Instance("Folder");
	folder.Name = name;
	folder.Parent = Workspace;
	return folder;
}

/** An invisible anchored holder part for attachments (BillboardGui adornees), parked at the world origin. */
export function attachmentHolder(parent: Instance, name: string): Part {
	const part = new Instance("Part");
	part.Name = name;
	part.Anchored = true;
	part.CanCollide = false;
	part.CanQuery = false;
	part.CanTouch = false;
	part.CastShadow = false;
	part.Transparency = 1;
	part.Size = Vector3.one;
	part.CFrame = new CFrame(0, floorStudsY(), 0);
	part.Parent = parent;
	return part;
}
