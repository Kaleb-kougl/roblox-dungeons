// Character health after the heart cut (docs/SILVER.md SV16, SVD18; docs/ARCHER.md "Health"): the Knight starts with
// 4 half hearts (2 hearts), the Archer with 3 (1 1/2), solo and per co-op player; Vigor I / II add one half heart each
// (Knight 5 / 6, Archer 4 / 5); a run without traits keeps START_HALF_HEARTS (6) and the same hash, so M1 and every
// golden fixture are untouched; respawns and revives stop at the maximum; and every heal and loss at an ODD maximum
// (the flask, Hearty, Lionheart, Vampire Fang, a party revive, Second Wind, Frailty) clamps to it.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	Boon,
	Button,
	Curse,
	EMPTY_INPUT,
	FANG_KILLS,
	HIT_NORMAL,
	MIN_START_HALF_HEARTS,
	NEUTRAL_TRAITS,
	PARTY_REVIVE_HALF_HEARTS,
	Relic,
	SOLO_PLAYER,
	START_HALF_HEARTS,
	acceptCurse,
	buildsOnPerfectRoom,
	createSimState,
	damagePlayer,
	grantBoon,
	grantCard,
	grantRelic,
	hashState,
	playerAt,
	playerStartHalfHearts,
	respawnPlayer,
	revivePartyMember,
	runOnKill,
	runStartHalfHearts,
	step,
	type PlayerTraits,
	type SimConfig,
	type SimState,
} from "shared/sim";
import {
	ARCHER_HEARTS_MAX_DELTA,
	KNIGHT_HEARTS_MAX_DELTA,
	NO_UPGRADES,
	characterTraits,
	upgradeTraits,
} from "shared/characters";
import { buildEndlessRunConfig } from "shared/run";
import { HEART_FILL, heartFills } from "shared/view/hud";

const ARCHER: PlayerTraits = characterTraits("archer");
const KNIGHT: PlayerTraits = characterTraits("knight");

describe("character health after the heart cut (SV16)", () => {
	it("solo: the Knight starts at 2 hearts of 2, the Archer at 1 1/2 of 1 1/2; no traits stays at 3 (same hash)", () => {
		expect([START_HALF_HEARTS + KNIGHT_HEARTS_MAX_DELTA, START_HALF_HEARTS + ARCHER_HEARTS_MAX_DELTA]).toEqual([
			4, 3,
		]);
		const knight = createSimState(1, 0, 0, { traits: KNIGHT });
		const archer = createSimState(1, 0, 0, { traits: ARCHER });
		expect([knight.player.hearts, knight.player.heartsMax]).toEqual([4, 4]);
		expect([archer.player.hearts, archer.player.heartsMax]).toEqual([3, 3]);
		const plain = createSimState(1, 0, 0, {});
		const neutral = createSimState(1, 0, 0, { traits: NEUTRAL_TRAITS });
		for (const s of [plain, neutral]) {
			expect([s.player.hearts, s.player.heartsMax]).toEqual([START_HALF_HEARTS, START_HALF_HEARTS]);
		}
		expect(START_HALF_HEARTS).toBe(6);
		expect(hashState(neutral)).toBe(hashState(plain));
		expect(hashState(knight)).never.toBe(hashState(plain));
		expect(hashState(archer)).never.toBe(hashState(knight));
	});

	it("Vigor I / II: the Knight 5 / 6, the Archer 4 / 5 half hearts", () => {
		const at = (id: "knight" | "archer", vigor: number) =>
			playerStartHalfHearts(upgradeTraits(id, { ...NO_UPGRADES, vigor }));
		expect([0, 1, 2].map((v) => at("knight", v))).toEqual([4, 5, 6]);
		expect([0, 1, 2].map((v) => at("archer", v))).toEqual([3, 4, 5]);
	});

	it("co-op: per player (party.traits[i], else SimConfig.traits), with each player's Vigor", () => {
		const vigor1 = upgradeTraits("knight", { ...NO_UPGRADES, vigor: 1 });
		const config: SimConfig = { party: { size: 4, traits: [ARCHER, KNIGHT, vigor1] } };
		const s = createSimState(1, 0, 0, config);
		const max = [0, 1, 2, 3].map((i) => playerAt(s, i).heartsMax);
		expect(max).toEqual([3, 4, 5, START_HALF_HEARTS]);
		expect([0, 1, 2, 3].map((i) => playerAt(s, i).hearts)).toEqual(max);
		const fallback: SimConfig = { traits: ARCHER, party: { size: 2, traits: [undefined, KNIGHT] } };
		const f = createSimState(1, 0, 0, fallback);
		expect([playerAt(f, 0).hearts, playerAt(f, 1).hearts]).toEqual([3, 4]);
		expect([0, 1, 2, 3].map((i) => runStartHalfHearts(config, i))).toEqual(max);
		expect(runStartHalfHearts(fallback)).toBe(3);
		expect(runStartHalfHearts({})).toBe(START_HALF_HEARTS);
	});

	it("respawns and revives refill to the character's maximum, never past it", () => {
		const cases: Array<[PlayerTraits, number]> = [
			[ARCHER, 3],
			[KNIGHT, 4],
		];
		for (const [traits, max] of cases) {
			const s = createSimState(1, 0, 0, { traits });
			s.player.hearts = 1;
			respawnPlayer(s, 0, 0);
			expect(s.player.hearts).toBe(max);
			const p = s.player;
			p.hearts = 0;
			p.dead = 1;
			revivePartyMember(p, START_HALF_HEARTS);
			expect(p.hearts).toBe(max);
		}
	});

	it("a delta never leaves a player under MIN_START_HALF_HEARTS", () => {
		const drastic: PlayerTraits = { ...NEUTRAL_TRAITS, heartsMaxDelta: -100 };
		expect(playerStartHalfHearts(drastic)).toBe(MIN_START_HALF_HEARTS);
		expect(playerStartHalfHearts(ARCHER)).toBe(3);
		expect(playerStartHalfHearts(KNIGHT)).toBe(4);
		expect(playerStartHalfHearts(NEUTRAL_TRAITS)).toBe(START_HALF_HEARTS);
	});
});

describe("heals and losses at an odd maximum (SV16)", () => {
	type Odd = "archer" | "vigor1";
	/** A real endless run (builds on) as the Archer (3 half hearts) or the Knight with Vigor I (5). */
	function oddRun(who: Odd): { s: SimState; config: SimConfig } {
		const setup = buildEndlessRunConfig(7, 1, {
			characters: [who === "archer" ? "archer" : "knight"],
			upgrades: [who === "vigor1" ? { ...NO_UPGRADES, vigor: 1 } : NO_UPGRADES],
		});
		const spawn = setup.spawn!;
		return { s: createSimState(7, spawn.x, spawn.z, setup.config), config: setup.config };
	}
	const ODD: ReadonlyArray<Odd> = ["archer", "vigor1"];
	const maxOf = (who: Odd) => (who === "archer" ? 3 : 5);

	it("starts full at the odd maximum; the HUD draws the last heart as a full half container", () => {
		for (const who of ODD) {
			const { s } = oddRun(who);
			expect([s.player.hearts, s.player.heartsMax]).toEqual([maxOf(who), maxOf(who)]);
			const fills = heartFills(s.player.hearts, s.player.heartsMax);
			expect(fills[fills.size() - 1]).toBe(HEART_FILL.HALF_MAX_FULL);
			for (const f of fills) expect(f).never.toBe(HEART_FILL.HALF);
		}
	});

	it("the flask heals to the cap (no ghost half)", () => {
		for (const who of ODD) {
			const max = maxOf(who);
			for (const missing of [1, 2]) {
				const { s, config } = oddRun(who);
				s.player.hearts = max - missing;
				step(s, { ...EMPTY_INPUT, buttons: Button.FLASK }, config);
				expect([who, missing, s.player.hearts]).toEqual([who, missing, max]);
			}
		}
	});

	it("Hearty adds a whole heart (the maximum stays odd); Lionheart and Vampire Fang heal to the cap only", () => {
		for (const who of ODD) {
			const { s } = oddRun(who);
			const max = maxOf(who);
			grantBoon(s, SOLO_PLAYER, Boon.HEARTY);
			const hearty = s.player.heartsMax;
			expect(hearty).toBe(max + 2);
			expect(s.player.hearts).toBe(hearty);
			// Lionheart (Hearty III): a PERFECT room clear heals half a heart, never past the maximum.
			grantCard(s, SOLO_PLAYER, Boon.HEARTY);
			grantCard(s, SOLO_PLAYER, Boon.HEARTY);
			const lion = s.player.heartsMax;
			expect(lion % 2).toBe(1);
			s.player.hearts = lion - 1;
			buildsOnPerfectRoom(s);
			expect(s.player.hearts).toBe(lion);
			buildsOnPerfectRoom(s);
			expect(s.player.hearts).toBe(lion);
			// Vampire Fang: every FANG_KILLS kills heal half a heart, capped.
			grantRelic(s, SOLO_PLAYER, Relic.VAMPIRE_FANG);
			s.player.hearts = lion - 1;
			for (let k = 0; k < FANG_KILLS * 2; k++) runOnKill(s, SOLO_PLAYER, false);
			expect(s.player.hearts).toBe(lion);
		}
	});

	it("a party revive and Second Wind at an odd maximum", () => {
		for (const who of ODD) {
			const { s } = oddRun(who);
			const p = s.player;
			p.dead = 1;
			p.hearts = 0;
			revivePartyMember(p, PARTY_REVIVE_HALF_HEARTS);
			expect(p.hearts).toBe(math.min(PARTY_REVIVE_HALF_HEARTS, maxOf(who)));
			grantRelic(s, SOLO_PLAYER, Relic.SECOND_WIND);
			p.hearts = 1;
			p.hurtTicks = 0;
			expect(damagePlayer(s, HIT_NORMAL)).toBe(true);
			expect([p.hearts, p.dead]).toEqual([1, 0]);
		}
	});

	it("Frailty at 3 costs half a heart (3 -> 2, never under 2); at 5 a whole heart (5 -> 3)", () => {
		const archer = oddRun("archer").s;
		acceptCurse(archer, SOLO_PLAYER, Curse.FRAILTY);
		expect([archer.player.heartsMax, archer.player.hearts]).toEqual([2, 2]);
		const vigor = oddRun("vigor1").s;
		acceptCurse(vigor, SOLO_PLAYER, Curse.FRAILTY);
		expect([vigor.player.heartsMax, vigor.player.hearts]).toEqual([3, 3]);
	});
});
