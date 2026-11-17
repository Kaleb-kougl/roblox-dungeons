/**
 * Roblox port (docs/NEW_ENEMIES_3.md NT1): the fourth endless set's theme keys, as lists the specs check against the
 * contract. Pure data with no runtime import, like newEnemies2.ts: contract.ts and validate.ts sit near Luau's
 * 200-locals-per-function limit, so contract.ts names the same archetypes and sounds inline inside its existing lists
 * (ENEMY_ARCHETYPES, PORT_AUDIO_EVENTS); newEnemies3.spec.ts checks they agree. The heal's colour rule and `healReport`
 * are in variantColors.ts (validate.ts takes no new name).
 *
 * The three first-sighting lines (`bestiary.<id>`) are in variants.ts BESTIARY_ARCHETYPES / BESTIARY_STRING_KEYS (the
 * archetypes' block, before the affixes: NE1's rule) with their shared/onboarding sighting ids (NTD13). No new bullet
 * visual (NTD12): the shell draws as the strike, the shrapnel the small look, the Mender's bolt (BulletKind.CASTER) the
 * medium one.
 */

import type { ColorRole } from "./types";

/** The three archetype slots, in contract.ts ENEMY_ARCHETYPES order (its last three): `enemy.<id>`, its role, `.name`. */
export const NEW_ENEMY_3_ARCHETYPES = ["mortar", "mender", "jackal"] as const;

/**
 * The Mender's heal colour: the beam from the Mender to its ally and the `+` sparks on the healed enemy (NT7). Never the
 * player's own heal (`fx.heal`) or Riposte's counter-wave (`build.counter`): held to variantColors.ts HEAL_COLOR_RULES
 * by `healReport`.
 */
export const ENEMY_HEAL_ROLE: ColorRole = "enemyHeal";

/** A Mortar's lob (falls back to sfx.enemy.hook, the Chainhook's throw). */
export const MORTAR_LOB_SOUND = "sfx.enemy.lob";
/** A Mortar's shell landing (falls back to sfx.enemy.blast, the Bomber's). */
export const MORTAR_SHELL_SOUND = "sfx.enemy.shell";
/** A Mender's heal pulse (no fallback: the beam carries it). */
export const MENDER_HEAL_SOUND = "sfx.enemy.heal";
/** A Mender's beam cut (falls back to sfx.enemy.block, the Shieldwall's block). */
export const MENDER_HEAL_CUT_SOUND = "sfx.enemy.healcut";
/** A Jackal's lunge (falls back to sfx.enemy.charge, the Charger's). */
export const JACKAL_LUNGE_SOUND = "sfx.enemy.lunge";
/** A Jackal spooked by the player's facing (no fallback). */
export const JACKAL_SPOOKED_SOUND = "sfx.enemy.spooked";

/**
 * The six sounds (port audio IDs, SILENT in the placeholder and in vale until NT10 picks clips), in PORT_AUDIO_EVENTS
 * after the third endless set's eight (its last ones). Until uploaded four fall back one step (shared/view/audio
 * SFX_FALLBACK); the heal pulse and the spook stay silent.
 */
export const NEW_ENEMY_3_AUDIO_IDS: ReadonlyArray<string> = [
	MORTAR_LOB_SOUND,
	MORTAR_SHELL_SOUND,
	MENDER_HEAL_SOUND,
	MENDER_HEAL_CUT_SOUND,
	JACKAL_LUNGE_SOUND,
	JACKAL_SPOOKED_SOUND,
];
