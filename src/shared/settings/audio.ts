/**
 * Audio settings (Options screen, task L4): master, music and sound-effect volume as whole percents. Presentation
 * only. The client's AudioController multiplies them into the SoundService SoundGroups (shared/view/audio
 * soundGroupVolume). Stored overrides-only, like the juice settings.
 */
import { VOLUME_PERCENT } from "./config";

export interface AudioSettings {
	/** Everything (both SoundGroups). */
	master: number;
	/** The `music` SoundGroup. */
	music: number;
	/** The `sfx` SoundGroup (sound effects and menu sounds). */
	sfx: number;
}

/** What a player changed (absent keys follow the defaults). */
export type AudioOverrides = Partial<AudioSettings>;

export const AUDIO_SETTING_KEYS: ReadonlyArray<keyof AudioSettings> = ["master", "music", "sfx"];

export function defaultAudioSettings(): AudioSettings {
	return { master: VOLUME_PERCENT.default, music: VOLUME_PERCENT.default, sfx: VOLUME_PERCENT.default };
}

/** True for a whole percent in VOLUME_PERCENT's range. */
export function isVolumePercent(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v % 1 === 0 && v >= VOLUME_PERCENT.min && v <= VOLUME_PERCENT.max;
}

/** Keeps only known keys with valid volumes (whole percents 0..100), minus values equal to the default. Never throws. */
export function sanitizeAudioOverrides(raw: unknown): AudioOverrides {
	const out: AudioOverrides = {};
	if (!typeIs(raw, "table")) return out;
	const t = raw as Record<string, unknown>;
	const defaults = defaultAudioSettings();
	for (const k of AUDIO_SETTING_KEYS) {
		const v = t[k];
		if (isVolumePercent(v) && v !== defaults[k]) out[k] = v;
	}
	return out;
}

/** The volumes a client uses: overrides on top of the defaults. */
export function resolveAudioSettings(overrides: unknown): AudioSettings {
	return { ...defaultAudioSettings(), ...sanitizeAudioOverrides(overrides) };
}

export function sameAudioOverrides(a: Readonly<AudioOverrides>, b: Readonly<AudioOverrides>): boolean {
	for (const k of AUDIO_SETTING_KEYS) if (a[k] !== b[k]) return false;
	return true;
}

/** `current` one step up (+1) or down (-1), clamped to the range. */
export function stepVolume(current: number, direction: 1 | -1): number {
	const stepped = current + direction * VOLUME_PERCENT.step;
	return math.clamp(stepped, VOLUME_PERCENT.min, VOLUME_PERCENT.max);
}
