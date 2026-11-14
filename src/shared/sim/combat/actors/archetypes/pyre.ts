/**
 * 'pyre' (Roblox port, docs/NEW_ENEMIES_2.md; no web source): the brazier a Pyre-keeper lights (./pyrekeeper.ts), a
 * runtime child only: never planned, never bought, never a room member (NXD13: the room clears without it), never an
 * affix, no drop roll. 4 hp, still (speed 0), contact damage 0. Not a room enemy (no aggro, pack alerts or leash).
 *
 * Planned (NX5, not built yet): lit litTicks after it lands (no fire while lighting), then every fireTicks one aimed
 * `shot` at the nearest living player in sight (drawn with the `flame` look, NXD12); its first shot is offset by
 * shotStaggerTicks x its index among its keeper's pyres, so three never fire together (v[PYRE_FIRE] counts down to the
 * next shot). It withers at its keeper's death (v[PYRE_KEEPER] names the keeper by actor id) or at its room's clear.
 * No draws.
 *
 * NX1 skeleton: the data block and a step that does nothing (it stands; it fires nothing).
 *
 * View contract: v slots PYRE_FIRE (ticks to the next shot), PYRE_KEEPER (its keeper's actor id); lit once
 * tick - spawnTick >= litTicks.
 */

import { HIT_NORMAL, secondsToTicks } from "../../../playerData";
import { BulletKind, type BurstSpec } from "../../patterns";
import { PORT_BAND_ENEMIES_3, registerArchetype } from "../registry";
import type { ArchetypeData } from "../types";

export interface PyreData extends ArchetypeData {
	/** Lighting: no fire for this many ticks after it lands. */
	readonly litTicks: number;
	/** Ticks between shots, and the first shot's offset per index among its keeper's pyres. */
	readonly fireTicks: number;
	readonly shotStaggerTicks: number;
	/** The fireball: one aimed bullet. */
	readonly shot: BurstSpec;
}

// --- v[] slots (no shared room-enemy layout: it is not a room enemy)
/** Ticks to its next shot. */
export const PYRE_FIRE = 3;
/** Its keeper's actor id (actor ids are never reused in a run). */
export const PYRE_KEEPER = 4;

export const PYRE = registerArchetype<PyreData>({
	id: "pyre",
	band: PORT_BAND_ENEMIES_3,
	data: {
		hp: 4,
		radius: 0.4,
		speed: 0,
		contactDamage: 0,
		spriteId: "enemy.pyre",
		litTicks: secondsToTicks(0.5), // 30
		fireTicks: secondsToTicks(2), // 120
		shotStaggerTicks: secondsToTicks(0.6), // 36
		shot: {
			count: 1,
			spread: 0,
			speed: 4.5,
			life: 2.5,
			damage: HIT_NORMAL,
			kind: BulletKind.ENEMY,
		},
	},
	step() {
		// NX1 skeleton: it stands and fires nothing (NX5).
	},
});
