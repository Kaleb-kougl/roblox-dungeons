// Boost effects (docs/BOOSTS.md B3, boostMods.ts): Fury's exact damage for every weapon's numbers with and without
// Sharpened (and a real swing), the boss's damage cap still binding; Frenzy's combined integer percent for every combo
// (sword recovery, bow cooldown); Quickstep's walk (x 130 %, two equal sub-steps of at most MAX_MOVE_STEP, no wall or
// crate tunnelling) with the roll unchanged; Aegis before armor, never refilled by Warding, saving a lethal hit before
// Second Wind, untouched by the tutorial's harmless mode; every neutral path returns its input unchanged (===).
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { TileType, gridToWorld, tileAt, type BreakablePlacement, type Dungeon } from "shared/dungeon";
import {
	AEGIS_PIPS,
	ATTACK_TICKS_BOON_PERCENT,
	AXIS_MAX,
	BOOST_PERCENT,
	BOSS_ACT1_DATA,
	BOSS_ACT1_ID,
	BOW_DATA,
	BREAKABLES_CONFIG,
	Boon,
	Boost,
	BossState,
	Button,
	DAMAGE_BOON_PERCENT,
	DEFAULT_BOUNDS,
	DROPS_CONFIG,
	EMPTY_INPUT,
	FLASK_MOVE_MULTIPLIER,
	FRENZY_ATTACK_TICKS_PERCENT,
	FURY_DAMAGE_PERCENT,
	HIT_HEAVY,
	HIT_NORMAL,
	HURT_INVULN_TICKS,
	MAX_MOVE_STEP,
	PERCENT,
	PLAYER_RADIUS,
	QUICKSTEP_WALK_PERCENT,
	ROLL_RING_DAMAGE,
	ROLL_TICKS,
	Relic,
	SECOND_WIND_HALF_HEARTS,
	SWORD_DATA,
	SWORD_V_BUSY,
	SimCtx,
	WALK_STEP,
	WEB_SWORD_TIMINGS,
	absorbWithAegis,
	attackTicks,
	boostAttackTicksPercent,
	boostDamagePercent,
	boostTicks,
	boostWalkPercent,
	combinedPercent,
	createSimState,
	grantBoon,
	grantRelic,
	playerHitDamage,
	scalePercent,
	scaleTicks,
	step,
	weaponAt,
	weaponIds,
	weaponIndex,
	type ActorSpawn,
	type EncounterRoom,
	type EndlessFloorWorld,
	type InputFrame,
	type MoveResolver,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { endlessRunFloor, type EndlessRunFloor } from "shared/run";

const SEED = 7;

// ---------------------------------------------------------------------------------------------
// An open endless arena (greybox bounds) with one combat room around (0, 6) whose test dummy spawns on first entry
// (Warding's trigger). `loadout` per world family.

const ROOMS: EncounterRoom[] = [
	{ id: 0, type: "combat", depth: 1, cx: 0, cz: 6, minX: -1, maxX: 1, minZ: 5, maxZ: 7, floorTiles: 9 },
];
const ROOM_SPAWNS: ActorSpawn[][] = [[{ kind: "test.dummy", x: 0.5, z: 6.5 }]];

function worlds(loadout: ReadonlyArray<string>): (floor: number) => EndlessFloorWorld {
	const cache = new Map<number, EndlessFloorWorld>();
	return (floor) => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: {
					bounds: DEFAULT_BOUNDS,
					loadout,
					encounter: { spawns: [], rooms: ROOMS, entranceRoom: -1, bossRoom: -1 },
				},
				bossFloor: false,
				spawnX: 0,
				spawnZ: 0,
				stairX: 1000,
				stairZ: 1000,
				roomSpawns: ROOM_SPAWNS,
				roomIdAt: (x, z) => (x >= -1 && x <= 1 && z >= 5 && z <= 7 ? 0 : -1),
			};
			cache.set(floor, w);
		}
		return w;
	};
}

const SWORD_ARENA: SimConfig = {
	endless: { runSeed: SEED, worldForFloor: worlds(["weapon.sword"]) },
	drops: DROPS_CONFIG,
};
const BOW_ARENA: SimConfig = { endless: { runSeed: SEED, worldForFloor: worlds(["weapon.bow"]) }, drops: DROPS_CONFIG };
const NO_DROPS_ARENA: SimConfig = { endless: SWORD_ARENA.endless };

function fresh(config: SimConfig = SWORD_ARENA): SimState {
	return createSimState(SEED, 0, 0, config);
}

function boost(s: SimState, kind: number, ticks = boostTicks(kind)): void {
	s.drops!.players[0].ticks[kind] = ticks;
	if (kind === Boost.AEGIS) s.drops!.players[0].aegisPips = AEGIS_PIPS;
}

function ctxOf(s: SimState, config: SimConfig): SimCtx {
	return new SimCtx().bind(s, config.endless!.worldForFloor(s.endless!.floor).config, EMPTY_INPUT);
}

const IDLE = EMPTY_INPUT;
const HIT: InputFrame = { ...EMPTY_INPUT, buttons: Button.DEBUG_HIT };
const FIRE_UP: InputFrame = { ...EMPTY_INPUT, aimZ: AXIS_MAX, buttons: Button.FIRE };

/** Every integer damage number a player hit can carry: each weapon's damage, the finisher, the heavy arrow, the Ember
 * Wake ring, the reflected enemy bullets (Mirror Cloak). */
function damageNumbers(): number[] {
	const out: number[] = [];
	const add = (v: number) => {
		if (!out.includes(v)) out.push(v);
	};
	for (const id of weaponIds()) add(weaponAt(weaponIndex(id)).data.damage);
	add(SWORD_DATA.finisherDamage);
	add(BOW_DATA.heavyDamage);
	add(ROLL_RING_DAMAGE);
	add(HIT_NORMAL);
	add(HIT_HEAVY);
	return out;
}

// ---------------------------------------------------------------------------------------------

describe("boosts: neutral paths", () => {
	it("without drops (or with no boost running) every read returns its input unchanged", () => {
		const without = fresh(NO_DROPS_ARENA);
		const idle = fresh();
		expect(BOOST_PERCENT).toBe(PERCENT);
		for (const s of [without, idle]) {
			expect([boostDamagePercent(s, 0), boostAttackTicksPercent(s, 0), boostWalkPercent(s, 0)]).toEqual([
				BOOST_PERCENT,
				BOOST_PERCENT,
				BOOST_PERCENT,
			]);
			for (const d of [...damageNumbers(), 0.1, 1 / 3]) expect(playerHitDamage(s, 0, d) === d).toBe(true);
			for (const t of [0, 1, 7, SWORD_DATA.swingRecoveryTicks, BOW_DATA.cooldownTicks])
				expect(attackTicks(s, 0, t) === t).toBe(true);
			expect(scalePercent(WALK_STEP, boostWalkPercent(s, 0)) === WALK_STEP).toBe(true);
			expect(absorbWithAegis(s, 0)).toBe(false);
		}
		expect(combinedPercent(ATTACK_TICKS_BOON_PERCENT, BOOST_PERCENT)).toBe(ATTACK_TICKS_BOON_PERCENT);
	});
});

describe("boosts: Fury", () => {
	it("exact damage for every weapon's numbers: x 3/2, after Sharpened x 15/8 (multiples of 1/8, exact)", () => {
		const plain = fresh();
		const sharp = fresh();
		grantBoon(sharp, 0, Boon.SHARPENED);
		boost(plain, Boost.FURY);
		boost(sharp, Boost.FURY);
		expect(FURY_DAMAGE_PERCENT).toBe(150);
		expect(DAMAGE_BOON_PERCENT).toBe(125);
		for (const d of damageNumbers()) {
			expect(playerHitDamage(plain, 0, d)).toBe((d * 3) / 2);
			expect(playerHitDamage(sharp, 0, d)).toBe((d * 15) / 8);
			expect(playerHitDamage(sharp, 0, d)).toBe((((d * 125) / 100) * 150) / 100);
			expect(((d * 15) / 8) * 8).toBe(d * 15);
		}
		// Sharpened alone is unchanged.
		const onlySharp = fresh();
		grantBoon(onlySharp, 0, Boon.SHARPENED);
		expect(playerHitDamage(onlySharp, 0, SWORD_DATA.damage)).toBe((SWORD_DATA.damage * 5) / 4);
		// Another player's Fury is not yours (co-op reads the acting player).
		expect(playerHitDamage(plain, 1, SWORD_DATA.damage)).toBe(SWORD_DATA.damage);
	});

	it("a real sword swing deals 4.5 (6 / 5.625 with Sharpened)", () => {
		for (const sharpened of [false, true]) {
			const s = fresh();
			if (sharpened) grantBoon(s, 0, Boon.SHARPENED);
			boost(s, Boost.FURY);
			ctxOf(s, SWORD_ARENA).spawnActor("test.dummy", 0, 1);
			step(s, FIRE_UP, SWORD_ARENA);
			expect(s.events.damageDealt).toBe(sharpened ? 5.625 : 4.5);
		}
	});

	it("Mother Bramble's damage cap still binds: capped hits deal the same total with or without Fury", () => {
		const totals: number[] = [];
		for (const fury of [false, true]) {
			const s = fresh();
			if (fury) boost(s, Boost.FURY, 100000);
			const ctx = ctxOf(s, SWORD_ARENA);
			const boss = ctx.spawnActor(BOSS_ACT1_ID, 3, 3)!;
			boss.aiState = BossState.ACTIVE;
			let total = 0;
			const ticks = 600;
			for (let t = 0; t < ticks; t++) {
				ctx.tick = s.tick + t;
				total += ctx.damageActor(boss, playerHitDamage(s, 0, SWORD_DATA.damage));
			}
			totals.push(total);
			const cap = BOSS_ACT1_DATA.damageCapPerSecond!;
			expect(total > 0).toBe(true);
			expect(total <= cap * (ticks / 60 + 2)).toBe(true);
		}
		expect(totals[1]).toBe(totals[0]);
	});
});

describe("boosts: Frenzy", () => {
	it("every boon x boost combination is one integer percent (80 x 70 / 100 = 56)", () => {
		for (const boon of [PERCENT, ATTACK_TICKS_BOON_PERCENT])
			for (const b of [BOOST_PERCENT, FRENZY_ATTACK_TICKS_PERCENT]) {
				const c = combinedPercent(boon, b);
				expect(c % 1).toBe(0);
				expect(c).toBe((boon * b) / PERCENT);
			}
		expect(combinedPercent(ATTACK_TICKS_BOON_PERCENT, FRENZY_ATTACK_TICKS_PERCENT)).toBe(56);
	});

	it("sword recovery and bow cooldown: scaleTicks by the combined percent, integers, with and without Swift Strikes", () => {
		const tickSets = [
			SWORD_DATA.swingRecoveryTicks,
			SWORD_DATA.finisherRecoveryTicks,
			WEB_SWORD_TIMINGS.swingRecoveryTicks,
			WEB_SWORD_TIMINGS.finisherRecoveryTicks,
			BOW_DATA.cooldownTicks,
		];
		for (const swift of [false, true]) {
			const s = fresh();
			if (swift) grantBoon(s, 0, Boon.SWIFT_STRIKES);
			boost(s, Boost.FRENZY);
			const percent = combinedPercent(swift ? ATTACK_TICKS_BOON_PERCENT : PERCENT, FRENZY_ATTACK_TICKS_PERCENT);
			for (const t of tickSets) {
				const got = attackTicks(s, 0, t);
				expect(got).toBe(scaleTicks(t, percent));
				expect(got % 1).toBe(0);
			}
		}
		const s = fresh();
		boost(s, Boost.FRENZY);
		expect(attackTicks(s, 0, 14)).toBe(10); // 9.8
		grantBoon(s, 0, Boon.SWIFT_STRIKES);
		expect(attackTicks(s, 0, 14)).toBe(8); // 7.84
		expect(attackTicks(s, 0, 12)).toBe(7); // 6.72
	});

	it("in play: a swing's recovery and the bow's stream cooldown use it", () => {
		const s = fresh();
		boost(s, Boost.FRENZY);
		step(s, FIRE_UP, SWORD_ARENA);
		expect(s.combat.weapons.sets[0].v[SWORD_V_BUSY]).toBe(
			scaleTicks(SWORD_DATA.swingRecoveryTicks, FRENZY_ATTACK_TICKS_PERCENT),
		);
		const b = fresh(BOW_ARENA);
		boost(b, Boost.FRENZY);
		step(b, FIRE_UP, BOW_ARENA);
		expect(b.events.shotsFired).toBe(1);
		expect(b.combat.weapons.sets[0].cooldown).toBe(scaleTicks(BOW_DATA.cooldownTicks, FRENZY_ATTACK_TICKS_PERCENT));
	});
});

describe("boosts: Quickstep", () => {
	/** A resolver that records every call (free movement). */
	function recording(calls: Array<[number, number]>): MoveResolver {
		return (x, z, dx, dz) => {
			calls.push([dx, dz]);
			return { x: x + dx, z: z + dz };
		};
	}

	function walkTick(
		quick: boolean,
		input: InputFrame,
		flask = false,
	): { calls: Array<[number, number]>; s: SimState } {
		const calls: Array<[number, number]> = [];
		const config: SimConfig = { moveResolver: recording(calls), drops: DROPS_CONFIG };
		const s = createSimState(SEED, 0, 0, config);
		if (quick) boost(s, Boost.QUICKSTEP);
		if (flask) s.player.flaskTicks = 10;
		step(s, input, config);
		return { calls, s };
	}

	it("x 130 %: a full-stick walk tick is two equal sub-steps of at most MAX_MOVE_STEP; without it one WALK_STEP", () => {
		const right: InputFrame = { ...EMPTY_INPUT, moveX: AXIS_MAX };
		const plain = walkTick(false, right);
		expect(plain.calls).toEqual([[WALK_STEP, 0]]);
		expect(plain.s.player.x).toBe(WALK_STEP);
		const quick = walkTick(true, right);
		const walk = (WALK_STEP * QUICKSTEP_WALK_PERCENT) / PERCENT;
		expect(quick.calls).toEqual([
			[walk / 2, 0],
			[walk / 2, 0],
		]);
		for (const [dx, dz] of quick.calls) expect(math.sqrt(dx * dx + dz * dz) <= MAX_MOVE_STEP).toBe(true);
		expect(quick.s.player.x).toBe(walk / 2 + walk / 2);
		expect(quick.s.player.x).toBeCloseTo(0.13, 12);
		// Diagonal: two sub-steps too; the flask-slowed walk (0.065) stays one call.
		const diagonal = walkTick(true, { ...EMPTY_INPUT, moveX: 707, moveZ: 707 });
		expect(diagonal.calls.size()).toBe(2);
		const slowed = walkTick(true, right, true);
		expect(slowed.calls).toEqual([[(WALK_STEP * FLASK_MOVE_MULTIPLIER * QUICKSTEP_WALK_PERCENT) / PERCENT, 0]]);
	});

	it("the roll is unchanged: the same resolver calls, tick for tick, with or without Quickstep", () => {
		const roll: InputFrame = { ...EMPTY_INPUT, moveX: AXIS_MAX, buttons: Button.ROLL };
		const runs: Array<Array<[number, number]>> = [];
		for (const quick of [false, true]) {
			const calls: Array<[number, number]> = [];
			const config: SimConfig = { moveResolver: recording(calls), drops: DROPS_CONFIG };
			const s = createSimState(SEED, 0, 0, config);
			if (quick) boost(s, Boost.QUICKSTEP);
			for (let t = 0; t < ROLL_TICKS - 1; t++) step(s, roll, config);
			expect(s.player.rollTicks > 0).toBe(true);
			runs.push(calls);
		}
		expect(runs[1]).toEqual(runs[0]);
	});

	/** The first endless floor cell whose Chebyshev radius-4 neighbourhood is all FLOOR (as breakables.spec.ts). */
	function openPatch(): { fl: EndlessRunFloor; gx: number; gy: number } {
		for (let r = 1; r <= 40; r++) {
			const fl = endlessRunFloor(r, 1);
			const d: Dungeon = fl.dungeon;
			for (let gy = 4; gy < d.H - 4; gy++)
				for (let gx = 4; gx < d.W - 4; gx++) {
					let open = true;
					for (let oy = -4; oy <= 4 && open; oy++)
						for (let ox = -4; ox <= 4 && open; ox++)
							if (tileAt(d, gx + ox, gy + oy) !== TileType.FLOOR) open = false;
					if (open) return { fl, gx, gy };
				}
		}
		error("no open patch");
	}

	/** A floor cell of `fl` whose east neighbour is WALL and whose two west neighbours are FLOOR. */
	function wallEast(fl: EndlessRunFloor): { gx: number; gy: number } {
		const d = fl.dungeon;
		for (let gy = 1; gy < d.H - 1; gy++)
			for (let gx = 2; gx < d.W - 1; gx++)
				if (
					tileAt(d, gx, gy) === TileType.FLOOR &&
					tileAt(d, gx - 1, gy) === TileType.FLOOR &&
					tileAt(d, gx - 2, gy) === TileType.FLOOR &&
					tileAt(d, gx + 1, gy) === TileType.WALL &&
					tileAt(d, gx + 1, gy - 1) === TileType.WALL &&
					tileAt(d, gx + 1, gy + 1) === TileType.WALL
				)
					return { gx, gy };
		error("no wall");
	}

	function pushEast(config: SimConfig, x: number, z: number, quick: boolean, ticks: number): SimState {
		const s = createSimState(SEED, x, z, config);
		if (quick) boost(s, Boost.QUICKSTEP, 100000);
		const east: InputFrame = { ...EMPTY_INPUT, moveX: AXIS_MAX };
		for (let t = 0; t < ticks; t++) step(s, east, config);
		return s;
	}

	it("no tunnelling: walking into a wall and into a crate stops at the face, as without it", () => {
		const fl = endlessRunFloor(1, 1);
		const w = wallEast(fl);
		const wallConfig: SimConfig = {
			...fl.config,
			encounter: { ...fl.config.encounter!, spawns: [] },
			drops: DROPS_CONFIG,
		};
		const wallFace = gridToWorld(w.gx) + 0.5;
		const x0 = gridToWorld(w.gx - 2);
		const z0 = gridToWorld(w.gy);
		const quick = pushEast(wallConfig, x0, z0, true, 60);
		const plain = pushEast(wallConfig, x0, z0, false, 60);
		expect(quick.player.x <= wallFace - PLAYER_RADIUS + 1e-9).toBe(true);
		expect(quick.player.x).toBeCloseTo(plain.player.x, 6);
		expect(quick.player.x > x0 + 1).toBe(true);

		const patch = openPatch();
		const crate: BreakablePlacement = { x: patch.gx + 2, y: patch.gy, kind: "crate" };
		const pc = patch.fl.config;
		const crateConfig: SimConfig = {
			...pc,
			encounter: { ...pc.encounter!, spawns: [] },
			breakables: { ...BREAKABLES_CONFIG, pieces: [crate] },
			drops: DROPS_CONFIG,
		};
		const face = gridToWorld(crate.x) - 0.5;
		const cx = gridToWorld(patch.gx - 2);
		const cz = gridToWorld(patch.gy);
		const q = pushEast(crateConfig, cx, cz, true, 60);
		const p = pushEast(crateConfig, cx, cz, false, 60);
		expect(q.player.x <= face - PLAYER_RADIUS + 1e-9).toBe(true);
		expect(q.player.x).toBeCloseTo(p.player.x, 6);
		expect(q.player.x > cx + 2).toBe(true);
	});
});

describe("boosts: Aegis", () => {
	it("a pip absorbs the whole hit before armor: armor and hearts kept, the boost ends, events.aegisBroke", () => {
		const s = fresh();
		s.player.armor = 1;
		s.player.armorMax = 1;
		boost(s, Boost.AEGIS);
		step(s, HIT, SWORD_ARENA);
		const bp = s.drops!.players[0];
		expect([s.player.armor, s.player.hearts, bp.aegisPips, bp.ticks[Boost.AEGIS]]).toEqual([
			1,
			s.player.heartsMax,
			0,
			0,
		]);
		expect([s.events.playerHits, s.player.hurtTicks]).toEqual([1, HURT_INVULN_TICKS]);
		expect(s.drops!.events.aegisBroke).toEqual([0]);
		expect(s.drops!.events.ended.size()).toBe(0); // broken, not run out
		for (let t = 0; t < HURT_INVULN_TICKS; t++) step(s, IDLE, SWORD_ARENA);
		step(s, HIT, SWORD_ARENA);
		expect([s.player.armor, s.drops!.events.aegisBroke.size()]).toEqual([0, 0]);
	});

	it("Warding refills armor, never Aegis", () => {
		const s = fresh();
		grantBoon(s, 0, Boon.WARDING);
		boost(s, Boost.AEGIS);
		step(s, HIT, SWORD_ARENA); // the Aegis breaks
		for (let t = 0; t < HURT_INVULN_TICKS; t++) step(s, IDLE, SWORD_ARENA);
		step(s, HIT, SWORD_ARENA); // armor takes this one
		expect([s.player.armor, s.drops!.players[0].aegisPips]).toEqual([s.player.armorMax - 1, 0]);
		s.player.z = 6;
		step(s, IDLE, SWORD_ARENA); // a room's spawns: Warding
		expect(s.events.roomEntered).toBe(1);
		expect([s.player.armor, s.drops!.players[0].aegisPips]).toEqual([s.player.armorMax, 0]);
	});

	it("a lethal hit is absorbed before Second Wind is needed; the next one spends Second Wind", () => {
		const s = fresh();
		grantRelic(s, 0, Relic.SECOND_WIND);
		s.player.armor = 0;
		s.player.hearts = 1;
		boost(s, Boost.AEGIS);
		step(s, HIT, SWORD_ARENA);
		expect([s.player.dead, s.player.hearts, s.run!.players[0].secondWindUsed]).toEqual([0, 1, 0]);
		for (let t = 0; t < HURT_INVULN_TICKS; t++) step(s, IDLE, SWORD_ARENA);
		step(s, HIT, SWORD_ARENA);
		expect([s.player.dead, s.player.hearts, s.run!.players[0].secondWindUsed]).toEqual([
			0,
			SECOND_WIND_HALF_HEARTS,
			1,
		]);
	});

	it("the tutorial's harmless mode is untouched: the hit lands harmlessly and the pip stays", () => {
		const config: SimConfig = { tutorial: { harmless: true }, drops: DROPS_CONFIG };
		const s = createSimState(SEED, 0, 0, config);
		boost(s, Boost.AEGIS);
		step(s, HIT, config);
		expect([s.tutorial!.harmlessHits, s.events.playerHits, s.drops!.players[0].aegisPips]).toEqual([
			1,
			1,
			AEGIS_PIPS,
		]);
		expect(s.drops!.events.aegisBroke.size()).toBe(0);
	});

	it("unused, it runs out after its 15 s", () => {
		const s = fresh();
		boost(s, Boost.AEGIS);
		for (let t = 0; t < boostTicks(Boost.AEGIS); t++) step(s, IDLE, SWORD_ARENA);
		expect([s.drops!.players[0].aegisPips, s.drops!.players[0].ticks[Boost.AEGIS]]).toEqual([0, 0]);
		s.player.armor = 1;
		step(s, HIT, SWORD_ARENA);
		expect(s.player.armor).toBe(0);
	});
});
