/**
 * Boosts from breakables in the sim (docs/BREAKABLE_DROPS.md BL2 / BL3, decisions BLD1 / BLD4-BLD7; a Roblox-port
 * feature, no web source). OPT-IN twice: only a run with SimConfig.drops whose DropsConfig.breakableLoot is set (endless:
 * ENDLESS_DROPS_CONFIG) ever fills DropsState.pieceLoot, and only then is anything here more than a no-op or the drops
 * hash group widened (drops.ts writeDropsHash). The tutorial (drops without breakables) and every other world keep it
 * empty.
 *
 * A LEAF module (state types, rng, dropsData and shared/dungeon only): breakables.ts calls dropsOnBreak from its break line,
 * and breakables.ts is imported by combat.ts while drops.ts imports combat, so a hook in drops.ts would close the
 * require cycle breakables -> drops -> combat -> breakables. drops.ts imports the landing helpers from here instead.
 *
 *   floor start   dropsOnFloorPieces(state, loot) from createSimState (floor 1, or dev mode's startFloor; sandboxes
 *                 without endless: BreakablesConfig.loot) and from stepEndless right after resetBreakables: pieceLoot
 *                 gets one entry per breakable slot of the floor (NO_BOOST), then each loot entry's kind in its slot.
 *                 The loot was rolled when the floor was built (shared/dungeon placeBreakableLoot), so the sim draws
 *                 NO rng here.
 *   break         dropsOnBreak(state, slot) from damageBreakable's break line, every source (melee, player bullet,
 *                 enemy bullet, the slam): a loaded slot lands its kind in the lowest free ground slot at the piece's
 *                 cell centre (spawnTick = this tick, full groundTicks; events.dropped and events.fromPiece), or, with
 *                 every ground slot taken, is lost (events.lostLoot). Either way the slot is emptied (it releases once).
 *                 No rng draw; kill pity (killsSinceDrop) untouched. The drop is then an ordinary ground drop: stepDrops
 *                 ages it, a player can take it on the landing tick, a floor change frees it.
 *
 * @module
 */
import { gridToWorld, type BreakableLoot } from "shared/dungeon";
import { rngInt, type RngHolder } from "../rng";
import type { SimState } from "../state";
import type { DropsState } from "./drops";
import {
	AEGIS_PIPS,
	BOOSTS,
	BOOST_COUNT,
	BOOST_TOTAL_WEIGHT,
	Boost,
	GIVEN_DROP_SLOT,
	NO_BOOST,
	boostTicks,
} from "./dropsData";

/**
 * The weighted boost kind pick over the BOOSTS weights: ONE rngInt(0, BOOST_TOTAL_WEIGHT - 1) from `h`'s stream (the
 * drops' own for a kill's drop, drops.ts pickBoostKind; the Goldling's own for its catch, sim/golden goldenHooks.ts).
 */
export function weightedBoostKind(h: RngHolder): number {
	let roll = rngInt(h, 0, BOOST_TOTAL_WEIGHT - 1);
	for (let k = 0; k < BOOST_COUNT; k++) {
		const w = BOOSTS[k].weight;
		if (roll < w) return k;
		roll -= w;
	}
	return BOOST_COUNT - 1; // unreachable: the roll is below the total weight
}

/** The lowest free ground slot, -1 when every slot is taken. */
export function lowestFreeDropSlot(d: Readonly<DropsState>): number {
	for (let i = 0; i < d.ground.size(); i++) if (d.ground[i].kind === NO_BOOST) return i;
	return -1;
}

/** `kind` lands in ground slot `slot` at (x, z) on `tick` (full ground life; events.dropped). */
export function landDrop(d: DropsState, slot: number, kind: number, x: number, z: number, tick: number): void {
	const g = d.ground[slot];
	g.kind = kind;
	g.x = x;
	g.z = z;
	g.spawnTick = tick;
	g.ticksLeft = d.config.groundTicks;
	d.events.dropped.push(slot);
}

/**
 * Player `player` gets boost `kind`: the pickup's own effect (ticks = the boost's full duration, a repeat refreshes
 * it; Aegis also its pips). stepDrops' pickups and a chest's boosts given straight to a player (docs/TREASURE.md C1)
 * both go through it. No event, no rng; no-op for a player index out of range.
 */
export function applyBoost(d: DropsState, player: number, kind: number): void {
	const bp = d.players[player];
	if (bp === undefined) return;
	bp.ticks[kind] = boostTicks(kind);
	if (kind === Boost.AEGIS) bp.aegisPips = AEGIS_PIPS;
}

/**
 * A chest's boost that found no free ground slot (docs/TREASURE.md C1): given straight to player `player` (standing at
 * (x, z)), as if picked up: applyBoost plus events.collected with slot GIVEN_DROP_SLOT at (x, z). No rng.
 */
export function giveBoost(d: DropsState, player: number, kind: number, x: number, z: number): void {
	applyBoost(d, player, kind);
	d.events.collected.push({ player, kind, slot: GIVEN_DROP_SLOT, x, z });
}

/**
 * A new floor's breakables are in place (createSimState, stepEndless after resetBreakables): pieceLoot = one NO_BOOST
 * per breakable slot, then `loot`'s kinds in their slots. No-op unless state.drops exists with
 * DropsConfig.breakableLoot; without state.breakables it stays empty. Throws on a slot or kind out of range. No rng.
 */
export function dropsOnFloorPieces(state: SimState, loot: ReadonlyArray<BreakableLoot> | undefined): void {
	const d = state.drops;
	if (d === undefined || d.config.breakableLoot !== true) return;
	const list = d.pieceLoot;
	list.clear();
	const b = state.breakables;
	if (b === undefined) return;
	const n = b.pieces.size();
	for (let i = 0; i < n; i++) list.push(NO_BOOST);
	if (loot === undefined) return;
	for (const l of loot) {
		if (!(l.slot >= 0 && l.slot < n) || l.slot % 1 !== 0)
			error(`drops: breakable loot slot ${l.slot} out of range (${n} pieces)`, 0);
		if (!(l.kind >= 0 && l.kind < BOOST_COUNT) || l.kind % 1 !== 0)
			error(`drops: breakable loot kind ${l.kind} is not a boost`, 0);
		list[l.slot] = l.kind;
	}
}

/**
 * damageBreakable's break line: the piece in breakable slot `slot` just broke (any source). A loaded slot releases its
 * boost (see the file comment) and is emptied. No-op for an unloaded slot or without drops. No rng.
 */
export function dropsOnBreak(state: SimState, slot: number): void {
	const d = state.drops;
	if (d === undefined) return;
	const kind = d.pieceLoot[slot];
	if (kind === undefined || kind === NO_BOOST) return;
	d.pieceLoot[slot] = NO_BOOST;
	const p = state.breakables?.pieces[slot];
	if (p === undefined) return;
	const x = gridToWorld(p.x);
	const z = gridToWorld(p.y);
	const g = lowestFreeDropSlot(d);
	if (g < 0) {
		d.events.lostLoot.push({ kind, x, z });
		return;
	}
	landDrop(d, g, kind, x, z, state.tick);
	d.events.fromPiece.push(g);
}
