/**
 * Where a spike's server half may run and who hears it (docs/SERVER_FINDINGS.md SFD2, SFD3). Pure: the server passes
 * in what it read.
 *
 *   serverSpikeAllowed   Studio, or a published test place listed in SPIKE_TEST_PLACES. The live place never runs a
 *                        server spike, whatever its Workspace attributes or SPIKE_DEFAULTS say
 *   spikeViewerAllowed   the players a server spike sends its log lines to and takes requests from: the ones developer
 *                        mode would let in (docs/DEV_MODE.md), whether or not developer mode itself is switched on
 *
 * @module
 */
import { DEV_MODE, SPIKE_TEST_PLACES } from "shared/config";
import { devModeAllowed, type DevAccessFacts } from "shared/devmode";

/**
 * True when a server may honour a spike flag: always in Studio; on a published server only when `placeId`
 * (game.PlaceId) is a number listed in `places`. Anything else (the live place, 0, NaN, not a number) is refused.
 */
export function serverSpikeAllowed(
	studio: boolean,
	placeId: unknown,
	places: ReadonlyArray<number> = SPIKE_TEST_PLACES,
): boolean {
	if (studio) return true;
	if (!typeIs(placeId, "number") || placeId !== placeId || placeId <= 0) return false;
	return places.includes(placeId);
}

/**
 * True when a server spike may send its log lines to this player and act on their requests: everyone in Studio; on a
 * published server a UserId in DEV_MODE.allowedUserIds or the user-owned place's creator. DEV_MODE.enabled is not
 * read: a build with developer mode off can still run a spike in its test place.
 */
export function spikeViewerAllowed(facts: Readonly<DevAccessFacts>): boolean {
	return devModeAllowed(facts, {
		enabled: true,
		allowedUserIds: DEV_MODE.allowedUserIds,
		allowPlaceCreator: DEV_MODE.allowPlaceCreator,
	});
}
