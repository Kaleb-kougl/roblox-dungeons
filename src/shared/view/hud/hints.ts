/**
 * Timed HUD hints (docs/HUD_LAYOUT.md H5 / H6): a hint shows for a while after the thing it explains happens (a run
 * start, an input device change, a new verdict), then fades out, so it never sits over the playfield for long. Pure and
 * headless (hints.spec.ts); the client animates the transparency.
 */
export const HUD_HINTS = {
	/** WeaponPanel's swap hint: shown this long after a run starts or the input device changes. */
	swapHintSeconds: 8,
	/** InfoPanel's verdict / notice lines: shown this long after they change (Stream C, H6). */
	verdictSeconds: 8,
	/** Every timed hint fades out over this long once its time is up. */
	fadeSeconds: 0.5,
} as const;

/**
 * A timed hint's text transparency `sinceSeconds` after it was (re)triggered: 0 while shown (`showSeconds`), then
 * linear to 1 over `fadeSeconds`, 1 after. A negative or NaN `sinceSeconds` counts as just triggered (0); a fade of 0
 * or less hides at once.
 */
export function hintVisible(sinceSeconds: number, showSeconds: number, fadeSeconds: number): number {
	// NaN fails every comparison: treat it as "just triggered".
	if (!(sinceSeconds > showSeconds)) return 0;
	if (!(fadeSeconds > 0)) return 1;
	return math.min(1, (sinceSeconds - showSeconds) / fadeSeconds);
}
