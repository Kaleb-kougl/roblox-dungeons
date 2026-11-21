/**
 * Roblox port (docs/GOO_ART.md GA2): the goo puddle's floor sprite rules and `gooArtReport`, in their own module
 * (validate.ts and contract.ts sit near Luau's 200-locals-per-function limit): folded into variantColors.ts'
 * `variantColorProblems` next to bulletArtProblems, so validate.ts takes no new name.
 *
 * A BULLET_ART.floorSpriteIds ID (`bullet.enemy.goo`) drawn with a v2 `sprites` set lies flat on the floor, never
 * turned (the art is a 3/4 view, drawn screen-up), and must still read as the goo it replaces (docs/ENEMY_VARIANTS.md
 * EVD5, variantColors.ts `gooReport`):
 *   - ONE facing; `land` of BULLET_ART.landFrames cell(s) (the drop hitting the floor) and `hold` of 1..BULLET_ART.
 *     maxFrames cells (variants picked per puddle, not a flipbook); the set's own fields (cells in range, fps, sheets,
 *     the two animations present) are validate.ts validateSpriteSet's, as for every sprites set;
 *   - `lit` ({ w, h }, art px, integers in the cell): the hold frame's lit box, which sizes the drawn puddle so it
 *     covers the hit (shared/view gooSpriteSize, GAD4);
 *   - `meanColor` (the pipeline's mean of the non-outline opaque pixels, after the recolour) <=
 *     MAX_ENEMY_BULLET_ART_DIFFERENCE (CIE76) from `enemyGoo`, and like `enemyGoo` itself (GOO_COLOR_RULES) >=
 *     MIN_ENEMY_BULLET_CONTRAST (WCAG) on every biome floor and >= MIN_DECOR_FX_BULLET_DIFFERENCE (CIE76) from every
 *     decor fx and boost colour: a puddle reads as danger, never as decor or a pickup (GOO_ART_RULES).
 *
 * @module
 */

import { colorDifference, contrastRatio, isHexColor } from "./color";
import {
	BOOST_ROLES,
	BULLET_ART,
	DECOR_FX_ROLES,
	MAX_ENEMY_BULLET_ART_DIFFERENCE,
	MIN_DECOR_FX_BULLET_DIFFERENCE,
	MIN_ENEMY_BULLET_CONTRAST,
} from "./contract";
import type { ColorRole } from "./types";
import { describeValue, isObj, sortedEntries } from "./util";
import { ENEMY_GOO_ROLE } from "./variants";

/**
 * The bars of `gooArtReport`: the art's mean within `maxGooDifference` of `enemyGoo`, and the floor and difference
 * bars of variantColors.ts GOO_COLOR_RULES (the same values: gooArt.spec pins them; written from contract.ts here so
 * this module does not import variantColors.ts, which imports it).
 */
export const GOO_ART_RULES = {
	maxGooDifference: MAX_ENEMY_BULLET_ART_DIFFERENCE,
	minFloorContrast: MIN_ENEMY_BULLET_CONTRAST,
	against: [...DECOR_FX_ROLES, ...BOOST_ROLES] as ReadonlyArray<ColorRole>,
	minDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
} as const;

/**
 * One check of `gooArtReport`, per floor sprite ID with sprite art (BULLET_ART.floorSpriteIds order), in this order:
 *   - "facings": `value` the facing count, `limit` 1 (ok when equal); only when the count is a number;
 *   - "land": `value` the `land` frame count, `limit` BULLET_ART.landFrames (ok when equal); only when it is a number;
 *   - "hold": `value` the `hold` frame count, `limit` BULLET_ART.maxFrames; only when it is a number;
 *   - "lit": the lit box (`color` it described): ok when `{ w, h }` are integers in [1, frameW] x [1, frameH];
 *   - "meanColor": failed when it is missing or not "#rrggbb" (`color` the value described); no colour check follows;
 *   - "goo": vs `enemyGoo` (CIE76 <= limit);
 *   - "floor" per biome floor (WCAG >= limit; `against` the biome ID, biomes sorted);
 *   - "difference" per GOO_ART_RULES.against colour (CIE76 >= limit; `against` the role).
 * `against` is "" for the shape checks. A missing or malformed role or floor colour is skipped (the colour-role and
 * biome checks report it).
 */
export interface GooArtEntry {
	id: string;
	check: "facings" | "land" | "hold" | "lit" | "meanColor" | "goo" | "floor" | "difference";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	limit: number;
	ok: boolean;
}

/** True for an integer in [1, max]. */
function litSide(v: unknown, max: unknown): boolean {
	return typeIs(v, "number") && v >= 1 && v % 1 === 0 && (!typeIs(max, "number") || v <= max);
}

/** The goo floor sprite rules on `manifest`; see GooArtEntry. Empty for a pack whose goo is its placeholder disc. */
export function gooArtReport(manifest: unknown): Array<GooArtEntry> {
	const out = new Array<GooArtEntry>();
	if (!isObj(manifest) || !isObj(manifest.assets)) {
		return out;
	}
	const colors = isObj(manifest.colors) ? manifest.colors : {};
	const biomes = isObj(manifest.biomes) ? sortedEntries(manifest.biomes) : [];
	for (const id of BULLET_ART.floorSpriteIds) {
		const def = manifest.assets[id];
		if (!isObj(def) || def.kind !== "sprites") {
			continue;
		}
		const entry = (
			check: GooArtEntry["check"],
			value: number,
			limit: number,
			ok: boolean,
			color = "",
			against = "",
			againstColor = "",
		) => out.push({ id, check, color, against, againstColor, value, limit, ok });
		const facings = def.facings;
		if (isObj(facings) && typeIs(facings.count, "number")) {
			entry("facings", facings.count, 1, facings.count === 1);
		}
		const anims = isObj(def.animations) ? def.animations : {};
		const land = anims[BULLET_ART.land];
		if (isObj(land) && typeIs(land.frames, "number")) {
			entry("land", land.frames, BULLET_ART.landFrames, land.frames === BULLET_ART.landFrames);
		}
		const hold = anims[BULLET_ART.hold];
		if (isObj(hold) && typeIs(hold.frames, "number")) {
			entry("hold", hold.frames, BULLET_ART.maxFrames, hold.frames <= BULLET_ART.maxFrames);
		}
		const lit = def.lit;
		const litOk = isObj(lit) && litSide(lit.w, def.frameW) && litSide(lit.h, def.frameH);
		entry("lit", 0, 0, litOk, describeValue(lit));
		const mean = def.meanColor;
		if (!isHexColor(mean)) {
			entry("meanColor", 0, 0, false, describeValue(mean));
			continue;
		}
		const goo = colors[ENEMY_GOO_ROLE];
		if (isHexColor(goo)) {
			const d = colorDifference(mean, goo);
			const max = GOO_ART_RULES.maxGooDifference;
			entry("goo", d, max, d <= max, mean, ENEMY_GOO_ROLE, goo);
		}
		for (const [biome, b] of biomes) {
			const floor = isObj(b) ? b.floor : undefined;
			if (!isHexColor(floor)) continue;
			const r = contrastRatio(mean, floor);
			const min = GOO_ART_RULES.minFloorContrast;
			entry("floor", r, min, r >= min, mean, biome, floor);
		}
		for (const role of GOO_ART_RULES.against) {
			const c = colors[role];
			if (!isHexColor(c)) continue;
			const d = colorDifference(mean, c);
			const min = GOO_ART_RULES.minDifference;
			entry("difference", d, min, d >= min, mean, role, c);
		}
	}
	return out;
}

/** A validator message: where (a manifest path) and what. */
export interface GooArtProblem {
	path: Array<string>;
	msg: string;
}

/**
 * Every failed gooArtReport check as a validator message (variantColorProblems adds them; path
 * `assets.<id>[.<field>]`). `suffix` names a biome's Forge theme in messages (validate.ts forgeSuffix).
 */
export function gooArtProblems(manifest: unknown, suffix: (biome: string) => string): Array<GooArtProblem> {
	const fixed1 = (n: number) => "%.1f".format(n);
	const fixed2 = (n: number) => "%.2f".format(n);
	const out = new Array<GooArtProblem>();
	for (const c of gooArtReport(manifest)) {
		if (c.ok) {
			continue;
		}
		const at = ["assets", c.id];
		if (c.check === "facings") {
			out.push({
				path: [...at, "facings", "count"],
				msg: `a floor sprite is drawn in one facing (flat on the floor, screen-up, never turned): must be 1, got ${c.value}`,
			});
		} else if (c.check === "land") {
			out.push({
				path: [...at, "animations", BULLET_ART.land, "frames"],
				msg: `a floor sprite's ${BULLET_ART.land} is ${c.limit} cell (the drop hitting the floor), got ${c.value}`,
			});
		} else if (c.check === "hold") {
			out.push({
				path: [...at, "animations", BULLET_ART.hold, "frames"],
				msg: `a floor sprite's ${BULLET_ART.hold} has at most ${c.limit} variants, got ${c.value}`,
			});
		} else if (c.check === "lit") {
			out.push({
				path: [...at, "lit"],
				msg: `a floor sprite needs its hold frame's lit box { w, h } (integer art px inside the cell, art:build writes it) to size the puddle over its hit, got ${c.color}`,
			});
		} else if (c.check === "meanColor") {
			out.push({
				path: [...at, "meanColor"],
				msg: `floor sprite art needs its meanColor ("#rrggbb", art:build writes it) for the goo colour rules, got ${c.color}`,
			});
		} else if (c.check === "floor") {
			out.push({
				path: [...at, "meanColor"],
				msg:
					`contrast: meanColor ${c.color} on ${c.against}${suffix(c.against)} floor ${c.againstColor} is ` +
					`${fixed2(c.value)}:1, needs >= ${fixed1(c.limit)}:1: goo must read on the floor`,
			});
		} else {
			const bar = c.check === "goo" ? `<= ${fixed1(c.limit)}` : `>= ${fixed1(c.limit)}`;
			const why =
				c.check === "goo"
					? "the goo's art must read as the goo colour"
					: "goo must read as danger, never as decor or a boost drop";
			out.push({
				path: [...at, "meanColor"],
				msg:
					`colour difference: meanColor ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(c.value)} ` +
					`(CIE76), needs ${bar}: ${why}`,
			});
		}
	}
	return out;
}
