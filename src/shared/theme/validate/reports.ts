/**
 * The validator's colour reports (docs/CODEBASE_SCALE.md DX8: a pure move out of validate.ts): contrast and difference checks per role and biome surface.
 *
 * @module
 */
import { isObj, quote as q, sortedEntries, type Obj } from "../util";
import { colorDifference, contrastRatio, isHexColor, labChroma, mixRgb, parseHex, toHex } from "../color";
import {
	BOON_RARITY_COLOR_RULES,
	BOOST_HALO_FX,
	BOOST_KINDS,
	BOOST_ROLES,
	BREAKABLE_ROLES,
	COMBO_COLOR_RULES,
	DAMAGE_NUMBER_ROLES,
	DECOR_FX_ROLES,
	ENEMY_BULLET_ROLES,
	FX_ROLES,
	HEALTH_BAR_FILL_ROLES,
	MINIMAP_ENEMY_DIFFERENCE_ROLES,
	MINIMAP_MARKER_BACKGROUNDS,
	MINIMAP_MARKER_ROLES,
	MINIMAP_ROOM_TINT_MIX,
	MINIMAP_TINT_ROLES,
	MIN_BOOST_BULLET_DIFFERENCE,
	MIN_BOOST_CONTRAST,
	MIN_DAMAGE_NUMBER_CONTRAST,
	MIN_DECOR_FX_BULLET_DIFFERENCE,
	MIN_ENEMY_BULLET_CONTRAST,
	MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE,
	MIN_ENEMY_OUTLINE_CONTRAST,
	MIN_FX_BULLET_DIFFERENCE,
	MIN_HEALTH_BAR_CONTRAST,
	MIN_MINIMAP_ENEMY_DIFFERENCE,
	MIN_MINIMAP_MARKER_CONTRAST,
	MIN_PLAYER_OUTLINE_CONTRAST,
	MIN_PLAYER_OUTLINE_DIFFERENCE,
	MIN_ROOM_EDGE_CONTRAST,
	MIN_ROOM_EDGE_DIFFERENCE,
	NEAR_MISS_COLOR_RULES,
	PLAYER_OUTLINE_DIFFERENCE_ROLES,
	ROOM_EDGE_CONTRAST_ROLES,
	ROOM_EDGE_DIFFERENCE_ROLES,
	ROOM_EDGE_ROLES,
	boostId,
	decorFxId,
	isFxId,
} from "../contract";
import { COLOR_ROLE_SET, fixed1, type ContrastEntry } from "./helpers";

/** The biome surfaces the contrast reports measure against, in the order their entries come out for each biome. */
export const SURFACES = ["floor", "wall"] as const;

/**
 * The enemy-bullet contrast table: one ContrastEntry per biome (sorted by ID) and surface (floor, then wall), the WCAG
 * ratio of `enemyBullet` on it, `ok` at MIN_ENEMY_BULLET_CONTRAST or more. Empty when the manifest has no usable
 * `colors`, `biomes` or `enemyBullet`; a surface that is not '#rrggbb' is skipped. `validateManifest` turns each failed
 * entry into an error.
 */
export function contrastReport(manifest: unknown): Array<ContrastEntry> {
	const out = new Array<ContrastEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors) || !isObj(manifest.biomes)) {
		return out;
	}
	const bullet = manifest.colors.enemyBullet;
	if (!isHexColor(bullet)) {
		return out;
	}
	for (const [biome, def] of sortedEntries(manifest.biomes)) {
		if (!isObj(def)) {
			continue;
		}
		for (const surface of SURFACES) {
			const color = def[surface];
			if (!isHexColor(color)) {
				continue;
			}
			const ratio = contrastRatio(bullet, color);
			out.push({ biome, surface, color, ratio, ok: ratio >= MIN_ENEMY_BULLET_CONTRAST });
		}
	}
	return out;
}

/**
 * Juice contrast checks: each HEALTH_BAR_FILL_ROLES role vs `enemyHealthBack` (>= MIN_HEALTH_BAR_CONTRAST),
 * and each DAMAGE_NUMBER_ROLES role vs every biome floor (>= MIN_DAMAGE_NUMBER_CONTRAST), one entry per biome.
 * `against` is the role or biome the colour was checked on.
 */
export interface JuiceContrastEntry {
	check: "healthBar" | "damageNumber";
	role: string;
	color: string;
	/** 'enemyHealthBack' for bars, the biome ID for numbers. */
	against: string;
	againstColor: string;
	ratio: number;
	min: number;
	ok: boolean;
}

/**
 * Every check JuiceContrastEntry describes: the health-bar fills in HEALTH_BAR_FILL_ROLES order (only when
 * `enemyHealthBack` is a colour), then the damage-number roles in DAMAGE_NUMBER_ROLES order, each against every biome
 * floor in sorted biome order. An empty list when `manifest` or its `colors` is not an object; a colour that is missing
 * or not '#rrggbb' is skipped (the colour-role check reports it). `validateManifest` turns each entry that is not `ok`
 * into an error; specs read the whole table.
 */
export function juiceContrastReport(manifest: unknown): Array<JuiceContrastEntry> {
	const out = new Array<JuiceContrastEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const back = colors.enemyHealthBack;
	if (isHexColor(back)) {
		for (const role of HEALTH_BAR_FILL_ROLES) {
			const color = colors[role];
			if (!isHexColor(color)) {
				continue;
			}
			const ratio = contrastRatio(color, back);
			out.push({
				check: "healthBar",
				role,
				color,
				against: "enemyHealthBack",
				againstColor: back,
				ratio,
				min: MIN_HEALTH_BAR_CONTRAST,
				ok: ratio >= MIN_HEALTH_BAR_CONTRAST,
			});
		}
	}
	if (isObj(manifest.biomes)) {
		const biomes = sortedEntries(manifest.biomes);
		for (const role of DAMAGE_NUMBER_ROLES) {
			const color = colors[role];
			if (!isHexColor(color)) {
				continue;
			}
			for (const [biome, def] of biomes) {
				if (!isObj(def) || !isHexColor(def.floor)) {
					continue;
				}
				const ratio = contrastRatio(color, def.floor);
				out.push({
					check: "damageNumber",
					role,
					color,
					against: biome,
					againstColor: def.floor,
					ratio,
					min: MIN_DAMAGE_NUMBER_CONTRAST,
					ok: ratio >= MIN_DAMAGE_NUMBER_CONTRAST,
				});
			}
		}
	}
	return out;
}

/**
 * Decor fx colours vs enemy bullets (docs/DECOR.md Phase 2 part 2): the CIE76 difference (`colorDifference`) of each
 * DECOR_FX_ROLES colour from each ENEMY_BULLET_ROLES colour, >= MIN_DECOR_FX_BULLET_DIFFERENCE, so no flame, glow,
 * glint, stairwell ring or ambient particle can be mistaken for an enemy bullet.
 */
export interface DecorFxEntry {
	role: string;
	color: string;
	/** The enemy-bullet role it was compared with. */
	against: string;
	againstColor: string;
	difference: number;
	min: number;
	ok: boolean;
}

/**
 * Every check DecorFxEntry describes: each DECOR_FX_ROLES colour against each ENEMY_BULLET_ROLES colour, in those
 * lists' orders. An empty list when `manifest` or its `colors` is not an object; a colour that is missing or not
 * '#rrggbb' is skipped (the colour-role check reports it). `validateManifest` turns each entry that is not `ok` into an
 * error; specs read the whole table.
 */
export function decorFxReport(manifest: unknown): Array<DecorFxEntry> {
	const out = new Array<DecorFxEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	for (const role of DECOR_FX_ROLES) {
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		for (const against of ENEMY_BULLET_ROLES) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const difference = colorDifference(color, againstColor);
			out.push({
				role,
				color,
				against,
				againstColor,
				difference,
				min: MIN_DECOR_FX_BULLET_DIFFERENCE,
				ok: difference >= MIN_DECOR_FX_BULLET_DIFFERENCE,
			});
		}
	}
	return out;
}

/**
 * Effect colours vs enemy bullets (docs/FX_AUDIO.md F1): the CIE76 difference from each ENEMY_BULLET_ROLES colour of
 * each FX_ROLES colour (`source` "role", `subject` the role), of each fx entry's `tint` role ("tint", the fx ID) and,
 * for an untinted entry, of its sheet's `meanColor` ("meanColor", the fx ID); >= MIN_FX_BULLET_DIFFERENCE, so no
 * effect can be mistaken for an enemy bullet. An untinted entry without a meanColor (or with a malformed one) has
 * nothing to check here: the validator rejects it on its own (validateFxFields), as it does a tint that is not a
 * colour role.
 */
export interface FxColorEntry {
	source: "role" | "tint" | "meanColor";
	/** The colour role (source "role") or the fx asset ID. */
	subject: string;
	/** The colour checked: the role's, the tint role's, or the meanColor. */
	color: string;
	/** The tint role (source "tint"), else undefined. */
	tint: string | undefined;
	/** The enemy-bullet role it was compared with. */
	against: string;
	againstColor: string;
	difference: number;
	min: number;
	ok: boolean;
}

/**
 * Every check FxColorEntry describes: the FX_ROLES colours first, then each `fx.*` asset in sorted ID order (its tint
 * role's colour, or its `meanColor` when untinted), each against every ENEMY_BULLET_ROLES colour. An empty list when
 * `manifest` or its `colors` is not an object; a colour that is missing or not '#rrggbb' is skipped (the colour-role
 * check reports it). `validateManifest` turns each entry that is not `ok` into an error; specs read the whole table.
 */
export function fxColorReport(manifest: unknown): Array<FxColorEntry> {
	const out = new Array<FxColorEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const push = (source: FxColorEntry["source"], subject: string, color: unknown, tint: string | undefined) => {
		if (!isHexColor(color)) {
			return;
		}
		for (const against of ENEMY_BULLET_ROLES) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const difference = colorDifference(color, againstColor);
			out.push({
				source,
				subject,
				color,
				tint,
				against,
				againstColor,
				difference,
				min: MIN_FX_BULLET_DIFFERENCE,
				ok: difference >= MIN_FX_BULLET_DIFFERENCE,
			});
		}
	};
	for (const role of FX_ROLES) {
		push("role", role, colors[role], undefined);
	}
	const assets: Obj = isObj(manifest.assets) ? manifest.assets : {};
	for (const [id, def] of sortedEntries(assets)) {
		if (!isFxId(id) || !isObj(def)) {
			continue;
		}
		const tint = def.tint;
		if (tint !== undefined) {
			if (typeIs(tint, "string") && COLOR_ROLE_SET.has(tint)) {
				push("tint", id, colors[tint], tint);
			}
		} else {
			push("meanColor", id, def.meanColor, undefined);
		}
	}
	return out;
}

/** WCAG contrast of enemyBullet on each breakable colour role (BREAKABLE_ROLES), >= MIN_ENEMY_BULLET_CONTRAST. */
export interface BreakableContrastEntry {
	role: string;
	color: string;
	ratio: number;
	ok: boolean;
}

/**
 * Every check BreakableContrastEntry describes, one per BREAKABLE_ROLES colour in that order. Empty when the manifest
 * has no usable `colors` or `enemyBullet`; a role that is missing or not '#rrggbb' is skipped. `validateManifest` turns
 * each failed entry into an error.
 */
export function breakableContrastReport(manifest: unknown): Array<BreakableContrastEntry> {
	const out = new Array<BreakableContrastEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors) || !isHexColor(manifest.colors.enemyBullet)) {
		return out;
	}
	const bullet = manifest.colors.enemyBullet;
	for (const role of BREAKABLE_ROLES) {
		const color = manifest.colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		const ratio = contrastRatio(bullet, color);
		out.push({ role, color, ratio, ok: ratio >= MIN_ENEMY_BULLET_CONTRAST });
	}
	return out;
}

/**
 * The enemy outline (enemy outline plan O1): `enemyOutline` vs every biome's floor and wall (WCAG contrast,
 * >= MIN_ENEMY_OUTLINE_CONTRAST; check "surface", `against` = the biome ID, `surface` set) and vs every
 * ENEMY_BULLET_ROLES colour (CIE76 colour difference, >= MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE; check "bullet",
 * `against` = the role). `value` is the ratio or the difference. Full light only: the darkest decor band is checked by
 * shared/view decorBandContrastReport (the depth bands live there).
 */
export interface EnemyOutlineEntry {
	check: "surface" | "bullet";
	color: string;
	against: string;
	/** The biome surface (check "surface" only). */
	surface?: "floor" | "wall";
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/**
 * Every check EnemyOutlineEntry describes: the surfaces first (biomes in sorted order, floor then wall), then the
 * ENEMY_BULLET_ROLES in order. Empty when `enemyOutline` is missing or not '#rrggbb'. An empty list when `manifest` or
 * its `colors` is not an object; a colour that is missing or not '#rrggbb' is skipped (the colour-role check reports
 * it). `validateManifest` turns each entry that is not `ok` into an error; specs read the whole table.
 */
export function enemyOutlineReport(manifest: unknown): Array<EnemyOutlineEntry> {
	const out = new Array<EnemyOutlineEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const color = colors.enemyOutline;
	if (!isHexColor(color)) {
		return out;
	}
	if (isObj(manifest.biomes)) {
		for (const [biome, def] of sortedEntries(manifest.biomes)) {
			if (!isObj(def)) {
				continue;
			}
			for (const surface of SURFACES) {
				const againstColor = def[surface];
				if (!isHexColor(againstColor)) {
					continue;
				}
				const value = contrastRatio(color, againstColor);
				out.push({
					check: "surface",
					color,
					against: biome,
					surface,
					againstColor,
					value,
					min: MIN_ENEMY_OUTLINE_CONTRAST,
					ok: value >= MIN_ENEMY_OUTLINE_CONTRAST,
				});
			}
		}
	}
	for (const against of ENEMY_BULLET_ROLES) {
		const againstColor = colors[against];
		if (!isHexColor(againstColor)) {
			continue;
		}
		const value = colorDifference(color, againstColor);
		out.push({
			check: "bullet",
			color,
			against,
			againstColor,
			value,
			min: MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE,
			ok: value >= MIN_ENEMY_OUTLINE_BULLET_DIFFERENCE,
		});
	}
	return out;
}

/**
 * The player outline (player outline, step 1): `playerOutline` vs every biome's floor and wall (WCAG contrast,
 * >= MIN_PLAYER_OUTLINE_CONTRAST; check "surface", `against` = the biome ID, `surface` set) and vs every
 * PLAYER_OUTLINE_DIFFERENCE_ROLES colour (CIE76 colour difference, >= MIN_PLAYER_OUTLINE_DIFFERENCE; check
 * "difference", `against` = the role). `value` is the ratio or the difference. Biomes in sorted order, then the roles
 * in PLAYER_OUTLINE_DIFFERENCE_ROLES order. Full light only: the darkest decor band is checked by shared/view
 * decorBandContrastReport (PLAYER_OUTLINE_BAND_CHECK).
 */
export interface PlayerOutlineEntry {
	check: "surface" | "difference";
	color: string;
	against: string;
	/** The biome surface (check "surface" only). */
	surface?: "floor" | "wall";
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/**
 * Every check PlayerOutlineEntry describes, in the order given there. Empty when `playerOutline` is missing or not
 * '#rrggbb'. An empty list when `manifest` or its `colors` is not an object; a colour that is missing or not '#rrggbb'
 * is skipped (the colour-role check reports it). `validateManifest` turns each entry that is not `ok` into an error;
 * specs read the whole table.
 */
export function playerOutlineReport(manifest: unknown): Array<PlayerOutlineEntry> {
	const out = new Array<PlayerOutlineEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const color = colors.playerOutline;
	if (!isHexColor(color)) {
		return out;
	}
	if (isObj(manifest.biomes)) {
		for (const [biome, def] of sortedEntries(manifest.biomes)) {
			if (!isObj(def)) {
				continue;
			}
			for (const surface of SURFACES) {
				const againstColor = def[surface];
				if (!isHexColor(againstColor)) {
					continue;
				}
				const value = contrastRatio(color, againstColor);
				out.push({
					check: "surface",
					color,
					against: biome,
					surface,
					againstColor,
					value,
					min: MIN_PLAYER_OUTLINE_CONTRAST,
					ok: value >= MIN_PLAYER_OUTLINE_CONTRAST,
				});
			}
		}
	}
	for (const against of PLAYER_OUTLINE_DIFFERENCE_ROLES) {
		const againstColor = colors[against];
		if (!isHexColor(againstColor)) {
			continue;
		}
		const value = colorDifference(color, againstColor);
		out.push({
			check: "difference",
			color,
			against,
			againstColor,
			value,
			min: MIN_PLAYER_OUTLINE_DIFFERENCE,
			ok: value >= MIN_PLAYER_OUTLINE_DIFFERENCE,
		});
	}
	return out;
}

/**
 * Boost drop colours (docs/BOOSTS.md B5), the enemy outline's rules for each BOOST_ROLES colour: vs every biome's floor
 * and wall (WCAG contrast, >= MIN_BOOST_CONTRAST; check "surface", `against` = the biome ID, `surface` set) and vs
 * every ENEMY_BULLET_ROLES colour (CIE76 colour difference, >= MIN_BOOST_BULLET_DIFFERENCE; check "bullet", `against` =
 * the role). `value` is the ratio or the difference. Roles in BOOST_ROLES order, biomes in sorted order.
 */
export interface BoostColorEntry {
	role: string;
	check: "surface" | "bullet";
	color: string;
	against: string;
	/** The biome surface (check "surface" only). */
	surface?: "floor" | "wall";
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/**
 * Every check BoostColorEntry describes: per BOOST_ROLES colour, its surfaces (biomes sorted, floor then wall), then
 * its ENEMY_BULLET_ROLES differences. An empty list when `manifest` or its `colors` is not an object; a colour that is
 * missing or not '#rrggbb' is skipped (the colour-role check reports it). `validateManifest` turns each entry that is
 * not `ok` into an error; specs read the whole table.
 */
export function boostColorReport(manifest: unknown): Array<BoostColorEntry> {
	const out = new Array<BoostColorEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const biomes = isObj(manifest.biomes) ? sortedEntries(manifest.biomes) : [];
	for (const role of BOOST_ROLES) {
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		for (const [biome, def] of biomes) {
			if (!isObj(def)) {
				continue;
			}
			for (const surface of SURFACES) {
				const againstColor = def[surface];
				if (!isHexColor(againstColor)) {
					continue;
				}
				const value = contrastRatio(color, againstColor);
				out.push({
					role,
					check: "surface",
					color,
					against: biome,
					surface,
					againstColor,
					value,
					min: MIN_BOOST_CONTRAST,
					ok: value >= MIN_BOOST_CONTRAST,
				});
			}
		}
		for (const against of ENEMY_BULLET_ROLES) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = colorDifference(color, againstColor);
			out.push({
				role,
				check: "bullet",
				color,
				against,
				againstColor,
				value,
				min: MIN_BOOST_BULLET_DIFFERENCE,
				ok: value >= MIN_BOOST_BULLET_DIFFERENCE,
			});
		}
	}
	return out;
}

/**
 * Room edges (docs/ROOM_EDGES.md RE4): every ROOM_EDGE_CONTRAST_ROLES colour (waiting, live) vs every biome's floor
 * (WCAG contrast, >= MIN_ROOM_EDGE_CONTRAST; check "floor", `against` = the biome ID; walls are not checked, the lines
 * lie on floors) and every ROOM_EDGE_ROLES colour (safe too) vs every ROOM_EDGE_DIFFERENCE_ROLES colour (CIE76 colour
 * difference, >= MIN_ROOM_EDGE_DIFFERENCE; check "difference", `against` = the role). `value` is the ratio or the
 * difference. Roles in ROOM_EDGE_ROLES order (floors first, then differences, per role), biomes in sorted order.
 */
export interface RoomEdgeEntry {
	role: string;
	check: "floor" | "difference";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/**
 * Every check RoomEdgeEntry describes, in the order given there. An empty list when `manifest` or its `colors` is not
 * an object; a colour that is missing or not '#rrggbb' is skipped (the colour-role check reports it).
 * `validateManifest` turns each entry that is not `ok` into an error; specs read the whole table.
 */
export function roomEdgeReport(manifest: unknown): Array<RoomEdgeEntry> {
	const out = new Array<RoomEdgeEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const biomes = isObj(manifest.biomes) ? sortedEntries(manifest.biomes) : [];
	for (const role of ROOM_EDGE_ROLES) {
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		if (ROOM_EDGE_CONTRAST_ROLES.includes(role)) {
			for (const [biome, def] of biomes) {
				if (!isObj(def)) {
					continue;
				}
				const againstColor = def.floor;
				if (!isHexColor(againstColor)) {
					continue;
				}
				const value = contrastRatio(color, againstColor);
				out.push({
					role,
					check: "floor",
					color,
					against: biome,
					againstColor,
					value,
					min: MIN_ROOM_EDGE_CONTRAST,
					ok: value >= MIN_ROOM_EDGE_CONTRAST,
				});
			}
		}
		for (const against of ROOM_EDGE_DIFFERENCE_ROLES) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = colorDifference(color, againstColor);
			out.push({
				role,
				check: "difference",
				color,
				against,
				againstColor,
				value,
				min: MIN_ROOM_EDGE_DIFFERENCE,
				ok: value >= MIN_ROOM_EDGE_DIFFERENCE,
			});
		}
	}
	return out;
}

/**
 * Minimap (docs/MINIMAP.md M6): every MINIMAP_MARKER_ROLES colour vs every MINIMAP_MARKER_BACKGROUNDS colour
 * (`minimap.floor`, `uiPanel`; WCAG contrast, >= MIN_MINIMAP_MARKER_CONTRAST; check "background", `against` = the
 * role) and `minimap.enemy` vs every MINIMAP_ENEMY_DIFFERENCE_ROLES colour (CIE76 colour difference,
 * >= MIN_MINIMAP_ENEMY_DIFFERENCE; check "difference", `against` = the role). `value` is the ratio or the difference.
 * Roles in MINIMAP_MARKER_ROLES order (backgrounds first, then differences, per role).
 */
export interface MinimapEntry {
	role: string;
	check: "background" | "difference";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/**
 * Every check MinimapEntry describes, plus one more "background" check per marker role for each MINIMAP_TINT_ROLES
 * colour: the `minimap.floor` colour mixed MINIMAP_ROOM_TINT_MIX toward that tint (the floor of a seen room as the map
 * paints it), with `against` "minimap.floor+<tint role>" and `againstColor` the mixed colour. Per role: the plain
 * backgrounds, the tinted floors, then (for `minimap.enemy` only) the differences. An empty list when `manifest` or its
 * `colors` is not an object; a colour that is missing or not '#rrggbb' is skipped (the colour-role check reports it).
 * `validateManifest` turns each entry that is not `ok` into an error; specs read the whole table.
 */
export function minimapReport(manifest: unknown): Array<MinimapEntry> {
	// Local, not module constants: this module's compiled Luau sits at the 200-locals limit (docs/NEW_BEST.md NB4).
	const MINIMAP_ENEMY_ROLE = "minimap.enemy";
	const MINIMAP_FLOOR_ROLE = "minimap.floor";
	const out = new Array<MinimapEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	for (const role of MINIMAP_MARKER_ROLES) {
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		const push = (against: string, againstColor: string) => {
			const value = contrastRatio(color, againstColor);
			out.push({
				role,
				check: "background",
				color,
				against,
				againstColor,
				value,
				min: MIN_MINIMAP_MARKER_CONTRAST,
				ok: value >= MIN_MINIMAP_MARKER_CONTRAST,
			});
		};
		for (const against of MINIMAP_MARKER_BACKGROUNDS) {
			const againstColor = colors[against];
			if (isHexColor(againstColor)) {
				push(against, againstColor);
			}
		}
		// Every seen room floor is tinted toward its room-edge state colour (shared/view/minimap paint.ts, same mix).
		const floor = parseHex(colors[MINIMAP_FLOOR_ROLE] as string);
		if (floor !== undefined) {
			for (const tint of MINIMAP_TINT_ROLES) {
				const tintColor = parseHex(colors[tint] as string);
				if (tintColor !== undefined) {
					push(`${MINIMAP_FLOOR_ROLE}+${tint}`, toHex(mixRgb(floor, tintColor, MINIMAP_ROOM_TINT_MIX)));
				}
			}
		}
		if (role !== MINIMAP_ENEMY_ROLE) {
			continue;
		}
		for (const against of MINIMAP_ENEMY_DIFFERENCE_ROLES) {
			const againstColor = colors[against];
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = colorDifference(color, againstColor);
			out.push({
				role,
				check: "difference",
				color,
				against,
				againstColor,
				value,
				min: MIN_MINIMAP_ENEMY_DIFFERENCE,
				ok: value >= MIN_MINIMAP_ENEMY_DIFFERENCE,
			});
		}
	}
	return out;
}

/**
 * The combo (docs/COMBO.md CB3), COMBO_COLOR_RULES (`rules` below) for each role:
 * - check "panel": every `rules.tiers` colour vs `rules.panel` (WCAG contrast, >= minPanelContrast);
 * - check "step": every tier but the first vs the one before it (CIE76, >= minStepDifference);
 * - check "shout": every `rules.shouted` colour vs every `rules.shoutAgainst` colour (CIE76, >= minShoutDifference);
 * - check "chroma": `rules.broken`'s CIE LCh C* (<= maxBrokenChroma; `against` "C*", no `againstColor`);
 * - check "broken": `rules.broken` vs every tier (CIE76, >= minBrokenDifference).
 * `value` is the ratio, difference or chroma; `limit` the rule's bar (a ceiling for "chroma", a floor otherwise). Tiers
 * in ladder order (panel, step, shout per role), then the broken grey (chroma, then every tier). A role that is missing
 * or not a hex colour is skipped (the colour-role check reports it). Imports one contract name on purpose: this
 * module's compiled Luau sits at the 200-locals-per-function limit.
 */
export interface ComboEntry {
	role: string;
	check: "panel" | "step" | "shout" | "chroma" | "broken";
	color: string;
	against: string;
	againstColor?: string;
	value: number;
	limit: number;
	ok: boolean;
}

/**
 * Every check ComboEntry describes, in the order given there. An empty list when `manifest` or its `colors` is not an
 * object; a colour that is missing or not '#rrggbb' is skipped (the colour-role check reports it). `validateManifest`
 * turns each entry that is not `ok` into an error; specs read the whole table.
 */
export function comboReport(manifest: unknown): Array<ComboEntry> {
	const out = new Array<ComboEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const rules = COMBO_COLOR_RULES;
	const difference = (
		role: string,
		check: "step" | "shout" | "broken",
		color: string,
		against: string,
		limit: number,
	) => {
		const againstColor = colors[against];
		if (!isHexColor(againstColor)) {
			return;
		}
		const value = colorDifference(color, againstColor);
		out.push({ role, check, color, against, againstColor, value, limit, ok: value >= limit });
	};
	const panel = colors[rules.panel];
	for (let i = 0; i < rules.tiers.size(); i++) {
		const role = rules.tiers[i];
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		if (isHexColor(panel)) {
			const value = contrastRatio(color, panel);
			out.push({
				role,
				check: "panel",
				color,
				against: rules.panel,
				againstColor: panel,
				value,
				limit: rules.minPanelContrast,
				ok: value >= rules.minPanelContrast,
			});
		}
		if (i > 0) {
			difference(role, "step", color, rules.tiers[i - 1], rules.minStepDifference);
		}
		if (rules.shouted.includes(role)) {
			for (const against of rules.shoutAgainst) {
				difference(role, "shout", color, against, rules.minShoutDifference);
			}
		}
	}
	const broken = colors[rules.broken];
	if (isHexColor(broken)) {
		const chroma = labChroma(broken);
		out.push({
			role: rules.broken,
			check: "chroma",
			color: broken,
			against: "C*",
			value: chroma,
			limit: rules.maxBrokenChroma,
			ok: chroma <= rules.maxBrokenChroma,
		});
		for (const against of rules.tiers) {
			difference(rules.broken, "broken", broken, against, rules.minBrokenDifference);
		}
	}
	return out;
}

/**
 * Near misses (docs/GRAZE_PARRY.md GP3), NEAR_MISS_COLOR_RULES (`rules` below) for each role in `rules.roles` order:
 * - check "floor": the role vs every biome's floor (WCAG contrast, >= minFloorContrast; `against` = the biome ID,
 *   biomes in sorted order; walls are not checked, sparks and the PARRY! text lie on floors);
 * - check "difference": the role vs every `rules.against` colour (CIE76, >= minDifference; `against` = the role).
 * `value` is the ratio or the difference. A role that is missing or not a hex colour is skipped (the colour-role check
 * reports it). Imports one contract name on purpose: this module's compiled Luau sits at the 200-locals-per-function
 * limit.
 */
export interface NearMissEntry {
	role: string;
	check: "floor" | "difference";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/**
 * Every check NearMissEntry describes, in the order given there. An empty list when `manifest` or its `colors` is not
 * an object; a colour that is missing or not '#rrggbb' is skipped (the colour-role check reports it).
 * `validateManifest` turns each entry that is not `ok` into an error; specs read the whole table.
 */
export function nearMissReport(manifest: unknown): Array<NearMissEntry> {
	const out = new Array<NearMissEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const rules = NEAR_MISS_COLOR_RULES;
	const biomes = isObj(manifest.biomes) ? sortedEntries(manifest.biomes) : [];
	for (const role of rules.roles) {
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		for (const [biome, def] of biomes) {
			const againstColor = isObj(def) ? def.floor : undefined;
			if (!isHexColor(againstColor)) {
				continue;
			}
			const value = contrastRatio(color, againstColor);
			const min = rules.minFloorContrast;
			out.push({ role, check: "floor", color, against: biome, againstColor, value, min, ok: value >= min });
		}
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
	return out;
}

/**
 * The boon draft's rarity ladder (docs/DRAFT_REVEAL.md DR3), BOON_RARITY_COLOR_RULES (`rules` below), per role in
 * rarity order: check "panel" (WCAG contrast on `rules.panel`, >= minPanelContrast), then for every rarity but the
 * first check "step" (CIE76 from the rarity below it, >= minStepDifference). `value` is the ratio or difference, `limit`
 * the bar. A role that is missing or not a hex colour is skipped (the colour-role check reports it).
 */
export interface BoonRarityEntry {
	role: string;
	check: "panel" | "step";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	limit: number;
	ok: boolean;
}

/**
 * Every check BoonRarityEntry describes, in the order given there. An empty list when `manifest` or its `colors` is not
 * an object; a colour that is missing or not '#rrggbb' is skipped (the colour-role check reports it).
 * `validateManifest` turns each entry that is not `ok` into an error; specs read the whole table.
 */
export function boonRarityReport(manifest: unknown): Array<BoonRarityEntry> {
	const out = new Array<BoonRarityEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) {
		return out;
	}
	const colors = manifest.colors;
	const rules = BOON_RARITY_COLOR_RULES;
	for (let i = 0; i < rules.roles.size(); i++) {
		const role = rules.roles[i];
		const color = colors[role];
		if (!isHexColor(color)) {
			continue;
		}
		const panel = colors[rules.panel];
		if (isHexColor(panel)) {
			const value = contrastRatio(color, panel);
			const limit = rules.minPanelContrast;
			out.push({
				role,
				check: "panel",
				color,
				against: rules.panel,
				againstColor: panel,
				value,
				limit,
				ok: value >= limit,
			});
		}
		const below = i > 0 ? rules.roles[i - 1] : undefined;
		const belowColor = below !== undefined ? colors[below] : undefined;
		if (below !== undefined && isHexColor(belowColor)) {
			const value = colorDifference(color, belowColor);
			const limit = rules.minStepDifference;
			out.push({
				role,
				check: "step",
				color,
				against: below,
				againstColor: belowColor,
				value,
				limit,
				ok: value >= limit,
			});
		}
	}
	return out;
}

/** Is `def` drawn art (an `image` or `sprites` asset), not a placeholder, silent or missing entry? */
function isArtAsset(def: unknown): boolean {
	return isObj(def) && (def.kind === "image" || def.kind === "sprites");
}

/**
 * BA-P2 (docs/BOOST_ART.md): a `boost.<kind>` with art (image / sprites, not its placeholder gem) needs the halo art
 * `decor.fx.<BOOST_HALO_FX>` in the same pack: the drop props alone are 1.7-3.6:1 on the floor (under
 * MIN_BOOST_CONTRAST), and the halo, tinted by the kind's role, is what makes the drop read. One problem per boost
 * with art, in BOOST_KINDS order.
 */
export function boostHaloProblems(assets: Obj): Array<{ path: Array<string>; msg: string }> {
	const out = new Array<{ path: Array<string>; msg: string }>();
	const halo = decorFxId(BOOST_HALO_FX);
	if (isArtAsset(assets[halo])) {
		return out;
	}
	for (const kind of BOOST_KINDS) {
		const id = boostId(kind);
		if (isArtAsset(assets[id])) {
			out.push({
				path: ["assets", id],
				msg: `boost art needs ${q(halo)} art too (the drop's halo, tinted by ${q(
					id,
				)}): the art alone fails the ${fixed1(MIN_BOOST_CONTRAST)}:1 floor contrast (docs/BOOST_ART.md BA-P2)`,
			});
		}
	}
	return out;
}
