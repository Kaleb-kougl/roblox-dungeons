/**
 * Roblox port (docs/BUILDS.md BU1, "Theme contract"): the theme's builds keys: the draft / toast / build strings, the
 * evolved and duo card roles, the effect colour roles, the effect bullet visuals and the build sounds. Pure data with no
 * runtime import, like variants.ts. contract.ts and validate.ts sit at Luau's 200-locals-per-function limit, so none of
 * these lists is imported there: contract.ts names the same IDs inline inside its existing lists (BULLET_IDS,
 * PORT_AUDIO_EVENTS, REQUIRED_STRING_KEYS' function, BOON_RARITY_COLOR_RULES.roles) and builds.spec.ts checks they
 * agree; the colour rules and `buildReport` are in buildColors.ts, folded into variantColors.ts' problems.
 *
 * The per-boon and per-duo strings (`boon.<id>.desc.2`, `boon.<id>.evo.name` / `.evo.desc`, `duo.<id>.name` /
 * `.desc` / `.icon`) follow the sim's tables, so shared/view/hud progressionStringKeys lists them (hud.spec.ts checks
 * every one exists in the placeholder pack), as for every boon string.
 *
 * @module
 */

import type { ColorRole } from "./types";

/**
 * The builds HUD strings: an upgrade card's level line (`{level}`), the evolution and duo card banners, the boss double
 * draft's "Pick again" line, the evolve / duo toasts (`{boon}` / `{name}`, `{evo}`), the pause menu's Build list title.
 * Then Bastion's brace (docs/LEGENDARIES.md LG5): the toast for a pip restored, Stone Heart's heal toast and the floor
 * text (written in capitals in the string itself, like fx.parry.text; never upper-cased in code).
 * Then builds v2, wave 1 (docs/BUILDS_V2.md BV10): a New draft card's duo hint (`{duo}`, BV8), the floor texts of
 * Riposte's counter (`{n}`: the bullets the guard erased), Siege Bolt's pin and slam (capitals in the string, as above)
 * and Happy Hour's toast. The run-over row `score.source.overcap` (BV9) is a score-source string like
 * `score.source.jackpot`: checked by shared/view/hud SCORE_SOURCE_KEYS, not required here.
 */
export const BUILD_STRING_KEYS: ReadonlyArray<string> = [
	"hud.draft.level",
	"hud.draft.evolve",
	"hud.draft.duo",
	"hud.draft.again",
	"hud.toast.evolved",
	"hud.toast.duo",
	"hud.build.title",
	"hud.toast.brace",
	"hud.toast.braceHeal",
	"fx.brace.text",
	"hud.draft.duoHint",
	"fx.counter.text",
	"fx.pinned.text",
	"fx.slam.text",
	"hud.toast.happyHour",
];

/** The evolution and duo cards' frames (held with the rarity ladder by boonRarityReport). */
export const BOON_BUILD_ROLES: ReadonlyArray<ColorRole> = ["boon.evolved", "boon.duo"];

/**
 * One colour per effect (docs/BUILDS.md BUD12): spark beams, Volatile's bolts, Soul Shards, embers, then Overkill's
 * streak (docs/LEGENDARIES.md LG5; a colour role only, like the spark beam: no bullet visual), then Riposte's
 * counter-wave and the overcap points' gold pops (docs/BUILDS_V2.md BV10; colour roles only: Ballista's bolts are
 * BURST, the splinters and returns SHARD, BVD9). Held to BUILD_COLOR_RULES by `buildReport` (buildColors.ts): a player
 * effect must never read as danger; the overcap gold also never as the new-best gold (BUILD_APART_RULES).
 */
export const BUILD_EFFECT_ROLES: ReadonlyArray<ColorRole> = [
	"build.spark",
	"build.burst",
	"build.shard",
	"build.ember",
	"build.overkill",
	"build.counter",
	"build.overcap",
];

/** The effect bullets' visuals (sim BulletKind BURST / SHARD / EMBER / SPARK_BOLT), in BULLET_IDS. */
export const BUILD_BULLET_IDS: ReadonlyArray<string> = [
	"bullet.player.burst",
	"bullet.player.shard",
	"bullet.player.ember",
	"bullet.player.bolt",
];

/** The colour role each effect bullet visual is drawn in (BUILD_BULLET_IDS order). */
export const BUILD_BULLET_ROLES: ReadonlyArray<ColorRole> = [
	"build.burst",
	"build.shard",
	"build.ember",
	"build.spark",
];

/**
 * The build sounds (port audio IDs, SILENT in the placeholder), in PORT_AUDIO_EVENTS. The last two are the
 * legendaries' (docs/LEGENDARIES.md LG5): an Overkill streak and a Bastion brace; while silent they fall back to the
 * spark and the Aegis pip's break (shared/view/audio SFX_FALLBACK). Then builds v2, wave 1's five (docs/BUILDS_V2.md
 * BV10): Riposte's counter-wave, Siege Bolt's pin and slam, a Wrecker smash, Full Heart's beam; while silent they fall
 * back to the parry, the bow's full charge, a Charger's wall stun, the breakable break and the spark.
 */
export const BUILD_AUDIO_IDS: ReadonlyArray<string> = [
	"sfx.build.spark",
	"sfx.build.burst",
	"sfx.build.shard",
	"sfx.build.ember",
	"sfx.build.nova",
	"sfx.build.execute",
	"sfx.build.evolve",
	"sfx.build.duo",
	"sfx.build.jackpot",
	"sfx.build.overkill",
	"sfx.build.brace",
	"sfx.build.counter",
	"sfx.build.pin",
	"sfx.build.slam",
	"sfx.build.smash",
	"sfx.build.beam",
];
