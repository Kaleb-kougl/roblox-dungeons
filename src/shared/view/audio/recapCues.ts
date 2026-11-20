/**
 * The run-over recap's sounds (docs/RUN_RECAP.md RR4, RRD9: no new sound, the room clear tally's): the recap
 * timeline's sound edges (shared/view/hud RecapTimeline's frame: `tick`, at most one a frame, and `lands`) become at
 * most ONE sound a frame through sfx.score.tick / sfx.score.land, quieter than the run-over jingle. Pure; the client's
 * RecapController forwards the edges here and plays what comes back (AudioController.play, so a silent ID falls back
 * like any other).
 *
 *   - A landing wins the frame: one sfx.score.land however many rows landed (a long frame lands two), and no tick.
 *   - Otherwise a counted value moved: one sfx.score.tick.
 *   - Nothing on the run-over frame itself (`jingleFrame`: the game-over / record jingle starts there, JINGLE_SFX);
 *     the timeline has no edge there anyway (the first row starts at 0.3 s), but a skip pressed on that frame lands on
 *     the next one.
 *   - Reduced motion: the timeline itself counts nothing and lands once at the end (RecapTimeline), so one land.
 * Ranked as in SFX_PRIORITY (land 60, tick 30: under every jingle), RECAP_AUDIO's volumes below the jingle's 1.
 *
 * @module
 */
import { SFX } from "./cues";

/** One recap timeline frame's sound edges (RecapFrame fits as is). */
export interface RecapSoundEdges {
	/** A counted value moved this frame. */
	readonly tick: boolean;
	/** Rows that landed this frame. */
	readonly lands: number;
}

/** One sound to play: its ID and the volume scale (AudioController.play's `scale`). */
export interface RecapCue {
	id: string;
	volume: number;
}

export const RECAP_AUDIO = {
	/** sfx.score.tick's volume scale on the recap (the room tally plays it at 1; the recap is a quieter count). */
	tickVolume: 0.6,
	/** sfx.score.land's volume scale (each row's landing). */
	landVolume: 0.85,
} as const;

/** The frame's recap sound, written into `out` (returned); undefined: none (see the file comment). */
export function recapCue(edges: RecapSoundEdges, jingleFrame: boolean, out: RecapCue): RecapCue | undefined {
	if (jingleFrame) return undefined;
	if (edges.lands > 0) {
		out.id = SFX.scoreLand;
		out.volume = RECAP_AUDIO.landVolume;
		return out;
	}
	if (edges.tick) {
		out.id = SFX.scoreTick;
		out.volume = RECAP_AUDIO.tickVolume;
		return out;
	}
	return undefined;
}
