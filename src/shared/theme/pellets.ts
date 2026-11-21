/**
 * Roblox port (docs/PELLETS.md PL6): the theme's pellet keys: the two pellet kinds (asset and colour role IDs), the
 * three sounds, the results / room clear / first-sighting strings. Pure data with no runtime import, like builds.ts:
 * contract.ts and validate.ts sit near Luau's 200-locals-per-function limit, so none of these lists is imported there:
 * contract.ts names the same IDs inline inside its existing lists (REQUIRED_ASSET_IDS, PORT_AUDIO_EVENTS,
 * ROOM_CLEAR_STRING_KEYS) and holds the PELLET slot; pellets.spec.ts checks they agree. The colour rules and
 * `pelletReport` are in pelletColors.ts, folded into variantColors.ts' problems (validate.ts takes no new name).
 *
 * Asset IDs need two segments (validate.ts isAssetId), so the plan's `pellet` is `pellet.normal`; each kind's colour
 * role has the same ID as its asset (like `boost.<kind>`).
 *
 * The contract lists named above:
 * {@link shared/theme/contract/ids!PORT_AUDIO_EVENTS | PORT_AUDIO_EVENTS},
 * {@link shared/theme/contract/ids!REQUIRED_ASSET_IDS | REQUIRED_ASSET_IDS}.
 *
 * @module
 */

import type { ColorRole } from "./types";

/** The pellet kinds: the room's ordinary pellet and the rare power pellet (docs/PELLETS.md PD4). */
export const PELLET_KINDS = ["normal", "power"] as const;
/**
 * A pellet kind's name (a PELLET_KINDS entry): the segment after `pellet.` in the kind's asset and colour role ID, and
 * the key renderers ask the pack for a pellet's look by.
 */
export type PelletKind = (typeof PELLET_KINDS)[number];

/** Asset (and colour role) ID of a pellet kind: `pellet.normal`, `pellet.power`. */
export function pelletId(kind: PelletKind): `pellet.${PelletKind}` {
	return `pellet.${kind}`;
}

/** Is `id` a pellet's asset ID (`pellet.<kind>` for a PELLET_KINDS entry)? */
export function isPelletId(id: string): id is `pellet.${PelletKind}` {
	return id === "pellet.normal" || id === "pellet.power";
}

/**
 * Every pellet asset ID (PELLET_KINDS order), all REQUIRED (a pellet is a gameplay object): world art (`image` with
 * `pixelsPerTile`, or `sprites` with `idle`) or the placeholder, a small Block cube in its colour role.
 */
export const PELLET_IDS: ReadonlyArray<string> = ["pellet.normal", "pellet.power"];

/**
 * One colour per pellet kind (PELLET_KINDS order), the placeholder cube's colour and the tint of the vale art (white /
 * grey pixels). Held to PELLET_COLOR_RULES by `pelletReport` (pelletColors.ts): a pellet reads on every floor and never
 * as a bullet, a telegraph, a boost, a build effect or the player's outline.
 */
export const PELLET_ROLES: ReadonlyArray<ColorRole> = ["pellet.normal", "pellet.power"];

/**
 * The pellet sounds (port audio IDs, SILENT in the placeholder), in PORT_AUDIO_EVENTS: a pellet eaten (the chomp: the
 * cue mapper alternates two pitches, minInterval in the clip), a room swept, the power pellet taken.
 */
export const PELLET_AUDIO_IDS: ReadonlyArray<string> = ["sfx.pellet.eat", "sfx.pellet.sweep", "sfx.pellet.power"];

/**
 * The run-over breakdown's two source rows (`score.source.<name>`, shared/sim PELLET_SCORE_SOURCE_NAMES `pellets` /
 * `sweep`; pellet points include the power pellet's bullets). Like `score.source.jackpot`, not in REQUIRED_STRING_KEYS:
 * shared/view/hud SCORE_SOURCE_KEYS lists them and hud.spec.ts checks they exist.
 */
export const PELLET_SCORE_SOURCE_KEYS: ReadonlyArray<string> = ["score.source.pellets", "score.source.sweep"];

/**
 * The room clear tally's two segments (`{points}`), in ROOM_CLEAR_STRING_KEYS: the pellet points earned in the room
 * (shown like Kills) and the Sweep bonus (shown like Clear / No hits / Speed, with a `+`).
 */
export const PELLET_ROOM_CLEAR_KEYS: ReadonlyArray<string> = ["room.clear.line.pellets", "room.clear.line.sweep"];

/** The power pellet's first-sighting toast (shared/onboarding sighting id `pellet.power`), in BESTIARY_STRING_KEYS. */
export const PELLET_BESTIARY_KEY = "bestiary.pellet.power";

/**
 * The tutorial's pellet lesson prompts (shared/tutorial `tutorial.prompt.<prompt>.<device>`): step `pellets`' prompt and
 * its hold prompt (shown while the sweep lock holds the sniper). Not required by the contract: the tutorial's specs
 * check every prompt of TUTORIAL_STEPS exists.
 */
export const PELLET_TUTORIAL_PROMPTS: ReadonlyArray<string> = ["pellets", "pelletsHold"];
