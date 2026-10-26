/**
 * Co-op spectating (docs/SPECTATE.md S1; a Roblox-port feature, no web source): whose player the views follow once the
 * local player has died in a party run. Every client already steps the whole party sim, so watching player `i` is only
 * reading `playerAt(state, i)` instead of the local index. Pure and headless-tested (spectate.spec.ts): no Roblox
 * services or Instances, no clock (the caller passes the frame's `dt`); reads players only through playerAt /
 * partySize / hasLeft. Presentation only: nothing here feeds `step()` or the lockstep input.
 *
 * Candidates (spectateCandidates): the living teammates who have not left, in party index order, never the local
 * player. SpectateTracker.update, once per rendered frame after the frame's sim ticks:
 *   solo       partySize 1 (no party state: solo runs, the tutorial): always the local player, never active
 *   alive      the local player is alive: the local player, nothing running; coming back to life (the floor change's
 *              revive) ends spectating at once
 *   own death  the local player just died: hold on their corpse for SPECTATE.holdOnDeathSec, then the candidate
 *              nearest to it (nearestCandidate: squared distance, ties to the lower index)
 *   watched    the watched teammate died or left: hold on them for holdOnDeathSec, then the candidate nearest to them
 *   switch     "next" / "previous" (spectateCommand): the next / previous candidate after the watched one in index
 *              order, wrapping (cycleCandidate); ignored during a hold and with fewer than two candidates
 *   wipe       nobody alive: the last watched player stays (the run-over panel takes over)
 */
import {
	Button,
	SOLO_PARTY_SIZE,
	hasLeft,
	partySize,
	playerAt,
	wasPressed,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { SPECTATE } from "./spectateConfig";

/** What the views follow this frame (SpectateTracker.update; the tracker reuses one object, read it at once). */
export interface SpectateView {
	/** The player index the views follow: the local index while alive, else the watched teammate (or a held corpse). */
	readonly viewIndex: number;
	/**
	 * true while the local player is dead and the views follow a teammate (the hold on that teammate's corpse
	 * included); false while alive and during the hold on the local player's own corpse (viewIndex is still local).
	 */
	readonly active: boolean;
	/** true while the view holds on a fresh corpse (SPECTATE.holdOnDeathSec), the local player's or the watched one's. */
	readonly holding: boolean;
	/**
	 * 1-based position of viewIndex among the living candidates, and their count (the bar's "2 / 3"). position is 0
	 * when viewIndex is not a candidate (not spectating, the hold on a corpse, a wipe); count is 0 when not active.
	 */
	readonly position: number;
	readonly count: number;
}

type MutableSpectateView = { -readonly [K in keyof SpectateView]: SpectateView[K] };

/** A switch press while spectating: the next or previous living teammate, or nothing. */
export type SpectateCommand = "next" | "previous" | undefined;

/** One step forward or back in party index order (cycleCandidate). */
export type SpectateDirection = 1 | -1;

/** Player `i` can be watched by `localIndex`: a teammate (not the local player) who is alive and has not left. */
function isCandidate(state: Readonly<SimState>, localIndex: number, i: number): boolean {
	return i !== localIndex && playerAt(state, i).dead === 0 && !hasLeft(state, i);
}

/**
 * Living, present teammates (not the local player) in party index order; empty in a solo run. Written into `out`
 * (cleared first; pass a reused array to avoid an allocation per frame) and returned.
 */
export function spectateCandidates(state: Readonly<SimState>, localIndex: number, out: number[] = []): number[] {
	while (out.size() > 0) out.pop();
	const n = partySize(state);
	if (n <= SOLO_PARTY_SIZE) return out;
	for (let i = 0; i < n; i++) if (isCandidate(state, localIndex, i)) out.push(i);
	return out;
}

/** The living candidate nearest (squared distance) to (x, z), ties to the lower index; undefined when none. */
export function nearestCandidate(
	state: Readonly<SimState>,
	localIndex: number,
	x: number,
	z: number,
): number | undefined {
	const n = partySize(state);
	if (n <= SOLO_PARTY_SIZE) return undefined;
	let best: number | undefined;
	let bestD2 = 0;
	for (let i = 0; i < n; i++) {
		if (!isCandidate(state, localIndex, i)) continue;
		const p = playerAt(state, i);
		const dx = p.x - x;
		const dz = p.z - z;
		const d2 = dx * dx + dz * dz;
		if (best === undefined || d2 < bestD2) {
			best = i;
			bestD2 = d2;
		}
	}
	return best;
}

/**
 * The first candidate after (`dir` 1) or before (`dir` -1) player `from` in party index order, wrapping around;
 * `from` itself when it is the only candidate, undefined when there is none.
 */
export function cycleCandidate(
	state: Readonly<SimState>,
	localIndex: number,
	from: number,
	dir: SpectateDirection,
): number | undefined {
	const n = partySize(state);
	if (n <= SOLO_PARTY_SIZE) return undefined;
	for (let k = 1; k <= n; k++) {
		const i = (((from + dir * k) % n) + n) % n;
		if (isCandidate(state, localIndex, i)) return i;
	}
	return undefined;
}

/**
 * The switch command of a sampled frame against the previous one (raw device input, before any menu gate): a FIRE
 * (Attack) rising edge is "next", an ALT rising edge "previous"; both in one frame is "next". A held button gives one
 * edge, on the frame it went down.
 */
export function spectateCommand(prev: Readonly<InputFrame>, cur: Readonly<InputFrame>): SpectateCommand {
	if (wasPressed(prev, cur, Button.FIRE)) return "next";
	if (wasPressed(prev, cur, Button.ALT)) return "previous";
	return undefined;
}

/**
 * The spectate session of one client in one run (rules at the top of this file). Construct it with the client's
 * player index at run start; call update once per rendered frame and reset at the floor change and run start.
 */
export class SpectateTracker {
	private viewIndex: number;
	/** The local player was dead at the last update: a spectate session is running. */
	private dead = false;
	/** A hold on a fresh corpse (viewIndex) is running, with holdLeft seconds to go. */
	private holding = false;
	private holdLeft = 0;
	private readonly candidates: number[] = [];
	private readonly view: MutableSpectateView;

	constructor(private readonly localIndex: number) {
		this.viewIndex = localIndex;
		this.view = { viewIndex: localIndex, active: false, holding: false, position: 0, count: 0 };
	}

	/**
	 * One rendered frame: `state` after the frame's sim ticks, `dt` in seconds (the client clock is fine: nothing here
	 * reaches the sim; at most SPECTATE.maxHoldDtSec of it counts toward a hold), `cmd` the frame's switch press
	 * (spectateCommand; undefined while a menu owns the controls). Returns the tracker's reused view.
	 */
	update(state: Readonly<SimState>, dt: number, cmd: SpectateCommand): SpectateView {
		const me = this.localIndex;
		if (partySize(state) <= SOLO_PARTY_SIZE || playerAt(state, me).dead === 0) {
			this.reset();
			return this.publish(state);
		}
		if (!this.dead) {
			// The local player just died: hold on their own corpse.
			this.dead = true;
			this.viewIndex = me;
			this.startHold();
		} else if (this.holding) {
			this.holdLeft -= math.min(math.max(dt, 0), SPECTATE.maxHoldDtSec); // a hitch can not skip the hold
			if (this.holdLeft <= 0) {
				this.holding = false;
				this.holdLeft = 0;
				const corpse = playerAt(state, this.viewIndex);
				const target = nearestCandidate(state, me, corpse.x, corpse.z);
				if (target !== undefined) this.viewIndex = target; // none: a wipe, the corpse stays in view
			}
		} else if (!isCandidate(state, me, this.viewIndex)) {
			// The watched teammate died or left (or a wipe already left the view on a corpse): hold on them, unless
			// nobody is left to move to.
			if (spectateCandidates(state, me, this.candidates).size() > 0) this.startHold();
		} else if (cmd !== undefined) {
			const target = cycleCandidate(state, me, this.viewIndex, cmd === "next" ? 1 : -1);
			if (target !== undefined) this.viewIndex = target; // one candidate: itself, so nothing changes
		}
		return this.publish(state);
	}

	/** Floor change / run start: back to the local player, any hold dropped. */
	reset(): void {
		this.viewIndex = this.localIndex;
		this.dead = false;
		this.holding = false;
		this.holdLeft = 0;
	}

	private startHold(): void {
		this.holding = true;
		this.holdLeft = SPECTATE.holdOnDeathSec;
	}

	private publish(state: Readonly<SimState>): SpectateView {
		const v = this.view;
		const active = this.dead && this.viewIndex !== this.localIndex;
		v.viewIndex = this.viewIndex;
		v.active = active;
		v.holding = this.dead && this.holding;
		if (active) {
			const list = spectateCandidates(state, this.localIndex, this.candidates);
			v.count = list.size();
			v.position = list.indexOf(this.viewIndex) + 1;
		} else {
			v.count = 0;
			v.position = 0;
		}
		return v;
	}
}
