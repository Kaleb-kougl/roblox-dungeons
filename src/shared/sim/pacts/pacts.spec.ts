// Pacts state and hash (docs/FORTUNE.md PS2): opt-in like pellets. Without SimConfig.pacts nothing exists, nothing is
// hashed and the classic shrine runs (the fixtures, M1 and the tutorial are pinned by their own specs); with it the
// state is created on floor 1's altars (or the sandbox's `floor`), hashed as the LAST group (`pacts`, after `pellets`;
// names match values; writeHashFields and hashLayout agree), cloned, refreshed per floor (an armed Horde lapses), the
// score gains the HORDE source (index 12, padded); the classic shrine zone is off where the altars stand and on where
// they do not. A pacts run where nobody presses at an altar draws exactly as a no-pacts run from the main rng: the same
// recorded descent (rooms fought on the way, the bot standing on both altars and the crystal, a SKILL1 press outside
// every zone, floors skipped with drafts picked) replays tick for tick with the same rngState and every non-pacts hash
// group the same (score: the same values but the padded HORDE source).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	ENDLESS_PACTS_CONFIG,
	HORDE_NONE,
	HORDE_WAVE_PENDING,
	NO_PACT,
	PACTS_SUBSYSTEM,
	PACT_KIND_COUNT,
	PELLETS_SUBSYSTEM,
	TREASURE_SUBSYSTEM,
	PactDim,
	PactKind,
	SCORE_SUBSYSTEM,
	SHRINE_BUTTON,
	ScoreSource,
	cloneSimState,
	createPactsState,
	createSimState,
	groupValues,
	hashLayout,
	hashState,
	pactAltarsPlaced,
	pactAvailability,
	pactsSpent,
	step,
	writeHashFields,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { PACTS } from "shared/dungeon";
import { DRAFT_SCREEN_RIGHT_X, DRAFT_SCREEN_RIGHT_Z, SHRINE_RADIUS } from "shared/sim";
import {
	Driver,
	altarFloor,
	dismissDraft,
	frame,
	pactsSetup,
	pressPact,
	skipToFloor,
	skipToFloorAny,
	teleport,
	walkToAltar,
} from "shared/run/testing";

const SEED = 1337;

function fresh(on: boolean, seed = SEED) {
	const setup = pactsSetup(seed, 1, on);
	const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, setup.config);
	return { setup, s };
}

/**
 * fresh() without the Goldling (docs/FORTUNE.md GE3: every endless world sets it too; its group follows pacts' and its
 * GOLDEN source pads HORDE in), so pacts are the last group and HORDE the last source here: what pacts add, alone.
 */
function alone(on: boolean, seed = SEED) {
	const base = pactsSetup(seed, 1, on);
	const config: SimConfig = { ...base.config, golden: undefined };
	return { setup: { ...base, config }, s: createSimState(seed, base.spawn!.x, base.spawn!.z, config) };
}

describe("pacts state (PS2)", () => {
	it("absent config: no state, no group, no HORDE source", () => {
		const { s } = alone(false);
		expect(s.pacts).toBe(undefined);
		const names = hashLayout(s).groups.map((g) => g.name);
		expect(names.includes(PACTS_SUBSYSTEM)).toBe(false);
		// treasure (docs/TREASURE.md TR5: every endless world sets it) is the last group then, its TREASURE the last source
		expect(names[names.size() - 1]).toBe(TREASURE_SUBSYSTEM);
		expect(names[names.size() - 2]).toBe(PELLETS_SUBSYSTEM);
		expect(s.score!.points.size()).toBe(ScoreSource.HORDE);
	});

	it("present: the LAST group (after pellets, treasure), names match values, writeHashFields agrees, clone hashes the same", () => {
		const { s } = alone(true);
		expect(s.pacts).never.toBe(undefined);
		const off = alone(false).s;
		const a = hashLayout(off, true);
		const b = hashLayout(s, true);
		expect(b.groups.size()).toBe(a.groups.size() + 1);
		const last = b.groups[b.groups.size() - 1];
		expect(last.name).toBe(PACTS_SUBSYSTEM);
		expect(b.groups[b.groups.size() - 2].name).toBe(TREASURE_SUBSYSTEM);
		expect(b.names.size()).toBe(b.values.size());
		expect(b.values).toEqual(writeHashFields(s, []));
		expect(b.names[last.start]).toBe("pacts.room");
		expect(hashState(cloneSimState(s))).toBe(hashState(s));
		// Every group before score is the no-pacts state's; score only grows by the padded HORDE source.
		for (let g = 0; g < a.groups.size(); g++) {
			const name = a.groups[g].name;
			const va = groupValues(a, a.groups[g]);
			const vb = groupValues(b, b.groups[g]);
			if (name !== SCORE_SUBSYSTEM) expect(vb).toEqual(va);
			else expect(vb.size()).toBe(va.size() + 2);
		}
		expect(s.score!.points.size()).toBe(ScoreSource.HORDE + 1);
		expect(s.score!.points[ScoreSource.HORDE]).toBe(0);
	});

	it("createSimState: floor 1's altars from its world (or none); every player fresh; Horde idle", () => {
		for (let seed = 1; seed <= 12; seed++) {
			const { setup, s } = fresh(true, seed);
			const world = setup.endlessFloor(1);
			const p = s.pacts!;
			if (world.pactAltars === undefined) {
				expect(p.room).toBe(-1);
				expect(p.altarX.size()).toBe(0);
				expect(pactAltarsPlaced(s)).toBe(false);
			} else {
				expect(p.room).toBe(world.pactAltars.room);
				expect(p.seed).toBe(world.pactAltars.seed);
				for (let k = 0; k < PACT_KIND_COUNT; k++) {
					expect(p.altarX[k]).toBe(world.pactAltars.altars[k].x);
					expect(p.altarZ[k]).toBe(world.pactAltars.altars[k].z);
				}
				expect(pactAltarsPlaced(s)).toBe(true);
			}
			expect(p.players.size()).toBe(1);
			expect(p.players[0]).toEqual({ greedTaken: 0, hordeTaken: 0, draftKind: NO_PACT });
			expect(p.horde.armed).toBe(0);
			expect(p.horde.room).toBe(HORDE_NONE);
			expect(p.horde.spawned).toBe(HORDE_WAVE_PENDING);
			expect(p.taken).toEqual([0, 0]);
		}
	});

	it("config: a hordePercent that is not a multiple of 100 is refused", () => {
		expect(() => createPactsState({ ...ENDLESS_PACTS_CONFIG, hordePercent: 150 })).toThrow("hordePercent");
		expect(() => createPactsState({ ...ENDLESS_PACTS_CONFIG, legendaryCards: 0 })).toThrow("legendaryCards");
		expect(ENDLESS_PACTS_CONFIG.hordePercent).toBe(200);
		expect(ENDLESS_PACTS_CONFIG.legendaryCards).toBe(3);
		expect(ENDLESS_PACTS_CONFIG.hordeMaxWave).toBe(10);
		expect(ENDLESS_PACTS_CONFIG.waveTelegraphTicks).toBe(60);
	});

	it("the dungeon's geometry agrees with the sim: altar zone = SHRINE_RADIUS, screen-right = the draft's", () => {
		expect(PACTS.clearCells).toBe(SHRINE_RADIUS);
		expect(math.sign(DRAFT_SCREEN_RIGHT_X)).toBe(PACTS.screenRight[0]);
		expect(math.sign(DRAFT_SCREEN_RIGHT_Z)).toBe(PACTS.screenRight[1]);
		expect(PACTS.screenDown[0] * PACTS.screenRight[0] + PACTS.screenDown[1] * PACTS.screenRight[1]).toBe(0);
	});

	it("a new floor: its altars; takes, draft kinds and an armed Horde cleared", () => {
		const setup = pactsSetup(SEED);
		const f = altarFloor(setup);
		expect(f > 0).toBe(true);
		const s = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		skipToFloor(s, setup.config, f);
		pressPact(setup, s, PactKind.HORDE);
		expect(s.pacts!.horde.armed).toBe(1);
		expect(s.pacts!.players[0].hordeTaken).toBe(1);
		skipToFloor(s, setup.config, f + 1);
		const p = s.pacts!;
		expect(p.horde.armed).toBe(0);
		expect(p.players[0].hordeTaken).toBe(0);
		expect(p.taken[PactKind.HORDE]).toBe(1); // run counter kept
		const upcoming = setup.endlessFloor(f + 1).pactAltars;
		expect(p.room).toBe(upcoming !== undefined ? upcoming.room : -1);
	});

	it("the classic shrine is off where the altars stand, and runs as before where they do not", () => {
		const setup = pactsSetup(SEED);
		const f = altarFloor(setup);
		const s = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		skipToFloor(s, setup.config, f);
		const room = s.run!.shrineRoom;
		expect(room).toBe(s.pacts!.room);
		const r = setup.endlessFloor(f).config.encounter!.rooms[room];
		teleport(s, 0, r.cx, r.cz);
		const rng = s.rngState;
		step(s, frame(0, 0, SHRINE_BUTTON), setup.config);
		step(s, frame(0, 0), setup.config);
		expect(s.run!.shrineUsed).toBe(0);
		expect(s.run!.players[0].curses.size()).toBe(0);
		expect(s.rngState).toBe(rng);
		// The same floor without its altars (a world whose placement failed): the classic shrine takes the press.
		const world = setup.endlessFloor(f);
		const bare: SimConfig = {
			...setup.config,
			endless: {
				...setup.config.endless!,
				worldForFloor: (fl) => {
					const w = setup.endlessFloor(fl);
					return fl === f ? { ...w, pactAltars: undefined } : w;
				},
			},
		};
		expect(world.pactAltars).never.toBe(undefined);
		const t = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, bare);
		skipToFloor(t, bare, f);
		expect(t.pacts!.room).toBe(-1);
		teleport(t, 0, r.cx, r.cz);
		step(t, frame(0, 0, SHRINE_BUTTON), bare);
		expect(t.run!.shrineUsed).toBe(1);
		expect(t.run!.players[0].curses.size()).toBe(1);
	});
});

/** Every group's values but score's and pacts', and the score values without the HORDE source. */
function comparable(s: Readonly<SimState>): number[] {
	const l = hashLayout(s);
	const out: number[] = [];
	for (const g of l.groups) {
		if (g.name === PACTS_SUBSYSTEM || g.name === SCORE_SUBSYSTEM) continue;
		for (const v of groupValues(l, g)) out.push(v);
	}
	const sc = s.score!;
	out.push(sc.total, sc.combo, sc.comboTimer, sc.maxCombo, sc.curses, sc.hitsTaken);
	for (let k = 0; k < ScoreSource.HORDE; k++) out.push(sc.points[k], sc.counts[k]);
	for (const r of sc.rooms) out.push(r.room, r.parTicks, r.engageTick, r.cleared, r.memberSlots.size());
	return out;
}

describe("no presses at an altar: the main rng draws exactly as without pacts (PS2)", () => {
	it("the recorded descent replays tick for tick with pacts on: same rngState, same state but the pacts group", () => {
		const off = pactsSetup(SEED, 1, false);
		const on = pactsSetup(SEED, 1, true);
		const f = altarFloor(off);
		expect(f > 0).toBe(true);
		const drv = new Driver(off, SEED);
		// Floors before the altar floor: walk a while (rooms on the way spawn and fight), then the debug skip.
		while (drv.floor() < f && drv.state.player.dead === 0) {
			const w = drv.world();
			drv.walkTo(w.stairX, w.stairZ, () => false, 400, [w.stairX, w.stairZ]);
			drv.skipFloor();
		}
		// The altar floor: onto both altars and the crystal without a press, a SKILL1 press outside every zone.
		expect(walkToAltar(drv, PactKind.GREED)).toBe(true);
		for (let k = 0; k < 20; k++) drv.tick(frame(0, 0));
		expect(walkToAltar(drv, PactKind.HORDE)).toBe(true);
		for (let k = 0; k < 20; k++) drv.tick(frame(0, 0));
		const altars = drv.world().pactAltars!;
		const w = drv.world();
		const r = w.config.encounter!.rooms[altars.room];
		drv.walkTo(r.cx, r.cz, () => false, 200, [w.stairX, w.stairZ]);
		drv.walkTo(w.spawnX, w.spawnZ, () => false, 600, [w.stairX, w.stairZ]);
		drv.pressShrine();
		drv.walkTo(w.stairX, w.stairZ, () => false, 600, [w.stairX, w.stairZ]);
		drv.skipFloor();
		drv.skipFloor();
		const rec = drv.recorder.getRecording();
		expect(rec.frames.size() > 1000).toBe(true);

		const a = createSimState(SEED, off.spawn!.x, off.spawn!.z, off.config);
		const b = createSimState(SEED, on.spawn!.x, on.spawn!.z, on.config);
		let altarTicks = 0;
		let spawned = 0;
		for (let t = 0; t < rec.frames.size(); t++) {
			step(a, rec.frames[t], off.config);
			step(b, rec.frames[t], on.config);
			spawned += b.events.actorsSpawned;
			expect(b.rngState).toBe(a.rngState);
			if (t % 25 === 0 || t === rec.frames.size() - 1) expect(comparable(b)).toEqual(comparable(a));
			if (b.pacts!.room >= 0) altarTicks++;
		}
		expect(altarTicks > 0).toBe(true);
		expect(spawned > 0).toBe(true); // rooms on the way spawned (and their init hooks drew the main rng)
		expect(b.pacts!.taken).toEqual([0, 0]);
		expect(b.score!.points[ScoreSource.HORDE]).toBe(0);
		expect(comparable(b)).toEqual(comparable(a));
		expect(hashState(a)).toBe(hashState(drv.state));
		dismissDraft(b);
	});
});

describe("pactsSpent (the shrine crystal's dim)", () => {
	/** Run SEED for a party of `party` on its first altar floor. */
	function onAltars(party = 1) {
		const setup = pactsSetup(SEED, party);
		const s = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		skipToFloorAny(s, setup.config, altarFloor(setup));
		return { setup, s };
	}
	function noRoomLeft(s: SimState): void {
		const e = s.endless!;
		for (let id = 0; id < e.roomsEntered.size(); id++) e.roomsEntered[id] = 1; // surgery: every room entered
	}

	it("spent once Greed is out of everyone's reach and the Horde is taken or has no room left (NO_ROOM)", () => {
		// fresh: nothing taken
		{
			const { setup, s } = onAltars();
			expect(pactsSpent(s, setup.config)).toBe(false);
			// the Horde taken, Greed still there
			pressPact(setup, s, PactKind.HORDE);
			expect(pactsSpent(s, setup.config)).toBe(false);
			// Greed taken too: spent
			pressPact(setup, s, PactKind.GREED);
			dismissDraft(s);
			expect(pactAvailability(s, setup.config, 0, PactKind.GREED)).toBe(PactDim.TAKEN);
			expect(pactsSpent(s, setup.config)).toBe(true);
		}
		// Greed taken, the Horde never taken: spent only once no room is left for it
		{
			const { setup, s } = onAltars();
			pressPact(setup, s, PactKind.GREED);
			dismissDraft(s);
			expect(pactAvailability(s, setup.config, 0, PactKind.HORDE)).toBe(PactDim.NONE);
			expect(pactsSpent(s, setup.config)).toBe(false);
			noRoomLeft(s);
			expect(pactAvailability(s, setup.config, 0, PactKind.HORDE)).toBe(PactDim.NO_ROOM);
			expect(pactsSpent(s, setup.config)).toBe(true);
		}
		// no room left but Greed still open: not spent
		{
			const { setup, s } = onAltars();
			noRoomLeft(s);
			expect(pactsSpent(s, setup.config)).toBe(false);
		}
		// co-op: one player took Greed, the other still can; then both did (the Horde with no room left)
		{
			const { setup, s } = onAltars(2);
			noRoomLeft(s);
			pressPact(setup, s, PactKind.GREED, 0);
			dismissDraft(s);
			expect(pactsSpent(s, setup.config)).toBe(false);
			pressPact(setup, s, PactKind.GREED, 1);
			dismissDraft(s);
			expect(pactsSpent(s, setup.config)).toBe(true);
		}
		// no altars on the floor: never spent
		{
			const setup = pactsSetup(SEED);
			let bare = 1;
			while (setup.endlessFloor(bare).pactAltars !== undefined) bare++;
			const s = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
			skipToFloor(s, setup.config, bare);
			expect(s.pacts!.room).toBe(-1);
			noRoomLeft(s);
			expect(pactsSpent(s, setup.config)).toBe(false);
		}
	});
});
