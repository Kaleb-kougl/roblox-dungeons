/**
 * The vault's sound edges (docs/TREASURE.md TR8): when the cue mapper (shared/view/audio AudioCueMapper) plays the
 * crack, the unlock's rattle, the open's sting and a Legendary's jingle. They follow the LOOK's timing, not the sim's
 * ticks, so each sound lands on what the player sees: the crack on its frame (the plate shatters), the rattle when the
 * bars start to sink (TREASURE_VIEW.unlock.delaySec, 0.6 s after the clear: the room clear's stamp has landed), the
 * sting and the jingle on the lid's pop (TREASURE_VIEW.open.popSec, 0.25 s after the open's tick). TreasureCueTracker
 * runs its own TreasureViewTracker (the same pure look TreasureRenderController draws, from the same RunView.treasure
 * and sim clock), so the audio never depends on the order the client's render steps run in. A vault met mid-way, or
 * whose events were missed, is silent (the look's edges never fire for it). Pure, tested headlessly.
 */
import type { SimState } from "shared/sim";
import type { TreasureFrameSource } from "./events";
import { TreasureViewTracker, type TreasureLookSettings } from "./vault";

/** No tier opened this frame (TreasureCueSource.openTier). */
export const NO_TREASURE_OPEN = -1;

/** A frame's vault sound edges (what the cue mapper reads). */
export interface TreasureCueSource {
	/** The lock cracked this frame (sfx.treasure.crack). */
	readonly crack: boolean;
	/** The cage's bars started to go this frame (sfx.treasure.unlock). */
	readonly unlock: boolean;
	/** The lid popped this frame: the opened VaultTier (sfx.treasure.open pitched by it; Legendary: the jingle), else NO_TREASURE_OPEN. */
	readonly openTier: number;
}

/** No vault sounds (the mapper's default: every frame without a vault). */
export const NO_TREASURE_CUES: TreasureCueSource = table.freeze({
	crack: false,
	unlock: false,
	openTier: NO_TREASURE_OPEN,
});

/** The edges do not depend on the motion / particle settings; the look is computed with these. */
const CUE_LOOK_SETTINGS: TreasureLookSettings = { reducedMotion: false, particles: true };

/** See the file comment. */
export class TreasureCueTracker implements TreasureCueSource {
	private readonly view = new TreasureViewTracker();
	crack = false;
	unlock = false;
	openTier = NO_TREASURE_OPEN;

	/** Forget the vault (run start, floor change, run exit). */
	reset(): void {
		this.view.reset();
		this.clearEdges();
	}

	/** Nothing this frame (no run). */
	clearEdges(): void {
		this.crack = false;
		this.unlock = false;
		this.openTier = NO_TREASURE_OPEN;
	}

	/**
	 * One rendered frame: `state` after the frame's ticks, `frame` its vault events (RunView.treasure), `simSec` the
	 * views' sim clock ((tick + alpha) / SIM_HZ). Returns this (the frame's edges).
	 */
	update(state: Readonly<SimState>, frame: TreasureFrameSource, simSec: number): TreasureCueSource {
		const look = this.view.update(state, frame, simSec, CUE_LOOK_SETTINGS);
		this.crack = look.present && look.crackEdge;
		this.unlock = look.present && look.unlockEdge;
		this.openTier = look.present && look.popEdge ? look.opened?.tier ?? look.tier : NO_TREASURE_OPEN;
		return this;
	}
}
