/**
 * Roblox port (docs/SECRET_ROOMS.md SR10, Design 10): the theme's secret-room keys: the strings, the three sounds, the
 * dust's colour role and the optional art (the crack overlay, the rubble, the dust trickle). Pure data with no runtime
 * import, like treasure.ts: contract.ts and validate.ts sit near Luau's 200-locals-per-function limit, so contract.ts
 * names the same strings and sounds inline inside its existing lists (REQUIRED_STRING_KEYS, PORT_AUDIO_EVENTS, FX_IDS)
 * and holds the `secret` slot inline in SLOTS; secrets.spec.ts checks they agree. The colour rule and `secretReport`
 * are in secretColors.ts, the art rule (`secretArtProblems`) in secretArt.ts, both folded into variantColors.ts'
 * problems (validate.ts takes no new name).
 *
 * The first-time card's line `bestiary.secret.crack` is variants.ts BESTIARY_STRING_KEYS' last (shared/onboarding
 * sighting id `secret.crack`, the two lists kept equal by a spec); its Archer override `bestiary.secret.crack.archer`
 * is characters.ts CHARACTER_OVERRIDE_KEYS' last (optional, never required). The Codex entry's kind line, tab label
 * and codex-only description follow docs/CODEX.md's key scheme in codex.ts CODEX_STRING_KEYS (`codex.tab.secrets`,
 * `codex.kind.secret`, `codex.desc.secret.room`); its name is here (SECRET_CODEX_NAME_KEY).
 */

import type { ColorRole } from "./types";

/**
 * Every secret-room string a pack must define (REQUIRED_STRING_KEYS, its last ones after the Codex's), in order:
 *   - the floor shout at the opening (`fx.secret.text`, SECRET!: the combo shout's construction, ALL CAPS like
 *     `fx.parry.text`);
 *   - the co-op toast naming who opened it (`hud.toast.secret`, `{name}` the opener's display name, like
 *     `lobby.notice.followed`);
 *   - the chest's reward cards' title (`treasure.secret.title`, the vault's cards, titled `Secret cache`);
 *   - the run-over recap highlight's label (`run.recap.hl.secrets`; like every `run.recap.hl.*` label the count is
 *     drawn beside it);
 *   - the Codex entry's name (`secret.room.name`, the entry `secret:room`).
 */
export const SECRET_STRING_KEYS: ReadonlyArray<string> = [
	"fx.secret.text",
	"hud.toast.secret",
	"treasure.secret.title",
	"run.recap.hl.secrets",
	"secret.room.name",
];

/** The SECRET! floor shout (SECRET_STRING_KEYS). */
export const SECRET_SHOUT_KEY = "fx.secret.text";
/** The co-op toast `Secret found by {name}` (SECRET_STRING_KEYS). */
export const SECRET_TOAST_KEY = "hud.toast.secret";
/** The secret chest's reward cards' title (SECRET_STRING_KEYS). */
export const SECRET_CACHE_TITLE_KEY = "treasure.secret.title";
/** The recap highlight's label (SECRET_STRING_KEYS; shared/view/hud RECAP_HIGHLIGHTS lists the highlight, SR9). */
export const SECRET_RECAP_KEY = "run.recap.hl.secrets";
/** The Codex entry `secret:room`'s name (SECRET_STRING_KEYS). */
export const SECRET_CODEX_NAME_KEY = "secret.room.name";

/**
 * The first knock's first-time card (shared/onboarding sighting id `secret.crack`), in BESTIARY_STRING_KEYS (last):
 * the Knight's / default text names the finishing blow.
 */
export const SECRET_BESTIARY_KEY = "bestiary.secret.crack";
/**
 * The Archer's version of SECRET_BESTIARY_KEY (characters.ts characterOverrideKey(SECRET_BESTIARY_KEY, "archer")): it
 * names the charged arrow instead. Optional like every per-character override (CHARACTER_OVERRIDE_KEYS).
 */
export const SECRET_BESTIARY_ARCHER_KEY = "bestiary.secret.crack.archer";

/**
 * The run-over breakdown's source row (`score.source.<name>`, shared/sim's SECRET score source `secret`). Like
 * `score.source.treasure`, not in REQUIRED_STRING_KEYS: shared/view/hud SCORE_SOURCE_KEYS lists it (the view track,
 * once the sim has the source) and hud.spec.ts checks it exists; secrets.spec.ts checks both bundled packs have it.
 */
export const SECRET_SCORE_SOURCE_KEY = "score.source.secret";

/** A wrong-way hit on the crack: a hollow knock (falls back to sfx.breakable.hit while silent). */
export const SECRET_KNOCK_SOUND = "sfx.secret.knock";
/** The wall bursting open: a crumble (falls back to sfx.breakable.break while silent). */
export const SECRET_OPEN_SOUND = "sfx.secret.open";
/** The discovery jingle on the chamber's reveal (falls back to sfx.jingle.treasure while silent). */
export const SECRET_JINGLE_SOUND = "sfx.jingle.secret";

/**
 * The secret-room sounds (port audio IDs, SILENT in the placeholder and in vale until SR14 picks clips), in
 * PORT_AUDIO_EVENTS after the Codex's `sfx.codex.new`: knock, open, jingle. Until uploaded they fall back
 * (shared/view/audio SFX_FALLBACK, one step) to `sfx.breakable.hit` / `sfx.breakable.break` / `sfx.jingle.treasure`.
 */
export const SECRET_AUDIO_IDS: ReadonlyArray<string> = [SECRET_KNOCK_SOUND, SECRET_OPEN_SOUND, SECRET_JINGLE_SOUND];

/**
 * The dust's colour role: the trickle from the crack's joints, the knock's puff and the burst's dust (the view tints
 * `fx.secret.dust` and its particles with it). A pale dusty stone, held like the `decor.fx.*` roles (secretColors.ts
 * SECRET_COLOR_RULES: >= 40 CIE76 from the enemy-bullet roles and `telegraph`), so falling dust never reads as a
 * bullet or a warning.
 */
export const SECRET_DUST_ROLE: ColorRole = "secret.dust";
export const SECRET_ROLES: ReadonlyArray<ColorRole> = [SECRET_DUST_ROLE];

/**
 * The optional world art (slot `secret`, contract.ts SLOTS, inline): free-size world art like the vault's chest
 * (`image` with `pixelsPerTile`, or a one-facing `sprites` set with `idle`), drawn greyscale and tinted by the view
 * (the biome's wall colour, darkened). Absent: the view draws its fallback (the crack cells as the wall's own look with
 * a darker band and the dust; no rubble mesh). Any other `secret.` ID is an error.
 *   secret.crack   the crack overlay across a 2-cell wall face (its front face, and the top); a sprites set's `idle`
 *                  frames are its VARIANTS (SECRET_CRACK_VARIANTS in the vale art; the view picks one per crack and never
 *                  plays them; an image is one variant). Transparent background.
 *   secret.rubble  the 2 x 1 rubble pile left flat on the crack's cells after the open.
 */
export const SECRET_CRACK_ID = "secret.crack";
export const SECRET_RUBBLE_ID = "secret.rubble";
export const SECRET_ART_IDS: ReadonlyArray<string> = [SECRET_CRACK_ID, SECRET_RUBBLE_ID];
/** Every secret world art ID starts with this (the slot's prefix). */
export const SECRET_ART_PREFIX = "secret.";

/**
 * The dust trickle (an optional sprite effect in FX_IDS, like every `fx.*`): a short greyscale flipbook tinted by
 * SECRET_DUST_ROLE (the fx tint rule holds it to MIN_FX_BULLET_DIFFERENCE). Absent: the view's own particles.
 */
export const SECRET_DUST_FX_ID = "fx.secret.dust";

/** Is `id` one of SECRET_ART_IDS? */
export function isSecretArtId(id: string): boolean {
	return SECRET_ART_IDS.includes(id);
}
