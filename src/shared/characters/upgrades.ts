/**
 * Armory upgrades as character traits (docs/SILVER.md SV5, "Catalogue v1"): the permanent, levelled power upgrades a
 * player buys with Silver, folded into their character's PlayerTraits for a run. The wallet (shared/wallet, the
 * server's WalletService) owns which levels a player has; this module only says what a level does. Pure data and
 * helpers, Roblox-API-free; the sim never imports it (it sees only the traits).
 *
 *   Vigor        +UPGRADE_EFFECTS.vigorHalfHearts half heart max and start per level (heartsMaxDelta)
 *   Deep Flask   +UPGRADE_EFFECTS.deepFlaskCharges flask charge per level (flaskChargesDelta)
 *   Plating      +UPGRADE_EFFECTS.platingArmorPips armor pip max (and start) per level (armorMaxDelta)
 *
 * Prospector (more Silver) has no sim lever and is not here.
 */
import type { PlayerTraits } from "shared/sim";
import { characterTraits, type CharacterId } from "./characters";

/** A player's upgrade levels (0 = not bought). Integers in [0, UPGRADE_MAX_LEVELS[track]]. */
export interface UpgradeLevels {
	readonly vigor: number;
	readonly deepFlask: number;
	readonly plating: number;
}

/** The upgrade tracks with a sim lever, in a fixed order (codecs, specs, the dev panel's "max"). */
export const UPGRADE_TRACKS = ["vigor", "deepFlask", "plating"] as const;
export type UpgradeTrack = (typeof UPGRADE_TRACKS)[number];

/** No upgrades bought: the character's own traits exactly. */
export const NO_UPGRADES: UpgradeLevels = table.freeze({ vigor: 0, deepFlask: 0, plating: 0 });

/** The highest level of each track (docs/SILVER.md "Catalogue v1": Vigor 2, Deep Flask 2, Plating 1). */
export const UPGRADE_MAX_LEVELS: UpgradeLevels = table.freeze({ vigor: 2, deepFlask: 2, plating: 1 });

/** What one level of each track adds to its trait. */
export const UPGRADE_EFFECTS = table.freeze({
	/** Vigor: half hearts of maximum and starting health per level. */
	vigorHalfHearts: 1,
	/** Deep Flask: flask charges per level. */
	deepFlaskCharges: 1,
	/** Plating: armor pips of maximum (and starting armor) per level. */
	platingArmorPips: 1,
});

/** True when every track of `levels` is NO_UPGRADES' (level 0). */
export function hasNoUpgrades(levels: Readonly<UpgradeLevels>): boolean {
	for (const t of UPGRADE_TRACKS) if (levels[t] !== 0) return false;
	return true;
}

/** True for an integer level in [0, max]. */
function isLevel(v: unknown, max: number): v is number {
	return typeIs(v, "number") && v === v && v >= 0 && v <= max && math.floor(v) === v;
}

/**
 * `x` as UpgradeLevels when it is a table whose every track is an integer level in [0, its max] (an untrusted value: a
 * wallet hook's answer, a reply on the wire), else undefined. Extra keys are ignored. Returns a fresh frozen copy.
 */
export function readUpgradeLevels(x: unknown): UpgradeLevels | undefined {
	if (!typeIs(x, "table")) return undefined;
	const t = x as { readonly [k: string]: unknown };
	const vigor = t.vigor;
	const deepFlask = t.deepFlask;
	const plating = t.plating;
	if (!isLevel(vigor, UPGRADE_MAX_LEVELS.vigor)) return undefined;
	if (!isLevel(deepFlask, UPGRADE_MAX_LEVELS.deepFlask)) return undefined;
	if (!isLevel(plating, UPGRADE_MAX_LEVELS.plating)) return undefined;
	return table.freeze({ vigor, deepFlask, plating });
}

/** `levels` with every track clamped to [0, its max] and rounded down (a non-number reads as 0). */
export function clampUpgradeLevels(levels: Readonly<UpgradeLevels>): UpgradeLevels {
	const clampTrack = (v: unknown, max: number) =>
		typeIs(v, "number") && v === v ? math.clamp(math.floor(v), 0, max) : 0;
	return table.freeze({
		vigor: clampTrack(levels.vigor, UPGRADE_MAX_LEVELS.vigor),
		deepFlask: clampTrack(levels.deepFlask, UPGRADE_MAX_LEVELS.deepFlask),
		plating: clampTrack(levels.plating, UPGRADE_MAX_LEVELS.plating),
	});
}

/** Two level sets are the same. */
export function sameUpgradeLevels(a: Readonly<UpgradeLevels>, b: Readonly<UpgradeLevels>): boolean {
	for (const t of UPGRADE_TRACKS) if (a[t] !== b[t]) return false;
	return true;
}

/**
 * `characterId`'s traits with `levels` folded in (clamped to the tracks' maxima first): Vigor adds to
 * heartsMaxDelta (summed with the character's own), Deep Flask to flaskChargesDelta, Plating to armorMaxDelta. With
 * NO_UPGRADES (or every level 0) this is characterTraits(characterId) itself (the same object), so a run without
 * upgrades builds exactly the config it built before.
 */
export function upgradeTraits(characterId: CharacterId, levels: Readonly<UpgradeLevels>): PlayerTraits {
	const base = characterTraits(characterId);
	const l = clampUpgradeLevels(levels);
	if (hasNoUpgrades(l)) return base;
	return table.freeze({
		...base,
		heartsMaxDelta: base.heartsMaxDelta + l.vigor * UPGRADE_EFFECTS.vigorHalfHearts,
		flaskChargesDelta: base.flaskChargesDelta + l.deepFlask * UPGRADE_EFFECTS.deepFlaskCharges,
		armorMaxDelta: base.armorMaxDelta + l.plating * UPGRADE_EFFECTS.platingArmorPips,
	});
}
