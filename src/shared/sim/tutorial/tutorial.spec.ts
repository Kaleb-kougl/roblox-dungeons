// First-run tutorial in the sim (docs/TUTORIAL.md "Architecture §1", task T1): harmless hits (bullets, contact damage,
// DEBUG_HIT) land like real hits (playerHits, hurtTicks, lastHitSource, the bullet consumed, the combo cut, Hourglass)
// but never take armor or hearts, never trigger Second Wind and never kill; startHalfHearts (solo, a party, the clamp);
// the flask heals back up; floor changes keep hearts; the appended "tutorial" hash group, clone and replay; the
// block lesson's guard lock (its room's spawns held at TUTORIAL_GUARD_HOLD_HP until a block); the pellet lesson's
// sweep lock (docs/PELLETS.md PL12: its twin, released by the room's last pellet; the real-world run with weapons, the
// pickups and the last pickup on a lethal hit's tick is in shared/run tutorial.spec.ts).
import { describe, expect, it } from "@rbxts/jest-globals";
import { TEST_CHASER } from "shared/sim/testing";
import {
	AXIS_MAX,
	BULLET_Y,
	BulletKind,
	BulletPayload,
	Button,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_BOUNDS,
	EMPTY_INPUT,
	FLASK_HEAL_HALF_HEARTS,
	FLASK_USE_TICKS,
	HIT_NORMAL,
	HOURGLASS_TICKS,
	HURT_INVULN_TICKS,
	PARTY_SUBSYSTEM,
	Recorder,
	Relic,
	SOLO_PLAYER,
	START_HALF_HEARTS,
	TUTORIAL_MIN_START_HALF_HEARTS,
	TUTORIAL_START_HALF_HEARTS,
	TUTORIAL_SUBSYSTEM,
	BOSS_ACT1_DATA,
	BOSS_ACT1_ID,
	TUTORIAL_FULL_BOSS_HP_PERCENT,
	TUTORIAL_HASH_FIELDS,
	GUARD_LOCK_ARMED,
	GUARD_LOCK_RELEASED,
	GUARD_LOCK_WAITING,
	NO_GUARD_LOCK_FLOOR,
	NO_GUARD_LOCK_ROOM,
	TUTORIAL_GUARD_HOLD_HP,
	NO_PELLET_LOCK_FLOOR,
	NO_PELLET_LOCK_ROOM,
	PELLET_LOCK_ARMED,
	PELLET_LOCK_RELEASED,
	PELLET_LOCK_WAITING,
	isTutorialGuardHolding,
	isTutorialGuardReleased,
	isTutorialPelletHolding,
	isTutorialPelletReleased,
	tutorialOnPelletsSwept,
	tutorialHeldDamage,
	tutorialOnGuardCancels,
	tutorialOnRoomSpawned,
	archetypeIndex,
	cloneSimState,
	compose,
	createSimState,
	gen,
	grantRelic,
	hashLayout,
	hashState,
	isTutorialHarmless,
	mod,
	playerAt,
	runReplay,
	step,
	stepParty,
	subsystemHashes,
	tutorialBossHp,
	tutorialStartHalfHearts,
	writeHashFields,
	type ActorSpawn,
	type EncounterConfig,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const enc = (spawns: ActorSpawn[]): EncounterConfig => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });

/** A fresh tutorial state without a guard lock. */
function tutorialStateOf(harmless: number) {
	return {
		harmless,
		harmlessHits: 0,
		bossHpPercent: TUTORIAL_FULL_BOSS_HP_PERCENT,
		guardLockFloor: NO_GUARD_LOCK_FLOOR,
		guardLockRoom: NO_GUARD_LOCK_ROOM,
		guardLock: GUARD_LOCK_WAITING,
		guardLockFirstId: 0,
		guardLockEndId: 0,
		pelletLockFloor: NO_PELLET_LOCK_FLOOR,
		pelletLockRoom: NO_PELLET_LOCK_ROOM,
		pelletLock: PELLET_LOCK_WAITING,
		pelletLockFirstId: 0,
		pelletLockEndId: 0,
	};
}

function frame(mx: number, mz: number, buttons = 0, ax = 0, az = 0): InputFrame {
	return { moveX: mx * AXIS_MAX, moveZ: mz * AXIS_MAX, aimX: ax * AXIS_MAX, aimZ: az * AXIS_MAX, buttons };
}

const IDLE = EMPTY_INPUT;
const HIT = frame(0, 0, Button.DEBUG_HIT);
const HARMLESS: SimConfig = { tutorial: { harmless: true } };
const WOUNDED: SimConfig = { tutorial: { harmless: true, startHalfHearts: TUTORIAL_START_HALF_HEARTS } };

/** One enemy bullet at (x, z) heading +Z at `speed` (the table's 1-bullet arc). */
function shoot(s: SimState, x: number, z: number, speed: number, damage = HIT_NORMAL): number {
	const payload = BulletPayload.pack({ damage, kind: BulletKind.SNIPER });
	const origin = { x, y: BULLET_Y, z };
	return s.combat.enemyBullets.fireAt(origin, () => compose(gen.arc(1, 0, speed, 0), mod.payload(payload)), 0);
}

/** A DEBUG_HIT press every HURT_INVULN_TICKS + 1 ticks (release in between), `presses` times. */
function debugHits(s: SimState, presses: number, config: SimConfig): number {
	let hits = 0;
	for (let k = 0; k < presses; k++) {
		step(s, HIT, config);
		hits += s.events.playerHits;
		for (let t = 0; t < HURT_INVULN_TICKS; t++) {
			step(s, IDLE, config);
			hits += s.events.playerHits;
		}
	}
	return hits;
}

describe("tutorial state and hash", () => {
	it("without config.tutorial: no tutorial state and the hash has no tutorial group", () => {
		const s = createSimState(1, 0, 0, {});
		expect(s.tutorial).toBe(undefined);
		expect(isTutorialHarmless(s)).toBe(false);
		for (const g of hashLayout(s).groups) expect(g.name).never.toBe(TUTORIAL_SUBSYSTEM);
		expect(subsystemHashes(s)[TUTORIAL_SUBSYSTEM]).toBe(undefined);
	});

	it("with it: state.tutorial, hashed as the last group; layout values are writeHashFields, names cover them", () => {
		const s = createSimState(1, 0, 0, HARMLESS);
		expect(s.tutorial).toEqual(tutorialStateOf(1));
		expect(isTutorialHarmless(s)).toBe(true);
		step(s, HIT, HARMLESS);
		const layout = hashLayout(s, true);
		const last = layout.groups[layout.groups.size() - 1];
		expect(last.name).toBe(TUTORIAL_SUBSYSTEM);
		expect(layout.names.size()).toBe(layout.values.size());
		expect(layout.names[last.start]).toBe("tutorial.harmless");
		expect(layout.names[last.start + 1]).toBe("tutorial.harmlessHits");
		expect(layout.names[last.start + 2]).toBe("tutorial.bossHpPercent");
		expect([layout.values[last.start], layout.values[last.start + 1], layout.values[last.start + 2]]).toEqual([
			1,
			1,
			TUTORIAL_FULL_BOSS_HP_PERCENT,
		]);
		expect(last.finish - last.start).toBe(TUTORIAL_HASH_FIELDS.size());
		expect(last.finish).toBe(layout.values.size());
		const plain = writeHashFields(s, []);
		expect(plain.size()).toBe(layout.values.size());
		for (let i = 0; i < plain.size(); i++) expect(layout.values[i]).toBe(plain[i]);
		expect(subsystemHashes(s)[TUTORIAL_SUBSYSTEM]).never.toBe(undefined);
		// Every tutorial field is hashed.
		const before = hashState(s);
		s.tutorial!.harmlessHits += 1;
		expect(hashState(s)).never.toBe(before);
		s.tutorial!.harmlessHits -= 1;
		s.tutorial!.harmless = 0;
		expect(hashState(s)).never.toBe(before);
		s.tutorial!.harmless = 1;
		expect(hashState(s)).toBe(before);
		s.tutorial!.bossHpPercent = 20;
		expect(hashState(s)).never.toBe(before);
		s.tutorial!.bossHpPercent = TUTORIAL_FULL_BOSS_HP_PERCENT;
		// The guard lock's fields (appended after bossHpPercent, in TUTORIAL_HASH_FIELDS order).
		for (let k = 3; k < TUTORIAL_HASH_FIELDS.size(); k++) {
			const f = TUTORIAL_HASH_FIELDS[k];
			expect(layout.names[last.start + k]).toBe(`tutorial.${f}`);
			const t = s.tutorial! as unknown as Record<string, number>;
			t[f] += 7;
			expect([f, hashState(s) !== before]).toEqual([f, true]);
			t[f] -= 7;
		}
		expect(hashState(s)).toBe(before);
	});

	it("the core groups match a plain run's: the tutorial only appends", () => {
		const a = createSimState(3, 0, 0, {});
		const b = createSimState(3, 0, 0, HARMLESS);
		const la = hashLayout(a);
		const lb = hashLayout(b);
		expect(lb.groups.size()).toBe(la.groups.size() + 1);
		for (let i = 0; i < la.values.size(); i++) expect(lb.values[i]).toBe(la.values[i]);
		expect(hashState(b)).never.toBe(hashState(a));
	});

	it("in a party the tutorial group comes after party", () => {
		const config: SimConfig = { party: { size: 2 }, tutorial: { harmless: true } };
		const s = createSimState(1, 0, 0, config);
		const groups = hashLayout(s).groups;
		expect(groups[groups.size() - 2].name).toBe(PARTY_SUBSYSTEM);
		expect(groups[groups.size() - 1].name).toBe(TUTORIAL_SUBSYSTEM);
	});

	it("cloneSimState copies the tutorial state while pristine", () => {
		const s = createSimState(1, 0, 0, WOUNDED);
		debugHits(s, 2, WOUNDED);
		const c = cloneSimState(s);
		expect(c.tutorial).never.toBe(s.tutorial);
		expect(c.tutorial).toEqual(s.tutorial);
		expect(hashState(c)).toBe(hashState(s));
		debugHits(s, 1, WOUNDED);
		debugHits(c, 1, WOUNDED);
		expect(hashState(c)).toBe(hashState(s));
	});
});

describe("harmless hits", () => {
	it("an enemy bullet lands like a real hit (same tick, hurtTicks, bullet consumed) but takes no armor or hearts", () => {
		const real = createSimState(1, 0, 0, {});
		const tut = createSimState(1, 0, 0, HARMLESS);
		real.player.armor = 1;
		tut.player.armor = 1;
		shoot(real, 0, -3, 6);
		shoot(tut, 0, -3, 6);
		let hitTick = -1;
		for (let t = 0; t < 60; t++) {
			step(real, IDLE, {});
			step(tut, IDLE, HARMLESS);
			expect(tut.events.playerHits).toBe(real.events.playerHits);
			expect(tut.events.lastHitSource).toBe(real.events.lastHitSource);
			expect(tut.player.hurtTicks).toBe(real.player.hurtTicks);
			expect(tut.combat.enemyBullets.activeCount).toBe(real.combat.enemyBullets.activeCount);
			if (tut.events.playerHits > 0) {
				hitTick = t;
				expect(tut.player.hurtTicks).toBe(HURT_INVULN_TICKS);
			}
		}
		expect(hitTick).toBeGreaterThan(0);
		expect(real.player.armor).toBe(0); // the real hit took the armor pip
		expect(tut.player.armor).toBe(1);
		expect(tut.player.hearts).toBe(START_HALF_HEARTS);
		expect(tut.combat.enemyBullets.activeCount).toBe(0); // consumed
		expect(tut.tutorial!.harmlessHits).toBe(1);
	});

	it("bullets during i-frames or post-hit invulnerability pass through and are not counted", () => {
		const s = createSimState(1, 0, 0, HARMLESS);
		shoot(s, 0, 0, 0);
		step(s, IDLE, HARMLESS);
		expect(s.events.playerHits).toBe(1);
		shoot(s, 0, 0, 0);
		step(s, IDLE, HARMLESS);
		expect(s.events.playerHits).toBe(0);
		expect(s.combat.enemyBullets.activeCount).toBe(1);
		expect(s.tutorial!.harmlessHits).toBe(1);
		// 0-damage (stress) bullets never land.
		const z = createSimState(1, 0, 0, HARMLESS);
		shoot(z, 0, 0, 0, 0);
		for (let t = 0; t < 5; t++) step(z, IDLE, HARMLESS);
		expect(z.tutorial!.harmlessHits).toBe(0);
		expect(z.combat.enemyBullets.activeCount).toBe(1);
	});

	it("contact damage lands every HURT_INVULN_TICKS, names its source, and never hurts", () => {
		const config: SimConfig = {
			encounter: enc([{ kind: TEST_CHASER.id, x: 0, z: 0.5 }]),
			tutorial: { harmless: true },
		};
		const s = createSimState(1, 0, 0, config);
		step(s, IDLE, config);
		expect(s.events.playerHits).toBe(1);
		expect(s.events.lastHitSource).toBe(archetypeIndex(TEST_CHASER.id));
		expect(s.player.hurtTicks).toBe(HURT_INVULN_TICKS);
		for (let t = 1; t < HURT_INVULN_TICKS; t++) {
			step(s, IDLE, config);
			expect(s.events.playerHits).toBe(0);
		}
		step(s, IDLE, config);
		expect(s.events.playerHits).toBe(1);
		let hits = 2;
		for (let t = 0; t < 1200; t++) {
			step(s, IDLE, config);
			hits += s.events.playerHits;
			expect(s.events.playerDied).toBe(0);
		}
		expect(hits).toBeGreaterThan(20);
		expect(s.tutorial!.harmlessHits).toBe(hits);
		expect([s.player.hearts, s.player.armor, s.player.dead]).toEqual([START_HALF_HEARTS, 0, 0]);
	});

	it("DEBUG_HIT is harmless too; at 1 half heart the player survives any number of hits", () => {
		const config: SimConfig = { tutorial: { harmless: true, startHalfHearts: 1 } };
		const s = createSimState(1, 0, 0, config);
		expect(s.player.hearts).toBe(1);
		const hits = debugHits(s, 30, config);
		expect(hits).toBe(30);
		expect(s.tutorial!.harmlessHits).toBe(30);
		expect([s.player.hearts, s.player.dead]).toEqual([1, 0]);
		// The same hit without harmless kills.
		const lethal: SimConfig = { tutorial: { harmless: false, startHalfHearts: 1 } };
		const d = createSimState(1, 0, 0, lethal);
		expect(d.tutorial).toEqual(tutorialStateOf(0));
		step(d, HIT, lethal);
		expect([d.player.hearts, d.player.dead, d.events.playerDied, d.tutorial!.harmlessHits]).toEqual([0, 1, 1, 0]);
	});

	it("cuts the combo like a real hit (scored runs)", () => {
		const config: SimConfig = { scoring: {}, tutorial: { harmless: true } };
		const s = createSimState(1, 0, 0, config);
		s.score!.combo = 50;
		step(s, HIT, config);
		expect(s.score!.combo).toBe(25);
		expect(s.score!.events.comboCut).toBe(1);
		expect(s.score!.hitsTaken).toBe(1);
		expect(s.player.hearts).toBe(START_HALF_HEARTS);
	});

	it("co-op: every party member's hits are harmless, each with its own invulnerability", () => {
		const config: SimConfig = { party: { size: 2 }, tutorial: { harmless: true } };
		const s = createSimState(1, 0, 0, config);
		stepParty(s, [IDLE, HIT], config);
		expect(s.events.playerHits).toBe(1);
		expect(playerAt(s, 1).hurtTicks).toBe(HURT_INVULN_TICKS);
		expect(playerAt(s, 0).hurtTicks).toBe(0);
		stepParty(s, [HIT, IDLE], config);
		expect(s.events.playerHits).toBe(1);
		expect(s.tutorial!.harmlessHits).toBe(2);
		for (let i = 0; i < 2; i++)
			expect([playerAt(s, i).hearts, playerAt(s, i).dead]).toEqual([START_HALF_HEARTS, 0]);
	});
});

// An open endless arena (one empty room; floors end by the debug skip only), for the M2 relics and floor changes.
const ROOM_SPAWNS: ActorSpawn[][] = [];
const arenaWorlds = new Map<number, EndlessFloorWorld>();
function arenaWorld(floor: number): EndlessFloorWorld {
	let w = arenaWorlds.get(floor);
	if (w === undefined) {
		w = {
			floor,
			config: { bounds: DEFAULT_BOUNDS, encounter: enc([]) },
			bossFloor: false,
			spawnX: 0,
			spawnZ: 0,
			stairX: 1000,
			stairZ: 1000,
			roomSpawns: ROOM_SPAWNS,
			roomIdAt: () => -1,
		};
		arenaWorlds.set(floor, w);
	}
	return w;
}
const ARENA: SimConfig = {
	endless: { runSeed: 42, worldForFloor: arenaWorld },
	scoring: {},
	tutorial: { harmless: true, startHalfHearts: TUTORIAL_START_HALF_HEARTS },
};

describe("harmless hits in an endless run (M2 relics, floor changes)", () => {
	it("the Hourglass starts on a harmless hit; Second Wind never triggers", () => {
		const s = createSimState(42, 0, 0, ARENA);
		grantRelic(s, SOLO_PLAYER, Relic.HOURGLASS);
		grantRelic(s, SOLO_PLAYER, Relic.SECOND_WIND);
		s.player.hearts = 1;
		step(s, HIT, ARENA);
		const me = s.run!.players[SOLO_PLAYER];
		expect(s.events.playerHits).toBe(1);
		expect(me.hourglassTicks).toBe(HOURGLASS_TICKS - 1); // as in a real run (progression.spec)
		expect([s.player.hearts, s.player.dead, me.secondWindUsed, s.run!.events.secondWind]).toEqual([1, 0, 0, 0]);
	});

	it("a floor change keeps the wounded hearts (refillAtCheckpoint refills armor / flask / Embers only)", () => {
		const s = createSimState(42, 0, 0, ARENA);
		expect([s.player.hearts, s.player.heartsMax]).toEqual([TUTORIAL_START_HALF_HEARTS, START_HALF_HEARTS]);
		for (let t = 0; t < 10; t++) step(s, IDLE, ARENA);
		expect(s.player.hearts).toBe(TUTORIAL_START_HALF_HEARTS);
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), ARENA);
		expect(s.endless!.floor).toBe(2);
		expect(s.player.hearts).toBe(TUTORIAL_START_HALF_HEARTS);
	});
});

describe("startHalfHearts", () => {
	it("every player starts with it (solo and a 2-player party); heartsMax is unchanged", () => {
		const s = createSimState(1, 0, 0, WOUNDED);
		expect([s.player.hearts, s.player.heartsMax]).toEqual([TUTORIAL_START_HALF_HEARTS, START_HALF_HEARTS]);
		const config: SimConfig = { party: { size: 2 }, tutorial: { harmless: true, startHalfHearts: 3 } };
		const p = createSimState(1, 0, 0, config);
		for (let i = 0; i < 2; i++) {
			expect([playerAt(p, i).hearts, playerAt(p, i).heartsMax]).toEqual([3, START_HALF_HEARTS]);
		}
	});

	it("absent: full hearts; clamped to [TUTORIAL_MIN_START_HALF_HEARTS, heartsMax]; a non-integer throws", () => {
		expect(createSimState(1, 0, 0, HARMLESS).player.hearts).toBe(START_HALF_HEARTS);
		const at = (n: number) => createSimState(1, 0, 0, { tutorial: { harmless: true, startHalfHearts: n } }).player;
		expect(at(0).hearts).toBe(TUTORIAL_MIN_START_HALF_HEARTS);
		expect(at(-5).hearts).toBe(TUTORIAL_MIN_START_HALF_HEARTS);
		expect(at(START_HALF_HEARTS + 10).hearts).toBe(START_HALF_HEARTS);
		expect(at(START_HALF_HEARTS).hearts).toBe(START_HALF_HEARTS);
		expect(tutorialStartHalfHearts({ harmless: true }, 8)).toBe(8);
		expect(tutorialStartHalfHearts({ harmless: true, startHalfHearts: 5 }, 8)).toBe(5);
		expect(() => at(2.5)).toThrow();
		expect(() => at(0 / 0)).toThrow();
	});

	it("the flask heals from the wounded start back up to the maximum", () => {
		// The tutorial's numbers: one flask fills the wounded start exactly.
		expect(TUTORIAL_START_HALF_HEARTS + FLASK_HEAL_HALF_HEARTS).toBe(START_HALF_HEARTS);
		const s = createSimState(1, 0, 0, WOUNDED);
		const flask = frame(0, 0, Button.FLASK);
		const charges = s.player.flask;
		step(s, flask, WOUNDED);
		expect(s.events.flaskUsed).toBe(1);
		expect([s.player.hearts, s.player.flask]).toEqual([START_HALF_HEARTS, charges - 1]);
		for (let t = 0; t < FLASK_USE_TICKS; t++) step(s, IDLE, WOUNDED);
		step(s, flask, WOUNDED); // full: the flask does nothing
		expect([s.events.flaskUsed, s.player.hearts, s.player.flask]).toEqual([0, START_HALF_HEARTS, charges - 1]);
		// From 1 half heart: two flasks heal 1 -> 3 -> 5.
		const low: SimConfig = { tutorial: { harmless: true, startHalfHearts: 1 } };
		const l = createSimState(1, 0, 0, low);
		step(l, flask, low);
		expect(l.player.hearts).toBe(1 + FLASK_HEAL_HALF_HEARTS);
		for (let t = 0; t < FLASK_USE_TICKS; t++) step(l, IDLE, low);
		step(l, flask, low);
		expect(l.player.hearts).toBe(1 + 2 * FLASK_HEAL_HALF_HEARTS);
	});
});

describe("bossHpPercent", () => {
	const BOSS = BOSS_ACT1_DATA;
	const bossAt = (config: SimConfig) => {
		const s = createSimState(1, 0, 0, config);
		const kind = archetypeIndex(BOSS_ACT1_ID);
		return s.combat.actors.filter((a) => a.kind === kind)[0];
	};
	const withBoss = (tutorial?: SimConfig["tutorial"]): SimConfig => ({
		encounter: enc([
			{ kind: BOSS_ACT1_ID, x: 6, z: 6 },
			{ kind: TEST_CHASER.id, x: -6, z: -6 },
		]),
		tutorial,
	});

	it("a boss spawns with base hp x percent / 100 (hp and hpMax); other actors and other runs are unchanged", () => {
		const percent = 20;
		const b = bossAt(withBoss({ harmless: true, bossHpPercent: percent }));
		expect(b.hp).toBe((BOSS.hp * percent) / 100);
		expect(b.hp).toBe(108);
		expect(b.hpMax).toBe(b.hp);
		// Without the field, at 100, and outside the tutorial: her full hp, exactly.
		expect(bossAt(withBoss({ harmless: true })).hp).toBe(BOSS.hp);
		expect(bossAt(withBoss({ harmless: true, bossHpPercent: 100 })).hp).toBe(BOSS.hp);
		expect(bossAt(withBoss()).hp).toBe(BOSS.hp);
		// Not a boss: untouched.
		const s = createSimState(1, 0, 0, withBoss({ harmless: true, bossHpPercent: percent }));
		const chaser = s.combat.actors.filter((a) => a.kind === archetypeIndex(TEST_CHASER.id))[0];
		expect(chaser.hp).toBe(TEST_CHASER.data.hp);
		expect(s.tutorial!.bossHpPercent).toBe(percent);
		// tutorialBossHp is the identity outside a tutorial run and at 100.
		expect(tutorialBossHp(createSimState(1, 0, 0, {}), 540)).toBe(540);
		expect(tutorialBossHp(createSimState(1, 0, 0, HARMLESS), 540)).toBe(540);
	});

	it("must be an integer >= 1", () => {
		for (const bad of [0, -5, 12.5, 0 / 0]) {
			expect(() => createSimState(1, 0, 0, { tutorial: { harmless: true, bossHpPercent: bad } })).toThrow(
				"bossHpPercent",
			);
		}
		expect(
			createSimState(1, 0, 0, { tutorial: { harmless: true, bossHpPercent: 1 } }).tutorial!.bossHpPercent,
		).toBe(1);
	});

	it("the phase marks are fractions of the reduced hpMax: phase II at 66 %, phase III at 33 % (debug hits, J)", () => {
		const config = withBoss({ harmless: true, bossHpPercent: 20 });
		const s = createSimState(1, 6, 6, config);
		const kind = archetypeIndex(BOSS_ACT1_ID);
		const b = s.combat.actors.filter((a) => a.kind === kind)[0];
		const J = frame(0, 0, Button.DEBUG_BOSS);
		const phaseAt: number[] = [];
		for (let t = 0; t < 2000 && b.alive !== 0; t++) {
			step(s, t % 10 === 5 ? J : IDLE, config);
			if (s.events.bossPhase > 0) phaseAt[s.events.bossPhase] = b.hp / b.hpMax;
		}
		expect(b.alive).toBe(0);
		expect(phaseAt[1]).toBe(1);
		expect(phaseAt[2]).toBeCloseTo(BOSS.phaseHp[0], 9);
		expect(phaseAt[3]).toBeCloseTo(BOSS.phaseHp[1], 9);
	});
});

describe("guardLock (the block lesson)", () => {
	const LOCK: SimConfig["tutorial"] = { harmless: true, guardLock: { floor: 1, room: 4 } };
	const twoChasers = (tutorial: SimConfig["tutorial"]): SimState =>
		createSimState(1, 0, 0, {
			encounter: enc([
				{ kind: TEST_CHASER.id, x: 6, z: 6 },
				{ kind: TEST_CHASER.id, x: -6, z: -6 },
			]),
			tutorial,
		});
	const chasers = (s: SimState) => s.combat.actors.filter((a) => a.kind === archetypeIndex(TEST_CHASER.id));

	it("is stored and hashed; a bad floor or room throws", () => {
		const s = createSimState(1, 0, 0, { tutorial: LOCK });
		expect([s.tutorial!.guardLockFloor, s.tutorial!.guardLockRoom, s.tutorial!.guardLock]).toEqual([
			1,
			4,
			GUARD_LOCK_WAITING,
		]);
		expect(hashState(s)).never.toBe(hashState(createSimState(1, 0, 0, HARMLESS)));
		for (const bad of [
			{ floor: 0, room: 4 },
			{ floor: 1.5, room: 4 },
			{ floor: 1, room: -1 },
			{ floor: 1, room: 0.5 },
		]) {
			expect(() => createSimState(1, 0, 0, { tutorial: { harmless: true, guardLock: bad } })).toThrow(
				"guardLock",
			);
		}
	});

	it("arms only on its floor and room; then its spawns keep TUTORIAL_GUARD_HOLD_HP, others take every hit", () => {
		const s = twoChasers(LOCK);
		const [a, b] = chasers(s);
		tutorialOnRoomSpawned(s, 2, 4, [a]); // wrong floor
		tutorialOnRoomSpawned(s, 1, 3, [a]); // wrong room
		expect(s.tutorial!.guardLock).toBe(GUARD_LOCK_WAITING);
		expect(tutorialHeldDamage(s, a, a.hp)).toBe(a.hp);
		tutorialOnGuardCancels(s, 3); // a block before the room: does not count
		expect(s.tutorial!.guardLock).toBe(GUARD_LOCK_WAITING);
		tutorialOnRoomSpawned(s, 1, 4, [a]);
		expect([s.tutorial!.guardLock, s.tutorial!.guardLockFirstId, s.tutorial!.guardLockEndId]).toEqual([
			GUARD_LOCK_ARMED,
			a.id,
			a.id + 1,
		]);
		// A lethal hit leaves TUTORIAL_GUARD_HOLD_HP; a small one lands whole; at the hold nothing lands.
		expect(tutorialHeldDamage(s, a, a.hp)).toBe(a.hp - TUTORIAL_GUARD_HOLD_HP);
		expect(tutorialHeldDamage(s, a, 0.5)).toBe(0.5);
		expect(tutorialHeldDamage(s, b, b.hp)).toBe(b.hp); // not one of the room's spawns
		expect(isTutorialGuardHolding(s)).toBe(false);
		a.hp = TUTORIAL_GUARD_HOLD_HP;
		expect(tutorialHeldDamage(s, a, 1)).toBe(0);
		expect(isTutorialGuardHolding(s)).toBe(true);
		// Arming happens once: a later spawn in the room is not held.
		tutorialOnRoomSpawned(s, 1, 4, [b]);
		expect(tutorialHeldDamage(s, b, b.hp)).toBe(b.hp);
		// No block (0 bullets erased) keeps it; a block releases it for good.
		tutorialOnGuardCancels(s, 0);
		expect(isTutorialGuardReleased(s)).toBe(false);
		tutorialOnGuardCancels(s, 1);
		expect([s.tutorial!.guardLock, isTutorialGuardReleased(s), isTutorialGuardHolding(s)]).toEqual([
			GUARD_LOCK_RELEASED,
			true,
			false,
		]);
		expect(tutorialHeldDamage(s, a, 1)).toBe(1);
	});

	it("the held range covers every actor of the spawn; an empty spawn releases at once", () => {
		const s = twoChasers(LOCK);
		const [a, b] = chasers(s);
		tutorialOnRoomSpawned(s, 1, 4, [b, a]);
		expect([s.tutorial!.guardLockFirstId, s.tutorial!.guardLockEndId]).toEqual([a.id, b.id + 1]);
		expect(tutorialHeldDamage(s, a, a.hp)).toBe(a.hp - TUTORIAL_GUARD_HOLD_HP);
		expect(tutorialHeldDamage(s, b, b.hp)).toBe(b.hp - TUTORIAL_GUARD_HOLD_HP);
		const e = twoChasers(LOCK);
		tutorialOnRoomSpawned(e, 1, 4, []);
		expect(e.tutorial!.guardLock).toBe(GUARD_LOCK_RELEASED);
	});

	it("without a lock (or outside the tutorial) nothing is ever held", () => {
		for (const s of [twoChasers({ harmless: true }), twoChasers(undefined)]) {
			const [a] = chasers(s);
			tutorialOnRoomSpawned(s, 1, 4, [a]);
			tutorialOnRoomSpawned(s, 1, NO_GUARD_LOCK_ROOM, [a]);
			expect(tutorialHeldDamage(s, a, a.hp)).toBe(a.hp);
			expect([isTutorialGuardHolding(s), isTutorialGuardReleased(s)]).toEqual([false, false]);
		}
	});
});

describe("pelletLock (the pellet lesson, docs/PELLETS.md PL12)", () => {
	const LOCK: SimConfig["tutorial"] = { harmless: true, pelletLock: { floor: 1, room: 7 } };
	const BOTH: SimConfig["tutorial"] = {
		harmless: true,
		guardLock: { floor: 1, room: 4 },
		pelletLock: { floor: 1, room: 7 },
	};
	const twoChasers = (tutorial: SimConfig["tutorial"]): SimState =>
		createSimState(1, 0, 0, {
			encounter: enc([
				{ kind: TEST_CHASER.id, x: 6, z: 6 },
				{ kind: TEST_CHASER.id, x: -6, z: -6 },
			]),
			tutorial,
		});
	const chasers = (s: SimState) => s.combat.actors.filter((a) => a.kind === archetypeIndex(TEST_CHASER.id));

	it("is stored and hashed (appended after the guard lock's fields); a bad floor or room throws", () => {
		const s = createSimState(1, 0, 0, { tutorial: LOCK });
		const t = s.tutorial!;
		expect([t.pelletLockFloor, t.pelletLockRoom, t.pelletLock]).toEqual([1, 7, PELLET_LOCK_WAITING]);
		expect([t.guardLockFloor, t.guardLockRoom]).toEqual([NO_GUARD_LOCK_FLOOR, NO_GUARD_LOCK_ROOM]);
		expect(hashState(s)).never.toBe(hashState(createSimState(1, 0, 0, HARMLESS)));
		const tail = TUTORIAL_HASH_FIELDS.size();
		expect([
			TUTORIAL_HASH_FIELDS[tail - 5],
			TUTORIAL_HASH_FIELDS[tail - 4],
			TUTORIAL_HASH_FIELDS[tail - 3],
			TUTORIAL_HASH_FIELDS[tail - 2],
			TUTORIAL_HASH_FIELDS[tail - 1],
		]).toEqual(["pelletLockFloor", "pelletLockRoom", "pelletLock", "pelletLockFirstId", "pelletLockEndId"]);
		expect(TUTORIAL_HASH_FIELDS[tail - 6]).toBe("guardLockEndId");
		for (const bad of [
			{ floor: 0, room: 7 },
			{ floor: 1.5, room: 7 },
			{ floor: 1, room: -1 },
			{ floor: 1, room: 0.5 },
		]) {
			expect(() => createSimState(1, 0, 0, { tutorial: { harmless: true, pelletLock: bad } })).toThrow(
				"pelletLock",
			);
		}
	});

	it("an armed lock holds its spawns at the hold hp (the guard lock's path); the swept room releases it for good", () => {
		const s = twoChasers(LOCK);
		const [a, b] = chasers(s);
		const t = s.tutorial!;
		// Test-only surgery: armed on `a` (arming needs a scored endless room with pellets: shared/run tutorial.spec).
		t.pelletLock = PELLET_LOCK_ARMED;
		t.pelletLockFirstId = a.id;
		t.pelletLockEndId = a.id + 1;
		expect(tutorialHeldDamage(s, a, a.hp)).toBe(a.hp - TUTORIAL_GUARD_HOLD_HP);
		expect(tutorialHeldDamage(s, a, 0.5)).toBe(0.5);
		expect(tutorialHeldDamage(s, b, b.hp)).toBe(b.hp);
		expect(isTutorialPelletHolding(s)).toBe(false);
		a.hp = TUTORIAL_GUARD_HOLD_HP;
		expect(tutorialHeldDamage(s, a, 1)).toBe(0);
		expect([isTutorialPelletHolding(s), isTutorialGuardHolding(s)]).toEqual([true, false]);
		// Not a scored endless floor: tutorialOnPelletsSwept finds no floor / record and keeps it.
		tutorialOnPelletsSwept(s, 0);
		expect(t.pelletLock).toBe(PELLET_LOCK_ARMED);
		t.pelletLock = PELLET_LOCK_RELEASED;
		expect([isTutorialPelletHolding(s), isTutorialPelletReleased(s)]).toEqual([false, true]);
		expect(tutorialHeldDamage(s, a, 1)).toBe(1);
	});

	it("arms only on its floor and room; with no untaken pellet there (no pellets in the run) or no spawn it releases", () => {
		const s = twoChasers(LOCK);
		const [a] = chasers(s);
		tutorialOnRoomSpawned(s, 2, 7, [a]); // wrong floor
		tutorialOnRoomSpawned(s, 1, 4, [a]); // wrong room
		expect(s.tutorial!.pelletLock).toBe(PELLET_LOCK_WAITING);
		expect(tutorialHeldDamage(s, a, a.hp)).toBe(a.hp);
		tutorialOnRoomSpawned(s, 1, 7, [a]); // no state.pellets: nothing to sweep
		expect([s.tutorial!.pelletLock, isTutorialPelletReleased(s)]).toEqual([PELLET_LOCK_RELEASED, true]);
		expect(tutorialHeldDamage(s, a, a.hp)).toBe(a.hp);
		const e = twoChasers(LOCK);
		tutorialOnRoomSpawned(e, 1, 7, []);
		expect(e.tutorial!.pelletLock).toBe(PELLET_LOCK_RELEASED);
	});

	it("the guard lock is unchanged beside it: each arms on its own room and holds its own spawns", () => {
		const s = twoChasers(BOTH);
		const [a, b] = chasers(s);
		tutorialOnRoomSpawned(s, 1, 4, [a]);
		expect([s.tutorial!.guardLock, s.tutorial!.pelletLock]).toEqual([GUARD_LOCK_ARMED, PELLET_LOCK_WAITING]);
		expect(tutorialHeldDamage(s, a, a.hp)).toBe(a.hp - TUTORIAL_GUARD_HOLD_HP);
		expect(tutorialHeldDamage(s, b, b.hp)).toBe(b.hp);
		tutorialOnGuardCancels(s, 1);
		expect([s.tutorial!.guardLock, s.tutorial!.pelletLock]).toEqual([GUARD_LOCK_RELEASED, PELLET_LOCK_WAITING]);
		expect(tutorialHeldDamage(s, a, a.hp)).toBe(a.hp);
	});

	it("without a lock (or outside the tutorial) nothing is ever held", () => {
		for (const s of [twoChasers({ harmless: true }), twoChasers(undefined)]) {
			const [a] = chasers(s);
			tutorialOnRoomSpawned(s, 1, 7, [a]);
			tutorialOnPelletsSwept(s, 0);
			expect(tutorialHeldDamage(s, a, a.hp)).toBe(a.hp);
			expect([isTutorialPelletHolding(s), isTutorialPelletReleased(s)]).toEqual([false, false]);
		}
	});
});

describe("replay", () => {
	it("a recorded tutorial run (contact hits, debug hits, the flask, rolls) replays to the same hash", () => {
		const config: SimConfig = {
			encounter: enc([{ kind: TEST_CHASER.id, x: 2, z: 2 }]),
			scoring: {},
			tutorial: { harmless: true, startHalfHearts: TUTORIAL_START_HALF_HEARTS },
		};
		const s = createSimState(11, 0, 0, config);
		const rec = new Recorder(11, 0, 0);
		const hashes: string[] = [];
		for (let t = 0; t < 900; t++) {
			let buttons = 0;
			if (t % 97 === 0) buttons = Button.DEBUG_HIT;
			else if (t % 151 === 0) buttons = Button.ROLL;
			else if (t === 300) buttons = Button.FLASK;
			const f = frame(t % 200 < 100 ? 0.5 : -0.5, 0, buttons, 1, 0);
			step(s, f, config);
			rec.record(f);
			hashes.push(hashState(s));
		}
		expect(s.tutorial!.harmlessHits).toBeGreaterThan(3);
		expect(s.score!.hitsTaken).toBe(s.tutorial!.harmlessHits);
		expect([s.player.hearts, s.player.dead]).toEqual([START_HALF_HEARTS, 0]); // the flask at 300 healed 4 -> 6
		const recording = rec.getRecording();
		const replayed = runReplay(recording, config);
		expect(hashState(replayed)).toBe(hashState(s));
		expect(replayed.tutorial).toEqual(s.tutorial);
		for (const t of [0, 97, 300, 450, 899]) expect(hashState(runReplay(recording, config, t + 1))).toBe(hashes[t]);
		// The same inputs without the tutorial hash differently (the player gets hurt, the group is gone).
		const plain: SimConfig = { encounter: config.encounter, scoring: {} };
		expect(hashState(runReplay(recording, plain))).never.toBe(hashState(replayed));
	});
});
