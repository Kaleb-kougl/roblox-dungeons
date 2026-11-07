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
 *
 * Decor (`decor.*`, docs/DECOR.md R2) has no placeholders: decor is optional, and an ID with no art is not drawn.
 * Breakables (`breakable.*`) do: they are gameplay objects, drawn as low boxes until art exists. So do boost drops
 * (`boost.*`, docs/BOOSTS.md B5): a small gem (a Diamond) per kind in its identity colour. So do pellets (`pellet.*`,
 * docs/PELLETS.md PL6): a small Block cube per kind in its colour role. So does a vault's chest (`treasure.*`,
 * docs/TREASURE.md TR6): a low box, an open chest's lid wedge, and a row of thin bars for the cage. So does the pact
 * altar (`pact.altar`, docs/FORTUNE.md FO6): a stone plinth.
 */

import { PIXELS_PER_TILE, STUDS_PER_TILE } from "shared/config";
import {
	BIOMES,
	BOSS,
	BOSS_IDS,
	BOOST_KINDS,
	BREAKABLE_KINDS,
	BULLET,
	CHARACTER,
	CLASS_IDS,
	DIGIT_FONT,
	ENEMY,
	ENEMY_ARCHETYPES,
	ITEM,
	TILE,
	boostId,
	breakableId,
	slotFor,
	type BoostKind,
	type BreakableKind,
	type EnemyArchetype,
} from "./contract";
import type { BiomeTileKey, ColorRole } from "./types";
import { startsWith } from "./util";
import { GOO_BULLET_ID, STRIKE_BULLET_ID } from "./variants";
import { pelletId } from "./pellets";
import { TREASURE_CAGE_ID, TREASURE_CHEST_ID, TREASURE_CHEST_OPEN_ID } from "./treasure";
import { PACT_ALTAR_ID } from "./fortune";

/**
 * Part shapes. Ball/Block/Cylinder/Wedge are Enum.PartType names; Capsule = a Cylinder capped by two Balls;
 * Diamond (a boost drop's gem, docs/BOOSTS.md B5) = a Block stood on a corner (turned 45 degrees about two axes; a
 * renderer with no Diamond case draws the plain Block). Cone (the Imp) = a point-up cone or pyramid filling the size,
 * Dome (the Ooze) = the top half of a squashed ball, its flat face on the floor (docs/ENEMY_VARIANTS.md EV1; a
 * renderer with no Cone / Dome case draws the plain Block).
 */
export const PLACEHOLDER_SHAPES = ["Ball", "Block", "Cylinder", "Wedge", "Capsule", "Diamond", "Cone", "Dome"] as const;
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
	/**
	 * Optional outline colour role (bullets: the dark ring that makes them read; enemies and bosses: `enemyOutline`,
	 * the rim of the actor renderer's shared Highlight, enemy outline plan O2). Classes have none (the player has a ring).
	 */
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
	/** Training dummy (tutorial): a thin upright post, as tall as the cell. */
	dummy: [0.375, 1, 0.375],
	/** Imp (docs/ENEMY_VARIANTS.md EV1): a small cone, half the cell wide, a little taller (2 x 2.5 x 2 studs). */
	imp: [0.5, 0.625, 0.5],
	/** Ooze (`slime`, EV1): a low dome, nearly the cell wide and half as tall (3.5 x 1.75 x 3.5 studs). */
	slime: [0.875, 0.4375, 0.875],
	/** Bomber (docs/NEW_ENEMIES.md NE1): a smaller cone than the imp's (1.5 x 2 x 1.5 studs). */
	bomber: [0.375, 0.5, 0.375],
	/** Charger (NE1): a long low wedge pointing along its facing (3.5 x 2.5 x 4 studs). */
	charger: [0.875, 0.625, 1],
	/** Stormcaller (NE1): a tall slim drum (2 x 4 x 2 studs). */
	stormcaller: [0.5, 1, 0.5],
	/** Warbanner (NE1): a thin flag post, taller than the cell is wide (1 x 4 x 1 studs). */
	warbanner: [0.25, 1, 0.25],
	/** Reaper (NE1): a wide flat disc, a spinning blade (3.5 x 1 x 3.5 studs). */
	reaper: [0.875, 0.25, 0.875],
	/** Goldling (docs/FORTUNE.md FD9): a small gold block, smaller than the bomber (1.5 x 1.5 x 1.5 studs). */
	golden: [0.375, 0.375, 0.375],
	/** Bosses: a large block, the full 48 x 48 cell wide, 3/4 tall (Mother Mayhem, boss.act1, and boss.1..5). */
	boss: [1, 0.75, 1],
	/**
	 * The Demon Lord (boss.demonlord, docs/BOSS_DEMONLORD.md): a tall block, 3/4 of the cell wide and deep, the full
	 * cell tall (9 x 12 x 9 studs against Mother Mayhem's squat 12 x 9 x 12), so the hunter reads apart from the turret.
	 */
	demonlord: [0.75, 1, 0.75],
	/** Enemy bullets: a ball filling the 8 px cell (the renderer scales it to the gameplay radius). */
	enemyBullet: [1, 1, 1],
	/**
	 * Goo puddles (`bullet.enemy.goo`, docs/ENEMY_VARIANTS.md EVD5): a flat disc filling the 8 px cell, 1 px thick, lying
	 * on the floor (the renderer scales it to the gameplay radius).
	 */
	goo: [1, 1 / 8, 1],
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
	/**
	 * Breakables (docs/DECOR.md D4), on a 16 px tile footprint: low boxes, never taller than 5/8 of a tile, so nothing
	 * hides behind one. Crate: fills its cell, half a tile tall (4 x 2 x 4 studs).
	 */
	crate: [1, 0.5, 1],
	/** Barrel: a little narrower and taller than a crate (3.5 x 2.5 x 3.5 studs). */
	barrel: [0.875, 0.625, 0.875],
	/**
	 * Boost drops (docs/BOOSTS.md B5): a small gem, half a tile across and a little taller (2 x 2.5 x 2 studs), no
	 * taller than a barrel (5/8 of a tile), so it never hides a bullet.
	 */
	boost: [0.5, 0.625, 0.5],
	/**
	 * Pellets (docs/PELLETS.md PL6, PD3): a small axis-aligned cube, a quarter tile a side (1 stud), standing on the
	 * floor; the power pellet a bigger cube, 0.45 tile (1.8 studs). Both far under a barrel, so neither hides a bullet.
	 */
	pellet: [0.25, 0.25, 0.25],
	pelletPower: [0.45, 0.45, 0.45],
	/**
	 * A vault's chest (docs/TREASURE.md TR6), on its 16 px tile: a low box wider than deep (3.5 x 2.25 x 2.5 studs),
	 * under a barrel's height (5/8 of a tile), so it never hides a bullet; turned to face into its room.
	 */
	chest: [0.875, 0.5625, 0.625],
	/** The open chest: a wedge with the chest's footprint, its slope (the Front) the lid thrown back, a little taller. */
	chestOpen: [0.875, 0.75, 0.625],
	/**
	 * The cage: ONE bar (1 px square, 3/4 of a tile tall: the bars stand over the chest but are see-through), repeated
	 * CAGE_BAR_GAP_PX apart along the cage's sides (`dash`, like a telegraph's dashes) by the treasure renderer.
	 */
	cageBar: [1 / 16, 0.75, 1 / 16],
	/**
	 * The pact altar (docs/FORTUNE.md FO6): a square stone plinth, 3/4 tile a side and 3/8 tall (3 x 1.5 x 3 studs),
	 * standing on the floor: lower than a barrel, so it never hides a bullet, wide enough to stand by.
	 */
	pactAltar: [0.75, 0.375, 0.75],
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
/** Breakables are free-size art; their placeholder stands on one tile. */
const BREAKABLE_CELL = TILE_CELL;
/** Boost drops are free-size art; their placeholder gem is sized from one tile. */
const BOOST_CELL = TILE_CELL;
/** Pellets are free-size art; their placeholder cube is sized from one tile. */
const PELLET_CELL = TILE_CELL;
/** A vault's chest and cage are free-size art; their placeholders are sized from one tile. */
const TREASURE_CELL = TILE_CELL;
/** The cage placeholder's gap between two bars, render pixels (1 px bars, so a bar every 4 px along its sides). */
export const CAGE_BAR_GAP_PX = 3;
/** The pact altar is free-size art; its placeholder plinth is sized from one tile. */
const PACT_CELL = TILE_CELL;
/**
 * The plinth's stone: a neutral warm grey (>= 5.0:1 on every biome floor), the same for both altars. The pact an altar
 * offers is told by its card and flame in `pact.greed` / `pact.horde` (the pacts' view), never by the stone.
 */
const PACT_ALTAR_ROLE: ColorRole = "uiTextDim";
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
	dummy: { shape: "Cylinder", proportions: PLACEHOLDER_PROPORTIONS.dummy },
	imp: { shape: "Cone", proportions: PLACEHOLDER_PROPORTIONS.imp },
	slime: { shape: "Dome", proportions: PLACEHOLDER_PROPORTIONS.slime },
	bomber: { shape: "Cone", proportions: PLACEHOLDER_PROPORTIONS.bomber },
	charger: { shape: "Wedge", proportions: PLACEHOLDER_PROPORTIONS.charger },
	stormcaller: { shape: "Cylinder", proportions: PLACEHOLDER_PROPORTIONS.stormcaller },
	warbanner: { shape: "Cylinder", proportions: PLACEHOLDER_PROPORTIONS.warbanner },
	reaper: { shape: "Cylinder", proportions: PLACEHOLDER_PROPORTIONS.reaper },
	golden: { shape: "Block", proportions: PLACEHOLDER_PROPORTIONS.golden },
};

const enemyVisual = (archetype: EnemyArchetype): PlaceholderVisual =>
	visual({
		shape: ENEMY_SHAPES[archetype].shape,
		cell: ENEMY_CELL,
		proportions: ENEMY_SHAPES[archetype].proportions,
		color: role(`enemy.${archetype}`),
		outline: "enemyOutline",
		faces: true,
	});

const bossVisual = (proportions: Proportions = PLACEHOLDER_PROPORTIONS.boss): PlaceholderVisual =>
	visual({
		shape: "Block",
		cell: BOSS_CELL,
		proportions,
		color: role("boss"),
		outline: "enemyOutline",
	});

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

/**
 * The goo puddle (docs/ENEMY_VARIANTS.md EVD5): a flat disc in `enemyGoo` lying on the floor (its base on the floor,
 * unturned), Neon like every bullet placeholder (it hurts), with the enemy bullets' dark outline. The renderer's goo
 * pool draws it under the moving bullets.
 */
const gooVisual = (): PlaceholderVisual =>
	visual({
		shape: "Cylinder",
		cell: BULLET_CELL,
		proportions: PLACEHOLDER_PROPORTIONS.goo,
		color: role("enemyGoo"),
		outline: "enemyBulletOutline",
		material: "Neon",
	});

const playerBulletVisual = (proportions: Proportions, color: ColorRole = "playerBullet"): PlaceholderVisual =>
	visual({
		shape: "Block",
		cell: BULLET_CELL,
		proportions,
		color: role(color),
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

const breakableVisual = (kind: BreakableKind): PlaceholderVisual =>
	visual({
		shape: "Block",
		cell: BREAKABLE_CELL,
		proportions: PLACEHOLDER_PROPORTIONS[kind],
		color: role(breakableId(kind)),
	});

const boostVisual = (kind: BoostKind): PlaceholderVisual =>
	visual({
		shape: "Diamond",
		cell: BOOST_CELL,
		proportions: PLACEHOLDER_PROPORTIONS.boost,
		color: role(boostId(kind)),
	});

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
	// Enemies: one silhouette per archetype (swarmer ball, sniper wedge, bruiser block, ..., dummy post, imp cone, ooze
	// dome).
	for (const archetype of ENEMY_ARCHETYPES) {
		t[`enemy.${archetype}`] = enemyVisual(archetype);
	}
	// Bosses: a large block in the shared boss accent. boss.act1 is Mother Mayhem (M1); boss.demonlord, the Demon
	// Lord (the second endless boss), stands taller and narrower.
	for (const b of BOSS_IDS) {
		t[b] = bossVisual();
	}
	t["boss.act1"] = bossVisual();
	t["boss.demonlord"] = bossVisual(PLACEHOLDER_PROPORTIONS.demonlord);
	// Bullets: enemy = neon ball with a dark outline (goo: a flat disc on the floor); player = thin neon bolt.
	t["bullet.enemy.small"] = enemyBulletVisual("Ball", PLACEHOLDER_PROPORTIONS.enemyBullet);
	t["bullet.enemy.medium"] = enemyBulletVisual("Ball", PLACEHOLDER_PROPORTIONS.enemyBullet);
	t["bullet.enemy.large"] = enemyBulletVisual("Ball", PLACEHOLDER_PROPORTIONS.enemyBullet);
	t["bullet.enemy.needle"] = enemyBulletVisual("Block", PLACEHOLDER_PROPORTIONS.needle);
	t[GOO_BULLET_ID] = gooVisual();
	// docs/NEW_ENEMIES.md NE1: the lightning strike, a flat neon disc on the floor in the enemy bullet's colour (the goo
	// puddle's construction; the bolt flash is NE8's)
	t[STRIKE_BULLET_ID] = visual({
		shape: "Cylinder",
		cell: BULLET_CELL,
		proportions: PLACEHOLDER_PROPORTIONS.goo,
		color: role("enemyBullet"),
		outline: "enemyBulletOutline",
		material: "Neon",
	});
	t["bullet.player.basic"] = playerBulletVisual(PLACEHOLDER_PROPORTIONS.playerBolt);
	t["bullet.player.heavy"] = playerBulletVisual(PLACEHOLDER_PROPORTIONS.playerHeavyBolt);
	// Build effects (Roblox port, docs/BUILDS.md BU1): small neon bolts in their effect colours; the ember a flat disc
	// on the floor (the goo puddle's construction).
	t["bullet.player.burst"] = playerBulletVisual(PLACEHOLDER_PROPORTIONS.playerBolt, "build.burst");
	t["bullet.player.shard"] = playerBulletVisual(PLACEHOLDER_PROPORTIONS.playerBolt, "build.shard");
	t["bullet.player.bolt"] = playerBulletVisual(PLACEHOLDER_PROPORTIONS.playerBolt, "build.spark");
	t["bullet.player.ember"] = visual({
		shape: "Cylinder",
		cell: BULLET_CELL,
		proportions: PLACEHOLDER_PROPORTIONS.goo,
		color: role("build.ember"),
		outline: "playerBulletOutline",
		material: "Neon",
	});
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
	// Breakables (Roblox port, docs/DECOR.md D4): a low box per kind in its identity colour, standing on its tile.
	for (const kind of BREAKABLE_KINDS) {
		t[breakableId(kind)] = breakableVisual(kind);
	}
	// Boost drops (Roblox port, docs/BOOSTS.md B5): a small gem per kind in its identity colour.
	for (const kind of BOOST_KINDS) {
		t[boostId(kind)] = boostVisual(kind);
	}
	// Pellets (Roblox port, docs/PELLETS.md PL6): a small Block cube in its colour role; the power pellet a bigger one.
	t[pelletId("normal")] = visual({
		shape: "Block",
		cell: PELLET_CELL,
		proportions: PLACEHOLDER_PROPORTIONS.pellet,
		color: role(pelletId("normal")),
	});
	t[pelletId("power")] = visual({
		shape: "Block",
		cell: PELLET_CELL,
		proportions: PLACEHOLDER_PROPORTIONS.pelletPower,
		color: role(pelletId("power")),
	});
	// A vault's chest (Roblox port, docs/TREASURE.md TR6): a low box and an open lid wedge in the chest's wood colour,
	// turned to face into the room; the cage a row of thin iron bars (one bar, repeated: `dash`).
	t[TREASURE_CHEST_ID] = visual({
		shape: "Block",
		cell: TREASURE_CELL,
		proportions: PLACEHOLDER_PROPORTIONS.chest,
		color: role(TREASURE_CHEST_ID),
		faces: true,
	});
	t[TREASURE_CHEST_OPEN_ID] = visual({
		shape: "Wedge",
		cell: TREASURE_CELL,
		proportions: PLACEHOLDER_PROPORTIONS.chestOpen,
		color: role(TREASURE_CHEST_ID),
		faces: true,
	});
	const bar = PLACEHOLDER_PROPORTIONS.cageBar;
	t[TREASURE_CAGE_ID] = {
		...visual({
			shape: "Block",
			cell: TREASURE_CELL,
			proportions: bar,
			color: role(TREASURE_CAGE_ID),
			faces: true,
		}),
		dash: { length: pxToStuds(TREASURE_CELL.w * bar[0]), gap: pxToStuds(CAGE_BAR_GAP_PX) },
	};
	// The pact altar (Roblox port, docs/FORTUNE.md FO6): a low stone plinth, standing on its cell.
	t[PACT_ALTAR_ID] = visual({
		shape: "Block",
		cell: PACT_CELL,
		proportions: PLACEHOLDER_PROPORTIONS.pactAltar,
		color: role(PACT_ALTAR_ROLE),
	});
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
	["breakable.", breakableVisual("crate")],
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
