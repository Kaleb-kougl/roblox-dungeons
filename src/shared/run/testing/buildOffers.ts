/**
 * Test support for specs (never imported by the game): docs/BUILDS.md BU13's offer statistics. Simulated drafts on the
 * real offer function (sim/builds drawCardOffers with BUILD_RULES), one player, outside the sim: each simulated run
 * keeps its own levels / duos and its own Rng (seeded from the run index, so the draws are not the ones a real run
 * would interleave with combat, but they come from the same generator and the same rules). Measurements only.
 *
 * A run: after each floor cleared 1..lastFloor one draft, two after a boss floor (BUILD_RULES.bossFloorDrafts; the first
 * deal guarantees a duo when one is available, as openDraft passes `deals > 1`), the pick applied as grantCard would
 * (a boon card raises its level, a duo card is taken). "By floor N" = after the drafts of floors 1..N-1: the build a
 * player walks onto floor N with (floor 6: 6 picks, floor 11: 12).
 *
 * Policies: "greedy" takes an evolution if offered, else a duo, else an upgrade, else the first card; "random" takes a
 * uniformly random card (its own Rng, so the offers' draws do not depend on the policy's); "duo-seeking" takes an
 * evolution, else a duo, else a new boon that completes a duo with a boon already owned, else an upgrade, else the first
 * card (a player who plays for duos).
 *
 * Upgrade pity: a draft's offers are drawn twice from the same rng state, once with the real rules and once with the
 * pity off (upgradePityCards = huge); both draw the same cards up to the pity step, so the pity fired exactly when the
 * player had an upgradable boon, the pity-off draft has at least upgradePityCards cards and none of them is an upgrade
 * (the real draft then differs in its last card only, which is checked).
 *
 * docs/LEGENDARIES.md LG7 adds legendary tallies per checkpoint: legendaries owned, runs owning each boon, drafts and
 * runs that offered each boon as a New card, and Greed's deal (drawLegendaryOffers, PACT_LEGENDARY_CARDS cards, on a
 * third rng stream per run so neither the offers nor the policy draw differently) for the build at the checkpoint, by
 * card kind: new legendary, duo, evolution (a level-II boon), fill (an ordinary upgrade).
 *
 * docs/ARCHER.md AR2: an optional boon mask (`eligible`, sim eligibleBoonMask of a character's loadout) is passed to
 * every drawCardOffers / drawLegendaryOffers call, and every card dealt is tallied per boon and per duo (any kind,
 * drafts and Greed deals), so a spec can check what a character is never dealt.
 */
import { isBossFloor } from "shared/dungeon";
import {
	BOONS,
	BOON_COUNT,
	BOON_MAX_LEVEL,
	BUILD_RULES,
	CardKind,
	DUOS,
	DUO_COUNT,
	PACT_LEGENDARY_CARDS,
	Rarity,
	Rng,
	boonMaxLevel,
	cardBoon,
	cardDuo,
	drawCardOffers,
	drawLegendaryOffers,
	duoAvailable,
	rngInt,
	type BuildRules,
	type CardKindId,
} from "shared/sim";

export type PickPolicy = "greedy" | "random" | "duo-seeking";

/** A card's kind for a player with `levels` (buildsData CardKind; -1 for no card). */
export function offerKind(levels: ReadonlyArray<number>, card: number): CardKindId | -1 {
	if (cardDuo(card) >= 0) return CardKind.DUO;
	const b = cardBoon(card);
	if (b < 0) return -1;
	const level = levels[b] ?? 0;
	return level <= 0 ? CardKind.NEW : level >= BOON_MAX_LEVEL - 1 ? CardKind.EVOLUTION : CardKind.UPGRADE;
}

/** True when `card` is a new boon whose duo partner (any duo, not yet available) is already owned. */
export function completesDuo(levels: ReadonlyArray<number>, card: number): boolean {
	const b = cardBoon(card);
	if (b < 0 || (levels[b] ?? 0) > 0) return false;
	for (const d of DUOS) {
		if (d.a === b && (levels[d.b] ?? 0) > 0) return true;
		if (d.b === b && (levels[d.a] ?? 0) > 0) return true;
	}
	return false;
}

/** The policy's pick among `offers` (an index). */
export function pickOffer(
	policy: PickPolicy,
	levels: ReadonlyArray<number>,
	offers: ReadonlyArray<number>,
	rng: Rng,
): number {
	if (policy === "random") return rngInt(rng, 0, offers.size() - 1);
	for (const want of [CardKind.EVOLUTION, CardKind.DUO]) {
		for (let i = 0; i < offers.size(); i++) if (offerKind(levels, offers[i]) === want) return i;
	}
	if (policy === "duo-seeking") {
		for (let i = 0; i < offers.size(); i++) if (completesDuo(levels, offers[i])) return i;
	}
	for (let i = 0; i < offers.size(); i++) if (offerKind(levels, offers[i]) === CardKind.UPGRADE) return i;
	return 0;
}

/** One checkpoint's tallies over every run ("by floor N"). */
export interface OfferCheckpoint {
	readonly floor: number;
	runs: number;
	runsWithEvolution: number;
	runsWithDuo: number;
	evolutions: number;
	duos: number;
	/** Distinct boons owned, and boon levels owned (sum of levels). */
	boons: number;
	levels: number;
	/** Drafts dealt so far, and how many of them had the pity fire; runs where it fired at least once. */
	drafts: number;
	pityDrafts: number;
	runsWithPity: number;
	/** Drafts that offered at least one evolution / at least one duo card. */
	draftsOfferingEvolution: number;
	draftsOfferingDuo: number;
	// docs/LEGENDARIES.md LG7 (file comment).
	/** Legendary boons owned (summed over runs). */
	legendaries: number;
	/** Per boon: runs owning it. */
	ownedBoon: number[];
	/** Per boon: drafts so far that offered it as a New card, and runs where some draft did. */
	draftsOfferingBoon: number[];
	runsOfferedBoon: number[];
	/** Greed's deal for the build at the checkpoint: deals, cards, cards by kind, deals with a new legendary. */
	greedDeals: number;
	greedCards: number;
	greedNew: number;
	greedDuo: number;
	greedEvolution: number;
	greedFill: number;
	greedWithNew: number;
	/** Per boon: Greed deals that held it as a new legendary. */
	greedBoon: number[];
	/** docs/ARCHER.md AR2. Per boon: cards of it dealt so far (any kind: new, upgrade, evolution; drafts and Greed). */
	boonDealt: number[];
	/** Per duo: its cards dealt so far (drafts and Greed). */
	duoDealt: number[];
}

/** Per boss floor (5, 10, ...): how often the double draft's first deal had a duo to guarantee. */
export interface BossDuoTally {
	readonly floor: number;
	deals: number;
	available: number;
}

export interface OfferStats {
	readonly policy: PickPolicy;
	readonly checkpoints: OfferCheckpoint[];
	readonly bossDuo: BossDuoTally[];
	/** Picks by kind over the whole simulation (CardKind order: new, upgrade, evolution, duo). */
	readonly picks: number[];
}

/** The run index's offer seed and policy seed (two streams). */
const OFFER_SEED_MUL = 0x9e3779b1;
const POLICY_SEED_SALT = 0x5bd1e995;
/** Greed's deal stream (LG7): its own per run, so the offers and the policy draw as before. */
const GREED_SEED_SALT = 0x2c1b3c6d;

function zeros(n: number = BOON_COUNT): number[] {
	const out: number[] = [];
	for (let b = 0; b < n; b++) out.push(0);
	return out;
}

/** Tallies one dealt card into per-boon / per-duo counts (AR2). */
function tallyDealt(card: number, boonDealt: number[], duoDealt: number[]): void {
	const duo = cardDuo(card);
	if (duo >= 0) duoDealt[duo]++;
	else if (cardBoon(card) >= 0) boonDealt[cardBoon(card)]++;
}

/** True for a legendary boon (Rarity.LEGENDARY). */
export function isLegendaryBoon(b: number): boolean {
	return BOONS[b] !== undefined && BOONS[b].rarity === Rarity.LEGENDARY;
}

function countEvolved(levels: ReadonlyArray<number>): number {
	let n = 0;
	for (let b = 0; b < BOON_COUNT; b++) if (boonMaxLevel(b) === BOON_MAX_LEVEL && levels[b] === BOON_MAX_LEVEL) n++;
	return n;
}

/**
 * `runs` simulated runs with `policy`, tallied "by floor N" for each N in `checkpoints` (ascending; the last one sets
 * how far a run goes: its drafts are those of floors 1 .. N - 1). `rules`: BUILD_RULES unless a spec compares;
 * `eligible`: a character's boon mask (absent: every boon).
 */
export function simulateOffers(
	policy: PickPolicy,
	runs: number,
	checkpoints: ReadonlyArray<number>,
	rules: Readonly<BuildRules> = BUILD_RULES,
	eligible?: ReadonlyArray<boolean>,
): OfferStats {
	const noPity: BuildRules = { ...rules, upgradePityCards: math.huge };
	const tallies: OfferCheckpoint[] = checkpoints.map((floor) => ({
		floor,
		runs: 0,
		runsWithEvolution: 0,
		runsWithDuo: 0,
		evolutions: 0,
		duos: 0,
		boons: 0,
		levels: 0,
		drafts: 0,
		pityDrafts: 0,
		runsWithPity: 0,
		draftsOfferingEvolution: 0,
		draftsOfferingDuo: 0,
		legendaries: 0,
		ownedBoon: zeros(),
		draftsOfferingBoon: zeros(),
		runsOfferedBoon: zeros(),
		greedDeals: 0,
		greedCards: 0,
		greedNew: 0,
		greedDuo: 0,
		greedEvolution: 0,
		greedFill: 0,
		greedWithNew: 0,
		greedBoon: zeros(),
		boonDealt: zeros(),
		duoDealt: zeros(DUO_COUNT),
	}));
	const bossDuo: BossDuoTally[] = [];
	const lastFloor = checkpoints[checkpoints.size() - 1] - 1;
	for (let f = 1; f <= lastFloor; f++) if (isBossFloor(f)) bossDuo.push({ floor: f, deals: 0, available: 0 });
	const picks = [0, 0, 0, 0];
	for (let run = 1; run <= runs; run++) {
		const rng = new Rng(run * OFFER_SEED_MUL);
		const policyRng = new Rng(bit32.bxor(run, POLICY_SEED_SALT));
		const greedRng = new Rng(bit32.bxor(run, GREED_SEED_SALT));
		const offeredBoon = zeros();
		const boonDealt = zeros();
		const duoDealt = zeros(DUO_COUNT);
		const levels: number[] = [];
		for (let b = 0; b < BOON_COUNT; b++) levels.push(0);
		const duos: number[] = [];
		let drafts = 0;
		let pityDrafts = 0;
		let offeredEvo = 0;
		let offeredDuo = 0;
		let checkpoint = 0;
		for (let floorCleared = 1; floorCleared <= lastFloor; floorCleared++) {
			const boss = isBossFloor(floorCleared);
			const deals = boss ? rules.bossFloorDrafts : rules.floorDrafts;
			for (let d = 0; d < deals; d++) {
				const guarantee = boss && d === 0;
				if (guarantee) {
					let any = false;
					for (let k = 0; k < DUO_COUNT; k++) if (duoAvailable(levels, duos, k)) any = true;
					for (const t of bossDuo) {
						if (t.floor !== floorCleared) continue;
						t.deals++;
						if (any) t.available++;
					}
				}
				let upgradable = false;
				for (let b = 0; b < BOON_COUNT; b++)
					if (levels[b] > 0 && levels[b] < boonMaxLevel(b)) upgradable = true;
				const probe = drawCardOffers(
					{ rngState: rng.rngState },
					noPity,
					levels,
					duos,
					floorCleared,
					guarantee,
					eligible,
				);
				const offers = drawCardOffers(rng, rules, levels, duos, floorCleared, guarantee, eligible);
				if (offers.size() === 0) continue;
				for (const c of offers) tallyDealt(c, boonDealt, duoDealt);
				drafts++;
				const probeHasUpgrade = probe.some((c) => {
					const k = offerKind(levels, c);
					return k === CardKind.UPGRADE || k === CardKind.EVOLUTION;
				});
				const pity = upgradable && !probeHasUpgrade && probe.size() >= rules.upgradePityCards;
				for (let i = 0; i < offers.size() - 1; i++) {
					if (offers[i] !== probe[i])
						error("simulateOffers: the pity-off draft differs before its last card", 0);
				}
				if (pity) pityDrafts++;
				if (offers.some((c) => offerKind(levels, c) === CardKind.EVOLUTION)) offeredEvo++;
				if (offers.some((c) => offerKind(levels, c) === CardKind.DUO)) offeredDuo++;
				for (const c of offers) if (offerKind(levels, c) === CardKind.NEW) offeredBoon[cardBoon(c)]++;
				const card = offers[pickOffer(policy, levels, offers, policyRng)];
				const kind = offerKind(levels, card);
				picks[kind]++;
				const duo = cardDuo(card);
				if (duo >= 0) duos.push(duo);
				else levels[cardBoon(card)]++;
			}
			// Checkpoint "by floor floorCleared + 1".
			while (checkpoint < tallies.size() && tallies[checkpoint].floor === floorCleared + 1) {
				const t = tallies[checkpoint];
				const evo = countEvolved(levels);
				t.runs++;
				if (evo > 0) t.runsWithEvolution++;
				if (duos.size() > 0) t.runsWithDuo++;
				t.evolutions += evo;
				t.duos += duos.size();
				for (let b = 0; b < BOON_COUNT; b++) {
					if (levels[b] > 0) t.boons++;
					t.levels += levels[b];
				}
				t.drafts += drafts;
				t.pityDrafts += pityDrafts;
				if (pityDrafts > 0) t.runsWithPity++;
				t.draftsOfferingEvolution += offeredEvo;
				t.draftsOfferingDuo += offeredDuo;
				for (let b = 0; b < BOON_COUNT; b++) {
					if (levels[b] > 0) {
						t.ownedBoon[b]++;
						if (isLegendaryBoon(b)) t.legendaries++;
					}
					t.draftsOfferingBoon[b] += offeredBoon[b];
					if (offeredBoon[b] > 0) t.runsOfferedBoon[b]++;
				}
				const deal = drawLegendaryOffers(greedRng, levels, duos, PACT_LEGENDARY_CARDS, eligible);
				for (const c of deal) tallyDealt(c, boonDealt, duoDealt);
				for (let b = 0; b < BOON_COUNT; b++) t.boonDealt[b] += boonDealt[b];
				for (let d = 0; d < DUO_COUNT; d++) t.duoDealt[d] += duoDealt[d];
				t.greedDeals++;
				t.greedCards += deal.size();
				let anyNew = false;
				for (const c of deal) {
					const k = offerKind(levels, c);
					if (k === CardKind.DUO) t.greedDuo++;
					else if (k === CardKind.NEW) {
						t.greedNew++;
						t.greedBoon[cardBoon(c)]++;
						anyNew = true;
					} else if (k === CardKind.EVOLUTION) t.greedEvolution++;
					else t.greedFill++;
				}
				if (anyNew) t.greedWithNew++;
				checkpoint++;
			}
		}
	}
	return { policy, checkpoints: tallies, bossDuo, picks };
}

const pct = (a: number, b: number) => (b > 0 ? string.format("%.1f%%", (100 * a) / b) : "-");
const mean = (a: number, b: number) => (b > 0 ? string.format("%.2f", a / b) : "-");

export function offerHeader(): string {
	return (
		"| policy | by floor | runs with >= 1 evolution | runs with >= 1 duo | mean evolutions | mean duos | " +
		"mean boons / levels | drafts offering an evolution / a duo | pity: drafts / runs |"
	);
}

export function formatOfferRow(policy: PickPolicy, t: OfferCheckpoint): string {
	return (
		`| ${policy} | ${t.floor} | ${pct(t.runsWithEvolution, t.runs)} | ${pct(t.runsWithDuo, t.runs)} | ` +
		`${mean(t.evolutions, t.runs)} | ${mean(t.duos, t.runs)} | ${mean(t.boons, t.runs)} / ${mean(
			t.levels,
			t.runs,
		)} | ` +
		`${pct(t.draftsOfferingEvolution, t.drafts)} / ${pct(t.draftsOfferingDuo, t.drafts)} | ` +
		`${pct(t.pityDrafts, t.drafts)} / ${pct(t.runsWithPity, t.runs)} |`
	);
}

export function formatBossDuo(policy: PickPolicy, stats: OfferStats): string {
	return stats.bossDuo
		.map((t) => `${policy} floor ${t.floor}: guaranteed duo available ${pct(t.available, t.deals)}`)
		.join("; ");
}

export function formatPicks(policy: PickPolicy, stats: OfferStats): string {
	const total = stats.picks.reduce((a, b) => a + b, 0);
	return (
		`${policy} picks: new ${pct(stats.picks[CardKind.NEW], total)}, upgrade ${pct(
			stats.picks[CardKind.UPGRADE],
			total,
		)}, ` + `evolution ${pct(stats.picks[CardKind.EVOLUTION], total)}, duo ${pct(stats.picks[CardKind.DUO], total)}`
	);
}

// docs/LEGENDARIES.md LG7: the legendary tallies (file comment).

/** The legendary boons, in Boon order. */
export function legendaryBoons(): number[] {
	const out: number[] = [];
	for (let b = 0; b < BOON_COUNT; b++) if (isLegendaryBoon(b)) out.push(b);
	return out;
}

function shortName(b: number): string {
	const id = BOONS[b].id;
	return id.sub(1, 5) === "boon." ? id.sub(6) : id;
}

export function legendaryHeader(): string {
	const names = legendaryBoons()
		.map((b) => shortName(b))
		.join(" / ");
	return (
		`| policy | by floor | mean legendaries owned | runs owning ${names} | drafts offering ${names} (New) | ` +
		`runs offered ${names} | Greed deal: new legendary / duo / evolution / fill cards (mean) | ` +
		`Greed deals with a new legendary | Greed deals holding ${names} |`
	);
}

export function formatLegendaryRow(policy: PickPolicy, t: OfferCheckpoint): string {
	const ls = legendaryBoons();
	const of = (xs: ReadonlyArray<number>, total: number) => ls.map((b) => pct(xs[b], total)).join(" / ");
	return (
		`| ${policy} | ${t.floor} | ${mean(t.legendaries, t.runs)} | ${of(t.ownedBoon, t.runs)} | ` +
		`${of(t.draftsOfferingBoon, t.drafts)} | ${of(t.runsOfferedBoon, t.runs)} | ` +
		`${mean(t.greedNew, t.greedDeals)} / ${mean(t.greedDuo, t.greedDeals)} / ${mean(
			t.greedEvolution,
			t.greedDeals,
		)} / ${mean(t.greedFill, t.greedDeals)} | ${pct(t.greedWithNew, t.greedDeals)} | ${of(
			t.greedBoon,
			t.greedDeals,
		)} |`
	);
}
