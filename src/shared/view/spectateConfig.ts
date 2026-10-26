/**
 * Presentation tunables of co-op spectating (docs/SPECTATE.md; logic in spectate.ts, the camera in the client's
 * CameraController). Presentation only: nothing here reaches the sim, the lockstep wire or a hash. Roblox-port
 * choices, no web source.
 */
export const SPECTATE = {
	/**
	 * Seconds the view stays on a fresh corpse (the local player's, or the watched teammate's) before it moves to the
	 * living teammate nearest to it, so the death animation and sound play out first.
	 */
	holdOnDeathSec: 1.5,
	/**
	 * At most this many seconds of one frame's dt count toward a hold (SpectateTracker.update), so a hitch (a frame of a
	 * second or more) can not skip the hold on a corpse: the hold always spans at least holdOnDeathSec / this frames.
	 */
	maxHoldDtSec: 0.25,
	/**
	 * Camera damping time constant while it moves to a newly watched player, seconds (for glideSettleSec; then
	 * GAME_CAMERA.followTauSec again). Longer than the follow's 1/6 s, so a switch reads as a pan, not a jump cut.
	 */
	glideTauSec: 0.3,
	/**
	 * How long a switch's glide lasts, seconds: three time constants (~95% of the way). Ends on time, not on distance:
	 * a damped follow trails a moving player by about speed * tau, so a distance test might never pass.
	 */
	glideSettleSec: 0.9,
	/**
	 * A newly watched player farther than this from the camera focus, tiles, is snapped to instead of glided to (no
	 * long pans across walls and void). About two thirds of the view's height (VIEW_TILES_HIGH, ~16.9 tiles).
	 */
	snapBeyondTiles: 12,
} as const;
