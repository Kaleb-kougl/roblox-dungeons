/**
 * Knocks on a secret room's crack (docs/SECRET_ROOMS.md SR6, SR9): the throttle that keeps a stream of hits to one
 * puff / knock sound per SECRET_VIEW.knock.throttleSec, and the first-knock latch that raises the first-time card
 * (sighting id `secret.crack`, SRD5) and the Codex entry's seen claim (SRD12). Pure, tested headlessly.
 */
import { SECRET_VIEW } from "./config";
import type { SecretFrameSource } from "./events";

/** Float slack on the throttle's gap: knocks a whole number of ticks apart (12 / 60 s) count as exactly that far. */
const THROTTLE_SLACK_SEC = 1e-9;

/** At most one knock per `throttleSec` (seconds on the caller's clock: sim seconds for the look, real for audio). */
export class KnockThrottle {
	private last = -math.huge;

	constructor(private readonly throttleSec: number = SECRET_VIEW.knock.throttleSec) {}

	/** Forget the last knock (a new secret, a run exit). */
	reset(): void {
		this.last = -math.huge;
	}

	/** A knock at `t`: true (and it counts) when `throttleSec` has passed since the last one let through. */
	admit(t: number): boolean {
		if (t < this.last) this.last = -math.huge; // the clock went back (a restart)
		if (t - this.last < this.throttleSec - THROTTLE_SLACK_SEC) return false;
		this.last = t;
		return true;
	}
}

/**
 * The local player's first knock this session (until `reset`, a run exit): `observe` each frame's events; `knocked()`
 * stays true from that frame on. The client's SightingController adds `secret.crack` to the frame's sightings while it
 * is true (shared/view/sighting withSecretSighting): the SightingQueue shows the card once per account (its seen set),
 * so a veteran's knocks raise nothing. Only knocks credited to the local player count: a teammate's, an enemy bullet's
 * or a Charger's do not (the card names what YOU can do to the wall).
 */
export class FirstKnockLatch {
	private latched = false;

	reset(): void {
		this.latched = false;
	}

	/** True once the local player has knocked. */
	knocked(): boolean {
		return this.latched;
	}

	/** This frame's events for local player `localIndex`; true on the frame the latch closes (its edge). */
	observe(events: SecretFrameSource, localIndex: number): boolean {
		if (this.latched) return false;
		if (!localKnocked(events, localIndex)) return false;
		this.latched = true;
		return true;
	}
}

/** Did local player `localIndex` knock on a crack this frame? */
export function localKnocked(events: SecretFrameSource, localIndex: number): boolean {
	for (const k of events.knocks) if (k.player === localIndex && localIndex >= 0) return true;
	return false;
}
