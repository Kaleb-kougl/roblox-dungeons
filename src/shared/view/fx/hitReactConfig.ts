/**
 * Hit reaction tunables (docs/FEEL.md section 5, tasks J4 / J5): the rim flash, the sprite hold and the view-only push
 * an enemy shows when a hit lands (hitReact.ts). Times are seconds of the hit-reaction clock (real frame time, stopped
 * while the run is paused, NOT slowed by the hitstop clock, so a kill's hold lines up with the global freeze in solo).
 * Kill holds reuse the freeze-frame lengths (freezeRules.ts KILL_FREEZE_MS / HEAVY_KILL_FREEZE_MS /
 * BOSS_DEATH_FREEZE_MS); they are not repeated here. Presentation only: nothing here reaches the sim (JD1, JD2).
 *
 * @module
 */
import { PIXELS_PER_TILE, STUDS_PER_TILE } from "shared/config";
import type { ColorRole } from "shared/theme";

export const FEEL_HIT = {
	/** The rim flash lasts this long after a hit (s). */
	flashSec: 0.07,
	/** At most one rim flash start per actor per this long (s): a bow stream blinks, it never strobes solid. */
	minSec: 0.12,
	/** A landed (uncapped) hit holds the actor's sprite frame this long (s). Kills hold for their freeze length. */
	holdSec: 0.04,
	/** Push of a regular hit, whole render texels away from the nearest living player (JD2, JD4). */
	pushTexels: 1,
	/** Push of a heavy hit (FxEvent.heavy: sword finisher, heavy arrow). */
	heavyPushTexels: 2,
	/** The push stays at full strength this long (s) ... */
	pushHoldSec: 0.04,
	/** ... then eases back to 0 over this long (s), rounded to whole texels on each axis. */
	easeSec: 0.1,
	/** Studs per render texel (the camera's snap grid unit): the push's unit. */
	texelStuds: STUDS_PER_TILE / PIXELS_PER_TILE,
	/** Flash colour (JD6: no theme contract change; the health bar flash's role). */
	flashRole: "uiText" as ColorRole,
	/** Longest frame step the hit-reaction clock takes (s): a hitch never skips a whole flash. */
	maxFrameDtSec: 0.05,
	/**
	 * Placeholder bodies (J5): a flashing actor's pieces move to this Model, a sibling of the enemies Model under the
	 * actors folder, whose ONE Highlight fills them with flashRole (the game draws 2 Highlights at most).
	 */
	flashingGroupName: "Flashing",
	flashingHighlightName: "HitFlash",
	/** The flashing Highlight's fill (0 = solid flash colour, 1 = none). Its rim is the enemies Highlight's. */
	fillTransparency: 0.4,
} as const;
