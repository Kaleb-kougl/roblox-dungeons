/**
 * Roblox port (docs/HAZARD_ART.md HA3): the floor hazards' sprite rules and `hazardArtReport`, in their own module
 * (validate.ts and contract.ts sit near Luau's 200-locals-per-function limit): folded into variantColors.ts'
 * `variantColorProblems` next to gooArtProblems, so validate.ts takes no new name.
 *
 * A BULLET_ART.hazardSpriteIds ID (`bullet.enemy.strike`, `bullet.player.ember`) drawn with a v2 `sprites` set lies flat
 * on the floor, one facing, and is tinted by the renderer with the hazard's own colour role (the strike `enemyBullet`,
 * the ember `build.ember`), roles already held to their rules (enemy-bullet contrast; buildColors.ts buildReport). So:
 *   - ONE facing; each of the ID's animations (contract.ts BULLET `idBaseAnimations`: the strike's `flash` / `scorch`,
 *     the ember's `burn`) of 1..BULLET_ART.maxHazardFrames cells; the set's own fields (cells in range, fps, sheets, the
 *     animations present) are validate.ts validateSpriteSet's, as for every sprites set;
 *   - the strike's `rimPx` (its hit rim, art px from the pivot: a positive number within half the cell), the
 *     ember's `lit` ({ w, h }: its burning patch, integer art px inside the cell); neither on the other hazard;
 *   - `meanColor` (the pipeline's mean of the visible pixels) "#rrggbb" and GREY (r = g = b): the sheet is greyscale,
 *     so the tint is the colour the player sees and the family rules hold by construction.
 *
 * @module
 */

import { isHexColor } from "./color";
import { BULLET, BULLET_ART, requiredBaseAnimations } from "./contract";
import { describeValue, isObj } from "./util";

/** The strike's ID (the one hazard with a hit rim); the other hazard, the ember, carries `lit`. */
export const HAZARD_STRIKE_ID = BULLET_ART.hazardSpriteIds[0];
/**
 * The ember's ID (`bullet.player.ember`, the second BULLET_ART.hazardSpriteIds entry): the hazard that carries `lit`
 * and must not carry `rimPx`.
 */
export const HAZARD_EMBER_ID = BULLET_ART.hazardSpriteIds[1];

/**
 * One check of `hazardArtReport`, per hazard ID with sprite art (BULLET_ART.hazardSpriteIds order), in this order:
 *   - "facings": `value` the facing count, `limit` 1 (ok when equal); only when the count is a number;
 *   - "frames" per required animation (`against` its name): `value` its frame count, `limit` BULLET_ART.maxHazardFrames;
 *     only when it is a number (a missing animation is validateSpriteSet's);
 *   - "rimPx" (the strike): ok when a positive number <= min(frameW, frameH) / 2 (`color` it described);
 *   - "lit" (the ember): ok when `{ w, h }` are integers in [1, frameW] x [1, frameH] (`color` it described);
 *   - "misplaced": `rimPx` on the ember or `lit` on the strike (`against` the field); always failed;
 *   - "meanColor": failed when it is missing or not "#rrggbb" (`color` the value described); no colour check follows;
 *   - "grey": ok when the meanColor's three channels are equal (`color` it).
 */
export interface HazardArtEntry {
	id: string;
	check: "facings" | "frames" | "rimPx" | "lit" | "misplaced" | "meanColor" | "grey";
	color: string;
	against: string;
	value: number;
	limit: number;
	ok: boolean;
}

/** True for an integer in [1, max]. */
function side(v: unknown, max: unknown): boolean {
	return typeIs(v, "number") && v >= 1 && v % 1 === 0 && (!typeIs(max, "number") || v <= max);
}

/** True for "#rrggbb" with r = g = b (case-insensitive). */
export function isGreyHex(hex: string): boolean {
	if (!isHexColor(hex)) return false;
	const s = hex.lower();
	return s.sub(2, 3) === s.sub(4, 5) && s.sub(4, 5) === s.sub(6, 7);
}

/** The hazard sprite rules on `manifest`; see HazardArtEntry. Empty for a pack whose hazards are their placeholders. */
export function hazardArtReport(manifest: unknown): Array<HazardArtEntry> {
	const out = new Array<HazardArtEntry>();
	if (!isObj(manifest) || !isObj(manifest.assets)) {
		return out;
	}
	for (const id of BULLET_ART.hazardSpriteIds) {
		const def = manifest.assets[id];
		if (!isObj(def) || def.kind !== "sprites") {
			continue;
		}
		const entry = (
			check: HazardArtEntry["check"],
			value: number,
			limit: number,
			ok: boolean,
			color = "",
			against = "",
		) => out.push({ id, check, color, against, value, limit, ok });
		const facings = def.facings;
		if (isObj(facings) && typeIs(facings.count, "number")) {
			entry("facings", facings.count, 1, facings.count === 1);
		}
		const anims = isObj(def.animations) ? def.animations : {};
		const max = BULLET_ART.maxHazardFrames;
		for (const name of requiredBaseAnimations(BULLET, id)) {
			const a = anims[name];
			if (isObj(a) && typeIs(a.frames, "number")) {
				entry("frames", a.frames, max, a.frames >= 1 && a.frames <= max, "", name);
			}
		}
		const strike = id === HAZARD_STRIKE_ID;
		if (strike) {
			const r = def.rimPx;
			const half =
				typeIs(def.frameW, "number") && typeIs(def.frameH, "number") ? math.min(def.frameW, def.frameH) / 2 : 0;
			const ok = typeIs(r, "number") && r > 0 && r <= half;
			entry("rimPx", typeIs(r, "number") ? r : 0, half, ok, describeValue(r));
			if (def.lit !== undefined) entry("misplaced", 0, 0, false, describeValue(def.lit), "lit");
		} else {
			const lit = def.lit;
			const ok = isObj(lit) && side(lit.w, def.frameW) && side(lit.h, def.frameH);
			entry("lit", 0, 0, ok, describeValue(lit));
			if (def.rimPx !== undefined) entry("misplaced", 0, 0, false, describeValue(def.rimPx), "rimPx");
		}
		const mean = def.meanColor;
		if (!isHexColor(mean)) {
			entry("meanColor", 0, 0, false, describeValue(mean));
			continue;
		}
		entry("grey", 0, 0, isGreyHex(mean), mean);
	}
	return out;
}

/** A validator message: where (a manifest path) and what. */
export interface HazardArtProblem {
	path: Array<string>;
	msg: string;
}

/**
 * Every failed hazardArtReport check as a validator message (variantColorProblems adds them; path
 * `assets.<id>[.<field>]`).
 */
export function hazardArtProblems(manifest: unknown): Array<HazardArtProblem> {
	const out = new Array<HazardArtProblem>();
	for (const c of hazardArtReport(manifest)) {
		if (c.ok) {
			continue;
		}
		const at = ["assets", c.id];
		if (c.check === "facings") {
			out.push({
				path: [...at, "facings", "count"],
				msg: `a floor hazard is drawn in one facing (flat on the floor, screen-up): must be 1, got ${c.value}`,
			});
		} else if (c.check === "frames") {
			out.push({
				path: [...at, "animations", c.against, "frames"],
				msg: `a floor hazard's ${c.against} has 1..${c.limit} frames, got ${c.value}`,
			});
		} else if (c.check === "rimPx") {
			out.push({
				path: [...at, "rimPx"],
				msg: `the strike needs its hit rim rimPx (art px from the pivot, > 0 and within half its cell, art:build writes it), got ${c.color}`,
			});
		} else if (c.check === "lit") {
			out.push({
				path: [...at, "lit"],
				msg: `the ember needs its burning patch lit { w, h } (integer art px inside the cell, art:build writes it) to cover its disc, got ${c.color}`,
			});
		} else if (c.check === "misplaced") {
			out.push({
				path: [...at, c.against],
				msg: `${c.against} belongs to the ${c.against === "lit" ? "ember" : "strike"} only, got ${c.color}`,
			});
		} else if (c.check === "meanColor") {
			out.push({
				path: [...at, "meanColor"],
				msg: `hazard art needs its meanColor ("#rrggbb", art:build writes it), got ${c.color}`,
			});
		} else {
			out.push({
				path: [...at, "meanColor"],
				msg: `hazard art is greyscale (the renderer tints it with the hazard's colour role), but its meanColor ${c.color} is not a grey`,
			});
		}
	}
	return out;
}
