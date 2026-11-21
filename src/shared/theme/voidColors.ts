/**
 * Roblox port (docs/VOID_DECOR.md VD1): the void's colours. Every biome carries `shoulder` (the rock band along walls
 * and corridors, at just under wall height) and `abyss` (the deep void and the backdrop) next to `floor` / `wall`; the
 * ledge between them (a lower step of the shoulder's rock) is derived, `voidLedgeColor`, so the view and the validator
 * draw and check the same colour. Kept out of validate.ts, whose compiled Luau sits at Luau's 200-locals-per-function
 * limit: validate.ts imports one name from here (`voidColorProblems`) and calls it inside validateManifest, like
 * newBestColors.ts.
 *
 * `voidReport` (VOID_CONTRAST), per biome:
 *   - the shoulder reads as wall mass, not floor (readability rule 1): CIE76 from the floor >= shoulderVsFloor, and
 *     nearer the wall than the floor;
 *   - luminance runs down into the void: abyss <= ledge <= shoulder;
 *   - an enemy bullet hugging a far wall is drawn over the shoulder and the ledge (rule 3): every `bulletRoles` colour
 *     >= minBulletContrast (WCAG) on both, at a depth band's light (`light`: the shoulder is lit like a wall, the bullet
 *     is self-lit Neon; validateManifest checks full light, shared/view/decor's profile spec every band);
 *   - the abyss never reads as a threat: >= minAbyssDifference (CIE76) from every `abyssAgainst` colour.
 *
 * @module
 */

import {
	colorDifference,
	contrastRatio,
	dimHex,
	isHexColor,
	mixRgb,
	parseHex,
	relativeLuminance,
	toHex,
	type Rgb,
} from "./color";
import { MIN_DECOR_FX_BULLET_DIFFERENCE, MIN_ENEMY_BULLET_CONTRAST } from "./contract";
import type { ColorRole, HexColor } from "./types";
import { isObj, sortedEntries } from "./util";

/** The void's derived colours (docs/VOID_DECOR.md VD1). Tunable; the validator checks what they make. */
export const VOID_COLORS = {
	/**
	 * How far the ledge's colour moves from the shoulder toward the abyss, 0..1 (`voidLedgeColor`): a lower step of the
	 * same rock, a little darker. Starting value; VD11 tunes it in Studio.
	 */
	ledgeMix: 0.35,
} as const;

/** What `voidReport` checks against what, and the bars (VOID_CONTRAST). */
export interface VoidContrastRules {
	/**
	 * CIE76 between a biome's shoulder and its floor, at least (readability rule 1: the void must never read as
	 * walkable). The shoulder must also sit nearer the wall than the floor (CIE76), so it reads as more wall.
	 */
	readonly shoulderVsFloor: number;
	/** The colours drawn over the shoulder and the ledge: the enemy bullet (the wall rule's role, `contrastReport`). */
	readonly bulletRoles: ReadonlyArray<ColorRole>;
	/** WCAG contrast of every `bulletRoles` colour on the shoulder and the ledge: the walls' bar. */
	readonly minBulletContrast: number;
	/** The colours the abyss must never be mistaken for: the bullet core and `telegraph`. */
	readonly abyssAgainst: ReadonlyArray<ColorRole>;
	/** CIE76 between the abyss and every `abyssAgainst` colour: the decor fx / enemy outline bar. */
	readonly minAbyssDifference: number;
}

/**
 * The void colour rules (`voidReport`).
 *
 * `shoulderVsFloor` 4: about 1.7 just-noticeable differences (CIE76 2.3). The bar is low on purpose. The shoulder must
 * also sit nearer the wall than the floor, and the placeholder's walls stand very close to their floors (ancient 4.5,
 * verdant 5.7, frost 6.4; molten 13.4, grim 11.2), so on the wall's side of that midpoint the shoulder can only be about
 * as far from the floor as the wall itself unless it turns lighter than the wall top (losing the wall's lip, VDD6) or
 * changes hue. The real separation comes from the shoulder's height (0.85 of a wall, never beside a floor cell: a wall
 * cell always stands between), its cliff faces, the "nearer the wall" clause and, in vale, its material; the bar keeps a
 * pack from painting its shoulder in the floor's colour.
 *
 * `abyssAgainst` leaves out `enemyBulletOutline` (an ENEMY_BULLET_ROLES colour): the rim is a near-black (placeholder
 * #1a0610) drawn only around a bright core, and every dark abyss sits within ~10 of it; the core and the telegraph are
 * the danger colours that read on their own.
 */
export const VOID_CONTRAST: VoidContrastRules = {
	shoulderVsFloor: 4,
	bulletRoles: ["enemyBullet"],
	minBulletContrast: MIN_ENEMY_BULLET_CONTRAST,
	abyssAgainst: ["enemyBullet", "telegraph"],
	minAbyssDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
};

/** Fallback for malformed input (the theme's missing-colour magenta). */
const VOID_MISSING: HexColor = "#ff00ff";

/**
 * The ledge's colour: `shoulder` moved VOID_COLORS.ledgeMix toward `abyss` (color.ts `mixRgb`, the minimap painter's
 * per-channel mix and rounding). The view draws it and the validator checks it. Malformed input: the other colour if it
 * is valid, else magenta.
 */
export function voidLedgeColor(shoulder: string, abyss: string): HexColor {
	const s = parseHex(shoulder);
	const a = parseHex(abyss);
	if (s === undefined || a === undefined) {
		return s !== undefined ? (shoulder as HexColor) : a !== undefined ? (abyss as HexColor) : VOID_MISSING;
	}
	return toHex(mixRgb(s, a, VOID_COLORS.ledgeMix));
}

/**
 * One check of `voidReport`, per biome (biomes in sorted order), in this order:
 *   - "floor": the shoulder vs the floor, CIE76, ok when `value` >= `limit` (shoulderVsFloor);
 *   - "wall": the shoulder vs the wall, CIE76, ok when `value` < `limit` (the shoulder's CIE76 from the floor);
 *   - "order": relative luminance of `subject` (ledge, then abyss) vs `against` (shoulder, then ledge), ok when
 *     `value` <= `limit`;
 *   - "bullet": every `bulletRoles` colour (`against`) on `subject` (shoulder, then ledge) at `light`, WCAG contrast,
 *     ok when `value` >= `limit`; `color` is the subject's colour at that light;
 *   - "abyss": the abyss vs every `abyssAgainst` colour, CIE76, ok when `value` >= `limit`.
 * A biome without a hex floor / wall / shoulder / abyss skips the checks that need it (the shape check reports it); a
 * missing role is skipped.
 */
export interface VoidEntry {
	biome: string;
	check: "floor" | "wall" | "order" | "bullet" | "abyss";
	subject: "shoulder" | "ledge" | "abyss";
	color: string;
	against: string;
	againstColor: string;
	value: number;
	limit: number;
	light: number;
	ok: boolean;
}

/** The void colour checks (VOID_CONTRAST) of every biome of `manifest`, the shoulder and ledge lit by `light` (0..1). */
export function voidReport(manifest: unknown, light = 1): Array<VoidEntry> {
	const out = new Array<VoidEntry>();
	if (!isObj(manifest) || !isObj(manifest.biomes)) {
		return out;
	}
	const colors = isObj(manifest.colors) ? manifest.colors : {};
	const rules = VOID_CONTRAST;
	const lum = (hex: string) => relativeLuminance(parseHex(hex) as Rgb);
	for (const [biome, def] of sortedEntries(manifest.biomes)) {
		if (!isObj(def)) {
			continue;
		}
		const shoulder = def.shoulder;
		const abyss = def.abyss;
		const floor = def.floor;
		const wall = def.wall;
		const push = (e: Omit<VoidEntry, "biome" | "light">) => out.push({ biome, light, ...e });
		if (isHexColor(shoulder) && isHexColor(floor)) {
			const fromFloor = colorDifference(shoulder, floor);
			const limit = rules.shoulderVsFloor;
			push({
				check: "floor",
				subject: "shoulder",
				color: shoulder,
				against: "floor",
				againstColor: floor,
				value: fromFloor,
				limit,
				ok: fromFloor >= limit,
			});
			if (isHexColor(wall)) {
				const fromWall = colorDifference(shoulder, wall);
				push({
					check: "wall",
					subject: "shoulder",
					color: shoulder,
					against: "wall",
					againstColor: wall,
					value: fromWall,
					limit: fromFloor,
					ok: fromWall < fromFloor,
				});
			}
		}
		if (!isHexColor(shoulder)) {
			continue;
		}
		const ledge = isHexColor(abyss) ? voidLedgeColor(shoulder, abyss) : undefined;
		if (ledge !== undefined && isHexColor(abyss)) {
			const steps: ReadonlyArray<["ledge" | "abyss", string, string, string]> = [
				["ledge", ledge, "shoulder", shoulder],
				["abyss", abyss, "ledge", ledge],
			];
			for (const [subject, color, against, againstColor] of steps) {
				const value = lum(color);
				const limit = lum(againstColor);
				push({ check: "order", subject, color, against, againstColor, value, limit, ok: value <= limit });
			}
		}
		const lit: ReadonlyArray<["shoulder" | "ledge", string]> =
			ledge !== undefined
				? [
						["shoulder", shoulder],
						["ledge", ledge],
				  ]
				: [["shoulder", shoulder]];
		for (const role of rules.bulletRoles) {
			const bullet = colors[role];
			if (!isHexColor(bullet)) {
				continue;
			}
			for (const [subject, hex] of lit) {
				const color = dimHex(hex, light);
				const value = contrastRatio(bullet, color);
				const limit = rules.minBulletContrast;
				push({
					check: "bullet",
					subject,
					color,
					against: role,
					againstColor: bullet,
					value,
					limit,
					ok: value >= limit,
				});
			}
		}
		if (isHexColor(abyss)) {
			for (const role of rules.abyssAgainst) {
				const againstColor = colors[role];
				if (!isHexColor(againstColor)) {
					continue;
				}
				const value = colorDifference(abyss, againstColor);
				const limit = rules.minAbyssDifference;
				push({
					check: "abyss",
					subject: "abyss",
					color: abyss,
					against: role,
					againstColor,
					value,
					limit,
					ok: value >= limit,
				});
			}
		}
	}
	return out;
}

/** A validator message: where (a manifest path) and what. */
export interface VoidColorProblem {
	path: Array<string>;
	msg: string;
}

/**
 * Every failed voidReport check (full light) as a validator message, path `biomes.<id>.shoulder` (floor, wall, the
 * ledge's order, bullets) or `biomes.<id>.abyss` (the abyss's order and difference).
 */
export function voidColorProblems(manifest: unknown): Array<VoidColorProblem> {
	const fixed1 = (n: number) => "%.1f".format(n);
	const fixed2 = (n: number) => "%.2f".format(n);
	const fixed4 = (n: number) => "%.4f".format(n);
	const out = new Array<VoidColorProblem>();
	for (const c of voidReport(manifest)) {
		if (c.ok) {
			continue;
		}
		let msg: string;
		if (c.check === "floor") {
			msg =
				`colour difference: shoulder ${c.color} vs floor ${c.againstColor} is ${fixed1(c.value)} (CIE76), ` +
				`needs >= ${fixed1(c.limit)}: the void's shoulder must never read as walkable floor`;
		} else if (c.check === "wall") {
			msg =
				`colour difference: shoulder ${c.color} is ${fixed1(c.value)} (CIE76) from wall ${
					c.againstColor
				} but ` +
				`${fixed1(
					c.limit,
				)} from the floor: the shoulder must sit nearer the wall than the floor (it reads as wall mass)`;
		} else if (c.check === "order") {
			msg =
				`luminance: ${c.subject} ${c.color} (${fixed4(c.value)}) is brighter than ${c.against} ${
					c.againstColor
				} ` + `(${fixed4(c.limit)}): the void must darken from shoulder to ledge to abyss`;
		} else if (c.check === "bullet") {
			msg =
				`contrast: ${c.against} ${c.againstColor} on ${c.subject} ${c.color} is ${fixed2(
					c.value,
				)}:1, needs >= ` + `${fixed1(c.limit)}:1: enemy bullets along a far wall are drawn over the void`;
		} else {
			msg =
				`colour difference: abyss ${c.color} vs ${c.against} ${c.againstColor} is ${fixed1(
					c.value,
				)} (CIE76), ` +
				`needs >= ${fixed1(c.limit)}: the void must never read as an enemy bullet or a telegraph`;
		}
		const onAbyss = c.check === "abyss" || (c.check === "order" && c.subject === "abyss");
		out.push({ path: ["biomes", c.biome, onAbyss ? "abyss" : "shoulder"], msg });
	}
	return out;
}
