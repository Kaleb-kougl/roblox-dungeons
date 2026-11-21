/**
 * The SYNC! floor callout, drawn (docs/RUN_RECAP.md CM5, B2). shared/view/fx SyncCallout decides WHEN it shows and
 * its pop / fade and tether; the client's SyncCalloutController paints it on the combo shout's construction (CD9: a
 * SurfaceGui on a thin floor Part under every bullet, COMBO_SHOUT's box, canvas, layer, cap and duck) with these small
 * pure pieces:
 *   - its label: `fx.parry.sync` ("SYNC!"), or `fx.parry.syncCount` ("SYNC x{n}") for three players or more;
 *   - how much of the shout's box its text fills: TEAM_MOMENTS_VIEW.callout.scale (smallScale for an untethered sync's
 *     text at each point) x the pop, never above the box; also the duck box's share (shoutBoxAt's sizeScale);
 *   - its opacity: parryFlashOpacity's rule (COMBO_SHOUT.maxOpacity x fade, never above the duck ceiling);
 *   - the tether's opacity: TEAM_MOMENTS_VIEW.tether.maxOpacity x its fade.
 * Presentation only.
 *
 * @module
 */
import { TEAM_MOMENTS_VIEW } from "shared/view/fx";
import type { ParryFlashStrings } from "./parryFlash";

/** The callout's theme strings (required: the contract's TEAM_MOMENT_STRING_KEYS). */
export const SYNC_CALLOUT_STRINGS = {
	/** "SYNC!" */
	sync: "fx.parry.sync",
	/** "SYNC x{n}": `n` = the players. */
	count: "fx.parry.syncCount",
} as const;

/** "SYNC!" for two players, "SYNC x3" for three or more. */
export function syncCalloutLabel(strings: ParryFlashStrings, count: number): string {
	if (count >= 3) return strings.str(SYNC_CALLOUT_STRINGS.count, { n: count });
	return strings.str(SYNC_CALLOUT_STRINGS.sync);
}

/** The share (0..1) of the shout's box the text fills: callout.scale (or smallScale: `small`) x `pop`, at most 1. */
export function syncCalloutSize(small: boolean, pop: number): number {
	const c = TEAM_MOMENTS_VIEW.callout;
	return math.clamp((small ? c.smallScale : c.scale) * pop, 0, 1);
}

/** The tether's opacity (0..tether.maxOpacity) for its fade factor (SyncCalloutLook.tetherFade). */
export function syncTetherOpacity(fade: number): number {
	return TEAM_MOMENTS_VIEW.tether.maxOpacity * math.clamp(fade, 0, 1);
}
