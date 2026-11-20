/**
 * Absolute-tick timers through a mid-floor freeze (docs/FORTUNE.md "Pacts", Greed's deal). A LEAF: it writes hashed
 * fields of state.score / state.pacts / state.golden / state.treasure / state.affixes through the state types only.
 *
 * Every open draft freezes the world while state.tick still counts (step.ts). Before pacts a draft opened only on a
 * floor change, when no timer was live. Greed opens one mid-floor, so a teammate can hold the world frozen while a room
 * is engaged, and the timers stored as an absolute tick would run on through the freeze. holdAbsoluteTimers, called on
 * every frozen tick of a run with state.pacts (step() and stepParty()), moves each live one 1 tick later, so every
 * "ticks since" / "ticks until" reads after the freeze exactly as if it had never happened:
 *   score    the engageTick of every engaged, uncleared room record (FAST's par: parTicks - (tick - engageTick))
 *   horde    waveDueTick while wave 2 is telegraphed and unspawned (the telegraph keeps its length)
 *   golden   RUNNING: fieldTick (the flee field's re-read period; the field cache is keyed on it and rebuilds the same).
 *            A WAITING one has no timer (docs/GOLDLING_RUMOURS.md GR2: it comes out when a player breaks its piece; its
 *            latched engageTick is only read as "engaged yet").
 *   treasure a live lock (ARMED / CRACKED, its record engaged and uncleared): armTick (it stays the record's engageTick,
 *            docs/TREASURE.md TR3) and, once cracked, crackTick (a SWIFT clear's missBy = clear tick - crackTick)
 *   affixes  a Vengeful corpse's vengeArmTick while its ring is armed (vengeTicks > 0, the slot's actor still there)
 * Countdowns (combo timer, boost timers, ground life, the Goldling's ticks left, SWIFT's ticksLeft, actor timers) only
 * run in the steps a frozen tick skips and need nothing. A no-op on a floor-change draft (no record engaged, the vault
 * SEALED or gone, the Goldling hidden or gone, every actor freed), so a pacts run whose drafts all open on a floor change
 * hashes as before. No rng, no new state.
 *
 * @module
 */
import { AffixKind } from "shared/dungeon";
import type { SimState } from "../state";
import { NO_KIND } from "../combat/actors/types";
import { GoldenStatus } from "../golden/goldenData";
import { TREASURE_UNSET, VaultStatus } from "../treasure/treasureData";
import { HORDE_NONE, HORDE_WAVE_PENDING } from "./pactsData";

/** See the file comment. No-op without state.pacts. */
export function holdAbsoluteTimers(state: SimState): void {
	if (state.pacts === undefined) return;
	const score = state.score;
	if (score !== undefined) {
		for (const r of score.rooms) if (r.engageTick >= 0 && r.cleared === 0) r.engageTick += 1;
	}
	const h = state.pacts.horde;
	if (h.room >= 0 && h.spawned === HORDE_WAVE_PENDING && h.waveDueTick !== HORDE_NONE) h.waveDueTick += 1;
	const g = state.golden;
	if (g !== undefined) {
		if (g.status === GoldenStatus.RUNNING && g.fieldTick >= 0) g.fieldTick += 1;
	}
	const t = state.treasure;
	if (t !== undefined && (t.status === VaultStatus.ARMED || t.status === VaultStatus.CRACKED)) {
		if (t.armTick !== TREASURE_UNSET) t.armTick += 1;
		if (t.crackTick !== TREASURE_UNSET) t.crackTick += 1;
	}
	const affixes = state.affixes;
	if (affixes !== undefined) {
		const actors = state.combat.actors;
		const n = math.min(actors.size(), affixes.slots.size());
		for (let i = 0; i < n; i++) {
			const x = affixes.slots[i];
			if (x.affix !== AffixKind.VENGEFUL || x.vengeTicks <= 0 || x.vengeArmTick < 0) continue;
			const a = actors[i];
			if (a.kind === NO_KIND || a.id !== x.actorId) continue;
			x.vengeArmTick += 1;
		}
	}
}
