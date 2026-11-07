/**
 * Roblox port (docs/PROJECTILE_ART.md PA3): the bullet sprite rules and `bulletArtReport`, kept out of validate.ts,
 * whose compiled Luau sits at Luau's 200-locals-per-function limit: folded into variantColors.ts'
 * `variantColorProblems` (like buildReport), so validate.ts takes no new name.
 *
 * A `bullet.*` ID drawn with sprite art (a v2 `sprites` set, contract.ts BULLET) must still read like the neon it
 * replaces (docs/ART.md's bullet-readability rule):
 *   - every set: ONE facing (the art points screen-up, the renderer turns it), a `fly` loop of at most
 *     BULLET_ART.maxFrames frames, and a `meanColor` (the art pipeline writes it: the alpha-weighted mean of its opaque
 *     pixels, after recolour);
 *   - player art (`bullet.player.*`) never reads as danger: its meanColor >= MIN_FX_BULLET_DIFFERENCE (CIE76) from
 *     every ENEMY_BULLET_ROLES colour and `telegraph`;
 *   - enemy art (`bullet.enemy.*`) still reads as THE danger colour: its meanColor <= MAX_ENEMY_BULLET_ART_DIFFERENCE
 *     (CIE76) from `enemyBullet`, and >= MIN_ENEMY_BULLET_CONTRAST (WCAG) on every biome floor and wall;
 *   - the floor hazards (BULLET_ART.hazardSpriteIds: strike, ember; docs/HAZARD_ART.md HA3, superseding PAD3) are not
 *     flying bullets either: their sets are hazardArt.ts `hazardArtReport`'s;
 *   - the floor sprites (BULLET_ART.floorSpriteIds: the goo puddle, docs/GOO_ART.md GA2) are not flying bullets: no
 *     entry here, gooArt.ts `gooArtReport` holds them to their own rules.
 * The set's own fields (cells in range, fps, sheets) are validate.ts validateSpriteSet's, as for every sprites set.
 */

import { colorDifference, contrastRatio, isHexColor } from "./color";
import {
	BULLET_ART,
	BULLET_IDS,
	ENEMY_BULLET_ROLES,
	MAX_ENEMY_BULLET_ART_DIFFERENCE,
	MIN_ENEMY_BULLET_CONTRAST,
	MIN_FX_BULLET_DIFFERENCE,
} from "./contract";
import type { ColorRole } from "./types";
import { describeValue, isObj, sortedEntries, startsWith } from "./util";

/** The colours player bullet art must never be mistaken for: the enemy bullets and `telegraph`. */
const PLAYER_ART_AGAINST: ReadonlyArray<ColorRole> = [...ENEMY_BULLET_ROLES, "telegraph"];

/**
 * One check of `bulletArtReport`, per `bullet.*` ID with sprite art (BULLET_IDS order; floor sprites, BULLET_ART.
 * floorSpriteIds, have none: gooArtReport; nor have the hazards, BULLET_ART.hazardSpriteIds: hazardArtReport), in this
 * order:
 *   - "facings": `value` the facing count, `limit` 1 (ok when equal); only when the count is a number;
 *   - "frames": `value` the `fly` loop's frame count, `limit` BULLET_ART.maxFrames; only when it is a number;
 *   - "meanColor": failed when it is missing or not "#rrggbb" (`color` the value described); no colour check follows;
 *   - "player" per PLAYER_ART_AGAINST colour (CIE76 >= limit), player IDs;
 *   - "enemy" vs `enemyBullet` (CIE76 <= limit), then "surface" per biome floor and wall (WCAG >= limit), enemy IDs.
 * `against` is the role or biome ID (`surface` floor / wall), "" otherwise. A missing or malformed role or surface
 * colour is skipped (the colour-role and biome checks report it).
 */
export interface BulletArtEntry {
	id: string;
	check: "facings" | "frames" | "meanColor" | "player" | "enemy" | "surface";
	color: string;
	against: string;
	againstColor: string;
	surface: "floor" | "wall" | undefined;
	value: number;
	limit: number;
	ok: boolean;
}

/** The bullet sprite rules on `manifest`; see BulletArtEntry. Empty for a pack whose bullets are all placeholders. */
export function bulletArtReport(manifest: unknown): Array<BulletArtEntry> {
	const out = new Array<BulletArtEntry>();
	if (!isObj(manifest) || !isObj(manifest.assets)) {
		return out;
	}
	const colors = isObj(manifest.colors) ? manifest.colors : {};
	const biomes = isObj(manifest.biomes) ? sortedEntries(manifest.biomes) : [];
	for (const id of BULLET_IDS) {
		const def = manifest.assets[id];
		if (
			!isObj(def) ||
			def.kind !== "sprites" ||
			BULLET_ART.floorSpriteIds.includes(id) ||
			BULLET_ART.hazardSpriteIds.includes(id)
		) {
			continue;
		}
		const entry = (
			check: BulletArtEntry["check"],
			value: number,
			limit: number,
			ok: boolean,
			color = "",
			against = "",
			againstColor = "",
			surface?: "floor" | "wall",
		) => out.push({ id, check, color, against, againstColor, surface, value, limit, ok });
		const facings = def.facings;
		if (isObj(facings) && typeIs(facings.count, "number")) {
			entry("facings", facings.count, 1, facings.count === 1);
		}
		const fly = isObj(def.animations) ? def.animations[BULLET_ART.animation] : undefined;
		if (isObj(fly) && typeIs(fly.frames, "number")) {
			entry("frames", fly.frames, BULLET_ART.maxFrames, fly.frames <= BULLET_ART.maxFrames);
		}
		const mean = def.meanColor;
		if (!isHexColor(mean)) {
			entry("meanColor", 0, 0, false, describeValue(mean));
			continue;
		}
		if (startsWith(id, "bullet.player.")) {
			for (const role of PLAYER_ART_AGAINST) {
				const c = colors[role];
				if (!isHexColor(c)) continue;
				const d = colorDifference(mean, c);
				entry("player", d, MIN_FX_BULLET_DIFFERENCE, d >= MIN_FX_BULLET_DIFFERENCE, mean, role, c);
			}
			continue;
		}
		const danger = colors.enemyBullet;
		if (isHexColor(danger)) {
			const d = colorDifference(mean, danger);
			const max = MAX_ENEMY_BULLET_ART_DIFFERENCE;
			entry("enemy", d, max, d <= max, mean, "enemyBullet", danger);
		}
		for (const [biome, b] of biomes) {
			if (!isObj(b)) continue;
			for (const surface of ["floor", "wall"] as const) {
				const c = b[surface];
				if (!isHexColor(c)) continue;
				const r = contrastRatio(mean, c);
				const min = MIN_ENEMY_BULLET_CONTRAST;
				entry("surface", r, min, r >= min, mean, biome, c, surface);
			}
		}
	}
	return out;
}

/** A validator message: where (a manifest path) and what. */
export interface BulletArtProblem {
	path: Array<string>;
	msg: string;
}

/**
 * Every failed bulletArtReport check as a validator message (variantColorProblems adds them; path
 * `assets.<id>[.<field>]`). `suffix` names a biome's Forge theme in messages (validate.ts forgeSuffix).
 */
export function bulletArtProblems(manifest: unknown, suffix: (biome: string) => string): Array<BulletArtProblem> {
	const fixed1 = (n: number) => "%.1f".format(n);
	const fixed2 = (n: number) => "%.2f".format(n);
	const out = new Array<BulletArtProblem>();
	for (const c of bulletArtReport(manifest)) {
		if (c.ok) {
			continue;
		}
		const at = ["assets", c.id];
		if (c.check === "facings") {
			out.push({
				path: [...at, "facings", "count"],
				msg: `a bullet is drawn in one facing (its art points screen-up, turned along the velocity): must be 1, got ${c.value}`,
			});
		} else if (c.check === "frames") {
			out.push({
				path: [...at, "animations", BULLET_ART.animation, "frames"],
				msg: `a bullet's ${BULLET_ART.animation} loop has at most ${c.limit} frames, got ${c.value}`,
			});
		} else if (c.check === "meanColor") {
			out.push({
				path: [...at, "meanColor"],
				msg: `bullet art needs its meanColor ("#rrggbb", art:build writes it) for the bullet colour rules, got ${c.color}`,
			});
		} else if (c.check === "player") {
			out.push({
				path: [...at, "meanColor"],
				msg:
					`colour difference: meanColor ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(c.value)} ` +
					`(CIE76), needs >= ${fixed1(
						c.limit,
					)}: a player's shot must never read as an enemy bullet or a telegraph`,
			});
		} else if (c.check === "enemy") {
			out.push({
				path: [...at, "meanColor"],
				msg:
					`colour difference: meanColor ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(c.value)} ` +
					`(CIE76), needs <= ${fixed1(c.limit)}: an enemy bullet's art must read as the danger colour`,
			});
		} else {
			out.push({
				path: [...at, "meanColor"],
				msg:
					`contrast: meanColor ${c.color} on ${c.against}${suffix(c.against)} ${tostring(c.surface)} ` +
					`${c.againstColor} is ${fixed2(c.value)}:1, needs >= ${fixed1(
						c.limit,
					)}:1: an enemy bullet must read on every floor and wall`,
			});
		}
	}
	return out;
}
