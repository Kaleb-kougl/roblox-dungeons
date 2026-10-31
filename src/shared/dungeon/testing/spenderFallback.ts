/**
 * Test support for specs (never imported by the game): how often the endless room spender's "dearest" fallback fires
 * and what it buys (docs/ENEMY_VARIANTS.md EV5's open issue, measured in EV13).
 *
 * traceSpend mirrors spendEncounterBudget (./endless.ts) line for line and counts each pick made by the no-draw
 * fallback (no affordable open kind costs at least budget-left / slots-left, so the FIRST dearest affordable open kind
 * in ENDLESS_ROOM_KINDS order is taken): `saturated` when even the dearest cost in the pool is below the need (every
 * remaining slot needs more than any kind costs: the room's budget passed cap x the dearest cost), `tail` otherwise
 * (near the cap, the budget left falls between two costs), and `tied` when another open affordable kind costs the same
 * as the one taken (the order, not a weight, decided). The specs check the mirror against the real spender, draw for
 * draw, on every sample.
 *
 * tieSpend is the EV5 doc's proposed fix, for comparison only: when the fallback has two or more open kinds tied for
 * dearest, one rng draw picks among them by weight; everything else as spendEncounterBudget.
 */
import {
	ENDLESS_ROOM_ACTOR_CAP,
	ENDLESS_ROOM_KINDS,
	encounterCost,
	type DungeonRng,
	type EndlessRoomKind,
} from "shared/dungeon";

export interface SpendTrace {
	readonly kinds: string[];
	/** Picks the no-draw fallback made, split by why (see the file comment), and the tied ones among them. */
	saturated: number;
	tail: number;
	tied: number;
	/** What the fallback bought, per kind. */
	readonly fallbackKinds: Map<string, number>;
}

function open(k: EndlessRoomKind, floor: number, bought: ReadonlyMap<string, number>): boolean {
	if (k.fromFloor !== undefined && floor < k.fromFloor) return false;
	return k.maxPerRoom === undefined || (bought.get(k.kind) ?? 0) < k.maxPerRoom;
}

function spend(rng: DungeonRng, budget: number, floor: number, cap: number, breakTies: boolean): SpendTrace {
	const trace: SpendTrace = { kinds: [], saturated: 0, tail: 0, tied: 0, fallbackKinds: new Map() };
	const out = trace.kinds;
	const bought = new Map<string, number>();
	let left = budget;
	while (out.size() < cap) {
		const need = left / (cap - out.size());
		let total = 0;
		let dearest: EndlessRoomKind | undefined;
		let poolDearest = 0;
		for (const k of ENDLESS_ROOM_KINDS) {
			if (!open(k, floor, bought)) continue;
			const c = encounterCost(k.kind);
			poolDearest = math.max(poolDearest, c);
			if (c > left) continue;
			if (dearest === undefined || c > encounterCost(dearest.kind)) dearest = k;
			if (c >= need) total += k.weight;
		}
		if (dearest === undefined) break;
		let pick = dearest;
		if (total > 0) {
			let r = rng.next() * total;
			for (const k of ENDLESS_ROOM_KINDS) {
				if (!open(k, floor, bought)) continue;
				const c = encounterCost(k.kind);
				if (c > left || c < need) continue;
				pick = k;
				if (r < k.weight) break;
				r -= k.weight;
			}
		} else {
			const top = encounterCost(dearest.kind);
			let tiedWeight = 0;
			let tiedCount = 0;
			for (const k of ENDLESS_ROOM_KINDS) {
				if (!open(k, floor, bought) || encounterCost(k.kind) !== top) continue;
				tiedWeight += k.weight;
				tiedCount++;
			}
			if (poolDearest < need) trace.saturated++;
			else trace.tail++;
			if (tiedCount > 1) {
				trace.tied++;
				if (breakTies) {
					let r = rng.next() * tiedWeight;
					for (const k of ENDLESS_ROOM_KINDS) {
						if (!open(k, floor, bought) || encounterCost(k.kind) !== top) continue;
						pick = k;
						if (r < k.weight) break;
						r -= k.weight;
					}
				}
			}
			trace.fallbackKinds.set(pick.kind, (trace.fallbackKinds.get(pick.kind) ?? 0) + 1);
		}
		out.push(pick.kind);
		bought.set(pick.kind, (bought.get(pick.kind) ?? 0) + 1);
		left -= encounterCost(pick.kind);
	}
	return trace;
}

/** spendEncounterBudget's picks, with the fallback counted (see the file comment). */
export function traceSpend(
	rng: DungeonRng,
	budget: number,
	floor: number,
	cap: number = ENDLESS_ROOM_ACTOR_CAP,
): SpendTrace {
	return spend(rng, budget, floor, cap, false);
}

/** The proposed tie-break (see the file comment): a fallback tie is drawn by weight. Comparison only. */
export function tieSpend(
	rng: DungeonRng,
	budget: number,
	floor: number,
	cap: number = ENDLESS_ROOM_ACTOR_CAP,
): SpendTrace {
	return spend(rng, budget, floor, cap, true);
}
