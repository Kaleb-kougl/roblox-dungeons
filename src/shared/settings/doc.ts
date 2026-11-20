/**
 * The stored settings document (one DataStore value per player, SettingsService) and the remotes' payload: every
 * settings group, overrides-only (what the player changed; absent = the defaults).
 *
 *   juice     JuiceOverrides     (juice.ts: health bars, damage numbers, freeze frame, screen shake, particles, reduced
 *                                motion)
 *   controls  ControlsOverrides  (shared/play bindings.ts: the key bindings that differ from DEFAULT_BINDINGS)
 *   audio     AudioOverrides     (audio.ts: master / music / sfx volume)
 *   display   DisplayOverrides   (display.ts: HUD scale, room edges, HUD fade, minimap)
 *
 * Versions: v1 (task 8 / 9) was `{ v: 1, juice }`; v2 (task L4) is `{ v: 2, juice, controls, audio, display }`. A v1
 * document MIGRATES on read (its juice is kept, the new groups start empty) and is written back as v2 the next time
 * it is saved (only when something changed: a clean migrated document is not rewritten). Any other version (a newer
 * server's document, garbage) reads as no overrides, as before.
 *
 * Patches (`updateSettings`): every group PRESENT in a patch replaces that group (sanitized); absent groups are kept.
 * The client always sends a whole group (its optimistic copy after the change), so a group's reset is `{ juice: {} }`.
 *
 * @module
 */
import { KBM_ACTIONS, PAD_ACTIONS, sanitizeControlsOverrides, type ControlsOverrides } from "shared/play";
import { AUDIO_SETTING_KEYS, sameAudioOverrides, sanitizeAudioOverrides, type AudioOverrides } from "./audio";
import { DISPLAY_SETTING_KEYS, sameDisplayOverrides, sanitizeDisplayOverrides, type DisplayOverrides } from "./display";
import { JUICE_SETTING_KEYS, sameJuiceOverrides, sanitizeJuiceOverrides, type JuiceOverrides } from "./juice";

/** Bump when the document's shape changes (decodeSettingsDoc migrates the versions it knows). */
export const SETTINGS_DOC_VERSION = 2;
/** The task-8 document: `{ v: 1, juice }`. */
export const SETTINGS_DOC_V1 = 1;

export type SettingsGroup = "juice" | "controls" | "audio" | "display";
export const SETTINGS_GROUPS: ReadonlyArray<SettingsGroup> = ["juice", "controls", "audio", "display"];

/** Every group a player changed (empty groups are left out). The remotes' payload and the session cache's document. */
export interface SettingsOverrides {
	juice?: JuiceOverrides;
	controls?: ControlsOverrides;
	audio?: AudioOverrides;
	display?: DisplayOverrides;
}

export interface SettingsDoc {
	v: number;
	juice: JuiceOverrides;
	controls: ControlsOverrides;
	audio: AudioOverrides;
	display: DisplayOverrides;
}

/** The keys each group's sanitized form can hold (an empty group has none of them). */
const GROUP_KEYS: { readonly [G in SettingsGroup]: ReadonlyArray<string> } = {
	juice: JUICE_SETTING_KEYS,
	controls: ["kbm", "pad"],
	audio: AUDIO_SETTING_KEYS,
	display: DISPLAY_SETTING_KEYS,
};

function isEmptyGroup(group: SettingsGroup, t: object): boolean {
	const r = t as Record<string, unknown>;
	for (const k of GROUP_KEYS[group]) if (r[k] !== undefined) return false;
	return true;
}

function sanitizeGroup(group: SettingsGroup, raw: unknown): object {
	if (group === "juice") return sanitizeJuiceOverrides(raw);
	if (group === "controls") return sanitizeControlsOverrides(raw);
	if (group === "audio") return sanitizeAudioOverrides(raw);
	return sanitizeDisplayOverrides(raw);
}

/**
 * Overrides from an untrusted value (a remote's argument, a stored group set): every known group sanitized, empty
 * groups and unknown keys dropped. Never throws.
 */
export function sanitizeSettingsOverrides(raw: unknown): SettingsOverrides {
	const out: SettingsOverrides = {};
	if (!typeIs(raw, "table")) return out;
	const t = raw as Record<string, unknown>;
	for (const group of SETTINGS_GROUPS) {
		const clean = sanitizeGroup(group, t[group]);
		if (!isEmptyGroup(group, clean)) (out as Record<string, unknown>)[group] = clean;
	}
	return out;
}

/**
 * A patch's wire form: every group PRESENT in `raw` sanitized and kept, even when it sanitizes to {} (an empty group
 * in a patch clears that group). Unknown groups are dropped. Never throws.
 */
export function sanitizeSettingsPatch(raw: unknown): SettingsOverrides {
	const out: Record<string, unknown> = {};
	if (!typeIs(raw, "table")) return out;
	const p = raw as Record<string, unknown>;
	for (const group of SETTINGS_GROUPS) {
		if (p[group] !== undefined) out[group] = sanitizeGroup(group, p[group]);
	}
	return out;
}

/** `current` with every group present in `patch` replaced by its sanitized value (an empty group clears it). */
export function applySettingsPatch(current: Readonly<SettingsOverrides>, patch: unknown): SettingsOverrides {
	const out = sanitizeSettingsOverrides(current) as Record<string, unknown>;
	const clean = sanitizeSettingsPatch(patch) as Record<string, object | undefined>;
	for (const group of SETTINGS_GROUPS) {
		const value = clean[group];
		if (value === undefined) continue;
		out[group] = isEmptyGroup(group, value) ? undefined : value;
	}
	return out as SettingsOverrides;
}

function sameKbmSlots(a: ReadonlyArray<string> | undefined, b: ReadonlyArray<string> | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return a.size() === b.size() && a[0] === b[0] && a[1] === b[1];
}

/** True when two controls overrides hold the same actions and inputs. */
export function sameControlsOverrides(a: Readonly<ControlsOverrides>, b: Readonly<ControlsOverrides>): boolean {
	for (const action of KBM_ACTIONS) if (!sameKbmSlots(a.kbm?.[action], b.kbm?.[action])) return false;
	for (const action of PAD_ACTIONS) if (a.pad?.[action] !== b.pad?.[action]) return false;
	return true;
}

const NONE = {};

/** True when two override sets are equal group by group (an absent group equals an empty one). */
export function sameSettingsOverrides(a: Readonly<SettingsOverrides>, b: Readonly<SettingsOverrides>): boolean {
	return (
		sameJuiceOverrides(a.juice ?? NONE, b.juice ?? NONE) &&
		sameControlsOverrides(a.controls ?? NONE, b.controls ?? NONE) &&
		sameAudioOverrides(a.audio ?? NONE, b.audio ?? NONE) &&
		sameDisplayOverrides(a.display ?? NONE, b.display ?? NONE)
	);
}

/**
 * `fresh` with every group that equals `prev`'s replaced by `prev`'s object (and `prev` itself when nothing changed),
 * so memoized readers of one group (the client's selectBindings, selectJuice, ...) only update when that group did.
 */
export function reuseSameGroups(prev: SettingsOverrides, fresh: SettingsOverrides): SettingsOverrides {
	if (sameSettingsOverrides(prev, fresh)) return prev;
	const out: SettingsOverrides = { ...fresh };
	if (prev.juice && fresh.juice && sameJuiceOverrides(prev.juice, fresh.juice)) out.juice = prev.juice;
	if (prev.controls && fresh.controls && sameControlsOverrides(prev.controls, fresh.controls)) {
		out.controls = prev.controls;
	}
	if (prev.audio && fresh.audio && sameAudioOverrides(prev.audio, fresh.audio)) out.audio = prev.audio;
	if (prev.display && fresh.display && sameDisplayOverrides(prev.display, fresh.display)) out.display = prev.display;
	return out;
}

/** The stored form (always the current version; every group present, sanitized). */
export function encodeSettingsDoc(overrides: Readonly<SettingsOverrides>): SettingsDoc {
	const clean = sanitizeSettingsOverrides(overrides);
	return {
		v: SETTINGS_DOC_VERSION,
		juice: clean.juice ?? {},
		controls: clean.controls ?? {},
		audio: clean.audio ?? {},
		display: clean.display ?? {},
	};
}

/**
 * Overrides from a stored value: v2 as is (sanitized), v1 migrated (its juice kept), anything missing, of another
 * version or malformed as no overrides. Never throws.
 */
export function decodeSettingsDoc(raw: unknown): SettingsOverrides {
	if (!typeIs(raw, "table")) return {};
	const doc = raw as { v?: unknown; juice?: unknown };
	if (doc.v === SETTINGS_DOC_V1) return sanitizeSettingsOverrides({ juice: doc.juice });
	if (doc.v !== SETTINGS_DOC_VERSION) return {};
	return sanitizeSettingsOverrides(raw);
}
