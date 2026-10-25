/**
 * Juice settings schema (Roblox port of project-kaleb-vale src/fx/settings.ts @ 42897e2: types, defaults,
 * `sanitizeJuiceSettings`). Presentation only: nothing here reaches the sim, replays never depend on it.
 *
 * Port change: the web build stored the full settings in localStorage with `reducedMotion` defaulting to the OS
 * setting. Here the server stores only what the player CHANGED (`JuiceOverrides`, a sanitized partial) in a
 * DataStore, and the client resolves it against its own defaults (`resolveJuiceSettings`), where reducedMotion
 * defaults to the player's Roblox "Reduce Motion" setting (GuiService.ReducedMotionEnabled, readable on the client
 * only). "Reset" clears the overrides, which again means "follow the system", exactly like the web build's reset().
 */

export type HealthBarsMode = "always" | "onDamage" | "off";
export type ParticlesLevel = "off" | "low" | "normal" | "high";

export const HEALTH_BARS_MODES: ReadonlyArray<HealthBarsMode> = ["always", "onDamage", "off"];
export const PARTICLES_LEVELS: ReadonlyArray<ParticlesLevel> = ["off", "low", "normal", "high"];

export interface JuiceSettings {
	/** Enemy health bars: always, only for a while after a hit, or never. */
	healthBars: HealthBarsMode;
	/** Floating damage numbers on hits ("CAP" on capped boss hits). */
	damageNumbers: boolean;
	/** A few ms of hitstop on kills. Off under reducedMotion regardless. */
	freezeFrame: boolean;
	/** Death particle density. reducedMotion lowers it one step. */
	particles: ParticlesLevel;
	/** Less motion everywhere: no shake, no freeze, fewer particles, numbers fade in place. Default: the system. */
	reducedMotion: boolean;
}

/** What a player changed (stored per player; absent keys follow the defaults). */
export type JuiceOverrides = Partial<JuiceSettings>;

export const JUICE_SETTING_KEYS: ReadonlyArray<keyof JuiceSettings> = [
	"healthBars",
	"damageNumbers",
	"freezeFrame",
	"particles",
	"reducedMotion",
];

export function defaultJuiceSettings(prefersReducedMotion = false): JuiceSettings {
	return {
		healthBars: "onDamage",
		damageNumbers: true,
		freezeFrame: true,
		particles: "normal",
		reducedMotion: prefersReducedMotion,
	};
}

function readField(raw: Readonly<Record<string, unknown>>, out: JuiceOverrides): void {
	const hb = raw.healthBars;
	if (typeIs(hb, "string") && HEALTH_BARS_MODES.includes(hb as HealthBarsMode)) out.healthBars = hb as HealthBarsMode;
	const p = raw.particles;
	if (typeIs(p, "string") && PARTICLES_LEVELS.includes(p as ParticlesLevel)) out.particles = p as ParticlesLevel;
	if (typeIs(raw.damageNumbers, "boolean")) out.damageNumbers = raw.damageNumbers;
	if (typeIs(raw.freezeFrame, "boolean")) out.freezeFrame = raw.freezeFrame;
	if (typeIs(raw.reducedMotion, "boolean")) out.reducedMotion = raw.reducedMotion;
}

/** Keeps only known keys with valid values from `raw` (anything else is dropped). Never throws. */
export function sanitizeJuiceOverrides(raw: unknown): JuiceOverrides {
	const out: JuiceOverrides = {};
	if (typeIs(raw, "table")) readField(raw as Record<string, unknown>, out);
	return out;
}

/** The web build's sanitizeJuiceSettings: valid known keys from `raw`, everything else from `defaults`. */
export function sanitizeJuiceSettings(raw: unknown, defaults: Readonly<JuiceSettings>): JuiceSettings {
	return { ...defaults, ...sanitizeJuiceOverrides(raw) };
}

/** The settings a client uses: overrides on top of the defaults (reducedMotion default = the system setting). */
export function resolveJuiceSettings(overrides: unknown, prefersReducedMotion = false): JuiceSettings {
	return sanitizeJuiceSettings(overrides, defaultJuiceSettings(prefersReducedMotion));
}

/** New overrides after a change: `current` plus the valid keys of `patch` (invalid keys / values are ignored). */
export function applyJuicePatch(current: Readonly<JuiceOverrides>, patch: unknown): JuiceOverrides {
	return { ...sanitizeJuiceOverrides(current), ...sanitizeJuiceOverrides(patch) };
}

/** True when two override sets hold the same keys and values. */
export function sameJuiceOverrides(a: Readonly<JuiceOverrides>, b: Readonly<JuiceOverrides>): boolean {
	for (const k of JUICE_SETTING_KEYS) if (a[k] !== b[k]) return false;
	return true;
}

// ---------------------------------------------------------------------------------------------
// The stored document (one DataStore value per player)

/** Bump when the document's shape changes incompatibly (old documents then read as empty). */
export const SETTINGS_DOC_VERSION = 1;

export interface SettingsDoc {
	v: number;
	juice: JuiceOverrides;
}

export function encodeSettingsDoc(juice: Readonly<JuiceOverrides>): SettingsDoc {
	return { v: SETTINGS_DOC_VERSION, juice: sanitizeJuiceOverrides(juice) };
}

/** Overrides from a stored value: anything missing, of another version or malformed reads as no overrides. */
export function decodeSettingsDoc(raw: unknown): JuiceOverrides {
	if (!typeIs(raw, "table")) return {};
	const doc = raw as { v?: unknown; juice?: unknown };
	if (doc.v !== SETTINGS_DOC_VERSION) return {};
	return sanitizeJuiceOverrides(doc.juice);
}
