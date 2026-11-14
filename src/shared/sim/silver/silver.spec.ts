// Silver in crates in the sim (docs/SILVER.md SC2, SVD15-SVD17): the opt-in group (absent: no state, the hash exactly as
// before; present: `silver` appended LAST and every other group byte-identical to the same run without it), the
// pieces filled per floor (createSimState, the floor change; dev mode's startFloor), the pay on every break source
// (sword, bow arrow, enemy bullet, the slam, a roll, a build effect) exactly once at the break, the unhashed per-tick
// events (cleared every tick), the total carried over nextFloor, no rng, clone, replay, co-op (the team's), the
// accessors. Measured on a real endless floor's open patch run WITHOUT endless mode (BreakablesConfig.pieces,
// SilverConfig.floor), like drops/breakLoot.spec.ts, plus real endless runs for the floor rules.
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { TileType, gridToWorld, tileAt, type BreakablePlacement, type BreakableSilver } from "shared/dungeon";
import {
	AXIS_MAX,
	BREAKABLES_CONFIG,
	BREAKABLE_HP,
	BreakableSource,
	BulletKind,
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	ENDLESS_SILVER_CONFIG,
	NOT_BROKEN,
	NO_SILVER,
	Recorder,
	SILVER_SUBSYSTEM,
	cloneSimState,
	createSimState,
	damageBreakable,
	fireBurstRaw,
	groupValues,
	hashLayout,
	hashState,
	packPayload,
	runReplay,
	silverOnBreak,
	silverPieceAt,
	silverTotalOf,
	slamBreakables,
	step,
	stepParty,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildDevRunConfig, buildEndlessRunConfig, endlessRunFloor, type EndlessRunFloor } from "shared/run";

// ---------------------------------------------------------------------------------------------
// The patch: the first endless floor cell whose Chebyshev radius-6 neighbourhood is all FLOOR.

function openPatch(): { fl: EndlessRunFloor; gx: number; gy: number } {
	for (let run = 1; run <= 40; run++) {
		const fl = endlessRunFloor(run, 1);
		const d = fl.dungeon;
		for (let gy = 6; gy < d.H - 6; gy++)
			for (let gx = 6; gx < d.W - 6; gx++) {
				let open = true;
				for (let oy = -6; oy <= 6 && open; oy++)
					for (let ox = -6; ox <= 6 && open; ox++)
						if (tileAt(d, gx + ox, gy + oy) !== TileType.FLOOR) open = false;
				if (open) return { fl, gx, gy };
			}
	}
	error("no open patch");
}

const PATCH = openPatch();
const CX = gridToWorld(PATCH.gx);
const CZ = gridToWorld(PATCH.gy);

function piece(ox: number, oy: number, kind: "barrel" | "crate" = "barrel"): BreakablePlacement {
	return { x: PATCH.gx + ox, y: PATCH.gy + oy, kind };
}

/** A sandbox world on the patch: these pieces, this Silver (undefined: Silver in crates off). */
function world(
	pieces: ReadonlyArray<BreakablePlacement>,
	silver: ReadonlyArray<BreakableSilver> | undefined,
	extra: Partial<SimConfig> = {},
): SimConfig {
	const c = PATCH.fl.config;
	return {
		...c,
		encounter: { ...c.encounter!, spawns: [] },
		breakables: { ...BREAKABLES_CONFIG, pieces },
		silver: silver !== undefined ? { floor: silver } : undefined,
		...extra,
	};
}

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, aimZ: AXIS_MAX, ...over });
const IDLE = frame();
const FIRE = frame({ buttons: Button.FIRE });
const SWORD = { loadout: ["weapon.sword"] };
const BOW = { loadout: ["weapon.bow"] };

function run(s: SimState, config: SimConfig, input: InputFrame, ticks: number): void {
	for (let t = 0; t < ticks; t++) step(s, input, config);
}

function enemyShot(s: SimState, emitter: number, x: number, z: number, dirX: number, dirZ: number): void {
	const payload = packPayload(1, BulletKind.ENEMY, 1);
	s.combat.enemySpawned += fireBurstRaw(s.combat.enemyBullets, emitter, x, z, dirX, dirZ, 1, 0, 6, 2, payload);
}

/** Steps until slot `slot` breaks (at most `limit` ticks); returns that tick's Silver events. */
function untilBroken(s: SimState, config: SimConfig, input: InputFrame, slot: number, limit: number) {
	for (let t = 0; t < limit; t++) {
		step(s, input, config);
		if (s.breakables!.pieces[slot].brokenTick !== NOT_BROKEN) return [...s.silver!.events.breaks];
	}
	error(`slot ${slot} did not break in ${limit} ticks`);
}

/** The hash values of every group but `silver`, in order. */
function withoutSilver(s: SimState): number[] {
	const l = hashLayout(s);
	const out: number[] = [];
	for (const g of l.groups) if (g.name !== SILVER_SUBSYSTEM) for (const v of groupValues(l, g)) out.push(v);
	return out;
}

// ---------------------------------------------------------------------------------------------

describe("silver: the switch, state and hash (SC2)", () => {
	const pieces = [piece(0, 1), piece(3, 1, "crate"), piece(-3, 1)];
	const silver: BreakableSilver[] = [
		{ slot: 1, amount: 7 },
		{ slot: 2, amount: 5 },
	];

	it("ENDLESS_SILVER_CONFIG is frozen and empty (the floor decides everything); every endless world sets it", () => {
		expect(table.isfrozen(ENDLESS_SILVER_CONFIG)).toBe(true);
		expect(ENDLESS_SILVER_CONFIG.floor).toBe(undefined);
		expect(buildEndlessRunConfig(1).config.silver).toBe(ENDLESS_SILVER_CONFIG);
		expect(buildEndlessRunConfig(1, 3).config.silver).toBe(ENDLESS_SILVER_CONFIG);
		expect(buildDevRunConfig(1, { startFloor: 3, invulnerable: false }).config.silver).toBe(ENDLESS_SILVER_CONFIG);
	});

	it("on: one entry per piece (NO_SILVER empty), the accessors read it, hashed as the LAST group", () => {
		const s = createSimState(1, CX, CZ - 4, world(pieces, silver));
		expect(s.silver!.pieces).toEqual([NO_SILVER, 7, 5]);
		expect(s.silver!.total).toBe(0);
		expect([0, 1, 2, 3].map((i) => silverPieceAt(s, i))).toEqual([NO_SILVER, 7, 5, NO_SILVER]);
		expect(silverTotalOf(s)).toBe(0);
		const layout = hashLayout(s, true);
		const g = layout.groups[layout.groups.size() - 1];
		expect(g.name).toBe(SILVER_SUBSYSTEM);
		expect(g.finish).toBe(layout.values.size());
		const names: string[] = [];
		for (let i = g.start; i < g.finish; i++) names.push(layout.names[i]);
		expect(names).toEqual([
			"silver.total",
			"silver.pieces.length",
			"silver.pieces[0]",
			"silver.pieces[1]",
			"silver.pieces[2]",
		]);
		expect(groupValues(layout, g)).toEqual([0, 3, NO_SILVER, 7, 5]);
		expect(layout.values).toEqual(hashLayout(s).values);
	});

	it("off: no state, no group, the accessors read 0; on without Silver: all empty; without breakables: no pieces", () => {
		const off = createSimState(1, CX, CZ - 4, world(pieces, undefined));
		expect(off.silver).toBe(undefined);
		expect(
			hashLayout(off)
				.groups.map((g) => g.name)
				.includes(SILVER_SUBSYSTEM),
		).toBe(false);
		expect([silverTotalOf(off), silverPieceAt(off, 1)]).toEqual([0, NO_SILVER]);
		silverOnBreak(off, 1); // no-op
		const empty = createSimState(1, CX, CZ - 4, world(pieces, []));
		expect(empty.silver!.pieces).toEqual([NO_SILVER, NO_SILVER, NO_SILVER]);
		const c = PATCH.fl.config;
		const bare = createSimState(1, CX, CZ, {
			...c,
			encounter: { ...c.encounter!, spawns: [] },
			silver: { floor: silver },
		});
		expect(bare.silver!.pieces).toEqual([]);
	});

	it("bad floor data is refused: a slot out of range or listed twice, an amount that is not a positive integer", () => {
		expect(() => createSimState(1, CX, CZ, world(pieces, [{ slot: 3, amount: 4 }]))).toThrow();
		expect(() => createSimState(1, CX, CZ, world(pieces, [{ slot: 0, amount: 0 }]))).toThrow();
		expect(() => createSimState(1, CX, CZ, world(pieces, [{ slot: 0, amount: 1.5 }]))).toThrow();
		expect(() =>
			createSimState(
				1,
				CX,
				CZ,
				world(pieces, [
					{ slot: 0, amount: 4 },
					{ slot: 0, amount: 5 },
				]),
			),
		).toThrow();
	});

	it("with the flag every other group is byte-identical to the same run without it, tick for tick (breaks included)", () => {
		const play = (on: boolean) => {
			const config = world(pieces, on ? silver : undefined, SWORD);
			const s = createSimState(1, CX, CZ, config);
			const out: number[][] = [];
			for (let t = 0; t < 90; t++) {
				step(s, t < 30 ? FIRE : frame({ moveX: t < 60 ? AXIS_MAX : -AXIS_MAX, buttons: Button.FIRE }), config);
				out.push(withoutSilver(s));
			}
			return { s, out };
		};
		const a = play(true);
		const b = play(false);
		expect(a.s.silver!.total).toBeGreaterThan(0);
		expect(a.out).toEqual(b.out);
		expect(hashState(a.s)).never.toBe(hashState(b.s));
	});

	it("clone copies it (equal hash, independent arrays and events)", () => {
		const s = createSimState(1, CX, CZ - 4, world(pieces, silver));
		expect(damageBreakable(s, 1, 100, BreakableSource.MELEE)).toBe(true);
		const c = cloneSimState(s);
		expect(hashState(c)).toBe(hashState(s));
		expect(c.silver!.events.breaks).toEqual(s.silver!.events.breaks);
		c.silver!.pieces[2] = NO_SILVER;
		c.silver!.events.breaks.clear();
		expect(s.silver!.pieces[2]).toBe(5);
		expect(s.silver!.events.breaks.size()).toBe(1);
		expect(hashState(c)).never.toBe(hashState(s));
	});
});

describe("silver: the pay (SC2)", () => {
	it("the sword: a Silver barrel pays its stack on the break tick (one event at its cell centre), then never again", () => {
		const p = piece(0, 1);
		const config = world([p], [{ slot: 0, amount: 6 }], SWORD);
		const s = createSimState(1, CX, CZ, config);
		const ev = untilBroken(s, config, FIRE, 0, 5);
		expect(ev).toEqual([{ slot: 0, x: gridToWorld(p.x), z: gridToWorld(p.y), amount: 6 }]);
		expect([s.silver!.total, silverTotalOf(s), s.silver!.pieces[0]]).toEqual([6, 6, NO_SILVER]);
		// Events are per tick: the next tick clears them; later hits and calls pay nothing.
		step(s, FIRE, config);
		expect(s.silver!.events.breaks.size()).toBe(0);
		expect(damageBreakable(s, 0, 100, BreakableSource.MELEE)).toBe(false);
		silverOnBreak(s, 0);
		run(s, config, FIRE, 10);
		expect(s.silver!.total).toBe(6);
	});

	it("bow arrows pay", () => {
		const config = world([piece(0, 3, "crate")], [{ slot: 0, amount: 9 }], BOW);
		const s = createSimState(1, CX, CZ, config);
		expect(untilBroken(s, config, FIRE, 0, 900).map((e) => e.amount)).toEqual([9]);
		expect(s.silver!.total).toBe(9);
	});

	it("enemy bullets pay too (any break)", () => {
		const config = world([piece(2, 0)], [{ slot: 0, amount: 4 }]);
		const s = createSimState(1, CX, CZ - 5, config);
		const em = s.combat.enemyBullets.acquireEmitter();
		s.combat.enemyEmitters += 1;
		let paid = 0;
		for (let shot = 1; shot <= 4; shot++) {
			enemyShot(s, em, CX, CZ, 1, 0);
			for (let t = 0; t < 30; t++) {
				step(s, IDLE, config);
				for (const e of s.silver!.events.breaks) paid += e.amount;
			}
		}
		expect(s.breakables!.pieces[0].brokenTick).never.toBe(NOT_BROKEN);
		expect([paid, s.silver!.total]).toEqual([4, 4]);
	});

	it("the slam pays every Silver piece it breaks, in slot order; pieces out of reach keep theirs", () => {
		const pieces = [piece(0, 0), piece(1, 0, "crate"), piece(0, -2), piece(9, 0)];
		const silver: BreakableSilver[] = [
			{ slot: 1, amount: 5 },
			{ slot: 2, amount: 8 },
			{ slot: 3, amount: 4 },
		];
		const s = createSimState(1, CX, CZ - 5, world(pieces, silver));
		expect(slamBreakables(s, CX, CZ)).toBe(3);
		expect(s.silver!.events.breaks.map((e) => [e.slot, e.amount])).toEqual([
			[1, 5],
			[2, 8],
		]);
		expect(s.silver!.total).toBe(13);
		expect(s.silver!.pieces).toEqual([NO_SILVER, NO_SILVER, NO_SILVER, 4]);
	});

	it("a roll and a build effect (the other player sources) pay; an unbroken hit pays nothing", () => {
		const pieces = [piece(0, 0, "crate"), piece(4, 0, "crate")];
		const s = createSimState(
			1,
			CX,
			CZ - 5,
			world(pieces, [
				{ slot: 0, amount: 5 },
				{ slot: 1, amount: 6 },
			]),
		);
		expect(damageBreakable(s, 0, 1, BreakableSource.ROLL, 0)).toBe(false);
		expect(s.silver!.total).toBe(0);
		expect(damageBreakable(s, 0, BREAKABLE_HP[1], BreakableSource.ROLL, 0)).toBe(true);
		expect(damageBreakable(s, 1, BREAKABLE_HP[1], BreakableSource.BUILD, 0)).toBe(true);
		expect(s.silver!.total).toBe(11);
		expect(s.silver!.events.breaks.map((e) => e.slot)).toEqual([0, 1]);
	});

	it("no rng: state.rngState ends as in the same run with the piece empty", () => {
		const play = (loaded: boolean) => {
			const config = world([piece(0, 1)], loaded ? [{ slot: 0, amount: 6 }] : [], SWORD);
			const s = createSimState(3, CX, CZ, config);
			untilBroken(s, config, FIRE, 0, 5);
			run(s, config, IDLE, 20);
			return s;
		};
		const a = play(true);
		const b = play(false);
		expect([a.silver!.total, b.silver!.total]).toEqual([6, 0]);
		expect(a.rngState).toBe(b.rngState);
		expect(withoutSilver(a)).toEqual(withoutSilver(b));
	});

	it("co-op: the other player's break pays the team's one total", () => {
		const p = piece(3, 1);
		const config = world([p], [{ slot: 0, amount: 7 }], { loadout: ["weapon.sword"], party: { size: 2 } });
		const s = createSimState(5, CX, CZ, config);
		const p1 = s.party!.players[1];
		p1.x = CX + 3;
		p1.prevX = CX + 3;
		for (let t = 0; t < 5 && s.breakables!.pieces[0].brokenTick === NOT_BROKEN; t++)
			stepParty(s, [IDLE, FIRE], config);
		expect(s.breakables!.pieces[0].brokenTick).never.toBe(NOT_BROKEN);
		expect(s.silver!.total).toBe(7);
	});

	it("a recorded run with Silver breaks replays to the same hash", () => {
		const pieces = [piece(0, 1), piece(0, 4, "crate"), piece(2, 2)];
		const silver: BreakableSilver[] = [
			{ slot: 0, amount: 4 },
			{ slot: 1, amount: 8 },
		];
		const config = world(pieces, silver, { loadout: ["weapon.bow", "weapon.sword"] });
		const s = createSimState(9, CX, CZ, config);
		const rec = new Recorder(9, CX, CZ);
		for (let t = 0; t < 300; t++) {
			const input = t < 150 ? FIRE : frame({ moveZ: t < 200 ? AXIS_MAX : 0, buttons: Button.FIRE });
			rec.record(input);
			step(s, input, config);
		}
		expect(s.silver!.total).toBeGreaterThan(0);
		expect(hashState(runReplay(rec.getRecording(), config))).toBe(hashState(s));
	});
});

describe("silver: endless floors (SC2)", () => {
	/** A world's Silver, expanded per breakables slot. */
	function expand(w: EndlessRunFloor): number[] {
		const out: number[] = [];
		for (let i = 0; i < w.breakables!.size(); i++) out.push(NO_SILVER);
		for (const x of w.breakableSilver!) out[x.slot] = x.amount;
		return out;
	}

	it("each floor brings its own Silver; the run's total carries over the floor change", () => {
		const setup = buildEndlessRunConfig(1337);
		const spawn = setup.spawn!;
		const s = createSimState(1337, spawn.x, spawn.z, setup.config);
		const f1 = setup.endlessFloor(1);
		expect(f1.breakableSilver).toBe(f1.layout.breakableSilver);
		expect(s.silver!.pieces).toEqual(expand(f1));
		const first = f1.breakableSilver![0];
		expect(damageBreakable(s, first.slot, 100, BreakableSource.MELEE)).toBe(true);
		expect(s.silver!.total).toBe(first.amount);
		step(s, frame({ buttons: DEBUG_FLOOR_BUTTON }), setup.config);
		expect(s.endless!.floor).toBe(2);
		expect(s.silver!.pieces).toEqual(expand(setup.endlessFloor(2)));
		expect(s.silver!.pieces.size()).toBe(s.breakables!.pieces.size());
		expect(s.silver!.total).toBe(first.amount);
		const second = setup.endlessFloor(2).breakableSilver![0];
		expect(damageBreakable(s, second.slot, 100, BreakableSource.SLAM)).toBe(true);
		expect(s.silver!.total).toBe(first.amount + second.amount);
	});

	it("dev mode's startFloor gets that floor's Silver, exactly as a run that walked there", () => {
		const dev = buildDevRunConfig(1337, { startFloor: 6, invulnerable: false });
		const s = createSimState(1337, dev.spawn!.x, dev.spawn!.z, dev.config);
		expect(s.endless!.floor).toBe(6);
		expect(s.silver!.pieces).toEqual(expand(buildEndlessRunConfig(1337).endlessFloor(6)));
	});

	it("an endless run without the flag: no group, every other group identical to the run with it (60 ticks of walking)", () => {
		const setup = buildEndlessRunConfig(42);
		const spawn = setup.spawn!;
		const on = createSimState(42, spawn.x, spawn.z, setup.config);
		const offConfig: SimConfig = { ...setup.config, silver: undefined };
		const off = createSimState(42, spawn.x, spawn.z, offConfig);
		expect(off.silver).toBe(undefined);
		for (let t = 0; t < 60; t++) {
			const input = frame({ moveX: AXIS_MAX, buttons: t % 2 === 0 ? Button.FIRE : 0 });
			step(on, input, setup.config);
			step(off, input, offConfig);
			expect(withoutSilver(on)).toEqual(hashLayout(off).values);
		}
	});
});
