/**
 * A chest's shares (docs/TREASURE.md TR4, lifted for docs/SECRET_ROOMS.md SR4): the grant core the vault's open
 * (stepTreasure.ts openChest) and a secret room's chest (sim/secrets stepSecrets.ts) share. Every living present player,
 * in index order, gets their own grants, every draw on the caller's stream (`rng`: an RngHolder, never state.rngState or
 * the drop stream), fixed counts per case:
 *   LEGENDARY  with builds and `bonusDeals`: bonusDeals[i] += 1 (stepRun step 1 deals it on the next floor change);
 *              otherwise the RARE relic (below). Then boosts[LEGENDARY] boost draws.
 *   RARE       one rngInt over unownedRelics(state, i) -> grantRelic; none left: relicFallbackBoosts boost draws instead.
 *              Then boosts[RARE] boost draws.
 *   COMMON     boosts[COMMON] boost draws.
 * A boost draw is pickBoostKind(rng); each boost then lands in the lowest free ground slot at the next of
 * TREASURE.boostOffsets in front of the chest (`origin`: its centre, forward along its facing (fx, fz), side along
 * (-fz, fx); landed in this open's order), events.dropped + fromChest, or with every slot taken is given straight to that
 * player (giveBoost, GIVEN_DROP_SLOT). So the draws never depend on the ground. Scoring is the caller's.
 *
 * @module
 */
import { VaultTier } from "shared/dungeon";
import { rngInt, type RngHolder } from "../rng";
import type { SimState } from "../state";
import { hasLeft, partySize, playerAt } from "../party";
import { grantRelic, unownedRelics } from "../progression/progression";
import { pickBoostKind } from "../drops/drops";
import { giveBoost, landDrop, lowestFreeDropSlot } from "../drops/breakLoot";
import { GIVEN_DROP_SLOT } from "../drops/dropsData";
import type { TreasureGrant } from "./treasure";
import { TREASURE, TREASURE_UNSET } from "./treasureData";

/** Where a chest stands and faces (world centre, facing into the room or chamber). */
export interface ChestOrigin {
	readonly x: number;
	readonly z: number;
	readonly fx: number;
	readonly fz: number;
}

/** The chest tunables the shares read (TreasureConfig's and SecretsConfig's). */
export interface ChestGrantConfig {
	readonly boosts: ReadonlyArray<number>;
	readonly relicFallbackBoosts: number;
}

/** Alive and still in the run (a solo player never leaves). */
export function livingPresent(state: Readonly<SimState>, i: number): boolean {
	return playerAt(state, i).dead === 0 && !hasLeft(state, i);
}

/**
 * `count` boost draws for player `i` (into `g`), each landed in front of the chest or given straight to them (C1).
 * `landed` counts this open's landings so far (the offset index); returns it updated.
 */
function grantBoosts(
	state: SimState,
	rng: RngHolder,
	origin: ChestOrigin,
	i: number,
	count: number,
	g: TreasureGrant,
	landed: number,
): number {
	const d = state.drops;
	const offsets = TREASURE.boostOffsets;
	for (let k = 0; k < count; k++) {
		const kind = pickBoostKind(rng);
		g.boosts.push(kind);
		if (d === undefined) {
			g.slots.push(TREASURE_UNSET);
			continue;
		}
		const slot = lowestFreeDropSlot(d);
		if (slot < 0) {
			const p = playerAt(state, i);
			giveBoost(d, i, kind, p.x, p.z);
			g.slots.push(GIVEN_DROP_SLOT);
			continue;
		}
		const o = offsets[landed % offsets.size()];
		const x = origin.x + origin.fx * o.forward - origin.fz * o.side;
		const z = origin.z + origin.fz * o.forward + origin.fx * o.side;
		landDrop(d, slot, kind, x, z, state.tick);
		d.events.fromChest.push(slot);
		g.slots.push(slot);
		landed += 1;
	}
	return landed;
}

/** A Rare share for player `i`: one relic draw over their unowned pool, or (none left) the fallback boosts. */
function grantRelicShare(
	state: SimState,
	rng: RngHolder,
	origin: ChestOrigin,
	config: Readonly<ChestGrantConfig>,
	i: number,
	g: TreasureGrant,
	landed: number,
): number {
	const left = unownedRelics(state, i);
	if (left.size() === 0) return grantBoosts(state, rng, origin, i, config.relicFallbackBoosts, g, landed);
	const relic = left[rngInt(rng, 0, left.size() - 1)];
	grantRelic(state, i, relic);
	g.relic = relic;
	return landed;
}

/**
 * Every living present player's share of a chest of `tier` at `origin` (see the file comment), drawn on `rng`; a
 * Legendary's bonus deals go into `bonusDeals` (per player; undefined: none, the relic instead). Returns the grants,
 * index order.
 */
export function grantShares(
	state: SimState,
	rng: RngHolder,
	origin: ChestOrigin,
	tier: number,
	config: Readonly<ChestGrantConfig>,
	bonusDeals: number[] | undefined,
): TreasureGrant[] {
	const grants: TreasureGrant[] = [];
	let landed = 0;
	const n = partySize(state);
	for (let i = 0; i < n; i++) {
		if (!livingPresent(state, i)) continue;
		const g: TreasureGrant = { player: i, relic: TREASURE_UNSET, bonusDeal: 0, boosts: [], slots: [] };
		if (tier === VaultTier.LEGENDARY) {
			if (state.builds !== undefined && bonusDeals !== undefined) {
				bonusDeals[i] += 1;
				g.bonusDeal = 1;
			} else landed = grantRelicShare(state, rng, origin, config, i, g, landed);
			landed = grantBoosts(state, rng, origin, i, config.boosts[tier], g, landed);
		} else if (tier === VaultTier.RARE) {
			landed = grantRelicShare(state, rng, origin, config, i, g, landed);
			landed = grantBoosts(state, rng, origin, i, config.boosts[tier], g, landed);
		} else landed = grantBoosts(state, rng, origin, i, config.boosts[tier], g, landed);
		grants.push(g);
	}
	return grants;
}
