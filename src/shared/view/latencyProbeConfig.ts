/**
 * Co-op latency probe tunables (docs/FEEL.md J9, KV_Debug only): presentation diagnostics, nothing here reaches the
 * sim, the lockstep stream or a replay.
 */
export const LATENCY_PROBE = {
	/** The rolling stats (mean / max) cover the last this many measured presses. */
	window: 16,
	/** At most this many presses wait for their tick at once (more are not measured; a stuck stream cannot grow it). */
	maxPending: 8,
	/** Seconds -> milliseconds for the debug line. */
	msPerSecond: 1000,
	/** Shown for a stat with no measured press yet. */
	none: "-",
} as const;

/**
 * The co-op debug line's pacing part (docs/FRAME_PACING.md Design 7), one string per PacingDebugView mode. Developer
 * strings (`hud.debug*`): English in every locale, never exported for translation.
 */
export const PACING_DEBUG_STRINGS = {
	on: "hud.debug.pace",
	waiting: "hud.debug.paceWait",
	off: "hud.debug.paceOff",
} as const;

/**
 * The co-op debug line's lead part (docs/FRAME_PACING.md Design 11), one string per LeadDebugView mode: the measured
 * lead (net lead and trip p95), the legacy miss counter (warm-up, no echo, or the echo timeout) and KV_LeadOff.
 * Developer strings (`hud.debug*`): English in every locale, never exported for translation.
 */
export const LEAD_DEBUG_STRINGS = {
	measured: "hud.debug.lead",
	legacy: "hud.debug.leadLegacy",
	off: "hud.debug.leadOff",
} as const;
