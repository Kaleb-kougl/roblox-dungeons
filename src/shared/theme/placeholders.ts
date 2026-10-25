/**
 * Placeholder visuals: what the renderers build for an ID whose manifest entry is
 * `{ kind: "placeholder" }` (every visual ID in the placeholder pack). Pure data, no Instances:
 * the task 8 renderers turn each entry into a Part (`Enum.PartType[shape]`, or a Cylinder plus
 * two Balls for "Capsule"), `Enum.Material[material]`, tinted with `pack.visualColor(color)`.
 *
 * Sizes come from the sprite contract cell (contract.ts): the web camera shows PIXELS_PER_TILE
 * (16) render pixels per world unit, and a world unit is STUDS_PER_TILE studs (shared/config/view),
 * so a 16 x 24 class cell is 4 x 6 studs. Each entry scales its cell by fixed fractions
 * (PLACEHOLDER_PROPORTIONS) so archetypes read apart by silhouette as well as colour.
 *
 * Colours are ROLES (or a biome surface), never literals, so a pack recolours placeholders too.
 * Sizes are presentation only: bullet and actor renderers scale to the gameplay radius, exactly
 * as the web build scales sprites, so nothing here can change difficulty.
 */

import { PIXELS_PER_TILE, STUDS_PER_TILE } from "shared/config";
import {
	BIOMES,
	BOSS,
	BOSS_IDS,
	BULLET,
	CHARACTER,
	CLASS_IDS,
	DIGIT_FONT,
	ENEMY,
	ITEM,
	TILE,
	slotFor,
	type EnemyArchetype,
} from "./contract";
import type { BiomeTileKey, ColorRole } from "./types";
import { startsWith } from "./util";

/** Part shapes. Ball/Block/Cylinder/Wedge are Enum.PartType names; Capsule = a Cylinder capped by two Balls. */
export const PLACEHOLDER_SHAPES = ["Ball", "Block", "Cylinder", "Wedge", "Capsule"] as const;
export type PlaceholderShape = (typeof PLACEHOLDER_SHAPES)[number];

/** Enum.Material names: Neon for bullets (they must glow on every floor), SmoothPlastic for everything else. */
export const PLACEHOLDER_MATERIALS = ["Neon", "SmoothPlastic"] as const;
export type PlaceholderMaterial = (typeof PLACEHOLDER_MATERIALS)[number];

/** Where a placeholder's colour comes from. Resolve with `pack.visualColor(ref)` / `pack.visualHex(ref)`. */
export type PlaceholderColor =
	| { readonly kind: "role"; readonly role: ColorRole }
	/** A biome's floor / wall colour (tiles). */
	| { readonly kind: "biome"; readonly biome: string; readonly surface: BiomeTileKey }
	/** MISSING_COLOR (magenta): the ID is not in the pack. */
	| { readonly kind: "missing" };

export interface PlaceholderVisual {
	readonly shape: PlaceholderShape;
	/**
	 * Part size in studs: x = width (screen right / the actor's right), y = height (up),
	 * z = depth (along the facing; a Wedge's sloped face is its Front, so a part whose CFrame looks along
	 * the facing points that way).
	 */
	readonly size: readonly [number, number, number];
	/** The sprite cell this stands in for, in pixels (HUD and billboard placeholders size by this). */
	readonly cellPx: { readonly w: number; readonly h: number };
	readonly color: PlaceholderColor;
	readonly material: PlaceholderMaterial;
	/** Optional outline colour role (a Highlight / SelectionBox; bullets: the dark ring that makes them read). */
	readonly outline?: ColorRole;
	/** Turn the part to face the actor's facing / the bullet's velocity. */
	readonly faces: boolean;
	/** "base": the bottom sits on the floor at the position (the sprite's foot pivot); "center": centred on it. */
	readonly anchor: "base" | "center";
	/** A dashed line (telegraphs): `size` is ONE dash, repeated every dash + gap studs along the line. */
	readonly dash?: { readonly length: number; readonly gap: number };
}

/** Render pixels -> studs, at the web camera's scale. */
export function pxToStuds(px: number): number {
	return (px / PIXELS_PER_TILE) * STUDS_PER_TILE;
}

/**
 * Fractions of the contract cell each placeholder occupies: [width of cell.w, height of cell.h,
 * depth of cell.w]. Presentation tunables; edit here, not in the table.
 */
export const PLACEHOLDER_PROPORTIONS = {
	/** Classes: a capsule as tall as the cell, 3/4 as wide (3 x 6 x 3 studs, the spike's stand-in). */
	class: [0.75, 1, 0.75],
	/** Swarmer: a small ball, half the cell. */
	swarmer: [0.5, 0.5, 0.5],
	/** Sniper: a wedge, longer than wide, pointing along its facing. */
	sniper: [0.75, 0.75, 1],
	/** Bruiser: a heavy block filling the cell. */
	bruiser: [1, 1, 1],
	/** Sprayer: a squat drum. */
	sprayer: [0.75, 0.625, 0.75],
	/** Caster: a slim capsule. */
	caster: [0.625, 1, 0.625],
	/** Summoner: a tall drum. */
	summoner: [0.75, 1, 0.75],
	/** Bosses: a large block, the full 48 x 48 cell wide, 3/4 tall. */
	boss: [1, 0.75, 1],
	/** Enemy bullets: a ball filling the 8 px cell (the renderer scales it to the gameplay radius). */
	enemyBullet: [1, 1, 1],
	/** Needle bullets: a thin neon sliver along the velocity. */
	needle: [0.25, 0.25, 1],
	/** Player bullets: a thin bolt along the velocity. */
	playerBolt: [0.25, 0.25, 1],
	/** Heavy player bullets: a thicker bolt. */
	playerHeavyBolt: [0.5, 0.5, 1],
	/** Floor tile: a 1 px thick slab covering the tile. */
	floorTile: [1, 1 / 16, 1],
	/** Wall tile: a cube one tile tall (the web build's wallHeight = 1 tile). */
	wallTile: [1, 1, 1],
	/** Loot on the floor: half the cell. */
	item: [0.5, 0.5, 0.5],
	/** UI: flat, as big as its pixel size. */
	ui: [1, 1, 0],
	/** Missing IDs: a block filling the cell. */
	missing: [1, 1, 1],
} as const satisfies Record<string, readonly [number, number, number]>;

type Proportions = readonly [number, number, number];
type Cell = { readonly w: number; readonly h: number };

function studs(cell: Cell, p: Proportions): readonly [number, number, number] {
	return [pxToStuds(cell.w * p[0]), pxToStuds(cell.h * p[1]), pxToStuds(cell.w * p[2])];
}

const role = (r: ColorRole): PlaceholderColor => ({ kind: "role", role: r });

interface Spec {
	shape: PlaceholderShape;
	cell: Cell;
	proportions: Proportions;
	color: PlaceholderColor;
	material?: PlaceholderMaterial;
	outline?: ColorRole;
	faces?: boolean;
	anchor?: "base" | "center";
}

function visual(spec: Spec): PlaceholderVisual {
	return {
		shape: spec.shape,
		size: studs(spec.cell, spec.proportions),
		cellPx: { w: spec.cell.w, h: spec.cell.h },
		color: spec.color,
		material: spec.material ?? "SmoothPlastic",
		outline: spec.outline,
		faces: spec.faces ?? false,
		anchor: spec.anchor ?? "base",
	};
}

const CLASS_CELL = CHARACTER.cell as Cell;
const ENEMY_CELL = ENEMY.cell as Cell;
const BOSS_CELL = BOSS.cell as Cell;
const BULLET_CELL = BULLET.cell as Cell;
const TILE_CELL = TILE.cell as Cell;
const ITEM_CELL = ITEM.cell as Cell;
/** Free-size UI cells: the web placeholder pack's sizes, in pixels. */
const UI_CELLS = {
	cursor: { w: 9, h: 9 },
	panel: { w: 32, h: 32 },
	icon: { w: 12, h: 12 },
	digits: { w: DIGIT_FONT.cellW, h: DIGIT_FONT.cellH },
} as const;

const classVisual = (id: string): PlaceholderVisual =>
	visual({
		shape: "Capsule",
		cell: CLASS_CELL,
		proportions: PLACEHOLDER_PROPORTIONS.class,
		color: role(id as ColorRole),
		faces: true,
	});

const ENEMY_SHAPES: Record<EnemyArchetype, { shape: PlaceholderShape; proportions: Proportions }> = {
	swarmer: { shape: "Ball", proportions: PLACEHOLDER_PROPORTIONS.swarmer },
	sprayer: { shape: "Cylinder", proportions: PLACEHOLDER_PROPORTIONS.sprayer },
	sniper: { shape: "Wedge", proportions: PLACEHOLDER_PROPORTIONS.sniper },
	bruiser: { shape: "Block", proportions: PLACEHOLDER_PROPORTIONS.bruiser },
	caster: { shape: "Capsule", proportions: PLACEHOLDER_PROPORTIONS.caster },
	summoner: { shape: "Cylinder", proportions: PLACEHOLDER_PROPORTIONS.summoner },
};

const enemyVisual = (archetype: EnemyArchetype): PlaceholderVisual =>
	visual({
		shape: ENEMY_SHAPES[archetype].shape,
		cell: ENEMY_CELL,
		proportions: ENEMY_SHAPES[archetype].proportions,
		color: role(`enemy.${archetype}`),
		faces: true,
	});

const bossVisual = (): PlaceholderVisual =>
	visual({ shape: "Block", cell: BOSS_CELL, proportions: PLACEHOLDER_PROPORTIONS.boss, color: role("boss") });

const enemyBulletVisual = (shape: PlaceholderShape, proportions: Proportions): PlaceholderVisual =>
	visual({
		shape,
		cell: BULLET_CELL,
		proportions,
		color: role("enemyBullet"),
		outline: "enemyBulletOutline",
		material: "Neon",
		faces: true,
		anchor: "center",
	});

const playerBulletVisual = (proportions: Proportions): PlaceholderVisual =>
	visual({
		shape: "Block",
		cell: BULLET_CELL,
		proportions,
		color: role("playerBullet"),
		outline: "playerBulletOutline",
		material: "Neon",
		faces: true,
		anchor: "center",
	});

const tileVisual = (biome: string, surface: BiomeTileKey): PlaceholderVisual =>
	visual({
		shape: "Block",
		cell: TILE_CELL,
		proportions: surface === "floor" ? PLACEHOLDER_PROPORTIONS.floorTile : PLACEHOLDER_PROPORTIONS.wallTile,
		color: { kind: "biome", biome, surface },
	});

const itemVisual = (shape: PlaceholderShape, color: ColorRole): PlaceholderVisual =>
	visual({ shape, cell: ITEM_CELL, proportions: PLACEHOLDER_PROPORTIONS.item, color: role(color) });

const uiVisual = (cell: Cell, color: ColorRole, outline?: ColorRole): PlaceholderVisual =>
	visual({
		shape: "Block",
		cell,
		proportions: PLACEHOLDER_PROPORTIONS.ui,
		color: role(color),
		outline,
		anchor: "center",
	});

function buildTable(): Record<string, PlaceholderVisual> {
	const t: Record<string, PlaceholderVisual> = {};
	// Classes: a capsule in the class's identity colour (vanguard, the M1 player, is tan).
	for (const c of CLASS_IDS) {
		t[`class.${c}`] = classVisual(`class.${c}`);
	}
	// Enemies: one silhouette per archetype (swarmer ball, sniper wedge, bruiser block, ...).
	for (const archetype of ["swarmer", "sprayer", "sniper", "bruiser", "caster", "summoner"] as const) {
		t[`enemy.${archetype}`] = enemyVisual(archetype);
	}
	// Bosses: a large block in the shared boss accent. boss.act1 is Mother Bramble (M1).
	for (const b of BOSS_IDS) {
		t[b] = bossVisual();
	}
	t["boss.act1"] = bossVisual();
	// Bullets: enemy = neon ball with a dark outline; player = thin neon bolt.
	t["bullet.enemy.small"] = enemyBulletVisual("Ball", PLACEHOLDER_PROPORTIONS.enemyBullet);
	t["bullet.enemy.medium"] = enemyBulletVisual("Ball", PLACEHOLDER_PROPORTIONS.enemyBullet);
	t["bullet.enemy.large"] = enemyBulletVisual("Ball", PLACEHOLDER_PROPORTIONS.enemyBullet);
	t["bullet.enemy.needle"] = enemyBulletVisual("Block", PLACEHOLDER_PROPORTIONS.needle);
	t["bullet.player.basic"] = playerBulletVisual(PLACEHOLDER_PROPORTIONS.playerBolt);
	t["bullet.player.heavy"] = playerBulletVisual(PLACEHOLDER_PROPORTIONS.playerHeavyBolt);
	// Tiles: floor slabs and wall cubes in each biome's floor / wall colour.
	for (const b of BIOMES) {
		t[`tile.${b.id}.floor`] = tileVisual(b.id, "floor");
		t[`tile.${b.id}.wall`] = tileVisual(b.id, "wall");
	}
	// Items (same colour roles as the web placeholder pack).
	t["item.weapon"] = itemVisual("Block", "rarity.normal");
	t["item.weapon.sword"] = itemVisual("Block", "rarity.normal");
	t["item.weapon.bow"] = itemVisual("Ball", "rarity.normal");
	t["item.offhand"] = itemVisual("Block", "rarity.normal");
	t["item.helm"] = itemVisual("Ball", "rarity.normal");
	t["item.armor"] = itemVisual("Block", "rarity.normal");
	t["item.gloves"] = itemVisual("Ball", "rarity.normal");
	t["item.boots"] = itemVisual("Block", "rarity.normal");
	t["item.belt"] = itemVisual("Block", "rarity.normal");
	t["item.ring"] = itemVisual("Ball", "rarity.magic");
	t["item.amulet"] = itemVisual("Ball", "rarity.magic");
	t["item.potion"] = itemVisual("Ball", "uiHealth");
	t["item.gold"] = itemVisual("Ball", "rarity.rare");
	t["item.glyph"] = itemVisual("Block", "rarity.glyphword");
	// UI (the HUD draws these as Frames sized by cellPx).
	t["ui.cursor"] = uiVisual(UI_CELLS.cursor, "uiText");
	t["ui.panel"] = uiVisual(UI_CELLS.panel, "uiPanel", "uiAccent");
	t["ui.icon.health"] = uiVisual(UI_CELLS.icon, "uiHealth");
	t["ui.icon.mana"] = uiVisual(UI_CELLS.icon, "uiMana");
	t["ui.icon.ember"] = uiVisual(UI_CELLS.icon, "ember");
	// The digit font: until a strip is uploaded the HUD draws numbers as text in the damage-number roles.
	t["ui.font.digits"] = uiVisual(UI_CELLS.digits, "damageNumber");
	return t;
}

/** Placeholder visual per logical asset ID (every visual ID the placeholder pack defines). */
export const PLACEHOLDER_VISUALS: Readonly<Record<string, PlaceholderVisual>> = buildTable();

/**
 * Fallbacks for extra IDs under a known prefix (e.g. `bullet.enemy.wave`, `item.weapon.axe`),
 * most specific prefix first.
 */
export const PLACEHOLDER_PREFIX_DEFAULTS: ReadonlyArray<readonly [string, PlaceholderVisual]> = [
	["bullet.enemy.", enemyBulletVisual("Ball", PLACEHOLDER_PROPORTIONS.enemyBullet)],
	["bullet.player.", playerBulletVisual(PLACEHOLDER_PROPORTIONS.playerBolt)],
	["class.", classVisual("class.vanguard")],
	["enemy.", enemyVisual("bruiser")],
	["boss.", bossVisual()],
	[
		"tile.",
		visual({
			shape: "Block",
			cell: TILE_CELL,
			proportions: PLACEHOLDER_PROPORTIONS.floorTile,
			color: role("floor"),
		}),
	],
	["item.", itemVisual("Block", "rarity.normal")],
	["ui.", uiVisual(UI_CELLS.icon, "uiText")],
];

/** Telegraph lines (enemy attack warnings): a dashed line in the telegraph role, flat on the floor. */
export const TELEGRAPH_VISUAL: PlaceholderVisual = {
	shape: "Block",
	// One dash: 1 px wide, 1 px tall, 4 px long.
	size: [pxToStuds(1), pxToStuds(1), pxToStuds(4)],
	cellPx: { w: 1, h: 1 },
	color: role("telegraph"),
	material: "SmoothPlastic",
	faces: true,
	anchor: "base",
	dash: { length: pxToStuds(4), gap: pxToStuds(3) },
};

/** What a missing ID looks like: a magenta block the size of its slot's cell (16 x 16 px if the slot is free-size). */
export function missingVisual(id: string): PlaceholderVisual {
	const cell = slotFor(id)?.cell ?? { w: PIXELS_PER_TILE, h: PIXELS_PER_TILE };
	return visual({ shape: "Block", cell, proportions: PLACEHOLDER_PROPORTIONS.missing, color: { kind: "missing" } });
}

/** The placeholder visual for an ID: its own entry, else its prefix default, else undefined. */
export function placeholderVisualFor(id: string): PlaceholderVisual | undefined {
	const own = PLACEHOLDER_VISUALS[id];
	if (own !== undefined) {
		return own;
	}
	return PLACEHOLDER_PREFIX_DEFAULTS.find(([prefix]) => startsWith(id, prefix))?.[1];
}
