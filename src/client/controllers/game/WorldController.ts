import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import { STUDS_PER_TILE } from "shared/config";
import { THEMES, TileType, type Dungeon } from "shared/dungeon";
import { DEFAULT_BOUNDS, type SimConfig } from "shared/sim";
import { BIOMES, MISSING_COLOR, type ImageRef, type PlaceholderVisual, type ThemePack } from "shared/theme";
import {
	GAME_WORLD,
	VOID,
	floorStudsY,
	floorTextureOffsets,
	greedyRectsOf,
	studsX,
	studsZ,
	wallTextureOffsets,
	type TileRect,
	type WallTextureFace,
} from "shared/view";
import { renderPart } from "../render/placeholders";
import { SimController, type RunContext } from "./SimController";
import { ThemeController } from "./ThemeController";

const RGB_SHIFT_R = 16;
const RGB_SHIFT_G = 8;
const RGB_MASK = 0xff;
/** Grid cell (gx, gy) is centred on sim world (gx, gy): its edges are half a tile away. */
const HALF_TILE = 0.5;

interface Surface {
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

/**
 * Builds the run's floor in Workspace (web DungeonFloor): floor slabs, wall blocks and sunken pools from the Dungeon
 * Forge grid, each tile type merged into as few Parts as the greedy rectangle scan finds (shared/view tileMerge.ts;
 * seed 1337: 1,840 tiles -> 133 Parts), plus one backdrop slab under everything: the abyss (docs/VOID_DECOR.md VD3),
 * VOID.abyssDepthTiles under the floor in the matched biome's `abyss` colour (the greybox / an unmatched theme: the
 * `background` colour role). The void's shoulder and ledge columns standing on it are VoidController's.
 * Sizes and colours come from the theme: `tile.biome.<n>.floor / .wall` placeholders of the biome whose Dungeon Forge
 * theme matches the floor (falling back to the pack's `floor` / `wall` roles, as the web build does). When the pack has
 * the biome's floor tile as an image with `tilesPerImage`, every floor slab also gets it as a top-face Texture
 * repeating every tilesPerImage tiles, offset by the slab's world corner so the pattern runs on across slabs
 * (shared/view floorTextureOffsets; the biome colour stays on the Part). Likewise a biome whose wall tile is such an
 * image draws it on every wall Part's GAME_WORLD.wallTextureFaces (the Top face and the four sides: 5 Textures per wall
 * Part), world-anchored along each face and hung from the wall's top edge (shared/view wallTextureOffsets), the wall
 * Part in the biome's wall material; without a wall image walls draw as before. Pools have no
 * theme role yet: like the web build they use the Dungeon Forge theme's liquid colour (data in shared/dungeon).
 * Materials (docs/DECOR.md R1): floor, wall and pool Parts take the matched biome's `materials` (ThemePack.biome,
 * SmoothPlastic where the pack names none), mapped through `Enum.Material[name]`, textured surfaces too (the
 * validator requires a rough one under a repeating texture: SmoothPlastic's sun glint washes it out). Pillar cells that
 * the Forge turns solid are WALL tiles, so they merge into the wall Parts and get the wall material like any wall.
 * Per-cell floor variants (tint or material by cell hash) are not done: they would need un-merged floor Parts.
 *
 * Rebuilt only when the run's floor changes (a restart on the same seed reuses the cached Dungeon object; in endless
 * mode, every floor change). The greybox world gets a plain floor over the sim's bounds.
 */
@Controller({})
export class WorldController implements OnStart {
	private built: Dungeon | "greybox" | undefined;
	private janitor = new Janitor();
	private partCount = 0;

	constructor(private readonly sim: SimController, private readonly theme: ThemeController) {}

	onStart(): void {
		this.sim.onRunStarted((ctx) => this.onRun(ctx));
		// Endless mode: every new floor replaces the world (the old floor's Parts go with the janitor).
		this.sim.onFloorChanged((ctx) => this.onRun(ctx));
	}

	/** Parts in the current world (for budgets / the smoke test). */
	getPartCount(): number {
		return this.partCount;
	}

	private onRun(ctx: RunContext): void {
		const key = ctx.dungeon ?? "greybox";
		if (key === this.built) return;
		this.janitor.Cleanup();
		this.built = key;
		const folder = new Instance("Folder");
		folder.Name = GAME_WORLD.folderName;
		this.janitor.Add(folder);
		const pack = this.theme.getPack();
		this.partCount =
			ctx.dungeon !== undefined
				? this.buildDungeon(pack, ctx.dungeon, folder)
				: this.buildGreybox(pack, ctx.config, folder);
		folder.Parent = Workspace;
		print(`[World] built ${this.partCount} parts (${ctx.dungeon !== undefined ? ctx.dungeon.name : "greybox"})`);
	}

	private surfaces(
		pack: ThemePack,
		themeKey: string | undefined,
	): { floor: Surface; wall: Surface; poolMaterial: Enum.Material; abyss: Color3 } {
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
				color:
					biome !== undefined && usable(floorHex) ? pack.visualColor(floorVisual.color) : pack.color("floor"),
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

	private buildDungeon(pack: ThemePack, d: Dungeon, folder: Folder): number {
		const { floor, wall, poolMaterial, abyss } = this.surfaces(pack, d.params.themeKey);
		const S = STUDS_PER_TILE;
		const floorThick = floor.visual.size[1];
		const wallHeight = GAME_WORLD.wallHeightTiles * S;
		const y0 = floorStudsY();
		// solid decor (docs/DECOR.md "Solid decor"): WALL for the sim, drawn as floor under its art (DecorController)
		const grid = [...d.grid];
		for (const piece of d.solidDecor ?? [])
			for (let gy = piece.y; gy < piece.y + piece.h; gy++)
				for (let gx = piece.x; gx < piece.x + piece.w; gx++) grid[gy * d.W + gx] = TileType.FLOOR;
		let n = 0;
		n += this.slabs(
			folder,
			"Floor",
			greedyRectsOf(grid, d.W, d.H, TileType.FLOOR),
			floor,
			y0 - floorThick / 2,
			floorThick,
			false,
		);
		n += this.slabs(
			folder,
			"Wall",
			greedyRectsOf(grid, d.W, d.H, TileType.WALL),
			wall,
			y0 + wallHeight / 2,
			wallHeight,
			true,
		);
		const liquid = THEMES[d.params.themeKey].pools;
		const poolColor =
			liquid !== undefined
				? Color3.fromRGB(
						bit32.band(bit32.rshift(liquid.colB, RGB_SHIFT_R), RGB_MASK),
						bit32.band(bit32.rshift(liquid.colB, RGB_SHIFT_G), RGB_MASK),
						bit32.band(liquid.colB, RGB_MASK),
				  )
				: pack.color("background");
		const poolThick = GAME_WORLD.poolThicknessTiles * S;
		n += this.slabs(
			folder,
			"Pool",
			greedyRectsOf(d.grid, d.W, d.H, TileType.POOL),
			{ visual: floor.visual, color: poolColor, material: poolMaterial }, // no floor texture on pools
			y0 - GAME_WORLD.poolSinkTiles * S - poolThick / 2,
			poolThick,
			false,
		);
		n += this.backdrop(abyss, folder, -0.5, -0.5, d.W - 0.5, d.H - 0.5);
		return n;
	}

	private buildGreybox(pack: ThemePack, config: Readonly<SimConfig>, folder: Folder): number {
		const { floor } = this.surfaces(pack, undefined);
		const b = config.bounds ?? DEFAULT_BOUNDS;
		const minX = math.floor(b.minX);
		const minZ = math.floor(b.minZ);
		const w = math.ceil(b.maxX) - minX + 1;
		const h = math.ceil(b.maxZ) - minZ + 1;
		const thick = floor.visual.size[1];
		const rect: TileRect = { x: minX, y: minZ, w, h };
		let n = this.slabs(folder, "Floor", [rect], floor, floorStudsY() - thick / 2, thick, false);
		n += this.backdrop(pack.color("background"), folder, minX - 0.5, minZ - 0.5, minX + w - 0.5, minZ + h - 0.5);
		return n;
	}

	/** One Part per rectangle: grid cell (gx, gy) is centred on sim world (gx, gy). */
	private slabs(
		folder: Folder,
		name: string,
		rects: ReadonlyArray<TileRect>,
		surface: Surface,
		centerY: number,
		height: number,
		castShadow: boolean,
	): number {
		const S = STUDS_PER_TILE;
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
				// Start the pattern at the Part's world corner (mod the period), so merged Parts show no seams.
				const faces = surface.textureFaces;
				if (faces === undefined) {
					const offsets = floorTextureOffsets(minX, minZ, maxX, maxZ, period, GAME_WORLD.floorTextureUV);
					this.faceTexture(part, image.assetId, Enum.NormalId.Top, period, offsets);
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
						this.faceTexture(part, image.assetId, Enum.NormalId[face], period, offsets);
					}
				}
			}
			part.Parent = folder;
		}
		return rects.size();
	}

	/** One repeating Texture on `face` of `part`, `period` studs square, shifted by `offsets` (OffsetStudsU / V). */
	private faceTexture(
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

	/**
	 * The backdrop (the abyss): one slab whose top face lies VOID.abyssDepthTiles below the floor, past the floor's
	 * edges by GAME_WORLD.backdropMarginTiles (28: past the screen corners' reach on its plane for a 21:9 landscape and
	 * the tallest portrait view, shared/view backdropReachTiles; docs/PORTRAIT.md PT4).
	 */
	private backdrop(color: Color3, folder: Folder, minX: number, minZ: number, maxX: number, maxZ: number): number {
		const S = STUDS_PER_TILE;
		const m = GAME_WORLD.backdropMarginTiles;
		const thick = GAME_WORLD.backdropThicknessTiles * S;
		const part = renderPart("Part", false);
		part.Name = "Backdrop";
		part.Size = new Vector3((maxX - minX + 2 * m) * S, thick, (maxZ - minZ + 2 * m) * S);
		part.CFrame = new CFrame(
			studsX((minX + maxX) / 2),
			floorStudsY() - VOID.abyssDepthTiles * S - thick / 2,
			studsZ((minZ + maxZ) / 2),
		);
		part.Color = color;
		part.Material = Enum.Material.SmoothPlastic;
		part.Parent = folder;
		return 1;
	}
}
