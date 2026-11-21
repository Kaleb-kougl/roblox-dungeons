/**
 * Roblox port (docs/COSMETICS.md "Readability rules", CS3 / CS10): `cosmeticReport`, the validator every cosmetic
 * colour must pass on every bundled pack before it ships (cosmetics.spec.ts runs it over the whole catalogue). A
 * cosmetic may never make a player read as an enemy, a bullet, a hazard or a pickup:
 *
 *   1. danger   CIE76 >= minDangerDifference from every ENEMY_BULLET_ROLES colour, `telegraph` and `enemyOutline`
 *   2. pickup   CIE76 >= minPickupDifference from every BOOST_ROLES colour and `enemy.golden`
 *   3. floor    WCAG contrast on every biome's floor >= min(minFloorContrast, the UNDYED region's own contrast on that
 *               floor): a dye never makes the body less readable than the default look (teammates have no rim), capped
 *               at 3 : 1 (the orchestrator's revision of CSD5, 2026-11-17: the Archer's dark leathers set her own bar)
 *   4. outline colours: exactly playerOutlineReport's rules (the colour as `playerOutline`); trail colours: rule 1;
 *      spark colours: exactly nearMissReport's rules (the colour as `nearMiss.graze`)
 *   5. Prismatic: every stop and PRISMATIC.samplesPerSegment eased samples per segment pass the dye rules 1-3
 *
 * Every dye rule is checked on the DYED MEAN: the colour x the character's dye mean value (the atlas pipeline's
 * `dyeMeanValue` for the set, COSMETIC_DYE_SETS; passed in by the caller, so the report needs no PNG). Rule 3's baseline
 * is the undyed region's mean colour (the pipeline's `dyeSourceMean`, `dyeSources`); a character without one is held to
 * the full minFloorContrast (never a looser bar). A character without a mean gets one failing `mean` entry per dye, so a
 * missing input never passes silently.
 *
 * Its own module: it imports the validator (validate.ts) and cosmetics.ts, which contract.ts imports.
 *
 * @module
 */
import type { CharacterId } from "shared/characters";
import { COSMETIC_ITEMS, type CosmeticSlot } from "shared/cosmetics";
import { colorDifference, contrastRatio, parseHex, toHex, type Rgb } from "./color";
import { BOOST_ROLES, ENEMY_BULLET_ROLES, MIN_DECOR_FX_BULLET_DIFFERENCE } from "./contract";
import { PRISMATIC, cosmeticHex, prismaticColor, prismaticStopsOf } from "./cosmetics";
import type { ColorRole, HexColor } from "./types";
import { isObj, sortedEntries, type Obj } from "./util";
import { nearMissReport, playerOutlineReport } from "./validate";

/** The dye rules' bars and roles (docs/COSMETICS.md "Readability rules"; the bars marked *(tune)* there). */
export const COSMETIC_RULES = table.freeze({
	/** Rule 1: the threats a body, trail or rim must never be mistaken for. */
	danger: table.freeze([...ENEMY_BULLET_ROLES, "telegraph", "enemyOutline"] as ColorRole[]),
	/** Rule 1's bar: the decor fx / enemy outline bar. */
	minDangerDifference: MIN_DECOR_FX_BULLET_DIFFERENCE,
	/** Rule 2: the pickups and the Goldling. */
	pickup: table.freeze([...BOOST_ROLES, "enemy.golden"] as ColorRole[]),
	/** Rule 2's bar *(tune)*. */
	minPickupDifference: 30,
	/**
	 * Rule 3's cap *(tune)*: the dyed mean's WCAG contrast on every biome floor must reach this, or the undyed region's own
	 * contrast on that floor when that is lower.
	 */
	minFloorContrast: 3,
});

/** Which rule an entry checks. */
export type CosmeticRule = "mean" | "danger" | "pickup" | "floor" | "outline" | "trail" | "spark";

/**
 * One check. `color` is what was measured (a dye's dyed mean, else the item's colour), `base` the item's own colour
 * (a Prismatic sample's), `sample` the Prismatic sample index (stop s is sample s x samplesPerSegment), `against` a role
 * or a biome id, `value` the difference or ratio, `min` the bar.
 */
export interface CosmeticEntry {
	itemId: string;
	slot: CosmeticSlot;
	rule: CosmeticRule;
	base: string;
	color: string;
	sample?: number;
	against: string;
	againstColor: string;
	value: number;
	min: number;
	ok: boolean;
}

/** The dyed mean: each channel of `c` x `mean`, rounded to a byte (what the dye sheet's grey mean draws). */
export function dyedMean(c: Readonly<Rgb>, mean: number): Rgb {
	const k = (v: number) => math.clamp(math.floor(v * mean + 0.5), 0, 255);
	return { r: k(c.r), g: k(c.g), b: k(c.b) };
}

/** `c` rounded to whole bytes (a Prismatic sample, as drawn). */
function rounded(c: Readonly<Rgb>): HexColor {
	return toHex({ r: math.floor(c.r + 0.5), g: math.floor(c.g + 0.5), b: math.floor(c.b + 0.5) });
}

/** The character of a dye slot (`dye.knight` -> knight), or undefined. */
function dyeCharacter(slot: CosmeticSlot): CharacterId | undefined {
	if (slot === "dye.knight") return "knight";
	if (slot === "dye.archer") return "archer";
	return undefined;
}

interface Ctx {
	readonly colors: Obj;
	readonly floors: ReadonlyArray<[string, string]>;
	readonly out: CosmeticEntry[];
}

/** Rules 1-3 on one dye colour `base` (dyed by `mean`), entries tagged `sample`. */
function dyeRules(
	ctx: Ctx,
	itemId: string,
	slot: CosmeticSlot,
	base: HexColor,
	mean: number,
	source: string | undefined,
	sample: number | undefined,
): void {
	const rgb = parseHex(base);
	if (rgb === undefined) return;
	const dyed = toHex(dyedMean(rgb, mean));
	const push = (rule: CosmeticRule, against: string, againstColor: string, value: number, min: number) =>
		ctx.out.push({
			itemId,
			slot,
			rule,
			base,
			color: dyed,
			sample,
			against,
			againstColor,
			value,
			min,
			ok: value >= min,
		});
	for (const role of COSMETIC_RULES.danger) {
		const c = ctx.colors[role];
		if (typeIs(c, "string")) push("danger", role, c, colorDifference(dyed, c), COSMETIC_RULES.minDangerDifference);
	}
	for (const role of COSMETIC_RULES.pickup) {
		const c = ctx.colors[role];
		if (typeIs(c, "string")) push("pickup", role, c, colorDifference(dyed, c), COSMETIC_RULES.minPickupDifference);
	}
	for (const [biome, floor] of ctx.floors) {
		const own = source !== undefined ? contrastRatio(source, floor) : COSMETIC_RULES.minFloorContrast;
		push("floor", biome, floor, contrastRatio(dyed, floor), math.min(COSMETIC_RULES.minFloorContrast, own));
	}
}

/** `manifest` with `colors[role]` set to `color` for each role (a shallow copy: the shared tables are never changed). */
function withColors(manifest: Obj, roles: ReadonlyArray<string>, color: string): Obj {
	const colors: Obj = { ...(manifest.colors as Obj) };
	for (const role of roles) colors[role] = color;
	return { ...manifest, colors };
}

/**
 * Every check of every cosmetic in COSMETIC_ITEMS on `manifest` (module comment). `dyeMeans`: each character's dye mean
 * value (0..1); `dyeSources`: each character's undyed region mean colour (rule 3's baseline; absent: the full bar).
 * Items in catalogue order; a manifest without colours gives no entries.
 */
export function cosmeticReport(
	manifest: unknown,
	dyeMeans: Readonly<Partial<Record<CharacterId, number>>>,
	dyeSources: Readonly<Partial<Record<CharacterId, string>>> = {},
): Array<CosmeticEntry> {
	const out = new Array<CosmeticEntry>();
	if (!isObj(manifest) || !isObj(manifest.colors)) return out;
	const floors: Array<[string, string]> = [];
	if (isObj(manifest.biomes)) {
		for (const [biome, def] of sortedEntries(manifest.biomes)) {
			if (isObj(def) && typeIs(def.floor, "string")) floors.push([biome, def.floor]);
		}
	}
	const ctx: Ctx = { colors: manifest.colors, floors, out };
	for (const it of COSMETIC_ITEMS) {
		const slot: CosmeticSlot = it.slot;
		const character = dyeCharacter(slot);
		if (character !== undefined) {
			const mean = dyeMeans[character];
			const stops = prismaticStopsOf(it.id);
			const own = cosmeticHex(it.id) ?? (stops !== undefined && stops.size() > 0 ? stops[0] : "");
			if (mean === undefined || !(mean > 0 && mean <= 1)) {
				out.push({
					itemId: it.id,
					slot,
					rule: "mean",
					base: own,
					color: own,
					against: character,
					againstColor: "",
					value: mean ?? 0,
					min: 0,
					ok: false,
				});
				continue;
			}
			const source = dyeSources[character];
			if (stops === undefined) {
				dyeRules(ctx, it.id, slot, own as HexColor, mean, source, undefined);
				continue;
			}
			// Rule 5: every stop (sample s x per) and every eased sample between them, as prismaticColor draws them.
			const per = PRISMATIC.samplesPerSegment;
			const count = stops.size() * per;
			for (let k = 0; k < count; k++) {
				const c = rounded(prismaticColor(stops, (k / count) * PRISMATIC.periodSec));
				dyeRules(ctx, it.id, slot, c, mean, source, k);
			}
			continue;
		}
		const hex = cosmeticHex(it.id);
		if (hex === undefined) continue;
		if (slot === "outline") {
			for (const e of playerOutlineReport(withColors(manifest, ["playerOutline"], hex))) {
				out.push({
					itemId: it.id,
					slot,
					rule: "outline",
					base: hex,
					color: hex,
					against: e.surface !== undefined ? `${e.against}.${e.surface}` : e.against,
					againstColor: e.againstColor,
					value: e.value,
					min: e.min,
					ok: e.ok,
				});
			}
		} else if (slot === "spark") {
			for (const e of nearMissReport(withColors(manifest, ["nearMiss.graze"], hex))) {
				if (e.role !== "nearMiss.graze") continue;
				out.push({
					itemId: it.id,
					slot,
					rule: "spark",
					base: hex,
					color: hex,
					against: e.against,
					againstColor: e.againstColor,
					value: e.value,
					min: e.min,
					ok: e.ok,
				});
			}
		} else {
			for (const role of COSMETIC_RULES.danger) {
				const c = manifest.colors[role];
				if (!typeIs(c, "string")) continue;
				const value = colorDifference(hex, c);
				const min = COSMETIC_RULES.minDangerDifference;
				out.push({
					itemId: it.id,
					slot,
					rule: "trail",
					base: hex,
					color: hex,
					against: role,
					againstColor: c,
					value,
					min,
					ok: value >= min,
				});
			}
		}
	}
	return out;
}

/** The report's failures (cosmeticReport entries with ok false). */
export function cosmeticProblems(
	manifest: unknown,
	dyeMeans: Readonly<Partial<Record<CharacterId, number>>>,
	dyeSources: Readonly<Partial<Record<CharacterId, string>>> = {},
): Array<CosmeticEntry> {
	return cosmeticReport(manifest, dyeMeans, dyeSources).filter((e) => !e.ok);
}
