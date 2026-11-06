/**
 * Draft cards in runs with builds (docs/BUILDS.md BU2): the offers (drawCardOffers) and taking a card (grantCard).
 * progression.ts calls both when state.builds exists; without it the draft is today's (drawBoonOffers / grantBoon).
 *
 * Offers (drawCardOffers; every draw from the sim rng, in this order):
 *   pools   new      unowned boons (every Boon index, the on-kill boons included)
 *           upgrade  owned common / rare boons below their max level (level II boons are the evolutions)
 *           duo      duos whose two boons the player owns (any level), not yet taken
 *   0. a guaranteed duo (the first deal of a boss double draft, BUD3) with the duo pool not empty: card 0 is a duo, one
 *      rngInt pick, no type roll
 *   1. per remaining card, in card order, one rngInt(0, 99) type roll: below duoPercent(floor) -> duo; else below
 *      duoPercent + upgradePercent -> upgrade; else new. A kind that cannot give a card (its pool empty; duo: a duo is
 *      already in this draft) falls through to the next, cycling duo -> upgrade -> new -> duo; nothing left: fewer cards.
 *      duo: one rngInt pick. upgrade: one rngInt over the summed weights (level II weighs evolutionWeight, level I 1),
 *      pool order. new: today's two draws (rarity roll, then a pick among that rarity; none left of it: among all).
 *   2. upgrade pity: with an upgradable boon owned, at least upgradePityCards cards and none of them an upgrade, the
 *      last card is replaced by an upgrade pick (one more rngInt).
 *   Picked cards leave their pool (no duplicates); maxed boons and taken duos are never in one.
 *
 * Taking a card (grantCard): a boon card raises its level by one (level I also appends it to RunPlayerState.boons) and
 * applies Hearty / Deep Flask / Warding's one-off step for the level gained; a duo card appends the duo. Then the
 * player's mods are rebuilt at their levels.
 */
import { jsMin } from "shared/jsmath";
import { rngInt, type RngHolder } from "../rng";
import type { SimState } from "../state";
import { playerAt } from "../party";
import { rarityForRoll } from "../progression/rarity";
import { refreshRunMods, runPlayer } from "../progression/runMods";
import {
	ARMOR_BOON_PIPS_TOTAL,
	BASTION_ARMOR_PIPS,
	BOONS,
	BOON_COUNT,
	BOON_MAX_LEVEL,
	Boon,
	DRAFT_OFFER_COUNT,
	Rarity,
	FLASK_BOON_CHARGES_TOTAL,
	HEART_BOON_HALF_HEARTS_TOTAL,
	RARITY_ROLL_RANGE,
	boonMaxLevel,
	levelValue,
} from "../progression/progressionData";
import {
	CardKind,
	DUOS,
	DUO_COUNT,
	boonCard,
	cardBoon,
	cardDuo,
	duoCard,
	type BuildRules,
	type CardKindId,
} from "./buildsData";
import { buildPlayer } from "./builds";

/** The duo band of the type roll after `floorCleared` floors: base + perFloor x floorCleared, at most max (BUD3). */
export function duoPercent(rules: Readonly<BuildRules>, floorCleared: number): number {
	const p = rules.duoPercentBase + rules.duoPercentPerFloor * (floorCleared > 0 ? floorCleared : 0);
	return jsMin(rules.duoPercentMax, p);
}

/** True when a player with `levels` / `duos` can be offered duo `d`: both its boons owned, not yet taken. */
export function duoAvailable(levels: ReadonlyArray<number>, duos: ReadonlyArray<number>, d: number): boolean {
	const def = DUOS[d];
	if (def === undefined || duos.includes(d)) return false;
	return (levels[def.a] ?? 0) > 0 && (levels[def.b] ?? 0) > 0;
}

/** The kinds a card can be, in fall-through order (duo -> upgrade -> new -> duo). */
const KIND_CYCLE: ReadonlyArray<CardKindId> = [CardKind.DUO, CardKind.UPGRADE, CardKind.NEW];

/**
 * The cards a draft after `floorCleared` offers a player with builds `levels` / `duos` (see the file comment).
 * `guaranteeDuo`: the first deal of a boss double draft. Card ids (buildsData DUO_CARD_BASE), card order.
 */
export function drawCardOffers(
	rng: RngHolder,
	rules: Readonly<BuildRules>,
	levels: ReadonlyArray<number>,
	duos: ReadonlyArray<number>,
	floorCleared: number,
	guaranteeDuo = false,
): number[] {
	const fresh: number[] = [];
	const upgrades: number[] = [];
	for (let b = 0; b < BOON_COUNT; b++) {
		const level = levels[b] ?? 0;
		if (level <= 0) fresh.push(b);
		else if (level < boonMaxLevel(b)) upgrades.push(b);
	}
	const duoPool: number[] = [];
	for (let d = 0; d < DUO_COUNT; d++) if (duoAvailable(levels, duos, d)) duoPool.push(d);
	const upgradable = upgrades.size() > 0;

	const out: number[] = [];
	let hasDuo = false;
	let hasUpgrade = false;
	const pickDuo = () => {
		const d = duoPool[rngInt(rng, 0, duoPool.size() - 1)];
		duoPool.remove(duoPool.indexOf(d));
		hasDuo = true;
		return duoCard(d);
	};
	const pickUpgrade = () => {
		let total = 0;
		for (const b of upgrades) total += (levels[b] ?? 0) >= BOON_MAX_LEVEL - 1 ? rules.evolutionWeight : 1;
		let r = rngInt(rng, 0, total - 1);
		let at = upgrades.size() - 1;
		for (let k = 0; k < upgrades.size(); k++) {
			const w = (levels[upgrades[k]] ?? 0) >= BOON_MAX_LEVEL - 1 ? rules.evolutionWeight : 1;
			if (r < w) {
				at = k;
				break;
			}
			r -= w;
		}
		const b = upgrades.remove(at)!;
		hasUpgrade = true;
		return boonCard(b);
	};
	const pickNew = () => {
		const rarity = rarityForRoll(rngInt(rng, 0, RARITY_ROLL_RANGE - 1), floorCleared);
		let pool = fresh.filter((b) => BOONS[b].rarity === rarity);
		if (pool.size() === 0) pool = fresh;
		const b = pool[rngInt(rng, 0, pool.size() - 1)];
		fresh.remove(fresh.indexOf(b));
		return boonCard(b);
	};
	const canGive = (kind: CardKindId) =>
		kind === CardKind.DUO
			? duoPool.size() > 0 && !hasDuo
			: kind === CardKind.UPGRADE
			? upgrades.size() > 0
			: fresh.size() > 0;

	if (guaranteeDuo && duoPool.size() > 0) out.push(pickDuo());
	const duoBand = duoPercent(rules, floorCleared);
	while (out.size() < DRAFT_OFFER_COUNT) {
		const roll = rngInt(rng, 0, RARITY_ROLL_RANGE - 1);
		const preferred = roll < duoBand ? 0 : roll < duoBand + rules.upgradePercent ? 1 : 2;
		let kind: CardKindId | -1 = -1;
		for (let k = 0; k < KIND_CYCLE.size(); k++) {
			const candidate = KIND_CYCLE[(preferred + k) % KIND_CYCLE.size()];
			if (canGive(candidate)) {
				kind = candidate;
				break;
			}
		}
		if (kind === -1) break;
		out.push(kind === CardKind.DUO ? pickDuo() : kind === CardKind.UPGRADE ? pickUpgrade() : pickNew());
	}

	// Upgrade pity: an owned upgradable boon always shows up in a full draft.
	if (upgradable && !hasUpgrade && out.size() >= rules.upgradePityCards && upgrades.size() > 0) {
		out[out.size() - 1] = pickUpgrade();
	}
	return out;
}

/**
 * Pacts' Greed (docs/FORTUNE.md PS3, FD4): the legendary cards a player with builds `levels` / `duos` can be dealt, in
 * pool order: unowned legendary boons (Boon order: new, level I is their only level), available duos (Duo order), owned
 * common / rare boons at level II (Boon order: the card is their evolution, level III). Pure.
 */
export function legendaryPool(levels: ReadonlyArray<number>, duos: ReadonlyArray<number>): number[] {
	const out: number[] = [];
	for (let b = 0; b < BOON_COUNT; b++)
		if (BOONS[b].rarity === Rarity.LEGENDARY && (levels[b] ?? 0) <= 0) out.push(boonCard(b));
	for (let d = 0; d < DUO_COUNT; d++) if (duoAvailable(levels, duos, d)) out.push(duoCard(d));
	for (let b = 0; b < BOON_COUNT; b++)
		if (boonMaxLevel(b) === BOON_MAX_LEVEL && (levels[b] ?? 0) === BOON_MAX_LEVEL - 1) out.push(boonCard(b));
	return out;
}

/**
 * Greed's Legendary deal (PS3, FD4): up to `count` cards. Per card, in card order, one rngInt pick among the legendary
 * pool's cards not dealt yet (legendaryPool); once that pool is empty, one rngInt pick among the ordinary upgrades not
 * dealt yet (owned common / rare boons at level I, Boon order: level II), so the deal holds `count` cards whenever
 * enough is upgradable. Fewer when both run out (an empty legendary pool: Greed is not offered, pacts/stepPacts.ts).
 * Card ids, card order.
 */
export function drawLegendaryOffers(
	rng: RngHolder,
	levels: ReadonlyArray<number>,
	duos: ReadonlyArray<number>,
	count: number,
): number[] {
	const pool = legendaryPool(levels, duos);
	const fill: number[] = [];
	for (let b = 0; b < BOON_COUNT; b++)
		if (boonMaxLevel(b) === BOON_MAX_LEVEL && (levels[b] ?? 0) > 0 && (levels[b] ?? 0) < BOON_MAX_LEVEL - 1)
			fill.push(boonCard(b));
	const out: number[] = [];
	while (out.size() < count) {
		const from = pool.size() > 0 ? pool : fill;
		if (from.size() === 0) break;
		out.push(from.remove(rngInt(rng, 0, from.size() - 1))!);
	}
	return out;
}

/**
 * Player `playerIndex`'s offers for a draft after `floorCleared` (drawCardOffers on their build, the sim rng). Empty
 * without builds or for a player who is not there.
 */
export function drawPlayerCardOffers(
	state: SimState,
	playerIndex: number,
	floorCleared: number,
	guaranteeDuo: boolean,
): number[] {
	const s = state.builds;
	const bp = buildPlayer(state, playerIndex);
	if (s === undefined || bp === undefined) return [];
	return drawCardOffers(state, s.config, bp.levels, bp.duos, floorCleared, guaranteeDuo);
}

/** Hearty / Deep Flask / Warding: the one-off step of reaching `level` (the table's total minus the level below's). */
function levelStep(totals: ReadonlyArray<number>, level: number): number {
	return levelValue(totals, level) - (level > 1 ? levelValue(totals, level - 1) : 0);
}

function applyLevelGained(state: SimState, playerIndex: number, boon: number, level: number): void {
	const pl = playerAt(state, playerIndex);
	if (boon === Boon.HEARTY) {
		const step = levelStep(HEART_BOON_HALF_HEARTS_TOTAL, level);
		pl.heartsMax += step;
		if (pl.dead === 0) pl.hearts = jsMin(pl.heartsMax, pl.hearts + step);
	} else if (boon === Boon.DEEP_FLASK) {
		const step = levelStep(FLASK_BOON_CHARGES_TOTAL, level);
		pl.flaskMax += step;
		pl.flask += step;
	} else if (boon === Boon.WARDING) {
		const step = levelStep(ARMOR_BOON_PIPS_TOTAL, level);
		pl.armorMax += step;
		pl.armor += step;
	} else if (boon === Boon.BASTION) {
		// docs/LEGENDARIES.md LG3: Bastion's pip (level I, its only level), like Warding I.
		pl.armorMax += BASTION_ARMOR_PIPS;
		pl.armor += BASTION_ARMOR_PIPS;
	}
}

/**
 * Player `playerIndex` takes `card` (see the file comment). Returns what it was (CardKind), or -1 when it did nothing
 * (no builds, a maxed boon, a taken or unavailable duo, not a card).
 */
export function grantCard(state: SimState, playerIndex: number, card: number): CardKindId | -1 {
	const p = runPlayer(state, playerIndex);
	const bp = buildPlayer(state, playerIndex);
	const s = state.builds;
	if (p === undefined || bp === undefined || s === undefined) return -1;
	const d = cardDuo(card);
	if (d >= 0) {
		if (!duoAvailable(bp.levels, bp.duos, d)) return -1;
		bp.duos.push(d);
		s.events.duoPlayer.push(playerIndex);
		s.events.duoTaken.push(d);
		refreshRunMods(p, bp);
		return CardKind.DUO;
	}
	const b = cardBoon(card);
	if (b < 0) return -1;
	const level = bp.levels[b] ?? 0;
	if (level >= boonMaxLevel(b)) return -1;
	const reached = level + 1;
	bp.levels[b] = reached;
	if (level === 0) p.boons.push(b);
	applyLevelGained(state, playerIndex, b, reached);
	// Bastion picked mid-room: its brace is ready at once (LG3).
	if (b === Boon.BASTION) bp.braceReady = 1;
	refreshRunMods(p, bp);
	if (reached === BOON_MAX_LEVEL) {
		s.events.evolvedPlayer.push(playerIndex);
		s.events.evolvedBoon.push(b);
	}
	return reached === 1 ? CardKind.NEW : reached === BOON_MAX_LEVEL ? CardKind.EVOLUTION : CardKind.UPGRADE;
}
