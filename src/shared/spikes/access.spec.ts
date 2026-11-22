// Where a spike's server half may run and who hears it (docs/SERVER_FINDINGS.md SFD2, SFD3): Studio or a listed test
// place, never the live place; log lines only to the players developer mode would let in.
import { describe, expect, it } from "@rbxts/jest-globals";
import { DEV_MODE, SPIKE_TEST_PLACES } from "shared/config";
import { serverSpikeAllowed, spikeViewerAllowed } from ".";

const TEST_PLACE = 4242;
const OTHER_PLACE = 4243;
const PLACES: ReadonlyArray<number> = [TEST_PLACE];

describe("serverSpikeAllowed", () => {
	it("allows every place in Studio, listed or not", () => {
		expect(serverSpikeAllowed(true, 0, [])).toBe(true);
		expect(serverSpikeAllowed(true, OTHER_PLACE, PLACES)).toBe(true);
		expect(serverSpikeAllowed(true, undefined, [])).toBe(true);
	});

	it("allows a published server only in a listed place", () => {
		expect(serverSpikeAllowed(false, TEST_PLACE, PLACES)).toBe(true);
		expect(serverSpikeAllowed(false, OTHER_PLACE, PLACES)).toBe(false);
		expect(serverSpikeAllowed(false, TEST_PLACE, [])).toBe(false);
	});

	it("refuses place 0, a negative id, NaN and anything that is not a number", () => {
		const listed: ReadonlyArray<number> = [0, -1, TEST_PLACE];
		for (const bad of [0, -1, 0 / 0, "4242", true, {}, undefined] as unknown[]) {
			expect(serverSpikeAllowed(false, bad, listed)).toBe(false);
		}
	});

	it("ships with no test place: outside Studio no server spike runs", () => {
		expect(SPIKE_TEST_PLACES.size()).toBe(0);
		expect(serverSpikeAllowed(false, TEST_PLACE)).toBe(false);
		expect(serverSpikeAllowed(true, TEST_PLACE)).toBe(true);
	});
});

describe("spikeViewerAllowed", () => {
	const STRANGER = 987654;
	const CREATOR = 555;
	const live = { studio: false, userId: STRANGER, creatorId: CREATOR, creatorIsUser: true };

	it("allows everyone in Studio", () => {
		expect(spikeViewerAllowed({ ...live, studio: true })).toBe(true);
	});

	it("on a published server allows only the players developer mode would let in", () => {
		expect(spikeViewerAllowed(live)).toBe(false);
		expect(spikeViewerAllowed({ ...live, userId: 0 })).toBe(false);
		for (const id of DEV_MODE.allowedUserIds) expect(spikeViewerAllowed({ ...live, userId: id })).toBe(true);
		expect(spikeViewerAllowed({ ...live, userId: CREATOR })).toBe(DEV_MODE.allowPlaceCreator);
		expect(spikeViewerAllowed({ ...live, userId: CREATOR, creatorIsUser: false })).toBe(false);
	});
});
