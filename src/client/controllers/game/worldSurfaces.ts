import { STUDS_PER_TILE } from "shared/config";
import { BIOMES, MISSING_COLOR, type ImageRef, type PlaceholderVisual, type ThemePack } from "shared/theme";
import {
	GAME_WORLD,
	floorTextureOffsets,
	studsX,
	studsZ,
	wallTextureOffsets,
	type TileRect,
	type WallTextureFace,
} from "shared/view";
import { renderPart } from "../render/placeholders";

/** Grid cell (gx, gy) is centred on sim world (gx, gy): its edges are half a tile away. */
const HALF_TILE = 0.5;

/** One drawn world surface: a floor or a wall in its biome's look. */
export interface WorldSurface {
	readonly visual: PlaceholderVisual;
	readonly color: Color3;
	/** The Part material: the biome's `materials` entry for this surface (theme), else the placeholder's. */
	readonly material: Enum.Material;
	/**
	 * A repeating texture laid on the Parts' faces: the biome's floor image on floor slabs' top faces, its wall image
	 * on wall Parts' `textureFaces`, when the pack has one.
	 */
	readonly texture?: ImageRef;
	/** The faces that carry `texture` (wall Parts: GAME_WORLD.wallTextureFaces); undefined: the Top face (a floor). */
	readonly textureFaces?: ReadonlyArray<WallTextureFace>;
}

/** A floor's surfaces (worldSurfaces). */
export interface WorldSurfaces {
	readonly floor: WorldSurface;
	readonly wall: WorldSurface;
	readonly poolMaterial: Enum.Material;
	readonly abyss: Color3;
}

/**
 * The floor, wall and pool look of a Dungeon Forge theme (`themeKey`; undefined: the greybox), shared by
 * WorldController (the floor's slabs and walls) and SecretRenderController (a secret room's crack Part and chamber,
 * docs/SECRET_ROOMS.md SR7: the same material and world-anchored texture, so the crack shows no seam): the
 * `tile.<biome>.floor / .wall` placeholders of the biome whose forgeTheme matches (else biome 1's, with the pack's
 * `floor` / `wall` roles), their repeating images when the pack has them, the biome's materials and abyss colour.
 */
export function worldSurfaces(pack: ThemePack, themeKey: string | undefined): WorldSurfaces {
	const biome = themeKey !== undefined ? BIOMES.find((b) => b.forgeTheme === themeKey) : undefined;
	const floorId = biome !== undefined ? `tile.${biome.id}.floor` : "tile.biome.1.floor";
	const wallId = biome !== undefined ? `tile.${biome.id}.wall` : "tile.biome.1.wall";
	const floorVisual = pack.placeholder(floorId);
	const floorImage = pack.image(floorId);
	const wallVisual = pack.placeholder(wallId);
	const wallImage = pack.image(wallId);
	const usable = (hex: string) => hex.lower() !== MISSING_COLOR;
	const floorHex = pack.visualHex(floorVisual.color);
	const wallHex = pack.visualHex(wallVisual.color);
	// Only for a matched biome: its floor colour (the texture's mean colour in the vale pack) and its texture
	// describe the same floor; the greybox / unmatched floor keeps the plain `floor` role.
	const texture = biome !== undefined && floorImage?.tilesPerImage !== undefined ? floorImage : undefined;
	const materials = biome !== undefined ? pack.biome(biome.id).materials : undefined;
	// Textured or not, a surface keeps its biome material (a rough one under a repeating texture: the validator).
	const floorMaterial = materials?.floor ?? floorVisual.material;
	// The wall the same way: a repeating wall image (a matched biome only) on every wall Part's texture faces.
	const wallTexture = biome !== undefined && wallImage?.tilesPerImage !== undefined ? wallImage : undefined;
	const wallMaterial = materials?.wall ?? wallVisual.material;
	return {
		floor: {
			visual: floorVisual,
			color: biome !== undefined && usable(floorHex) ? pack.visualColor(floorVisual.color) : pack.color("floor"),
			material: Enum.Material[floorMaterial],
			texture,
		},
		wall: {
			visual: wallVisual,
			color: biome !== undefined && usable(wallHex) ? pack.visualColor(wallVisual.color) : pack.color("wall"),
			material: Enum.Material[wallMaterial],
			texture: wallTexture,
			textureFaces: wallTexture !== undefined ? GAME_WORLD.wallTextureFaces : undefined,
		},
		poolMaterial: Enum.Material[materials?.pool ?? floorVisual.material],
		// the backdrop: the biome's abyss (docs/VOID_DECOR.md VD1 / VD3); greybox / unmatched keep `background`
		abyss: biome !== undefined ? pack.biome(biome.id).abyssColor : pack.color("background"),
	};
}

/**
 * One Part per rectangle in `folder` (grid cell (gx, gy) is centred on sim world (gx, gy)), `height` studs tall centred
 * at `centerY`, in `surface`'s colour and material. With a repeating texture every Part gets it, world-anchored (its
 * pattern starts at the Part's world corner mod the period, so merged Parts and Parts built apart show no seam): on the
 * Top face (a floor) or on every `textureFaces` face hung from the top edge (a wall). Returns the Parts in rect order.
 */
export function buildWorldSlabs(
	folder: Instance,
	name: string,
	rects: ReadonlyArray<TileRect>,
	surface: WorldSurface,
	centerY: number,
	height: number,
	castShadow: boolean,
): Part[] {
	const S = STUDS_PER_TILE;
	const parts = new Array<Part>();
	for (const r of rects) {
		const part = renderPart("Part", castShadow);
		part.Name = name;
		part.Size = new Vector3(r.w * S, height, r.h * S);
		part.CFrame = new CFrame(studsX(r.x + (r.w - 1) / 2), centerY, studsZ(r.y + (r.h - 1) / 2));
		part.Color = surface.color;
		part.Material = surface.material;
		const image = surface.texture;
		if (image !== undefined && image.tilesPerImage !== undefined) {
			// The image repeats every tilesPerImage tiles both ways (its own pixel density: a 1-tile wall face
			// shows 1 / tilesPerImage of its height); the Part keeps the biome colour underneath.
			const period = image.tilesPerImage * S;
			const minX = studsX(r.x - HALF_TILE);
			const minZ = studsZ(r.y - HALF_TILE);
			const maxX = studsX(r.x + r.w - HALF_TILE);
			const maxZ = studsZ(r.y + r.h - HALF_TILE);
			const faces = surface.textureFaces;
			if (faces === undefined) {
				const offsets = floorTextureOffsets(minX, minZ, maxX, maxZ, period, GAME_WORLD.floorTextureUV);
				faceTexture(part, image.assetId, Enum.NormalId.Top, period, offsets);
			} else {
				for (const face of faces) {
					const offsets = wallTextureOffsets(
						face,
						minX,
						minZ,
						maxX,
						maxZ,
						height,
						period,
						GAME_WORLD.wallTextureUV,
					);
					faceTexture(part, image.assetId, Enum.NormalId[face], period, offsets);
				}
			}
		}
		part.Parent = folder;
		parts.push(part);
	}
	return parts;
}

/** One repeating Texture on `face` of `part`, `period` studs square, shifted by `offsets` (OffsetStudsU / V). */
function faceTexture(
	part: Part,
	assetId: string,
	face: Enum.NormalId,
	period: number,
	offsets: readonly [number, number],
): void {
	const texture = new Instance("Texture");
	texture.Face = face;
	texture.Texture = assetId;
	texture.StudsPerTileU = period;
	texture.StudsPerTileV = period;
	texture.OffsetStudsU = offsets[0];
	texture.OffsetStudsV = offsets[1];
	texture.Parent = part;
}
