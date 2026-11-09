/**
 * Audio mixing tunables (the client's AudioController). Presentation only. Per-sound volume comes from the theme
 * manifest (`{ kind: "sound", assetId, volume }`); these scale it per SoundGroup and overall, cap the starts per
 * frame, quieten teammates, duck the music and set the ambience level.
 */
import type { AudioSettings } from "shared/settings";
import type { SoundGroupName } from "shared/theme";

/** Settings volumes are whole percents. */
const PERCENT = 100;

export const AUDIO_VIEW = {
	/** Master volume, multiplied into both SoundGroups (0..1). */
	masterVolume: 1,
	/** Per-group volume before the master (SoundService.<group>.Volume = group * master). */
	groupVolume: { sfx: 1, music: 0.6 } as Readonly<Record<SoundGroupName, number>>,
	/** Pooled Sound instances per sound ID (round-robin; a busy pool restarts its oldest voice). */
	voicesPerSfx: 4,
	/** Music cross-fade, seconds (fade out the old track, fade in the new one). */
	musicFadeSec: 0.75,
	/** Folder (under SoundService) holding the pooled Sounds. */
	folderName: "KV_Audio",
	/** Most sound starts per rendered frame; a busier frame keeps the highest SFX_PRIORITY (cues.ts). */
	maxStartsPerFrame: 6,
	/** Co-op (docs/FX_AUDIO.md X4): a teammate's hurt / death / roll / flask / swing, times the sound's volume. */
	teammateVolume: 0.4,
	/** Seed of the PlaybackSpeed jitter generator (voices.ts PitchJitter; presentation only). */
	pitchSeed: 1,
	/**
	 * Repetitive sounds (voices.ts PitchVariance): a start never lands within this fraction of the sound's pitch range
	 * of the same ID's previous start (0.25 of [0.95, 1.05]: at least 0.025 PlaybackSpeed apart). 0 = plain jitter;
	 * at most 0.49.
	 */
	pitchRepeatGap: 0.25,
	/**
	 * The music dips to `level` (of its volume) while a DUCKING_SFX sound plays (jingles, the Ember), falling in
	 * attackSec and coming back in releaseSec. A clip whose length is not known yet holds it for holdSec.
	 */
	duck: { level: 0.4, attackSec: 0.08, releaseSec: 0.6, holdSec: 1.5 },
	/** Ambience beds (amb.b<n>, through the sfx SoundGroup, X5): their volume times this, and their cross-fade. */
	ambientVolume: 0.35,
	ambientFadeSec: 1.5,
	/**
	 * docs/STAGE_ASSETS.md SAD14: a music or ambience bed whose sound had not downloaded when it was wanted starts the
	 * moment it lands (if it is still the wanted bed), fading in over this many seconds instead of its cross-fade.
	 */
	lateBedFadeSec: 1.2,
} as const;

/**
 * A SoundGroup's Volume for the player's audio settings (shared/settings audio.ts, whole percents):
 * AUDIO_VIEW.groupVolume[group] x AUDIO_VIEW.masterVolume x master % x the group's own % (music / sfx).
 */
export function soundGroupVolume(group: SoundGroupName, audio: Readonly<AudioSettings>): number {
	const own = group === "music" ? audio.music : audio.sfx;
	return (AUDIO_VIEW.groupVolume[group] * AUDIO_VIEW.masterVolume * audio.master * own) / (PERCENT * PERCENT);
}
