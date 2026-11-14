// The characters (docs/ARCHER.md AR1): the table, its helpers, and the weapon-tag eligibility of every boon, duo and
// relic per character against the plan's "Who gets what" table (derived duos included), with the pool counts.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOONS,
	BOON_COUNT,
	BOW,
	BOW_WEAPON_ID,
	Boon,
	CLASSIC_BOON_COUNT,
	DEFAULT_LOADOUT,
	DUOS,
	DUO_COUNT,
	Duo,
	NEUTRAL_TRAITS,
	PERCENT,
	RELICS,
	RELIC_COUNT,
	Relic,
	SWORD,
	SWORD_WEAPON_ID,
	boonEligible,
	carriesWeapon,
	createSimState,
	duoEligible,
	eligibleBoonMask,
	relicEligible,
	weaponsAt,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { CLASS_IDS } from "shared/theme";
import {
	ARCHER_HEARTS_MAX_DELTA,
	KNIGHT_HEARTS_MAX_DELTA,
	ARCHER_ROLL_DASH_PERCENT,
	ARCHER_ROLL_IFRAME_PERCENT,
	CHARACTERS,
	CHARACTER_IDS,
	DEFAULT_CHARACTER,
	characterDef,
	characterLoadout,
	characterOfLoadout,
	characterOfWeapons,
	characterTraits,
	isCharacterId,
	type CharacterId,
} from "shared/characters";

/** "Who gets what": the items each character is NOT dealt (everything else is both). */
const NOT_DEALT: { readonly [K in CharacterId]: { boons: number[]; duos: number[]; relics: number[] } } = {
	knight: {
		boons: [Boon.PIERCING_ARROWS, Boon.BALLISTA],
		duos: [Duo.FIRE_ARROWS, Duo.CONDUCTOR, Duo.SKEWER, Duo.DRAGON_BOLT],
		relics: [],
	},
	archer: {
		boons: [Boon.RIPOSTE],
		duos: [Duo.THUNDER_GUARD, Duo.STILLWATER, Duo.REBUKE],
		relics: [Relic.MIRROR_CLOAK],
	},
};

function stateOf(loadout: ReadonlyArray<string | undefined>): SimState {
	return createSimState(1, 0, 0, { loadout });
}

function mask(s: SimState, i = 0): boolean[] {
	return eligibleBoonMask(s, i, []);
}

function counts(s: SimState, i = 0): [number, number, number, number] {
	const m = mask(s, i);
	let boons = 0;
	let classic = 0;
	for (let b = 0; b < BOON_COUNT; b++) {
		if (!m[b]) continue;
		boons++;
		if (b < CLASSIC_BOON_COUNT) classic++;
	}
	let duos = 0;
	for (let d = 0; d < DUO_COUNT; d++) if (duoEligible(m, d)) duos++;
	let relics = 0;
	for (let r = 0; r < RELIC_COUNT; r++) if (relicEligible(s, i, r)) relics++;
	return [boons, classic, duos, relics];
}

describe("characters", () => {
	it("the Knight (sword, neutral roll) and the Archer (bow, 140 % dash / 125 % i-frames); Knight by default", () => {
		expect(CHARACTER_IDS).toEqual(["knight", "archer"]);
		expect(DEFAULT_CHARACTER).toBe("knight");
		expect(characterLoadout("knight")).toEqual([SWORD_WEAPON_ID]);
		expect(characterLoadout("archer")).toEqual([BOW_WEAPON_ID]);
		// docs/SILVER.md SV16: the Knight's roll is neutral, his health one heart under START_HALF_HEARTS.
		expect(characterTraits("knight")).toEqual({ ...NEUTRAL_TRAITS, heartsMaxDelta: KNIGHT_HEARTS_MAX_DELTA });
		expect(characterTraits("archer")).toEqual({
			rollDashPercent: ARCHER_ROLL_DASH_PERCENT,
			rollIframePercent: ARCHER_ROLL_IFRAME_PERCENT,
			heartsMaxDelta: ARCHER_HEARTS_MAX_DELTA,
			armorMaxDelta: 0,
			flaskChargesDelta: 0,
		});
		expect([ARCHER_ROLL_DASH_PERCENT, ARCHER_ROLL_IFRAME_PERCENT, ARCHER_HEARTS_MAX_DELTA]).toEqual([140, 125, -3]);
		expect(KNIGHT_HEARTS_MAX_DELTA).toBe(-2);
		expect([NEUTRAL_TRAITS.rollDashPercent, NEUTRAL_TRAITS.rollIframePercent]).toEqual([PERCENT, PERCENT]);
		expect(NEUTRAL_TRAITS.heartsMaxDelta).toBe(0);
		expect([SWORD.id, BOW.id]).toEqual([SWORD_WEAPON_ID, BOW_WEAPON_ID]);
		expect(DEFAULT_LOADOUT).toEqual([SWORD_WEAPON_ID, BOW_WEAPON_ID]);
		expect(characterDef("archer").id).toBe("archer");
		expect(pcall(() => characterDef("nobody" as CharacterId))[0]).toBe(false);
	});

	it("visuals are theme class slots: the Knight class.vanguard, the Archer class.ranger (ARD1)", () => {
		expect(CHARACTERS.map((c) => c.visualId)).toEqual(["class.vanguard", "class.ranger"]);
		for (const c of CHARACTERS) expect(CLASS_IDS.map((k) => `class.${k}`).includes(c.visualId)).toBe(true);
	});

	it("isCharacterId takes only the known ids", () => {
		expect([isCharacterId("knight"), isCharacterId("archer")]).toEqual([true, true]);
		for (const x of ["", "Knight", "ranger", 1, undefined, {}]) expect(isCharacterId(x)).toBe(false);
	});

	it("characterOfLoadout / characterOfWeapons: knight, archer, undefined for two weapons or a test loadout", () => {
		expect(characterOfLoadout([SWORD_WEAPON_ID])).toBe("knight");
		expect(characterOfLoadout([SWORD_WEAPON_ID, undefined])).toBe("knight");
		expect(characterOfLoadout([SWORD_WEAPON_ID, ""])).toBe("knight");
		expect(characterOfLoadout([BOW_WEAPON_ID])).toBe("archer");
		expect(characterOfLoadout(DEFAULT_LOADOUT)).toBe(undefined);
		expect(characterOfLoadout([BOW_WEAPON_ID, SWORD_WEAPON_ID])).toBe(undefined);
		expect(characterOfLoadout([undefined, BOW_WEAPON_ID])).toBe(undefined);
		expect(characterOfLoadout([])).toBe(undefined);
		for (const id of CHARACTER_IDS) {
			expect(characterOfWeapons(weaponsAt(stateOf(characterLoadout(id)), 0))).toBe(id);
		}
		expect(characterOfWeapons(weaponsAt(stateOf(DEFAULT_LOADOUT), 0))).toBe(undefined);
	});
});

describe("eligibility (sim/progression, AR1)", () => {
	it("the tags: Piercing Arrows and Ballista the bow, Riposte the sword, Mirror Cloak the sword; nothing else", () => {
		const boonTags = BOONS.map((d, b) => [b, d.requires ?? ""] as const).filter(([, r]) => r !== "");
		expect(boonTags).toEqual([
			[Boon.PIERCING_ARROWS, BOW_WEAPON_ID],
			[Boon.RIPOSTE, SWORD_WEAPON_ID],
			[Boon.BALLISTA, BOW_WEAPON_ID],
		]);
		const relicTags = RELICS.map((d, r) => [r, d.requires ?? ""] as const).filter(([, q]) => q !== "");
		expect(relicTags).toEqual([[Relic.MIRROR_CLOAK, SWORD_WEAPON_ID]]);
	});

	for (const id of CHARACTER_IDS) {
		it(`${id}: every boon, duo and relic is eligible exactly as the plan's table says`, () => {
			const s = stateOf(characterLoadout(id));
			const excluded = NOT_DEALT[id];
			const m = mask(s);
			for (let b = 0; b < BOON_COUNT; b++) {
				expect([BOONS[b].id, m[b]]).toEqual([BOONS[b].id, !excluded.boons.includes(b)]);
				expect(boonEligible(s, 0, b)).toBe(m[b]);
			}
			for (let d = 0; d < DUO_COUNT; d++) {
				expect([DUOS[d].id, duoEligible(m, d)]).toEqual([DUOS[d].id, !excluded.duos.includes(d)]);
			}
			for (let r = 0; r < RELIC_COUNT; r++) {
				expect([RELICS[r].id, relicEligible(s, 0, r)]).toEqual([RELICS[r].id, !excluded.relics.includes(r)]);
			}
		});
	}

	it("pool counts: Knight 18 boons (11 classic), 16 duos, 4 relics; Archer 19 (12), 17, 3", () => {
		expect(counts(stateOf(characterLoadout("knight")))).toEqual([18, 11, 16, 4]);
		expect(counts(stateOf(characterLoadout("archer")))).toEqual([19, 12, 17, 3]);
	});

	it("both weapons (DEFAULT_LOADOUT, no loadout, either order): everything is eligible", () => {
		for (const config of [{}, { loadout: DEFAULT_LOADOUT }, { loadout: [BOW_WEAPON_ID, SWORD_WEAPON_ID] }]) {
			const s = createSimState(1, 0, 0, config as SimConfig);
			expect(counts(s)).toEqual([BOON_COUNT, CLASSIC_BOON_COUNT, DUO_COUNT, RELIC_COUNT]);
		}
	});

	it("co-op: each player's own weapons (PartyConfig.loadouts)", () => {
		const s = createSimState(1, 0, 0, {
			party: { size: 3, loadouts: [characterLoadout("archer"), characterLoadout("knight")] },
		});
		expect([counts(s, 0), counts(s, 1), counts(s, 2)]).toEqual([
			[19, 12, 17, 3],
			[18, 11, 16, 4],
			[BOON_COUNT, CLASSIC_BOON_COUNT, DUO_COUNT, RELIC_COUNT],
		]);
		expect(carriesWeapon(weaponsAt(s, 0), BOW_WEAPON_ID)).toBe(true);
		expect(carriesWeapon(weaponsAt(s, 0), SWORD_WEAPON_ID)).toBe(false);
	});

	it("out of range: no boon / relic / duo is eligible; the mask overwrites only its own entries", () => {
		const s = stateOf(DEFAULT_LOADOUT);
		expect([boonEligible(s, 0, -1), boonEligible(s, 0, BOON_COUNT), relicEligible(s, 0, RELIC_COUNT)]).toEqual([
			false,
			false,
			false,
		]);
		expect(duoEligible(undefined, DUO_COUNT)).toBe(false);
		expect(duoEligible(undefined, 0)).toBe(true);
		const out: boolean[] = [];
		for (let b = 0; b <= BOON_COUNT; b++) out.push(false);
		eligibleBoonMask(s, 0, out);
		expect(out.size()).toBe(BOON_COUNT + 1);
		expect(out[BOON_COUNT]).toBe(false);
		expect(out[0]).toBe(true);
	});
});
