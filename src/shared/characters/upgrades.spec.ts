// docs/SILVER.md SV5: the Armory upgrades as traits. PlayerTraits.armorMaxDelta / flaskChargesDelta (neutral 0) set the
// armor and flask maxima (and starting values) in createSimState, solo and per co-op player; NEUTRAL_TRAITS hashes as
// a run without traits; upgradeTraits folds Vigor / Deep Flask / Plating into a character's traits; checkpoint refills,
// respawns, revives, the armor and flask boons / curse and a plating pip absorbing a hit all respect the new maxima.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	Button,
	EMPTY_INPUT,
	FLASK_CHARGES,
	HIT_NORMAL,
	NEUTRAL_TRAITS,
	START_ARMOR_MAX,
	createSimState,
	damagePlayer,
	hashState,
	playerAt,
	playerStartArmorMax,
	playerStartFlaskMax,
	playerStartHalfHearts,
	refillAtCheckpoint,
	respawnPlayer,
	revivePartyMember,
	step,
	type PlayerTraits,
	type SimConfig,
} from "shared/sim";
import {
	NO_UPGRADES,
	UPGRADE_EFFECTS,
	UPGRADE_MAX_LEVELS,
	UPGRADE_TRACKS,
	characterTraits,
	clampUpgradeLevels,
	hasNoUpgrades,
	readUpgradeLevels,
	sameUpgradeLevels,
	upgradeTraits,
	type UpgradeLevels,
} from "shared/characters";

const traitsWith = (over: Partial<PlayerTraits>): PlayerTraits => ({ ...NEUTRAL_TRAITS, ...over });

describe("traits: armor and flask maxima (SV5)", () => {
	it("NEUTRAL_TRAITS and zero deltas hash exactly as a run without traits (solo and co-op)", () => {
		const plain = createSimState(7, 0, 0, {});
		for (const traits of [NEUTRAL_TRAITS, traitsWith({ armorMaxDelta: 0, flaskChargesDelta: 0 })]) {
			expect(hashState(createSimState(7, 0, 0, { traits }))).toBe(hashState(plain));
		}
		const party = createSimState(7, 0, 0, { party: { size: 3 } });
		const neutralParty = createSimState(7, 0, 0, {
			party: { size: 3, traits: [NEUTRAL_TRAITS, NEUTRAL_TRAITS, NEUTRAL_TRAITS] },
		});
		expect(hashState(neutralParty)).toBe(hashState(party));
		expect([plain.player.armor, plain.player.armorMax, plain.player.flask, plain.player.flaskMax]).toEqual([
			START_ARMOR_MAX,
			START_ARMOR_MAX,
			FLASK_CHARGES,
			FLASK_CHARGES,
		]);
	});

	it("deltas set the maxima and start full, per player; never below 0", () => {
		const s = createSimState(1, 0, 0, { traits: traitsWith({ armorMaxDelta: 1, flaskChargesDelta: 2 }) });
		expect([s.player.armor, s.player.armorMax, s.player.flask, s.player.flaskMax]).toEqual([1, 1, 5, 5]);
		const config: SimConfig = {
			party: {
				size: 3,
				traits: [traitsWith({ flaskChargesDelta: 1 }), undefined, traitsWith({ armorMaxDelta: 1 })],
			},
		};
		const p = createSimState(1, 0, 0, config);
		const row = [0, 1, 2].map((i) => [playerAt(p, i).armorMax, playerAt(p, i).flaskMax]);
		expect(row).toEqual([
			[0, 4],
			[0, 3],
			[1, 3],
		]);
		expect(playerStartArmorMax(traitsWith({ armorMaxDelta: -5 }))).toBe(0);
		expect(playerStartFlaskMax(traitsWith({ flaskChargesDelta: -9 }))).toBe(0);
		expect(hashState(p)).never.toBe(hashState(createSimState(1, 0, 0, { party: { size: 3 } })));
	});

	it("refills, respawns and revives respect the new maxima", () => {
		const traits = traitsWith({ armorMaxDelta: 1, flaskChargesDelta: 1 });
		const s = createSimState(1, 0, 0, { traits });
		s.player.armor = 0;
		s.player.flask = 0;
		refillAtCheckpoint(s);
		expect([s.player.armor, s.player.flask]).toEqual([1, 4]);
		s.player.armor = 0;
		s.player.flask = 1;
		s.player.hearts = 1;
		respawnPlayer(s, 0, 0);
		expect([s.player.armor, s.player.flask, s.player.hearts]).toEqual([1, 4, 6]);
		// A revive brings hearts back only (armor and flask wait for the next checkpoint), capped at the max.
		const p = s.player;
		p.dead = 1;
		p.hearts = 0;
		p.armor = 0;
		revivePartyMember(p, 100);
		expect([p.hearts, p.armor, p.flask]).toEqual([6, 0, 4]);
	});

	it("a Plating pip absorbs a whole hit, then hearts take hits; the flask drinks down from 4", () => {
		const traits = traitsWith({ armorMaxDelta: 1, flaskChargesDelta: 1 });
		const config: SimConfig = { traits };
		const s = createSimState(1, 0, 0, config);
		expect(damagePlayer(s, HIT_NORMAL)).toBe(true);
		expect([s.player.armor, s.player.hearts]).toEqual([0, 6]);
		s.player.hurtTicks = 0;
		damagePlayer(s, HIT_NORMAL);
		expect(s.player.hearts).toBe(5);
		step(s, { ...EMPTY_INPUT, buttons: Button.FLASK }, config);
		expect([s.player.flask, s.player.hearts]).toEqual([3, 6]);
	});
});

describe("upgradeTraits (SV5)", () => {
	it("the catalogue's tracks, maxima and per-level effects", () => {
		expect([...UPGRADE_TRACKS]).toEqual(["vigor", "deepFlask", "plating"]);
		expect(UPGRADE_MAX_LEVELS).toEqual({ vigor: 2, deepFlask: 2, plating: 1 });
		expect(UPGRADE_EFFECTS).toEqual({ vigorHalfHearts: 1, deepFlaskCharges: 1, platingArmorPips: 1 });
		expect(hasNoUpgrades(NO_UPGRADES)).toBe(true);
		expect(hasNoUpgrades({ vigor: 0, deepFlask: 0, plating: 1 })).toBe(false);
	});

	it("no upgrades: the character's own traits object", () => {
		expect(upgradeTraits("knight", NO_UPGRADES)).toBe(characterTraits("knight"));
		expect(upgradeTraits("archer", { vigor: 0, deepFlask: 0, plating: 0 })).toBe(characterTraits("archer"));
	});

	it("each level's starting values, for both characters", () => {
		for (const id of ["knight", "archer"] as const) {
			const base = characterTraits(id);
			const hearts = playerStartHalfHearts(base);
			for (let vigor = 0; vigor <= UPGRADE_MAX_LEVELS.vigor; vigor++) {
				for (let deepFlask = 0; deepFlask <= UPGRADE_MAX_LEVELS.deepFlask; deepFlask++) {
					for (let plating = 0; plating <= UPGRADE_MAX_LEVELS.plating; plating++) {
						const t = upgradeTraits(id, { vigor, deepFlask, plating });
						expect([t.rollDashPercent, t.rollIframePercent]).toEqual([
							base.rollDashPercent,
							base.rollIframePercent,
						]);
						const s = createSimState(1, 0, 0, { traits: t });
						expect([s.player.hearts, s.player.heartsMax]).toEqual([hearts + vigor, hearts + vigor]);
						expect([s.player.flask, s.player.flaskMax]).toEqual([3 + deepFlask, 3 + deepFlask]);
						expect([s.player.armor, s.player.armorMax]).toEqual([plating, plating]);
					}
				}
			}
		}
	});

	it("levels past a track's maximum are clamped; junk reads as undefined", () => {
		const over = upgradeTraits("knight", { vigor: 9, deepFlask: 9, plating: 9 });
		const max = upgradeTraits("knight", UPGRADE_MAX_LEVELS);
		expect(over).toEqual(max);
		expect(clampUpgradeLevels({ vigor: -1, deepFlask: 1.7, plating: 0 / 0 })).toEqual({
			vigor: 0,
			deepFlask: 1,
			plating: 0,
		});
		expect(readUpgradeLevels({ vigor: 1, deepFlask: 2, plating: 1 })).toEqual({
			vigor: 1,
			deepFlask: 2,
			plating: 1,
		});
		const junk: unknown[] = [
			undefined,
			5,
			"x",
			{},
			{ vigor: 3, deepFlask: 0, plating: 0 },
			{ vigor: 1, deepFlask: 0.5, plating: 0 },
			{ vigor: 1, deepFlask: 0, plating: -1 },
			{ vigor: 1, deepFlask: 0 },
		];
		for (const j of junk) expect(readUpgradeLevels(j)).toBeUndefined();
		const a: UpgradeLevels = { vigor: 1, deepFlask: 0, plating: 1 };
		expect(sameUpgradeLevels(a, { vigor: 1, deepFlask: 0, plating: 1 })).toBe(true);
		expect(sameUpgradeLevels(a, NO_UPGRADES)).toBe(false);
	});

	it("co-op: each player's own upgrades", () => {
		const config: SimConfig = {
			party: {
				size: 2,
				traits: [
					upgradeTraits("knight", { vigor: 2, deepFlask: 0, plating: 1 }),
					upgradeTraits("archer", NO_UPGRADES),
				],
			},
		};
		const s = createSimState(1, 0, 0, config);
		const k = playerAt(s, 0);
		const a = playerAt(s, 1);
		expect([k.heartsMax, k.armorMax, k.flaskMax]).toEqual([
			playerStartHalfHearts(characterTraits("knight")) + 2,
			1,
			3,
		]);
		expect([a.heartsMax, a.armorMax, a.flaskMax]).toEqual([playerStartHalfHearts(characterTraits("archer")), 0, 3]);
	});
});
