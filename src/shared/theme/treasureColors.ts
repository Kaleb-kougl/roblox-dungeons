/**
 * Roblox port (docs/TREASURE.md TR6, Design §5, conflict C2): the treasure colour rules and `treasureReport`, in their
 * own module like pelletColors.ts: validate.ts sits at Luau's 200-locals-per-function limit, so it imports nothing from
 * here; variantColors.ts' `variantColorProblems` (already called by validateManifest) folds this report's failures into
 * its own.
 *
 * The floor tier roles (treasure.ts TREASURE_FLOOR_ROLES: the sparkle, the lock plate and its shards, the rising tier
 * line, the column) are >= 3:1 (WCAG's graphics bar) on every biome floor and on `minimap.floor`, and >=
 * MIN_DECOR_FX_BULLET_DIFFERENCE (40, CIE76) from the room edges' danger set (ROOM_EDGE_DIFFERENCE_ROLES: the
 * enemy-bullet roles and `telegraph`): they are drawn on the floor under bullets in a fight room. The UI tier roles
 * (TREASURE_UI_ROLES, the draft's `boon.*`: toasts, reward cards, the minimap mark) are >= 3:1 on `minimap.floor` too
 * (their `uiPanel` bar is `boonRarityReport`'s). The cage is >= 3:1 on every biome floor (the bars read as "closed"),
 * and the enemy bullet is >= 3:1 on the chest, like on a breakable (bullets stop on it).
 *
 * @module
 */

import { colorDifference, contrastRatio, isHexColor } from "./color";
import { MIN_DECOR_FX_BULLET_DIFFERENCE, MIN_ENEMY_BULLET_CONTRAST, ROOM_EDGE_DIFFERENCE_ROLES } from "./contract";
import { TREASURE_CAGE_ID, TREASURE_CHEST_ID, TREASURE_FLOOR_ROLES, TREASURE_UI_ROLES } from "./treasure";
import type { ColorRole } from "./types";
import { isObj, sortedEntries } from "./util";

/** What treasureReport checks against what, and the bars. */
export interface TreasureColorRules {
	/** The floor tier roles: "floor", "map" and "difference" checks. */
	readonly floorRoles: ReadonlyArray<ColorRole>;
	/** The UI tier roles: a "map" check. */
	readonly uiRoles: ReadonlyArray<ColorRole>;
	/** The minimap's floor, the background of the "map" checks. */
	readonly mapBackground: ColorRole;
	/** WCAG contrast of every floor role on every biome floor and of every tier role on mapBackground. */
	readonly minContrast: number;
	/** The colours a floor role must never be mistaken for. */
	readonly against: ReadonlyArray<ColorRole>;
	/** CIE76 between every floor role and every `against` colour. */
	readonly minDifference: number;
	/** The cage's role: a "floor" check on every biome floor. */
	readonly cage: ColorRole;
	/** The chest's role: a "bullet" check (the enemy bullet on it). */
	readonly chest: ColorRole;
	/** WCAG contrast of enemyBullet on the chest. */
	readonly minBulletContrast: number;
}

/** The treasure colour rules (docs/TREASURE.md TR6). */
export const TREASURE_COLOR_RULES: TreasureColorRules = {
	floorRoles: TREASURE_FLOOR_ROLES,
	uiRoles: TREASURE_UI_ROLES,
	mapBackground: "minimap.floor",
	minContrast: 3.0,
	against: ROOM_EDGE_DIFFERENCE_ROLES,
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
	cage: TREASURE_CAGE_ID,
	chest: TREASURE_CHEST_ID,
	minBulletContrast: MIN_ENEMY_BULLET_CONTRAST,
};

/**
 * One check of treasureReport:
 * - check "floor": the role vs every biome's floor (WCAG contrast; `against` = the biome ID, biomes in sorted order);
 * - check "map": the role vs `minimap.floor` (WCAG contrast; `against` = "minimap.floor");
 * - check "difference": the role vs every `against` colour (CIE76; `against` = the role);
 * - check "bullet": `enemyBullet` on the chest (WCAG contrast; `against` = "enemyBullet").
 * Order: per floor role (TREASURE_FLOOR_ROLES order) "floor", "map", "difference"; then per UI role "map"; then the
 * cage's "floor"; then the chest's "bullet". `value` is the ratio or the difference. A role that is missing or not a hex
 * colour is skipped (the colour-role check reports it).
 */
export interface TreasureColorEntry {
	role: string;
	check: "floor" | "map" | "difference" | "bullet";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/** Every check of TREASURE_COLOR_RULES on `manifest` (see TreasureColorEntry). */
export function treasureReport(manifest: unknown): Array<TreasureColorEntry> {
	const out = new Array<TreasureColorEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const rules = TREASURE_COLOR_RULES;
	const colors = manifest.colors;
	const biomes = isObj(manifest.biomes) ? sortedEntries(manifest.biomes) : [];
	const mapColor = colors[rules.mapBackground];
	const onFloors = (role: string, color: string) => {
		for (const [biome, def] of biomes) {
			const againstColor = isObj(def) ? def.floor : undefined;
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = contrastRatio(color, againstColor);
			const min = rules.minContrast;
			out.push({ role, check: "floor", color, against: biome, againstColor, value, min, ok: value >= min });
		}
	};
	const onMap = (role: string, color: string) => {
		if (!isHexColor(mapColor)) {
			return;
		}
		const value = contrastRatio(color, mapColor);
		const min = rules.minContrast;
		const against = rules.mapBackground;
		out.push({ role, check: "map", color, against, againstColor: mapColor, value, min, ok: value >= min });
	};
	for (const role of rules.floorRoles) {
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		onFloors(role, color);
		onMap(role, color);
		for (const against of rules.against) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = colorDifference(color, againstColor);
			const min = rules.minDifference;
			out.push({ role, check: "difference", color, against, againstColor, value, min, ok: value >= min });
		}
	}
	for (const role of rules.uiRoles) {
		const color = colors[role];
		if (isHexColor(color)) {
			onMap(role, color);
		}
	}
	const cage = colors[rules.cage];
	if (isHexColor(cage)) {
		onFloors(rules.cage, cage);
	}
	const chest = colors[rules.chest];
	const bullet = colors.enemyBullet;
	if (isHexColor(chest) && isHexColor(bullet)) {
		const value = contrastRatio(bullet, chest);
		const min = rules.minBulletContrast;
		out.push({
			role: rules.chest,
			check: "bullet",
			color: chest,
			against: "enemyBullet",
			againstColor: bullet,
			value,
			min,
			ok: value >= min,
		});
	}
	return out;
}
