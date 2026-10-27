// The tutorial's Training Dummy ('dummy', docs/TUTORIAL.md T3): registry index (after the whole web table, which keeps
// its indices), inert (never moves, turns, telegraphs, fires or hurts the player, even standing on it), dies to the
// sword's full combo like any enemy (kill event, corpse, score), and is in no random encounter pool.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ENCOUNTER_COST,
	ENDLESS_ROOM_KINDS,
	KALEB_VALE_MVP_PARAMS,
	encounterCost,
	endlessFloorParams,
	endlessRoomSpawns,
	generateDungeon,
	placeEncounter,
	populateEnemies,
} from "shared/dungeon";
import {
	AiState,
	BOSS_DEMONLORD_ID,
	Button,
	CORPSE_TICKS,
	DEFAULT_KILL_POINTS,
	DEFAULT_SIM_CONFIG,
	DUMMY,
	DUMMY_KIND,
	EMPTY_INPUT,
	KILL_POINTS,
	NO_KIND,
	PLAYER_RADIUS,
	PORT_BAND_TUTORIAL,
	SQRT1_2,
	START_HALF_HEARTS,
	SWORD_DATA,
	ScoreSource,
	SimCtx,
	archetypeAt,
	archetypeIds,
	archetypeIndex,
	createSimState,
	hasArchetype,
	step,
	webArchetypeIds,
	type ActorSpawn,
	type EncounterConfig,
	type InputFrame,
	type SimConfig,
} from "shared/sim";

const enc = (spawns: ActorSpawn[]): EncounterConfig => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });
const dummyAt = (x: number, z: number): ActorSpawn => ({ kind: DUMMY_KIND, x, z });

/** The web build's index table (fixtures' archetypeIds): unchanged by the dummy. */
const WEB_TABLE = ["boss.act1", "bruiser", "sniper", "swarmer", "turret.caster", "turret.sniper", "turret.sprayer"];

describe("dummy: registry", () => {
	it("is registered as 'dummy' in band PORT_BAND_TUTORIAL, after the web table, whose indices stay 0..6", () => {
		expect(DUMMY_KIND).toBe("dummy");
		expect(hasArchetype(DUMMY_KIND)).toBe(true);
		expect(DUMMY.band).toBe(PORT_BAND_TUTORIAL);
		expect([...webArchetypeIds()]).toEqual(WEB_TABLE);
		// The Demon Lord (band PORT_BAND_BOSSES) numbers after the dummy.
		expect([...archetypeIds()]).toEqual([...WEB_TABLE, DUMMY_KIND, BOSS_DEMONLORD_ID]);
		for (let i = 0; i < WEB_TABLE.size(); i++)
			expect([WEB_TABLE[i], archetypeIndex(WEB_TABLE[i])]).toEqual([WEB_TABLE[i], i]);
		expect(archetypeIndex(DUMMY_KIND)).toBe(WEB_TABLE.size());
		expect(archetypeAt(archetypeIndex(DUMMY_KIND))).toBe(DUMMY);
	});

	it("has the tutorial's data: 8 hp, still, harmless, drawn as enemy.dummy", () => {
		const d = DUMMY.data;
		expect([d.hp, d.speed, d.contactDamage, d.spriteId]).toEqual([8, 0, 0, "enemy.dummy"]);
		expect(d.boss).toBe(undefined);
		expect(d.corpseTicks).toBe(undefined); // the default corpse fade
		expect((DUMMY as { stepDead?: unknown }).stepDead).toBe(undefined); // it stays dead (no revive)
	});

	it("spawns from an encounter by kind with full hp", () => {
		const config: SimConfig = { encounter: enc([dummyAt(2, 3)]) };
		const s = createSimState(1, 0, 0, config);
		const a = s.combat.actors[0];
		expect([a.kind, a.x, a.z, a.hp, a.hpMax, a.radius, a.alive]).toEqual([
			archetypeIndex(DUMMY_KIND),
			2,
			3,
			DUMMY.data.hp,
			DUMMY.data.hp,
			DUMMY.data.radius,
			1,
		]);
	});
});

describe("dummy: inert", () => {
	const TICKS = 600;

	it(`never moves, turns, winds up, fires or hurts the player standing on it (${TICKS} ticks)`, () => {
		// Closer than radius + PLAYER_RADIUS: a body with contact damage would hit every tick it could.
		const z = (DUMMY.data.radius + PLAYER_RADIUS) / 2;
		const config: SimConfig = { encounter: enc([dummyAt(0, z)]) };
		const s = createSimState(1, 0, 0, config);
		const a = s.combat.actors[0];
		let telegraphs = 0;
		let hits = 0;
		let bullets = 0;
		for (let t = 0; t < TICKS; t++) {
			step(s, EMPTY_INPUT, config);
			telegraphs += s.events.telegraphs;
			hits += s.events.playerHits;
			bullets = math.max(bullets, s.combat.enemyBullets.activeCount);
			expect([t, a.x, a.z, a.prevX, a.prevZ, a.faceX, a.faceZ]).toEqual([t, 0, z, 0, z, SQRT1_2, SQRT1_2]);
			expect([t, a.aiState, a.aiTicks, a.attack, a.cooldown]).toEqual([t, AiState.IDLE, 0, 0, 0]);
		}
		expect([telegraphs, hits, bullets]).toEqual([0, 0, 0]);
		expect(s.player.hearts).toBe(START_HALF_HEARTS);
		expect(s.combat.playerSpawned).toBe(0);
		expect([a.alive, a.hp]).toEqual([1, DUMMY.data.hp]);
		expect(a.v).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
	});

	it("stays inert after being hit (no aggro to wake)", () => {
		const config: SimConfig = { encounter: enc([dummyAt(0, 1)]) };
		const s = createSimState(1, 0, 0, config);
		const a = s.combat.actors[0];
		new SimCtx().bind(s, config, EMPTY_INPUT).damageActor(a, 1);
		for (let t = 0; t < TICKS; t++) step(s, EMPTY_INPUT, config);
		expect([a.x, a.z, a.aiState, a.alive, a.hp]).toEqual([0, 1, AiState.IDLE, 1, DUMMY.data.hp - 1]);
		expect([s.player.hearts, s.combat.enemyBullets.activeCount]).toEqual([START_HALF_HEARTS, 0]);
	});
});

describe("dummy: dies to the sword like any enemy", () => {
	const aimed: InputFrame = { ...EMPTY_INPUT, aimZ: 1000, buttons: Button.FIRE };
	const D = SWORD_DATA;
	/** Swing ticks with FIRE held from tick 0 (weapons.spec COMBO): swing 1, swing 2, the finisher. */
	const FINISHER_TICK = 2 * D.swingRecoveryTicks + D.finisherWindupTicks;
	const config: SimConfig = { loadout: ["weapon.sword", "weapon.bow"], encounter: enc([dummyAt(0, 1.6)]) };

	it("swings 1 and 2 leave 2 hp; the finisher kills it (3 + 3 + 6 = 12 >= 8), then its corpse fades", () => {
		expect([D.damage, D.finisherDamage]).toEqual([3, 6]);
		const s = createSimState(1, 0, 0, config);
		const a = s.combat.actors[0];
		const hp: number[] = [];
		let killTick = -1;
		let kills = 0;
		for (let t = 0; t <= FINISHER_TICK; t++) {
			step(s, aimed, config);
			if (s.events.meleeSwings !== 0) hp.push(a.hp);
			kills += s.events.enemiesKilled;
			if (killTick < 0 && s.events.enemiesKilled !== 0) killTick = t;
		}
		expect(hp).toEqual([DUMMY.data.hp - D.damage, DUMMY.data.hp - 2 * D.damage, 0]);
		expect([killTick, kills, a.alive]).toEqual([FINISHER_TICK, 1, 0]);
		expect(s.player.hearts).toBe(START_HALF_HEARTS);
		// The corpse keeps its slot for CORPSE_TICKS, then the slot is freed.
		for (let t = 1; t < CORPSE_TICKS; t++) step(s, EMPTY_INPUT, config);
		expect([a.kind, a.deadTicks]).toEqual([archetypeIndex(DUMMY_KIND), CORPSE_TICKS - 1]);
		step(s, EMPTY_INPUT, config);
		expect(a.kind).toBe(NO_KIND);
	});

	it("scores as a kill (the default kill points: no table entry)", () => {
		const scored: SimConfig = { ...DEFAULT_SIM_CONFIG, ...config, scoring: {} };
		const s = createSimState(1, 0, 0, scored);
		for (let t = 0; t <= FINISHER_TICK; t++) step(s, aimed, scored);
		const st = s.score!;
		expect(KILL_POINTS.has(DUMMY_KIND)).toBe(false);
		expect([st.counts[ScoreSource.KILLS], st.points[ScoreSource.KILLS]]).toEqual([1, DEFAULT_KILL_POINTS]);
	});
});

describe("dummy: in no random encounter pool", () => {
	it("is not an endless room kind and has no encounter cost entry", () => {
		for (const k of ENDLESS_ROOM_KINDS) expect(k.kind).never.toBe(DUMMY_KIND);
		expect(ENCOUNTER_COST.has(DUMMY_KIND)).toBe(false);
		expect(encounterCost(DUMMY_KIND)).toBeGreaterThan(0); // room par time: the default cost
	});

	for (const seed of [1337, 42, 7]) {
		it(`placeEncounter / endless floors never place it (seed ${seed})`, () => {
			const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed });
			for (const sp of placeEncounter(d, { populate: populateEnemies }).spawns)
				expect(sp.kind).never.toBe(DUMMY_KIND);
			for (let floor = 1; floor <= 4; floor++) {
				const fd = generateDungeon(endlessFloorParams(seed, floor));
				for (const room of endlessRoomSpawns(fd, floor)) {
					for (const sp of room) expect(sp.kind).never.toBe(DUMMY_KIND);
				}
			}
		});
	}
});
