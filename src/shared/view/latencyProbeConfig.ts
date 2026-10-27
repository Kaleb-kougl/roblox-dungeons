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
