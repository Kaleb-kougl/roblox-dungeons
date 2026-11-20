/**
 * Roblox port (docs/FORTUNE.md FO6): the theme's Fortune keys, for the pacts' and the Goldling's views (FO7 / FO8) and
 * the cue mapper (FO9): the pact altar (asset ID and slot), the colour roles, the eight sounds (and the Goldling's two
 * rumours, docs/GOLDLING_RUMOURS.md GR6), the optional coin effect and every string. Data only, like pellets.ts: contract.ts and validate.ts sit near Luau's 200-locals-per-function
 * limit, so neither imports this module: contract.ts names the same IDs inline inside its existing lists (SLOTS,
 * REQUIRED_ASSET_IDS, PORT_AUDIO_EVENTS, FX_IDS, ROOM_CLEAR_STRING_KEYS, REQUIRED_STRING_KEYS) and fortune.spec.ts checks
 * they agree. The colour rules and `fortuneReport` are in fortuneColors.ts, folded into variantColors.ts' problems
 * (validate.ts takes no new name).
 *
 * The Goldling's own asset, colour role and name (`enemy.golden`, `enemy.golden.name`) are the enemy slot's
 * (contract.ts ENEMY_ARCHETYPES); its first-sighting line `bestiary.golden` is variants.ts BESTIARY_STRING_KEYS'.
 *
 * @module
 */

import { slotFor, type SlotContract } from "./contract";
import type { ColorRole } from "./types";

/**
 * The pact altar (docs/FORTUNE.md FD1: two stand in an endless shrine room, Greed and the Horde, both drawn with this
 * one asset). REQUIRED (a gameplay object): world art (`image` with `pixelsPerTile`, or `sprites` with `idle`) or the
 * placeholder, a stone plinth (placeholders.ts). The pact it offers is told by its card and flame in the pact's role.
 */
export const PACT_ALTAR_ID = "pact.altar";

/**
 * The PACT slot (`pact.`), held inline in contract.ts SLOTS (one named constant there would be one more top-level Luau
 * local) and found here by its prefix, so code and specs can name it like PELLET.
 */
export const PACT: SlotContract = slotFor(PACT_ALTAR_ID) as SlotContract;

/** Is `id` the pact slot's one asset ID? */
export function isPactId(id: string): boolean {
	return id === PACT_ALTAR_ID;
}

/** A Horde room's edge colour: its room edges flash it when the Horde room is entered (docs/FORTUNE.md, Horde). */
export const ROOM_EDGE_HORDE_ROLE: ColorRole = "roomEdge.horde";

/**
 * One colour per pact (shared/sim PactKind order: GREED 0, HORDE 1): the altar's floor card title, its flame and the
 * chip / shout / score pops of an armed or live Horde.
 */
export const PACT_ROLES: ReadonlyArray<ColorRole> = ["pact.greed", "pact.horde"];

/** The Goldling's coins: the burst on every hit, the `+50` pop and the catch's fountain (the coin effect's tint). */
export const GOLDEN_COIN_ROLE: ColorRole = "golden.coin";

/** Every Fortune colour role (COLOR_ROLES' last four), in order: held to FORTUNE_COLOR_RULES by fortuneReport. */
export const FORTUNE_ROLES: ReadonlyArray<ColorRole> = ["roomEdge.horde", "pact.greed", "pact.horde", "golden.coin"];

/**
 * The Goldling's optional coin burst (an FX_IDS entry: one-facing `sprites` with `play`, at most FX_SPRITE_MAX_TILES,
 * its tint role `golden.coin` held to the fx rule). Absent: nothing drawn but the view's own coins.
 */
export const GOLDEN_COIN_FX_ID = "fx.golden.coin";

/**
 * Fortune's sounds (port audio IDs in PORT_AUDIO_EVENTS, required, SILENT in the placeholder): a pact taken; the Horde's
 * horn (its room entered), its second wave, the x2 landing in the tally; the Goldling appearing, each hit, the jackpot of
 * a catch, its escape. While one is silent it falls back to an existing clip (shared/view/audio SFX_FALLBACK).
 */
export const FORTUNE_AUDIO_IDS: ReadonlyArray<string> = [
	"sfx.pact.take",
	"sfx.horde.horn",
	"sfx.horde.wave",
	"sfx.horde.double",
	"sfx.golden.appear",
	"sfx.golden.hit",
	"sfx.golden.jackpot",
	"sfx.golden.escape",
];

/**
 * The Goldling's rumours (docs/GOLDLING_RUMOURS.md GR6; port audio IDs appended to PORT_AUDIO_EVENTS after
 * FORTUNE_AUDIO_IDS, required, SILENT in the placeholder): the floor rumour (a soft, muffled coin jingle once per floor
 * with a hidden Goldling) and the room rumour (the same jingle, closer and brighter, when its room engages). Plain sfx
 * (no music duck, not a jingle). While silent each falls back to sfx.score.tick (shared/view/audio SFX_FALLBACK).
 */
export const GOLDEN_RUMOUR_AUDIO_IDS: ReadonlyArray<string> = ["sfx.golden.rumour.floor", "sfx.golden.rumour.room"];

/**
 * The line a dimmed altar shows, one per shared/sim PACT_DIM_NAMES entry but `none` (`pact.dim.<name>`, PactDim
 * order: taken, noCurse, noLegendary, noRoom, unable).
 */
export const PACT_DIM_STRING_KEYS: ReadonlyArray<string> = [
	"pact.dim.taken",
	"pact.dim.noCurse",
	"pact.dim.noLegendary",
	"pact.dim.noRoom",
	"pact.dim.unable",
];

/** A dimmed altar's line for a shared/sim PACT_DIM_NAMES name (`pact.dim.<name>`; `none` has no line). */
export function pactDimStringKey(name: string): string {
	return `pact.dim.${name}`;
}

/**
 * Every Fortune string a pack must define (in REQUIRED_STRING_KEYS, written out there): the Greed and Horde altar cards
 * (title, Take: `{curse}`, Gain), the accept line (`{key}`), the dim lines (PACT_DIM_STRING_KEYS), the Greed deal's
 * draft title, the status corner's Horde chip, the Horde's floor shouts (x2, the second wave), the Goldling's floor
 * shout and its escape line (`{points}` banked); then (docs/FORTUNE.md FO7) a Horde room kill's score pop (`{points}`
 * with the x2 mark).
 */
export const FORTUNE_STRING_KEYS: ReadonlyArray<string> = [
	"pact.greed.title",
	"pact.greed.take",
	"pact.greed.gain",
	"pact.horde.title",
	"pact.horde.take",
	"pact.horde.gain",
	"pact.accept",
	"pact.dim.taken",
	"pact.dim.noCurse",
	"pact.dim.noLegendary",
	"pact.dim.noRoom",
	"pact.dim.unable",
	"hud.draft.title.greed",
	"hud.chip.horde",
	"fx.horde.shout",
	"fx.horde.wave",
	"fx.golden.shout",
	"fx.golden.escaped",
	"hud.score.pop.horde",
];

/** The room clear tally's last segment in a Horde room (`{points}`: the doubled half), in ROOM_CLEAR_STRING_KEYS. */
export const HORDE_ROOM_CLEAR_KEY = "room.clear.line.horde";

/**
 * The run-over breakdown's two source rows (`score.source.<name>`, shared/sim PACT_SCORE_SOURCE_NAMES `horde` (13) /
 * GOLDEN_SCORE_SOURCE_NAMES `golden` (14), after treasure's `treasure` (12)). Like the pellets' rows, not in REQUIRED_STRING_KEYS: shared/view/hud
 * SCORE_SOURCE_KEYS lists them and hud.spec.ts checks they exist.
 */
export const FORTUNE_SCORE_SOURCE_KEYS: ReadonlyArray<string> = ["score.source.horde", "score.source.golden"];

/** The Goldling's first-sighting toast (shared/onboarding sighting id `golden`), in BESTIARY_STRING_KEYS. */
export const GOLDEN_BESTIARY_KEY = "bestiary.golden";

/**
 * The Goldling rumour chip's two lines (docs/GOLDLING_RUMOURS.md GR7; required, in REQUIRED_STRING_KEYS after
 * FORTUNE_STRING_KEYS, written out there): the floor rumour ("Coins jingling...") and the room rumour ("It's hiding
 * here!").
 */
export const GOLDEN_RUMOUR_STRING_KEYS: ReadonlyArray<string> = ["hud.chip.golden.rumour", "hud.chip.golden.hiding"];

/**
 * The first Goldling rumour's first-time card (shared/onboarding sighting id `golden.rumour`), in BESTIARY_STRING_KEYS
 * (last).
 */
export const GOLDEN_RUMOUR_BESTIARY_KEY = "bestiary.golden.rumour";
