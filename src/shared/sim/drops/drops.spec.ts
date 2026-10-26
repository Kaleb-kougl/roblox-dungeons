// Boost drops in the sim (docs/BOOSTS.md B1 / B2): the opt-in state and its "drops" hash group (appended last, dump
// names, clone, party size), the drop stream (its own: state.rngState and boon offers untouched), the draws per case,
// eligibility (turrets, the training dummy, bosses, the boss room and any kill during a boss fight never roll), pity at
// exactly pityKills, the ground cap, the kind weights, stepDrops (pickups by slot then player index, on the landing
// tick, never by the dead; expiry at groundTicks; refresh; timers; a draft freezes everything; floor change; death /
// forfeit / leave clears), DEBUG_DROP_BUTTON, the tutorial's guarantee, co-op picker only, and a replay. Measured in an
// open endless ARENA (a hand-made EndlessFloorWorld like progression.spec.ts's: the greybox bounds, a combat room and a
// boss room).
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import {
	ALL_BUTTONS,
	AEGIS_PIPS,
	BOOSTS,
	BOOST_COUNT,
	BOOST_TOTAL_WEIGHT,
	BOSS_ACT1_ID,
	BOSS_DEMONLORD_ID,
	BREAKABLES_CONFIG,
	BossFightState,
	BREAKABLES_SUBSYSTEM,
	Boost,
	Button,
	DEBUG_DROP_AHEAD,
	DEBUG_DROP_BUTTON,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_BOUNDS,
	DRAFT_MIN_OPEN_TICKS,
	DROPS,
	DROPS_CONFIG,
	DROPS_SUBSYSTEM,
	DROP_GROUND_HASH_FIELDS,
	DROP_GROUND_TICKS,
	DROP_INELIGIBLE_ARCHETYPES,
	DROP_ROLL_RANGE,
	DUMMY_KIND,
	EMPTY_INPUT,
	FORFEIT_BUTTON,
	NO_BOOST,
	PARTY_LEFT_BUTTON,
	PORT_BUTTONS,
	RECORDED_BUTTONS,
	Recorder,
	SIM_BUTTONS,
	SimCtx,
	activeBoosts,
	aegisPips,
	archetypeIndex,
	boostTicks,
	boostTicksLeft,
	cloneSimState,
	createSimState,
	decodeRecording,
	dropChancePercent,
	dropGroundTicks,
	dropsEvents,
	dropsGround,
	dropsSeedState,
	encodeRecording,
	guaranteedDropsConfig,
	hashLayout,
	hashState,
	pickBoostKind,
	playerAt,
	rngInt,
	rngNext,
	runReplay,
	seedToState,
	step,
	stepParty,
	type ActorSpawn,
	type ActorState,
	type DropsConfig,
	type EncounterRoom,
	type EncounterRoomType,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const SEED = 42;
const TEST_DUMMY = "test.dummy";

// ---------------------------------------------------------------------------------------------
// The arena: an open greybox square; combat room 0 around (0, 6) whose three training dummies spawn on first entry,
// boss room 1 around (-5, -5). Floors end by the debug skip only.

function room(id: number, kind: EncounterRoomType, cx: number, cz: number, h: number): EncounterRoom {
	return { id, type: kind, depth: 1, cx, cz, minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h, floorTiles: 9 };
}

const ROOMS: EncounterRoom[] = [room(0, "combat", 0, 6, 1), room(1, "boss", -5, -5, 1.5)];
const ROOM_SPAWNS: ActorSpawn[][] = [
	[
		{ kind: DUMMY_KIND, x: -0.5, z: 6 },
		{ kind: DUMMY_KIND, x: 0, z: 6.5 },
		{ kind: DUMMY_KIND, x: 0.5, z: 6 },
	],
	[],
];
const BOSS_ROOM = ROOMS[1];

const arenaWorlds = new Map<number, EndlessFloorWorld>();
function arenaWorld(floor: number): EndlessFloorWorld {
	let w = arenaWorlds.get(floor);
	if (w === undefined) {
		w = {
			floor,
			config: {
				bounds: DEFAULT_BOUNDS,
				loadout: ["weapon.sword", "weapon.bow"],
				encounter: { spawns: [], rooms: ROOMS, entranceRoom: -1, bossRoom: BOSS_ROOM.id },
			},
			bossFloor: false,
			spawnX: 0,
			spawnZ: 0,
			stairX: 1000,
			stairZ: 1000,
			roomSpawns: ROOM_SPAWNS,
			roomIdAt: (x, z) => {
				for (const r of ROOMS) if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.id;
				return -1;
			},
		};
		arenaWorlds.set(floor, w);
	}
	return w;
}

/**
 * The same arena as a boss floor: `bossKind` (Mother Bramble unless given) spawns in the boss room (never stepped by
 * killAt).
 */
const bossArenaWorlds = new Map<string, EndlessFloorWorld>();
function bossArenaWorld(floor: number, bossKind: string = BOSS_ACT1_ID): EndlessFloorWorld {
	const key = `${bossKind}@${floor}`;
	let w = bossArenaWorlds.get(key);
	if (w === undefined) {
		const base = arenaWorld(floor);
		w = {
			...base,
			config: {
				...base.config,
				encounter: {
					...base.config.encounter!,
					spawns: [{ kind: bossKind, x: BOSS_ROOM.cx, z: BOSS_ROOM.cz }],
				},
			},
			bossFloor: true,
		};
		bossArenaWorlds.set(key, w);
	}
	return w;
}

function bossArena(drops: DropsConfig, bossKind: string = BOSS_ACT1_ID): SimConfig {
	return { endless: { runSeed: SEED, worldForFloor: (floor) => bossArenaWorld(floor, bossKind) }, drops };
}

function arena(drops: DropsConfig | undefined, extra: Partial<SimConfig> = {}): SimConfig {
	return { endless: { runSeed: SEED, worldForFloor: arenaWorld }, drops, ...extra };
}

const NO_TABLE: ReadonlyMap<string, number> = new Map<string, number>();
/** Every eligible kill drops (no archetype table, no pity). */
const ALWAYS: DropsConfig = { ...DROPS_CONFIG, chancePercent: 100, chanceByArchetype: NO_TABLE, pityKills: 0 };
/** No random drop, no pity (only debug drops / hand-placed ones). */
const NEVER: DropsConfig = { ...DROPS_CONFIG, chancePercent: 0, chanceByArchetype: NO_TABLE, pityKills: 0 };

function fresh(config: SimConfig, seed = SEED): SimState {
	return createSimState(seed, 0, 0, config);
}

function frame(buttons = 0, mx = 0, mz = 0): InputFrame {
	return { ...EMPTY_INPUT, moveX: mx, moveZ: mz, buttons };
}
const IDLE = EMPTY_INPUT;

function ctxOf(s: SimState, config: SimConfig): SimCtx {
	return new SimCtx().bind(s, config.endless!.worldForFloor(s.endless!.floor).config, EMPTY_INPUT);
}

/** Spawns `kind` at (x, z) and kills it at once (between ticks: a drop lands with spawnTick = s.tick); frees it. */
function killAt(s: SimState, config: SimConfig, kind: string, x: number, z: number): ActorState {
	const ctx = ctxOf(s, config);
	const a = ctx.spawnActor(kind, x, z)!;
	ctx.killActor(a);
	ctx.freeActor(a);
	return a;
}

/** Writes a drop of `kind` straight into ground slot `slot` (as if it landed this tick). */
function place(s: SimState, slot: number, kind: number, x: number, z: number): void {
	const g = s.drops!.ground[slot];
	g.kind = kind;
	g.x = x;
	g.z = z;
	g.spawnTick = s.tick;
	g.ticksLeft = s.drops!.config.groundTicks;
}

/** mulberry32 draws from word `before` to word `after` (-1: not within 8). */
function draws(before: number, after: number): number {
	const h = { rngState: before };
	for (let n = 0; n <= 8; n++) {
		if (h.rngState === after) return n;
		rngNext(h);
	}
	return -1;
}

function occupied(s: SimState): number {
	let n = 0;
	for (const g of s.drops!.ground) if (g.kind !== NO_BOOST) n++;
	return n;
}

const run = (s: SimState) => s.run!.players[0];

// ---------------------------------------------------------------------------------------------

describe("drops: opt-in state and hash", () => {
	it("absent without SimConfig.drops: no state, no group, every read neutral", () => {
		const s = fresh(arena(undefined));
		expect(s.drops).toBe(undefined);
		expect(
			hashLayout(s)
				.groups.map((g) => g.name)
				.includes(DROPS_SUBSYSTEM),
		).toBe(false);
		expect(dropsGround(s).size()).toBe(0);
		expect(dropsEvents(s)).toBe(undefined);
		expect(activeBoosts(s, 0)).toEqual([]);
		expect([boostTicksLeft(s, 0, Boost.FURY), aegisPips(s, 0), dropGroundTicks(s)]).toEqual([
			0,
			0,
			DROP_GROUND_TICKS,
		]);
		// A kill and a debug press do nothing extra.
		killAt(s, arena(undefined), TEST_DUMMY, 2, 2);
		step(s, frame(DEBUG_DROP_BUTTON), arena(undefined));
		expect(s.drops).toBe(undefined);
	});

	it("present: own stream seed, free slots, one entry per player; the group last (after breakables) with names", () => {
		const config = arena(ALWAYS, { breakables: BREAKABLES_CONFIG });
		const s = fresh(config);
		const d = s.drops!;
		expect(d.rngState).toBe(bit32.bxor(seedToState(SEED), DROPS.salt));
		expect(d.rngState).toBe(dropsSeedState(SEED));
		expect(d.rngState === s.rngState).toBe(false);
		expect([d.killsSinceDrop, d.debugNextKind, d.guards.size(), d.players.size()]).toEqual([0, Boost.FURY, 0, 1]);
		expect(d.ground.size()).toBe(DROPS.maxOnGround);
		for (const g of d.ground) expect(g).toEqual({ kind: NO_BOOST, x: 0, z: 0, spawnTick: 0, ticksLeft: 0 });
		expect(d.players[0]).toEqual({ ticks: [0, 0, 0, 0], aegisPips: 0 });
		const layout = hashLayout(s, true);
		const groups = layout.groups;
		expect(groups[groups.size() - 2].name).toBe(BREAKABLES_SUBSYSTEM);
		const last = groups[groups.size() - 1];
		expect(last.name).toBe(DROPS_SUBSYSTEM);
		const ground = DROPS.maxOnGround * DROP_GROUND_HASH_FIELDS.size();
		expect(last.finish - last.start).toBe(3 + 1 + ground + 1 + 1 + 1 + BOOST_COUNT + 1);
		expect(layout.names.size()).toBe(layout.values.size());
		expect(layout.names[last.start]).toBe("drops.rngState");
		expect(layout.names[last.start + 4]).toBe("drops.ground[0].kind");
		expect(layout.names[last.finish - 1]).toBe("drops.players[0].aegisPips");
		expect(layout.values[last.start]).toBe(d.rngState);
	});

	it("the group's guards and every field follow the state; clone is equal and independent", () => {
		const config = arena(guaranteedDropsConfig([{ floor: 1, room: 0, kind: Boost.AEGIS }]));
		const s = fresh(config);
		s.player.z = 6;
		step(s, IDLE, config); // enters room 0: its dummies spawn and become a guard
		expect(s.drops!.guards.size()).toBe(1);
		place(s, 2, Boost.FRENZY, 3, -3);
		s.drops!.players[0].ticks[Boost.QUICKSTEP] = 77;
		const layout = hashLayout(s, true);
		const g = layout.groups[layout.groups.size() - 1];
		const names: string[] = [];
		for (let i = g.start; i < g.finish; i++) names.push(layout.names[i]);
		expect(names.includes("drops.guards[0].ids[2]")).toBe(true);
		expect(layout.values[names.indexOf("drops.ground[2].kind") + g.start]).toBe(Boost.FRENZY);
		expect(layout.values[names.indexOf("drops.players[0].ticks[1]") + g.start]).toBe(77);
		const c = cloneSimState(s);
		expect(hashState(c)).toBe(hashState(s));
		c.drops!.ground[2].kind = NO_BOOST;
		c.drops!.guards[0].ids.clear();
		c.drops!.players[0].ticks[Boost.QUICKSTEP] = 0;
		expect(s.drops!.ground[2].kind).toBe(Boost.FRENZY);
		expect(s.drops!.guards[0].ids.size()).toBe(3);
		expect(s.drops!.players[0].ticks[Boost.QUICKSTEP]).toBe(77);
		expect(hashState(c) === hashState(s)).toBe(false);
	});

	it("co-op: one boost entry per player", () => {
		const s = fresh(arena(ALWAYS, { party: { size: 3 } }));
		expect(s.drops!.players.size()).toBe(3);
	});

	it("tunables: the plan's defaults, the dummy ineligible, weights summed", () => {
		expect([DROPS.chancePercent, DROPS.pityKills, DROPS.groundSeconds, DROPS.maxOnGround]).toEqual([6, 20, 10, 4]);
		expect(dropChancePercent(DROPS_CONFIG, "swarmer")).toBe(3);
		expect(dropChancePercent(DROPS_CONFIG, "sniper")).toBe(8);
		expect(dropChancePercent(DROPS_CONFIG, "bruiser")).toBe(10);
		expect(dropChancePercent(DROPS_CONFIG, TEST_DUMMY)).toBe(6);
		expect(DROP_INELIGIBLE_ARCHETYPES.includes(DUMMY_KIND)).toBe(true);
		expect(BOOST_TOTAL_WEIGHT).toBe(11);
		expect(BOOSTS.map((b) => b.id)).toEqual(["boost.fury", "boost.quickstep", "boost.frenzy", "boost.aegis"]);
		expect([boostTicks(Boost.FURY), boostTicks(Boost.AEGIS), DROP_GROUND_TICKS]).toEqual([600, 900, 600]);
		const t = guaranteedDropsConfig([{ floor: 1, room: 2, kind: Boost.FURY }]);
		expect([t.chancePercent, t.pityKills, t.chanceByArchetype.size(), t.groundTicks]).toEqual([0, 0, 0, 600]);
	});
});

describe("drops: the stream and the draws", () => {
	it("never touches state.rngState: the same kills with and without drops leave it and the boon offers identical", () => {
		const off = arena(undefined);
		const on = arena(ALWAYS);
		const a = fresh(off);
		const b = fresh(on);
		for (let i = 0; i < 12; i++) {
			killAt(a, off, TEST_DUMMY, -3 + i * 0.5, 3);
			killAt(b, on, TEST_DUMMY, -3 + i * 0.5, 3);
		}
		expect(occupied(b)).toBe(DROPS.maxOnGround);
		expect(b.drops!.rngState === dropsSeedState(SEED)).toBe(false);
		expect(b.rngState).toBe(a.rngState);
		step(a, frame(DEBUG_FLOOR_BUTTON), off);
		step(b, frame(DEBUG_FLOOR_BUTTON), on);
		expect(run(a).draftOpen).toBe(1);
		expect(run(b).draftOffers).toEqual(run(a).draftOffers);
		expect(b.rngState).toBe(a.rngState);
	});

	it("draws per case: hit 2, miss 1, percent 0 none, pity 1, full none", () => {
		// A seed whose first roll is at least 1: that roll as the percent misses (roll >= percent).
		let seed = 1;
		let first = rngInt({ rngState: dropsSeedState(seed) }, 0, DROP_ROLL_RANGE - 1);
		while (first < 1) {
			seed++;
			first = rngInt({ rngState: dropsSeedState(seed) }, 0, DROP_ROLL_RANGE - 1);
		}
		const miss = arena({ ...NEVER, chancePercent: first });
		const m = fresh(miss, seed);
		killAt(m, miss, TEST_DUMMY, 2, 2);
		expect([draws(dropsSeedState(seed), m.drops!.rngState), occupied(m), m.drops!.killsSinceDrop]).toEqual([
			1, 0, 1,
		]);

		const hit = arena(ALWAYS);
		const h = fresh(hit);
		killAt(h, hit, TEST_DUMMY, 2, 2);
		expect([draws(dropsSeedState(SEED), h.drops!.rngState), occupied(h), h.drops!.killsSinceDrop]).toEqual([
			2, 1, 0,
		]);

		const zero = arena({ ...ALWAYS, chanceByArchetype: new Map([[TEST_DUMMY, 0]]) });
		const z = fresh(zero);
		killAt(z, zero, TEST_DUMMY, 2, 2);
		expect([z.drops!.rngState, occupied(z), z.drops!.killsSinceDrop]).toEqual([dropsSeedState(SEED), 0, 1]);

		const pity = arena({ ...NEVER, pityKills: 1 });
		const p = fresh(pity);
		killAt(p, pity, TEST_DUMMY, 2, 2); // dry, no draw
		expect(p.drops!.rngState).toBe(dropsSeedState(SEED));
		killAt(p, pity, TEST_DUMMY, 2, 2); // pity: the kind only
		expect([draws(dropsSeedState(SEED), p.drops!.rngState), occupied(p), p.drops!.killsSinceDrop]).toEqual([
			1, 1, 0,
		]);

		const full = arena({ ...ALWAYS, maxOnGround: 1 });
		const f = fresh(full);
		killAt(f, full, TEST_DUMMY, 2, 2);
		const before = f.drops!.rngState;
		killAt(f, full, TEST_DUMMY, 2, 2);
		expect([f.drops!.rngState, occupied(f), f.drops!.killsSinceDrop]).toEqual([before, 1, 1]);
	});

	it("the kind: one weighted draw, 3 : 3 : 3 : 2 in Boost order (a hand twin, then frequencies)", () => {
		const s = fresh(arena(ALWAYS));
		const d = s.drops!;
		for (let i = 0; i < 200; i++) {
			const twin = { rngState: d.rngState };
			const roll = rngInt(twin, 0, BOOST_TOTAL_WEIGHT - 1);
			const expected = roll < 3 ? Boost.FURY : roll < 6 ? Boost.QUICKSTEP : roll < 9 ? Boost.FRENZY : Boost.AEGIS;
			expect(pickBoostKind(d)).toBe(expected);
			expect(d.rngState).toBe(twin.rngState);
		}
		const counts = [0, 0, 0, 0];
		const n = 22000;
		for (let i = 0; i < n; i++) counts[pickBoostKind(d)]++;
		for (let k = 0; k < BOOST_COUNT; k++) {
			const want = (n * BOOSTS[k].weight) / BOOST_TOTAL_WEIGHT;
			expect(math.abs(counts[k] - want) < want * 0.05).toBe(true);
		}
	});

	it("a drop lands where the actor died, in the lowest free slot, with its ground life; events.dropped", () => {
		const config = arena(ALWAYS);
		const s = fresh(config);
		killAt(s, config, TEST_DUMMY, 2.25, -1.5);
		const g = s.drops!.ground[0];
		expect([g.x, g.z, g.spawnTick, g.ticksLeft]).toEqual([2.25, -1.5, s.tick, DROP_GROUND_TICKS]);
		expect(g.kind >= 0 && g.kind < BOOST_COUNT).toBe(true);
		expect(s.drops!.events.dropped).toEqual([0]);
		killAt(s, config, TEST_DUMMY, 3, 3);
		expect(s.drops!.events.dropped).toEqual([0, 1]);
	});
});

describe("drops: eligibility, pity, the cap", () => {
	it("turrets (reviving), the training dummy, a boss and anything in a boss floor's boss room never roll nor count", () => {
		const config = bossArena({ ...ALWAYS, pityKills: 1 });
		const s = fresh(config);
		const d = s.drops!;
		killAt(s, config, "turret.sniper", 2, 2);
		killAt(s, config, DUMMY_KIND, 2, 2);
		killAt(s, config, BOSS_ACT1_ID, 3, -3);
		// Summons spawn inside the boss room and die there: the room rule covers them (and any other actor in it).
		killAt(s, config, "swarmer", BOSS_ROOM.cx + 0.5, BOSS_ROOM.cz);
		killAt(s, config, TEST_DUMMY, BOSS_ROOM.minX, BOSS_ROOM.maxZ);
		expect([d.rngState, d.killsSinceDrop, occupied(s)]).toEqual([dropsSeedState(SEED), 0, 0]);
		killAt(s, config, TEST_DUMMY, BOSS_ROOM.maxX + 0.5, BOSS_ROOM.cz); // just outside: rolls
		expect(occupied(s)).toBe(1);
	});

	it("while the boss fight is on no kill rolls, even outside the boss room (an add pushed out through a doorway)", () => {
		// The Demon Lord summons wherever his hunt took him (DEMONLORD_SUMMON.arenaMargin): an add can land outside the
		// boss room's bounds. Every player is sealed in the arena while the fight is on, so no kill then rolls.
		for (const bossKind of [BOSS_ACT1_ID, BOSS_DEMONLORD_ID]) {
			const config = bossArena({ ...ALWAYS, pityKills: 1 }, bossKind);
			const s = fresh(config);
			const d = s.drops!;
			const boss = s.combat.actors.find((a) => a.kind === archetypeIndex(bossKind) && a.alive !== 0)!;
			expect([bossKind, boss !== undefined]).toEqual([bossKind, true]);
			boss.aiState = BossFightState.ACTIVE;
			killAt(s, config, "swarmer", BOSS_ROOM.maxX + 0.5, BOSS_ROOM.cz);
			killAt(s, config, TEST_DUMMY, 4, 4);
			expect([bossKind, d.rngState, d.killsSinceDrop, occupied(s)]).toEqual([
				bossKind,
				dropsSeedState(SEED),
				0,
				0,
			]);
			// Dormant (not engaged yet): kills outside the boss room roll again.
			boss.aiState = BossFightState.DORMANT;
			killAt(s, config, "swarmer", BOSS_ROOM.maxX + 0.5, BOSS_ROOM.cz);
			expect([bossKind, occupied(s)]).toEqual([bossKind, 1]);
			// Engaged but dead (the fight is over): they roll too.
			boss.aiState = BossFightState.ACTIVE;
			boss.alive = 0;
			killAt(s, config, "swarmer", BOSS_ROOM.maxX + 0.5, BOSS_ROOM.cz);
			expect([bossKind, occupied(s)]).toEqual([bossKind, 2]);
		}
	});

	it("on a floor without a boss the boss-type room is just the stairwell room: kills there roll", () => {
		const config = arena(ALWAYS);
		const s = fresh(config);
		killAt(s, config, TEST_DUMMY, BOSS_ROOM.cx + 0.5, BOSS_ROOM.cz);
		expect(occupied(s)).toBe(1);
	});

	it("pity at exactly pityKills: that many dry kills, then the next eligible kill drops (no roll draw)", () => {
		const config = arena({ ...NEVER, pityKills: 3 });
		const s = fresh(config);
		const d = s.drops!;
		for (let i = 1; i <= 3; i++) {
			killAt(s, config, TEST_DUMMY, 2, 2);
			expect([d.killsSinceDrop, occupied(s)]).toEqual([i, 0]);
		}
		expect(d.rngState).toBe(dropsSeedState(SEED));
		killAt(s, config, TEST_DUMMY, 2, 2);
		expect([d.killsSinceDrop, occupied(s), draws(dropsSeedState(SEED), d.rngState)]).toEqual([0, 1, 1]);
		killAt(s, config, TEST_DUMMY, 2, 2);
		expect([d.killsSinceDrop, occupied(s)]).toEqual([1, 1]);
	});

	it("the cap: a full ground skips without drawing (pity still counts); a freed slot is reused lowest first", () => {
		const config = arena({ ...ALWAYS, maxOnGround: 2 });
		const s = fresh(config);
		const d = s.drops!;
		killAt(s, config, TEST_DUMMY, 2, 2);
		killAt(s, config, TEST_DUMMY, 3, 2);
		const word = d.rngState;
		killAt(s, config, TEST_DUMMY, 4, 2);
		expect([d.rngState, d.killsSinceDrop, occupied(s)]).toEqual([word, 1, 2]);
		// The player takes slot 0's drop; the next kill lands in slot 0.
		s.player.x = 2;
		s.player.z = 2;
		step(s, IDLE, config);
		expect(d.ground[0].kind).toBe(NO_BOOST);
		killAt(s, config, TEST_DUMMY, -2, -2);
		expect([d.ground[0].x, d.ground[0].z, d.killsSinceDrop]).toEqual([-2, -2, 0]);
	});
});

describe("drops: stepDrops", () => {
	it("a kill's drop is taken on the tick it lands (a real sword kill at the player's feet)", () => {
		const config = arena(ALWAYS);
		const s = fresh(config);
		const a = ctxOf(s, config).spawnActor(TEST_DUMMY, 0, 0.4)!;
		a.hp = 1;
		const fire = { ...EMPTY_INPUT, aimZ: 1000, buttons: Button.FIRE };
		let t = 0;
		while (s.events.actorsKilled === 0 && t < 10) {
			step(s, fire, config);
			t++;
		}
		expect(s.events.actorsKilled).toBe(1);
		const ev = s.drops!.events;
		expect(ev.dropped).toEqual([0]);
		expect(ev.collected.size()).toBe(1);
		const c = ev.collected[0];
		expect([c.player, c.slot, c.x, c.z]).toEqual([0, 0, 0, 0.4]);
		expect(s.drops!.ground[0].kind).toBe(NO_BOOST);
		expect(boostTicksLeft(s, 0, c.kind)).toBe(boostTicks(c.kind));
		expect(activeBoosts(s, 0)).toEqual([
			{ kind: c.kind, ticksLeft: boostTicks(c.kind), totalTicks: boostTicks(c.kind) },
		]);
	});

	it("pickups go by slot, then player index; only the picker is boosted; the dead never pick up", () => {
		const config = arena(NEVER, { party: { size: 2 } });
		const s = fresh(config);
		const p0 = playerAt(s, 0);
		const p1 = playerAt(s, 1);
		p0.x = 0;
		p0.z = 0;
		p1.x = 0;
		p1.z = 1;
		place(s, 0, Boost.QUICKSTEP, 0, 1.5); // only player 1 in reach
		place(s, 1, Boost.FURY, 0, 0.5); // both in reach: player 0
		place(s, 2, Boost.FRENZY, 0, 0.55); // both in reach: player 0 again (slot order, then index)
		stepParty(s, [IDLE, IDLE], config);
		const ev = s.drops!.events;
		expect(ev.collected.map((c) => [c.slot, c.player, c.kind])).toEqual([
			[0, 1, Boost.QUICKSTEP],
			[1, 0, Boost.FURY],
			[2, 0, Boost.FRENZY],
		]);
		expect(s.drops!.players[0].ticks).toEqual([boostTicks(Boost.FURY), 0, boostTicks(Boost.FRENZY), 0]);
		expect(s.drops!.players[1].ticks).toEqual([0, boostTicks(Boost.QUICKSTEP), 0, 0]);
		// Player 0 dead on a drop both reach: player 1 takes it.
		p0.dead = 1;
		place(s, 0, Boost.AEGIS, 0, 0.5);
		stepParty(s, [IDLE, IDLE], config);
		expect(ev.collected.map((c) => [c.slot, c.player])).toEqual([[0, 1]]);
		expect([aegisPips(s, 0), aegisPips(s, 1)]).toEqual([0, AEGIS_PIPS]);
		// Nobody alive in reach: it stays.
		p1.dead = 1;
		place(s, 0, Boost.FURY, 0, 0.5);
		stepParty(s, [IDLE, IDLE], config);
		expect([ev.collected.size(), s.drops!.ground[0].kind]).toEqual([0, Boost.FURY]);
	});

	it("expiry at groundTicks: taken on its last tick, else it fades on the next (events.expired)", () => {
		const config = arena({ ...NEVER, groundTicks: 5 });
		const s = fresh(config);
		const t0 = s.tick;
		place(s, 0, Boost.FURY, 3, 3);
		const left: number[] = [];
		for (let i = 0; i < 5; i++) {
			step(s, IDLE, config);
			left.push(s.drops!.ground[0].ticksLeft);
		}
		expect(left).toEqual([5, 4, 3, 2, 1]);
		expect(s.drops!.ground[0].kind).toBe(Boost.FURY);
		expect(s.tick).toBe(t0 + 5);
		step(s, IDLE, config);
		expect(s.drops!.ground[0].kind).toBe(NO_BOOST);
		expect(s.drops!.events.expired).toEqual([{ slot: 0, kind: Boost.FURY, x: 3, z: 3 }]);
		// The same drop is still taken on its last tick (groundTicks - 1 after landing).
		place(s, 1, Boost.FRENZY, 3, 3);
		for (let i = 0; i < 4; i++) step(s, IDLE, config);
		s.player.x = 3;
		s.player.z = 3;
		step(s, IDLE, config);
		expect(s.drops!.events.collected.map((c) => c.kind)).toEqual([Boost.FRENZY]);
	});

	it("timers: a boost runs exactly its duration (events.ended), a repeat pickup refreshes it, Aegis pips go at 0", () => {
		const config = arena(NEVER);
		const s = fresh(config);
		place(s, 0, Boost.AEGIS, 0, 0);
		step(s, IDLE, config);
		const bp = s.drops!.players[0];
		const full = boostTicks(Boost.AEGIS);
		expect([bp.ticks[Boost.AEGIS], bp.aegisPips]).toEqual([full, AEGIS_PIPS]);
		for (let i = 0; i < 100; i++) step(s, IDLE, config);
		expect(bp.ticks[Boost.AEGIS]).toBe(full - 100);
		place(s, 0, Boost.AEGIS, 0, 0); // refresh: full again, never stacked
		step(s, IDLE, config);
		expect(bp.ticks[Boost.AEGIS]).toBe(full);
		for (let i = 0; i < full - 1; i++) step(s, IDLE, config);
		expect([bp.ticks[Boost.AEGIS], bp.aegisPips, s.drops!.events.ended.size()]).toEqual([1, AEGIS_PIPS, 0]);
		step(s, IDLE, config);
		expect([bp.ticks[Boost.AEGIS], bp.aegisPips]).toEqual([0, 0]);
		expect(s.drops!.events.ended).toEqual([{ player: 0, kind: Boost.AEGIS }]);
		step(s, IDLE, config);
		expect(s.drops!.events.ended.size()).toBe(0);
	});

	it("a floor change frees every ground slot and guard; running boosts keep counting", () => {
		const config = arena(guaranteedDropsConfig([{ floor: 1, room: 0, kind: Boost.FURY }]));
		const s = fresh(config);
		s.player.z = 6;
		step(s, IDLE, config);
		expect(s.drops!.guards.size()).toBe(1);
		s.player.z = 0;
		place(s, 0, Boost.FURY, 3, 3);
		place(s, 3, Boost.AEGIS, -3, 3);
		s.drops!.players[0].ticks[Boost.FRENZY] = 300;
		step(s, frame(DEBUG_FLOOR_BUTTON), config);
		expect(s.events.floorChanged).toBe(2);
		expect(occupied(s)).toBe(0);
		expect(s.drops!.guards.size()).toBe(0);
		expect(s.drops!.events.expired.size()).toBe(0); // silent
		expect(s.drops!.players[0].ticks[Boost.FRENZY]).toBe(299);
	});

	it("a boon draft freezes every timer: boosts and ground life stand still until the draft closes", () => {
		const config = arena(NEVER);
		const s = fresh(config);
		step(s, frame(DEBUG_FLOOR_BUTTON), config);
		expect(run(s).draftOpen).toBe(1);
		const bp = s.drops!.players[0];
		bp.ticks[Boost.FURY] = 300;
		place(s, 0, Boost.QUICKSTEP, 3, 3);
		s.drops!.ground[0].spawnTick = s.tick - 1; // landed before: it would age on an unfrozen tick
		for (let i = 0; i < DRAFT_MIN_OPEN_TICKS + 5; i++) step(s, IDLE, config);
		expect([bp.ticks[Boost.FURY], s.drops!.ground[0].ticksLeft]).toEqual([300, DROP_GROUND_TICKS]);
		step(s, frame(Button.FIRE), config); // confirm: still a frozen tick
		expect(run(s).draftOpen).toBe(0);
		expect(bp.ticks[Boost.FURY]).toBe(300);
		step(s, IDLE, config);
		expect([bp.ticks[Boost.FURY], s.drops!.ground[0].ticksLeft]).toEqual([299, DROP_GROUND_TICKS - 1]);
	});

	it("death ends a player's boosts: a lethal hit, the solo forfeit, a co-op leave (that player only)", () => {
		const config = arena(NEVER);
		const s = fresh(config);
		const bp = s.drops!.players[0];
		bp.ticks[Boost.FURY] = 100;
		bp.ticks[Boost.AEGIS] = 100;
		bp.aegisPips = 0; // spent: the hit below lands on hearts
		s.player.armor = 0;
		s.player.hearts = 1;
		step(s, frame(Button.DEBUG_HIT), config);
		expect(s.player.dead).toBe(1);
		expect([bp.ticks, bp.aegisPips]).toEqual([[0, 0, 0, 0], 0]);

		const f = fresh(config);
		f.drops!.players[0].ticks[Boost.QUICKSTEP] = 100;
		step(f, frame(FORFEIT_BUTTON), config);
		expect([f.player.dead, f.drops!.players[0].ticks[Boost.QUICKSTEP]]).toEqual([1, 0]);

		const party = arena(NEVER, { party: { size: 2 } });
		const c = fresh(party);
		c.drops!.players[0].ticks[Boost.FURY] = 100;
		c.drops!.players[1].ticks[Boost.FURY] = 100;
		c.drops!.players[1].aegisPips = 1;
		stepParty(c, [IDLE, frame(PARTY_LEFT_BUTTON)], party);
		expect(c.drops!.players[0].ticks[Boost.FURY]).toBe(99);
		expect([c.drops!.players[1].ticks[Boost.FURY], c.drops!.players[1].aegisPips]).toEqual([0, 0]);
	});
});

describe("drops: DEBUG_DROP_BUTTON", () => {
	it("a port bit: in PORT_BUTTONS / SIM_BUTTONS / RECORDED_BUTTONS, not the web table, no other bit", () => {
		expect(DEBUG_DROP_BUTTON).toBe(32768);
		expect(bit32.band(ALL_BUTTONS, DEBUG_DROP_BUTTON)).toBe(0);
		expect(bit32.band(PORT_BUTTONS, DEBUG_DROP_BUTTON)).toBe(DEBUG_DROP_BUTTON);
		expect(bit32.band(SIM_BUTTONS, DEBUG_DROP_BUTTON)).toBe(DEBUG_DROP_BUTTON);
		expect(bit32.band(RECORDED_BUTTONS, DEBUG_DROP_BUTTON)).toBe(DEBUG_DROP_BUTTON);
		for (const other of [DEBUG_FLOOR_BUTTON, FORFEIT_BUTTON, PARTY_LEFT_BUTTON])
			expect(bit32.band(other, DEBUG_DROP_BUTTON)).toBe(0);
		// The binary codec carries it.
		const rec = new Recorder(SEED, 0, 0);
		rec.record(frame(DEBUG_DROP_BUTTON));
		rec.record(IDLE);
		const decoded = decodeRecording(encodeRecording(rec.getRecording()), { maxTicks: 10, maxRecordingBytes: 1000 });
		expect(decoded.ok).toBe(true);
		if (decoded.ok) expect(decoded.recording.frames[0].buttons).toBe(DEBUG_DROP_BUTTON);
	});

	it("each press edge drops the next kind ahead of the player (cycling, no draw); held, dead or full: nothing", () => {
		const config = arena(NEVER);
		const s = fresh(config);
		const d = s.drops!;
		const press = frame(DEBUG_DROP_BUTTON);
		const p = s.player;
		const kinds: number[] = [];
		for (let i = 0; i < DROPS.maxOnGround; i++) {
			step(s, press, config);
			expect(d.events.dropped).toEqual([i]);
			step(s, press, config); // held: no repeat
			expect(d.events.dropped.size()).toBe(0);
			step(s, IDLE, config);
			kinds.push(d.ground[i].kind);
		}
		expect(kinds).toEqual([Boost.FURY, Boost.QUICKSTEP, Boost.FRENZY, Boost.AEGIS]);
		expect([d.ground[0].x, d.ground[0].z]).toEqual([
			p.x + p.faceX * DEBUG_DROP_AHEAD,
			p.z + p.faceZ * DEBUG_DROP_AHEAD,
		]);
		expect(DEBUG_DROP_AHEAD > DROPS.pickupRadius).toBe(true);
		expect([occupied(s), d.debugNextKind, d.rngState]).toEqual([4, Boost.FURY, dropsSeedState(SEED)]);
		step(s, press, config); // full
		expect([d.events.dropped.size(), d.debugNextKind]).toEqual([0, Boost.FURY]);
		step(s, IDLE, config);
		for (const g of d.ground) g.kind = NO_BOOST;
		p.dead = 1;
		step(s, press, config);
		expect([occupied(s), d.debugNextKind]).toEqual([0, Boost.FURY]);
	});
});

describe("drops: the tutorial's guarantee", () => {
	it("the last kill of the guaranteed room's spawns drops its kind (the training dummy too); nothing else drops", () => {
		const config = arena(guaranteedDropsConfig([{ floor: 1, room: 0, kind: Boost.FURY }]));
		const s = fresh(config);
		const d = s.drops!;
		killAt(s, config, TEST_DUMMY, 2, 2); // chance 0, no pity: never
		expect([occupied(s), d.killsSinceDrop]).toEqual([0, 1]);
		s.player.z = 6;
		step(s, IDLE, config);
		expect(s.events.roomEntered).toBe(1);
		const members = s.combat.actors.filter((a) => a.alive !== 0);
		expect(members.size()).toBe(3);
		expect(d.guards).toEqual([{ kind: Boost.FURY, ids: members.map((a) => a.id) }]);
		const ctx = ctxOf(s, config);
		ctx.killActor(members[1]);
		ctx.killActor(members[0]);
		expect([occupied(s), d.guards[0].ids]).toEqual([0, [members[2].id]]);
		ctx.killActor(members[2]);
		expect(d.guards.size()).toBe(0);
		expect(d.ground[0]).toEqual({
			kind: Boost.FURY,
			x: members[2].x,
			z: members[2].z,
			spawnTick: s.tick,
			ticksLeft: DROP_GROUND_TICKS,
		});
		expect([d.rngState, d.killsSinceDrop]).toEqual([dropsSeedState(SEED), 0]);
	});

	it("only its floor and room: another room id or floor makes no guard", () => {
		const wrongRoom = arena(guaranteedDropsConfig([{ floor: 1, room: 1, kind: Boost.FURY }]));
		const a = fresh(wrongRoom);
		a.player.z = 6;
		step(a, IDLE, wrongRoom);
		expect(a.drops!.guards.size()).toBe(0);
		const wrongFloor = arena(guaranteedDropsConfig([{ floor: 2, room: 0, kind: Boost.FURY }]));
		const b = fresh(wrongFloor);
		b.player.z = 6;
		step(b, IDLE, wrongFloor);
		expect(b.drops!.guards.size()).toBe(0);
	});
});

describe("drops: replays", () => {
	it("a scripted run (kills, debug drops, pickups, a hit, a floor skip) replays to the same hash", () => {
		const config = arena({ ...ALWAYS, pityKills: 2 });
		const live = fresh(config);
		const rec = new Recorder(SEED, 0, 0);
		let collected = 0;
		let broke = 0;
		const play = (f: InputFrame) => {
			rec.record(f);
			step(live, f, config);
			collected += live.drops!.events.collected.size();
			broke += live.drops!.events.aegisBroke.size();
		};
		const frames: InputFrame[] = [];
		for (let i = 0; i < 4; i++) {
			frames.push(frame(DEBUG_DROP_BUTTON));
			frames.push(IDLE);
		}
		// Walk along the facing onto the debug drops, then up into the dummies' room and back.
		for (let i = 0; i < 30; i++) frames.push(frame(0, 707, 707));
		for (let i = 0; i < 50; i++) frames.push(frame(0, -400, 1000));
		frames.push(frame(Button.DEBUG_HIT));
		for (let i = 0; i < 60; i++) frames.push(frame(i % 20 === 0 ? Button.FIRE : 0, 0, -1000));
		frames.push(frame(DEBUG_FLOOR_BUTTON));
		for (const f of frames) play(f);
		expect([collected, broke, live.events.floorChanged]).toEqual([BOOST_COUNT, 1, 2]);
		const once = runReplay(rec.getRecording(), config);
		const twice = runReplay(rec.getRecording(), config);
		expect(hashState(once)).toBe(hashState(live));
		expect(hashState(twice)).toBe(hashState(live));
		expect(once.drops!.players[0].ticks).toEqual(live.drops!.players[0].ticks);
	});
});
