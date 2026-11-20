/**
 * The secret chest in the tick (docs/SECRET_ROOMS.md SR4, Rules "The chest", SRD6 / SRD9). stepSecrets runs after
 * stepGolden (step.ts 9b, stepParty 10b), on every unfrozen tick; the crack itself opens inside the tick's phases
 * (./open.ts). No absolute timers.
 *
 *   OPEN -> TAKEN: the first living present player (index order) whose centre is within config.reachTiles of the
 *   chest's centre opens it for the party (the dead never open). Every living present player gets the vault's shares for
 *   the chest's tier (sim/treasure grants.ts grantShares: Rare a relic each, else the fallback boosts; Legendary a bonus
 *   deal each into state.treasure.bonusDeals with builds (taken by the next floor's draft, bonus.ts) plus its boost, a
 *   relic instead without builds or treasure), every draw on this state's stream; boosts land in front of the chest
 *   (toward the crack) or go straight to their player. Then the chest's treasure points (config.points[tier], the
 *   treasure award's multipliers) into SECRET, takenBy, taken += 1, events.taken. No lock, no allowance, no combo.
 *
 * @module
 */
import type { SimState } from "../state";
import { partySize, playerAt } from "../party";
import { scoreSecret, treasureAwardPoints } from "../score/score";
import { grantShares, livingPresent } from "../treasure/grants";
import { SECRET_UNSET, SecretStatus } from "./secretsData";
import type { SecretsState } from "./secrets";

/** The opener: the first living present player (index order) in reach of the chest's centre; SECRET_UNSET if none. */
function openerOf(state: Readonly<SimState>, sc: Readonly<SecretsState>): number {
	const n = partySize(state);
	const r2 = sc.config.reachTiles * sc.config.reachTiles;
	for (let i = 0; i < n; i++) {
		if (!livingPresent(state, i)) continue;
		const p = playerAt(state, i);
		const dx = p.x - sc.x;
		const dz = p.z - sc.z;
		if (dx * dx + dz * dz <= r2) return i;
	}
	return SECRET_UNSET;
}

/** Player `opener` opens the chest (see the file comment). */
function takeChest(state: SimState, sc: SecretsState, opener: number): void {
	const tier = sc.tier;
	sc.status = SecretStatus.TAKEN;
	sc.takenBy = opener;
	// This state is the stream (an RngHolder) and the origin (the chest's centre and facing).
	const grants = grantShares(state, sc, sc, tier, sc.config, state.treasure?.bonusDeals);
	const s = state.score;
	const points = s !== undefined ? scoreSecret(state, treasureAwardPoints(state, s, sc.config.points[tier])) : 0;
	sc.taken += 1;
	sc.events.taken = { opener, tier, points, grants };
}

/** End of every unfrozen tick, after stepGolden (see the file comment). No-op without state.secrets or an open crack. */
export function stepSecrets(state: SimState): void {
	const sc = state.secrets;
	if (sc === undefined || sc.status !== SecretStatus.OPEN) return;
	const opener = openerOf(state, sc);
	if (opener !== SECRET_UNSET) takeChest(state, sc, opener);
}
