/**
 * The theme contract's ambience, sound-extra, sprite-effect and gameplay-key rules (docs/CODEBASE_SCALE.md DX8: a pure move out of contract.ts).
 *
 * @module
 */
import type { ColorRole } from "../types";
import { decorBiomeKey } from "./decor";
import { AMBIENCE_IDS, BOOST_FX_IDS, type AmbienceId, type BiomeId } from "./ids";
import { MIN_DECOR_FX_BULLET_DIFFERENCE } from "./colors";

// ---------------------------------------------------------------------------------------------
// Effects and audio (Roblox port, docs/FX_AUDIO.md A2, F1)

/** Biome `biome`'s ambience loop: ambienceId("biome.2") = "amb.b2". */
export function ambienceId(biome: BiomeId): AmbienceId {
	return `amb.${decorBiomeKey(biome)}` as AmbienceId;
}

/** Is `id` one of AMBIENCE_IDS? */
export function isAmbienceId(id: string): id is AmbienceId {
	return (AMBIENCE_IDS as ReadonlyArray<string>).includes(id);
}

/**
 * The PlaybackSpeed range a sound's `pitch` jitter may span (SoundAsset.pitch): half to double speed. Beyond it a clip
 * stops sounding like itself. Renderers clamp to it too (ThemeCore.sound).
 */
export const SOUND_PITCH_LIMITS = { min: 0.5, max: 2 } as const;

/**
 * The sprite effects (fx.*), each optional. Hit marks (`hit.light` / `hit.heavy`), the sword's swing trails (`swing.1`
 * .. `swing.3`, the 3rd is the finisher), the kill puff, roll dust, the guard shield, the Ember ring, the flask, the
 * boss's phase change / slam / death, relic and shrine, the open-stairwell loop and a breakable's splinters; then the
 * Goldling's coin burst on every hit (docs/FORTUNE.md FO6, fortune.ts GOLDEN_COIN_FX_ID; tinted by `golden.coin` under
 * the fx tint rule); then a player bullet's impact burst (docs/PROJECTILE_ART.md PA7, BULLET_ART.hitFx; untinted, its
 * meanColor under the fx rule); then the boost drops' pickup burst and per-kind aura (BOOST_FX_IDS, docs/BOOSTS.md B5); then a
 * vault chest's light column (docs/TREASURE.md TR6, treasure.ts TREASURE_COLUMN_FX_ID; tinted by the opened tier's
 * floor role); then a secret room's dust trickle (docs/SECRET_ROOMS.md SR10, secrets.ts SECRET_DUST_FX_ID; tinted by
 * `secret.dust`). Built inside a function like REQUIRED_ASSET_IDS: an entry after the spread costs a top-level length
 * local in contract.luau.
 */
export const FX_IDS = (() =>
	[
		"fx.hit.light",
		"fx.hit.heavy",
		"fx.swing.1",
		"fx.swing.2",
		"fx.swing.3",
		"fx.death.puff",
		"fx.roll.dust",
		"fx.guard.shield",
		"fx.ember.ring",
		"fx.flask",
		"fx.boss.phase",
		"fx.boss.slam",
		"fx.boss.death",
		"fx.relic.take",
		"fx.shrine.use",
		"fx.stairwell",
		"fx.breakable.splinter",
		// docs/FORTUNE.md FO6: the Goldling's coin burst
		"fx.golden.coin",
		// docs/PROJECTILE_ART.md PA7: a player bullet's impact
		"fx.bullet.hit",
		...BOOST_FX_IDS,
		"fx.treasure.column",
		// docs/SECRET_ROOMS.md SR10 (secrets.ts SECRET_DUST_FX_ID): a secret room's dust trickle
		"fx.secret.dust",
		// docs/SILVER.md SV7 (silver.ts SILVER_COINS_FX_ID): the Silver crate burst's coin, tinted by `silver`
		"fx.silver.coins",
	] as const)();
/**
 * A sprite effect's ID (an FX_IDS entry): what renderers pass to the pack's fx lookup. Any other `fx.` ID in a manifest
 * is an error.
 */
export type FxId = (typeof FX_IDS)[number];

/** Is `id` one of FX_IDS? */
export function isFxId(id: string): id is FxId {
	return (FX_IDS as ReadonlyArray<string>).includes(id);
}

/**
 * Largest drawn sprite effect, world tiles on the cell's longer side (SpriteSetAsset.sizeTiles, or the cell's own
 * size / pixelsPerTile). Readability: effects stay small next to bullets and telegraphs. ThemeCore.fx clamps to it.
 */
export const FX_SPRITE_MAX_TILES = 3;

/**
 * The port's effect colour roles with no other use (`fx.heal` for `fx.flask`, `fx.curse` for the shrine). Required in
 * every pack like every role; held to MIN_FX_BULLET_DIFFERENCE from every ENEMY_BULLET_ROLES colour.
 */
export const FX_ROLES: ReadonlyArray<ColorRole> = ["fx.heal", "fx.curse"];

/**
 * Minimum CIE76 difference between an effect colour and every enemy-bullet colour: FX_ROLES, every fx entry's `tint`
 * role, and an untinted entry's `meanColor`. The decor fx rule (MIN_DECOR_FX_BULLET_DIFFERENCE), applied to effects.
 */
export const MIN_FX_BULLET_DIFFERENCE = MIN_DECOR_FX_BULLET_DIFFERENCE;

/**
 * Roblox port (docs/PROJECTILE_ART.md PA3): the largest CIE76 difference between an enemy bullet's art `meanColor`
 * (a `bullet.enemy.*` sprites set, recoloured into the danger ramp) and `enemyBullet`: the art must still read as THE
 * danger colour. Player bullet art is held the other way, to MIN_FX_BULLET_DIFFERENCE from ENEMY_BULLET_ROLES and
 * `telegraph`; enemy art also to MIN_ENEMY_BULLET_CONTRAST on every biome floor and wall (`bulletArtReport`).
 */
export const MAX_ENEMY_BULLET_ART_DIFFERENCE = 12;

/** Manifest keys that smell like gameplay data. Packs carry art, never numbers that change difficulty. */
export const GAMEPLAY_KEY_WORDS = [
	"hitbox",
	"hurtbox",
	"collider",
	"collision",
	"speed",
	"velocity",
	"damage",
	"dmg",
	"dps",
	"radius",
	"cooldown",
	"health",
	"hp",
	"range",
	"duration",
	"lifetime",
	"ttl",
	"knockback",
	"mass",
	"rate",
	"delay",
	"interval",
	"windup",
	"iframes",
	"invulnerable",
	"stats",
] as const;

/**
 * Sound-asset keys that contain a gameplay word but are presentation (docs/FX_AUDIO.md A2): `minInterval` throttles
 * how often a clip may restart, it changes no difficulty. The gameplay-key scan skips exactly these keys on a
 * `sound` asset; anywhere else they are still flagged.
 */
export const SOUND_PRESENTATION_KEYS: ReadonlyArray<string> = ["minInterval"];
