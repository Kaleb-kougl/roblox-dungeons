/**
 * When a floor modifier's promise pays off (docs/FLOOR_MODIFIERS.md Player experience, FM6): the status chip pulses
 * once, on the first frame of the floor that shows the promised thing. Pure and fed per frame with plain data
 * (ModifierPayoffInput), so it is deterministic and tested headlessly (modifiers.spec.ts); read-only on the sim.
 *
 *   Gilded      the Goldling appears          GoldenFrameSource.appeared (RunView.golden) non-empty
 *   Hoard       the vault's room engages      TreasureFrameSource.armed (RunView.treasure) non-empty: the sim's
 *                                             TreasureEvents.armed, SEALED -> ARMED on its score record's engagement
 *   Feast       the power pellet is taken     PelletFrameSource.power (RunView.pellets) non-empty
 *   Plunder     the first loaded piece breaks BoostEventSource.fromPiece + lostLoot (RunView.boostEvents) non-empty
 *                                             (a boost hopped out, or the ground was full and it fizzled)
 *   Blood Moon  a room with an elite engages  affixedRoomEngaged(state): an engaged score record (engageTick >= 0)
 *                                             with a living affixed member (the sim stamps the affixes as the room's
 *                                             planned spawns appear, so this turns true on the engagement)
 *
 * The four event sources are the run view's per-frame collections (every tick the frame ran, every player's), so a
 * payoff is never missed between frames; Blood Moon reads state (a level that holds while an elite of an engaged room
 * lives), which the once-per-floor latch turns into one edge.
 */
import { AffixKind, FloorModifier } from "shared/dungeon";
import { affixSlotAt, type SimState } from "shared/sim";
import type { BoostEventSource } from "../boosts";
import type { GoldenFrameSource } from "../golden";
import type { PelletFrameSource } from "../pellets";
import type { TreasureFrameSource } from "../treasure";

/** One frame's facts ModifierPayoff reads. Plain data; modifierPayoffInput builds it from a RunView. */
export interface ModifierPayoffInput {
	/** The current endless floor (state.endless.floor; NO_PAYOFF_FLOOR outside endless). */
	readonly floor: number;
	/** That floor's modifier (EndlessFloorLayout.modifier / EndlessFloorWorld.modifier; FloorModifier.NONE for none). */
	readonly modifier: number;
	/** Goldlings that appeared this frame (RunView.golden.appeared.size()). */
	readonly goldenAppeared: number;
	/** Vaults that armed this frame, i.e. their room engaged (RunView.treasure.armed.size()). */
	readonly vaultArmed: number;
	/** Power pellets taken this frame (RunView.pellets.power.size()). */
	readonly powerTaken: number;
	/** Loaded pieces broken this frame (RunView.boostEvents.fromPiece.size() + lostLoot.size()). */
	readonly pieceLoot: number;
	/** An engaged room holds a living affixed member (affixedRoomEngaged(RunView.state)). */
	readonly affixedEngaged: boolean;
}

/** ModifierPayoffInput.floor outside an endless run (no state.endless), and ModifierPayoff's floor before any reset. */
export const NO_PAYOFF_FLOOR = -1;

/** What modifierPayoffInput reads: shared/play RunView satisfies it (LiveRun and the lockstep client alike). */
export interface ModifierPayoffSources {
	readonly state: Readonly<SimState>;
	readonly golden: GoldenFrameSource;
	readonly treasure: TreasureFrameSource;
	readonly pellets: PelletFrameSource;
	readonly boostEvents: BoostEventSource;
}

/**
 * An engaged room holds a living affixed member: some score record (state.score.rooms) with engageTick >= 0 whose
 * member slot still holds that member (memberIds) and carries an affix (state.affixes, the actorId guard). False without
 * scoring or affixes. Pure; read-only on the sim.
 */
export function affixedRoomEngaged(state: Readonly<SimState>): boolean {
	const score = state.score;
	if (score === undefined || state.affixes === undefined) return false;
	const actors = state.combat.actors;
	for (const rec of score.rooms) {
		if (rec.engageTick < 0) continue;
		for (let i = 0; i < rec.memberSlots.size(); i++) {
			const slot = rec.memberSlots[i];
			const a = actors[slot];
			if (a === undefined || a.id !== rec.memberIds[i]) continue;
			const s = affixSlotAt(state, slot, a);
			if (s !== undefined && s.affix !== AffixKind.NONE) return true;
		}
	}
	return false;
}

/**
 * This frame's ModifierPayoffInput from a run view (`view`: RunView, after its frame ran) and the current floor's
 * modifier (`modifier`: the floor layout's, EndlessFloorLayout.modifier, which the client already reads for the card).
 */
export function modifierPayoffInput(view: ModifierPayoffSources, modifier: number): ModifierPayoffInput {
	const state = view.state;
	return {
		floor: state.endless?.floor ?? NO_PAYOFF_FLOOR,
		modifier,
		goldenAppeared: view.golden.appeared.size(),
		vaultArmed: view.treasure.armed.size(),
		powerTaken: view.pellets.power.size(),
		pieceLoot: view.boostEvents.fromPiece.size() + view.boostEvents.lostLoot.size(),
		affixedEngaged: modifier === FloorModifier.BLOOD_MOON && affixedRoomEngaged(state),
	};
}

/** Does this frame show `input.modifier`'s promised thing (see the file comment)? NONE / unknown: never. */
export function modifierPaysOff(input: ModifierPayoffInput): boolean {
	const m = input.modifier;
	if (m === FloorModifier.GILDED) return input.goldenAppeared > 0;
	if (m === FloorModifier.HOARD) return input.vaultArmed > 0;
	if (m === FloorModifier.FEAST) return input.powerTaken > 0;
	if (m === FloorModifier.PLUNDER) return input.pieceLoot > 0;
	if (m === FloorModifier.BLOOD_MOON) return input.affixedEngaged;
	return false;
}

/**
 * The once-per-floor payoff latch: `frame(input)` is true on exactly one frame per floor, the first whose input pays
 * off (modifierPaysOff), and false on every other. Call `reset(floor)` when the floor changes (the new floor, before its
 * first frame is fed). A frame of another floor than the latch's resets it to that floor and pays nothing (its events
 * may still be the old floor's), so a client that never calls reset still pulses once per floor from the second frame
 * on. Plain state; one per client (the chip's).
 */
export class ModifierPayoff {
	private floor = NO_PAYOFF_FLOOR;
	private paid = false;

	/** A new floor: its promise has not paid off yet. */
	reset(floor: number): void {
		this.floor = floor;
		this.paid = false;
	}

	/** This frame (see the class comment): true only on the floor's payoff frame. */
	frame(input: ModifierPayoffInput): boolean {
		if (input.floor !== this.floor) {
			this.reset(input.floor);
			return false;
		}
		if (this.paid || !modifierPaysOff(input)) return false;
		this.paid = true;
		return true;
	}

	/** The current floor's promise has paid off (the chip stays steady after its pulse). */
	hasPaid(): boolean {
		return this.paid;
	}

	/** The floor the latch is on (NO_PAYOFF_FLOOR before the first reset). */
	currentFloor(): number {
		return this.floor;
	}
}
