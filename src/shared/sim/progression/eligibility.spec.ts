// docs/ARCHER.md AR2: the eligibility masks where every pool is built. The key property: a player carrying both
// weapons (DEFAULT_LOADOUT) draws EXACTLY as the unmasked functions did, rng state included, over 10,000 seeded deals
// of each pool (builds drafts and the boss double draft's guaranteed duo, the classic draft, Greed's deal and its pool,
// the relic pedestal / vault Rare pool), through the pure functions and through the state paths (drawPlayerCardOffers,
// openDraft). And a one-weapon player's mask does leave its items out.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOON_COUNT,
	BOW_WEAPON_ID,
	BUILDS_CONFIG,
	BUILD_RULES,
	Boon,
	CLASSIC_BOON_COUNT,
	DEFAULT_LOADOUT,
	DUOS,
	DUO_COUNT,
	Duo,
	PACT_LEGENDARY_CARDS,
	RELIC_COUNT,
	Relic,
	Rng,
	SWORD_WEAPON_ID,
	boonMaxLevel,
	buildPlayer,
	cardBoon,
	cardDuo,
	createRunState,
	createSimState,
	drawBoonOffers,
	drawCardOffers,
	drawLegendaryOffers,
	drawPlayerCardOffers,
	duoAvailable,
	eligibleBoonMask,
	legendaryPool,
	openDraft,
	rngInt,
	unownedRelics,
	type RngHolder,
	type SimConfig,
	type SimState,
} from "shared/sim";

const DEALS = 10000;
const SEED_MUL = 0x9e3779b1;

function maskOf(loadout: ReadonlyArray<string | undefined> | undefined): boolean[] {
	const config: SimConfig = loadout !== undefined ? { loadout } : {};
	return eligibleBoonMask(createSimState(1, 0, 0, config), 0, []);
}

const BOTH = maskOf(DEFAULT_LOADOUT);
const SWORD_ONLY = maskOf([SWORD_WEAPON_ID]);
const BOW_ONLY = maskOf([BOW_WEAPON_ID]);

/** A random build for deal `k`: levels (about 40 % of the boons owned, at any level), taken duos, floor, guarantee. */
interface Deal {
	readonly seed: number;
	readonly levels: number[];
	readonly duos: number[];
	readonly floorCleared: number;
	readonly guarantee: boolean;
	readonly owned: number[];
	readonly relics: number[];
}

function dealOf(k: number): Deal {
	const gen = new Rng(bit32.bxor(k, 0x51ed27));
	const levels: number[] = [];
	const owned: number[] = [];
	for (let b = 0; b < BOON_COUNT; b++) {
		const level = rngInt(gen, 0, 9) < 4 ? rngInt(gen, 1, boonMaxLevel(b)) : 0;
		levels.push(level);
		if (level > 0 && b < CLASSIC_BOON_COUNT) owned.push(b);
	}
	const duos: number[] = [];
	for (let d = 0; d < DUO_COUNT; d++) if (duoAvailable(levels, [], d) && rngInt(gen, 0, 9) < 3) duos.push(d);
	const relics: number[] = [];
	for (let r = 0; r < RELIC_COUNT; r++) if (rngInt(gen, 0, 1) === 0) relics.push(r);
	return {
		seed: k * SEED_MUL,
		levels,
		duos,
		floorCleared: rngInt(gen, 1, 20),
		guarantee: rngInt(gen, 0, 3) === 0,
		owned,
		relics,
	};
}

function holder(seed: number): RngHolder {
	return new Rng(seed);
}

describe("eligibility masks: both weapons draw exactly as unmasked (10,000 seeded deals each, rng state included)", () => {
	it("the both-weapons mask allows every boon", () => {
		expect(BOTH.size()).toBe(BOON_COUNT);
		for (const m of BOTH) expect(m).toBe(true);
		expect(maskOf(undefined)).toEqual(BOTH);
	});

	it("builds drafts (drawCardOffers), the boss double draft's guaranteed duo included", () => {
		let differs = 0;
		for (let k = 1; k <= DEALS; k++) {
			const d = dealOf(k);
			const a = holder(d.seed);
			const b = holder(d.seed);
			const plain = drawCardOffers(a, BUILD_RULES, d.levels, d.duos, d.floorCleared, d.guarantee);
			const masked = drawCardOffers(b, BUILD_RULES, d.levels, d.duos, d.floorCleared, d.guarantee, BOTH);
			expect([k, masked, b.rngState]).toEqual([k, plain, a.rngState]);
			const knight = drawCardOffers(
				holder(d.seed),
				BUILD_RULES,
				d.levels,
				d.duos,
				d.floorCleared,
				d.guarantee,
				SWORD_ONLY,
			);
			if (knight.join() !== plain.join()) differs++;
		}
		expect(differs > 0).toBe(true); // the one-weapon mask does change some deals
	});

	it("the classic draft (drawBoonOffers)", () => {
		for (let k = 1; k <= DEALS; k++) {
			const d = dealOf(k);
			const a = holder(d.seed);
			const b = holder(d.seed);
			const plain = drawBoonOffers(a, d.owned, d.floorCleared);
			const masked = drawBoonOffers(b, d.owned, d.floorCleared, BOTH);
			expect([k, masked, b.rngState]).toEqual([k, plain, a.rngState]);
		}
	});

	it("Greed: legendaryPool and drawLegendaryOffers", () => {
		for (let k = 1; k <= DEALS; k++) {
			const d = dealOf(k);
			expect(legendaryPool(d.levels, d.duos, BOTH)).toEqual(legendaryPool(d.levels, d.duos));
			const a = holder(d.seed);
			const b = holder(d.seed);
			const plain = drawLegendaryOffers(a, d.levels, d.duos, PACT_LEGENDARY_CARDS);
			const masked = drawLegendaryOffers(b, d.levels, d.duos, PACT_LEGENDARY_CARDS, BOTH);
			expect([k, masked, b.rngState]).toEqual([k, plain, a.rngState]);
		}
	});

	it("relics: the pedestal / vault Rare pool (unownedRelics) is every unowned relic, so the pick is the same", () => {
		const s = createSimState(1, 0, 0, { loadout: DEFAULT_LOADOUT });
		s.run = createRunState(undefined, 1);
		for (let k = 1; k <= DEALS; k++) {
			const d = dealOf(k);
			s.run.players[0].relics = [...d.relics];
			const plain: number[] = [];
			for (let r = 0; r < RELIC_COUNT; r++) if (!d.relics.includes(r)) plain.push(r);
			const pool = unownedRelics(s, 0);
			expect([k, pool]).toEqual([k, plain]);
			if (pool.size() > 0) {
				const a = holder(d.seed);
				const b = holder(d.seed);
				expect(pool[rngInt(b, 0, pool.size() - 1)]).toBe(plain[rngInt(a, 0, plain.size() - 1)]);
				expect(b.rngState).toBe(a.rngState);
			}
		}
	});
});

describe("eligibility masks: the state paths pass the player's mask", () => {
	function buildsState(loadout: ReadonlyArray<string | undefined>): SimState {
		return createSimState(1, 0, 0, { loadout, builds: BUILDS_CONFIG });
	}

	it("drawPlayerCardOffers with both weapons = drawCardOffers unmasked on the state's rng (1,000 deals)", () => {
		const s = buildsState(DEFAULT_LOADOUT);
		const bp = buildPlayer(s, 0)!;
		for (let k = 1; k <= 1000; k++) {
			const d = dealOf(k);
			for (let b = 0; b < BOON_COUNT; b++) bp.levels[b] = d.levels[b];
			bp.duos.clear();
			for (const x of d.duos) bp.duos.push(x);
			s.rngState = new Rng(d.seed).rngState;
			const a = holder(d.seed);
			const plain = drawCardOffers(a, BUILD_RULES, d.levels, d.duos, d.floorCleared, d.guarantee);
			expect([k, drawPlayerCardOffers(s, 0, d.floorCleared, d.guarantee), s.rngState]).toEqual([
				k,
				plain,
				a.rngState,
			]);
		}
	});

	it("a sword-only player's state draws are never Piercing Arrows, Ballista or their duos; a bow-only never Riposte", () => {
		const banned: { [K in "sword" | "bow"]: { boons: number[]; duos: number[] } } = {
			sword: {
				boons: [Boon.PIERCING_ARROWS, Boon.BALLISTA],
				duos: [Duo.FIRE_ARROWS, Duo.CONDUCTOR, Duo.SKEWER, Duo.DRAGON_BOLT],
			},
			bow: { boons: [Boon.RIPOSTE], duos: [Duo.THUNDER_GUARD, Duo.STILLWATER, Duo.REBUKE] },
		};
		for (const [which, loadout] of [
			["sword", [SWORD_WEAPON_ID]],
			["bow", [BOW_WEAPON_ID]],
		] as const) {
			const s = buildsState(loadout);
			const bp = buildPlayer(s, 0)!;
			// Every boon owned at level I (the banned ones too: an upgrade or a duo is never dealt either).
			for (let b = 0; b < BOON_COUNT; b++) bp.levels[b] = b % 3 === 0 ? 1 : 0;
			for (const b of banned[which].boons) bp.levels[b] = 1;
			for (let k = 1; k <= 1000; k++) {
				s.rngState = new Rng(k * SEED_MUL).rngState;
				for (const c of drawPlayerCardOffers(s, 0, 1 + (k % 20), k % 4 === 0)) {
					expect(banned[which].boons.includes(cardBoon(c))).toBe(false);
					expect(banned[which].duos.includes(cardDuo(c))).toBe(false);
				}
			}
		}
		expect(SWORD_ONLY[Boon.PIERCING_ARROWS]).toBe(false);
		expect(BOW_ONLY[Boon.RIPOSTE]).toBe(false);
		expect(DUOS.size()).toBe(DUO_COUNT);
	});

	it("openDraft without builds (the classic draft): both weapons = drawBoonOffers unmasked; sword-only never Piercing", () => {
		for (const [loadout, mask] of [
			[DEFAULT_LOADOUT, undefined],
			[[SWORD_WEAPON_ID], SWORD_ONLY],
		] as const) {
			const s = createSimState(1, 0, 0, { loadout });
			s.run = createRunState(undefined, 1);
			const me = s.run.players[0];
			for (let k = 1; k <= 1000; k++) {
				const d = dealOf(k);
				me.boons = [...d.owned];
				me.draftOpen = 0;
				s.rngState = new Rng(d.seed).rngState;
				const a = holder(d.seed);
				const plain = drawBoonOffers(a, d.owned, d.floorCleared, mask);
				openDraft(s, 0, d.floorCleared);
				const offers = me.draftOpen !== 0 ? me.draftOffers : [];
				expect([k, offers, s.rngState]).toEqual([k, plain, a.rngState]);
				if (mask !== undefined) expect(offers.includes(Boon.PIERCING_ARROWS)).toBe(false);
			}
		}
	});

	it("relics: a bow-only player is never offered Mirror Cloak; a sword-only player every relic", () => {
		for (const [loadout, mirror] of [
			[[BOW_WEAPON_ID], false],
			[[SWORD_WEAPON_ID], true],
		] as const) {
			const s = createSimState(1, 0, 0, { loadout });
			s.run = createRunState(undefined, 1);
			for (let owned = 0; owned < 16; owned++) {
				const relics: number[] = [];
				for (let r = 0; r < RELIC_COUNT; r++) if (bit32.btest(owned, bit32.lshift(1, r))) relics.push(r);
				s.run.players[0].relics = relics;
				const pool = unownedRelics(s, 0);
				const mirrorOwned = relics.includes(Relic.MIRROR_CLOAK);
				expect(pool.includes(Relic.MIRROR_CLOAK)).toBe(mirror && !mirrorOwned);
			}
		}
	});
});
