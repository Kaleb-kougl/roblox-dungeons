/**
 * The Goldling's hit and catch hooks (docs/FORTUNE.md "Payouts", GE2 / GE3), called from its archetype's onHit /
 * onDeath (combat/actors/archetypes/golden.ts). No-op without state.golden, or for an actor that is not this floor's
 * Goldling (a stray one a spec spawned by hand).
 *
 *   hit     a damaging hit (damage > 0 after the cap): hits + 1, events.hits.
 *   catch   the kill (killActor, before onDeath's caller returns): status CAUGHT, caught + 1, events.caught.
 */
import type { ActorState } from "../combat/actors/types";
import type { SimState } from "../state";
import { GoldenStatus } from "./goldenData";
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
	g.hits += 1;
	g.events.hits.push({ x: a.x, z: a.z, player, points: 0, hits: g.hits });
}

/** The Goldling `a` was killed by `player` (onDeath). */
export function goldenOnCaught(state: SimState, a: Readonly<ActorState>, player: number): void {
	const g = ownGolden(state, a);
	if (g === undefined) return;
	g.status = GoldenStatus.CAUGHT;
	g.caught += 1;
	g.events.caught = { x: a.x, z: a.z, player, points: 0, boosts: [], lost: 0 };
}
