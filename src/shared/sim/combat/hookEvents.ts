/**
 * The Chainhook's drag feed (Roblox port, docs/NEW_ENEMIES_2.md NX3): where this tick's latches and drag ends were, for
 * the view (the chain, the snap). Unhashed, never read back by the sim: CombatState.hookEvents, cleared every tick by
 * step / stepParty beside clearEvents, copied by cloneCombatState. SimEvents.hookLatched / hookBroken count them (a
 * break is an end with a reason of ROLL or later; an arrival or a timed-out drag is an end, not a break).
 *
 * @module
 */

/** Why a drag ended (HookEvents.endReason). ARRIVED / TIMED_OUT end it; every reason from ROLL on breaks it. */
export const HookEnd = {
	/** The player reached pullStop: the yank strike follows. */
	ARRIVED: 0,
	/** dragMaxTicks passed short of pullStop (a wall held the player, or the pull was too long). */
	TIMED_OUT: 1,
	/** The hooked player rolled (rollTicks > 0). */
	ROLL: 2,
	/** The Chainhook lost line of sight to the hooked player (a pillar between them). */
	SIGHT: 3,
	/** The Chainhook died. */
	DEATH: 4,
	/** The Chainhook took breakDamage since the latch (a teammate freed you). */
	DAMAGE: 5,
	/** The hooked player died. */
	PLAYER_DEAD: 6,
} as const;
/** A `HookEnd` reason value (0 to 6), as stored in `HookEvents.endReason`. */
export type HookEnd = (typeof HookEnd)[keyof typeof HookEnd];

/** True when an end of `reason` is a break (the snap), not an arrival or a timeout. */
export function hookEndBreaks(reason: number): boolean {
	return reason >= HookEnd.ROLL;
}

/**
 * This tick's latches and drag ends as parallel arrays (index k of the `latch...` arrays is one latch, index k of the
 * `end...` arrays one end). Unhashed, never read back by the sim.
 */
export interface HookEvents {
	/** One entry per latch: the hooked player's party index and the thrower's actor slot. */
	latchPlayer: number[];
	/** Actor slot of the Chainhook that threw the hook, same index as `latchPlayer`. */
	latchSlot: number[];
	/** One entry per drag end: the player, the thrower's slot and the HookEnd reason. */
	endPlayer: number[];
	/** Actor slot of the Chainhook whose drag ended, same index as `endPlayer`. */
	endSlot: number[];
	/** The `HookEnd` reason of the end, same index as `endPlayer`. */
	endReason: number[];
}

/** An empty feed (for a new `CombatState`). */
export function createHookEvents(): HookEvents {
	return { latchPlayer: [], latchSlot: [], endPlayer: [], endSlot: [], endReason: [] };
}

/** A deep copy of the feed (new arrays), for `cloneCombatState`. */
export function cloneHookEvents(e: Readonly<HookEvents>): HookEvents {
	return {
		latchPlayer: [...e.latchPlayer],
		latchSlot: [...e.latchSlot],
		endPlayer: [...e.endPlayer],
		endSlot: [...e.endSlot],
		endReason: [...e.endReason],
	};
}

/**
 * Empties the feed in place; `step` / `stepParty` call it every tick, beside `clearEvents`. Arrays that are already
 * empty are left untouched.
 */
export function clearHookEvents(e: HookEvents): void {
	if (e.latchPlayer.size() > 0) {
		e.latchPlayer.clear();
		e.latchSlot.clear();
	}
	if (e.endPlayer.size() > 0) {
		e.endPlayer.clear();
		e.endSlot.clear();
		e.endReason.clear();
	}
}
