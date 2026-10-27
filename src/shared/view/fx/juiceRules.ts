/**
 * The shared juice rules every feature follows (port of the rule half of project-kaleb-vale src/fx/settings.ts
 * @ 42897e2: PARTICLE_BUDGET, effectiveParticles, particleBudget, freezeFrameOn, screenShakeOn, motionScale). The
 * settings schema itself (types, defaults, sanitize, the stored overrides) is shared/settings/juice.ts, which the
 * server uses too; these helpers are presentation only.
 *
 * Reduced motion: the effective `reducedMotion` is the player's override when they set one, else the Roblox "Reduce
 * Motion" setting (GuiService.ReducedMotionEnabled), exactly as the web build defaulted it to the OS preference
 * (shared/settings resolveJuiceSettings). Every feature reads it only through these helpers.
 *
 * Port change (docs/FEEL.md J8): screenShakeOn also reads the port's screenShake setting.
 */
import type { JuiceSettings, ParticlesLevel } from "shared/settings";

/** Most live particles per particle level (web README budget: <= 512 in total). */
export const PARTICLE_BUDGET: Readonly<Record<ParticlesLevel, number>> = { off: 0, low: 128, normal: 320, high: 512 };

/** The particle level actually used: one step lower under reducedMotion (high -> normal -> low; low and off stay). */
export function effectiveParticles(s: Readonly<JuiceSettings>): ParticlesLevel {
	if (!s.reducedMotion) return s.particles;
	return s.particles === "high" ? "normal" : s.particles === "normal" ? "low" : s.particles;
}

/** Max live particles for these settings. */
export function particleBudget(s: Readonly<JuiceSettings>): number {
	return PARTICLE_BUDGET[effectiveParticles(s)];
}

/** Freeze frame / hitstop allowed? (setting on and not reducedMotion). */
export function freezeFrameOn(s: Readonly<JuiceSettings>): boolean {
	return s.freezeFrame && !s.reducedMotion;
}

/**
 * Screen shake (the camera nudges) allowed? Port change (docs/FEEL.md J8, JD10): the screenShake setting of its own
 * (Options > Juice), and reducedMotion still turns it off.
 */
export function screenShakeOn(s: Readonly<JuiceSettings>): boolean {
	return s.screenShake && !s.reducedMotion;
}

/**
 * Scale for decorative movement (number float / pop, particle hop, bar shake): 1 normally, 0 under reducedMotion
 * (things appear and fade in place). Fades and colour changes are fine either way.
 */
export function motionScale(s: Readonly<JuiceSettings>): number {
	return s.reducedMotion ? 0 : 1;
}
