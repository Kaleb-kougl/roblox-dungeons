// Co-op spectating (docs/SPECTATE.md S1): the candidates, the nearest pick with its index tie-break, cycling with
// wrap-around past the dead and the left, the switch command's edges, and SpectateTracker's holds, switches, revive,
// wipe and solo rules on hand-built party states.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	Button,
	EMPTY_INPUT,
	PARTY_REVIVE_HALF_HEARTS,
	createSimState,
	killPlayerState,
	markPlayerLeft,
	playerAt,
	revivePartyMember,
	type InputFrame,
	type SimState,
} from "shared/sim";
import {
	SPECTATE,
	SpectateTracker,
	cycleCandidate,
	nearestCandidate,
	spectateCandidates,
	spectateCommand,
	type SpectateCommand,
	type SpectateView,
} from "shared/view";

const HOLD = SPECTATE.holdOnDeathSec;

/** A party of `n` with player i at xs[i] on the z = 0 line. */
function party(n: number, xs: number[]): SimState {
	const s = createSimState(1, 0, 0, { party: { size: n } });
	for (let i = 0; i < n; i++) place(s, i, xs[i], 0);
	return s;
}

function place(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}

function kill(s: SimState, i: number): void {
	killPlayerState(playerAt(s, i));
}

/** The fields of a view (the tracker reuses one object). */
function fields(v: SpectateView): [number, boolean, boolean, number, number] {
	return [v.viewIndex, v.active, v.holding, v.position, v.count];
}

/** Kills player `me` (the tracker's local player) and runs the tracker through the hold on their corpse. */
function dieAndWatch(t: SpectateTracker, s: SimState, me: number): SpectateView {
	kill(s, me);
	t.update(s, 0, undefined);
	return advance(t, s, HOLD, undefined);
}

/**
 * `seconds` of frames of at most SPECTATE.maxHoldDtSec each (the tracker counts no more of a frame toward a hold),
 * `cmd` on the first; the last frame's view. The specs' durations are multiples of 1/8 s, so the sums are exact.
 */
function advance(t: SpectateTracker, s: SimState, seconds: number, cmd: SpectateCommand): SpectateView {
	let step = math.min(seconds, SPECTATE.maxHoldDtSec);
	let v = t.update(s, step, cmd);
	let left = seconds - step;
	while (left > 0) {
		step = math.min(left, SPECTATE.maxHoldDtSec);
		v = t.update(s, step, undefined);
		left -= step;
	}
	return v;
}

function frame(buttons: number): InputFrame {
	return { ...EMPTY_INPUT, buttons };
}

describe("spectateCandidates / nearestCandidate / cycleCandidate", () => {
	it("candidates are living, present teammates in index order, never the local player", () => {
		const s = party(5, [0, 1, 2, 3, 4]);
		expect(spectateCandidates(s, 0)).toEqual([1, 2, 3, 4]);
		kill(s, 2);
		markPlayerLeft(s, 4);
		expect(spectateCandidates(s, 0)).toEqual([1, 3]);
		expect(spectateCandidates(s, 3)).toEqual([0, 1]);
		const reused = [7, 8, 9];
		expect(spectateCandidates(s, 1, reused)).toBe(reused);
		expect(reused).toEqual([0, 3]);
		expect(spectateCandidates(createSimState(1, 0, 0, {}), 0)).toEqual([]);
	});

	it("nearest by squared distance, ties to the lower index; undefined with nobody to watch", () => {
		const s = party(4, [0, 5, 3, -3]);
		expect(nearestCandidate(s, 0, 0, 0)).toBe(2); // 2 and 3 both 3 away: the lower index
		expect(nearestCandidate(s, 0, 4.5, 0)).toBe(1);
		expect(nearestCandidate(s, 2, 3, 0)).toBe(1); // the local player (2) itself is never a candidate
		kill(s, 1);
		kill(s, 2);
		kill(s, 3);
		expect(nearestCandidate(s, 0, 0, 0)).toBe(undefined);
		expect(nearestCandidate(createSimState(1, 0, 0, {}), 0, 0, 0)).toBe(undefined);
	});

	it("cycles forward and back with wrap-around, skipping the local player, the dead and the left", () => {
		const s = party(5, [0, 1, 2, 3, 4]);
		kill(s, 2);
		markPlayerLeft(s, 4);
		expect([cycleCandidate(s, 0, 1, 1), cycleCandidate(s, 0, 3, 1)]).toEqual([3, 1]);
		expect([cycleCandidate(s, 0, 1, -1), cycleCandidate(s, 0, 3, -1)]).toEqual([3, 1]);
		kill(s, 3);
		expect([cycleCandidate(s, 0, 1, 1), cycleCandidate(s, 0, 1, -1)]).toEqual([1, 1]);
		kill(s, 1);
		expect(cycleCandidate(s, 0, 1, 1)).toBe(undefined);
	});
});

describe("spectateCommand", () => {
	it("FIRE rising edge = next, ALT rising edge = previous, both = next", () => {
		const none = frame(0);
		expect(spectateCommand(none, frame(Button.FIRE))).toBe("next");
		expect(spectateCommand(none, frame(Button.ALT))).toBe("previous");
		expect(spectateCommand(none, frame(bit32.bor(Button.FIRE, Button.ALT)))).toBe("next");
		expect(spectateCommand(frame(Button.FIRE), frame(bit32.bor(Button.FIRE, Button.ALT)))).toBe("previous");
	});

	it("a held button gives one edge; releases and other buttons give none", () => {
		const held = frame(Button.FIRE);
		expect(spectateCommand(held, held)).toBe(undefined);
		expect(spectateCommand(frame(Button.ALT), frame(Button.ALT))).toBe(undefined);
		expect(spectateCommand(held, frame(0))).toBe(undefined);
		expect(spectateCommand(frame(0), frame(Button.ROLL))).toBe(undefined);
		expect(spectateCommand(frame(0), frame(0))).toBe(undefined);
	});
});

describe("SpectateTracker", () => {
	it("solo never spectates (no party state), dead or not", () => {
		const s = createSimState(1, 0, 0, {});
		const t = new SpectateTracker(0);
		expect(fields(t.update(s, 0, undefined))).toEqual([0, false, false, 0, 0]);
		kill(s, 0);
		for (let k = 0; k < 4; k++) expect(fields(advance(t, s, HOLD, "next"))).toEqual([0, false, false, 0, 0]);
		const one = createSimState(1, 0, 0, { party: { size: 1 } });
		kill(one, 0);
		expect(fields(new SpectateTracker(0).update(one, HOLD, "next"))).toEqual([0, false, false, 0, 0]);
	});

	it("follows the local player while alive; presses do nothing", () => {
		const s = party(3, [0, 1, 2]);
		const t = new SpectateTracker(1);
		expect(fields(t.update(s, 0.1, undefined))).toEqual([1, false, false, 0, 0]);
		expect(fields(t.update(s, 0.1, "next"))).toEqual([1, false, false, 0, 0]);
		kill(s, 0);
		expect(fields(advance(t, s, HOLD, "previous"))).toEqual([1, false, false, 0, 0]);
	});

	it("death: holds on the corpse for holdOnDeathSec, then the nearest teammate (ties to the lower index)", () => {
		const s = party(4, [5, 0, 3, -3]); // local 1 at 0: players 2 and 3 are both 3 away
		const t = new SpectateTracker(1);
		t.update(s, 0.1, undefined);
		kill(s, 1);
		expect(fields(t.update(s, 0.1, undefined))).toEqual([1, false, true, 0, 0]);
		expect(fields(advance(t, s, HOLD / 2, undefined))).toEqual([1, false, true, 0, 0]);
		expect(fields(advance(t, s, HOLD / 2, undefined))).toEqual([2, true, false, 2, 3]); // candidates 0, 2, 3
		expect(fields(t.update(s, 0.1, undefined))).toEqual([2, true, false, 2, 3]);
	});

	it("next / previous wrap around and skip the dead and the left", () => {
		const s = party(5, [0, 1, 2, 3, 4]);
		kill(s, 2);
		markPlayerLeft(s, 4);
		const t = new SpectateTracker(0);
		expect(fields(dieAndWatch(t, s, 0))).toEqual([1, true, false, 1, 2]);
		expect(fields(t.update(s, 0.1, "next"))).toEqual([3, true, false, 2, 2]);
		expect(fields(t.update(s, 0.1, "next"))).toEqual([1, true, false, 1, 2]);
		expect(fields(t.update(s, 0.1, "previous"))).toEqual([3, true, false, 2, 2]);
		expect(fields(t.update(s, 0.1, "previous"))).toEqual([1, true, false, 1, 2]);
		expect(fields(t.update(s, 0.1, undefined))).toEqual([1, true, false, 1, 2]);
	});

	it("presses are ignored during a hold and with one candidate", () => {
		const s = party(3, [0, 1, 2]);
		const t = new SpectateTracker(0);
		kill(s, 0);
		t.update(s, 0, undefined);
		expect(fields(advance(t, s, HOLD / 4, "next"))).toEqual([0, false, true, 0, 0]);
		expect(fields(advance(t, s, HOLD / 4, "previous"))).toEqual([0, false, true, 0, 0]);
		expect(fields(advance(t, s, HOLD, undefined))).toEqual([1, true, false, 1, 2]);
		kill(s, 2);
		expect(fields(t.update(s, 0.1, "next"))).toEqual([1, true, false, 1, 1]);
		expect(fields(t.update(s, 0.1, "previous"))).toEqual([1, true, false, 1, 1]);
	});

	it("the watched player's death: holds on them, then the teammate nearest to them", () => {
		const s = party(4, [9, 10, 12, 0]); // local 0 at 9: 1 at 10 is the nearest to the corpse
		const t = new SpectateTracker(0);
		expect(fields(dieAndWatch(t, s, 0))).toEqual([1, true, false, 1, 3]);
		place(s, 1, 1, 0); // 1 walks away from the local corpse and dies next to 3 (at 0)
		kill(s, 1);
		expect(fields(t.update(s, 0.1, undefined))).toEqual([1, true, true, 0, 2]); // on the corpse: not a candidate
		expect(fields(t.update(s, 0.1, "next"))).toEqual([1, true, true, 0, 2]); // ignored in the hold
		expect(fields(advance(t, s, HOLD, undefined))).toEqual([3, true, false, 2, 2]); // 3 (at 0) is nearest to 1
	});

	it("a watched player who leaves is treated like a death", () => {
		const s = party(3, [0, 1, 5]);
		const t = new SpectateTracker(0);
		expect(fields(dieAndWatch(t, s, 0))).toEqual([1, true, false, 1, 2]);
		markPlayerLeft(s, 1);
		expect(fields(t.update(s, 0.1, undefined))).toEqual([1, true, true, 0, 1]);
		expect(fields(advance(t, s, HOLD, undefined))).toEqual([2, true, false, 1, 1]);
	});

	it("coming back to life ends spectating at once, also during a hold", () => {
		const s = party(3, [0, 1, 2]);
		const t = new SpectateTracker(0);
		dieAndWatch(t, s, 0);
		revivePartyMember(playerAt(s, 0), PARTY_REVIVE_HALF_HEARTS);
		expect(fields(t.update(s, 0.1, "next"))).toEqual([0, false, false, 0, 0]);
		kill(s, 0);
		expect(fields(t.update(s, 0.1, undefined))).toEqual([0, false, true, 0, 0]); // a new death: a new hold
		revivePartyMember(playerAt(s, 0), PARTY_REVIVE_HALF_HEARTS);
		expect(fields(t.update(s, 0.1, undefined))).toEqual([0, false, false, 0, 0]);
	});

	it("a wipe keeps the last watched player", () => {
		const s = party(2, [0, 1]);
		const t = new SpectateTracker(0);
		expect(fields(dieAndWatch(t, s, 0))).toEqual([1, true, false, 1, 1]);
		kill(s, 1);
		for (let k = 0; k < 3; k++) expect(fields(advance(t, s, HOLD, "next"))).toEqual([1, true, false, 0, 0]);
	});

	it("a wipe during the hold on the local corpse keeps the local player", () => {
		const s = party(2, [0, 1]);
		const t = new SpectateTracker(0);
		kill(s, 0);
		kill(s, 1);
		t.update(s, 0, undefined);
		expect(fields(advance(t, s, HOLD, undefined))).toEqual([0, false, false, 0, 0]);
		expect(fields(advance(t, s, HOLD, "next"))).toEqual([0, false, false, 0, 0]);
	});

	it("a hitch counts as at most maxHoldDtSec of a hold", () => {
		const s = party(3, [0, 1, 2]);
		const t = new SpectateTracker(0);
		kill(s, 0);
		t.update(s, 0, undefined);
		const frames = math.ceil(HOLD / SPECTATE.maxHoldDtSec);
		// frames - 1 very long frames: still holding on the corpse
		for (let k = 1; k < frames; k++)
			expect(fields(t.update(s, HOLD * 10, undefined))).toEqual([0, false, true, 0, 0]);
		expect(fields(t.update(s, HOLD * 10, undefined))).toEqual([1, true, false, 1, 2]);
	});

	it("reset goes back to the local player and drops the hold", () => {
		const s = party(3, [0, 1, 2]);
		const t = new SpectateTracker(2);
		expect(fields(dieAndWatch(t, s, 2))).toEqual([1, true, false, 2, 2]);
		t.reset();
		revivePartyMember(playerAt(s, 2), PARTY_REVIVE_HALF_HEARTS);
		expect(fields(t.update(s, 0, undefined))).toEqual([2, false, false, 0, 0]);
	});
});
