/**
 * First-sighting tunables (docs/ENEMY_VARIANTS.md EV12; the client's SightingController). Presentation only. The line
 * shows on its own card at the left edge (shared/view/hud SIGHTING_CARD), not among the top-centre toasts.
 */

export const SIGHTING_VIEW = {
	/**
	 * A living actor counts as shown once it is within this distance of the watched player (world units): about the
	 * camera's half height, so it is on screen. Tune in Studio.
	 */
	radius: 9,
	/** A first-sighting card stays this long (seconds; the progression toasts' is 3: this one is read once, ever). */
	toastSeconds: 5,
	/** Quiet gap after a first-sighting card before the next queued one (seconds): one at a time. */
	gapSeconds: 0.75,
	/**
	 * First-sighting cards use ids below this one (the client store's ToastView.id, a React key: the progression toasts
	 * count up from 1, the tutorial callouts down from -1), so the three never collide.
	 */
	toastIdBase: -(2 ** 20),
} as const;
