// The co-op moments' presentation rules (docs/RUN_RECAP.md CM2): the frame's team perfect of a clear, the pulse rings
// on every living party member, and the presentation tunables.
import { describe, expect, it } from "@rbxts/jest-globals";
import { createSimState, playerAt } from "shared/sim";
import { ROOM_CLEAR } from "./roomClearConfig";
import type { RoomClear } from "./roomClears";
import { TeamMoments } from "./teamMoments";
import { TEAM_MOMENTS_VIEW } from "./teamMomentsConfig";
import { parseTeamMomentsDebug, teamPerfectFor, teamPulsePlayers } from "./teamMomentsView";

function clear(perfect: boolean, tick: number, room = 0): RoomClear {
	return {
		room,
		rooms: 1,
		perfect,
		killPoints: 100,
		clearPoints: 50,
		perfectPoints: perfect ? 300 : 0,
		fastPoints: 0,
		pelletPoints: 0,
		sweepPoints: 0,
		x: 3,
		z: 4,
		slot: -1,
		actorId: 0,
		minX: 0,
		maxX: 10,
		minZ: 0,
		maxZ: 10,
		tick,
	};
}

describe("teamMomentsView: TEAM PERFECT presentation", () => {
	it("finds a clear's team perfect by tick and room; none in a solo run or for a plain clear", () => {
		const s = createSimState(1, 0, 0, { party: { size: 2 }, scoring: { partySize: 2 } });
		const m = new TeamMoments();
		const a = clear(true, 10, 1);
		const b = clear(true, 10, 2);
		const c = clear(false, 10, 3);
		const out = m.clearsFrame(s, [a, b, c]);
		expect(teamPerfectFor(a, out.teamPerfects)?.streak).toBe(1);
		expect(teamPerfectFor(b, out.teamPerfects)?.streak).toBe(2);
		expect(teamPerfectFor(b, out.teamPerfects)?.showStreak).toBe(true);
		expect(teamPerfectFor(c, out.teamPerfects)).toBe(undefined);
		// another tick of the same room is not this clear's
		expect(teamPerfectFor({ tick: 11, room: 1 }, out.teamPerfects)).toBe(undefined);
		const solo = new TeamMoments().clearsFrame(createSimState(1, 0, 0, { scoring: {} }), [a]);
		expect(teamPerfectFor(a, solo.teamPerfects)).toBe(undefined);
	});

	it("pulses every living party member, near or far; the dead get none", () => {
		const s = createSimState(1, 0, 0, { party: { size: 3 }, scoring: { partySize: 3 } });
		const out: number[] = [99];
		expect(teamPulsePlayers(s, out)).toEqual([0, 1, 2]);
		playerAt(s, 1).dead = 1;
		expect(teamPulsePlayers(s, out)).toEqual([0, 2]);
		expect(teamPulsePlayers(createSimState(1, 0, 0, { scoring: {} }), out)).toEqual([0]);
	});

	it("holds the presentation tunables: new best's gold rings with their own seed salt, the debug attribute", () => {
		expect(TEAM_MOMENTS_VIEW.pulse.role).toBe("newBest");
		// burstSeed salts in use: room clear 15, near misses 16 / 17, loot fizzle 18
		expect([ROOM_CLEAR.burstSeedSalt, TEAM_MOMENTS_VIEW.pulse.seedSalt]).toEqual([15, 19]);
		expect(TEAM_MOMENTS_VIEW.debug.attribute).toBe("KV_TeamMomentsDebug");
	});
});

describe("teamMomentsView: the KV_TeamMomentsDebug attribute", () => {
	it("parses perfect / perfect:<n> / sync / sync:far / sync:<n>; anything else is nothing", () => {
		expect(parseTeamMomentsDebug("perfect")).toEqual({ kind: "perfect", streak: 1 });
		expect(parseTeamMomentsDebug("perfect:3")).toEqual({ kind: "perfect", streak: 3 });
		expect(parseTeamMomentsDebug("sync")).toEqual({ kind: "sync", far: false, count: 2 });
		expect(parseTeamMomentsDebug("sync:far")).toEqual({ kind: "sync", far: true, count: 2 });
		expect(parseTeamMomentsDebug("sync:3")).toEqual({ kind: "sync", far: false, count: 3 });
		for (const bad of ["", "perfect:0", "perfect:x", "sync:1", "sync:9", "sync:near", "nope", "perfect:2.5"]) {
			expect([bad, parseTeamMomentsDebug(bad)]).toEqual([bad, undefined]);
		}
		expect(parseTeamMomentsDebug(3)).toBe(undefined);
		expect(parseTeamMomentsDebug(undefined)).toBe(undefined);
	});
});
