/**
 * Audio mixing tunables (the client's AudioController). Presentation only. Per-sound volume comes from the theme
 * manifest (`{ kind: "sound", assetId, volume }`); these scale it per SoundGroup and overall.
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
} as const;

/**
 * A SoundGroup's Volume for the player's audio settings (shared/settings audio.ts, whole percents):
 * AUDIO_VIEW.groupVolume[group] x AUDIO_VIEW.masterVolume x master % x the group's own % (music / sfx).
 */
export function soundGroupVolume(group: SoundGroupName, audio: Readonly<AudioSettings>): number {
	const own = group === "music" ? audio.music : audio.sfx;
	return (AUDIO_VIEW.groupVolume[group] * AUDIO_VIEW.masterVolume * audio.master * own) / (PERCENT * PERCENT);
}
