// Pellets in the sim, the skeleton (docs/PELLETS.md PL2): the opt-in config, state.pellets filled from the floor at
// run start and on every floor change (after the score's room records it hangs off; dev mode's startFloor and co-op
// too), clone, the "pellets" hash group appended last only with the config, the pellet score sources (PELLETS 10 /
// SWEEP 11, JACKPOT padded without builds) and the award functions' math (combo, Depth, curses, floor scale; the combo
// and its timer never fed, PD1). Nothing turns pellets on in any world yet, and with the config nothing else in a run
// moves: every other hash group and the rng replay exactly as without it.
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { NO_POWER_PELLET, PELLETS, cellKey, worldToGrid, type FloorPellets } from "shared/dungeon";
import {
	AXIS_MAX,
	BUILDS_SUBSYSTEM,
	BUILD_SCORE_SOURCE_NAMES,
	DEBUG_FLOOR_BUTTON,
	DROPS,
	EMPTY_INPUT,
	NO_PELLET_RECORD,
	PELLETS_CONFIG,
	PELLETS_SUBSYSTEM,
	PELLET_PICKUP_RADIUS,
	PELLET_SCORE_SOURCE_NAMES,
	PelletPhase,
	SCORE_SOURCE_COUNT,
	SCORE_SUBSYSTEM,
	ScoreSource,
	awardPoints,
	cloneSimState,
	createSimState,
	floorScalePercent,
	hashLayout,
	hashState,
	pelletAtCell,
	pelletsOnFloor,
	scorePellet,
	scorePowerBullets,
	scoreSweep,
	step,
	stepParty,
	writeHashFields,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildDevRunConfig, buildEndlessRunConfig, type EndlessRunSetup } from "shared/run";

const SEED = 4242;
const SETUP: EndlessRunSetup = buildEndlessRunConfig(SEED);
/**
 * The endless config without treasure rooms, pacts and the Goldling (docs/TREASURE.md TR5, docs/FORTUNE.md PS5 / GE3:
 * every endless world sets them too; their groups follow pellets and their TREASURE / HORDE / GOLDEN sources pad the
 * score past these), so pellets stay the last group and their sources the last ones here: what pellets add, alone.
 */
const BASE: SimConfig = { ...SETUP.config, treasure: undefined, pacts: undefined, golden: undefined };
const WITH: SimConfig = { ...BASE, pellets: PELLETS_CONFIG };
/** The endless config without pellets (every endless world sets them since PL5), nor treasure, pacts or the Goldling. */
const WITHOUT: SimConfig = { ...BASE, pellets: undefined };

function fresh(config: SimConfig = WITH, setup: { spawn?: { x: number; z: number } } = SETUP): SimState {
	return createSimState(SEED, setup.spawn!.x, setup.spawn!.z, config);
}

function floorPellets(floor: number, setup: EndlessRunSetup = SETUP): FloorPellets {
	const p = setup.endlessFloor(floor).pellets;
	expect(p).never.toBe(undefined);
	return p!;
}

/** state.pellets matches `floor` on the state's current score records (see pelletsOnFloor). */
function expectFloor(s: SimState, floor: FloorPellets): void {
	const p = s.pellets!;
	const records = s.score!.rooms;
	expect(p.x.size()).toBe(floor.tiles.size());
	expect(p.taken.size()).toBe(floor.tiles.size());
	expect(p.power).toBe(floor.power);
	expect(p.rooms.size()).toBe(records.size());
	for (let i = 0; i < floor.tiles.size(); i++) {
		expect([p.x[i], p.z[i], p.taken[i]]).toEqual([floor.tiles[i].x, floor.tiles[i].z, 0]);
		const rec = p.rec[i];
		expect(rec).never.toBe(NO_PELLET_RECORD);
		expect(records[rec].room).toBe(floor.room[i]);
		expect(pelletAtCell(p, worldToGrid(floor.tiles[i].x), worldToGrid(floor.tiles[i].z))).toBe(i);
	}
	let regular = 0;
	for (let k = 0; k < p.rooms.size(); k++) {
		const r = p.rooms[k];
		expect([r.phase, r.swept, r.left]).toEqual([PelletPhase.DORMANT, 0, r.count]);
		let inRange = 0;
		let power = 0;
		for (let i = 0; i < p.rec.size(); i++) {
			if (p.rec[i] !== k) continue;
			expect(i >= r.first && i < r.first + r.span).toBe(true);
			inRange++;
			if (i === p.power) power++;
		}
		expect(inRange).toBe(r.span);
		expect(r.count).toBe(r.span - power);
		regular += r.count;
	}
	expect(regular).toBe(floor.tiles.size() - (floor.power !== NO_POWER_PELLET ? 1 : 0));
}

/** A walk that wanders the first floor (no fire), so actors engage and the score moves. */
function wander(t: number): InputFrame {
	const phase = math.floor(t / 90) % 4;
	const mx = phase === 0 ? AXIS_MAX : phase === 2 ? -AXIS_MAX : 0;
	const mz = phase === 1 ? AXIS_MAX : phase === 3 ? -AXIS_MAX : 0;
	return { ...EMPTY_INPUT, moveX: mx, moveZ: mz };
}

function groupsByName(s: SimState): Map<string, number[]> {
	const l = hashLayout(s);
	const out = new Map<string, number[]>();
	for (const g of l.groups) {
		const v: number[] = [];
		for (let i = g.start; i < g.finish; i++) v.push(l.values[i]);
		out.set(g.name, v);
	}
	return out;
}

describe("pellets: config and tunables", () => {
	it("PELLETS_CONFIG: 0.45-tile pickup, 5 per pellet, 250 per Sweep, 5 per power bullet", () => {
		expect(PELLETS_CONFIG.pickupRadius).toBe(PELLET_PICKUP_RADIUS);
		expect(PELLET_PICKUP_RADIUS).toBe(0.45);
		expect([PELLETS_CONFIG.pelletPoints, PELLETS_CONFIG.sweepPoints, PELLETS_CONFIG.powerBulletPoints]).toEqual([
			5, 250, 5,
		]);
		expect(PELLETS_CONFIG.powerMaxBullets > 0).toBe(true);
		expect(PELLETS_CONFIG.floor).toBe(undefined);
		// The dungeon's pellet stream never shares the sim's drop stream salt.
		expect(PELLETS.salt).never.toBe(DROPS.salt);
	});

	it("every endless world sets it (PL5); without it: no pellets state, no pellets group, the same score sources", () => {
		expect(SETUP.config.pellets).toBe(PELLETS_CONFIG);
		expect(buildEndlessRunConfig(SEED, 3).config.pellets).toBe(PELLETS_CONFIG);
		expect(buildDevRunConfig(SEED, { startFloor: 3, invulnerable: true }).config.pellets).toBe(PELLETS_CONFIG);
		const s = fresh(WITHOUT);
		expect(s.pellets).toBe(undefined);
		const l = hashLayout(s);
		expect(l.groups[l.groups.size() - 1].name).toBe(BUILDS_SUBSYSTEM);
		expect(s.score!.points.size()).toBe(SCORE_SOURCE_COUNT + BUILD_SCORE_SOURCE_NAMES.size());
	});
});

describe("pellets: state from the floor", () => {
	it("run start: floor 1's pellets on its deferred score records, every room dormant", () => {
		const s = fresh();
		expect(s.pellets!.config).toBe(PELLETS_CONFIG);
		const floor = floorPellets(1);
		expect(floor.tiles.size() > 0).toBe(true);
		expectFloor(s, floor);
	});

	it("a floor change brings the next floor's pellets, after the score's rebuilt records", () => {
		const s = fresh();
		step(s, { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON }, WITH);
		expect(s.endless!.floor).toBe(2);
		expectFloor(s, floorPellets(2));
	});

	it("dev mode's startFloor and co-op get their first floor's pellets", () => {
		const dev = buildDevRunConfig(SEED, { startFloor: 6, invulnerable: false });
		const s = createSimState(SEED, dev.spawn!.x, dev.spawn!.z, { ...dev.config, pellets: PELLETS_CONFIG });
		expect(s.endless!.floor).toBe(6);
		expectFloor(s, dev.config.endless!.worldForFloor(6).pellets!);

		const duo = buildEndlessRunConfig(SEED, 2);
		const config = { ...duo.config, pellets: PELLETS_CONFIG };
		const c = createSimState(SEED, duo.spawn!.x, duo.spawn!.z, config);
		expectFloor(c, floorPellets(1, duo));
		stepParty(c, [{ ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON }, EMPTY_INPUT], config);
		expectFloor(c, floorPellets(2, duo));
	});

	it("pelletsOnFloor: undefined empties the floor (rooms stay one per record); bad input throws", () => {
		const s = fresh();
		pelletsOnFloor(s, undefined);
		const p = s.pellets!;
		expect([p.x.size(), p.taken.size(), p.power, p.byCell.size()]).toEqual([0, 0, NO_POWER_PELLET, 0]);
		expect(p.rooms.size()).toBe(s.score!.rooms.size());
		const a = s.score!.rooms[0].room;
		const b = s.score!.rooms[1].room;
		const tile = (x: number) => ({ x, z: 1 });
		expect(() => pelletsOnFloor(s, { tiles: [tile(1)], room: [a], power: 1 })).toThrow();
		expect(() => pelletsOnFloor(s, { tiles: [tile(1)], room: [a, b], power: NO_POWER_PELLET })).toThrow();
		expect(() =>
			pelletsOnFloor(s, { tiles: [tile(1), tile(2), tile(3)], room: [a, b, a], power: NO_POWER_PELLET }),
		).toThrow();
		// A room without a score record: its pellets never link to one.
		pelletsOnFloor(s, { tiles: [tile(1), tile(2)], room: [a, 9999], power: 0 });
		expect(p.rec[1]).toBe(NO_PELLET_RECORD);
		expect([p.rooms[0].span, p.rooms[0].count, p.rooms[0].left]).toEqual([1, 0, 0]);
	});

	it("a sandbox without endless mode takes PelletsConfig.floor; without scoring no pellet has a record", () => {
		const floor: FloorPellets = {
			tiles: [
				{ x: 1, z: 2 },
				{ x: 3, z: 2 },
			],
			room: [0, 0],
			power: NO_POWER_PELLET,
		};
		const s = createSimState(1, 0, 0, { pellets: { ...PELLETS_CONFIG, floor } });
		const p = s.pellets!;
		expect([p.x, p.z, p.rec, p.rooms.size()]).toEqual([[1, 3], [2, 2], [NO_PELLET_RECORD, NO_PELLET_RECORD], 0]);
		expect(p.byCell.get(cellKey(3, 2))).toBe(1);
		expect(s.score).toBe(undefined);
	});
});

describe("pellets: clone and hash", () => {
	it("cloneSimState copies pellets deeply (same hash, independent arrays, rooms, lookup and events)", () => {
		const s = fresh();
		const c = cloneSimState(s);
		expect(hashState(c)).toBe(hashState(s));
		c.pellets!.taken[0] = 1;
		c.pellets!.rooms[0].left -= 1;
		c.pellets!.byCell.clear();
		c.pellets!.events.live.push(0);
		expect(s.pellets!.taken[0]).toBe(0);
		expect(s.pellets!.rooms[0].left).toBe(s.pellets!.rooms[0].count);
		expect(s.pellets!.byCell.size()).toBe(s.pellets!.x.size());
		expect(s.pellets!.events.live.size()).toBe(0);
		expect(hashState(c)).never.toBe(hashState(s));
	});

	it("the pellets group is appended last (after builds) only with the config; values = writeHashFields; names", () => {
		const s = fresh();
		const l = hashLayout(s, true);
		expect(l.values).toEqual(writeHashFields(s, []));
		expect(l.names.size()).toBe(l.values.size());
		const n = l.groups.size();
		expect([l.groups[n - 2].name, l.groups[n - 1].name]).toEqual([BUILDS_SUBSYSTEM, PELLETS_SUBSYSTEM]);
		const g = l.groups[n - 1];
		const p = s.pellets!;
		expect(g.finish - g.start).toBe(1 + p.taken.size() + 1 + 1 + 3 * p.rooms.size());
		expect(l.names[g.start]).toBe("pellets.length");
		expect(l.names[g.finish - 1]).toBe(`pellets.rooms[${p.rooms.size() - 1}].swept`);
		expect(l.values[g.start]).toBe(p.taken.size());
		// Each hashed field moves the hash.
		const base = hashState(s);
		p.taken[p.taken.size() - 1] = 1;
		expect(hashState(s)).never.toBe(base);
		p.taken[p.taken.size() - 1] = 0;
		p.rooms[0].phase = PelletPhase.LIVE;
		expect(hashState(s)).never.toBe(base);
		p.rooms[0].phase = PelletPhase.DORMANT;
		expect(hashState(s)).toBe(base);
	});

	it("with the config nothing else moves: every other group, the rng and the other score sources (600 ticks)", () => {
		const a = fresh();
		const b = fresh(WITHOUT);
		for (let t = 0; t < 600; t++) {
			const input = wander(t);
			step(a, input, WITH);
			step(b, input, WITHOUT);
		}
		expect(a.rngState).toBe(b.rngState);
		const ga = groupsByName(a);
		const gb = groupsByName(b);
		for (const [name, values] of gb) if (name !== SCORE_SUBSYSTEM) expect(ga.get(name)).toEqual(values);
		const sa = a.score!;
		const sb = b.score!;
		expect([sa.combo, sa.comboTimer, sa.hitsTaken]).toEqual([sb.combo, sb.comboTimer, sb.hitsTaken]);
		for (let k = 0; k < sb.points.size(); k++)
			expect([sa.points[k], sa.counts[k]]).toEqual([sb.points[k], sb.counts[k]]);
		// Pellet points (PL3) are the only difference in the total.
		expect(sa.total).toBe(sb.total + sa.points[ScoreSource.PELLETS] + sa.points[ScoreSource.SWEEP]);
	});
});

describe("pellets: score sources", () => {
	it("with builds: 12 sources (PELLETS 10, SWEEP 11) and their dump names", () => {
		expect([ScoreSource.PELLETS, ScoreSource.SWEEP]).toEqual([10, 11]);
		expect(PELLET_SCORE_SOURCE_NAMES).toEqual(["pellets", "sweep"]);
		const s = fresh();
		const total = SCORE_SOURCE_COUNT + BUILD_SCORE_SOURCE_NAMES.size() + PELLET_SCORE_SOURCE_NAMES.size();
		expect(total).toBe(12);
		expect([s.score!.points.size(), s.score!.counts.size()]).toEqual([total, total]);
		const names = hashLayout(s, true).names;
		for (const n of ["jackpot", "pellets", "sweep"]) {
			expect(names.includes(`score.points.${n}`)).toBe(true);
			expect(names.includes(`score.counts.${n}`)).toBe(true);
		}
	});

	it("without builds: JACKPOT is padded (0) so PELLETS / SWEEP keep their indices; without pellets: unchanged", () => {
		const noBuilds: SimConfig = { ...WITH, builds: undefined };
		const s = fresh(noBuilds);
		expect(s.score!.points.size()).toBe(12);
		expect(s.score!.points[ScoreSource.JACKPOT]).toBe(0);
		const plain = fresh({ ...WITHOUT, builds: undefined });
		expect(plain.score!.points.size()).toBe(SCORE_SOURCE_COUNT);
		// No scoring at all: pellets state but no sources to pad.
		const unscored = fresh({ ...WITH, scoring: undefined });
		expect(unscored.score).toBe(undefined);
		expect(unscored.pellets!.rooms.size()).toBe(0);
		for (const r of unscored.pellets!.rec) expect(r).toBe(NO_PELLET_RECORD);
	});
});

describe("pellets: the award functions (PD1: the combo is never fed)", () => {
	/** A pellet run at combo x2.3, one curse, floor 7, Depth 2, the combo timer mid-way. */
	function scored(): SimState {
		const s = fresh();
		const sc = s.score!;
		sc.combo = 23;
		sc.maxCombo = 31;
		sc.curses = 1;
		sc.comboTimer = 77;
		s.endless!.floor = 7;
		s.endless!.depth = 2;
		return s;
	}

	function expectComboUntouched(s: SimState): void {
		const sc = s.score!;
		expect([sc.combo, sc.maxCombo, sc.comboTimer, sc.events.comboFed]).toEqual([23, 31, 77, 0]);
	}

	it("scorePellet: pelletPoints x the kills' floor scale x combo x Depth x curse, into PELLETS", () => {
		const s = scored();
		const sc = s.score!;
		// floor(5 x 2.3 x 2 x 1.25 x 1.48) = floor(42.55)
		expect(awardPoints(s, sc, PELLETS_CONFIG.pelletPoints, floorScalePercent(7))).toBe(42);
		expect(scorePellet(s)).toBe(42);
		expect(scorePellet(s)).toBe(42);
		expect([sc.total, sc.points[ScoreSource.PELLETS], sc.counts[ScoreSource.PELLETS], sc.events.points]).toEqual([
			84, 84, 2, 84,
		]);
		expect(sc.counts[ScoreSource.KILLS]).toBe(0);
		expectComboUntouched(s);
	});

	it("scoreSweep: sweepPoints flat x combo x Depth x curse, into SWEEP", () => {
		const s = scored();
		const sc = s.score!;
		// floor(250 x 2.3 x 2 x 1.25) = floor(1437.5)
		expect(scoreSweep(s)).toBe(1437);
		expect([sc.total, sc.points[ScoreSource.SWEEP], sc.counts[ScoreSource.SWEEP]]).toEqual([1437, 1437, 1]);
		expectComboUntouched(s);
	});

	it("scorePowerBullets: one flat award per bullet into PELLETS, capped at powerMaxBullets; none for n <= 0", () => {
		const s = scored();
		const sc = s.score!;
		// floor(5 x 2.3 x 2 x 1.25) = floor(28.75) per bullet
		expect(scorePowerBullets(s, 3)).toBe(3 * 28);
		expect(sc.counts[ScoreSource.PELLETS]).toBe(3);
		const cap = PELLETS_CONFIG.powerMaxBullets;
		expect(scorePowerBullets(s, cap + 400)).toBe(cap * 28);
		expect(sc.counts[ScoreSource.PELLETS]).toBe(3 + cap);
		expect([scorePowerBullets(s, 0), scorePowerBullets(s, -2)]).toEqual([0, 0]);
		expect(sc.total).toBe((3 + cap) * 28);
		expectComboUntouched(s);
	});

	it("the combo timer still runs down on a tick that only paid pellets", () => {
		const s = fresh();
		s.score!.combo = 23;
		s.score!.comboTimer = 77;
		scorePellet(s);
		scoreSweep(s);
		scorePowerBullets(s, 2);
		expect([s.score!.combo, s.score!.comboTimer, s.score!.events.comboFed]).toEqual([23, 77, 0]);
		// stepScore's timer: no kill or graze fed the combo this tick, so it counts down as on an idle tick.
		step(s, EMPTY_INPUT, WITH);
		expect(s.score!.comboTimer).toBe(76);
	});

	it("pay nothing without the pellets state or without the pellet sources", () => {
		const off = fresh(WITHOUT);
		expect([scorePellet(off), scoreSweep(off), scorePowerBullets(off, 5)]).toEqual([0, 0, 0]);
		expect(off.score!.total).toBe(0);
		const s = fresh();
		s.score!.points.remove(s.score!.points.size() - 1);
		expect(scoreSweep(s)).toBe(0);
		expect(scorePellet(s)).toBeGreaterThan(0);
		const unscored = fresh({ ...WITH, scoring: undefined });
		expect([scorePellet(unscored), scoreSweep(unscored), scorePowerBullets(unscored, 5)]).toEqual([0, 0, 0]);
	});
});
