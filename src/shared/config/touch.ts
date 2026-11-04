/** Touch controls tunables (docs/MOBILE.md). Seconds, fractions and reference px; data only. */
export const TOUCH = {
	/** A press counts for at least this long, so a quick tap still reaches a sim tick (3 ticks at 60 Hz). */
	minPressSec: 0.05,
	/** Longest dt one sample may use (a hitch never burns the whole aim latch at once). */
	maxFrameSec: 0.1,
	/** Drag distance for a full stick, reference px (scaled with the controls). */
	stickRadiusRef: 60,
	move: {
		/** Stick length (0..1) below which the move stick walks nowhere. */
		deadzone: 0.15,
		/** Stick length at which the walk reaches full speed. */
		runFraction: 0.7,
	},
	action: {
		/** Attack / Alt: a stick shorter than this (0..1) is "centre" (auto-target / facing); longer is manual aim. */
		centreFraction: 0.3,
	},
	/** After an Attack / Alt lift the last aim holds this long (the bow looses along it; MBD7). */
	aimLatchSec: 0.25,
	autoTarget: {
		rangeTiles: 9,
		/** cos of the half-angle of the facing cone that gets the bonus (0.5 = 60 degrees). */
		coneCos: 0.5,
		/** Distance multipliers (lower wins): inside the facing cone, and the current target (hysteresis). */
		coneFactor: 0.75,
		stickyFactor: 0.7,
		/**
		 * docs/FORTUNE.md FD16: the Goldling is a target, ranked after every other visible actor within this many tiles
		 * (a fleeing coin bag never pulls the aim off a threat at arm's length); with none that close it ranks as usual.
		 */
		goldenYieldTiles: 3,
	},
	draft: {
		/** A tapped card's FIRE pulse length, and the wait before another pulse while the draft is still open. */
		pulseSec: 0.05,
		retrySec: 0.5,
	},
	marker: {
		/** The auto-target ring under the target: radius and height (tiles), transparency. */
		radiusTiles: 0.6,
		heightTiles: 0.05,
		transparency: 0.35,
	},
} as const;
