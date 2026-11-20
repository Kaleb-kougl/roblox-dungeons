/**
 * The Mender's heal feed (Roblox port, docs/NEW_ENEMIES_3.md NT3): every heal pulse (which ally, how much) and every
 * channel end (which Mender, why) this tick, for the view (the `+` sparks, the beam's snap). Unhashed, never read back
 * by the sim: CombatState.healEvents, cleared every tick by step / stepParty beside clearEvents, copied by
 * cloneCombatState. SimEvents.heals sums the hp healed this tick; SimEvents.healCuts counts the ends that are cuts
 * (healEndCuts: sight lost, a body on the beam, a hit on the Mender).
 *
 * @module
 */

/** Why a Mender's link or channel ended (HealEvents.endReason). Every reason from SIGHT on is a cut (the snap). */
export const HealEnd = {
	/** The ally is at full hp (a pulse filled it, or it was already full). */
	FULL: 0,
	/** The channel ran its whole channelTicks. */
	TIME: 1,
	/** The ally died (or its slot was freed). */
	ALLY_GONE: 2,
	/** The Mender leashed (its target died, or it strayed past its leash range). */
	LEASH: 3,
	/** The Mender died. */
	DEATH: 4,
	/** A wall or pillar came between the Mender and the ally (ctx.lineOfSight). */
	SIGHT: 5,
	/** A living player's body stood on the beam (PLAYER_RADIUS + beamBlockPad of the segment, between its ends). */
	BLOCKED: 6,
	/** A hit on the Mender (any hit that reached damageActor); a flinch follows. */
	DAMAGE: 7,
} as const;
export type HealEnd = (typeof HealEnd)[keyof typeof HealEnd];

/** True when an end of `reason` is a cut (the beam snaps), not a natural end. */
export function healEndCuts(reason: number): boolean {
	return reason >= HealEnd.SIGHT;
}

export interface HealEvents {
	/** One entry per heal pulse that restored hp: the healed actor's slot and the hp restored (healActor). */
	healSlot: number[];
	healAmount: number[];
	/** One entry per link / channel end: the Mender's slot and the HealEnd reason. */
	endSlot: number[];
	endReason: number[];
}

export function createHealEvents(): HealEvents {
	return { healSlot: [], healAmount: [], endSlot: [], endReason: [] };
}

export function cloneHealEvents(e: Readonly<HealEvents>): HealEvents {
	return {
		healSlot: [...e.healSlot],
		healAmount: [...e.healAmount],
		endSlot: [...e.endSlot],
		endReason: [...e.endReason],
	};
}

export function clearHealEvents(e: HealEvents): void {
	if (e.healSlot.size() > 0) {
		e.healSlot.clear();
		e.healAmount.clear();
	}
	if (e.endSlot.size() > 0) {
		e.endSlot.clear();
		e.endReason.clear();
	}
}
