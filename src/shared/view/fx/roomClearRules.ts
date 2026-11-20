/**
 * The room clear celebration's freeze-frame hooks (docs/ROOM_CLEAR.md RC5), a port module apart from freezeRules.ts
 * (the web port). Solo only for the slow motion (RCD4): the caller never asks in co-op, where the clock does not pace
 * the sim (simPacerFor). The clock ignores the request when freezeFrameOn(settings) is false.
 *
 * @module
 */
import type { JuiceSettings } from "shared/settings";
import type { NudgeKind } from "./freezeRules";
import type { HitstopClock } from "./hitstop";
import { screenShakeOn } from "./juiceRules";
import { ROOM_CLEAR } from "./roomClearConfig";
import type { RoomClear } from "./roomClears";

/** Asks the clear's slow-motion ramp (RCD11). Returns true when the clock took it. */
export function applyRoomClearSlowMo(
	c: Pick<RoomClear, "perfect">,
	clock: HitstopClock,
	settings: Readonly<JuiceSettings>,
): boolean {
	if (!settings.roomClear) return false;
	const s = c.perfect ? ROOM_CLEAR.slowMo.perfect : ROOM_CLEAR.slowMo.clear;
	return clock.requestSlowMo(s.ms, s.fromScale, settings);
}

/** The stamp's camera kick: "stamp", or "none" with Room clear or screen shake off (or reduced motion). */
export function stampNudgeFor(settings: Readonly<JuiceSettings>): NudgeKind {
	return settings.roomClear && screenShakeOn(settings) ? "stamp" : "none";
}
