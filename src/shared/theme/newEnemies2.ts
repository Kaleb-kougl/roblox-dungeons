/**
 * Roblox port (docs/NEW_ENEMIES_2.md NX1): the third endless set's theme keys, as lists the specs check against the
 * contract. Pure data with no runtime import, like secrets.ts: contract.ts and validate.ts sit near Luau's
 * 200-locals-per-function limit, so contract.ts names the same archetypes, bullet visuals and sounds inline inside its
 * existing lists (ENEMY_ARCHETYPES, BULLET_IDS, PORT_AUDIO_EVENTS); newEnemies2.spec.ts checks they agree. The guard's
 * colour rule and `guardReport` are in variantColors.ts (validate.ts takes no new name).
 *
 * The four first-sighting lines (`bestiary.<id>`) are in variants.ts BESTIARY_ARCHETYPES / BESTIARY_STRING_KEYS (the
 * archetypes' block, before the affixes: NE1's rule) with their shared/onboarding sighting ids; the brazier (`pyre`)
 * has none (NXD15).
 *
 * @module
 */

import type { ColorRole } from "./types";

/** The five archetype slots, in contract.ts ENEMY_ARCHETYPES order (its last five): `enemy.<id>`, its role, `.name`. */
export const NEW_ENEMY_2_ARCHETYPES = ["bulwark", "chainhook", "snatcher", "pyrekeeper", "pyre"] as const;

/** The four that a first sighting announces and the Codex lists (NXD15: not the brazier). */
export const NEW_ENEMY_2_BESTIARY = ["bulwark", "chainhook", "snatcher", "pyrekeeper"] as const;

/**
 * The Bulwark's guard colour: the faint arc in front of a guarding Bulwark and the sparks of a blocked hit (NX7). Not
 * `enemyShield` (variants.ts ENEMY_SHIELD_ROLE), which is the Shielded affix's shield segment: a Shielded Bulwark is
 * legal (NXD1) and must show both. Held to variantColors.ts GUARD_COLOR_RULES by `guardReport`.
 */
export const ENEMY_GUARD_ROLE: ColorRole = "enemyGuard";

/** The Chainhook's thrown hook (BulletKind.HOOK): an enemy bullet visual (NX7 draws the chain behind it). */
export const HOOK_BULLET_ID = "bullet.enemy.hook";
/**
 * The brazier's fireball look (NXD12): the Player Bullets pack's Hyper flame recoloured into the danger pink (NX8),
 * held to bulletArt.ts like every enemy look. NX7 maps the pyre's bullets to it; until then nothing draws it.
 */
export const FLAME_BULLET_ID = "bullet.enemy.flame";
/** Both bullet visuals, in contract.ts BULLET_IDS order (right after `bullet.enemy.strike`). */
export const NEW_ENEMY_2_BULLET_IDS: ReadonlyArray<string> = [HOOK_BULLET_ID, FLAME_BULLET_ID];

/** A shot blocked by a Bulwark's shield (falls back to sfx.breakable.hit while silent). */
export const BULWARK_BLOCK_SOUND = "sfx.enemy.block";
/** A Bulwark's guard broken (falls back to sfx.enemy.stun, the Charger's wall stun). */
export const BULWARK_GUARD_BREAK_SOUND = "sfx.enemy.guardbreak";
/** A Chainhook's throw (falls back to sfx.enemy.charge). */
export const CHAINHOOK_THROW_SOUND = "sfx.enemy.hook";
/** Its hook latching on (falls back to sfx.build.pin, the Siege Bolt's pin). */
export const CHAINHOOK_LATCH_SOUND = "sfx.enemy.hooklatch";
/** A Snatcher eating a pellet (falls back to sfx.pellet.eat). */
export const SNATCHER_SNATCH_SOUND = "sfx.enemy.snatch";
/** A Snatcher swallowing what it carries (falls back to sfx.combo.break). */
export const SNATCHER_SWALLOW_SOUND = "sfx.enemy.swallow";
/** A stolen pellet back on the floor (falls back to sfx.pellet.eat). */
export const PELLET_RETURN_SOUND = "sfx.pellet.return";
/** A Pyre-keeper's brazier flaring up (falls back to sfx.enemy.fuse). */
export const PYRE_LIGHT_SOUND = "sfx.enemy.pyrelight";

/**
 * The eight sounds (port audio IDs, SILENT in the placeholder and in vale until NX10 picks clips), in PORT_AUDIO_EVENTS
 * after the secret rooms' three (its last ones). Until uploaded each falls back one step (shared/view/audio SFX_FALLBACK).
 */
export const NEW_ENEMY_2_AUDIO_IDS: ReadonlyArray<string> = [
	BULWARK_BLOCK_SOUND,
	BULWARK_GUARD_BREAK_SOUND,
	CHAINHOOK_THROW_SOUND,
	CHAINHOOK_LATCH_SOUND,
	SNATCHER_SNATCH_SOUND,
	SNATCHER_SWALLOW_SOUND,
	PELLET_RETURN_SOUND,
	PYRE_LIGHT_SOUND,
];
