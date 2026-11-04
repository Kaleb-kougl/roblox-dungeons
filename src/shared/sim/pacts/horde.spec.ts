// The Pact of the Horde (docs/FORTUNE.md PS4, FD6-FD8): taken once per party per shrine, it arms; the next room with
// planned spawns any living player enters is roused (never the boss room). Wave 2 = the room's planned kinds again
// (at most hordeMaxWave, no affixes, the pool permitting), telegraphed for waveTelegraphTicks once the living first-wave
// members are at most floor(n / 2), tiles through safeRoomSpawns; the record never clears between the waves and judges
// PERFECT / FAST / the Sweep over both on the same record. The record's kills, ROOMS / PERFECT / FAST, pellets and
// Sweep pay x2 through bonusPercent (exact integers): each source books what it would without pacts, HORDE the rest
// (Bounty, affixes and Gold Rush stacked exactly). An armed Horde lapses silently on the floor change.
//
// The rooms are an endless floor's real rooms with their planned spawns replaced (n swarmers on the room's spawn tiles,
// optional affixes), so the record, par, tiles and pellets are the sim's own. Kills are SimCtx.killActor between ticks
// (the sim's kill path: scoreKill with the bound player as killer); a hit is hitsTaken + 1 (test surgery).
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind, encounterCost, type ActorSpawn } from "shared/dungeon";
import {
	Boon,
	DEBUG_FLOOR_BUTTON,
	DUMMY_KIND,
	Duo,
	EMPTY_INPUT,
	FAST_POINTS_PER_TICK,
	GOLD_RUSH_PERCENT,
	HORDE_NONE,
	HORDE_WAVE_PENDING,
	HordePhase,
	KILL_POINTS,
	MAX_ACTORS,
	NO_KIND,
	PactDim,
	PactKind,
	ROOM_CLEAR_POINTS,
	ROOM_PAR_TICKS_PER_COST,
	ROOM_PERFECT_POINTS,
	SWEEP_POINTS,
	PELLET_POINTS,
	ScoreSource,
	SimCtx,
	actorAffix,
	affixKillPercent,
	awardPoints,
	createSimState,
	duoCard,
	floorScalePercent,
	grantCard,
	hordePhase,
	isDraftOpen,
	pactAvailability,
	playerAt,
	runMods,
	scoreFloor,
	step,
	stepParty,
	type ActorState,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { altarFloor, frame, pactsSetup, pressPact, skipToFloor, skipToFloorAny, teleport } from "shared/run/testing";
import type { EndlessRunFloor, EndlessRunSetup } from "shared/run";

const SEED = 1337;
const SWARMER = "swarmer";

interface Horde {
	readonly setup: EndlessRunSetup;
	readonly s: SimState;
	readonly floor: number;
	/** The room whose planned spawns were replaced, and its encounter centre. */
	readonly room: number;
	readonly world: EndlessRunFloor;
}

/**
 * Run `seed` with pacts, its first altar floor's first room that has planned spawns, pellets and at least 12 spawn
 * tiles given `n` swarmers (on its first n spawn tiles; `affix` on each), the state skipped to that floor.
 */
function hordeRun(n: number, affix: number = AffixKind.NONE, seed = SEED, party = 1): Horde {
	const base = pactsSetup(seed, party);
	const floor = altarFloor(base);
	expect(floor > 0).toBe(true);
	const w = base.endlessFloor(floor);
	let room = -1;
	for (let id = 0; id < w.roomSpawns.size() && room < 0; id++) {
		if (w.roomSpawns[id].size() === 0 || (w.roomSpawnTiles?.[id].size() ?? 0) < 12) continue;
		if (w.pellets === undefined || !w.pellets.room.includes(id)) continue;
		room = id;
	}
	expect(room >= 0).toBe(true);
	const tiles = w.roomSpawnTiles![room];
	const spawns: ActorSpawn[] = [];
	for (let k = 0; k < n; k++) spawns.push({ kind: SWARMER, x: tiles[k].x, z: tiles[k].z });
	const roomSpawns = w.roomSpawns.map((l, id) => (id === room ? spawns : l));
	const roomAffixes = w.roomAffixes!.map((l, id) => (id === room ? spawns.map(() => affix) : l));
	const world: EndlessRunFloor = { ...w, roomSpawns, roomAffixes };
	const endlessFloor = (f: number) => (f === floor ? world : base.endlessFloor(f));
	const setup: EndlessRunSetup = {
		...base,
		config: { ...base.config, endless: { ...base.config.endless!, worldForFloor: endlessFloor } },
		endlessFloor,
	};
	const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, setup.config);
	skipToFloorAny(s, setup.config, floor);
	return { setup, s, floor, room, world };
}

function idleTick(h: Horde): void {
	if (h.s.party === undefined) step(h.s, frame(0, 0), h.setup.config);
	else {
		const inputs: InputFrame[] = [];
		for (let i = 0; i < h.s.party.size; i++) inputs.push(frame(0, 0));
		stepParty(h.s, inputs, h.setup.config);
	}
}

/** Takes the Horde, walks (teleports) into the room, back to the entrance: the room's first wave is up. */
function rouse(h: Horde): void {
	pressPact(h.setup, h.s, PactKind.HORDE);
	expect(hordePhase(h.s)).toBe(HordePhase.ARMED);
	const r = h.world.config.encounter!.rooms[h.room];
	teleport(h.s, 0, r.cx, r.cz);
	idleTick(h);
	teleport(h.s, 0, h.world.spawnX, h.world.spawnZ);
}

function record(h: Horde) {
	return h.s.score!.rooms[h.s.pacts!.horde.record];
}

/** The record's living members (slot, id match, alive). */
function living(h: Horde): ActorState[] {
	const r = record(h);
	const out: ActorState[] = [];
	for (let m = 0; m < r.memberSlots.size(); m++) {
		const a = h.s.combat.actors[r.memberSlots[m]];
		if (a !== undefined && a.kind !== NO_KIND && a.id === r.memberIds[m] && a.alive !== 0) out.push(a);
	}
	return out;
}

const kctx = new SimCtx();
function kill(h: Horde, a: ActorState): void {
	kctx.bind(h.s, h.world.config, EMPTY_INPUT);
	kctx.killActor(a);
}

/** Runs idle ticks until the wave spawned (or `max`). */
function untilWave(h: Horde, max = 200): void {
	for (let k = 0; k < max && h.s.pacts!.horde.spawned === HORDE_WAVE_PENDING; k++) idleTick(h);
}

describe("Pact of the Horde (PS4)", () => {
	it("an 8-enemy room: roused, wave 2 telegraphed at half down, no clear between, appended, PERFECT x2 over both", () => {
		const h = hordeRun(8);
		const sc = h.s.score!;
		const hits0 = sc.hitsTaken;
		rouse(h);
		const p = h.s.pacts!;
		expect(p.horde.armed).toBe(0);
		expect(p.horde.room).toBe(h.room);
		expect(sc.rooms[p.horde.record].room).toBe(h.room);
		expect(p.horde.firstWave).toBe(8);
		expect(hordePhase(h.s)).toBe(HordePhase.FIGHT);
		const par0 = record(h).parTicks;
		// 3 down: no trigger; the 4th down: living 4 <= floor(8 / 2)
		const first = living(h);
		for (let k = 0; k < 3; k++) kill(h, first[k]);
		idleTick(h);
		expect(p.horde.waveDueTick).toBe(HORDE_NONE);
		kill(h, first[3]);
		const rng = h.s.rngState;
		idleTick(h);
		expect(p.events.waveTelegraphed).toBe(8);
		expect(h.s.rngState).toBe(rng); // the trigger draws nothing
		expect(p.horde.waveDueTick).toBe(h.s.tick - 1 + p.config.waveTelegraphTicks);
		expect(p.horde.waveKinds.size()).toBe(8);
		expect(hordePhase(h.s)).toBe(HordePhase.TELEGRAPH);
		// the rest of wave 1 down: the record is held
		for (const a of living(h)) kill(h, a);
		for (let k = 0; k < 30; k++) idleTick(h);
		expect(record(h).cleared).toBe(0);
		expect(p.horde.spawned).toBe(HORDE_WAVE_PENDING);
		untilWave(h);
		expect(p.horde.spawned).toBe(8);
		expect(p.events.waveSpawned).toBe(9);
		expect(h.s.tick - 1).toBe(p.horde.waveDueTick);
		expect(record(h).memberSlots.size()).toBe(16);
		expect(record(h).parTicks).toBe(
			par0 + p.config.waveTelegraphTicks + 8 * ROOM_PAR_TICKS_PER_COST * encounterCost(SWARMER),
		);
		expect(hordePhase(h.s)).toBe(HordePhase.WAVE);
		// wave 2 carries no affix
		for (const a of living(h)) expect(actorAffix(h.s, a)).toBe(AffixKind.NONE);
		// wave 2 down: the clear pays x2 (PERFECT: no hit over both waves)
		expect(sc.hitsTaken).toBe(hits0);
		for (const a of living(h)) kill(h, a);
		const before = [...sc.points];
		const total0 = sc.total;
		const counts0 = [...sc.counts];
		idleTick(h);
		const r = record(h);
		expect(r.cleared).toBe(1);
		expect(p.events.hordeCleared).toBe(1);
		expect(hordePhase(h.s)).toBe(HordePhase.CLEARED);
		const under = r.parTicks - (h.s.tick - 1 - r.engageTick);
		const pay = (base: number) => [awardPoints(h.s, sc, base), awardPoints(h.s, sc, base, 100, 200)];
		const [rooms1, rooms2] = pay(ROOM_CLEAR_POINTS);
		const [perf1, perf2] = pay(ROOM_PERFECT_POINTS);
		const [fast1, fast2] = under > 0 ? pay(under * FAST_POINTS_PER_TICK) : [0, 0];
		expect(sc.points[ScoreSource.ROOMS] - before[ScoreSource.ROOMS]).toBe(rooms1);
		expect(sc.points[ScoreSource.PERFECT] - before[ScoreSource.PERFECT]).toBe(perf1);
		expect(sc.points[ScoreSource.FAST] - before[ScoreSource.FAST]).toBe(fast1);
		const extra = sc.points[ScoreSource.HORDE] - before[ScoreSource.HORDE];
		expect(extra).toBe(rooms2 - rooms1 + (perf2 - perf1) + (fast2 - fast1));
		expect(sc.counts[ScoreSource.HORDE] - counts0[ScoreSource.HORDE]).toBe(under > 0 ? 3 : 2);
		expect(sc.total - total0).toBe(rooms2 + perf2 + fast2);
	});

	it("a 1-enemy room: its death triggers wave 2 (one enemy), and only wave 2's death clears it", () => {
		const h = hordeRun(1);
		rouse(h);
		const p = h.s.pacts!;
		expect(p.horde.firstWave).toBe(1);
		kill(h, living(h)[0]);
		idleTick(h);
		expect(p.events.waveTelegraphed).toBe(1);
		expect(record(h).cleared).toBe(0);
		untilWave(h);
		expect(p.horde.spawned).toBe(1);
		expect(record(h).cleared).toBe(0);
		expect(living(h).size()).toBe(1);
		kill(h, living(h)[0]);
		idleTick(h);
		expect(record(h).cleared).toBe(1);
	});

	it("PERFECT judges both waves: a hit during wave 2 costs it; hordeMaxWave caps a 12-enemy room's wave at 10", () => {
		const h = hordeRun(12);
		rouse(h);
		const p = h.s.pacts!;
		for (const a of living(h)) kill(h, a);
		idleTick(h);
		expect(p.horde.waveKinds.size()).toBe(10);
		untilWave(h);
		expect(p.horde.spawned).toBe(10);
		expect(record(h).memberSlots.size()).toBe(22);
		h.s.score!.hitsTaken += 1; // a hit landed during wave 2
		const perfect0 = h.s.score!.counts[ScoreSource.PERFECT];
		for (const a of living(h)) kill(h, a);
		idleTick(h);
		expect(record(h).cleared).toBe(1);
		expect(h.s.score!.counts[ScoreSource.PERFECT]).toBe(perfect0);
	});

	it("a full pool: wave 2 spawns what fits (here 3), the record still clears", () => {
		const h = hordeRun(8);
		rouse(h);
		const p = h.s.pacts!;
		for (const a of living(h)) kill(h, a);
		idleTick(h);
		// right before the spawn tick (wave 1's corpses freed by then), fill the pool to 3 free slots (dummies at the
		// entrance)
		while (h.s.tick < p.horde.waveDueTick) idleTick(h);
		expect(p.horde.spawned).toBe(HORDE_WAVE_PENDING);
		kctx.bind(h.s, h.world.config, EMPTY_INPUT);
		let used = 0;
		for (const a of h.s.combat.actors) if (a.kind !== NO_KIND) used++;
		for (let k = used; k < MAX_ACTORS - 3; k++) kctx.spawnActor(DUMMY_KIND, h.world.spawnX, h.world.spawnZ);
		const dropped0 = h.s.combat.actorsDropped;
		idleTick(h);
		expect(p.horde.spawned).toBe(3);
		expect(h.s.combat.actorsDropped - dropped0).toBe(5);
		expect(record(h).memberSlots.size()).toBe(8 + 3);
		for (const a of living(h)) kill(h, a);
		idleTick(h);
		expect(record(h).cleared).toBe(1);
	});

	it("exact x2 kills with Bounty, an affix and Gold Rush stacked; pellets and the Sweep x2; other kills x1", () => {
		const h = hordeRun(4, AffixKind.HULKING);
		const sc = h.s.score!;
		// Bounty II, Lingering, Gold Rush (the duo); combo x3.5
		grantCard(h.s, 0, Boon.BOUNTY);
		grantCard(h.s, 0, Boon.BOUNTY);
		grantCard(h.s, 0, Boon.LINGERING);
		grantCard(h.s, 0, duoCard(Duo.GOLD_RUSH));
		rouse(h);
		sc.combo = 35;
		// the room's pellets, every one taken while wave 1 stands (one per tick): x2 each
		const pl = h.s.pellets!;
		const rec = h.s.pacts!.horde.record;
		let pelletsTaken = 0;
		for (let i = 0; i < pl.x.size(); i++) {
			if (pl.rec[i] !== rec || i === pl.power) continue;
			const pts0 = sc.points[ScoreSource.PELLETS];
			const extra0 = sc.points[ScoreSource.HORDE];
			const tot0 = sc.total;
			teleport(h.s, 0, pl.x[i], pl.z[i]);
			playerAt(h.s, 0).hearts = playerAt(h.s, 0).heartsMax; // test-only: the room's enemies never end the walk
			const scale = floorScalePercent(scoreFloor(h.s));
			const combo = sc.combo;
			const n1 = awardPoints(h.s, sc, PELLET_POINTS, scale);
			const n2 = awardPoints(h.s, sc, PELLET_POINTS, scale, 200);
			idleTick(h);
			expect(pl.taken[i]).toBe(1);
			if (sc.combo === combo) {
				expect(sc.points[ScoreSource.PELLETS] - pts0).toBe(n1);
				expect(sc.points[ScoreSource.HORDE] - extra0).toBe(n2 - n1);
				expect(sc.total - tot0).toBe(n2);
			}
			pelletsTaken++;
			sc.combo = 35;
		}
		expect(pelletsTaken > 0).toBe(true);
		teleport(h.s, 0, h.world.spawnX, h.world.spawnZ);
		// kills: Bounty II x Hulking x2 x Gold Rush, exactly
		const base = KILL_POINTS.get(SWARMER)!;
		for (const a of living(h)) {
			sc.combo = 35;
			const bonus = affixKillPercent(h.s, a, runMods(h.s, 0).killPointsPercent);
			expect(bonus > 120).toBe(true); // Bounty II's 120 x the affix's
			const scale = floorScalePercent(scoreFloor(h.s));
			const n1 = awardPoints(h.s, sc, base, scale, bonus, GOLD_RUSH_PERCENT);
			const n2 = awardPoints(h.s, sc, base, scale, bonus * 2, GOLD_RUSH_PERCENT);
			const k0 = sc.points[ScoreSource.KILLS];
			const x0 = sc.points[ScoreSource.HORDE];
			const t0 = sc.total;
			kill(h, a);
			expect(sc.points[ScoreSource.KILLS] - k0).toBe(n1);
			expect(sc.points[ScoreSource.HORDE] - x0).toBe(n2 - n1);
			expect(sc.total - t0).toBe(n2);
			expect(sc.events.popPoints[sc.events.popPoints.size() - 1]).toBe(n2);
		}
		idleTick(h);
		untilWave(h);
		// wave 2 (no affix): Bounty x2 x Gold Rush
		for (const a of living(h)) {
			sc.combo = 35;
			const bonus = runMods(h.s, 0).killPointsPercent;
			expect(affixKillPercent(h.s, a, bonus)).toBe(bonus);
			const scale = floorScalePercent(scoreFloor(h.s));
			const n1 = awardPoints(h.s, sc, base, scale, bonus, GOLD_RUSH_PERCENT);
			const n2 = awardPoints(h.s, sc, base, scale, bonus * 2, GOLD_RUSH_PERCENT);
			const x0 = sc.points[ScoreSource.HORDE];
			kill(h, a);
			expect(sc.points[ScoreSource.HORDE] - x0).toBe(n2 - n1);
		}
		// the clear: the Sweep (every regular pellet was taken) x2 before ROOMS
		const sw0 = sc.points[ScoreSource.SWEEP];
		const x0 = sc.points[ScoreSource.HORDE];
		idleTick(h);
		expect(record(h).cleared).toBe(1);
		const sweep1 = awardPoints(h.s, sc, SWEEP_POINTS);
		const sweep2 = awardPoints(h.s, sc, SWEEP_POINTS, 100, 200);
		expect(sc.points[ScoreSource.SWEEP] - sw0).toBe(sweep1);
		expect(sc.points[ScoreSource.HORDE] - x0 >= sweep2 - sweep1).toBe(true);
		// a kill elsewhere (another room's enemy) is not doubled
		const other = h.world.roomSpawns.findIndex((l, id) => id !== h.room && l.size() > 0);
		expect(other >= 0).toBe(true);
		const r2 = h.world.config.encounter!.rooms[other];
		teleport(h.s, 0, r2.cx, r2.cz);
		idleTick(h);
		const rec2 = sc.rooms.find((r) => r.room === other)!;
		const a2 = h.s.combat.actors[rec2.memberSlots[0]];
		const xh = sc.points[ScoreSource.HORDE];
		kill(h, a2);
		expect(sc.points[ScoreSource.HORDE]).toBe(xh);
	});

	it("lapses on the floor change (armed, or mid-fight); never the boss room; dim: taken by anyone, no room left", () => {
		// armed, no room entered: the floor change lapses it silently
		{
			const h = hordeRun(4);
			pressPact(h.setup, h.s, PactKind.HORDE);
			expect(pactAvailability(h.s, h.setup.config, 0, PactKind.HORDE)).toBe(PactDim.TAKEN);
			step(h.s, frame(0, 0, DEBUG_FLOOR_BUTTON), h.setup.config);
			expect(hordePhase(h.s)).toBe(HordePhase.IDLE);
			expect(h.s.pacts!.horde.armed).toBe(0);
		}
		// roused mid-fight, then the floor change: gone, the next floor's kills pay x1
		{
			const h = hordeRun(4);
			rouse(h);
			step(h.s, frame(0, 0, DEBUG_FLOOR_BUTTON), h.setup.config);
			expect(h.s.pacts!.horde.room).toBe(HORDE_NONE);
			expect(h.s.pacts!.horde.record).toBe(HORDE_NONE);
			expect(hordePhase(h.s)).toBe(HordePhase.IDLE);
		}
		// every enemy room entered: NO_ROOM, a press arms nothing
		{
			const h = hordeRun(4);
			const e = h.s.endless!;
			for (let id = 0; id < e.roomsEntered.size(); id++) e.roomsEntered[id] = 1;
			expect(pactAvailability(h.s, h.setup.config, 0, PactKind.HORDE)).toBe(PactDim.NO_ROOM);
			pressPact(h.setup, h.s, PactKind.HORDE);
			expect(h.s.pacts!.horde.armed).toBe(0);
		}
		// co-op: once per party
		{
			const h = hordeRun(4, AffixKind.NONE, SEED, 2);
			pressPact(h.setup, h.s, PactKind.HORDE, 1);
			expect(h.s.pacts!.players[1].hordeTaken).toBe(1);
			expect(pactAvailability(h.s, h.setup.config, 0, PactKind.HORDE)).toBe(PactDim.TAKEN);
			pressPact(h.setup, h.s, PactKind.HORDE, 0);
			expect(h.s.pacts!.players[0].hordeTaken).toBe(0);
			expect(h.s.pacts!.taken[PactKind.HORDE]).toBe(1);
		}
		// the boss room is never roused: a boss floor with altars, the Horde armed, into the boss room first
		let bossFloors = 0;
		for (let seed = 1; seed <= 40 && bossFloors === 0; seed++) {
			const setup = pactsSetup(seed);
			if (altarFloor(setup, 5, 5) !== 5) continue;
			bossFloors++;
			const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, setup.config);
			skipToFloor(s, setup.config, 5);
			pressPact(setup, s, PactKind.HORDE);
			const w = setup.endlessFloor(5);
			const boss = w.config.encounter!.rooms[w.config.encounter!.bossRoom];
			teleport(s, 0, boss.cx + 2, boss.cz + 2);
			step(s, frame(0, 0), setup.config);
			step(s, frame(0, 0), setup.config);
			expect(s.endless!.roomsEntered[boss.id]).toBe(1);
			expect(hordePhase(s)).toBe(HordePhase.ARMED);
			expect(isDraftOpen(s)).toBe(false);
		}
		expect(bossFloors).toBe(1);
	});
});
