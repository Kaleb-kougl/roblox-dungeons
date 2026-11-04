/**
 * The Goldling's hit and catch hooks (docs/FORTUNE.md "Payouts", GE2 / GE3, FD12), called from its archetype's onHit /
 * onDeath (combat/actors/archetypes/golden.ts). No-op without state.golden, or for an actor that is not this floor's
 * running Goldling (a stray one a spec spawned by hand). Draws only the Goldling's own stream.
 *
 *   hit     a damaging hit (damage > 0 after the cap): score.ts scoreGoldenHit (hitPoints x the kills' floor scale into
 *           ScoreSource.GOLDEN; NO combo feed), coins += its points, hits + 1, events.hits.
 *   catch   the kill. killActor already scored it (score.ts scoreKill: killPoints x the floor scale into GOLDEN, the
 *           combo fed once; events.jackpot) and skipped the drop roll (DROP_INELIGIBLE_ARCHETYPES). Here: status CAUGHT,
 *           caught + 1, and with boost drops (state.drops) partySize + extraBoosts boosts: per boost in order ONE
 *           golden-stream draw (drops' breakLoot.ts weightedBoostKind: the BOOSTS weights), then it lands in the lowest
 *           free ground slot at the catch point + GOLDEN_BOOST_RING[i] x GOLDEN_BOOST_RING_RADIUS (the catch point itself
 *           when that spot is not open floor of the room: a wall, a doorway or an intact breakable), or, with every slot
 *           taken, is lost (events.caught.lost). The draw count is fixed (partySize + extraBoosts) whatever lands.
 *           events.caught.
 */
import { cellKey, worldToGrid } from "shared/dungeon";
import type { ActorState } from "../combat/actors/types";
import type { SimState } from "../state";
import { partySize } from "../party";
import { solidCells } from "../breakables/cells";
import { landDrop, lowestFreeDropSlot, weightedBoostKind } from "../drops/breakLoot";
import { scoreGoldenHit } from "../score/score";
import { GOLDEN_BOOST_RING, GOLDEN_BOOST_RING_RADIUS, GoldenStatus } from "./goldenData";
import { goldenInRoom } from "./goldenField";
import type { GoldenState } from "./golden";

/** state.golden when `a` is its running Goldling, else undefined. */
function ownGolden(state: Readonly<SimState>, a: Readonly<ActorState>): GoldenState | undefined {
	const g = state.golden;
	if (g === undefined || g.status !== GoldenStatus.RUNNING || g.actorId !== a.id) return undefined;
	return g;
}

/** A damaging hit on the Goldling `a` by `player` (onHit with damage > 0). */
export function goldenOnHit(state: SimState, a: Readonly<ActorState>, player: number): void {
	const g = ownGolden(state, a);
	if (g === undefined) return;
	const points = scoreGoldenHit(state);
	g.coins += points;
	g.hits += 1;
	g.events.hits.push({ x: a.x, z: a.z, player, points, hits: g.hits });
}

/** True when world (x, z) is open floor of the Goldling's room (its walk mask, no intact breakable). */
function openSpot(state: Readonly<SimState>, g: Readonly<GoldenState>, x: number, z: number): boolean {
	if (!goldenInRoom(g, x, z)) return false;
	const solid = solidCells(state);
	return solid === undefined || !solid.has(cellKey(worldToGrid(x), worldToGrid(z)));
}

/** The Goldling `a` was killed by `player` (onDeath). */
export function goldenOnCaught(state: SimState, a: Readonly<ActorState>, player: number): void {
	const g = ownGolden(state, a);
	if (g === undefined) return;
	g.status = GoldenStatus.CAUGHT;
	g.caught += 1;
	const boosts: number[] = [];
	let lost = 0;
	const d = state.drops;
	if (d !== undefined) {
		const n = partySize(state) + g.config.extraBoosts;
		for (let i = 0; i < n; i++) {
			const kind = weightedBoostKind(g);
			const slot = lowestFreeDropSlot(d);
			if (slot < 0) {
				lost++;
				continue;
			}
			const off = GOLDEN_BOOST_RING[i % GOLDEN_BOOST_RING.size()];
			let x = a.x + off[0] * GOLDEN_BOOST_RING_RADIUS;
			let z = a.z + off[1] * GOLDEN_BOOST_RING_RADIUS;
			if (!openSpot(state, g, x, z)) {
				x = a.x;
				z = a.z;
			}
			landDrop(d, slot, kind, x, z, state.tick);
			boosts.push(slot);
		}
	}
	g.events.caught = { x: a.x, z: a.z, player, points: g.events.jackpot, boosts, lost };
}
