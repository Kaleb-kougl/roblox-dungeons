/**
 * Auto-target (docs/MOBILE_IMPL.md MB5, docs/MOBILE.md MBD6): the actor a centre Attack / Alt stick aims at. Pure and
 * read-only on the sim state (the client calls it at most once per frame, and only while a centre stick needs it).
 *
 * The Goldling (docs/FORTUNE.md FD16): a target like any actor, but ranked after every other living, visible actor
 * within TOUCH.autoTarget.goldenYieldTiles: while one is that close the pick is the best of the others (the Goldling's
 * hysteresis included: a threat stepping in takes the aim off it); with none that close it ranks by the usual cost.
 */
import { TOUCH } from "shared/config";
import { TILE_SIZE, lineOfSight, type BulletBlocker } from "shared/dungeon";
import { NO_KIND, playerAt, type ActorState, type SimState } from "shared/sim";
import { isGoldenKind } from "shared/view/golden";

export interface AutoTargetQuery {
	readonly state: Readonly<SimState>;
	readonly playerIndex: number;
	/** The floor's bullet blocker (RunContext.config.isBulletBlocked); undefined = open floor. */
	readonly blocked: BulletBlocker | undefined;
	/** ActorState.id of the last target (0 = none): it keeps a bonus (hysteresis). */
	readonly previousId: number;
}

export interface AutoTarget {
	readonly id: number;
	readonly x: number;
	readonly z: number;
}

/** The actor a centre Attack / Alt aims at (docs/MOBILE.md MBD6), or undefined. Read-only on the state. */
export function pickAutoTarget(q: AutoTargetQuery): AutoTarget | undefined {
	const p = playerAt(q.state, q.playerIndex);
	const actors = q.state.combat.actors;
	const range = TOUCH.autoTarget.rangeTiles * TILE_SIZE;
	const yieldRange = TOUCH.autoTarget.goldenYieldTiles * TILE_SIZE;
	let best: ActorState | undefined = undefined;
	let bestCost = 0;
	// The best that is not the Goldling, and whether one of those stands within yieldRange (FD16).
	let other: ActorState | undefined = undefined;
	let otherCost = 0;
	let threatNear = false;
	for (let i = 0; i < actors.size(); i++) {
		const a = actors[i];
		if (a.kind === NO_KIND || a.alive !== 1) continue;
		const dx = a.x - p.x;
		const dz = a.z - p.z;
		const d = math.sqrt(dx * dx + dz * dz);
		if (d > range) continue;
		if (!lineOfSight(q.blocked, p.x, p.z, a.x, a.z)) continue;
		let cost = d;
		if (d !== 0 && (p.faceX * dx + p.faceZ * dz) / d >= TOUCH.autoTarget.coneCos) {
			cost *= TOUCH.autoTarget.coneFactor;
		}
		if (a.id === q.previousId) cost *= TOUCH.autoTarget.stickyFactor;
		// Strictly lower only: on a tie the earlier (lower) slot keeps the pick.
		if (best === undefined || cost < bestCost) {
			best = a;
			bestCost = cost;
		}
		if (isGoldenKind(a.kind)) continue;
		if (d <= yieldRange) threatNear = true;
		if (other === undefined || cost < otherCost) {
			other = a;
			otherCost = cost;
		}
	}
	if (best !== undefined && isGoldenKind(best.kind) && threatNear) best = other;
	if (best === undefined) return undefined;
	return { id: best.id, x: best.x, z: best.z };
}
