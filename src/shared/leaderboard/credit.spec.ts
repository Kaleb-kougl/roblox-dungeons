// docs/SERVER_CENSUS.md SE3: who of an accepted run is credited (the leaderboard post, the personal records and the
// Silver grant all take this list), moved out of RunSessionService.conclude.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PARTY_NOT_LEFT, creditedPartyMembers, partyContributors } from "shared/leaderboard";

const FINAL = 6000;
const FLOOR_2 = 2400;

describe("creditedPartyMembers", () => {
	it("a solo run credits its member, whatever the leave data says (the same array)", () => {
		const solo = ["a"];
		expect(creditedPartyMembers(solo, 1, undefined, FINAL, undefined)).toBe(solo);
		expect(creditedPartyMembers(solo, 1, [10], FINAL, FLOOR_2)).toBe(solo);
	});

	it("a party nobody left: everyone, in member order", () => {
		const party = ["a", "b", "c"];
		expect(creditedPartyMembers(party, 3, undefined, FINAL, FLOOR_2)).toEqual(party);
		expect(
			creditedPartyMembers(party, 3, [PARTY_NOT_LEFT, PARTY_NOT_LEFT, PARTY_NOT_LEFT], FINAL, FLOOR_2),
		).toEqual(party);
		expect(creditedPartyMembers(party, 3, [], FINAL, undefined)).toEqual(party);
	});

	it("a member who left on floor 1 is not credited; one who left after the first floor change is", () => {
		const party = ["a", "b", "c"];
		expect(creditedPartyMembers(party, 3, [PARTY_NOT_LEFT, 100, FLOOR_2 + 1], FINAL, FLOOR_2)).toEqual(["a", "c"]);
		// Leaving on the very tick of the floor change is not "after" it.
		expect(creditedPartyMembers(party, 3, [PARTY_NOT_LEFT, FLOOR_2, PARTY_NOT_LEFT], FINAL, FLOOR_2)).toEqual([
			"a",
			"c",
		]);
	});

	it("a run that never left floor 1 credits only members present to the end", () => {
		const party = ["a", "b"];
		expect(creditedPartyMembers(party, 2, [PARTY_NOT_LEFT, FINAL - 1], FINAL, undefined)).toEqual(["a"]);
		// Marked left only from the final tick on: the wipe came first.
		expect(creditedPartyMembers(party, 2, [PARTY_NOT_LEFT, FINAL], FINAL, undefined)).toEqual(party);
	});

	it("leaving at tick 0 is a leave, not `never left`", () => {
		expect(creditedPartyMembers(["a", "b"], 2, [0, PARTY_NOT_LEFT], FINAL, FLOOR_2)).toEqual(["b"]);
	});

	it("everyone may be uncredited; the input is never changed", () => {
		const party = ["a", "b"];
		expect(creditedPartyMembers(party, 2, [5, 6], FINAL, FLOOR_2)).toEqual([]);
		expect(party).toEqual(["a", "b"]);
	});

	it("agrees with partyContributors member by member", () => {
		const left = [PARTY_NOT_LEFT, 0, FLOOR_2, FLOOR_2 + 1, FINAL - 1, FINAL, FINAL + 5];
		const ids = left.map((_, i) => i);
		const flags = partyContributors(
			(i) => (left[i] === PARTY_NOT_LEFT ? undefined : left[i]),
			left.size(),
			FINAL,
			FLOOR_2,
		);
		expect(creditedPartyMembers(ids, left.size(), left, FINAL, FLOOR_2)).toEqual(ids.filter((i) => flags[i]));
		expect(flags).toEqual([true, false, false, true, true, true, true]);
	});
});
