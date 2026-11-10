// The Archer's health (docs/ARCHER.md "Health"): one heart less than the Knight. PlayerTraits.heartsMaxDelta -2 makes
// the Archer's starting and maximum health 4 half hearts (2 hearts), solo and per co-op player; the Knight and a run
// without traits keep START_HALF_HEARTS exactly (same hash); respawns and revives stop at the Archer's max.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	MIN_START_HALF_HEARTS,
	NEUTRAL_TRAITS,
	START_HALF_HEARTS,
	createSimState,
	hashState,
	playerAt,
	playerStartHalfHearts,
	respawnPlayer,
	revivePartyMember,
	runStartHalfHearts,
	type PlayerTraits,
	type SimConfig,
} from "shared/sim";
import { ARCHER_HEARTS_MAX_DELTA, characterTraits } from "shared/characters";

const ARCHER: PlayerTraits = characterTraits("archer");
const KNIGHT: PlayerTraits = characterTraits("knight");

describe("the Archer's health (one heart less)", () => {
	it("solo: the Archer starts at 2 hearts of 2, the Knight and no traits at 3 of 3 (the same hash)", () => {
		expect(START_HALF_HEARTS + ARCHER_HEARTS_MAX_DELTA).toBe(4);
		const archer = createSimState(1, 0, 0, { traits: ARCHER });
		expect([archer.player.hearts, archer.player.heartsMax]).toEqual([4, 4]);
		const plain = createSimState(1, 0, 0, {});
		const knight = createSimState(1, 0, 0, { traits: KNIGHT });
		const neutral = createSimState(1, 0, 0, { traits: NEUTRAL_TRAITS });
		for (const s of [plain, knight, neutral]) {
			expect([s.player.hearts, s.player.heartsMax]).toEqual([START_HALF_HEARTS, START_HALF_HEARTS]);
		}
		expect(hashState(knight)).toBe(hashState(plain));
		expect(hashState(neutral)).toBe(hashState(plain));
		expect(hashState(archer)).never.toBe(hashState(plain));
	});

	it("co-op: per player (party.traits[i], else SimConfig.traits)", () => {
		const config: SimConfig = { party: { size: 3, traits: [ARCHER, KNIGHT] } };
		const s = createSimState(1, 0, 0, config);
		const max = [0, 1, 2].map((i) => playerAt(s, i).heartsMax);
		expect(max).toEqual([4, START_HALF_HEARTS, START_HALF_HEARTS]);
		const fallback: SimConfig = { traits: ARCHER, party: { size: 2, traits: [undefined, KNIGHT] } };
		const f = createSimState(1, 0, 0, fallback);
		expect([playerAt(f, 0).hearts, playerAt(f, 1).hearts]).toEqual([4, START_HALF_HEARTS]);
		expect([0, 1, 2].map((i) => runStartHalfHearts(config, i))).toEqual(max);
		expect(runStartHalfHearts(fallback)).toBe(4);
		expect(runStartHalfHearts({})).toBe(START_HALF_HEARTS);
	});

	it("respawns and revives refill to the Archer's maximum, never past it", () => {
		const s = createSimState(1, 0, 0, { traits: ARCHER });
		s.player.hearts = 1;
		respawnPlayer(s, 0, 0);
		expect(s.player.hearts).toBe(4);
		const p = s.player;
		p.hearts = 0;
		p.dead = 1;
		revivePartyMember(p, START_HALF_HEARTS);
		expect(p.hearts).toBe(4);
	});

	it("a delta never leaves a player under MIN_START_HALF_HEARTS", () => {
		const drastic: PlayerTraits = { ...NEUTRAL_TRAITS, heartsMaxDelta: -100 };
		expect(playerStartHalfHearts(drastic)).toBe(MIN_START_HALF_HEARTS);
		expect(playerStartHalfHearts(ARCHER)).toBe(4);
		expect(playerStartHalfHearts(NEUTRAL_TRAITS)).toBe(START_HALF_HEARTS);
	});
});
