/**
 * The training dummy's sprite tunables (docs/DUMMY_ART.md). Presentation only: nothing here feeds `step()`.
 */
import { DUMMY } from "shared/sim";

export const DUMMY_SPRITE_VIEW = {
	/**
	 * Seconds the `hit` wobble plays over (DD1): the pack's 7 frames at its own 10 fps (preview.gif, 100 ms a frame).
	 * Timed on the view side (HitReactSlots.hitAge) because the sim's hit flash lasts only HIT_FLASH_TICKS (0.1 s);
	 * every new hit restarts it from the white frame.
	 */
	hitSec: 0.7,
} as const;

/**
 * Archetypes whose `hit` animation plays over a view-side clip of this many seconds after each hit, instead of over
 * the sim's hit flash (ActorSpriteInput.hitClip; ActorRenderController fills it from HitReactSlots.hitAge). Only the
 * training dummy: its hit is a long wobble, and it is the one target players hit on purpose and watch react.
 */
export const VIEW_HIT_CLIP_SEC: ReadonlyMap<string, number> = new Map([[DUMMY.id, DUMMY_SPRITE_VIEW.hitSec]]);
