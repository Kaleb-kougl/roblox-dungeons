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
 */

import type { ColorRole } from "./types";

/**
 * The builds HUD strings: an upgrade card's level line (`{level}`), the evolution and duo card banners, the boss double
 * draft's "Pick again" line, the evolve / duo toasts (`{boon}` / `{name}`, `{evo}`), the pause menu's Build list title.
 */
export const BUILD_STRING_KEYS: ReadonlyArray<string> = [
	"hud.draft.level",
	"hud.draft.evolve",
	"hud.draft.duo",
	"hud.draft.again",
	"hud.toast.evolved",
	"hud.toast.duo",
	"hud.build.title",
];

/** The evolution and duo cards' frames (held with the rarity ladder by boonRarityReport). */
export const BOON_BUILD_ROLES: ReadonlyArray<ColorRole> = ["boon.evolved", "boon.duo"];

/**
 * One colour per effect (docs/BUILDS.md BUD12): spark beams, Volatile's bolts, Soul Shards, embers. Held to
 * BUILD_COLOR_RULES by `buildReport` (buildColors.ts): a player effect must never read as danger.
 */
export const BUILD_EFFECT_ROLES: ReadonlyArray<ColorRole> = [
	"build.spark",
	"build.burst",
	"build.shard",
	"build.ember",
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

/** The build sounds (port audio IDs, SILENT in the placeholder), in PORT_AUDIO_EVENTS. */
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
];
